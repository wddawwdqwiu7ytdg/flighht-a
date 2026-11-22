import type {
  CedarPlacement,
  ChapterDef,
  DecorativeLanternPlacement,
  HousePlacement,
  LanternEntity,
  RockPlacement,
  ToriiEntity,
  WaterfallPlacement,
} from './types';

export const ROUTE_LENGTH = 3600; // 3.6 km deterministic route
export const WATER_LEVEL = 0;
export const RIVER_HALF_WIDTH = 17.5;

export const CHAPTERS: ChapterDef[] = [
  {
    index: 0,
    roman: 'I',
    name: 'Whispering Woods',
    subtitle: 'Where every leaf holds a little magic.',
    startZ: 0,
    endZ: 900,
    fogColor: '#98a9a1',
    skyTop: '#8aa09a',
    skyHorizon: '#c2cfc7',
    sunColor: '#fff0cf',
  },
  {
    index: 1,
    roman: 'II',
    name: 'Hidden Falls',
    subtitle: 'Mist rises where mountain waters meet.',
    startZ: 900,
    endZ: 1800,
    fogColor: '#8ea4a3',
    skyTop: '#7a9697',
    skyHorizon: '#bccdc9',
    sunColor: '#f8edd8',
  },
  {
    index: 2,
    roman: 'III',
    name: 'Lantern Valley',
    subtitle: 'Warm light guides the quiet wind.',
    startZ: 1800,
    endZ: 2700,
    fogColor: '#9ca494',
    skyTop: '#7c8c84',
    skyHorizon: '#cbbca1',
    sunColor: '#ffdfb0',
  },
  {
    index: 3,
    roman: 'IV',
    name: 'Cloud Sanctuary',
    subtitle: 'Above the cedars, the mountain waits.',
    startZ: 2700,
    endZ: 3600,
    fogColor: '#adbab4',
    skyTop: '#92a8a5',
    skyHorizon: '#d7dfd9',
    sunColor: '#fff4dc',
  },
];

/**
 * Deterministic seeded PRNG (Mulberry32) so the entire 3.6 km route
 * reproduces identical scenery, houses, lanterns, and gates every run.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Primary winding river centerline curve specified by the design brief:
 * x(z) = sin(0.006 * z) * 19 + sin(0.017 * z) * 5
 * Note: `dist` is positive distance traveled along the route [0..3600].
 * In Three.js world space, the plane flies forward along -Z (worldZ = -dist).
 */
export function riverCenterX(dist: number): number {
  return Math.sin(0.006 * dist) * 19 + Math.sin(0.017 * dist) * 5;
}

/** Derivative dx/d(dist) of the river centerline for yaw/heading alignment. */
export function riverSlopeX(dist: number): number {
  return Math.cos(0.006 * dist) * 19 * 0.006 + Math.cos(0.017 * dist) * 5 * 0.017;
}

/** River half-width varies gently along the 3.6 km valley. */
export function riverHalfWidthAt(dist: number): number {
  const pulse = Math.sin(dist * 0.0045) * 2.2 + Math.cos(dist * 0.011) * 1.1;
  return RIVER_HALF_WIDTH + pulse;
}

/** Natural cruise altitude above water for the assisted flight path. */
export function targetCruiseAltitude(dist: number): number {
  return 11.5 + Math.sin(dist * 0.009) * 1.8 + Math.cos(dist * 0.0032) * 1.0;
}

export function getChapterForDistance(dist: number): {
  chapter: ChapterDef;
  progressPercent: number;
} {
  const clamped = Math.max(0, Math.min(ROUTE_LENGTH, dist));
  const idx = Math.min(CHAPTERS.length - 1, Math.floor(clamped / 900));
  const chapter = CHAPTERS[idx];
  const localProgress = (clamped - chapter.startZ) / (chapter.endZ - chapter.startZ);
  return {
    chapter,
    progressPercent: Math.max(0, Math.min(100, Math.round(localProgress * 100))),
  };
}

/** Smooth noise helper for organic rolling riverbanks (no angular walls). */
function smoothHillNoise(x: number, dist: number): number {
  return (
    Math.sin(x * 0.045 + dist * 0.012) * 2.4 +
    Math.cos(x * 0.028 - dist * 0.019) * 3.1 +
    Math.sin(x * 0.085 + dist * 0.031) * 0.9
  );
}

/** Base terrain elevation before house terrace flattening. */
export function rawGroundHeightAt(x: number, dist: number): number {
  const centerX = riverCenterX(dist);
  const halfW = riverHalfWidthAt(dist);
  const absOffset = Math.abs(x - centerX);

  if (absOffset < halfW - 1.5) {
    // Riverbed smoothly dips underwater
    const t = absOffset / Math.max(1, halfW - 1.5);
    return -2.4 + t * t * 1.5;
  }

  // Smooth bank rise from water edge outward
  const bankDist = absOffset - (halfW - 1.5);
  const bankTransition = Math.min(1, bankDist / 10);
  const smoothBank = bankTransition * bankTransition * (3 - 2 * bankTransition);

  // Outer valley gentle foothills
  const valleyRise =
    bankDist > 12 ? Math.pow((bankDist - 12) * 0.055, 1.45) * 11.5 : 0;

  // Chapter II (Hidden Falls) gets slightly higher cliffs on outer flanks
  const fallsWeight =
    dist > 820 && dist < 1880
      ? Math.sin(((dist - 820) / 1060) * Math.PI)
      : 0;
  const cliffBoost =
    fallsWeight * Math.max(0, (bankDist - 18) * 0.38);

  const noise = smoothHillNoise(x, dist) * Math.min(1, bankDist / 16);
  return -0.9 + smoothBank * 3.6 + valleyRise + cliffBoost + Math.max(0, noise * 0.55);
}

export interface WorldRouteData {
  lanterns: LanternEntity[];
  toriis: ToriiEntity[];
  houses: HousePlacement[];
  cedars: CedarPlacement[];
  rocks: RockPlacement[];
  waterfalls: WaterfallPlacement[];
  decorativeLanterns: DecorativeLanternPlacement[];
}

function generateHouses(): HousePlacement[] {
  const rng = createRng(190304);
  const houses: HousePlacement[] = [];
  let id = 1;

  for (let dist = 95; dist <= ROUTE_LENGTH - 140; dist += 135) {
    const jitter = id === 1 ? 0 : (rng() - 0.5) * 32;
    const d = Math.max(85, Math.min(ROUTE_LENGTH - 120, dist + jitter));
    const side: -1 | 1 = id % 2 === 1 ? 1 : -1;
    const halfW = riverHalfWidthAt(d);
    const bankOffset = halfW + (id === 1 ? 13.5 : 14.5 + rng() * 9.5);
    const x = riverCenterX(d) + side * bankOffset;
    const rawY = rawGroundHeightAt(x, d);
    // Keep houses nicely elevated above water on a terrace mound
    const terraceY = Math.max(3.0, Math.min(10.5, rawY + 0.8));
    const slope = riverSlopeX(d);
    const baseYaw = Math.atan2(slope, -1);
    const faceRiverYaw = baseYaw + (side === 1 ? -Math.PI * 0.5 : Math.PI * 0.5) + (rng() - 0.5) * 0.35;

    houses.push({
      id,
      x,
      z: -d,
      y: terraceY,
      yaw: faceRiverYaw,
      scale: 0.92 + rng() * 0.24,
      side,
      terraceRadius: 11.5,
    });
    id += 1;
  }

  return houses;
}

const CACHED_HOUSES: HousePlacement[] = generateHouses();

/**
 * Final deterministic ground height at world coordinates (x, worldZ),
 * smoothly terraced around every Minka house footprint so all four corners
 * sit solidly on level ground with zero floating.
 */
export function groundHeightAt(x: number, worldZ: number): number {
  const dist = -worldZ;
  let h = rawGroundHeightAt(x, dist);

  for (let i = 0; i < CACHED_HOUSES.length; i++) {
    const house = CACHED_HOUSES[i];
    const dz = worldZ - house.z;
    if (Math.abs(dz) > house.terraceRadius * 2.1) continue;
    const dx = x - house.x;
    if (Math.abs(dx) > house.terraceRadius * 2.1) continue;

    const r = Math.hypot(dx, dz);
    const flatRadius = house.terraceRadius * 0.72;
    const blendOuter = house.terraceRadius * 1.85;
    if (r <= flatRadius) {
      return house.y;
    }
    if (r < blendOuter) {
      const t = (r - flatRadius) / (blendOuter - flatRadius);
      const smooth = t * t * (3 - 2 * t);
      h = house.y * (1 - smooth) + h * smooth;
    }
  }

  return h;
}

/** Verify all four corners of a house footprint lie cleanly on its terrace. */
export function getHouseCornerGroundHeights(house: HousePlacement): number[] {
  const halfW = 4.6 * house.scale;
  const halfD = 3.8 * house.scale;
  const cos = Math.cos(house.yaw);
  const sin = Math.sin(house.yaw);
  const corners = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [halfW, halfD],
    [-halfW, halfD],
  ];
  return corners.map(([lx, lz]) => {
    const wx = house.x + lx * cos - lz * sin;
    const wz = house.z + lx * sin + lz * cos;
    return groundHeightAt(wx, wz);
  });
}

let CACHED_ROUTE: WorldRouteData | null = null;

/**
 * Generates the complete deterministic 3.6 km world layout:
 * - 36 Spirit Lanterns inside golden collection rings
 * - 14 Torii Gates aligned along the assisted river corridor
 * - Terraced Minka timber houses along both banks
 * - Layered Japanese Cedar forest (never blocking the river corridor)
 * - Rounded mossy river rocks along shallow banks
 * - Waterfall sheets in Hidden Falls (Chapter II)
 * - Smaller decorative lanterns near houses, shrines, and Lantern Valley
 */
export function getWorldRouteData(): WorldRouteData {
  if (CACHED_ROUTE) return CACHED_ROUTE;

  const rng = createRng(20261903);
  const lanterns: LanternEntity[] = [];
  const toriis: ToriiEntity[] = [];
  const cedars: CedarPlacement[] = [];
  const rocks: RockPlacement[] = [];
  const waterfalls: WaterfallPlacement[] = [];
  const decorativeLanterns: DecorativeLanternPlacement[] = [];

  // 1. Torii Gates spaced evenly along the assisted flight path
  let gateId = 1;
  for (let dist = 165; dist <= ROUTE_LENGTH - 110; dist += 245) {
    const cx = riverCenterX(dist);
    const slope = riverSlopeX(dist);
    // Tangent along forward travel (-Z) is (dx/ddist, -1)
    const yaw = Math.atan2(-slope, 1);
    toriis.push({
      id: gateId++,
      z: -dist,
      x: cx,
      yaw,
      openingHalfWidth: 11.2,
      lintelBottomY: 20.5,
      lintelTopY: 24.4,
      pillarRadius: 1.05,
      passed: false,
      awarded: false,
      damaged: false,
    });
  }

  // Final Sanctuary Grand Torii near 3540m
  {
    const finalDist = ROUTE_LENGTH - 60;
    const cx = riverCenterX(finalDist);
    const slope = riverSlopeX(finalDist);
    toriis.push({
      id: gateId++,
      z: -finalDist,
      x: cx,
      yaw: Math.atan2(-slope, 1),
      openingHalfWidth: 12.2,
      lintelBottomY: 22.0,
      lintelTopY: 26.0,
      pillarRadius: 1.15,
      passed: false,
      awarded: false,
      damaged: false,
    });
  }

  // 2. Spirit Lanterns (collectibles) along flowing S-arcs over the river
  let lanternId = 1;
  for (let dist = 75; dist <= ROUTE_LENGTH - 95; dist += 92) {
    // Avoid overlapping exact torii gate Z plane
    let adjustedDist = dist;
    for (const gate of toriis) {
      if (Math.abs(-gate.z - adjustedDist) < 16) {
        adjustedDist += 22;
      }
    }
    if (adjustedDist > ROUTE_LENGTH - 85) continue;

    const cx = riverCenterX(adjustedDist);
    // Gentle lateral weave within the safe central corridor so flight feels playful
    const weave = Math.sin(lanternId * 1.15) * 6.2;
    const altBase = targetCruiseAltitude(adjustedDist);
    const altOffset = Math.cos(lanternId * 0.9) * 2.6;

    lanterns.push({
      id: lanternId,
      z: -adjustedDist,
      x: cx + weave,
      y: Math.max(7.2, Math.min(17.5, altBase + altOffset)),
      phaseOffset: lanternId * 0.85,
      ringRadius: 5.8,
      collected: false,
    });
    lanternId += 1;
  }

  // 3. Waterfalls in Chapter II (Hidden Falls: 920m - 1760m) + 1 scenic falls in Cloud Sanctuary
  const waterfallSpecs: Array<{ dist: number; side: -1 | 1; width: number; topY: number }> = [
    { dist: 980, side: 1, width: 9.5, topY: 36 },
    { dist: 1180, side: -1, width: 11.5, topY: 40 },
    { dist: 1390, side: 1, width: 10.0, topY: 38 },
    { dist: 1580, side: -1, width: 12.0, topY: 42 },
    { dist: 1740, side: 1, width: 9.0, topY: 35 },
    { dist: 3040, side: -1, width: 10.5, topY: 44 },
  ];
  waterfallSpecs.forEach((spec, i) => {
    const halfW = riverHalfWidthAt(spec.dist);
    const wx = riverCenterX(spec.dist) + spec.side * (halfW + 17.5);
    waterfalls.push({
      id: i + 1,
      x: wx,
      z: -spec.dist,
      topY: spec.topY,
      width: spec.width,
      side: spec.side,
    });
  });

  // 4. Japanese Cedars along both banks (keeping house footprints & river clear)
  for (let dist = -40; dist <= ROUTE_LENGTH + 140; dist += 13) {
    const cx = riverCenterX(dist);
    const halfW = riverHalfWidthAt(dist);

    for (const side of [-1, 1] as const) {
      // 3 layered depth bands of cedars per side for rich misty forest depth
      const bands = [
        { minOff: halfW + 5.5, spread: 14, prob: 0.85, scaleMin: 0.9, scaleMax: 1.45 },
        { minOff: halfW + 20, spread: 24, prob: 0.92, scaleMin: 1.05, scaleMax: 1.75 },
        { minOff: halfW + 44, spread: 34, prob: 0.72, scaleMin: 1.2, scaleMax: 2.0 },
      ];

      for (const band of bands) {
        if (rng() > band.prob) continue;
        const d = dist + (rng() - 0.5) * 11;
        const x = cx + side * (band.minOff + rng() * band.spread);
        const wz = -d;

        // Keep house terraces clear of trees
        let blockedByHouse = false;
        for (const h of CACHED_HOUSES) {
          const distH = Math.hypot(x - h.x, wz - h.z);
          if (distH < h.terraceRadius * 1.02) {
            blockedByHouse = true;
            break;
          }
        }
        if (blockedByHouse) continue;

        // Keep waterfall sheets clear
        let blockedByFalls = false;
        for (const wf of waterfalls) {
          if (Math.hypot(x - wf.x, wz - wf.z) < 12) {
            blockedByFalls = true;
            break;
          }
        }
        if (blockedByFalls) continue;

        const y = groundHeightAt(x, wz);
        if (y < 0.8) continue;

        cedars.push({
          x,
          z: wz,
          y: y - 0.35, // embed buttress roots cleanly into soil
          scale: band.scaleMin + rng() * (band.scaleMax - band.scaleMin),
          yaw: rng() * Math.PI * 2,
          tint: rng(),
        });
      }
    }
  }

  // 5. Rounded mossy river rocks along shallow river edges (never blocking corridor)
  for (let dist = -20; dist <= ROUTE_LENGTH + 80; dist += 7.5) {
    const cx = riverCenterX(dist);
    const halfW = riverHalfWidthAt(dist);

    for (const side of [-1, 1] as const) {
      const clusterCount = rng() < 0.65 ? 2 : 1;
      for (let k = 0; k < clusterCount; k++) {
        const d = dist + (rng() - 0.5) * 6.5;
        // Hug the waterline & shallow edges
        const edgeOffset = halfW - 3.6 + rng() * 6.4;
        const x = cx + side * edgeOffset;
        const wz = -d;
        const gY = groundHeightAt(x, wz);
        const baseScale = 0.75 + rng() * 1.45;
        rocks.push({
          x,
          z: wz,
          y: Math.min(gY, WATER_LEVEL + 0.15) - 0.25,
          scaleX: baseScale * (0.9 + rng() * 0.55),
          scaleY: baseScale * (0.48 + rng() * 0.35),
          scaleZ: baseScale * (0.85 + rng() * 0.55),
          yaw: rng() * Math.PI * 2,
          tint: rng(),
        });
      }
    }
  }

  // 6. Decorative bank lanterns (same model family, smaller & non-collectible)
  // Place pairs near each Minka house and dense warm rows in Lantern Valley (Chapter III)
  for (const house of CACHED_HOUSES) {
    const towardRiverX = house.x - house.side * 5.6;
    const wz = house.z + 2.5;
    const gy = groundHeightAt(towardRiverX, wz);
    decorativeLanterns.push({
      x: towardRiverX,
      y: Math.max(WATER_LEVEL + 1.8, gy + 2.2),
      z: wz,
      scale: 0.48,
    });
  }

  for (let dist = 1820; dist <= 2680; dist += 42) {
    const cx = riverCenterX(dist);
    const halfW = riverHalfWidthAt(dist);
    const side: -1 | 1 = Math.floor(dist / 42) % 2 === 0 ? 1 : -1;
    const x = cx + side * (halfW + 2.8);
    const wz = -dist;
    const gy = groundHeightAt(x, wz);
    decorativeLanterns.push({
      x,
      y: Math.max(WATER_LEVEL + 2.0, gy + 2.4),
      z: wz,
      scale: 0.46,
    });
  }

  CACHED_ROUTE = {
    lanterns,
    toriis,
    houses: CACHED_HOUSES,
    cedars,
    rocks,
    waterfalls,
    decorativeLanterns,
  };

  return CACHED_ROUTE;
}
