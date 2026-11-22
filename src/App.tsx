import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KomorebiSceneEngine } from './game/sceneEngine';
import { AssetManifestManager } from './game/assetManifest';
import { ForestAudioEngine } from './game/audio';
import { MAX_HEARTS, loadBestScore } from './game/flightSim';
import { ROUTE_LENGTH } from './game/worldMath';
import type {
  AssetSlotId,
  FlightSettings,
  FloatingFeedback,
  GamePhase,
  HudSnapshot,
} from './game/types';
import { GameHud } from './components/GameHud';
import { AircraftViewerModal } from './components/AircraftViewerModal';
import {
  EndSummaryModal,
  HelpModal,
  PauseModal,
  SettingsModal,
  TitleOverlay,
} from './components/Overlays';

type ActiveModal = 'none' | 'settings' | 'help' | 'viewer';

function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function createInitialHud(): HudSnapshot {
  return {
    phase: 'title',
    score: 0,
    bestScore: loadBestScore(),
    hearts: MAX_HEARTS,
    maxHearts: MAX_HEARTS,
    invulnerable: false,
    lanternsCollected: 0,
    gatesCleared: 0,
    distanceMeters: 14,
    routeLength: ROUTE_LENGTH,
    altitudeMeters: 12,
    airspeedKmh: 82,
    boostPercent: 100,
    isBoosting: false,
    headingDeg: 0,
    chapterIndex: 0,
    chapterProgressPercent: 0,
    nearestTarget: { visible: false, x: 0, y: 0, distance: 0, id: -1 },
    scorePulseKey: 0,
    variantMode: 'baseline',
    isComparing: false,
    importedSlotCount: 0,
    damageFlash: 0,
    summary: null,
  };
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<KomorebiSceneEngine | null>(null);
  const manifest = useMemo(() => new AssetManifestManager(), []);
  const audio = useMemo(() => new ForestAudioEngine(), []);

  const [hud, setHud] = useState<HudSnapshot>(() => createInitialHud());
  const [settings, setSettings] = useState<FlightSettings>(() => ({
    flightAssist: true,
    quality: 'high',
    muted: false,
    reducedMotion: detectReducedMotion(),
  }));
  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [feedbacks, setFeedbacks] = useState<FloatingFeedback[]>([]);

  // Compare crossfade frozen-frame state (retains last complete frame until next scene renders)
  const [compareFrameUrl, setCompareFrameUrl] = useState<string | null>(null);
  const [compareOpacity, setCompareOpacity] = useState(0);
  const [compareDurationMs, setCompareDurationMs] = useState(650);
  const compareClearTimerRef = useRef<number | null>(null);

  // Track prior phase before opening Help / Settings / Viewer so closing restores it cleanly
  const phaseBeforeModalRef = useRef<GamePhase | null>(null);
  const activeModalRef = useRef<ActiveModal>('none');
  activeModalRef.current = activeModal;
  const hudPhaseRef = useRef<GamePhase>('title');
  hudPhaseRef.current = hud.phase;
  const settingsRef = useRef<FlightSettings>(settings);
  settingsRef.current = settings;

  // Mirror state machine to document.body.dataset.state for accessibility & testing
  useEffect(() => {
    const bodyState =
      hud.phase === 'victory' || hud.phase === 'defeat' ? 'gameover' : hud.phase;
    document.body.dataset.state = bodyState;
  }, [hud.phase]);

  const pushFeedback = useCallback((fb: FloatingFeedback) => {
    setFeedbacks((prev) => [...prev.slice(-3), fb]);
    window.setTimeout(() => {
      setFeedbacks((prev) => prev.filter((item) => item.id !== fb.id));
    }, 1750);
  }, []);

  const handleCompareSnapshot = useCallback((dataUrl: string | null, durationMs: number) => {
    if (compareClearTimerRef.current !== null) {
      window.clearTimeout(compareClearTimerRef.current);
      compareClearTimerRef.current = null;
    }

    if (dataUrl) {
      setCompareDurationMs(0);
      setCompareFrameUrl(dataUrl);
      setCompareOpacity(1);
    } else {
      if (durationMs <= 0) {
        setCompareOpacity(0);
        setCompareFrameUrl(null);
      } else {
        setCompareDurationMs(durationMs);
        // Trigger smooth fade-out on next animation frame
        requestAnimationFrame(() => {
          setCompareOpacity(0);
        });
        compareClearTimerRef.current = window.setTimeout(() => {
          setCompareFrameUrl(null);
          compareClearTimerRef.current = null;
        }, durationMs + 40);
      }
    }
  }, []);

  // Mount Three.js engine once in isolated container ref
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new KomorebiSceneEngine(
      mount,
      manifest,
      audio,
      {
        onHudUpdate: (snapshot) => setHud(snapshot),
        onFeedback: pushFeedback,
        onCompareSnapshot: handleCompareSnapshot,
        onCompareError: (msg) =>
          pushFeedback({ id: Date.now(), text: msg, accent: 'vermilion' }),
      },
      settingsRef.current,
    );
    engineRef.current = engine;

    // Support ?autostart=1 to boot directly into active flight
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        engine.beginFlight();
      }
    } catch {
      // Ignore query parse failures
    }

    return () => {
      if (compareClearTimerRef.current !== null) {
        window.clearTimeout(compareClearTimerRef.current);
      }
      engine.dispose();
      audio.dispose();
      engineRef.current = null;
    };
  }, [manifest, audio, pushFeedback, handleCompareSnapshot]);

  // Modal open/close helpers that pause flight and restore prior state
  const openModal = useCallback((modal: ActiveModal) => {
    const engine = engineRef.current;
    if (activeModalRef.current === 'none') {
      const currentPhase = engine ? engine.getPhase() : hudPhaseRef.current;
      phaseBeforeModalRef.current = currentPhase;
      if (currentPhase === 'playing') {
        engine?.clearInputs();
        engine?.setPaused(true);
      }
    }
    setActiveModal(modal);
  }, []);

  const closeModal = useCallback(() => {
    const prior = phaseBeforeModalRef.current;
    phaseBeforeModalRef.current = null;
    setActiveModal('none');
    if (prior === 'playing') {
      engineRef.current?.clearInputs();
      engineRef.current?.setPaused(false);
    }
  }, []);

  const handleBeginFlight = useCallback(() => {
    setActiveModal('none');
    phaseBeforeModalRef.current = null;
    engineRef.current?.clearInputs();
    engineRef.current?.beginFlight();
  }, []);

  const handleTogglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (activeModalRef.current !== 'none') {
      closeModal();
      return;
    }
    const phase = engine.getPhase();
    if (phase === 'playing') {
      engine.clearInputs();
      engine.setPaused(true);
    } else if (phase === 'paused') {
      engine.clearInputs();
      engine.setPaused(false);
    }
  }, [closeModal]);

  const handleReturnToTitle = useCallback(() => {
    setActiveModal('none');
    phaseBeforeModalRef.current = null;
    engineRef.current?.clearInputs();
    engineRef.current?.returnToTitle();
  }, []);

  const handleUpdateSettings = useCallback((next: FlightSettings) => {
    setSettings(next);
    engineRef.current?.updateSettings(next);
  }, []);

  const handleToggleMute = useCallback(() => {
    const next = { ...settingsRef.current, muted: !settingsRef.current.muted };
    setSettings(next);
    engineRef.current?.updateSettings(next);
  }, []);

  const handleToggleCompare = useCallback(() => {
    void engineRef.current?.toggleCompare();
  }, []);

  const handleSlotImported = useCallback(async (slot: AssetSlotId, preferImported: boolean) => {
    await engineRef.current?.refreshAfterSlotUpdate(slot, preferImported);
  }, []);

  // Keyboard controls & focus-loss input clearing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      const code = e.code;

      // Esc closes open overlay modal first, or toggles pause
      if (code === 'Escape') {
        e.preventDefault();
        if (activeModalRef.current !== 'none') {
          closeModal();
        } else {
          handleTogglePause();
        }
        return;
      }

      if (activeModalRef.current !== 'none') return;

      // Enter / Space starts flight from Title screen
      if (hudPhaseRef.current === 'title' && (code === 'Enter' || code === 'Space')) {
        e.preventDefault();
        handleBeginFlight();
        return;
      }

      if (code === 'KeyP' && !e.repeat) {
        e.preventDefault();
        handleTogglePause();
        return;
      }

      if (code === 'KeyC' && !e.repeat) {
        e.preventDefault();
        void engine.toggleCompare();
        return;
      }

      if (code === 'KeyM' && !e.repeat) {
        e.preventDefault();
        handleToggleMute();
        return;
      }

      if (code === 'KeyW' || code === 'ArrowUp') {
        e.preventDefault();
        engine.setInput({ up: true });
      } else if (code === 'KeyS' || code === 'ArrowDown') {
        e.preventDefault();
        engine.setInput({ down: true });
      } else if (code === 'KeyA' || code === 'ArrowLeft') {
        e.preventDefault();
        engine.setInput({ left: true });
      } else if (code === 'KeyD' || code === 'ArrowRight') {
        e.preventDefault();
        engine.setInput({ right: true });
      } else if (code === 'ShiftLeft' || code === 'ShiftRight') {
        engine.setInput({ boost: true });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') engine.setInput({ up: false });
      else if (code === 'KeyS' || code === 'ArrowDown') engine.setInput({ down: false });
      else if (code === 'KeyA' || code === 'ArrowLeft') engine.setInput({ left: false });
      else if (code === 'KeyD' || code === 'ArrowRight') engine.setInput({ right: false });
      else if (code === 'ShiftLeft' || code === 'ShiftRight') engine.setInput({ boost: false });
    };

    const clearHeldInputs = () => {
      engineRef.current?.clearInputs();
    };

    const handleVisibility = () => {
      if (document.hidden) clearHeldInputs();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearHeldInputs);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearHeldInputs);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [closeModal, handleBeginFlight, handleToggleMute, handleTogglePause]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#101916]">
      {/* Isolated Full-Viewport WebGL Container (never re-rendered by React HUD ticks) */}
      <div ref={canvasMountRef} className="fixed inset-0 h-full w-full" />

      {/* Compare Crossfade Snapshot Layer (zero white frame, smooth 650ms dissolve) */}
      {compareFrameUrl && (
        <img
          src={compareFrameUrl}
          alt=""
          aria-hidden="true"
          style={{
            opacity: compareOpacity,
            transition:
              compareDurationMs > 0
                ? `opacity ${compareDurationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`
                : 'none',
          }}
          className="pointer-events-none fixed inset-0 z-10 h-full w-full object-cover"
        />
      )}

      {/* World-Matched Flight HUD */}
      <GameHud
        hud={hud}
        muted={settings.muted}
        feedbacks={feedbacks}
        onToggleMute={handleToggleMute}
        onOpenSettings={() => openModal('settings')}
        onOpenViewer={() => openModal('viewer')}
        onOpenHelp={() => openModal('help')}
        onTogglePause={handleTogglePause}
        onToggleCompare={handleToggleCompare}
        onTouchSteer={(x, y) => engineRef.current?.setInput({ touchX: x, touchY: y })}
        onTouchBoost={(active) => engineRef.current?.setInput({ boost: active })}
      />

      {/* Opening Title Screen Invitation */}
      {hud.phase === 'title' && activeModal === 'none' && (
        <TitleOverlay
          bestScore={hud.bestScore}
          onBeginFlight={handleBeginFlight}
          onOpenViewer={() => openModal('viewer')}
          onOpenHelp={() => openModal('help')}
        />
      )}

      {/* Pause Modal (when paused directly via Esc / Pause button, not via sub-modal) */}
      {hud.phase === 'paused' && activeModal === 'none' && (
        <PauseModal
          hud={hud}
          onResume={handleTogglePause}
          onRestart={handleBeginFlight}
          onReturnToTitle={handleReturnToTitle}
        />
      )}

      {/* Victory / Defeat Summary Modal */}
      {(hud.phase === 'victory' || hud.phase === 'defeat') && activeModal === 'none' && (
        <EndSummaryModal
          hud={hud}
          onReplay={handleBeginFlight}
          onReturnToTitle={handleReturnToTitle}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        open={activeModal === 'settings'}
        settings={settings}
        onChange={handleUpdateSettings}
        onClose={closeModal}
      />

      {/* Flight Guide & Credits Modal */}
      <HelpModal open={activeModal === 'help'} onClose={closeModal} />

      {/* Orbitable 3D Aircraft Viewer & 6-Slot Asset Registry */}
      <AircraftViewerModal
        open={activeModal === 'viewer'}
        manifest={manifest}
        textures={engineRef.current?.getTextures() || null}
        variantMode={hud.variantMode}
        onClose={closeModal}
        onSlotImported={handleSlotImported}
      />
    </main>
  );
}
