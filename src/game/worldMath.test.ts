import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTERS,
  ROUTE_LENGTH,
  getChapterForDistance,
  getHouseCornerGroundHeights,
  getWorldRouteData,
  riverCenterX,
} from './worldMath';

test('riverCenterX follows the specified deterministic curve x(z) = sin(0.006z)*19 + sin(0.017z)*5', () => {
  for (const d of [0, 120, 450, 900, 1800, 2700, 3600]) {
    const expected = Math.sin(0.006 * d) * 19 + Math.sin(0.017 * d) * 5;
    assert.ok(Math.abs(riverCenterX(d) - expected) < 1e-9);
  }
});

test('route has 4 equally spaced chapters spanning 3.6 km', () => {
  assert.equal(ROUTE_LENGTH, 3600);
  assert.equal(CHAPTERS.length, 4);
  assert.deepEqual(
    CHAPTERS.map((c) => c.name),
    ['Whispering Woods', 'Hidden Falls', 'Lantern Valley', 'Cloud Sanctuary'],
  );
  for (let i = 0; i < 4; i++) {
    assert.equal(CHAPTERS[i].startZ, i * 900);
    assert.equal(CHAPTERS[i].endZ, (i + 1) * 900);
  }

  assert.equal(getChapterForDistance(0).chapter.name, 'Whispering Woods');
  assert.equal(getChapterForDistance(950).chapter.name, 'Hidden Falls');
  assert.equal(getChapterForDistance(1850).chapter.name, 'Lantern Valley');
  assert.equal(getChapterForDistance(3550).chapter.name, 'Cloud Sanctuary');
});

test('every Minka house sits on a level terrace with all 4 corners grounded at terrace height', () => {
  const world = getWorldRouteData();
  assert.ok(world.houses.length >= 18, 'expected houses placed along the 3.6 km valley');

  for (const house of world.houses) {
    const cornerHeights = getHouseCornerGroundHeights(house);
    assert.equal(cornerHeights.length, 4);
    for (const h of cornerHeights) {
      assert.ok(
        Math.abs(h - house.y) < 0.05,
        `House #${house.id} corner height ${h} deviated from terrace ${house.y}`,
      );
    }
  }
});

test('world generates deterministic lanterns, torii gates, cedars, rocks, and waterfalls', () => {
  const world = getWorldRouteData();
  assert.ok(world.lanterns.length >= 30, 'expected abundant spirit lanterns');
  assert.ok(world.toriis.length >= 12, 'expected torii gates along the river');
  assert.ok(world.cedars.length >= 400, 'expected dense cedar forest');
  assert.ok(world.rocks.length >= 300, 'expected river bank rocks');
  assert.ok(world.waterfalls.length >= 5, 'expected waterfalls in Hidden Falls');

  // Verify every torii gate is centered along the river corridor
  for (const gate of world.toriis) {
    const dist = -gate.z;
    assert.ok(Math.abs(gate.x - riverCenterX(dist)) < 0.01);
  }
});
