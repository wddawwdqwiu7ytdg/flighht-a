import React, { useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Box,
  HelpCircle,
  Pause,
  Play,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CHAPTERS } from '../game/worldMath';
import type { FloatingFeedback, HudSnapshot } from '../game/types';

interface GameHudProps {
  hud: HudSnapshot;
  muted: boolean;
  feedbacks: FloatingFeedback[];
  onToggleMute: () => void;
  onOpenSettings: () => void;
  onOpenViewer: () => void;
  onOpenHelp: () => void;
  onTogglePause: () => void;
  onToggleCompare: () => void;
  onTouchSteer: (x: number, y: number) => void;
  onTouchBoost: (active: boolean) => void;
}

function CrestIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="18" cy="18" r="16.5" stroke="#f4efe4" strokeOpacity="0.42" strokeWidth="1" />
      <circle cx="18" cy="13.5" r="4.2" stroke="#f4efe4" strokeWidth="1.2" />
      <circle cx="13.8" cy="20.6" r="4.2" stroke="#f4efe4" strokeWidth="1.2" />
      <circle cx="22.2" cy="20.6" r="4.2" stroke="#f4efe4" strokeWidth="1.2" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        d="M12 20.5C12 20.5 4.2 15.2 4.2 9.4C4.2 6.5 6.4 4.5 9.1 4.5C10.6 4.5 11.5 5.2 12 6.2C12.5 5.2 13.4 4.5 14.9 4.5C17.6 4.5 19.8 6.5 19.8 9.4C19.8 15.2 12 20.5 12 20.5Z"
        fill={filled ? '#f3e5bd' : 'none'}
        stroke="#f3e5bd"
        strokeOpacity={filled ? 0.95 : 0.35}
        strokeWidth="1.6"
      />
    </svg>
  );
}

function CompassBar({ headingDeg }: { headingDeg: number }) {
  const markers = [
    { deg: 0, label: 'N' },
    { deg: 45, label: 'NE' },
    { deg: 90, label: 'E' },
    { deg: 135, label: 'SE' },
    { deg: 180, label: 'S' },
    { deg: 225, label: 'SW' },
    { deg: 270, label: 'W' },
    { deg: 315, label: 'NW' },
  ];

  return (
    <div
      className="relative h-6 w-44 sm:w-56 overflow-hidden select-none"
      aria-label={`Compass heading ${headingDeg} degrees`}
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-[#f4efe4]/18" />
      <div className="absolute left-1/2 top-0 h-2 w-px -translate-x-1/2 bg-[#ebd494]/90" />
      {markers.map((m) => {
        let diff = ((m.deg - headingDeg + 540) % 360) - 180;
        if (Math.abs(diff) > 75) return null;
        const pct = 50 + (diff / 75) * 48;
        const isCardinal = m.label.length === 1;
        return (
          <span
            key={m.label}
            style={{ left: `${pct}%` }}
            className={`absolute top-1.5 -translate-x-1/2 hud-text-shadow tabular-nums ${
              isCardinal
                ? 'text-[11px] font-medium tracking-[0.14em] text-[#f4efe4]/90'
                : 'text-[9px] tracking-[0.12em] text-[#f4efe4]/45'
            }`}
          >
            {m.label}
          </span>
        );
      })}
    </div>
  );
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  muted,
  feedbacks,
  onToggleMute,
  onOpenSettings,
  onOpenViewer,
  onOpenHelp,
  onTogglePause,
  onToggleCompare,
  onTouchSteer,
  onTouchBoost,
}) => {
  const isPlayingOrPaused = hud.phase === 'playing' || hud.phase === 'paused';
  const currentChapter = CHAPTERS[hud.chapterIndex] || CHAPTERS[0];
  const totalProgressPct = Math.min(100, Math.max(0, (hud.distanceMeters / hud.routeLength) * 100));
  const formattedScore = String(hud.score).padStart(4, '0');
  const kmText = `${(hud.distanceMeters / 1000).toFixed(1)} / ${(hud.routeLength / 1000).toFixed(1)} km`;

  // Mobile touch steering pad state
  const padRef = useRef<HTMLDivElement | null>(null);
  const activePointerId = useRef<number | null>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });

  const updateTouchFromEvent = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxR = rect.width * 0.38;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, maxR);
    const nx = dist > 0.01 ? (dx / dist) * (clampedDist / maxR) : 0;
    const ny = dist > 0.01 ? -(dy / dist) * (clampedDist / maxR) : 0; // up = +Y
    setKnobOffset({ x: nx * maxR, y: -ny * maxR });
    onTouchSteer(nx, ny);
  };

  const resetTouchPad = () => {
    activePointerId.current = null;
    setKnobOffset({ x: 0, y: 0 });
    onTouchSteer(0, 0);
  };

  const compareLabel =
    hud.importedSlotCount > 0
      ? hud.variantMode === 'enhanced'
        ? `IMPORTED (${hud.importedSlotCount}/6) · COMPARE BASELINE`
        : `ORIGINAL BASELINE · COMPARE IMPORTED (${hud.importedSlotCount}/6)`
      : hud.variantMode === 'enhanced'
        ? 'ENHANCED VIEW · COMPARE BASELINE'
        : 'ORIGINAL BASELINE · COMPARE ENHANCED';

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-5 md:p-6">
      {/* Subtle peripheral damage vignette */}
      {hud.damageFlash > 0.02 && (
        <div
          aria-hidden="true"
          style={{ opacity: hud.damageFlash * 0.52 }}
          className="pointer-events-none fixed inset-0 border-[6px] border-[#c44a34]/75 shadow-[inset_0_0_90px_rgba(166,48,32,0.55)]"
        />
      )}

      {/* Nearest Collectible Spirit Lantern World-Projected Callout */}
      {hud.phase === 'playing' && hud.nearestTarget.visible && (
        <div
          style={{
            transform: `translate3d(${hud.nearestTarget.x}px, ${hud.nearestTarget.y}px, 0) translate(-50%, -50%)`,
          }}
          className="pointer-events-none fixed left-0 top-0 z-10 will-change-transform"
        >
          <div className="hud-surface flex items-center gap-1.5 sm:gap-2 rounded-full px-2.5 sm:px-3 py-1 text-[10px] sm:text-[11px] tracking-[0.08em] text-[#f4efe4] shadow-md whitespace-nowrap">
            <span className="font-semibold text-[#ebd494] tabular-nums">+100</span>
            <span aria-hidden="true" className="text-[#f4efe4]/45">·</span>
            <span className="text-[9px] sm:text-[10px] font-medium tracking-[0.14em] text-[#f4efe4]/90">
              FLY THROUGH
            </span>
          </div>
        </div>
      )}

      {/* TOP AREA: Responsive 1-row Desktop / 2-row Compact Mobile (Zero Overflow) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          {/* Top-Left Brand Lockup */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <CrestIcon />
            <div className="leading-tight hud-text-shadow whitespace-nowrap">
              <div className="font-serif-display text-base sm:text-[22px] font-medium tracking-[0.2em] sm:tracking-[0.22em] text-[#f4efe4]">
                KOMOREBI
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 sm:gap-2 text-[9px] sm:text-[10px] tracking-[0.14em] sm:tracking-[0.18em] text-[#f4efe4]/75">
                <span>木漏れ日</span>
                <span aria-hidden="true" className="text-[#f4efe4]/40">·</span>
                <span>A FOREST FLIGHT</span>
              </div>
            </div>
          </div>

          {/* Desktop Top-Center Compass & Compare Control */}
          <div className="hidden md:flex flex-col items-center gap-1.5">
            {isPlayingOrPaused && <CompassBar headingDeg={hud.headingDeg} />}

            <button
              type="button"
              tabIndex={-1}
              disabled={hud.isComparing}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleCompare();
              }}
              aria-label="Compare visual baseline and active replacements"
              className="pointer-events-auto hud-surface flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] font-medium tracking-[0.11em] text-[#f4efe4] transition-colors hover:border-[#ebd494]/50 hover:text-[#ebd494] disabled:opacity-55 whitespace-nowrap cursor-pointer"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 text-[#ebd494]" aria-hidden="true" />
              <span>{compareLabel}</span>
              <kbd className="rounded border border-[#f4efe4]/25 px-1.5 py-0.5 text-[9px] font-normal text-[#f4efe4]/80">
                C
              </kbd>
            </button>

            <div className="relative h-6 w-64">
              {feedbacks.slice(-1).map((fb) => (
                <div
                  key={fb.id}
                  className={`animate-float-toast absolute left-1/2 top-0 whitespace-nowrap text-xs font-medium tracking-[0.06em] hud-text-shadow ${
                    fb.accent === 'gold'
                      ? 'text-[#f3dc98]'
                      : fb.accent === 'vermilion'
                        ? 'text-[#f5b4a4]'
                        : 'text-[#e2ece7]'
                  }`}
                >
                  {fb.text}
                </div>
              ))}
            </div>
          </div>

          {/* Top-Right Compact Utility Buttons */}
          <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              title={muted ? 'Unmute audio (M)' : 'Mute audio (M)'}
              className="hud-surface flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full text-[#f4efe4]/90 transition-colors hover:border-[#ebd494]/55 hover:text-[#ebd494] cursor-pointer"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Volume2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSettings();
              }}
              aria-label="Flight settings"
              title="Flight settings"
              className="hud-surface flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full text-[#f4efe4]/90 transition-colors hover:border-[#ebd494]/55 hover:text-[#ebd494] cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenViewer();
              }}
              aria-label="Inspect aircraft and asset slots"
              title="Aircraft viewer & asset slots"
              className="hud-surface flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full text-[#f4efe4]/90 transition-colors hover:border-[#ebd494]/55 hover:text-[#ebd494] cursor-pointer"
            >
              <Box className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
            {isPlayingOrPaused && (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onTogglePause();
                }}
                aria-label={hud.phase === 'paused' ? 'Resume flight' : 'Pause flight'}
                title={hud.phase === 'paused' ? 'Resume (Esc)' : 'Pause (Esc)'}
                className="hud-surface flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full text-[#f4efe4]/90 transition-colors hover:border-[#ebd494]/55 hover:text-[#ebd494] cursor-pointer"
              >
                {hud.phase === 'paused' ? (
                  <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                ) : (
                  <Pause className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Compact Centered Compass & Compare Strip */}
        <div className="flex md:hidden flex-col items-center gap-1">
          {isPlayingOrPaused && <CompassBar headingDeg={hud.headingDeg} />}
          <button
            type="button"
            tabIndex={-1}
            disabled={hud.isComparing}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleCompare();
            }}
            aria-label="Compare visual baseline and active replacements"
            className="pointer-events-auto hud-surface flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-medium tracking-[0.11em] text-[#f4efe4] whitespace-nowrap cursor-pointer"
          >
            <ArrowLeftRight className="h-3 w-3 text-[#ebd494]" aria-hidden="true" />
            <span>COMPARE</span>
            <kbd className="rounded border border-[#f4efe4]/25 px-1 py-0.5 text-[8px] text-[#f4efe4]/80">
              C
            </kbd>
          </button>
          {feedbacks.slice(-1).map((fb) => (
            <div
              key={fb.id}
              className="text-[11px] font-medium tracking-[0.06em] text-[#f3dc98] hud-text-shadow"
            >
              {fb.text}
            </div>
          ))}
        </div>
      </div>

      {/* MIDDLE FLANKS (Playing / Paused): Score & Hearts Left | Altitude & Airspeed Right */}
      {isPlayingOrPaused && (
        <div className="my-auto flex items-start justify-between pt-2 sm:pt-4">
          {/* Left Column: Spirit Score & Hearts */}
          <div className="hud-text-shadow flex flex-col items-start">
            <span className="text-[10px] font-medium tracking-[0.18em] text-[#f4efe4]/68">
              SPIRIT SCORE
            </span>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                key={hud.scorePulseKey}
                data-testid="hud-score"
                className={`font-serif-display text-3xl sm:text-[42px] leading-none font-normal tracking-[0.04em] text-[#f4efe4] tabular-nums ${
                  hud.scorePulseKey > 0 ? 'animate-score-pulse' : ''
                }`}
              >
                {formattedScore}
              </span>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 1L9.6 6.4L15 8L9.6 9.6L8 15L6.4 9.6L1 8L6.4 6.4L8 1Z"
                  stroke="#ebd494"
                  strokeWidth="1.2"
                />
              </svg>
            </div>
            <div className="mt-1 text-[10px] tracking-[0.14em] text-[#f4efe4]/72 tabular-nums">
              {hud.lanternsCollected} LANTERNS · {hud.gatesCleared} GATES
            </div>
            <div
              className="mt-2.5 flex items-center gap-1.5"
              aria-label={`${hud.hearts} of ${hud.maxHearts} hearts remaining`}
              data-testid="hud-hearts"
            >
              {Array.from({ length: hud.maxHearts }).map((_, idx) => (
                <HeartIcon key={idx} filled={idx < hud.hearts} />
              ))}
            </div>
          </div>

          {/* Right Column: Altitude & Airspeed */}
          <div className="hud-text-shadow flex flex-col items-end text-right">
            <span className="text-[10px] font-medium tracking-[0.18em] text-[#f4efe4]/68">
              ALTITUDE
            </span>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span
                data-testid="hud-altitude"
                className="font-serif-display text-2xl sm:text-[32px] leading-none text-[#f4efe4] tabular-nums"
              >
                {hud.altitudeMeters}
              </span>
              <span className="text-[11px] text-[#f4efe4]/70">m</span>
            </div>

            <span className="mt-3 text-[10px] font-medium tracking-[0.18em] text-[#f4efe4]/68">
              AIRSPEED
            </span>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span
                data-testid="hud-airspeed"
                className={`font-serif-display text-2xl sm:text-[32px] leading-none tabular-nums transition-colors ${
                  hud.isBoosting ? 'text-[#f3dc98]' : 'text-[#f4efe4]'
                }`}
              >
                {hud.airspeedKmh}
              </span>
              <span className="text-[11px] text-[#f4efe4]/70">km/h</span>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM AREA: Journey / Chapter Progress / Control Strip / Mobile Touch Controls */}
      {isPlayingOrPaused && (
        <div className="flex flex-col gap-2.5">
          {/* Mobile Compact Touch Controls (shown on narrow screens < 768px) */}
          <div className="flex items-end justify-between md:hidden pb-1">
            {/* Touch Steering Pad */}
            <div
              ref={padRef}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                activePointerId.current = e.pointerId;
                updateTouchFromEvent(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (activePointerId.current === e.pointerId) {
                  updateTouchFromEvent(e.clientX, e.clientY);
                }
              }}
              onPointerUp={resetTouchPad}
              onPointerCancel={resetTouchPad}
              aria-label="Touch steering pad"
              className="pointer-events-auto hud-surface relative flex h-24 w-24 items-center justify-center rounded-full touch-none"
            >
              <div className="h-12 w-12 rounded-full border border-[#f4efe4]/15" />
              <div
                style={{ transform: `translate3d(${knobOffset.x}px, ${knobOffset.y}px, 0)` }}
                className="absolute h-9 w-9 rounded-full border border-[#ebd494]/70 bg-[#ebd494]/25"
              />
            </div>

            {/* Touch Wind Boost Button */}
            <button
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onTouchBoost(true);
              }}
              onPointerUp={() => onTouchBoost(false)}
              onPointerCancel={() => onTouchBoost(false)}
              aria-label="Hold for wind boost"
              className={`pointer-events-auto hud-surface flex h-20 w-20 flex-col items-center justify-center rounded-full text-[10px] font-medium tracking-[0.12em] touch-none transition-colors ${
                hud.isBoosting
                  ? 'border-[#ebd494] text-[#ebd494]'
                  : 'text-[#f4efe4]/90'
              }`}
            >
              <span>BOOST</span>
              <span className="mt-0.5 text-xs font-serif-display tabular-nums text-[#ebd494]">
                {hud.boostPercent}%
              </span>
            </button>
          </div>

          {/* Desktop Lower-Left & Lower-Right Anchors */}
          <div className="hidden md:flex items-end justify-between gap-4">
            {/* Bottom-Left: Aircraft Badge + Journey Distance */}
            <div className="hud-text-shadow flex flex-col gap-3">
              <div className="flex flex-col items-start">
                <span className="text-[9px] tracking-[0.18em] text-[#f4efe4]/60">
                  1903 WRIGHT FLYER
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onOpenViewer();
                  }}
                  className="pointer-events-auto mt-1 text-xs font-medium text-[#f4efe4]/88 underline decoration-[#f4efe4]/35 underline-offset-4 transition-colors hover:text-[#ebd494] hover:decoration-[#ebd494] cursor-pointer"
                >
                  Explore the aircraft ↗
                </button>
              </div>
              <div>
                <div className="text-xs font-medium text-[#f4efe4]/90">Your journey</div>
                <div className="text-[11px] text-[#f4efe4]/68 tabular-nums" data-testid="hud-distance">
                  {kmText}
                </div>
              </div>
            </div>

            {/* Bottom-Center: 4-Chapter Progress Track */}
            <div className="mb-1 flex-1 max-w-xl px-4">
              <div className="relative h-4 flex items-center">
                <div className="h-px w-full bg-[#f4efe4]/22" />
                <div
                  style={{ width: `${totalProgressPct}%` }}
                  className="absolute left-0 h-[1.5px] bg-[#ebd494]"
                />
                {CHAPTERS.map((ch, idx) => {
                  const pct = (idx / (CHAPTERS.length - 1)) * 100;
                  const reached = hud.distanceMeters >= ch.startZ;
                  const isCurrent = hud.chapterIndex === idx;
                  return (
                    <div
                      key={ch.name}
                      style={{ left: `${pct}%` }}
                      className="absolute -translate-x-1/2 flex flex-col items-center"
                    >
                      <span
                        className={`h-2 w-2 rounded-full border ${
                          isCurrent
                            ? 'border-[#ebd494] bg-[#ebd494]'
                            : reached
                              ? 'border-[#ebd494]/80 bg-[#1a2622]'
                              : 'border-[#f4efe4]/35 bg-[#121c19]'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10px] tracking-[0.04em] hud-text-shadow">
                {CHAPTERS.map((ch, idx) => (
                  <span
                    key={ch.name}
                    className={
                      idx === hud.chapterIndex
                        ? 'font-medium text-[#f4efe4]'
                        : 'text-[#f4efe4]/55'
                    }
                  >
                    {ch.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Bottom-Right: Active Chapter Title & Poetic Subtitle */}
            <div className="hud-text-shadow text-right">
              <div className="text-[10px] font-medium tracking-[0.18em] text-[#ebd494]/90 tabular-nums">
                CHAPTER {currentChapter.roman} · {hud.chapterProgressPercent}%
              </div>
              <div className="font-serif-display text-3xl lg:text-[34px] leading-tight font-medium text-[#f4efe4]">
                {currentChapter.name}
              </div>
              <div className="text-[11px] text-[#f4efe4]/72">{currentChapter.subtitle}</div>
            </div>
          </div>

          {/* Mobile Compact Chapter Bar */}
          <div className="flex md:hidden items-center justify-between text-[11px] hud-text-shadow border-t border-[#f4efe4]/15 pt-1.5">
            <span className="font-serif-display text-sm text-[#f4efe4]">
              {currentChapter.name}
            </span>
            <span className="tabular-nums text-[#f4efe4]/75">{kmText}</span>
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenHelp();
              }}
              className="pointer-events-auto text-[#ebd494] underline underline-offset-2"
            >
              Guide
            </button>
          </div>

          {/* Desktop Bottom-Most Thin Control & Best Strip */}
          <div className="hidden md:flex items-center justify-between border-t border-[#f4efe4]/14 pt-2 text-[11px] text-[#f4efe4]/72 hud-text-shadow">
            <div className="flex items-center gap-4">
              <span>W A S D / Arrows to fly</span>
              <span className="flex items-center gap-2">
                <span>SHIFT wind boost</span>
                <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-[#f4efe4]/18">
                  <span
                    style={{ width: `${hud.boostPercent}%` }}
                    className={`block h-full transition-all duration-75 ${
                      hud.isBoosting ? 'bg-[#f6e2a1]' : 'bg-[#ebd494]/80'
                    }`}
                  />
                </span>
                <span className="tabular-nums text-[#f4efe4]/88" data-testid="hud-boost">
                  {hud.boostPercent}%
                </span>
              </span>
              <span>ESC pause</span>
            </div>

            <div className="text-[10px] tracking-[0.16em] text-[#f4efe4]/68 tabular-nums">
              PERSONAL BEST {hud.bestScore}
            </div>

            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenHelp();
              }}
              className="pointer-events-auto flex items-center gap-1.5 text-[11px] text-[#f4efe4]/82 transition-colors hover:text-[#ebd494] cursor-pointer"
            >
              <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Flight guide</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
