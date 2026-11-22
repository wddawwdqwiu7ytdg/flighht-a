import React from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { FlightSettings, HudSnapshot, QualityLevel } from '../game/types';
import { CHAPTERS } from '../game/worldMath';

interface TitleOverlayProps {
  bestScore: number;
  onBeginFlight: () => void;
  onOpenViewer: () => void;
  onOpenHelp: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  bestScore,
  onBeginFlight,
  onOpenViewer,
  onOpenHelp,
}) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex flex-col justify-end p-5 sm:p-8">
      {/* Positioned in the lower third negative space so the 1903 Wright Flyer & river stay unobstructed */}
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center pb-2 sm:pb-5">
        <p className="font-serif-display text-2xl sm:text-4xl font-normal italic tracking-[0.03em] text-[#f4efe4] hud-text-shadow">
          Let the forest carry you.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3 pointer-events-auto">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onBeginFlight();
            }}
            className="rounded-full border border-[#ebd494]/75 bg-[#15221e]/88 px-8 py-3 text-sm font-medium tracking-[0.14em] uppercase text-[#f4efe4] shadow-lg transition-colors hover:bg-[#ebd494] hover:text-[#101916] cursor-pointer"
          >
            Begin flight
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenViewer();
            }}
            className="rounded-full border border-[#f4efe4]/28 bg-[#121d1a]/78 px-5 py-3 text-xs font-medium tracking-[0.12em] uppercase text-[#f4efe4]/88 transition-colors hover:border-[#ebd494]/60 hover:text-[#ebd494] cursor-pointer"
          >
            Explore the aircraft
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-[#f4efe4]/74 hud-text-shadow">
          <span>WASD / Arrows to fly</span>
          <span aria-hidden="true">·</span>
          <span>Shift wind boost</span>
          <span aria-hidden="true">·</span>
          <span>Esc pause</span>
          {bestScore > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums text-[#ebd494]">Best {bestScore}</span>
            </>
          )}
        </div>

        <div className="pointer-events-auto mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-[#f4efe4]/60 hud-text-shadow">
          <span>
            Created by{' '}
            <a
              href="https://x.com/jaredliu_bravo"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#f4efe4]/85 underline decoration-[#f4efe4]/30 underline-offset-2 hover:text-[#ebd494]"
            >
              Jared
            </a>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Inspired by{' '}
            <a
              href="https://x.com/thebuggeddev/status/2096467585785286808"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#f4efe4]/85 underline decoration-[#f4efe4]/30 underline-offset-2 hover:text-[#ebd494]"
            >
              The Bugged Dev
            </a>
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenHelp();
            }}
            className="text-[#f4efe4]/82 underline decoration-[#f4efe4]/30 underline-offset-2 hover:text-[#ebd494] cursor-pointer"
          >
            Flight guide
          </button>
        </div>
      </div>
    </div>
  );
};

interface PauseModalProps {
  hud: HudSnapshot;
  onResume: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  hud,
  onResume,
  onRestart,
  onReturnToTitle,
}) => {
  const chapter = CHAPTERS[hud.chapterIndex] || CHAPTERS[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Flight paused"
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#0a110f]/68 p-4"
    >
      <div className="hud-surface-strong w-full max-w-md rounded-xl p-6 text-center shadow-2xl">
        <div className="text-[10px] font-medium tracking-[0.2em] uppercase text-[#ebd494]">
          Chapter {chapter.roman} · {chapter.name}
        </div>
        <h2 className="mt-1 font-serif-display text-3xl font-medium text-[#f4efe4]">
          Flight Paused
        </h2>

        <div className="mt-5 grid grid-cols-3 gap-3 border-y border-[#f4efe4]/14 py-4 text-center">
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#f4efe4]/60">Score</div>
            <div className="mt-0.5 font-serif-display text-2xl text-[#f4efe4] tabular-nums">
              {hud.score}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#f4efe4]/60">Distance</div>
            <div className="mt-0.5 font-serif-display text-2xl text-[#f4efe4] tabular-nums">
              {(hud.distanceMeters / 1000).toFixed(1)} km
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#f4efe4]/60">Hearts</div>
            <div className="mt-0.5 font-serif-display text-2xl text-[#ebd494] tabular-nums">
              {hud.hearts}/{hud.maxHearts}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full rounded-full border border-[#ebd494]/70 bg-[#ebd494]/18 py-2.5 text-xs font-medium tracking-[0.14em] uppercase text-[#f4efe4] transition-colors hover:bg-[#ebd494] hover:text-[#101916] cursor-pointer"
          >
            Resume flight
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="w-full rounded-full border border-[#f4efe4]/22 py-2.5 text-xs font-medium tracking-[0.12em] uppercase text-[#f4efe4]/85 transition-colors hover:border-[#f4efe4]/55 hover:text-[#f4efe4] cursor-pointer"
          >
            Restart from Whispering Woods
          </button>
          <button
            type="button"
            onClick={onReturnToTitle}
            className="w-full py-2 text-xs text-[#f4efe4]/65 transition-colors hover:text-[#f4efe4] cursor-pointer"
          >
            Return to title
          </button>
        </div>
      </div>
    </div>
  );
};

interface SettingsModalProps {
  open: boolean;
  settings: FlightSettings;
  onChange: (next: FlightSettings) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  settings,
  onChange,
  onClose,
}) => {
  if (!open) return null;

  const qualities: QualityLevel[] = ['low', 'medium', 'high'];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Flight settings"
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#0a110f]/70 p-4"
    >
      <div className="hud-surface-strong w-full max-w-md rounded-xl p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#f4efe4]/14 pb-3">
          <h2 className="font-serif-display text-2xl font-medium text-[#f4efe4]">
            Flight Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#f4efe4]/20 text-[#f4efe4]/80 hover:border-[#ebd494] hover:text-[#ebd494] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-5 text-sm">
          {/* Flight Assist */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-[#f4efe4]">Flight assist</div>
              <div className="text-xs text-[#f4efe4]/65">
                Gently guides the flyer back toward the river corridor and cruise altitude when steering is released.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.flightAssist}
              onClick={() => onChange({ ...settings, flightAssist: !settings.flightAssist })}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                settings.flightAssist
                  ? 'border-[#ebd494]/70 bg-[#ebd494]/22 text-[#ebd494]'
                  : 'border-[#f4efe4]/25 text-[#f4efe4]/65'
              }`}
            >
              {settings.flightAssist ? 'On' : 'Off'}
            </button>
          </div>

          {/* Quality */}
          <div className="flex flex-col gap-2">
            <div className="font-medium text-[#f4efe4]">Visual quality</div>
            <div className="grid grid-cols-3 gap-2">
              {qualities.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onChange({ ...settings, quality: q })}
                  className={`rounded-md border py-2 text-xs font-medium capitalize transition-colors cursor-pointer ${
                    settings.quality === q
                      ? 'border-[#ebd494]/70 bg-[#ebd494]/20 text-[#ebd494]'
                      : 'border-[#f4efe4]/18 text-[#f4efe4]/72 hover:border-[#f4efe4]/40'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Sound */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-[#f4efe4]">Forest soundscape</div>
              <div className="text-xs text-[#f4efe4]/65">
                Procedural wind, propeller hum, and lantern chimes.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!settings.muted}
              onClick={() => onChange({ ...settings, muted: !settings.muted })}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                !settings.muted
                  ? 'border-[#ebd494]/70 bg-[#ebd494]/22 text-[#ebd494]'
                  : 'border-[#f4efe4]/25 text-[#f4efe4]/65'
              }`}
            >
              {settings.muted ? 'Muted' : 'On'}
            </button>
          </div>

          {/* Reduced Motion */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-[#f4efe4]">Reduced motion</div>
              <div className="text-xs text-[#f4efe4]/65">
                Switches Compare views instantly instead of crossfading over 650 ms.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.reducedMotion}
              onClick={() => onChange({ ...settings, reducedMotion: !settings.reducedMotion })}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                settings.reducedMotion
                  ? 'border-[#ebd494]/70 bg-[#ebd494]/22 text-[#ebd494]'
                  : 'border-[#f4efe4]/25 text-[#f4efe4]/65'
              }`}
            >
              {settings.reducedMotion ? 'On' : 'Off'}
            </button>
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-[#f4efe4]/14 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#ebd494]/65 bg-[#ebd494]/16 px-6 py-2 text-xs font-medium tracking-[0.12em] uppercase text-[#f4efe4] hover:bg-[#ebd494] hover:text-[#101916] cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Flight guide and credits"
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#0a110f]/72 p-4"
    >
      <div className="hud-surface-strong max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#f4efe4]/14 pb-3">
          <div>
            <h2 className="font-serif-display text-2xl font-medium text-[#f4efe4]">
              Flight Guide
            </h2>
            <p className="text-xs text-[#f4efe4]/65">KOMOREBI · 木漏れ日 · A Forest Flight</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close flight guide"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#f4efe4]/20 text-[#f4efe4]/80 hover:border-[#ebd494] hover:text-[#ebd494] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4 text-xs leading-relaxed text-[#f4efe4]/82">
          <div>
            <h3 className="font-serif-display text-base font-medium text-[#ebd494]">
              Controls
            </h3>
            <ul className="mt-1.5 space-y-1">
              <li>
                <strong className="text-[#f4efe4]">W / S or Up / Down:</strong> Climb and descend smoothly.
              </li>
              <li>
                <strong className="text-[#f4efe4]">A / D or Left / Right:</strong> Steer and bank along the river.
              </li>
              <li>
                <strong className="text-[#f4efe4]">Shift (or Boost button):</strong> Spend recharging wind-boost reserve for extra speed.
              </li>
              <li>
                <strong className="text-[#f4efe4]">C:</strong> Crossfade Compare between the visual baseline and imported/enhanced models without resetting flight.
              </li>
              <li>
                <strong className="text-[#f4efe4]">Esc / M:</strong> Pause flight / Mute soundscape.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-serif-display text-base font-medium text-[#ebd494]">
              The 3.6 km Journey
            </h3>
            <p className="mt-1">
              Glide from <strong>Whispering Woods</strong> through <strong>Hidden Falls</strong> and{' '}
              <strong>Lantern Valley</strong> to reach the <strong>Cloud Sanctuary</strong> at 3.6 km.
              Fly through glowing golden spirit lantern rings for <strong>+100 points</strong> and pass
              cleanly beneath vermilion torii gates for <strong>+250 points</strong>. You carry{' '}
              <strong>3 hearts</strong>; grazing the river, forested banks, or gate beams costs one
              heart and grants brief invulnerability.
            </p>
          </div>

          <div className="border-t border-[#f4efe4]/14 pt-3.5">
            <h3 className="font-serif-display text-base font-medium text-[#ebd494]">
              Credits &amp; Inspiration
            </h3>
            <div className="mt-2 flex flex-col gap-2">
              <a
                href="https://x.com/jaredliu_bravo"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md border border-[#f4efe4]/16 px-3 py-2 text-[#f4efe4] transition-colors hover:border-[#ebd494]/60 hover:text-[#ebd494]"
              >
                <span>Created by Jared (@jaredliu_bravo)</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
              <a
                href="https://x.com/thebuggeddev/status/2096467585785286808"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-md border border-[#f4efe4]/16 px-3 py-2 text-[#f4efe4] transition-colors hover:border-[#ebd494]/60 hover:text-[#ebd494]"
              >
                <span>Inspiration: The Bugged Dev</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end border-t border-[#f4efe4]/14 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#ebd494]/65 bg-[#ebd494]/16 px-6 py-2 text-xs font-medium tracking-[0.12em] uppercase text-[#f4efe4] hover:bg-[#ebd494] hover:text-[#101916] cursor-pointer"
          >
            Back to flight
          </button>
        </div>
      </div>
    </div>
  );
};

interface EndSummaryModalProps {
  hud: HudSnapshot;
  onReplay: () => void;
  onReturnToTitle: () => void;
}

export const EndSummaryModal: React.FC<EndSummaryModalProps> = ({
  hud,
  onReplay,
  onReturnToTitle,
}) => {
  const summary = hud.summary;
  if (!summary) return null;

  const isVictory = summary.outcome === 'victory';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isVictory ? 'Cloud Sanctuary reached' : 'Flight ended'}
      className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-[#0a110f]/75 p-4"
    >
      <div className="hud-surface-strong w-full max-w-md rounded-xl p-6 text-center shadow-2xl">
        <div className="text-[10px] font-medium tracking-[0.2em] uppercase text-[#ebd494]">
          {isVictory ? 'Cloud Sanctuary · 3.6 km Complete' : 'Journey Interrupted'}
        </div>
        <h2 className="mt-1 font-serif-display text-3xl sm:text-4xl font-medium text-[#f4efe4]">
          {isVictory ? 'Sanctuary Reached' : 'The Wind Rests'}
        </h2>
        <p className="mt-1.5 text-xs text-[#f4efe4]/72">
          {isVictory
            ? 'The valley stills beneath the cedar ridge.'
            : `You glided ${(summary.distanceMeters / 1000).toFixed(2)} km along the forest river.`}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 border-y border-[#f4efe4]/14 py-4">
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#f4efe4]/60">
              Spirit Score
            </div>
            <div className="mt-0.5 font-serif-display text-3xl text-[#f4efe4] tabular-nums">
              {summary.score}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#f4efe4]/60">
              Personal Best
            </div>
            <div className="mt-0.5 font-serif-display text-3xl text-[#ebd494] tabular-nums">
              {summary.bestScore}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#f4efe4]/60">
              Lanterns
            </div>
            <div className="mt-0.5 text-sm font-medium text-[#f4efe4] tabular-nums">
              {summary.lanternsCollected} / {summary.totalLanterns}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.14em] uppercase text-[#f4efe4]/60">
              Torii Gates
            </div>
            <div className="mt-0.5 text-sm font-medium text-[#f4efe4] tabular-nums">
              {summary.gatesCleared} / {summary.totalGates}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            data-start="true"
            onClick={onReplay}
            className="w-full rounded-full border border-[#ebd494]/75 bg-[#ebd494]/20 py-3 text-xs font-medium tracking-[0.14em] uppercase text-[#f4efe4] transition-colors hover:bg-[#ebd494] hover:text-[#101916] cursor-pointer"
          >
            {isVictory ? 'Fly again' : 'Try again'}
          </button>
          <button
            type="button"
            onClick={onReturnToTitle}
            className="w-full py-2 text-xs text-[#f4efe4]/68 transition-colors hover:text-[#f4efe4] cursor-pointer"
          >
            Return to title
          </button>
        </div>
      </div>
    </div>
  );
};
