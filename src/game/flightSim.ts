import {
  ROUTE_LENGTH,
  WATER_LEVEL,
  getChapterForDistance,
  getWorldRouteData,
  groundHeightAt,
  riverCenterX,
  riverHalfWidthAt,
  riverSlopeX,
  targetCruiseAltitude,
} from './worldMath';
import type {
  GamePhase,
  InputState,
  LanternEntity,
  RunSummarySnapshot,
  ToriiEntity,
} from './types';

export const MAX_HEARTS = 3;
export const LANTERN_POINTS = 100;
export const TORII_POINTS = 250;
export const INVULN_DURATION = 2.0; // seconds after collision

export const BASE_SPEED = 22.8; // m/s (~82 km/h)
export const BOOST_SPEED = 38.4; // m/s (~138 km/h)
export const MIN_ALTITUDE = 2.4;
export const MAX_ALTITUDE = 31.0;

const BEST_SCORE_STORAGE_KEY = 'komorebi_forest_flight_best_v1';
let memoryBestScoreFallback = 0;

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadBestScore(storage?: StorageAdapter | null): number {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    if (!store) return memoryBestScoreFallback;
    const raw = store.getItem(BEST_SCORE_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    if (Number.isFinite(parsed) && parsed > 0) {
      memoryBestScoreFallback = Math.max(memoryBestScoreFallback, parsed);
      return memoryBestScoreFallback;
    }
    return memoryBestScoreFallback;
  } catch {
    return memoryBestScoreFallback;
  }
}

export function saveBestScore(score: number, storage?: StorageAdapter | null): number {
  const safeScore = Math.max(0, Math.round(score));
  memoryBestScoreFallback = Math.max(memoryBestScoreFallback, safeScore);
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    if (store) {
      store.setItem(BEST_SCORE_STORAGE_KEY, String(memoryBestScoreFallback));
    }
  } catch {
    // Storage quota or private browsing failure: fallback stays in memory
  }
  return memoryBestScoreFallback;
}

export interface SimEvent {
  type: 'lantern' | 'torii' | 'damage' | 'victory' | 'defeat';
  x: number;
  y: number;
  z: number;
  points?: number;
  reason?: string;
}

export interface FlightSimState {
  phase: GamePhase;
  dist: number; // positive distance along route [0..ROUTE_LENGTH]
  x: number;
  y: number;
  z: number; // worldZ = -dist
  vx: number;
  vy: number;
  speed: number; // m/s
  roll: number; // radians
  pitch: number; // radians
  yaw: number; // radians
  boost: number; // 0..100
  isBoosting: boolean;
  boostExhausted: boolean;
  score: number;
  bestScore: number;
  hearts: number;
  invulnTimer: number;
  damageFlash: number;
  cameraTrauma: number;
  elapsedSeconds: number;
  simTime: number;
  lanternsCollected: number;
  gatesCleared: number;
  lanterns: LanternEntity[];
  toriis: ToriiEntity[];
  summary: RunSummarySnapshot | null;
}

export function createInitialFlightState(storage?: StorageAdapter | null): FlightSimState {
  const route = getWorldRouteData();
  const startDist = 14;
  const startX = riverCenterX(startDist);
  const startY = targetCruiseAltitude(startDist);

  return {
    phase: 'title',
    dist: startDist,
    x: startX,
    y: startY,
    z: -startDist,
    vx: 0,
    vy: 0,
    speed: BASE_SPEED,
    roll: 0,
    pitch: 0,
    yaw: Math.atan2(-riverSlopeX(startDist), 1),
    boost: 100,
    isBoosting: false,
    boostExhausted: false,
    score: 0,
    bestScore: loadBestScore(storage),
    hearts: MAX_HEARTS,
    invulnTimer: 0,
    damageFlash: 0,
    cameraTrauma: 0,
    elapsedSeconds: 0,
    simTime: 0,
    lanternsCollected: 0,
    gatesCleared: 0,
    lanterns: route.lanterns.map((l) => ({ ...l, collected: false })),
    toriis: route.toriis.map((t) => ({
      ...t,
      passed: false,
      awarded: false,
      damaged: false,
    })),
    summary: null,
  };
}

export function resetForNewRun(state: FlightSimState, storage?: StorageAdapter | null): void {
  const fresh = createInitialFlightState(storage);
  Object.assign(state, fresh);
  state.phase = 'playing';
}

export function getAnimatedLanternY(lantern: LanternEntity, simTime: number): number {
  return lantern.y + Math.sin(simTime * 1.9 + lantern.phaseOffset) * 0.65;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function applyDamage(
  state: FlightSimState,
  reason: string,
  events: SimEvent[],
  storage?: StorageAdapter | null,
): void {
  if (state.invulnTimer > 0 || state.phase !== 'playing') return;

  state.hearts = Math.max(0, state.hearts - 1);
  state.invulnTimer = INVULN_DURATION;
  state.damageFlash = 1.0;
  state.cameraTrauma = Math.min(1, state.cameraTrauma + 0.65);

  events.push({
    type: 'damage',
    x: state.x,
    y: state.y,
    z: state.z,
    reason,
  });

  // Gently nudge aircraft back toward safe airspace so the player isn't trapped
  const centerX = riverCenterX(state.dist);
  const safeY = Math.max(targetCruiseAltitude(state.dist), groundHeightAt(state.x, state.z) + 5.5);
  state.y = Math.max(state.y + 1.8, safeY * 0.65 + state.y * 0.35);
  state.vx = (centerX - state.x) * 1.4;
  state.vy = 2.5;

  if (state.hearts <= 0) {
    const prevBest = state.bestScore;
    const nextBest = saveBestScore(state.score, storage);
    state.bestScore = nextBest;
    state.phase = 'defeat';
    state.summary = {
      outcome: 'defeat',
      score: state.score,
      bestScore: nextBest,
      isNewBest: state.score > prevBest && state.score > 0,
      lanternsCollected: state.lanternsCollected,
      totalLanterns: state.lanterns.length,
      gatesCleared: state.gatesCleared,
      totalGates: state.toriis.length,
      distanceMeters: Math.round(state.dist),
      elapsedSeconds: state.elapsedSeconds,
      heartsRemaining: 0,
    };
    events.push({
      type: 'defeat',
      x: state.x,
      y: state.y,
      z: state.z,
    });
  }
}

/**
 * Pure simulation step. Advances title hover or active flight, steering,
 * boost reserve, flight assist, lantern pickups, torii crossings, and hazards.
 */
export function stepFlightSimulation(
  state: FlightSimState,
  input: InputState,
  rawDt: number,
  flightAssist: boolean,
  storage?: StorageAdapter | null,
): SimEvent[] {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  const events: SimEvent[] = [];

  if (dt <= 0) return events;

  state.simTime += dt;
  state.damageFlash = Math.max(0, state.damageFlash - dt * 2.2);
  state.cameraTrauma = Math.max(0, state.cameraTrauma - dt * 1.4);

  // Title screen: gentle serene preview hover/glide over the opening river vista
  if (state.phase === 'title') {
    const previewDist = 14 + ((state.simTime * 5.2) % 62);
    const targetX = riverCenterX(previewDist) + Math.sin(state.simTime * 0.65) * 1.6;
    const targetY = targetCruiseAltitude(previewDist) + Math.sin(state.simTime * 1.1) * 0.55;
    state.dist = previewDist;
    state.x = targetX;
    state.y = targetY;
    state.z = -previewDist;
    state.speed = BASE_SPEED;
    state.yaw = Math.atan2(-riverSlopeX(previewDist), 1);
    state.roll = Math.cos(state.simTime * 0.65) * -0.09;
    state.pitch = Math.cos(state.simTime * 1.1) * 0.04;
    return events;
  }

  if (state.phase !== 'playing') {
    return events;
  }

  state.elapsedSeconds += dt;
  if (state.invulnTimer > 0) {
    state.invulnTimer = Math.max(0, state.invulnTimer - dt);
  }

  // Gather combined keyboard + touch inputs in [-1, 1]
  const steerKey = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const climbKey = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  const steerInput = Math.max(-1, Math.min(1, steerKey + input.touchX));
  const climbInput = Math.max(-1, Math.min(1, climbKey + input.touchY));

  // Wind boost reserve management (recharges smoothly when not boosting)
  if (state.boostExhausted && state.boost >= 18) {
    state.boostExhausted = false;
  }
  const wantsBoost = input.boost && !state.boostExhausted && state.boost > 1;
  if (wantsBoost) {
    state.isBoosting = true;
    state.boost = Math.max(0, state.boost - 34 * dt);
    if (state.boost <= 0.5) {
      state.boost = 0;
      state.boostExhausted = true;
      state.isBoosting = false;
    }
  } else {
    state.isBoosting = false;
    state.boost = Math.min(100, state.boost + 18 * dt);
  }

  const targetSpeed = state.isBoosting ? BOOST_SPEED : BASE_SPEED;
  state.speed = damp(state.speed, targetSpeed, 4.2, dt);

  const prevDist = state.dist;
  state.dist = Math.min(ROUTE_LENGTH, state.dist + state.speed * dt);
  state.z = -state.dist;

  // River corridor guidance
  const centerX = riverCenterX(state.dist);
  const slopeX = riverSlopeX(state.dist);
  const halfWidth = riverHalfWidthAt(state.dist);
  const cruiseAlt = targetCruiseAltitude(state.dist);

  // Follow the river curve smoothly while letting player steer freely across the valley
  const riverDriftVx = slopeX * state.speed;
  const maxLateralSpeed = 16.5;

  let desiredVx = riverDriftVx + steerInput * maxLateralSpeed;
  let desiredVy = climbInput * 10.5;

  // Default flight assist gently centers toward the river and cruise altitude when input is released
  if (flightAssist) {
    if (Math.abs(steerInput) < 0.05) {
      const lateralErr = centerX - state.x;
      desiredVx += Math.max(-9.5, Math.min(9.5, lateralErr * 0.85));
    }
    if (Math.abs(climbInput) < 0.05) {
      const altErr = cruiseAlt - state.y;
      desiredVy += Math.max(-5.2, Math.min(5.2, altErr * 0.72));
    }
  } else {
    // Even with assist off, gently follow river bend slightly less aggressively so steering feels crisp
    desiredVx = riverDriftVx * 0.35 + steerInput * (maxLateralSpeed * 1.15);
  }

  state.vx = damp(state.vx, desiredVx, 6.2, dt);
  state.vy = damp(state.vy, desiredVy, 6.2, dt);

  state.x += state.vx * dt;
  state.y += state.vy * dt;

  // Soft outer valley ceiling & corridor boundary
  const maxCorridorOffset = halfWidth + 24;
  if (state.x < centerX - maxCorridorOffset) {
    state.x = centerX - maxCorridorOffset;
    state.vx = Math.max(0, state.vx);
  } else if (state.x > centerX + maxCorridorOffset) {
    state.x = centerX + maxCorridorOffset;
    state.vx = Math.min(0, state.vx);
  }

  if (state.y > MAX_ALTITUDE) {
    state.y = MAX_ALTITUDE;
    state.vy = Math.min(0, state.vy);
  }

  // Smooth aerodynamic banking (roll), pitch, and heading yaw
  const relVx = state.vx - riverDriftVx;
  const targetRoll = Math.max(-0.46, Math.min(0.46, -relVx * 0.028));
  const targetPitch = Math.max(-0.26, Math.min(0.28, state.vy * 0.025));
  const targetYaw = Math.atan2(-state.vx, state.speed);

  state.roll = damp(state.roll, targetRoll, 7.5, dt);
  state.pitch = damp(state.pitch, targetPitch, 7.0, dt);
  state.yaw = damp(state.yaw, targetYaw, 6.5, dt);

  // 1. Spirit Lantern Collection (generous hit volume aligned with animated bobbing ring)
  for (let i = 0; i < state.lanterns.length; i++) {
    const lantern = state.lanterns[i];
    if (lantern.collected) continue;

    const lanternDist = -lantern.z;
    // Quick longitudinal cull
    if (lanternDist < prevDist - 7 || lanternDist > state.dist + 7) continue;

    const animY = getAnimatedLanternY(lantern, state.simTime);
    const dx = state.x - lantern.x;
    const dy = state.y - animY;
    const dz = state.z - lantern.z;

    // Generous ellipsoid aligned to the glowing oval collection ring
    const rx = lantern.ringRadius + 2.4; // accounts for Wright Flyer wingspan!
    const ry = lantern.ringRadius + 1.8;
    const rz = 5.2;
    const normDistSq = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);

    if (normDistSq <= 1.0) {
      lantern.collected = true;
      state.score += LANTERN_POINTS;
      state.lanternsCollected += 1;
      events.push({
        type: 'lantern',
        x: lantern.x,
        y: animY,
        z: lantern.z,
        points: LANTERN_POINTS,
      });
    }
  }

  // 2. Torii Gate Crossings & Beam/Post Collisions (independent of mesh shape)
  for (let i = 0; i < state.toriis.length; i++) {
    const gate = state.toriis[i];
    const gateDist = -gate.z;

    // Check beam/pillar collision near gate plane
    if (!gate.damaged && Math.abs(state.dist - gateDist) < 2.2) {
      const dx = state.x - gate.x;
      const absDx = Math.abs(dx);

      // Left or right pillar hit (aircraft half wingspan ~3.0m)
      const hitLeftOrRightPillar =
        Math.abs(absDx - gate.openingHalfWidth) < gate.pillarRadius + 1.85 &&
        state.y < gate.lintelTopY + 1.2;

      // Upper lintel beam hit
      const hitUpperLintel =
        absDx < gate.openingHalfWidth + 4.8 &&
        state.y >= gate.lintelBottomY - 0.9 &&
        state.y <= gate.lintelTopY + 1.1;

      if (hitLeftOrRightPillar || hitUpperLintel) {
        gate.damaged = true;
        applyDamage(state, 'torii', events, storage);
        if (state.phase !== 'playing') return events;
      }
    }

    // Check clean crossing once the aircraft crosses the gate Z plane
    if (!gate.passed && prevDist < gateDist && state.dist >= gateDist) {
      gate.passed = true;
      const absDx = Math.abs(state.x - gate.x);
      const isClearThrough =
        !gate.damaged &&
        absDx < gate.openingHalfWidth - 1.1 &&
        state.y > WATER_LEVEL + 1.5 &&
        state.y < gate.lintelBottomY - 0.5;

      if (isClearThrough && !gate.awarded) {
        gate.awarded = true;
        state.score += TORII_POINTS;
        state.gatesCleared += 1;
        events.push({
          type: 'torii',
          x: gate.x,
          y: state.y,
          z: gate.z,
          points: TORII_POINTS,
        });
      }
    }
  }

  // 3. Water / Ground / Riverbank Collisions
  const terrainY = groundHeightAt(state.x, state.z);
  const floorHeight = Math.max(WATER_LEVEL, terrainY);
  const minClearance = 1.65;

  if (state.y < floorHeight + minClearance) {
    state.y = floorHeight + minClearance;
    applyDamage(state, terrainY > WATER_LEVEL + 0.5 ? 'bank' : 'water', events, storage);
    if (state.phase !== 'playing') return events;
  }

  // 4. Route Completion at 3.6 km (Cloud Sanctuary)
  if (state.dist >= ROUTE_LENGTH) {
    const prevBest = state.bestScore;
    const nextBest = saveBestScore(state.score, storage);
    state.bestScore = nextBest;
    state.phase = 'victory';
    state.summary = {
      outcome: 'victory',
      score: state.score,
      bestScore: nextBest,
      isNewBest: state.score > prevBest && state.score > 0,
      lanternsCollected: state.lanternsCollected,
      totalLanterns: state.lanterns.length,
      gatesCleared: state.gatesCleared,
      totalGates: state.toriis.length,
      distanceMeters: ROUTE_LENGTH,
      elapsedSeconds: state.elapsedSeconds,
      heartsRemaining: state.hearts,
    };
    events.push({
      type: 'victory',
      x: state.x,
      y: state.y,
      z: state.z,
    });
  }

  return events;
}

export function findNearestUpcomingLantern(state: FlightSimState): LanternEntity | null {
  let nearest: LanternEntity | null = null;
  let bestAhead = Infinity;
  for (let i = 0; i < state.lanterns.length; i++) {
    const l = state.lanterns[i];
    if (l.collected) continue;
    const ahead = -l.z - state.dist;
    if (ahead > 4 && ahead < 130 && ahead < bestAhead) {
      bestAhead = ahead;
      nearest = l;
    }
  }
  return nearest;
}

export function getCompassHeadingDegrees(yawRadians: number): number {
  // 0 deg = North (-Z), 90 deg = East (+X), 270 deg = West (-X)
  const deg = ((-yawRadians * 180) / Math.PI) % 360;
  return (deg + 360) % 360;
}

export function getChapterProgress(dist: number) {
  return getChapterForDistance(dist);
}
