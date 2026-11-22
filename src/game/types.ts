export type GamePhase = 'title' | 'playing' | 'paused' | 'victory' | 'defeat';

export type QualityLevel = 'low' | 'medium' | 'high';

export type AssetSlotId =
  | 'aircraft'
  | 'cedar'
  | 'minka'
  | 'torii'
  | 'lantern'
  | 'rock';

export type SceneVariantMode = 'baseline' | 'enhanced';

export interface ChapterDef {
  index: number;
  roman: string;
  name: string;
  subtitle: string;
  startZ: number;
  endZ: number;
  fogColor: string;
  skyTop: string;
  skyHorizon: string;
  sunColor: string;
}

export interface LanternEntity {
  id: number;
  z: number;
  x: number;
  y: number;
  phaseOffset: number;
  ringRadius: number;
  collected: boolean;
}

export interface ToriiEntity {
  id: number;
  z: number;
  x: number;
  yaw: number;
  openingHalfWidth: number;
  lintelBottomY: number;
  lintelTopY: number;
  pillarRadius: number;
  passed: boolean;
  awarded: boolean;
  damaged: boolean;
}

export interface HousePlacement {
  id: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  scale: number;
  side: -1 | 1;
  terraceRadius: number;
}

export interface CedarPlacement {
  x: number;
  z: number;
  y: number;
  scale: number;
  yaw: number;
  tint: number;
}

export interface RockPlacement {
  x: number;
  z: number;
  y: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  yaw: number;
  tint: number;
}

export interface WaterfallPlacement {
  id: number;
  x: number;
  z: number;
  topY: number;
  width: number;
  side: -1 | 1;
}

export interface DecorativeLanternPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
}

export interface FlightSettings {
  flightAssist: boolean;
  quality: QualityLevel;
  muted: boolean;
  reducedMotion: boolean;
}

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  boost: boolean;
  touchX: number; // -1..1
  touchY: number; // -1..1
}

export interface NearestTargetScreen {
  visible: boolean;
  x: number; // viewport px
  y: number; // viewport px
  distance: number;
  id: number;
}

export interface FloatingFeedback {
  id: number;
  text: string;
  accent: 'gold' | 'vermilion' | 'sage';
}

export interface AssetSlotRecord {
  id: AssetSlotId;
  order: number;
  label: string;
  description: string;
  targetBounds: { width: number; height: number; depth: number };
  orientationNote: string;
  provenance: 'procedural-baseline' | 'imported-glb';
  fileName: string | null;
  triangleCount: number;
  updatedAt: number | null;
}

export interface RunSummarySnapshot {
  outcome: 'victory' | 'defeat';
  score: number;
  bestScore: number;
  isNewBest: boolean;
  lanternsCollected: number;
  totalLanterns: number;
  gatesCleared: number;
  totalGates: number;
  distanceMeters: number;
  elapsedSeconds: number;
  heartsRemaining: number;
}

export interface HudSnapshot {
  phase: GamePhase;
  score: number;
  bestScore: number;
  hearts: number;
  maxHearts: number;
  invulnerable: boolean;
  lanternsCollected: number;
  gatesCleared: number;
  distanceMeters: number;
  routeLength: number;
  altitudeMeters: number;
  airspeedKmh: number;
  boostPercent: number;
  isBoosting: boolean;
  headingDeg: number;
  chapterIndex: number;
  chapterProgressPercent: number;
  nearestTarget: NearestTargetScreen;
  scorePulseKey: number;
  variantMode: SceneVariantMode;
  isComparing: boolean;
  importedSlotCount: number;
  damageFlash: number;
  summary: RunSummarySnapshot | null;
}
