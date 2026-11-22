import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_SPEED,
  INVULN_DURATION,
  LANTERN_POINTS,
  MAX_HEARTS,
  TORII_POINTS,
  createInitialFlightState,
  getAnimatedLanternY,
  loadBestScore,
  resetForNewRun,
  saveBestScore,
  stepFlightSimulation,
} from './flightSim';
import { ROUTE_LENGTH } from './worldMath';
import type { InputState } from './types';

function emptyInput(): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    boost: false,
    touchX: 0,
    touchY: 0,
  };
}

test('flight survives opening seconds hands-free with flight assist enabled', () => {
  const state = createInitialFlightState(null);
  resetForNewRun(state, null);

  for (let i = 0; i < 200; i++) {
    stepFlightSimulation(state, emptyInput(), 0.05, true, null);
  }

  assert.equal(state.phase, 'playing');
  assert.equal(state.hearts, MAX_HEARTS);
  assert.ok(state.dist > 150, 'aircraft should progress automatically forward');
});

test('wind boost drains reserve, increases speed, and recharges on release', () => {
  const state = createInitialFlightState(null);
  resetForNewRun(state, null);

  const boostInput = { ...emptyInput(), boost: true };
  for (let i = 0; i < 30; i++) {
    stepFlightSimulation(state, boostInput, 0.05, true, null);
  }

  assert.ok(state.speed > BASE_SPEED + 8, 'boost should accelerate airspeed');
  assert.ok(state.boost < 65, 'boost reserve should drain while active');

  const boostAfterDrain = state.boost;
  for (let i = 0; i < 30; i++) {
    stepFlightSimulation(state, emptyInput(), 0.05, true, null);
  }
  assert.ok(state.boost > boostAfterDrain + 10, 'boost should recharge after release');
});

test('lantern awards +100 exactly once when flying through its animated ring', () => {
  const state = createInitialFlightState(null);
  resetForNewRun(state, null);

  const target = state.lanterns[0];
  state.dist = -target.z - 0.5;
  state.z = -state.dist;
  state.x = target.x;
  state.y = getAnimatedLanternY(target, state.simTime + 0.05);

  const ev1 = stepFlightSimulation(state, emptyInput(), 0.05, false, null);
  assert.equal(ev1.some((e) => e.type === 'lantern' && e.points === LANTERN_POINTS), true);
  assert.equal(state.score, LANTERN_POINTS);
  assert.equal(state.lanternsCollected, 1);

  // Repeating step near same lantern must never double-award
  state.dist = -target.z - 0.1;
  state.z = -state.dist;
  const ev2 = stepFlightSimulation(state, emptyInput(), 0.05, false, null);
  assert.equal(ev2.some((e) => e.type === 'lantern'), false);
  assert.equal(state.score, LANTERN_POINTS);
});

test('torii gate awards +250 on clean pass and removes 1 heart with invulnerability on pillar hit', () => {
  const state = createInitialFlightState(null);
  resetForNewRun(state, null);

  // Clean crossing through gate 0
  const gate0 = state.toriis[0];
  state.dist = -gate0.z - 0.4;
  state.z = -state.dist;
  state.x = gate0.x;
  state.y = 12;

  const clearEvents = stepFlightSimulation(state, emptyInput(), 0.05, false, null);
  assert.equal(clearEvents.some((e) => e.type === 'torii' && e.points === TORII_POINTS), true);
  assert.equal(state.score, TORII_POINTS);
  assert.equal(state.gatesCleared, 1);

  // Pillar collision at gate 1
  const gate1 = state.toriis[1];
  state.dist = -gate1.z - 0.3;
  state.z = -state.dist;
  state.x = gate1.x + gate1.openingHalfWidth; // right on the pillar
  state.y = 12;

  const hitEvents = stepFlightSimulation(state, emptyInput(), 0.05, false, null);
  assert.equal(hitEvents.some((e) => e.type === 'damage'), true);
  assert.equal(state.hearts, MAX_HEARTS - 1);
  assert.ok(state.invulnTimer > INVULN_DURATION - 0.2);

  // Immediate water hit during invulnerability must NOT remove another heart
  state.y = 0.5;
  const immuneEvents = stepFlightSimulation(state, emptyInput(), 0.05, false, null);
  assert.equal(immuneEvents.some((e) => e.type === 'damage'), false);
  assert.equal(state.hearts, MAX_HEARTS - 1);
});

test('reaching 3.6 km triggers victory and losing all 3 hearts triggers defeat', () => {
  // Victory check
  const winState = createInitialFlightState(null);
  resetForNewRun(winState, null);
  winState.score = 850;
  winState.dist = ROUTE_LENGTH - 0.5;
  winState.z = -winState.dist;
  winState.y = 14;
  const winEvents = stepFlightSimulation(winState, emptyInput(), 0.05, true, null);
  assert.equal(winState.phase, 'victory');
  assert.equal(winEvents.some((e) => e.type === 'victory'), true);
  assert.equal(winState.summary?.outcome, 'victory');
  assert.equal(winState.summary?.distanceMeters, ROUTE_LENGTH);

  // Defeat check
  const loseState = createInitialFlightState(null);
  resetForNewRun(loseState, null);
  for (let hit = 0; hit < MAX_HEARTS; hit++) {
    loseState.invulnTimer = 0;
    loseState.y = 0.2;
    stepFlightSimulation(loseState, emptyInput(), 0.05, false, null);
  }
  assert.equal(loseState.phase, 'defeat');
  assert.equal(loseState.hearts, 0);
  assert.equal(loseState.summary?.outcome, 'defeat');
});

test('personal best gracefully falls back to memory when localStorage throws', () => {
  const brokenStorage = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  const saved = saveBestScore(1250, brokenStorage);
  assert.ok(saved >= 1250);
  const loaded = loadBestScore(brokenStorage);
  assert.ok(loaded >= 1250);
});
