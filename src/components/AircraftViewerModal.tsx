import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Download, RotateCcw, Upload, X, Play, Pause } from 'lucide-react';
import type { AssetManifestManager } from '../game/assetManifest';
import type { ProceduralTextureSet } from '../game/textures';
import type { AssetSlotId, AssetSlotRecord, SceneVariantMode } from '../game/types';

interface AircraftViewerModalProps {
  open: boolean;
  manifest: AssetManifestManager;
  textures: ProceduralTextureSet | null;
  variantMode: SceneVariantMode;
  onClose: () => void;
  onSlotImported: (slot: AssetSlotId, preferImported: boolean) => Promise<void>;
}

function detectSoftwareGl(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
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

export const AircraftViewerModal: React.FC<AircraftViewerModalProps> = ({
  open,
  manifest,
  textures,
  variantMode,
  onClose,
  onSlotImported,
}) => {
  const viewerMountRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<'aircraft' | 'slots'>('aircraft');
  const [spinProps, setSpinProps] = useState(true);
  const spinPropsRef = useRef(true);
  spinPropsRef.current = spinProps;

  const [records, setRecords] = useState<AssetSlotRecord[]>(() => manifest.getRecords());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<AssetSlotId | null>(null);
  const [viewerRefreshKey, setViewerRefreshKey] = useState(0);

  useEffect(() => {
    return manifest.subscribe(() => {
      setRecords(manifest.getRecords());
      setViewerRefreshKey((k) => k + 1);
    });
  }, [manifest]);

  // Dedicated interactive orbitable & zoomable 3D Aircraft Viewer
  useEffect(() => {
    if (!open || activeTab !== 'aircraft' || !textures) return;
    const mount = viewerMountRef.current;
    if (!mount) return;

    const isSwGl = detectSoftwareGl();
    const width = Math.max(240, mount.clientWidth || 640);
    const height = Math.max(220, mount.clientHeight || 380);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSwGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSwGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x16211d, 1);
    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x16211d);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.72;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(5.4, 2.7, 6.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSwGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3.2;
    controls.maxDistance = 16;
    controls.target.set(0, 0.1, 0);
    controls.update();

    // Three-point warm/cool studio lighting
    const hemi = new THREE.HemisphereLight(0xd9e8e2, 0x2f3b2e, 0.95);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff0d4, 1.7);
    key.position.set(6, 9, 7);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc2bd, 0.75);
    rim.position.set(-7, 4, -6);
    scene.add(rim);

    // Subtle studio floor ring & radial shadow disc
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6.2, 48),
      new THREE.MeshStandardMaterial({
        color: 0x1b2924,
        roughness: 0.9,
        metalness: 0.05,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.2;
    scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.4, 4.46, 64),
      new THREE.MeshBasicMaterial({ color: 0xebd494, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.18;
    scene.add(ring);

    const rig = manifest.buildAircraft(textures, variantMode);
    scene.add(rig.root);

    let frameId = 0;
    let alive = true;
    let lastTime = performance.now();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (!alive) {
            if (sync) gl.deleteSync(sync);
            return;
          }
          const st = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
          if (st === gl.UNSIGNALED) frameId = window.setTimeout(poll, 5);
          else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 90);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 90);
      }
    };

    const tick = () => {
      if (!alive) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      if (spinPropsRef.current) {
        rig.leftPropeller.rotation.z += 15 * dt;
        rig.rightPropeller.rotation.z -= 15 * dt;
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSwGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };

    if (isSwGl) frameId = window.setTimeout(tick, 16);
    else frameId = requestAnimationFrame(tick);

    const onResize = () => {
      const w = Math.max(240, mount.clientWidth || 640);
      const h = Math.max(220, mount.clientHeight || 380);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(mount);

    return () => {
      alive = false;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      ro?.disconnect();
      controls.dispose();
      renderer.dispose();
    };
  }, [open, activeTab, textures, manifest, variantMode, viewerRefreshKey]);

  if (!open) return null;

  const aircraftRecord = records.find((r) => r.id === 'aircraft')!;

  const handleImportFile = async (slot: AssetSlotId, file: File | null) => {
    if (!file) return;
    setBusySlot(slot);
    setStatusMessage(null);
    try {
      const rec = await manifest.importGlbFile(slot, file);
      await onSlotImported(slot, true);
      setStatusMessage(
        `Loaded "${rec.fileName}" into ${rec.label} (${rec.triangleCount.toLocaleString()} tris). All matching instances updated.`,
      );
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Could not import GLB file. Kept fallback model.',
      );
    } finally {
      setBusySlot(null);
    }
  };

  const handleResetSlot = async (slot: AssetSlotId) => {
    setBusySlot(slot);
    setStatusMessage(null);
    try {
      manifest.clearImportedSlot(slot);
      await onSlotImported(slot, false);
      setStatusMessage(`Restored procedural baseline for ${slot}.`);
    } finally {
      setBusySlot(null);
    }
  };

  const handleDownloadAircraft = async () => {
    if (!textures) return;
    try {
      const name = await manifest.downloadActiveAircraftGlb(textures, variantMode);
      setStatusMessage(`Exported and downloaded ${name}.`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Download failed.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Aircraft viewer and asset slot registry"
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#0a110f]/75 p-3 sm:p-6"
    >
      <div className="hud-surface-strong flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl text-[#f4efe4] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f4efe4]/15 px-5 py-4">
          <div>
            <h2 className="font-serif-display text-2xl font-medium tracking-[0.06em] text-[#f4efe4]">
              1903 Wright Flyer &amp; Asset Registry
            </h2>
            <p className="text-xs text-[#f4efe4]/68">
              Inspect the open biplane and counter-rotating propellers, or swap any of the 6 replaceable model slots.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close aircraft viewer"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#f4efe4]/20 text-[#f4efe4]/80 transition-colors hover:border-[#ebd494] hover:text-[#ebd494] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-2 border-b border-[#f4efe4]/12 px-5 py-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('aircraft')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium tracking-[0.06em] transition-colors cursor-pointer ${
              activeTab === 'aircraft'
                ? 'bg-[#ebd494]/20 text-[#ebd494] border border-[#ebd494]/45'
                : 'text-[#f4efe4]/70 hover:text-[#f4efe4] border border-transparent'
            }`}
          >
            Aircraft Viewer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('slots')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium tracking-[0.06em] transition-colors cursor-pointer ${
              activeTab === 'slots'
                ? 'bg-[#ebd494]/20 text-[#ebd494] border border-[#ebd494]/45'
                : 'text-[#f4efe4]/70 hover:text-[#f4efe4] border border-transparent'
            }`}
          >
            Asset Slots ({records.filter((r) => r.provenance === 'imported-glb').length}/6 Imported)
          </button>
        </div>

        {/* Status feedback */}
        {statusMessage && (
          <div className="border-b border-[#ebd494]/25 bg-[#ebd494]/10 px-5 py-2 text-xs text-[#f3dc98]">
            {statusMessage}
          </div>
        )}

        {/* Body */}
        {activeTab === 'aircraft' ? (
          <div className="flex flex-1 flex-col overflow-y-auto p-5 gap-4">
            <div className="relative h-72 sm:h-96 w-full overflow-hidden rounded-lg border border-[#f4efe4]/14 bg-[#16211d]">
              <div ref={viewerMountRef} className="h-full w-full" data-testid="aircraft-viewer-canvas" />
              <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-[#f4efe4]/70 hud-text-shadow">
                Drag to orbit · Scroll to zoom · Twin pusher propellers animate via delta time
              </div>
              <button
                type="button"
                onClick={() => setSpinProps((s) => !s)}
                className="absolute right-3 top-3 hud-surface flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] text-[#f4efe4] hover:border-[#ebd494]/60 hover:text-[#ebd494] cursor-pointer"
              >
                {spinProps ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                <span>{spinProps ? 'Pause props' : 'Spin props'}</span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-[#f4efe4]/12 pt-3">
              <div className="text-xs text-[#f4efe4]/75">
                <div className="font-medium text-[#f4efe4]">
                  {aircraftRecord.label} ·{' '}
                  {aircraftRecord.provenance === 'imported-glb'
                    ? `Imported (${aircraftRecord.fileName})`
                    : 'Procedural Baseline'}
                </div>
                <div className="mt-0.5 text-[11px] text-[#f4efe4]/60 tabular-nums">
                  Bounds {aircraftRecord.targetBounds.width} × {aircraftRecord.targetBounds.height} ×{' '}
                  {aircraftRecord.targetBounds.depth} m · {aircraftRecord.triangleCount.toLocaleString()} tris
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadAircraft}
                  className="flex items-center gap-1.5 rounded-md border border-[#ebd494]/50 bg-[#ebd494]/14 px-3.5 py-2 text-xs font-medium text-[#f3dc98] transition-colors hover:bg-[#ebd494]/24 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download aircraft .GLB</span>
                </button>

                <label className="flex items-center gap-1.5 rounded-md border border-[#f4efe4]/25 px-3.5 py-2 text-xs font-medium text-[#f4efe4] transition-colors hover:border-[#ebd494]/50 hover:text-[#ebd494] cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Import aircraft .GLB</span>
                  <input
                    type="file"
                    accept=".glb,.gltf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      void handleImportFile('aircraft', file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {records.map((rec) => {
                const isImported = rec.provenance === 'imported-glb';
                const isBusy = busySlot === rec.id;
                return (
                  <div
                    key={rec.id}
                    className="flex flex-col justify-between gap-3 rounded-lg border border-[#f4efe4]/14 bg-[#14201c] p-4"
                  >
                    <div>
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-serif-display text-lg font-medium text-[#f4efe4]">
                          {rec.order}. {rec.label}
                        </h3>
                        <span
                          className={`text-[10px] tracking-[0.12em] uppercase ${
                            isImported ? 'text-[#ebd494]' : 'text-[#f4efe4]/55'
                          }`}
                        >
                          {isImported ? 'Imported GLB' : 'Baseline'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[#f4efe4]/70">
                        {rec.description}
                      </p>
                      <div className="mt-2 text-[11px] text-[#f4efe4]/55 tabular-nums">
                        Slot: {rec.id} · {rec.triangleCount.toLocaleString()} tris ·{' '}
                        {rec.targetBounds.width}×{rec.targetBounds.height}×{rec.targetBounds.depth}m
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#f4efe4]/50">
                        {rec.orientationNote}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-[#f4efe4]/10 pt-2.5">
                      <label className="flex items-center gap-1.5 rounded-md border border-[#f4efe4]/24 px-3 py-1.5 text-xs text-[#f4efe4] transition-colors hover:border-[#ebd494]/60 hover:text-[#ebd494] cursor-pointer">
                        <Upload className="h-3.5 w-3.5" />
                        <span>{isBusy ? 'Importing...' : isImported ? 'Replace .GLB' : 'Import .GLB'}</span>
                        <input
                          type="file"
                          accept=".glb,.gltf"
                          disabled={isBusy}
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            void handleImportFile(rec.id, file);
                            e.target.value = '';
                          }}
                        />
                      </label>

                      {isImported && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleResetSlot(rec.id)}
                          className="flex items-center gap-1 text-xs text-[#f4efe4]/70 hover:text-[#f5b4a4] cursor-pointer"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Restore baseline</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
