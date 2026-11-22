import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { AssetSlotId, AssetSlotRecord, SceneVariantMode } from './types';
import type { ProceduralTextureSet } from './textures';
import {
  countTriangles,
  createCedarModel,
  createLanternModel,
  createMinkaModel,
  createPusherPropeller,
  createRockModel,
  createToriiModel,
  createWrightFlyerModel,
  type AircraftRig,
} from './proceduralModels';

const REGISTRY_STORAGE_KEY = 'komorebi_asset_registry_v1';

export const ORDERED_ASSET_SLOTS: AssetSlotId[] = [
  'aircraft',
  'cedar',
  'minka',
  'torii',
  'lantern',
  'rock',
];

const INITIAL_SLOT_META: Record<
  AssetSlotId,
  Omit<AssetSlotRecord, 'provenance' | 'fileName' | 'triangleCount' | 'updatedAt'>
> = {
  aircraft: {
    id: 'aircraft',
    order: 1,
    label: '1903 Wright Flyer',
    description:
      'Open biplane with broad ivory linen wings, slender timber frame, front canard, and twin rear pusher propellers.',
    targetBounds: { width: 6.9, height: 1.85, depth: 4.35 },
    orientationNote: 'Nose faces -Z, wingspan along X, propellers at rear +Z.',
  },
  cedar: {
    id: 'cedar',
    order: 2,
    label: 'Japanese Cedar',
    description:
      'Tall reddish-brown trunk with flared grounded roots and irregular layered deep-green needle foliage.',
    targetBounds: { width: 6.8, height: 19.8, depth: 6.8 },
    orientationNote: 'Pivot at bottom-center root base (y = 0).',
  },
  minka: {
    id: 'minka',
    order: 3,
    label: 'Minka Timber House',
    description:
      'Weathered timber frame, warm plaster infill, broad tiled roof with generous eaves, glowing shoji windows, and stone foundation.',
    targetBounds: { width: 11.7, height: 8.2, depth: 8.6 },
    orientationNote: 'Pivot at terrace ground line (y = 0) with embedded stone foundation.',
  },
  torii: {
    id: 'torii',
    order: 4,
    label: 'Vermilion Torii Gate',
    description:
      'Weathered vermilion Japanese timber gate with twin posts and curved dark lintel matching the collision passage.',
    targetBounds: { width: 32.8, height: 25.5, depth: 3.2 },
    orientationNote: 'Passage spans Z axis; inner opening width = 22.4m, lintel clearance = 20.5m.',
  },
  lantern: {
    id: 'lantern',
    order: 5,
    label: 'Spirit Lantern',
    description:
      'Warm paper-and-timber lantern family reused for golden-ring collectibles and smaller decorative lights.',
    targetBounds: { width: 1.6, height: 2.5, depth: 1.6 },
    orientationNote: 'Centered at geometric origin for balanced floating & hanging.',
  },
  rock: {
    id: 'rock',
    order: 6,
    label: 'Mossy River Stone',
    description:
      'Rounded mossy stone with a grounded underside instanced along riverbanks without blocking the corridor.',
    targetBounds: { width: 3.0, height: 1.8, depth: 3.0 },
    orientationNote: 'Pivot near bottom-center for flush shoreline seating.',
  },
};

export interface ImportedAssetEntry {
  template: THREE.Group;
  rawFile: File;
  fileName: string;
  triangleCount: number;
  importedAt: number;
}

/**
 * Normalizes an imported GLB scene to fit a slot's target bounds and pivot rules.
 */
function normalizeImportedScene(slot: AssetSlotId, source: THREE.Group): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = `imported_${slot}`;

  const clone = source.clone(true);
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const target = INITIAL_SLOT_META[slot].targetBounds;
  const maxSrc = Math.max(size.x, size.y, size.z, 0.001);
  let scale = 1;

  if (slot === 'aircraft') {
    scale = target.width / Math.max(size.x, size.z, 0.001);
  } else if (slot === 'cedar') {
    scale = target.height / Math.max(size.y, 0.001);
  } else if (slot === 'torii') {
    scale = target.width / Math.max(size.x, 0.001);
  } else {
    const maxTarget = Math.max(target.width, target.height, target.depth);
    scale = maxTarget / maxSrc;
  }

  clone.scale.multiplyScalar(scale);
  clone.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(clone);
  const scaledCenter = new THREE.Vector3();
  scaledBox.getCenter(scaledCenter);

  if (slot === 'aircraft' || slot === 'lantern') {
    // Center at origin
    clone.position.sub(scaledCenter);
  } else {
    // Grounded bottom-center pivot (y = 0)
    clone.position.x -= scaledCenter.x;
    clone.position.z -= scaledCenter.z;
    clone.position.y -= scaledBox.min.y;
  }

  clone.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });

  wrapper.add(clone);

  // For Minka houses, always include a subtle stone foundation skirt under y=0 so corners never float
  if (slot === 'minka') {
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(target.width * 0.78, 2.8, target.depth * 0.78),
      new THREE.MeshStandardMaterial({ color: 0x454a46, roughness: 0.92 }),
    );
    skirt.position.set(0, -1.38, 0);
    wrapper.add(skirt);
  }

  return wrapper;
}

export class AssetManifestManager {
  private readonly loader = new GLTFLoader();
  private readonly exporter = new GLTFExporter();
  private readonly imported = new Map<AssetSlotId, ImportedAssetEntry>();
  private readonly baselineTriCounts: Record<AssetSlotId, number> = {
    aircraft: 2480,
    cedar: 1120,
    minka: 840,
    torii: 1620,
    lantern: 140,
    rock: 480,
  };
  private listeners = new Set<() => void>();

  constructor() {
    this.restoreSavedMetadataHint();
  }

  private restoreSavedMetadataHint(): void {
    try {
      const raw = window.localStorage.getItem(REGISTRY_STORAGE_KEY);
      if (!raw) return;
      // Only saved metadata hints exist across reloads; local File blobs are session-scoped.
      JSON.parse(raw);
    } catch {
      // Ignore storage access errors
    }
  }

  private persistProgress(): void {
    try {
      const payload = this.getRecords().map((r) => ({
        id: r.id,
        provenance: r.provenance,
        fileName: r.fileName,
        updatedAt: r.updatedAt,
      }));
      window.localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Safe fallback when storage is disabled
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.persistProgress();
    this.listeners.forEach((fn) => fn());
  }

  public getImportedCount(): number {
    return this.imported.size;
  }

  public hasImportedSlot(slot: AssetSlotId): boolean {
    return this.imported.has(slot);
  }

  public getRecords(): AssetSlotRecord[] {
    return ORDERED_ASSET_SLOTS.map((id) => {
      const meta = INITIAL_SLOT_META[id];
      const imp = this.imported.get(id);
      return {
        ...meta,
        provenance: imp ? 'imported-glb' : 'procedural-baseline',
        fileName: imp ? imp.fileName : null,
        triangleCount: imp ? imp.triangleCount : this.baselineTriCounts[id],
        updatedAt: imp ? imp.importedAt : null,
      };
    });
  }

  public async importGlbFile(slot: AssetSlotId, file: File): Promise<AssetSlotRecord> {
    const buffer = await file.arrayBuffer();
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      this.loader.parse(
        buffer,
        '',
        (res) => resolve(res as unknown as { scene: THREE.Group }),
        (err) => reject(err instanceof Error ? err : new Error('Failed to parse GLB/GLTF model')),
      );
    });

    const normalized = normalizeImportedScene(slot, gltf.scene);
    const tris = countTriangles(normalized);
    this.imported.set(slot, {
      template: normalized,
      rawFile: file,
      fileName: file.name,
      triangleCount: tris,
      importedAt: Date.now(),
    });
    this.emit();
    return this.getRecords().find((r) => r.id === slot)!;
  }

  public clearImportedSlot(slot: AssetSlotId): void {
    const existing = this.imported.get(slot);
    if (!existing) return;
    existing.template.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
        else mesh.material?.dispose();
      }
    });
    this.imported.delete(slot);
    this.emit();
  }

  public buildAircraft(
    textures: ProceduralTextureSet,
    variant: SceneVariantMode,
  ): AircraftRig {
    const useImported = variant === 'enhanced' && this.imported.has('aircraft');
    if (useImported) {
      const entry = this.imported.get('aircraft')!;
      const root = entry.template.clone(true);

      // Detect named propeller nodes if present; otherwise attach clean animated pusher props
      let leftProp: THREE.Object3D | null = null;
      let rightProp: THREE.Object3D | null = null;
      root.traverse((obj) => {
        const lower = obj.name.toLowerCase();
        if (!leftProp && (lower.includes('prop') || lower.includes('blade')) && (lower.includes('left') || lower.includes('_l') || lower.includes('1'))) {
          leftProp = obj;
        } else if (!rightProp && (lower.includes('prop') || lower.includes('blade')) && (lower.includes('right') || lower.includes('_r') || lower.includes('2'))) {
          rightProp = obj;
        }
      });

      if (!leftProp || !rightProp) {
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x56321e, roughness: 0.48, metalness: 0.08 });
        const brassMat = new THREE.MeshStandardMaterial({ color: 0xc8a45c, roughness: 0.28, metalness: 0.82 });
        if (!leftProp) {
          leftProp = createPusherPropeller('propeller_left', 1, woodMat, brassMat);
          leftProp.position.set(-1.05, 0.02, 0.84);
          root.add(leftProp);
        }
        if (!rightProp) {
          rightProp = createPusherPropeller('propeller_right', -1, woodMat, brassMat);
          rightProp.position.set(1.05, 0.02, 0.84);
          root.add(rightProp);
        }
      }

      return {
        root,
        leftPropeller: leftProp,
        rightPropeller: rightProp,
        triangleCount: entry.triangleCount,
      };
    }

    const rig = createWrightFlyerModel(textures, variant);
    this.baselineTriCounts.aircraft = rig.triangleCount;
    return rig;
  }

  public buildCedar(textures: ProceduralTextureSet, variant: SceneVariantMode): THREE.Group {
    if (variant === 'enhanced' && this.imported.has('cedar')) {
      return this.imported.get('cedar')!.template.clone(true);
    }
    const model = createCedarModel(textures, variant);
    this.baselineTriCounts.cedar = countTriangles(model);
    return model;
  }

  public buildMinka(textures: ProceduralTextureSet, variant: SceneVariantMode): THREE.Group {
    if (variant === 'enhanced' && this.imported.has('minka')) {
      return this.imported.get('minka')!.template.clone(true);
    }
    const model = createMinkaModel(textures, variant);
    this.baselineTriCounts.minka = countTriangles(model);
    return model;
  }

  public buildLantern(
    role: 'collectible' | 'decorative',
    variant: SceneVariantMode,
  ): THREE.Group {
    if (variant === 'enhanced' && this.imported.has('lantern')) {
      const clone = this.imported.get('lantern')!.template.clone(true);
      if (role === 'decorative') {
        clone.scale.multiplyScalar(0.62);
      }
      return clone;
    }
    const model = createLanternModel(role, variant);
    if (role === 'collectible') {
      this.baselineTriCounts.lantern = countTriangles(model);
    }
    return model;
  }

  public buildTorii(
    openingHalfWidth: number,
    lintelBottomY: number,
    variant: SceneVariantMode,
  ): THREE.Group {
    if (variant === 'enhanced' && this.imported.has('torii')) {
      return this.imported.get('torii')!.template.clone(true);
    }
    const model = createToriiModel(openingHalfWidth, lintelBottomY, variant, () =>
      this.buildLantern('decorative', variant),
    );
    this.baselineTriCounts.torii = countTriangles(model);
    return model;
  }

  public buildRock(variant: SceneVariantMode): THREE.Group {
    if (variant === 'enhanced' && this.imported.has('rock')) {
      return this.imported.get('rock')!.template.clone(true);
    }
    const model = createRockModel(variant);
    this.baselineTriCounts.rock = countTriangles(model);
    return model;
  }

  /**
   * Downloads the active local aircraft GLB file: returns the exact imported File
   * if one is loaded, or exports the procedural 1903 Wright Flyer as a real .glb file.
   */
  public async downloadActiveAircraftGlb(
    textures: ProceduralTextureSet,
    variant: SceneVariantMode,
  ): Promise<string> {
    const importedAircraft = this.imported.get('aircraft');
    if (importedAircraft && variant === 'enhanced') {
      const url = URL.createObjectURL(importedAircraft.rawFile);
      const a = document.createElement('a');
      a.href = url;
      a.download = importedAircraft.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return importedAircraft.fileName;
    }

    const rig = createWrightFlyerModel(textures, variant);
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      this.exporter.parse(
        rig.root,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('Expected binary GLB export'));
        },
        (err) => reject(err instanceof Error ? err : new Error('GLB export failed')),
        { binary: true },
      );
    });

    const filename = 'komorebi-wright-flyer-1903.glb';
    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return filename;
  }
}
