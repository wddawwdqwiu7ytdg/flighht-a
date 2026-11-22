import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';
import type { SceneVariantMode } from './types';

export interface AircraftRig {
  root: THREE.Group;
  leftPropeller: THREE.Object3D;
  rightPropeller: THREE.Object3D;
  triangleCount: number;
}

export function countTriangles(object: THREE.Object3D): number {
  let tris = 0;
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geo = mesh.geometry;
      if (!geo) return;
      if (geo.index) {
        tris += geo.index.count / 3;
      } else if (geo.attributes.position) {
        tris += geo.attributes.position.count / 3;
      }
    }
  });
  return Math.round(tris);
}

/**
 * Creates a cambered airfoil wing geometry spanning along X, chord along Z.
 * Forward leading edge is at -Z, trailing edge at +Z.
 */
function createCamberedWingGeometry(
  span: number,
  chord: number,
  thickness: number,
  camber: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const halfC = chord * 0.5;
  // Build airfoil profile in 2D (x = chord along Z, y = vertical camber)
  shape.moveTo(-halfC, 0);
  shape.quadraticCurveTo(-halfC * 0.15, camber + thickness * 0.65, halfC, 0.015);
  shape.lineTo(halfC, -thickness * 0.25);
  shape.quadraticCurveTo(-halfC * 0.15, camber - thickness * 0.35, -halfC, -thickness * 0.25);
  shape.closePath();

  const extrude = new THREE.ExtrudeGeometry(shape, {
    depth: span,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 10,
  });

  // Rotate so extrusion runs along X (-span/2 .. +span/2) and chord runs along Z (-halfC .. +halfC)
  extrude.translate(0, 0, -span * 0.5);
  extrude.rotateY(-Math.PI / 2);
  extrude.computeVertexNormals();
  return extrude;
}

/**
 * Builds a single carved mahogany Wright Flyer pusher propeller with two
 * sculpted pitched blades and a brass hub spinner (no duplicate blades).
 */
export function createPusherPropeller(
  name: string,
  handedness: 1 | -1,
  woodMat: THREE.Material,
  brassMat: THREE.Material,
): THREE.Group {
  const prop = new THREE.Group();
  prop.name = name;

  // Central brass hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.11, 10), brassMat);
  hub.rotation.x = Math.PI / 2;
  prop.add(hub);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, -0.028);
  bladeShape.quadraticCurveTo(0.28, -0.065, 0.54, -0.048);
  bladeShape.quadraticCurveTo(0.62, 0, 0.54, 0.048);
  bladeShape.quadraticCurveTo(0.28, 0.055, 0, 0.026);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.018,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.004,
    bevelSegments: 1,
    curveSegments: 8,
  });
  bladeGeo.translate(0, 0, -0.009);

  for (let b = 0; b < 2; b++) {
    const pivot = new THREE.Group();
    pivot.rotation.z = b * Math.PI;
    const blade = new THREE.Mesh(bladeGeo, woodMat);
    blade.rotation.x = handedness * 0.34;
    blade.castShadow = true;
    pivot.add(blade);
    prop.add(pivot);
  }

  return prop;
}

/**
 * Slot 1: 1903 Wright Flyer — Open biplane with two broad warm ivory-linen wings,
 * exposed spruce struts, diagonal tension wires, front twin-surface canard,
 * wooden skids, rear vertical rudder, engine & prone pilot, and two separate
 * counter-rotating rear pusher propellers. Forward = -Z.
 */
export function createWrightFlyerModel(
  textures: ProceduralTextureSet,
  variant: SceneVariantMode = 'baseline',
): AircraftRig {
  const root = new THREE.Group();
  root.name = 'wright_flyer_1903';

  const isEnhanced = variant === 'enhanced';

  const linenMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0xf5eedb : 0xefe8d4,
    map: textures.linenColor,
    bumpMap: textures.linenBump,
    bumpScale: isEnhanced ? 0.035 : 0.02,
    roughness: isEnhanced ? 0.82 : 0.88,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  const spruceMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x8e6036 : 0x9b6e42,
    roughness: 0.68,
    metalness: 0.04,
  });

  const darkTimberMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x4c2c1a : 0x5c3722,
    roughness: 0.5,
    metalness: 0.08,
  });

  const wireMat = new THREE.MeshStandardMaterial({
    color: 0x3a3731,
    roughness: 0.35,
    metalness: 0.72,
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xc8a45c,
    roughness: 0.28,
    metalness: 0.82,
  });

  const pilotClothMat = new THREE.MeshStandardMaterial({
    color: 0x353b3c,
    roughness: 0.85,
    metalness: 0.02,
  });

  const span = 6.9;
  const chord = 1.32;
  const wingGap = 1.06;

  // 1. Upper & Lower Cambered Linen Wings
  const wingGeo = createCamberedWingGeometry(span, chord, 0.055, 0.09);
  const upperWing = new THREE.Mesh(wingGeo, linenMat);
  upperWing.position.set(0, wingGap * 0.5, 0);
  upperWing.castShadow = true;
  upperWing.receiveShadow = true;
  root.add(upperWing);

  const lowerWing = new THREE.Mesh(wingGeo, linenMat);
  lowerWing.position.set(0, -wingGap * 0.5, 0);
  lowerWing.castShadow = true;
  lowerWing.receiveShadow = true;
  root.add(lowerWing);

  // Subtle exposed wooden leading/trailing wing spars
  const sparGeo = new THREE.CylinderGeometry(0.024, 0.024, span, 6);
  sparGeo.rotateZ(Math.PI / 2);
  for (const wy of [-wingGap * 0.5, wingGap * 0.5]) {
    const frontSpar = new THREE.Mesh(sparGeo, spruceMat);
    frontSpar.position.set(0, wy - 0.01, -chord * 0.48);
    root.add(frontSpar);
  }

  // 2. Interplane Struts & Diagonal Tension Wires across 7 wing bays
  const bayXs = [-3.15, -2.15, -1.15, -0.35, 0.35, 1.15, 2.15, 3.15];
  const strutGeo = new THREE.CylinderGeometry(0.022, 0.022, wingGap, 6);
  const wireRadius = 0.008;

  for (const bx of bayXs) {
    for (const bz of [-0.42, 0.36]) {
      const strut = new THREE.Mesh(strutGeo, spruceMat);
      strut.position.set(bx, 0, bz);
      strut.castShadow = true;
      root.add(strut);
    }
  }

  // Diagonal X cross-bracing tension wires between strut stations
  const addWire = (p1: THREE.Vector3, p2: THREE.Vector3) => {
    const dir = new THREE.Vector3().subVectors(p2, p1);
    const len = dir.length();
    const wGeo = new THREE.CylinderGeometry(wireRadius, wireRadius, len, 4);
    const wire = new THREE.Mesh(wGeo, wireMat);
    wire.position.copy(p1).addScaledVector(dir, 0.5);
    wire.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    root.add(wire);
  };

  for (let i = 0; i < bayXs.length - 1; i++) {
    const xA = bayXs[i];
    const xB = bayXs[i + 1];
    addWire(new THREE.Vector3(xA, -wingGap * 0.48, -0.4), new THREE.Vector3(xB, wingGap * 0.48, -0.4));
    addWire(new THREE.Vector3(xA, wingGap * 0.48, -0.4), new THREE.Vector3(xB, -wingGap * 0.48, -0.4));
    addWire(new THREE.Vector3(xA, -wingGap * 0.48, 0.34), new THREE.Vector3(xB, wingGap * 0.48, 0.34));
  }

  // 3. Wooden Landing Skids & Front Canard Outriggers
  for (const sx of [-0.62, 0.62]) {
    const skidCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx, -wingGap * 0.5 - 0.36, 0.72),
      new THREE.Vector3(sx, -wingGap * 0.5 - 0.38, -0.7),
      new THREE.Vector3(sx, -wingGap * 0.5 - 0.24, -1.65),
      new THREE.Vector3(sx, -wingGap * 0.5 + 0.06, -2.35),
    ]);
    const skidGeo = new THREE.TubeGeometry(skidCurve, 14, 0.026, 6, false);
    const skid = new THREE.Mesh(skidGeo, spruceMat);
    skid.castShadow = true;
    root.add(skid);

    // Upper diagonal boom to front elevator
    addWire(
      new THREE.Vector3(sx, wingGap * 0.46, -0.42),
      new THREE.Vector3(sx, -wingGap * 0.5 + 0.34, -2.28),
    );
    // Skid vertical braces to lower wing
    for (const sz of [-0.4, 0.32]) {
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 6), spruceMat);
      brace.position.set(sx, -wingGap * 0.5 - 0.19, sz);
      root.add(brace);
    }
  }

  // 4. Front Twin-Plane Elevator Canard (-Z)
  const canardGeo = createCamberedWingGeometry(1.75, 0.46, 0.032, 0.03);
  for (const cy of [-wingGap * 0.5 + 0.05, -wingGap * 0.5 + 0.38]) {
    const canard = new THREE.Mesh(canardGeo, linenMat);
    canard.position.set(0, cy, -2.22);
    canard.castShadow = true;
    root.add(canard);
  }
  for (const cx of [-0.62, 0, 0.62]) {
    const cStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.36, 5), spruceMat);
    cStrut.position.set(cx, -wingGap * 0.5 + 0.21, -2.22);
    root.add(cStrut);
  }

  // 5. Rear Vertical Rudder Assembly (+Z)
  const rudderBoomOffsets = [
    [-0.48, wingGap * 0.45],
    [-0.48, -wingGap * 0.45],
    [0.12, wingGap * 0.45],
    [0.12, -wingGap * 0.45],
  ];
  for (const [rx, ry] of rudderBoomOffsets) {
    addWire(new THREE.Vector3(rx, ry, 0.45), new THREE.Vector3(-0.18, ry * 0.85, 1.92));
  }
  const rudderFinGeo = new THREE.BoxGeometry(0.03, 1.05, 0.44);
  for (const fx of [-0.34, -0.02]) {
    const fin = new THREE.Mesh(rudderFinGeo, linenMat);
    fin.position.set(fx, -0.04, 1.92);
    fin.castShadow = true;
    root.add(fin);
  }
  // Rudder frame crossbar
  const rudderBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.38, 5), spruceMat);
  rudderBar.rotation.z = Math.PI / 2;
  rudderBar.position.set(-0.18, 0.48, 1.92);
  root.add(rudderBar);
  const rudderBarBot = rudderBar.clone();
  rudderBarBot.position.y = -0.56;
  root.add(rudderBarBot);

  // 6. Compact Inline Engine, Radiator & Prone Pilot on Lower Wing
  const engineBlock = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.56), brassMat);
  engineBlock.position.set(0.38, -wingGap * 0.5 + 0.16, -0.05);
  engineBlock.castShadow = true;
  root.add(engineBlock);

  const radiator = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.22), brassMat);
  radiator.position.set(0.36, -wingGap * 0.5 + 0.36, -0.38);
  root.add(radiator);

  // Prone aviator silhouette resting on lower wing cradle
  const pilotGroup = new THREE.Group();
  pilotGroup.position.set(-0.14, -wingGap * 0.5 + 0.14, -0.04);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.52, 5, 8), pilotClothMat);
  torso.rotation.x = Math.PI / 2;
  pilotGroup.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 10, 8), darkTimberMat);
  head.position.set(0, 0.06, -0.38);
  pilotGroup.add(head);
  root.add(pilotGroup);

  // 7. Twin Counter-Rotating Rear Pusher Propellers (separate animated parts)
  const propZ = 0.84;
  const propOffsets: Array<{ x: number; name: string; hand: 1 | -1 }> = [
    { x: -1.06, name: 'propeller_left', hand: 1 },
    { x: 1.06, name: 'propeller_right', hand: -1 },
  ];

  let leftPropeller!: THREE.Object3D;
  let rightPropeller!: THREE.Object3D;

  for (const cfg of propOffsets) {
    // Outrigger support V-brackets from rear wing spars to prop hub
    addWire(new THREE.Vector3(cfg.x, wingGap * 0.45, 0.38), new THREE.Vector3(cfg.x, 0.02, propZ - 0.04));
    addWire(new THREE.Vector3(cfg.x, -wingGap * 0.45, 0.38), new THREE.Vector3(cfg.x, 0.02, propZ - 0.04));
    // Chain-drive shaft tube from center engine to prop hub
    addWire(new THREE.Vector3(0.34, -wingGap * 0.5 + 0.14, 0.14), new THREE.Vector3(cfg.x, 0.02, propZ - 0.06));

    const prop = createPusherPropeller(cfg.name, cfg.hand, darkTimberMat, brassMat);
    prop.position.set(cfg.x, 0.02, propZ);
    root.add(prop);

    if (cfg.name === 'propeller_left') leftPropeller = prop;
    else rightPropeller = prop;
  }

  return {
    root,
    leftPropeller,
    rightPropeller,
    triangleCount: countTriangles(root),
  };
}

/**
 * Slot 2: Japanese Cedar (Sugi) — Tall reddish-brown ribbed trunk,
 * flared buttress roots grounded at y=0, crooked limbs, and irregular
 * layered deep-cedar green needle crowns.
 */
export function createCedarModel(
  textures: ProceduralTextureSet,
  variant: SceneVariantMode = 'baseline',
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'japanese_cedar';
  const isEnhanced = variant === 'enhanced';

  const trunkMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x7a472e : 0x6f412c,
    map: textures.cedarBark,
    roughness: 0.9,
    metalness: 0.02,
  });

  const foliageDark = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x223f23 : 0x264427,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  });

  const foliageMid = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x30532c : 0x33552f,
    roughness: 0.85,
    metalness: 0.02,
    flatShading: true,
  });

  const foliageDeep = new THREE.MeshStandardMaterial({
    color: 0x1c341f,
    roughness: 0.9,
    metalness: 0.01,
    flatShading: true,
  });

  // Main tall tapering trunk (19.5m base height)
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.78, 19.5, 8), trunkMat);
  trunk.position.y = 9.75;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  // Flared buttress roots grounded flush & slightly below y=0
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.25;
    const rootMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.38, 3.4, 5), trunkMat);
    rootMesh.position.set(Math.cos(angle) * 0.64, 1.05, Math.sin(angle) * 0.64);
    rootMesh.rotation.z = -Math.cos(angle) * 0.44;
    rootMesh.rotation.x = Math.sin(angle) * 0.44;
    group.add(rootMesh);
  }

  // Organic airy Japanese Sugi cedar boughs (irregular conical foliage sprays, never puffy spheres)
  const boughs: Array<{
    y: number;
    angle: number;
    reach: number;
    radius: number;
    height: number;
    mat: THREE.Material;
  }> = [
    { y: 7.2, angle: 0.3, reach: 1.55, radius: 1.95, height: 1.35, mat: foliageDeep },
    { y: 7.9, angle: 2.5, reach: 1.4, radius: 1.85, height: 1.25, mat: foliageDark },
    { y: 8.6, angle: 4.5, reach: 1.5, radius: 1.9, height: 1.35, mat: foliageMid },
    { y: 9.8, angle: 1.2, reach: 1.65, radius: 2.1, height: 1.45, mat: foliageDark },
    { y: 10.6, angle: 3.4, reach: 1.55, radius: 2.0, height: 1.4, mat: foliageMid },
    { y: 11.4, angle: 5.4, reach: 1.45, radius: 1.9, height: 1.35, mat: foliageDeep },
    { y: 12.6, angle: 0.7, reach: 1.45, radius: 1.95, height: 1.45, mat: foliageMid },
    { y: 13.5, angle: 2.8, reach: 1.3, radius: 1.85, height: 1.4, mat: foliageDark },
    { y: 14.4, angle: 4.9, reach: 1.25, radius: 1.75, height: 1.35, mat: foliageMid },
    { y: 15.6, angle: 1.7, reach: 1.05, radius: 1.6, height: 1.4, mat: foliageDark },
    { y: 16.6, angle: 3.9, reach: 0.9, radius: 1.45, height: 1.4, mat: foliageMid },
    { y: 17.8, angle: 0.2, reach: 0.45, radius: 1.3, height: 1.7, mat: foliageDark },
  ];

  const frondGeo = new THREE.ConeGeometry(1, 1, 7, 1);
  // Subtle organic vertex perturbation on the shared frond cone so needles look craggy and natural
  const fPos = frondGeo.attributes.position;
  for (let i = 0; i < fPos.count; i++) {
    const vx = fPos.getX(i);
    const vy = fPos.getY(i);
    const vz = fPos.getZ(i);
    if (vy < 0.3) {
      const jitter = 1 + 0.22 * Math.sin(vx * 5.2 + vz * 4.7);
      fPos.setXYZ(i, vx * jitter, vy + 0.08 * Math.cos(vx * 6.0), vz * jitter);
    }
  }
  frondGeo.computeVertexNormals();

  for (let i = 0; i < boughs.length; i++) {
    const b = boughs[i];
    const ox = Math.cos(b.angle) * b.reach;
    const oz = Math.sin(b.angle) * b.reach;

    // Visible timber branch extending from trunk into foliage cluster
    const limb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.11, b.reach * 1.18, 5),
      trunkMat,
    );
    limb.position.set(ox * 0.5, b.y - 0.28, oz * 0.5);
    limb.rotation.z = Math.PI / 2 - 0.22;
    limb.rotation.y = -b.angle;
    group.add(limb);

    const frond = new THREE.Mesh(frondGeo, b.mat);
    frond.scale.set(b.radius, b.height, b.radius * 0.92);
    frond.position.set(ox, b.y, oz);
    frond.rotation.y = b.angle + i * 0.7;
    frond.rotation.z = Math.sin(i * 1.9) * 0.12;
    frond.castShadow = true;
    frond.receiveShadow = true;
    group.add(frond);
  }

  // Slender tapering cedar spire top
  const spire = new THREE.Mesh(frondGeo, foliageMid);
  spire.scale.set(1.05, 2.6, 1.05);
  spire.position.set(0, 19.6, 0);
  spire.castShadow = true;
  group.add(spire);

  return group;
}

/**
 * Slot 3: Traditional Japanese Minka House — Embedded stone plinth extending
 * deep below y=0 (-2.6m) so all four corners sit solidly into the terraced hillock,
 * dark weathered timber posts, cream plaster infill, glowing warm shoji windows,
 * and a broad sweeping tiled pitched roof with generous eaves.
 */
export function createMinkaModel(
  textures: ProceduralTextureSet,
  variant: SceneVariantMode = 'baseline',
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'japanese_minka';
  const isEnhanced = variant === 'enhanced';

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x454a46,
    roughness: 0.92,
    metalness: 0.04,
  });

  const timberMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x241e1a : 0x2c2520,
    roughness: 0.78,
    metalness: 0.04,
  });

  const plasterMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0xe5dfd1 : 0xdcd6c6,
    roughness: 0.88,
    metalness: 0.01,
  });

  const roofMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x353c41 : 0x30363a,
    map: textures.roofTiles,
    roughness: 0.62,
    metalness: 0.14,
  });

  const shojiMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.shojiGlow,
    emissive: new THREE.Color(0xf6c978),
    emissiveMap: textures.shojiGlow,
    emissiveIntensity: isEnhanced ? 0.95 : 0.75,
    roughness: 0.55,
    metalness: 0.02,
  });

  // 1. Deep embedded stone foundation plinth (y = -2.6 to +0.85) — guarantees zero floating corners
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(9.6, 3.45, 7.6), stoneMat);
  foundation.position.set(0, -0.875, 0);
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  group.add(foundation);

  // Wooden engawa veranda deck rim
  const veranda = new THREE.Mesh(new THREE.BoxGeometry(9.9, 0.24, 8.1), timberMat);
  veranda.position.set(0, 0.95, 0.15);
  veranda.castShadow = true;
  veranda.receiveShadow = true;
  group.add(veranda);

  // 2. Main house timber & plaster body
  const wallCore = new THREE.Mesh(new THREE.BoxGeometry(8.6, 3.4, 6.4), plasterMat);
  wallCore.position.set(0, 2.75, 0);
  wallCore.castShadow = true;
  wallCore.receiveShadow = true;
  group.add(wallCore);

  // Corner & intermediate dark weathered timber posts + horizontal tie beams
  const postGeo = new THREE.BoxGeometry(0.28, 3.55, 0.28);
  for (const px of [-4.32, -1.45, 1.45, 4.32]) {
    for (const pz of [-3.22, 3.22]) {
      const post = new THREE.Mesh(postGeo, timberMat);
      post.position.set(px, 2.75, pz);
      group.add(post);
    }
  }
  for (const by of [1.18, 2.65, 4.35]) {
    const beamF = new THREE.Mesh(new THREE.BoxGeometry(8.95, 0.22, 0.24), timberMat);
    beamF.position.set(0, by, 3.22);
    group.add(beamF);
    const beamB = beamF.clone();
    beamB.position.z = -3.22;
    group.add(beamB);
  }

  // 3. Warm glowing Shoji sliding windows on front & sides
  const frontShoji = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.1), shojiMat);
  frontShoji.position.set(0, 2.35, 3.24);
  group.add(frontShoji);

  const backShoji = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.8), shojiMat);
  backShoji.position.set(0, 2.45, -3.24);
  backShoji.rotation.y = Math.PI;
  group.add(backShoji);

  for (const sx of [-4.34, 4.34]) {
    const sideWin = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.75), shojiMat);
    sideWin.position.set(sx, 2.45, 0);
    sideWin.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(sideWin);
  }

  // 4. Sweeping broad pitched tiled roof (Irimoya / Kirizuma style with generous eaves)
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-5.4, 0);
  roofShape.quadraticCurveTo(-2.5, 1.4, 0, 3.7);
  roofShape.quadraticCurveTo(2.5, 1.4, 5.4, 0);
  roofShape.lineTo(5.1, -0.32);
  roofShape.quadraticCurveTo(2.3, 1.0, 0, 3.25);
  roofShape.quadraticCurveTo(-2.3, 1.0, -5.1, -0.32);
  roofShape.closePath();

  const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
    depth: 11.4,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.1,
    bevelSegments: 2,
    curveSegments: 8,
  });
  roofGeo.translate(0, 0, -5.7);
  roofGeo.rotateY(Math.PI / 2);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, 4.25, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);

  // Gable infill triangles under roof
  const gableGeo = new THREE.ConeGeometry(4.4, 3.2, 4);
  gableGeo.rotateY(Math.PI / 4);
  const gable = new THREE.Mesh(gableGeo, timberMat);
  gable.scale.set(1.3, 1.0, 0.92);
  gable.position.set(0, 5.75, 0);
  group.add(gable);

  // Heavy decorative roof ridge cap (mune)
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(11.7, 0.44, 0.56), timberMat);
  ridge.position.set(0, 7.98, 0);
  group.add(ridge);

  // Lower secondary porch eave over front shoji
  const porchEave = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.2, 2.2), roofMat);
  porchEave.position.set(0, 3.72, 3.9);
  porchEave.rotation.x = 0.26;
  group.add(porchEave);

  return group;
}

/**
 * Slot 5: Spirit Lantern — Warm paper-and-timber Japanese lantern family.
 * Used in two visibly distinct roles:
 * - 'collectible': larger floating spirit lantern centered inside a glowing golden ring
 * - 'decorative': compact hanging / bank lantern with softer warm glow
 */
export function createLanternModel(
  role: 'collectible' | 'decorative' = 'collectible',
  variant: SceneVariantMode = 'baseline',
): THREE.Group {
  const group = new THREE.Group();
  group.name = role === 'collectible' ? 'spirit_lantern_collectible' : 'spirit_lantern_decorative';

  const isCollectible = role === 'collectible';
  const isEnhanced = variant === 'enhanced';

  const frameMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x1e1915 : 0x26201b,
    roughness: 0.65,
    metalness: 0.15,
  });

  const paperMat = new THREE.MeshStandardMaterial({
    color: isCollectible ? 0xfff5db : 0xf6dfaa,
    emissive: new THREE.Color(isCollectible ? 0xffd584 : 0xf2b963),
    emissiveIntensity: isCollectible ? (isEnhanced ? 1.55 : 1.35) : 0.95,
    roughness: 0.45,
    metalness: 0.0,
  });

  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xd8b164,
    roughness: 0.3,
    metalness: 0.8,
  });

  const bodyW = isCollectible ? 1.45 : 0.92;
  const bodyH = isCollectible ? 2.05 : 1.25;

  // Inner glowing shoji paper core
  const paperCore = new THREE.Mesh(
    new THREE.BoxGeometry(bodyW * 0.86, bodyH * 0.88, bodyW * 0.86),
    paperMat,
  );
  group.add(paperCore);

  // Four slender dark-timber corner posts
  const postOffset = bodyW * 0.46;
  const postGeo = new THREE.BoxGeometry(bodyW * 0.1, bodyH, bodyW * 0.1);
  for (const px of [-postOffset, postOffset]) {
    for (const pz of [-postOffset, postOffset]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(px, 0, pz);
      group.add(post);
    }
  }

  // Top & bottom timber collars
  const collarGeo = new THREE.BoxGeometry(bodyW * 1.08, bodyH * 0.11, bodyW * 1.08);
  const topCollar = new THREE.Mesh(collarGeo, frameMat);
  topCollar.position.y = bodyH * 0.5;
  group.add(topCollar);

  const botCollar = new THREE.Mesh(collarGeo, frameMat);
  botCollar.position.y = -bodyH * 0.5;
  group.add(botCollar);

  // Flared pagoda cap roof
  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(bodyW * 0.95, bodyH * 0.32, 4),
    frameMat,
  );
  cap.rotation.y = Math.PI / 4;
  cap.position.y = bodyH * 0.68;
  group.add(cap);

  // Brass hanging finial & bottom tassel ring
  const finial = new THREE.Mesh(new THREE.SphereGeometry(bodyW * 0.12, 8, 8), brassMat);
  finial.position.y = bodyH * 0.87;
  group.add(finial);

  const baseFinial = new THREE.Mesh(new THREE.CylinderGeometry(bodyW * 0.08, bodyW * 0.14, bodyH * 0.16, 6), brassMat);
  baseFinial.position.y = -bodyH * 0.62;
  group.add(baseFinial);

  return group;
}

/**
 * Slot 4: Japanese Vermilion Torii Gate — Twin tapered posts standing in the river
 * matching the exact collision envelope (`openingHalfWidth = 11.2`, `lintelBottomY = 20.5`),
 * sweeping curved dark-capped upper lintel (kasagi), lower tie beam (nuki),
 * gold-trimmed tablet (gakuzuka), shimenawa rope with white shide streamers,
 * and decorative hanging lanterns from the lantern model family.
 */
export function createToriiModel(
  openingHalfWidth = 11.2,
  lintelBottomY = 20.5,
  variant: SceneVariantMode = 'baseline',
  lanternFactory?: () => THREE.Group,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vermilion_torii_gate';
  const isEnhanced = variant === 'enhanced';

  const vermilionMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0xc63f28 : 0xb83b26,
    roughness: isEnhanced ? 0.54 : 0.62,
    metalness: 0.06,
  });

  const darkCapMat = new THREE.MeshStandardMaterial({
    color: 0x26201d,
    roughness: 0.72,
    metalness: 0.08,
  });

  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: 0xd9b366,
    roughness: 0.34,
    metalness: 0.76,
  });

  const ropeMat = new THREE.MeshStandardMaterial({
    color: 0x9c8867,
    roughness: 0.92,
    metalness: 0.0,
  });

  const shideMat = new THREE.MeshStandardMaterial({
    color: 0xf4efe4,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });

  const pillarHeight = lintelBottomY + 4.2;
  const pillarGeo = new THREE.CylinderGeometry(0.76, 1.04, pillarHeight, 12);
  const baseGeo = new THREE.CylinderGeometry(1.12, 1.28, 3.2, 12);

  // 1. Twin vermilion pillars standing deep into the riverbed (-2.5m below water)
  for (const side of [-1, 1]) {
    const px = side * openingHalfWidth;
    const pillar = new THREE.Mesh(pillarGeo, vermilionMat);
    pillar.position.set(px, pillarHeight * 0.5 - 2.0, 0);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);

    // Dark stone/charred water-line base collar (nemaki)
    const base = new THREE.Mesh(baseGeo, darkCapMat);
    base.position.set(px, -0.4, 0);
    group.add(base);
  }

  // 2. Lower tie beam (nuki) spanning across the pillars
  const nukiSpan = openingHalfWidth * 2 + 7.2;
  const nukiY = lintelBottomY + 0.55;
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(nukiSpan, 1.15, 0.95), vermilionMat);
  nuki.position.set(0, nukiY, 0);
  nuki.castShadow = true;
  group.add(nuki);

  // Wooden wedges (kusabi) where nuki pierces pillars
  for (const side of [-1, 1]) {
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.45, 1.15), darkCapMat);
    wedge.position.set(side * openingHalfWidth, nukiY, 0);
    group.add(wedge);
  }

  // 3. Sweeping curved upper lintel (shimaki + dark kasagi roof cap)
  const kasagiHalf = openingHalfWidth + 5.2;
  const kasagiCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-kasagiHalf, lintelBottomY + 4.35, 0),
    new THREE.Vector3(-openingHalfWidth * 0.7, lintelBottomY + 3.45, 0),
    new THREE.Vector3(0, lintelBottomY + 3.25, 0),
    new THREE.Vector3(openingHalfWidth * 0.7, lintelBottomY + 3.45, 0),
    new THREE.Vector3(kasagiHalf, lintelBottomY + 4.35, 0),
  ]);

  const shimakiGeo = new THREE.TubeGeometry(kasagiCurve, 22, 0.68, 6, false);
  const shimaki = new THREE.Mesh(shimakiGeo, vermilionMat);
  shimaki.scale.set(1, 0.85, 1.1);
  shimaki.castShadow = true;
  group.add(shimaki);

  const capCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-kasagiHalf - 0.5, lintelBottomY + 4.95, 0),
    new THREE.Vector3(-openingHalfWidth * 0.7, lintelBottomY + 3.98, 0),
    new THREE.Vector3(0, lintelBottomY + 3.78, 0),
    new THREE.Vector3(openingHalfWidth * 0.7, lintelBottomY + 3.98, 0),
    new THREE.Vector3(kasagiHalf + 0.5, lintelBottomY + 4.95, 0),
  ]);
  const capGeo = new THREE.TubeGeometry(capCurve, 22, 0.72, 6, false);
  const kasagiCap = new THREE.Mesh(capGeo, darkCapMat);
  kasagiCap.scale.set(1, 0.62, 1.38);
  kasagiCap.castShadow = true;
  group.add(kasagiCap);

  // 4. Central inscribed shrine tablet (gakuzuka)
  const tablet = new THREE.Mesh(new THREE.BoxGeometry(1.55, 2.35, 0.36), darkCapMat);
  tablet.position.set(0, lintelBottomY + 2.0, 0.25);
  group.add(tablet);

  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.45, 0.4), goldTrimMat);
  plaque.position.set(0, lintelBottomY + 2.0, 0.26);
  group.add(plaque);

  // 5. Shimenawa rope draped across the gate opening with white shide paper streamers
  const ropeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-openingHalfWidth + 0.7, nukiY - 0.7, 0),
    new THREE.Vector3(-openingHalfWidth * 0.5, nukiY - 2.0, 0),
    new THREE.Vector3(0, nukiY - 2.45, 0),
    new THREE.Vector3(openingHalfWidth * 0.5, nukiY - 2.0, 0),
    new THREE.Vector3(openingHalfWidth - 0.7, nukiY - 0.7, 0),
  ]);
  const rope = new THREE.Mesh(new THREE.TubeGeometry(ropeCurve, 18, 0.11, 5, false), ropeMat);
  group.add(rope);

  const shideGeo = new THREE.PlaneGeometry(0.45, 1.05);
  for (let i = 1; i <= 5; i++) {
    const t = i / 6;
    const pt = ropeCurve.getPoint(t);
    const shide = new THREE.Mesh(shideGeo, shideMat);
    shide.position.set(pt.x, pt.y - 0.62, 0.02);
    group.add(shide);
  }

  // 6. Pair of small decorative hanging lanterns (reusing the lantern slot family)
  for (const side of [-1, 1]) {
    const hangX = side * (openingHalfWidth - 2.2);
    const hangY = nukiY - 2.2;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 4), darkCapMat);
    cord.position.set(hangX, nukiY - 1.1, 0);
    group.add(cord);

    const lantern = lanternFactory ? lanternFactory() : createLanternModel('decorative', variant);
    lantern.scale.setScalar(0.82);
    lantern.position.set(hangX, hangY, 0);
    group.add(lantern);
  }

  return group;
}

/**
 * Slot 6: Rounded Mossy River Rock — Smooth sculpted boulder with a grounded
 * underside and mossy sage patina.
 */
export function createRockModel(variant: SceneVariantMode = 'baseline'): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mossy_river_rock';
  const isEnhanced = variant === 'enhanced';

  const geo = new THREE.IcosahedronGeometry(1.45, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Smooth organic river-worn rounding + flattened grounded base
    const bump = 1 + 0.14 * Math.sin(x * 2.1 + z * 1.7) + 0.08 * Math.cos(y * 2.6 - x * 1.3);
    let ny = y * bump;
    if (ny < -0.35) ny = -0.35 + (ny + 0.35) * 0.25;
    pos.setXYZ(i, x * bump, ny + 0.42, z * bump);
  }
  geo.computeVertexNormals();

  const rockMat = new THREE.MeshStandardMaterial({
    color: isEnhanced ? 0x677562 : 0x5d6b59,
    roughness: isEnhanced ? 0.84 : 0.9,
    metalness: 0.04,
  });

  const mesh = new THREE.Mesh(geo, rockMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // Subtle moss cap accent
  const mossCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.95, 10, 8),
    new THREE.MeshStandardMaterial({
      color: isEnhanced ? 0x4b6340 : 0x475c3d,
      roughness: 0.94,
      metalness: 0.01,
    }),
  );
  mossCap.scale.set(1.18, 0.34, 1.08);
  mossCap.position.set(0.05, 1.42, -0.04);
  group.add(mossCap);

  return group;
}

/**
 * Extracts merged/grouped mesh parts from any THREE.Group (procedural or imported GLB)
 * so repeated props (cedars, rocks) can be rendered at 60fps via InstancedMesh.
 */
export interface InstancedMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export function extractInstancedParts(template: THREE.Object3D): InstancedMeshPart[] {
  template.updateMatrixWorld(true);
  const parts: InstancedMeshPart[] = [];
  const rootInv = new THREE.Matrix4().copy(template.matrixWorld).invert();

  template.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (!mesh.geometry) return;
      const clonedGeo = mesh.geometry.clone();
      const relMatrix = new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld);
      clonedGeo.applyMatrix4(relMatrix);
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      parts.push({
        geometry: clonedGeo,
        material: mat.clone(),
      });
    }
  });

  return parts;
}
