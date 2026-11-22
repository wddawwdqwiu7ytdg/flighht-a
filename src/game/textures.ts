import * as THREE from 'three';

export interface ProceduralTextureSet {
  linenColor: THREE.CanvasTexture;
  linenBump: THREE.CanvasTexture;
  cedarBark: THREE.CanvasTexture;
  roofTiles: THREE.CanvasTexture;
  shojiGlow: THREE.CanvasTexture;
  mossGround: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  softGlow: THREE.CanvasTexture;
  waterfallFlow: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  anisotropy: number,
  isColor: boolean,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = Math.max(1, anisotropy);
  tex.needsUpdate = true;
  return tex;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));

  // 1. Warm ivory linen fabric with subtle Wright Flyer wing ribs
  const [linenC, lCtx] = makeCanvas(256, 256);
  lCtx.fillStyle = '#efe9d6';
  lCtx.fillRect(0, 0, 256, 256);
  // Subtle cloth weave
  lCtx.fillStyle = 'rgba(176, 160, 130, 0.14)';
  for (let y = 0; y < 256; y += 4) {
    lCtx.fillRect(0, y, 256, 1);
  }
  for (let x = 0; x < 256; x += 4) {
    lCtx.fillRect(x, 0, 1, 256);
  }
  // Wing rib stitching bands
  for (let x = 0; x < 256; x += 24) {
    lCtx.fillStyle = 'rgba(145, 122, 88, 0.28)';
    lCtx.fillRect(x, 0, 3, 256);
    lCtx.fillStyle = 'rgba(255, 252, 244, 0.35)';
    lCtx.fillRect(x + 3, 0, 2, 256);
  }
  const linenColor = finalizeTexture(linenC, aniso, true, 3, 1);

  // Linen bump map
  const [linenBC, lbCtx] = makeCanvas(256, 256);
  lbCtx.fillStyle = '#808080';
  lbCtx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 24) {
    lbCtx.fillStyle = '#c8c8c8';
    lbCtx.fillRect(x, 0, 4, 256);
    lbCtx.fillStyle = '#585858';
    lbCtx.fillRect(x + 4, 0, 2, 256);
  }
  const linenBump = finalizeTexture(linenBC, aniso, false, 3, 1);

  // 2. Reddish-brown Japanese Cedar (Sugi) fibrous bark
  const [barkC, bCtx] = makeCanvas(128, 256);
  bCtx.fillStyle = '#6c3f2a';
  bCtx.fillRect(0, 0, 128, 256);
  for (let x = 0; x < 128; x += 4) {
    const shade = (Math.sin(x * 0.45) * 0.5 + 0.5) * 32 - 16;
    bCtx.fillStyle = `rgb(${Math.round(108 + shade)}, ${Math.round(63 + shade * 0.65)}, ${Math.round(42 + shade * 0.5)})`;
    bCtx.fillRect(x, 0, 3, 256);
  }
  bCtx.fillStyle = 'rgba(34, 19, 12, 0.35)';
  for (let i = 0; i < 60; i++) {
    const rx = (i * 29) % 128;
    const ry = (i * 53) % 256;
    bCtx.fillRect(rx, ry, 2, 28 + (i % 24));
  }
  const cedarBark = finalizeTexture(barkC, aniso, true, 2, 3);

  // 3. Japanese Kawara Roof Tiles
  const [roofC, rCtx] = makeCanvas(256, 256);
  rCtx.fillStyle = '#2d3337';
  rCtx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 256; row += 24) {
    rCtx.fillStyle = 'rgba(12, 16, 19, 0.45)';
    rCtx.fillRect(0, row, 256, 4);
    rCtx.fillStyle = 'rgba(130, 145, 152, 0.16)';
    rCtx.fillRect(0, row + 4, 256, 3);
  }
  for (let col = 0; col < 256; col += 20) {
    rCtx.fillStyle = 'rgba(14, 18, 21, 0.38)';
    rCtx.fillRect(col, 0, 3, 256);
    rCtx.fillStyle = 'rgba(150, 164, 170, 0.14)';
    rCtx.fillRect(col + 3, 0, 2, 256);
  }
  const roofTiles = finalizeTexture(roofC, aniso, true, 3, 2);

  // 4. Warm glowing Shoji paper lattice window
  const [shojiC, sCtx] = makeCanvas(128, 128);
  const sGrad = sCtx.createLinearGradient(0, 0, 0, 128);
  sGrad.addColorStop(0, '#f4d38e');
  sGrad.addColorStop(0.65, '#ffe5a8');
  sGrad.addColorStop(1, '#e6b86a');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 128, 128);
  sCtx.fillStyle = '#2a221c';
  for (let x = 0; x <= 128; x += 32) sCtx.fillRect(x - 2, 0, 4, 128);
  for (let y = 0; y <= 128; y += 32) sCtx.fillRect(0, y - 2, 128, 4);
  const shojiGlow = finalizeTexture(shojiC, aniso, true, 1, 1);

  // 5. Mossy forest floor micro-texture
  const [mossC, mCtx] = makeCanvas(256, 256);
  mCtx.fillStyle = '#3c452b';
  mCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 420; i++) {
    const x = (i * 73) % 256;
    const y = (i * 139) % 256;
    const r = 4 + (i % 14);
    mCtx.fillStyle =
      i % 3 === 0
        ? 'rgba(72, 86, 48, 0.28)'
        : i % 3 === 1
          ? 'rgba(42, 49, 29, 0.34)'
          : 'rgba(92, 84, 52, 0.16)';
    mCtx.beginPath();
    mCtx.arc(x, y, r, 0, Math.PI * 2);
    mCtx.fill();
  }
  const mossGround = finalizeTexture(mossC, aniso, true, 12, 12);

  // 6. Soft radial contact shadow
  const [shadC, shCtx] = makeCanvas(128, 128);
  const shGrad = shCtx.createRadialGradient(64, 64, 6, 64, 64, 62);
  shGrad.addColorStop(0, 'rgba(6, 12, 10, 0.62)');
  shGrad.addColorStop(0.55, 'rgba(6, 12, 10, 0.25)');
  shGrad.addColorStop(1, 'rgba(6, 12, 10, 0)');
  shCtx.fillStyle = shGrad;
  shCtx.fillRect(0, 0, 128, 128);
  const contactShadow = finalizeTexture(shadC, 1, true, 1, 1);
  contactShadow.wrapS = THREE.ClampToEdgeWrapping;
  contactShadow.wrapT = THREE.ClampToEdgeWrapping;

  // 7. Restrained warm lantern glow sprite
  const [glowC, gCtx] = makeCanvas(128, 128);
  const gGrad = gCtx.createRadialGradient(64, 64, 2, 64, 64, 62);
  gGrad.addColorStop(0, 'rgba(255, 240, 195, 0.85)');
  gGrad.addColorStop(0.32, 'rgba(242, 206, 124, 0.38)');
  gGrad.addColorStop(0.7, 'rgba(220, 178, 92, 0.08)');
  gGrad.addColorStop(1, 'rgba(220, 178, 92, 0)');
  gCtx.fillStyle = gGrad;
  gCtx.fillRect(0, 0, 128, 128);
  const softGlow = finalizeTexture(glowC, 1, true, 1, 1);
  softGlow.wrapS = THREE.ClampToEdgeWrapping;
  softGlow.wrapT = THREE.ClampToEdgeWrapping;

  // 8. Waterfall animated foam streak texture
  const [wfC, wfCtx] = makeCanvas(128, 256);
  const wfGrad = wfCtx.createLinearGradient(0, 0, 128, 0);
  wfGrad.addColorStop(0, 'rgba(225, 240, 238, 0.05)');
  wfGrad.addColorStop(0.2, 'rgba(232, 244, 242, 0.65)');
  wfGrad.addColorStop(0.5, 'rgba(245, 250, 249, 0.85)');
  wfGrad.addColorStop(0.8, 'rgba(232, 244, 242, 0.65)');
  wfGrad.addColorStop(1, 'rgba(225, 240, 238, 0.05)');
  wfCtx.fillStyle = wfGrad;
  wfCtx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 42; i++) {
    const x = 14 + ((i * 23) % 100);
    const y = (i * 47) % 256;
    const h = 36 + (i % 50);
    wfCtx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    wfCtx.fillRect(x, y, 3, h);
  }
  const waterfallFlow = finalizeTexture(wfC, aniso, true, 1, 2);

  return {
    linenColor,
    linenBump,
    cedarBark,
    roofTiles,
    shojiGlow,
    mossGround,
    contactShadow,
    softGlow,
    waterfallFlow,
    dispose() {
      linenColor.dispose();
      linenBump.dispose();
      cedarBark.dispose();
      roofTiles.dispose();
      shojiGlow.dispose();
      mossGround.dispose();
      contactShadow.dispose();
      softGlow.dispose();
      waterfallFlow.dispose();
    },
  };
}
