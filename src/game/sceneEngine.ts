import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  CHAPTERS,
  ROUTE_LENGTH,
  WATER_LEVEL,
  getWorldRouteData,
  groundHeightAt,
  riverCenterX,
  riverHalfWidthAt,
  type WorldRouteData,
} from './worldMath';
import {
  BASE_SPEED,
  MAX_HEARTS,
  createInitialFlightState,
  findNearestUpcomingLantern,
  getAnimatedLanternY,
  getChapterProgress,
  getCompassHeadingDegrees,
  resetForNewRun,
  stepFlightSimulation,
  type FlightSimState,
  type SimEvent,
} from './flightSim';
import { createProceduralTextures, type ProceduralTextureSet } from './textures';
import { extractInstancedParts, type AircraftRig, type InstancedMeshPart } from './proceduralModels';
import { AssetManifestManager } from './assetManifest';
import { ForestAudioEngine } from './audio';
import type {
  AssetSlotId,
  FlightSettings,
  FloatingFeedback,
  GamePhase,
  HudSnapshot,
  InputState,
  QualityLevel,
  SceneVariantMode,
} from './types';

const CHUNK_LENGTH = 180;
const TOTAL_CHUNKS = Math.ceil((ROUTE_LENGTH + 240) / CHUNK_LENGTH);
const CHUNKS_BEHIND = 1;
const CHUNKS_AHEAD = 3;

interface ActiveChunk {
  index: number;
  group: THREE.Group;
  waterfalls: THREE.Mesh[];
  disposables: Array<{ dispose: () => void }>;
}

interface LanternVisual {
  id: number;
  group: THREE.Group;
  ringMesh: THREE.Mesh;
  haloSprite: THREE.Sprite;
  lanternNode: THREE.Object3D;
  reflectionSprite: THREE.Sprite;
}

interface ToriiVisual {
  id: number;
  z: number;
  group: THREE.Group;
  materials: THREE.Material[];
  reflectionGroup: THREE.Group;
  opacity: number;
}

interface ShockwaveRing {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  duration: number;
}

interface SparkParticle {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface EngineCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onFeedback: (feedback: FloatingFeedback) => void;
  onCompareSnapshot: (dataUrl: string | null, durationMs: number) => void;
  onCompareError: (message: string) => void;
}

// Pre-allocated scratch math helpers (zero GC inside tick)
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _vecProj = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _colorA = new THREE.Color();
const _colorB = new THREE.Color();
const _colorOut = new THREE.Color();

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function disposeObjectTree(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      if (m.geometry) geos.add(m.geometry);
      if (Array.isArray(m.material)) m.material.forEach((mm) => mats.add(mm));
      else if (m.material) mats.add(m.material);
    }
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
}

export class KomorebiSceneEngine {
  private readonly container: HTMLElement;
  private readonly manifest: AssetManifestManager;
  private readonly audio: ForestAudioEngine;
  private readonly callbacks: EngineCallbacks;
  private readonly isSoftwareGl: boolean;
  private readonly route: WorldRouteData;

  private renderer!: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private textures!: ProceduralTextureSet;

  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private fog!: THREE.FogExp2;
  private skyMat!: THREE.ShaderMaterial;
  private skyDome!: THREE.Mesh;
  private waterUniforms = { uTime: { value: 0 }, uFogColor: { value: new THREE.Color('#98a9a1') } };

  // Aircraft & chase camera state
  private aircraftWrapper = new THREE.Group();
  private aircraftRig!: AircraftRig;
  private aircraftShadow!: THREE.Mesh;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInitialized = false;

  // Scenery & route containers
  private chunkGroup = new THREE.Group();
  private routeEntitiesGroup = new THREE.Group();
  private sanctuaryGroup = new THREE.Group();
  private activeChunks = new Map<number, ActiveChunk>();
  private cedarPartTemplates: InstancedMeshPart[] = [];
  private rockPartTemplates: InstancedMeshPart[] = [];
  private lanternVisuals = new Map<number, LanternVisual>();
  private toriiVisuals: ToriiVisual[] = [];
  private sharedWaterMaterial!: THREE.MeshStandardMaterial;
  private sharedTerrainMaterial!: THREE.MeshStandardMaterial;

  // Pooled particles & effects
  private motesPoints!: THREE.Points;
  private motesBaseOffsets!: Float32Array;
  private sparkPoints!: THREE.Points;
  private sparkPositions!: Float32Array;
  private sparks: SparkParticle[] = [];
  private sparkCursor = 0;
  private shockwaves: ShockwaveRing[] = [];
  private windStreaks!: THREE.LineSegments;
  private windStreakData!: Float32Array;

  // Simulation & loop state
  private sim: FlightSimState;
  private input: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
    boost: false,
    touchX: 0,
    touchY: 0,
  };
  private settings: FlightSettings = {
    flightAssist: true,
    quality: 'high',
    muted: false,
    reducedMotion: false,
  };

  private variantMode: SceneVariantMode = 'baseline';
  private isComparing = false;
  private feedbackCounter = 1;
  private scorePulseKey = 0;

  private frameId = 0;
  private lastTimestamp = 0;
  private lastHudEmit = 0;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private contextLost = false;

  constructor(
    container: HTMLElement,
    manifest: AssetManifestManager,
    audio: ForestAudioEngine,
    callbacks: EngineCallbacks,
    initialSettings: FlightSettings,
  ) {
    this.container = container;
    this.manifest = manifest;
    this.audio = audio;
    this.callbacks = callbacks;
    this.settings = { ...initialSettings };
    this.isSoftwareGl = detectSoftwareGl();
    this.route = getWorldRouteData();
    this.sim = createInitialFlightState();

    this.initRendererAndScene();
    this.initLightingAndAtmosphere();
    this.initSharedMaterials();
    this.initPooledEffects();
    this.buildVariantAssets(this.variantMode);
    this.buildCloudSanctuaryLandmark();
    this.updateStreamingChunks(true);
    this.attachResizeAndContextHandlers();

    // Synchronously position camera & render the opening vista so first paint is never a dark blank canvas
    this.updateVisuals(0.016);
    this.renderScene();
    this.emitHudSnapshot(true);
    this.startLoop();
  }

  public getTextures(): ProceduralTextureSet {
    return this.textures;
  }

  public getVariantMode(): SceneVariantMode {
    return this.variantMode;
  }

  public getPhase(): GamePhase {
    return this.sim.phase;
  }

  private initRendererAndScene(): void {
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.isSoftwareGl,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setSize(width, height);
    this.applyQualityPixelRatio();
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x98a9a1, 1);

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.setAttribute('data-testid', 'komorebi-canvas');
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#98a9a1');
    this.fog = new THREE.FogExp2('#98a9a1', 0.0044);
    this.scene.fog = this.fog;

    // Mandatory Studio PBR Environment reflection via RoomEnvironment on every device
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.4, 520);
    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());

    // Subtle bloom via EffectComposer on GPU only (skipped on software WebGL)
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(Math.floor(width * 0.5), Math.floor(height * 0.5)),
        0.28, // restrained serene glow, never overexposed
        0.55,
        0.84,
      );
      this.composer.addPass(this.bloomPass);
    }

    this.scene.add(this.chunkGroup);
    this.scene.add(this.routeEntitiesGroup);
    this.scene.add(this.sanctuaryGroup);
    this.scene.add(this.aircraftWrapper);
  }

  private initLightingAndAtmosphere(): void {
    // Cool misty sky / mossy earth HemisphereLight fill
    this.hemiLight = new THREE.HemisphereLight(0xd2e2dc, 0x3b4932, 0.96);
    this.scene.add(this.hemiLight);

    // Soft warm sunlight placed outside the forward camera view (raking from rear-left-above)
    this.sunLight = new THREE.DirectionalLight(0xfff0cf, 1.55);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 210;
    const d = 62;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Misty atmospheric gradient sky dome following the aircraft
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTopColor: { value: new THREE.Color(CHAPTERS[0].skyTop) },
        uHorizonColor: { value: new THREE.Color(CHAPTERS[0].skyHorizon) },
        uBottomColor: { value: new THREE.Color('#6f827a') },
      },
      vertexShader: `
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uBottomColor;
        varying vec3 vLocalPos;
        void main() {
          float h = normalize(vLocalPos).y;
          vec3 col = h >= 0.0
            ? mix(uHorizonColor, uTopColor, pow(clamp(h, 0.0, 1.0), 0.65))
            : mix(uHorizonColor, uBottomColor, clamp(-h * 3.0, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(460, 20, 14), this.skyMat);
    this.skyDome.renderOrder = -10;
    this.scene.add(this.skyDome);

    // Soft contact shadow disc gliding directly beneath the aircraft on water/ground
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.textures.contactShadow,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.aircraftShadow = new THREE.Mesh(new THREE.PlaneGeometry(7.8, 5.2), shadowMat);
    this.aircraftShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.aircraftShadow);
  }

  private initSharedMaterials(): void {
    // Deep reflective teal-jade river water matching the reference palette
    this.sharedWaterMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a6663,
      roughness: 0.18,
      metalness: 0.32,
      transparent: true,
      opacity: 0.88,
      envMapIntensity: 1.15,
    });

    this.sharedWaterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           varying vec3 vWaterWorld;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           vec4 wp = modelMatrix * vec4(transformed, 1.0);
           vWaterWorld = wp.xyz;
           transformed.y += sin(wp.x * 0.42 + uTime * 1.45) * 0.055 + cos(wp.z * 0.31 - uTime * 1.15) * 0.055;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           varying vec3 vWaterWorld;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float ripple = sin(vWaterWorld.x * 0.55 + vWaterWorld.z * 0.25 + uTime * 1.3) *
                          cos(vWaterWorld.z * 0.42 - uTime * 0.9);
           float sheen = smoothstep(0.35, 0.95, ripple * 0.5 + 0.5);
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.72, 0.69), sheen * 0.16);`,
        );
    };

    // Mossy forest riverbank terrain with vertex color shading
    this.sharedTerrainMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: this.textures.mossGround,
      roughness: 0.92,
      metalness: 0.02,
    });
  }

  private initPooledEffects(): void {
    // 1. Drifting forest sunlight motes (komorebi dust/pollen around camera)
    const moteCount = 150;
    const motePositions = new Float32Array(moteCount * 3);
    this.motesBaseOffsets = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      this.motesBaseOffsets[i * 3] = (Math.random() - 0.5) * 90;
      this.motesBaseOffsets[i * 3 + 1] = 2 + Math.random() * 26;
      this.motesBaseOffsets[i * 3 + 2] = (Math.random() - 0.5) * 140;
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
    const moteMat = new THREE.PointsMaterial({
      color: 0xf9ebd0,
      map: this.textures.softGlow,
      size: 0.62,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motesPoints = new THREE.Points(moteGeo, moteMat);
    this.motesPoints.frustumCulled = false;
    this.scene.add(this.motesPoints);

    // 2. Pooled pickup burst sparks (96 ring-buffer particles)
    const sparkCount = 96;
    this.sparkPositions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      this.sparkPositions[i * 3 + 1] = -9999;
      this.sparks.push({
        active: false,
        age: 0,
        life: 1,
        x: 0,
        y: -9999,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
      });
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffe4a0,
      map: this.textures.softGlow,
      size: 1.45,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);

    // 3. Pooled expanding shockwave rings (6 reusable golden rings)
    const ringGeo = new THREE.RingGeometry(0.92, 1.0, 32);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf4de9b,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shockwaves.push({
        mesh,
        material: mat,
        active: false,
        age: 0,
        duration: 0.72,
      });
    }

    // 4. Wind-boost air streaks
    const streakCount = 28;
    this.windStreakData = new Float32Array(streakCount * 6);
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(this.windStreakData, 3));
    const streakMat = new THREE.LineBasicMaterial({
      color: 0xf3eee2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.windStreaks = new THREE.LineSegments(streakGeo, streakMat);
    this.windStreaks.frustumCulled = false;
    this.scene.add(this.windStreaks);
  }

  private buildVariantAssets(variant: SceneVariantMode): void {
    // 1. Rebuild Aircraft
    while (this.aircraftWrapper.children.length > 0) {
      const old = this.aircraftWrapper.children[0];
      this.aircraftWrapper.remove(old);
      disposeObjectTree(old);
    }
    this.aircraftRig = this.manifest.buildAircraft(this.textures, variant);
    this.aircraftWrapper.add(this.aircraftRig.root);

    // 2. Rebuild Instanced Templates for Cedar & Rock
    this.cedarPartTemplates.forEach((p) => {
      p.geometry.dispose();
      p.material.dispose();
    });
    this.rockPartTemplates.forEach((p) => {
      p.geometry.dispose();
      p.material.dispose();
    });

    const cedarTemplate = this.manifest.buildCedar(this.textures, variant);
    this.cedarPartTemplates = extractInstancedParts(cedarTemplate);
    disposeObjectTree(cedarTemplate);

    const rockTemplate = this.manifest.buildRock(variant);
    this.rockPartTemplates = extractInstancedParts(rockTemplate);
    disposeObjectTree(rockTemplate);

    // 3. Rebuild Lanterns & Torii Gates along the route
    this.rebuildRouteEntities(variant);
  }

  private rebuildRouteEntities(variant: SceneVariantMode): void {
    while (this.routeEntitiesGroup.children.length > 0) {
      const child = this.routeEntitiesGroup.children[0];
      this.routeEntitiesGroup.remove(child);
      disposeObjectTree(child);
    }
    this.lanternVisuals.clear();
    this.toriiVisuals = [];

    // Shared golden collection ring geometry & breathing material
    const ringGeo = new THREE.TorusGeometry(5.6, 0.14, 10, 44);
    const innerRingGeo = new THREE.TorusGeometry(5.6, 0.34, 8, 44);

    for (const lantern of this.sim.lanterns) {
      const group = new THREE.Group();
      group.position.set(lantern.x, lantern.y, lantern.z);
      group.visible = !lantern.collected;

      // Crisp warm golden oval collection ring
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xf1dc98,
        transparent: true,
        opacity: 0.88,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.scale.set(1.0, 1.08, 1.0); // subtle graceful oval silhouette matching reference
      group.add(ringMesh);

      // Soft outer halo ring
      const softRingMat = new THREE.MeshBasicMaterial({
        color: 0xf5df9d,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const softRing = new THREE.Mesh(innerRingGeo, softRingMat);
      softRing.scale.set(1.0, 1.08, 1.0);
      group.add(softRing);

      // Breathing warm paper halo behind lantern (restrained, never oversized blob)
      const haloMat = new THREE.SpriteMaterial({
        map: this.textures.softGlow,
        color: 0xffe4a1,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const haloSprite = new THREE.Sprite(haloMat);
      haloSprite.scale.set(6.4, 6.4, 1);
      group.add(haloSprite);

      // Spirit lantern model from registry
      const lanternNode = this.manifest.buildLantern('collectible', variant);
      group.add(lanternNode);

      // Soft mirrored glow on the water below the lantern
      const reflMat = new THREE.SpriteMaterial({
        map: this.textures.softGlow,
        color: 0xf0d58c,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      });
      const reflectionSprite = new THREE.Sprite(reflMat);
      reflectionSprite.scale.set(5.2, 2.4, 1);
      reflectionSprite.position.set(0, -lantern.y + 0.15, 0);
      group.add(reflectionSprite);

      this.routeEntitiesGroup.add(group);
      this.lanternVisuals.set(lantern.id, {
        id: lantern.id,
        group,
        ringMesh,
        haloSprite,
        lanternNode,
        reflectionSprite,
      });
    }

    // Build Vermilion Torii Gates + Mirrored River Reflections
    for (const gate of this.sim.toriis) {
      const gateGroup = this.manifest.buildTorii(
        gate.openingHalfWidth,
        gate.lintelBottomY,
        variant,
      );
      gateGroup.position.set(gate.x, WATER_LEVEL, gate.z);
      gateGroup.rotation.y = gate.yaw;

      // Clone materials per gate so passed gates fade out smoothly without affecting upcoming gates
      const gateMaterials: THREE.Material[] = [];
      gateGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m) => {
              const cloned = m.clone();
              cloned.transparent = true;
              cloned.opacity = 1;
              gateMaterials.push(cloned);
              return cloned;
            });
          } else if (mesh.material) {
            const cloned = mesh.material.clone();
            cloned.transparent = true;
            cloned.opacity = 1;
            mesh.material = cloned;
            gateMaterials.push(cloned);
          }
        }
      });

      // Subtle mirrored reflection silhouette directly under the translucent river surface
      const reflGroup = new THREE.Group();
      reflGroup.position.set(gate.x, WATER_LEVEL - 0.12, gate.z);
      reflGroup.rotation.y = gate.yaw;
      const reflMat = new THREE.MeshBasicMaterial({
        color: 0x3f241f,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      });
      // Flat reflection projection along water plane (stretched along -Z/+Z for realistic water shimmer)
      const pillarReflGeo = new THREE.PlaneGeometry(1.7, 17.5);
      for (const side of [-1, 1]) {
        const pRefl = new THREE.Mesh(pillarReflGeo, reflMat);
        pRefl.rotation.x = -Math.PI / 2;
        pRefl.position.set(side * gate.openingHalfWidth, 0, 9.2);
        reflGroup.add(pRefl);
      }
      const beamRefl = new THREE.Mesh(
        new THREE.PlaneGeometry(gate.openingHalfWidth * 2 + 8, 2.2),
        reflMat,
      );
      beamRefl.rotation.x = -Math.PI / 2;
      beamRefl.position.set(0, 0, 17.2);
      reflGroup.add(beamRefl);

      this.routeEntitiesGroup.add(gateGroup);
      this.routeEntitiesGroup.add(reflGroup);

      this.toriiVisuals.push({
        id: gate.id,
        z: gate.z,
        group: gateGroup,
        materials: gateMaterials,
        reflectionGroup: reflGroup,
        opacity: 1,
      });
    }
  }

  /**
   * Builds the Cloud Sanctuary shrine destination at the end of the 3.6 km route.
   */
  private buildCloudSanctuaryLandmark(): void {
    const endDist = ROUTE_LENGTH + 48;
    const cx = riverCenterX(endDist);
    const wz = -endDist;

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5d6661, roughness: 0.88 });
    const timberMat = new THREE.MeshStandardMaterial({ color: 0x35251e, roughness: 0.72 });
    const vermilionMat = new THREE.MeshStandardMaterial({ color: 0xba3e29, roughness: 0.58 });
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x2d3538,
      map: this.textures.roofTiles,
      roughness: 0.56,
      metalness: 0.15,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xfff2cc,
      emissive: new THREE.Color(0xffd786),
      emissiveIntensity: 1.5,
      roughness: 0.4,
    });

    const shrine = new THREE.Group();
    shrine.position.set(cx, 1.0, wz);

    // Grand stepped stone sanctuary island platform
    const plinth1 = new THREE.Mesh(new THREE.CylinderGeometry(28, 34, 6, 16), stoneMat);
    plinth1.position.y = 0;
    shrine.add(plinth1);

    const plinth2 = new THREE.Mesh(new THREE.CylinderGeometry(20, 23, 3.2, 16), stoneMat);
    plinth2.position.y = 4.5;
    shrine.add(plinth2);

    // Shrine hall body
    const hall = new THREE.Mesh(new THREE.BoxGeometry(19, 8.5, 14), timberMat);
    hall.position.y = 10.2;
    shrine.add(hall);

    const sanctuaryWindow = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.6), glowMat);
    sanctuaryWindow.position.set(0, 9.6, 7.05);
    shrine.add(sanctuaryWindow);

    // Vermilion veranda columns
    for (let i = -3; i <= 3; i++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 8.5, 8), vermilionMat);
      col.position.set(i * 3.1, 10.2, 8.2);
      shrine.add(col);
    }

    // Sweeping two-tier sanctuary pagoda roof
    const lowerRoof = new THREE.Mesh(new THREE.ConeGeometry(19.5, 6.2, 4), roofMat);
    lowerRoof.rotation.y = Math.PI / 4;
    lowerRoof.scale.set(1.22, 1, 0.94);
    lowerRoof.position.y = 17.2;
    shrine.add(lowerRoof);

    const upperRoof = new THREE.Mesh(new THREE.ConeGeometry(12.2, 5.4, 4), roofMat);
    upperRoof.rotation.y = Math.PI / 4;
    upperRoof.scale.set(1.18, 1, 0.92);
    upperRoof.position.y = 22.8;
    shrine.add(upperRoof);

    // Sanctuary warm lantern beacons flanking the steps
    for (const side of [-1, 1]) {
      const beacon = this.manifest.buildLantern('collectible', this.variantMode);
      beacon.scale.setScalar(1.3);
      beacon.position.set(side * 12, 8.5, 13.5);
      shrine.add(beacon);
    }

    this.sanctuaryGroup.add(shrine);
  }

  private buildChunk(chunkIndex: number): ActiveChunk {
    const startDist = chunkIndex * CHUNK_LENGTH - 60;
    const endDist = startDist + CHUNK_LENGTH;
    const group = new THREE.Group();
    const disposables: Array<{ dispose: () => void }> = [];
    const waterfalls: THREE.Mesh[] = [];

    // 1. Sculpted continuous terrain ribbon spanning [-125 .. +125] laterally from river center
    const segZ = 22;
    const segX = 28;
    const halfSpanX = 128;
    const positions = new Float32Array((segZ + 1) * (segX + 1) * 3);
    const colors = new Float32Array((segZ + 1) * (segX + 1) * 3);
    const uvs = new Float32Array((segZ + 1) * (segX + 1) * 2);
    const indices: number[] = [];

    const colBankWet = new THREE.Color('#353f29');
    const colMoss = new THREE.Color('#495334');
    const colHill = new THREE.Color('#3a4831');
    const colMountain = new THREE.Color('#51665e');

    let vIdx = 0;
    for (let iz = 0; iz <= segZ; iz++) {
      const tZ = iz / segZ;
      const dist = startDist + tZ * CHUNK_LENGTH;
      const wz = -dist;
      const cx = riverCenterX(dist);
      const halfW = riverHalfWidthAt(dist);

      for (let ix = 0; ix <= segX; ix++) {
        const u = ix / segX;
        // Denser sampling near the riverbanks for crisp gentle slopes, wider at foothills
        const signed = (u - 0.5) * 2;
        const shaped = Math.sign(signed) * Math.pow(Math.abs(signed), 1.32);
        const wx = cx + shaped * halfSpanX;
        const wy = groundHeightAt(wx, wz);

        positions[vIdx * 3] = wx;
        positions[vIdx * 3 + 1] = wy;
        positions[vIdx * 3 + 2] = wz;

        uvs[vIdx * 2] = wx * 0.03;
        uvs[vIdx * 2 + 1] = wz * 0.03;

        const bankDist = Math.abs(wx - cx) - halfW;
        if (bankDist < 3) {
          _colorOut.copy(colBankWet);
        } else if (wy < 7.5) {
          _colorOut.copy(colMoss).lerp(colHill, Math.min(1, (wy - 1.5) / 6));
        } else {
          _colorOut.copy(colHill).lerp(colMountain, Math.min(1, (wy - 7.5) / 26));
        }
        colors[vIdx * 3] = _colorOut.r;
        colors[vIdx * 3 + 1] = _colorOut.g;
        colors[vIdx * 3 + 2] = _colorOut.b;
        vIdx++;
      }
    }

    for (let iz = 0; iz < segZ; iz++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = iz * (segX + 1) + ix;
        const b = a + 1;
        const c = a + (segX + 1);
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    const terrainGeo = new THREE.BufferGeometry();
    terrainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    terrainGeo.setIndex(indices);
    terrainGeo.computeVertexNormals();
    disposables.push(terrainGeo);

    const terrainMesh = new THREE.Mesh(terrainGeo, this.sharedTerrainMaterial);
    terrainMesh.receiveShadow = true;
    group.add(terrainMesh);

    // 2. Curved Reflective River Water Ribbon following riverCenterX(dist)
    const wSegZ = 18;
    const wPos = new Float32Array((wSegZ + 1) * 2 * 3);
    const wUv = new Float32Array((wSegZ + 1) * 2 * 2);
    const wIdx: number[] = [];
    for (let iz = 0; iz <= wSegZ; iz++) {
      const dist = startDist + (iz / wSegZ) * CHUNK_LENGTH;
      const wz = -dist;
      const cx = riverCenterX(dist);
      const wHalf = riverHalfWidthAt(dist) + 4.5;

      const base = iz * 2;
      wPos[base * 3] = cx - wHalf;
      wPos[base * 3 + 1] = WATER_LEVEL;
      wPos[base * 3 + 2] = wz;
      wUv[base * 2] = 0;
      wUv[base * 2 + 1] = dist * 0.04;

      wPos[(base + 1) * 3] = cx + wHalf;
      wPos[(base + 1) * 3 + 1] = WATER_LEVEL;
      wPos[(base + 1) * 3 + 2] = wz;
      wUv[(base + 1) * 2] = 1;
      wUv[(base + 1) * 2 + 1] = dist * 0.04;

      if (iz < wSegZ) {
        wIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const waterGeo = new THREE.BufferGeometry();
    waterGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
    waterGeo.setAttribute('uv', new THREE.BufferAttribute(wUv, 2));
    waterGeo.setIndex(wIdx);
    waterGeo.computeVertexNormals();
    disposables.push(waterGeo);

    const waterMesh = new THREE.Mesh(waterGeo, this.sharedWaterMaterial);
    waterMesh.receiveShadow = true;
    group.add(waterMesh);

    // 3. Soft Layered Misty Mountain Hills framing the distant horizon behind the cedar forest
    const ridgeMat = new THREE.MeshStandardMaterial({
      color: 0x5c726b,
      roughness: 0.96,
      metalness: 0.0,
    });
    disposables.push(ridgeMat);

    for (const side of [-1, 1]) {
      const midDist = startDist + CHUNK_LENGTH * 0.5;
      const cx = riverCenterX(midDist);
      const peakH = 58 + ((chunkIndex * 19 + (side > 0 ? 11 : 0)) % 28);
      const peakR = 88 + ((chunkIndex * 13) % 20);
      const hillGeo = new THREE.SphereGeometry(peakR, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
      disposables.push(hillGeo);
      const hill = new THREE.Mesh(hillGeo, ridgeMat);
      hill.scale.set(0.85, peakH / peakR, 1.9);
      hill.position.set(cx + side * (210 + ((chunkIndex * 7) % 24)), -4, -midDist);
      group.add(hill);
    }

    // 4. Instanced Japanese Cedars in this chunk
    const chunkCedars = this.route.cedars.filter((c) => {
      const d = -c.z;
      return d >= startDist && d < endDist;
    });

    if (chunkCedars.length > 0) {
      for (const part of this.cedarPartTemplates) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, chunkCedars.length);
        inst.castShadow = !this.isSoftwareGl && this.settings.quality === 'high';
        inst.receiveShadow = true;

        for (let i = 0; i < chunkCedars.length; i++) {
          const c = chunkCedars[i];
          _euler.set(0, c.yaw, 0);
          _quat.setFromEuler(_euler);
          _scale.set(c.scale, c.scale * (0.94 + c.tint * 0.16), c.scale);
          _mat4.compose(_vecA.set(c.x, c.y, c.z), _quat, _scale);
          inst.setMatrixAt(i, _mat4);
          // Subtle natural color variation across foliage & trunks
          _colorA.setRGB(0.88 + c.tint * 0.2, 0.9 + c.tint * 0.16, 0.88 + c.tint * 0.14);
          inst.setColorAt(i, _colorA);
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.computeBoundingSphere();
        group.add(inst);
      }

      // Subtle reflected cedar canopy shadows in the translucent water near shorelines
      const bankTrees = chunkCedars.filter((c) => {
        const d = -c.z;
        const halfW = riverHalfWidthAt(d);
        return Math.abs(c.x - riverCenterX(d)) < halfW + 14;
      });
      if (bankTrees.length > 0) {
        const reflPlaneGeo = new THREE.PlaneGeometry(7.2, 16.5);
        const reflTreeMat = new THREE.MeshBasicMaterial({
          map: this.textures.contactShadow,
          color: 0x162a24,
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
        });
        disposables.push(reflPlaneGeo, reflTreeMat);
        const reflInst = new THREE.InstancedMesh(reflPlaneGeo, reflTreeMat, bankTrees.length);
        for (let i = 0; i < bankTrees.length; i++) {
          const c = bankTrees[i];
          const cx = riverCenterX(-c.z);
          const dirToRiver = cx > c.x ? 1 : -1;
          _euler.set(-Math.PI / 2, 0, 0);
          _quat.setFromEuler(_euler);
          _scale.set(c.scale * 0.85, c.scale * 0.95, 1);
          _mat4.compose(
            _vecA.set(c.x + dirToRiver * 8.5, WATER_LEVEL - 0.08, c.z),
            _quat,
            _scale,
          );
          reflInst.setMatrixAt(i, _mat4);
        }
        reflInst.instanceMatrix.needsUpdate = true;
        reflInst.computeBoundingSphere();
        group.add(reflInst);
      }
    }

    // 5. Instanced Rounded Mossy River Rocks in this chunk
    const chunkRocks = this.route.rocks.filter((r) => {
      const d = -r.z;
      return d >= startDist && d < endDist;
    });

    if (chunkRocks.length > 0) {
      for (const part of this.rockPartTemplates) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, chunkRocks.length);
        inst.receiveShadow = true;
        for (let i = 0; i < chunkRocks.length; i++) {
          const r = chunkRocks[i];
          _euler.set(0, r.yaw, 0);
          _quat.setFromEuler(_euler);
          _scale.set(r.scaleX, r.scaleY, r.scaleZ);
          _mat4.compose(_vecA.set(r.x, r.y, r.z), _quat, _scale);
          inst.setMatrixAt(i, _mat4);
          _colorA.setRGB(0.86 + r.tint * 0.24, 0.9 + r.tint * 0.2, 0.86 + r.tint * 0.18);
          inst.setColorAt(i, _colorA);
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        inst.computeBoundingSphere();
        group.add(inst);
      }
    }

    // 6. Terraced Minka Houses grounded on their level hillocks
    const chunkHouses = this.route.houses.filter((h) => {
      const d = -h.z;
      return d >= startDist && d < endDist;
    });
    for (const h of chunkHouses) {
      const house = this.manifest.buildMinka(this.textures, this.variantMode);
      house.position.set(h.x, h.y, h.z);
      house.rotation.y = h.yaw;
      house.scale.setScalar(h.scale);
      group.add(house);

      // Soft contact shadow around house base
      const cShadGeo = new THREE.PlaneGeometry(13.5 * h.scale, 11.2 * h.scale);
      const cShadMat = new THREE.MeshBasicMaterial({
        map: this.textures.contactShadow,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      });
      disposables.push(cShadGeo, cShadMat);
      const cShad = new THREE.Mesh(cShadGeo, cShadMat);
      cShad.rotation.x = -Math.PI / 2;
      cShad.rotation.z = -h.yaw;
      cShad.position.set(h.x, h.y + 0.04, h.z);
      group.add(cShad);
    }

    // 7. Decorative Bank Lanterns (smaller, grounded on timber posts, visibly distinct from collectibles)
    const chunkDecoLanterns = this.route.decorativeLanterns.filter((dl) => {
      const d = -dl.z;
      return d >= startDist && d < endDist;
    });
    if (chunkDecoLanterns.length > 0) {
      const postGeo = new THREE.CylinderGeometry(0.11, 0.14, 3.2, 6);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x2c241e, roughness: 0.85 });
      disposables.push(postGeo, postMat);

      for (const dl of chunkDecoLanterns) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(dl.x, dl.y - 1.5, dl.z);
        group.add(post);

        const lantern = this.manifest.buildLantern('decorative', this.variantMode);
        lantern.scale.setScalar(dl.scale * 1.45);
        lantern.position.set(dl.x, dl.y + 0.3, dl.z);
        group.add(lantern);
      }
    }

    // 8. Animated Waterfalls (Hidden Falls & Sanctuary)
    const chunkFalls = this.route.waterfalls.filter((wf) => {
      const d = -wf.z;
      return d >= startDist && d < endDist;
    });
    for (const wf of chunkFalls) {
      // Rounded mossy cliff outcrop behind waterfall (avoid angular rock walls)
      const cliffGeo = new THREE.DodecahedronGeometry(wf.width * 1.35, 2);
      const cliffMat = new THREE.MeshStandardMaterial({
        color: 0x45534a,
        roughness: 0.92,
      });
      disposables.push(cliffGeo, cliffMat);
      const cliff = new THREE.Mesh(cliffGeo, cliffMat);
      cliff.scale.set(1.0, wf.topY / (wf.width * 1.15), 0.85);
      cliff.position.set(wf.x + wf.side * 5.2, wf.topY * 0.45, wf.z);
      group.add(cliff);

      // Flowing translucent waterfall sheet
      const sheetTex = this.textures.waterfallFlow.clone();
      sheetTex.needsUpdate = true;
      const sheetGeo = new THREE.PlaneGeometry(wf.width, wf.topY);
      const sheetMat = new THREE.MeshBasicMaterial({
        map: sheetTex,
        color: 0xe3f2ef,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      disposables.push(sheetTex, sheetGeo, sheetMat);

      const sheet = new THREE.Mesh(sheetGeo, sheetMat);
      sheet.position.set(wf.x - wf.side * 0.8, wf.topY * 0.48, wf.z);
      sheet.rotation.y = wf.side === 1 ? -Math.PI * 0.42 : Math.PI * 0.42;
      group.add(sheet);
      waterfalls.push(sheet);

      // Base splash mist sprite
      const mistMat = new THREE.SpriteMaterial({
        map: this.textures.softGlow,
        color: 0xdcece9,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
      });
      disposables.push(mistMat);
      const mist = new THREE.Sprite(mistMat);
      mist.scale.set(wf.width * 2.1, wf.width * 1.25, 1);
      mist.position.set(wf.x - wf.side * 2.2, WATER_LEVEL + 2.4, wf.z);
      group.add(mist);
    }

    this.chunkGroup.add(group);
    return {
      index: chunkIndex,
      group,
      waterfalls,
      disposables,
    };
  }

  private disposeChunk(chunk: ActiveChunk): void {
    this.chunkGroup.remove(chunk.group);
    chunk.disposables.forEach((d) => d.dispose());
    // Dispose any cloned Minka/lantern child meshes inside the chunk
    chunk.group.traverse((child) => {
      if ((child as THREE.InstancedMesh).isInstancedMesh) {
        // Shared template geometry/materials belong to cedarPartTemplates/rockPartTemplates
        return;
      }
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (
          mesh.material !== this.sharedTerrainMaterial &&
          mesh.material !== this.sharedWaterMaterial
        ) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
          else mesh.material?.dispose();
        }
      }
    });
  }

  private updateStreamingChunks(forceRebuild = false): void {
    if (forceRebuild) {
      this.activeChunks.forEach((chunk) => this.disposeChunk(chunk));
      this.activeChunks.clear();
    }

    const currentChunk = Math.max(0, Math.floor((this.sim.dist + 60) / CHUNK_LENGTH));
    const minChunk = Math.max(0, currentChunk - CHUNKS_BEHIND);
    const maxChunk = Math.min(TOTAL_CHUNKS, currentChunk + CHUNKS_AHEAD);

    // Recycle chunks out of active sliding window
    for (const [idx, chunk] of this.activeChunks.entries()) {
      if (idx < minChunk || idx > maxChunk) {
        this.disposeChunk(chunk);
        this.activeChunks.delete(idx);
      }
    }

    // Build newly entering chunks
    for (let idx = minChunk; idx <= maxChunk; idx++) {
      if (!this.activeChunks.has(idx)) {
        this.activeChunks.set(idx, this.buildChunk(idx));
      }
    }
  }

  private spawnPickupEffects(x: number, y: number, z: number): void {
    // 1. Expanding golden shockwave ring
    const ring = this.shockwaves.find((r) => !r.active) || this.shockwaves[0];
    ring.active = true;
    ring.age = 0;
    ring.mesh.position.set(x, y, z);
    ring.mesh.scale.setScalar(5.5);
    ring.mesh.visible = true;
    ring.material.opacity = 0.9;

    // 2. Burst of 24 pooled warm gold particles
    for (let i = 0; i < 24; i++) {
      const p = this.sparks[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % this.sparks.length;
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.5) * Math.PI;
      const spd = 4.5 + Math.random() * 8.5;
      p.active = true;
      p.age = 0;
      p.life = 0.65 + Math.random() * 0.45;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(theta) * Math.cos(phi) * spd;
      p.vy = Math.sin(phi) * spd + 1.8;
      p.vz = Math.sin(theta) * Math.cos(phi) * spd;
    }
  }

  private handleSimEvents(events: SimEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'lantern') {
        this.scorePulseKey += 1;
        this.audio.playLanternChime();
        this.spawnPickupEffects(ev.x, ev.y, ev.z);
        this.callbacks.onFeedback({
          id: this.feedbackCounter++,
          text: '+100 · Lantern collected',
          accent: 'gold',
        });
      } else if (ev.type === 'torii') {
        this.scorePulseKey += 1;
        this.audio.playToriiBell();
        this.spawnPickupEffects(ev.x, ev.y, ev.z);
        this.callbacks.onFeedback({
          id: this.feedbackCounter++,
          text: '+250 · Torii gate cleared',
          accent: 'vermilion',
        });
      } else if (ev.type === 'damage') {
        this.audio.playDamageThud();
        const label =
          ev.reason === 'torii'
            ? 'Gate brush · 1 heart lost'
            : ev.reason === 'bank'
              ? 'Forest bank graze · 1 heart lost'
              : 'River skim · 1 heart lost';
        this.callbacks.onFeedback({
          id: this.feedbackCounter++,
          text: label,
          accent: 'vermilion',
        });
      } else if (ev.type === 'victory') {
        this.audio.playSanctuaryChord();
        this.audio.updateFlightLoops(false, 0, false);
        this.emitHudSnapshot(true);
      } else if (ev.type === 'defeat') {
        this.audio.updateFlightLoops(false, 0, false);
        this.emitHudSnapshot(true);
      }
    }
  }

  private updateAtmosphereForDistance(): void {
    const clamped = Math.max(0, Math.min(ROUTE_LENGTH, this.sim.dist));
    const exactIdx = (clamped / ROUTE_LENGTH) * (CHAPTERS.length - 1);
    const i0 = Math.min(CHAPTERS.length - 1, Math.floor(exactIdx));
    const i1 = Math.min(CHAPTERS.length - 1, i0 + 1);
    const frac = exactIdx - i0;

    const c0 = CHAPTERS[i0];
    const c1 = CHAPTERS[i1];

    _colorA.set(c0.fogColor);
    _colorB.set(c1.fogColor);
    _colorOut.copy(_colorA).lerp(_colorB, frac);
    this.fog.color.copy(_colorOut);
    this.scene.background = _colorOut;
    this.renderer.setClearColor(_colorOut, 1);

    _colorA.set(c0.skyTop);
    _colorB.set(c1.skyTop);
    this.skyMat.uniforms.uTopColor.value.copy(_colorA).lerp(_colorB, frac);

    _colorA.set(c0.skyHorizon);
    _colorB.set(c1.skyHorizon);
    this.skyMat.uniforms.uHorizonColor.value.copy(_colorA).lerp(_colorB, frac);

    _colorA.set(c0.sunColor);
    _colorB.set(c1.sunColor);
    this.sunLight.color.copy(_colorA).lerp(_colorB, frac);
  }

  private updateVisuals(dt: number): void {
    const t = this.sim.simTime;
    this.waterUniforms.uTime.value = t;

    // 1. Update Aircraft transform & twin counter-rotating pusher propellers
    this.aircraftWrapper.position.set(this.sim.x, this.sim.y, this.sim.z);
    this.aircraftWrapper.rotation.set(this.sim.pitch, this.sim.yaw, this.sim.roll, 'YXZ');

    // Subtle shimmer while invulnerable after collision
    if (this.sim.invulnTimer > 0) {
      const blink = Math.sin(t * 28) > -0.35;
      this.aircraftWrapper.visible = blink;
    } else {
      this.aircraftWrapper.visible = true;
    }

    // Rotate the two pusher propellers using delta time
    const propRpm = this.sim.isBoosting ? 29.0 : this.sim.phase === 'playing' ? 20.5 : 14.0;
    if (this.aircraftRig) {
      this.aircraftRig.leftPropeller.rotation.z += propRpm * dt;
      this.aircraftRig.rightPropeller.rotation.z -= propRpm * dt;
    }

    // Contact shadow directly beneath the aircraft on the river/terrain
    const shadowFloorY = Math.max(WATER_LEVEL, groundHeightAt(this.sim.x, this.sim.z));
    this.aircraftShadow.position.set(this.sim.x, shadowFloorY + 0.08, this.sim.z);
    this.aircraftShadow.rotation.z = -this.sim.yaw;
    const altAbove = Math.max(0, this.sim.y - shadowFloorY);
    const shadowScale = 1 + altAbove * 0.035;
    this.aircraftShadow.scale.set(shadowScale, shadowScale, 1);
    (this.aircraftShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(
      0.12,
      0.44 - altAbove * 0.015,
    );

    // 2. Follow sun & sky dome with aircraft (sun stays outside forward view at rear-left-above)
    this.skyDome.position.set(this.sim.x, 0, this.sim.z);
    this.sunLight.position.set(this.sim.x - 56, 78, this.sim.z + 44);
    this.sunLight.target.position.set(this.sim.x, 4, this.sim.z - 28);
    this.sunLight.target.updateMatrixWorld();

    // 3. Smooth Rear Chase Camera with exponential damping, framing plane + next collectible over its wings
    const chaseDist = this.sim.phase === 'title' ? 14.2 : 12.8;
    const chaseHeight = this.sim.phase === 'title' ? 5.1 : 4.65;
    const desiredCamX = this.sim.x - Math.sin(this.sim.yaw) * chaseDist * 0.45;
    const desiredCamY = Math.max(WATER_LEVEL + 3.2, this.sim.y + chaseHeight);
    const desiredCamZ = this.sim.z + chaseDist;

    const desiredLookX = this.sim.x + Math.sin(-this.sim.yaw) * 14;
    const desiredLookY = this.sim.y + 1.15;
    const desiredLookZ = this.sim.z - 34;

    if (!this.camInitialized) {
      this.camPos.set(desiredCamX, desiredCamY, desiredCamZ);
      this.camLook.set(desiredLookX, desiredLookY, desiredLookZ);
      this.camInitialized = true;
    } else {
      const kPos = 1 - Math.exp(-5.4 * dt);
      const kLook = 1 - Math.exp(-6.8 * dt);
      this.camPos.x += (desiredCamX - this.camPos.x) * kPos;
      this.camPos.y += (desiredCamY - this.camPos.y) * kPos;
      this.camPos.z += (desiredCamZ - this.camPos.z) * kPos;

      this.camLook.x += (desiredLookX - this.camLook.x) * kLook;
      this.camLook.y += (desiredLookY - this.camLook.y) * kLook;
      this.camLook.z += (desiredLookZ - this.camLook.z) * kLook;
    }

    // Subtle decaying trauma shake on impact
    const shake = this.sim.cameraTrauma * this.sim.cameraTrauma * 0.55;
    const shakeX = shake > 0.001 ? Math.sin(t * 47) * shake : 0;
    const shakeY = shake > 0.001 ? Math.cos(t * 53) * shake * 0.8 : 0;

    this.camera.position.set(this.camPos.x + shakeX, this.camPos.y + shakeY, this.camPos.z);
    this.camera.lookAt(this.camLook);

    // Subtle FOV widening on wind boost + portrait-aware framing so Wright Flyer wings never clip on phones
    const portraitBoost = this.camera.aspect < 0.85 ? 15.0 : this.camera.aspect < 1.1 ? 7.0 : 0;
    const targetFov = (this.sim.isBoosting ? 57.5 : 50.0) + portraitBoost;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-5.0 * dt));
      this.camera.updateProjectionMatrix();
    }

    // 4. Animate Collectible Lanterns (bobbing, breathing golden rings, slow rotation)
    for (let i = 0; i < this.sim.lanterns.length; i++) {
      const l = this.sim.lanterns[i];
      const vis = this.lanternVisuals.get(l.id);
      if (!vis) continue;

      const dz = this.sim.z - l.z; // positive when ahead of plane
      const inRange = !l.collected && dz > -30 && dz < 360;
      vis.group.visible = inRange;
      if (!inRange) continue;

      const animY = getAnimatedLanternY(l, t);
      vis.group.position.set(l.x, animY, l.z);

      const breathe = 1 + Math.sin(t * 2.6 + l.phaseOffset) * 0.045;
      vis.ringMesh.scale.set(breathe, breathe * 1.08, 1);
      vis.haloSprite.scale.set(6.2 * breathe, 6.2 * breathe, 1);
      vis.lanternNode.rotation.y = t * 0.65 + l.phaseOffset;
      vis.reflectionSprite.position.y = -animY + 0.14;
    }

    // 5. Fade passed Torii Gates smoothly BEFORE they can obscure the rear chase camera
    for (let i = 0; i < this.toriiVisuals.length; i++) {
      const tv = this.toriiVisuals[i];
      // Positive when gate is ahead of camera, shrinks as gate approaches camera plane
      const distAheadOfCamera = this.camera.position.z - tv.z;
      let targetOpacity = 1.0;
      if (distAheadOfCamera < 16) {
        // Begin fading right as aircraft clears the gate so rear chase camera stays 100% unobstructed
        targetOpacity = Math.max(0, Math.min(1, (distAheadOfCamera - 5.5) / 10.5));
      }
      tv.opacity += (targetOpacity - tv.opacity) * (1 - Math.exp(-12 * dt));
      tv.group.visible = tv.opacity > 0.02 && distAheadOfCamera > -15 && distAheadOfCamera < 420;
      tv.reflectionGroup.visible = tv.group.visible;
      if (tv.group.visible) {
        for (let m = 0; m < tv.materials.length; m++) {
          tv.materials[m].opacity = tv.opacity;
        }
      }
    }

    // 6. Scroll waterfall foam textures
    this.activeChunks.forEach((chunk) => {
      for (let i = 0; i < chunk.waterfalls.length; i++) {
        const mat = chunk.waterfalls[i].material as THREE.MeshBasicMaterial;
        if (mat.map) {
          mat.map.offset.y += dt * 0.85;
        }
      }
    });

    // 7. Update drifting forest sunlight motes around aircraft
    const moteAttr = this.motesPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const moteArr = moteAttr.array as Float32Array;
    const moteCount = moteArr.length / 3;
    for (let i = 0; i < moteCount; i++) {
      const bx = this.motesBaseOffsets[i * 3];
      const by = this.motesBaseOffsets[i * 3 + 1];
      const bz = this.motesBaseOffsets[i * 3 + 2];
      // Wrap Z cleanly around aircraft
      const relZ = ((((bz - this.sim.z) % 140) + 140) % 140) - 115;
      moteArr[i * 3] = this.sim.x + bx + Math.sin(t * 0.7 + i) * 1.4;
      moteArr[i * 3 + 1] = by + Math.cos(t * 0.9 + i * 0.7) * 0.8;
      moteArr[i * 3 + 2] = this.sim.z + relZ;
    }
    moteAttr.needsUpdate = true;

    // 8. Update pooled pickup burst sparks
    let sparksDirty = false;
    for (let i = 0; i < this.sparks.length; i++) {
      const p = this.sparks[i];
      if (!p.active) continue;
      sparksDirty = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.sparkPositions[i * 3 + 1] = -9999;
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy -= 4.2 * dt;
        this.sparkPositions[i * 3] = p.x;
        this.sparkPositions[i * 3 + 1] = p.y;
        this.sparkPositions[i * 3 + 2] = p.z;
      }
    }
    if (sparksDirty) {
      (this.sparkPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // 9. Update pooled expanding shockwave rings
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) continue;
      sw.age += dt;
      if (sw.age >= sw.duration) {
        sw.active = false;
        sw.mesh.visible = false;
      } else {
        const progress = sw.age / sw.duration;
        const ease = 1 - Math.pow(1 - progress, 3);
        sw.mesh.scale.setScalar(5.6 + ease * 8.5);
        sw.material.opacity = (1 - progress) * 0.85;
      }
    }

    // 10. Wind-boost streaks
    const streakMat = this.windStreaks.material as THREE.LineBasicMaterial;
    const targetStreakOpacity = this.sim.isBoosting ? 0.36 : 0;
    streakMat.opacity += (targetStreakOpacity - streakMat.opacity) * (1 - Math.exp(-8 * dt));
    if (streakMat.opacity > 0.01) {
      const sCount = this.windStreakData.length / 6;
      for (let i = 0; i < sCount; i++) {
        const angle = (i / sCount) * Math.PI * 2;
        const rad = 4.6 + (i % 5) * 1.65;
        const zPhase = (((t * 58 + i * 7.3) % 34) - 24);
        const sx = this.sim.x + Math.cos(angle) * rad;
        const sy = this.sim.y + Math.sin(angle) * rad * 0.55;
        const sz = this.sim.z + zPhase;
        this.windStreakData[i * 6] = sx;
        this.windStreakData[i * 6 + 1] = sy;
        this.windStreakData[i * 6 + 2] = sz;
        this.windStreakData[i * 6 + 3] = sx;
        this.windStreakData[i * 6 + 4] = sy;
        this.windStreakData[i * 6 + 5] = sz + 3.6;
      }
      (this.windStreaks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    this.updateAtmosphereForDistance();
  }

  private renderScene(): void {
    if (this.contextLost) return;
    if (this.composer && !this.isSoftwareGl && this.settings.quality !== 'low') {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.destroyed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private startLoop(): void {
    this.lastTimestamp = performance.now();
    const tick = () => {
      if (this.destroyed) return;
      const now = performance.now();
      const rawDt = (now - this.lastTimestamp) / 1000;
      this.lastTimestamp = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

      if (!this.isComparing) {
        const events = stepFlightSimulation(
          this.sim,
          this.input,
          dt,
          this.settings.flightAssist,
        );
        if (events.length > 0) {
          this.handleSimEvents(events);
        }
        this.updateStreamingChunks(false);
        this.updateVisuals(dt);

        const speedRatio = Math.max(0, (this.sim.speed - BASE_SPEED) / 16);
        this.audio.updateFlightLoops(
          this.sim.phase === 'playing',
          speedRatio,
          this.sim.isBoosting,
        );
      }

      this.renderScene();

      // Throttle React HUD updates (~14Hz) so simulation never stalls React reconciliation
      if (now - this.lastHudEmit >= 70) {
        this.lastHudEmit = now;
        this.emitHudSnapshot(false);
      }

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.frameId = window.setTimeout(tick, 16);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private computeNearestTargetScreen(): HudSnapshot['nearestTarget'] {
    if (this.sim.phase !== 'playing') {
      return { visible: false, x: 0, y: 0, distance: 0, id: -1 };
    }
    const nearest = findNearestUpcomingLantern(this.sim);
    if (!nearest) {
      return { visible: false, x: 0, y: 0, distance: 0, id: -1 };
    }
    const animY = getAnimatedLanternY(nearest, this.sim.simTime);
    _vecProj.set(nearest.x + 6.4, animY + 0.6, nearest.z);
    _vecProj.project(this.camera);

    // Guard 3D world-to-screen projection with v.z >= -1 && v.z <= 1
    if (_vecProj.z < -1 || _vecProj.z > 1) {
      return { visible: false, x: 0, y: 0, distance: 0, id: nearest.id };
    }

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const px = (_vecProj.x * 0.5 + 0.5) * w;
    const py = (-_vecProj.y * 0.5 + 0.5) * h;

    const clampedX = Math.max(120, Math.min(w - 140, px));
    const clampedY = Math.max(110, Math.min(h - 140, py));

    return {
      visible: true,
      x: Math.round(clampedX),
      y: Math.round(clampedY),
      distance: Math.round(-nearest.z - this.sim.dist),
      id: nearest.id,
    };
  }

  private emitHudSnapshot(force: boolean): void {
    if (force) this.lastHudEmit = performance.now();
    const { chapter, progressPercent } = getChapterProgress(this.sim.dist);
    const snapshot: HudSnapshot = {
      phase: this.sim.phase,
      score: this.sim.score,
      bestScore: this.sim.bestScore,
      hearts: this.sim.hearts,
      maxHearts: MAX_HEARTS,
      invulnerable: this.sim.invulnTimer > 0,
      lanternsCollected: this.sim.lanternsCollected,
      gatesCleared: this.sim.gatesCleared,
      distanceMeters: Math.round(this.sim.dist),
      routeLength: ROUTE_LENGTH,
      altitudeMeters: Math.max(0, Math.round(this.sim.y)),
      airspeedKmh: Math.round(this.sim.speed * 3.6),
      boostPercent: Math.round(this.sim.boost),
      isBoosting: this.sim.isBoosting,
      headingDeg: Math.round(getCompassHeadingDegrees(this.sim.yaw)),
      chapterIndex: chapter.index,
      chapterProgressPercent: progressPercent,
      nearestTarget: this.computeNearestTargetScreen(),
      scorePulseKey: this.scorePulseKey,
      variantMode: this.variantMode,
      isComparing: this.isComparing,
      importedSlotCount: this.manifest.getImportedCount(),
      damageFlash: this.sim.damageFlash,
      summary: this.sim.summary,
    };
    this.callbacks.onHudUpdate(snapshot);
  }

  private applyQualityPixelRatio(): void {
    if (this.isSoftwareGl) {
      this.renderer.setPixelRatio(1);
      return;
    }
    const maxDpr =
      this.settings.quality === 'low' ? 1 : this.settings.quality === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  }

  private attachResizeAndContextHandlers(): void {
    const handleResize = () => {
      if (this.destroyed) return;
      const w = Math.max(1, this.container.clientWidth || window.innerWidth);
      const h = Math.max(1, this.container.clientHeight || window.innerHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.applyQualityPixelRatio();
      if (this.composer) {
        this.composer.setSize(w, h);
      }
      if (this.bloomPass) {
        this.bloomPass.resolution.set(Math.floor(w * 0.5), Math.floor(h * 0.5));
      }
      this.updateVisuals(0.001);
      this.renderScene();
    };

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(handleResize);
      this.resizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', handleResize);
    }

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.renderScene();
    });
  }

  // ---- Public Control API ----

  public beginFlight(): void {
    this.audio.unlock();
    resetForNewRun(this.sim);
    this.camInitialized = false;
    this.rebuildRouteEntities(this.variantMode);
    this.updateStreamingChunks(true);
    this.updateVisuals(0.016);
    this.emitHudSnapshot(true);
  }

  public setPaused(paused: boolean): void {
    if (paused && this.sim.phase === 'playing') {
      this.sim.phase = 'paused';
      this.audio.updateFlightLoops(false, 0, false);
      this.emitHudSnapshot(true);
    } else if (!paused && this.sim.phase === 'paused') {
      this.sim.phase = 'playing';
      this.lastTimestamp = performance.now();
      this.emitHudSnapshot(true);
    }
  }

  public returnToTitle(): void {
    this.sim = createInitialFlightState();
    this.camInitialized = false;
    this.audio.updateFlightLoops(false, 0, false);
    this.rebuildRouteEntities(this.variantMode);
    this.updateStreamingChunks(true);
    this.emitHudSnapshot(true);
  }

  public setInput(patch: Partial<InputState>): void {
    Object.assign(this.input, patch);
  }

  public clearInputs(): void {
    this.input.up = false;
    this.input.down = false;
    this.input.left = false;
    this.input.right = false;
    this.input.boost = false;
    this.input.touchX = 0;
    this.input.touchY = 0;
  }

  public updateSettings(next: FlightSettings): void {
    const qualityChanged = next.quality !== this.settings.quality;
    this.settings = { ...next };
    this.audio.setMuted(next.muted);
    if (qualityChanged) {
      this.applyQualityPixelRatio();
      this.renderer.shadowMap.enabled = !this.isSoftwareGl && next.quality !== 'low';
      this.sunLight.castShadow = !this.isSoftwareGl && next.quality !== 'low';
    }
    this.emitHudSnapshot(true);
  }

  /**
   * Switches seamlessly between Baseline and Enhanced/Imported scene variants
   * without resetting flight position, camera, hearts, boost, score, or pickups.
   * Freezes progression, captures last complete frame, rebuilds swapped assets cleanly,
   * renders next scene, and crossfades over ~650ms (0ms under reduced motion).
   */
  public async toggleCompare(): Promise<void> {
    if (this.isComparing) return; // guard repeated clicks
    this.isComparing = true;
    const previousVariant = this.variantMode;
    const nextVariant: SceneVariantMode = previousVariant === 'baseline' ? 'enhanced' : 'baseline';
    const durationMs = this.settings.reducedMotion ? 0 : 650;

    try {
      // 1. Render & retain the last complete frame before swapping
      this.renderScene();
      let snapshotUrl: string | null = null;
      try {
        snapshotUrl = this.renderer.domElement.toDataURL('image/png');
      } catch {
        snapshotUrl = null;
      }

      if (snapshotUrl && durationMs > 0) {
        this.callbacks.onCompareSnapshot(snapshotUrl, durationMs);
      }

      // Yield a micro-tick so the frozen snapshot overlay mounts cleanly
      await new Promise((r) => window.setTimeout(r, 24));

      // 2. Swap scene variant assets (keeping at most 1 live GPU scene + cached templates)
      this.variantMode = nextVariant;
      this.buildVariantAssets(nextVariant);
      this.updateStreamingChunks(true);
      this.updateVisuals(0.001);
      this.renderScene();

      // 3. Emit updated HUD state and begin crossfade reveal
      this.emitHudSnapshot(true);
      this.callbacks.onCompareSnapshot(null, durationMs);

      if (durationMs > 0) {
        await new Promise((r) => window.setTimeout(r, durationMs));
      }
    } catch (err) {
      // Restore prior scene cleanly on any failure
      this.variantMode = previousVariant;
      this.buildVariantAssets(previousVariant);
      this.updateStreamingChunks(true);
      this.updateVisuals(0.001);
      this.renderScene();
      this.callbacks.onCompareSnapshot(null, 0);
      this.callbacks.onCompareError(
        err instanceof Error ? err.message : 'Scene comparison failed; restored previous view.',
      );
    } finally {
      this.isComparing = false;
      this.lastTimestamp = performance.now();
      this.emitHudSnapshot(true);
    }
  }

  /**
   * Called after an independent GLB asset is imported or reset for any slot.
   * Automatically switches to 'enhanced' (imported) view when a new GLB arrives
   * and updates all repeated instances cleanly without resetting flight state.
   */
  public async refreshAfterSlotUpdate(_slot: AssetSlotId, preferImported: boolean): Promise<void> {
    if (this.isComparing) return;
    this.isComparing = true;
    try {
      if (preferImported) {
        this.variantMode = 'enhanced';
      }
      this.buildVariantAssets(this.variantMode);
      this.updateStreamingChunks(true);
      this.updateVisuals(0.001);
      this.renderScene();
      this.emitHudSnapshot(true);
    } finally {
      this.isComparing = false;
      this.lastTimestamp = performance.now();
    }
  }

  public dispose(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver?.disconnect();

    this.activeChunks.forEach((c) => this.disposeChunk(c));
    this.activeChunks.clear();
    this.cedarPartTemplates.forEach((p) => {
      p.geometry.dispose();
      p.material.dispose();
    });
    this.rockPartTemplates.forEach((p) => {
      p.geometry.dispose();
      p.material.dispose();
    });
    disposeObjectTree(this.aircraftWrapper);
    disposeObjectTree(this.routeEntitiesGroup);
    disposeObjectTree(this.sanctuaryGroup);
    this.sharedTerrainMaterial.dispose();
    this.sharedWaterMaterial.dispose();
    this.textures.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
