import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Model space: barrel points to -Z. y = 0 is the sight line. z = 0 is the rear sight / optic.
// "u" below means distance forward (toward the muzzle), so z = -u.

function wearTexture(seed, base = 0.4, amp = 0.25) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(256, 256);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 256 * 256; i++) {
    const v = base + (rnd() - 0.5) * amp * 0.4;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.max(0, Math.min(255, v * 255)); img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  for (let k = 0; k < 40; k++) { ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.12})`; ctx.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 30, 1 + rnd() * 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
  return t;
}

export function gunMaterials() {
  return {
    metal: new THREE.MeshStandardMaterial({ color: '#2b2d31', metalness: 0.88, roughness: 1, roughnessMap: wearTexture(3, 0.36, 0.3), envMapIntensity: 1.2 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: '#16171a', metalness: 0.8, roughness: 1, roughnessMap: wearTexture(5, 0.45, 0.2) }),
    polymer: new THREE.MeshStandardMaterial({ color: '#1d1e21', metalness: 0.05, roughness: 1, roughnessMap: wearTexture(7, 0.62, 0.2) }),
    fde: new THREE.MeshStandardMaterial({ color: '#80694c', metalness: 0.05, roughness: 1, roughnessMap: wearTexture(9, 0.66, 0.2) }),
    olive: new THREE.MeshStandardMaterial({ color: '#434936', metalness: 0.05, roughness: 1, roughnessMap: wearTexture(11, 0.64, 0.2) }),
    brass: new THREE.MeshStandardMaterial({ color: '#c99a4a', metalness: 1, roughness: 0.28 }),
    hull: new THREE.MeshStandardMaterial({ color: '#8f1d18', metalness: 0.1, roughness: 0.5 }),
    glove: new THREE.MeshStandardMaterial({ color: '#2a2a2b', metalness: 0, roughness: 0.85 }),
    knuckle: new THREE.MeshStandardMaterial({ color: '#3a3b37', metalness: 0, roughness: 0.75 }),
    sleeve: new THREE.MeshStandardMaterial({ color: '#4b4f3c', metalness: 0, roughness: 0.95 }),
    black: new THREE.MeshBasicMaterial({ color: '#050505' }),
    fiber: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a').multiplyScalar(2.2), toneMapped: false }),
  };
}

// side-profile extrusion: pts are [u, y] pairs; width across X; bevelled edges catch highlights
function profile(pts, width, bevel = 0.0018) {
  const s = new THREE.Shape();
  pts.forEach(([u, y], i) => (i ? s.lineTo(u, y) : s.moveTo(u, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateY(Math.PI / 2); // u -> -z, extrusion -> +x
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}
function bx(w, h, d, x, y, u) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, -u); return g; }
function cyl(r, u0, u1, y, seg = 16, x = 0, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, u1 - u0, seg); g.rotateX(-Math.PI / 2); g.translate(x, y, -(u0 + u1) / 2); return g;
}
function limb(a, b, r, mat) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2 * 0.2), 6, 12);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
function mesh(geos, mat) {
  const g = geos.length > 1 ? mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => { ['uv1', 'uv2'].forEach((a) => x.deleteAttribute(a)); return x; })) : geos[0];
  const m = new THREE.Mesh(g, mat); m.castShadow = false; return m;
}
function rail(u0, u1, yTop, width = 0.021) {
  const out = [bx(width, 0.006, u1 - u0, 0, yTop - 0.007, (u0 + u1) / 2)];
  for (let u = u0 + 0.004; u < u1 - 0.004; u += 0.01) out.push(bx(width + 0.002, 0.003, 0.0055, 0, yTop - 0.0015, u));
  return out;
}
// Rear notch sight: two ears with a U gap; the notch floor sits at y = 0.
function rearNotch(baseY, u, gap = 0.0068) {
  const ear = 0.0075;
  return [
    bx(0.024, 0 - baseY, 0.008, 0, baseY + (0 - baseY) / 2, u),
    bx(ear, 0.0055, 0.008, -(gap / 2 + ear / 2), 0.00275, u),
    bx(ear, 0.0055, 0.008, gap / 2 + ear / 2, 0.00275, u),
  ];
}
// Front post with protective ears; post top at y = 0.
function frontPost(baseY, u, postW = 0.0028) {
  return [
    bx(0.016, 0.006, 0.012, 0, baseY + 0.003, u),
    bx(postW, -baseY - 0.006, 0.003, 0, (baseY + 0.006) / 2, u),
    bx(0.0025, -baseY - 0.004, 0.006, -0.0075, (baseY + 0.006) / 2 + 0.001, u),
    bx(0.0025, -baseY - 0.004, 0.006, 0.0075, (baseY + 0.006) / 2 + 0.001, u),
  ];
}

function hands(M, rightGrip, leftGrip, leftElbowDir) {
  const g = new THREE.Group();
  // right: glove around the pistol grip + forearm to bottom-right
  const rg = rightGrip;
  const rHand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.07), M.glove);
  rHand.position.copy(rg); rHand.rotation.x = -0.35; g.add(rHand);
  const rThumb = limb(new THREE.Vector3(rg.x - 0.026, rg.y + 0.03, rg.z + 0.01), new THREE.Vector3(rg.x - 0.024, rg.y + 0.03, rg.z - 0.05), 0.011, M.glove); g.add(rThumb);
  const rKn = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.03, 0.02), M.knuckle); rKn.position.set(rg.x, rg.y - 0.01, rg.z - 0.04); g.add(rKn);
  const rWrist = new THREE.Vector3(rg.x + 0.01, rg.y - 0.05, rg.z + 0.05);
  g.add(limb(rWrist, new THREE.Vector3(rg.x + 0.09, rg.y - 0.26, rg.z + 0.42), 0.038, M.sleeve));
  g.add(limb(new THREE.Vector3(rg.x + 0.005, rg.y - 0.035, rg.z + 0.03), rWrist, 0.03, M.glove));
  // left: palm under the handguard, fingers wrapping up the side
  const lg = leftGrip;
  const left = new THREE.Group(); left.position.copy(lg);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.08), M.glove); palm.position.set(0, -0.012, 0); left.add(palm);
  for (let i = 0; i < 4; i++) left.add(limb(new THREE.Vector3(-0.03, -0.005, -0.03 + i * 0.02), new THREE.Vector3(-0.03, 0.03, -0.034 + i * 0.02), 0.0085, M.glove));
  left.add(limb(new THREE.Vector3(0.028, -0.01, 0.02), new THREE.Vector3(0.026, 0.022, -0.02), 0.01, M.glove));
  const lw = new THREE.Vector3(0.0, -0.03, 0.05);
  left.add(limb(lw, lw.clone().add(leftElbowDir), 0.037, M.sleeve));
  g.add(left);
  return { group: g, left };
}

// ---------- AR-7 ----------
function buildAR(M) {
  const root = new THREE.Group();
  const metal = [], poly = [], fde = [], black = [];
  // upper receiver
  metal.push(profile([[-0.03, -0.05], [0.175, -0.05], [0.175, -0.026], [0.03, -0.026], [0.02, -0.022], [-0.03, -0.022]], 0.033));
  metal.push(...rail(-0.03, 0.17, -0.014));
  // lower receiver, magwell, trigger guard, pistol grip
  metal.push(profile([[-0.03, -0.05], [0.15, -0.05], [0.15, -0.07], [0.115, -0.072], [0.115, -0.108], [0.062, -0.108], [0.06, -0.074], [0.03, -0.074], [0.0, -0.07], [-0.03, -0.062]], 0.03));
  poly.push(profile([[0.03, -0.07], [0.008, -0.07], [-0.02, -0.165], [-0.048, -0.17], [-0.03, -0.07]], 0.03, 0.004)); // pistol grip
  metal.push(profile([[0.06, -0.074], [0.06, -0.09], [0.0, -0.092], [0.0, -0.088], [0.055, -0.086], [0.055, -0.074]], 0.008, 0.001)); // trigger guard
  black.push(bx(0.004, 0.018, 0.006, 0, -0.08, 0.035)); // trigger
  // ejection port, forward assist, charging handle
  black.push(bx(0.002, 0.014, 0.05, 0.0172, -0.036, 0.095));
  metal.push(cyl(0.006, -0.01, 0.01, -0.04, 10, 0.02));
  const bolt = mesh([bx(0.03, 0.007, 0.03, 0, -0.022, -0.02), bx(0.044, 0.006, 0.01, 0, -0.022, -0.035)], M.metal);
  // handguard (octagonal) with M-LOK slots
  const hg = new THREE.CylinderGeometry(0.027, 0.027, 0.27, 8); hg.rotateZ(Math.PI / 8); hg.rotateX(-Math.PI / 2); hg.translate(0, -0.04, -0.31);
  poly.push(hg);
  poly.push(...rail(0.18, 0.44, -0.013));
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) black.push(bx(0.002, 0.008, 0.028, s * 0.026, -0.042, 0.21 + i * 0.045));
  // barrel, gas block, flash hider
  metal.push(cyl(0.0085, 0.44, 0.565, -0.04, 14));
  metal.push(bx(0.02, 0.022, 0.018, 0, -0.038, 0.455));
  metal.push(cyl(0.0115, 0.565, 0.615, -0.04, 12));
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; black.push(bx(0.003, 0.003, 0.03, Math.cos(a) * 0.011, -0.04 + Math.sin(a) * 0.011, 0.6)); }
  // stock + buffer tube
  metal.push(cyl(0.014, -0.25, -0.03, -0.045, 14));
  fde.push(profile([[-0.12, -0.026], [-0.27, -0.03], [-0.275, -0.12], [-0.245, -0.12], [-0.2, -0.07], [-0.12, -0.064]], 0.034, 0.004));
  // sights
  metal.push(...rearNotch(-0.014, 0.0));
  metal.push(...frontPost(-0.013, 0.425));
  // magazine (curved) as its own part for reloads
  const magG = profile([[0.065, -0.0], [0.108, -0.0], [0.118, -0.06], [0.135, -0.12], [0.148, -0.16], [0.105, -0.17], [0.092, -0.12], [0.078, -0.06]], 0.024, 0.0025);
  magG.translate(0, 0, 0);
  const mag = new THREE.Group();
  const magMesh = mesh([magG, bx(0.026, 0.008, 0.05, 0, -0.166, 0.128)], M.fde);
  mag.add(magMesh); mag.position.set(0, -0.072, 0);
  root.add(mesh(metal, M.metal), mesh(poly, M.polymer), mesh(fde, M.fde), mesh(black, M.black), bolt, mag);
  const { group: handG, left } = hands(M, new THREE.Vector3(0.0, -0.105, 0.0), new THREE.Vector3(0, -0.068, -0.3), new THREE.Vector3(-0.15, -0.22, 0.32));
  root.add(handG);
  return { root, mag, bolt, leftHand: left, muzzle: new THREE.Vector3(0, -0.04, -0.62), eject: new THREE.Vector3(0.02, -0.036, -0.095), magHome: mag.position.clone() };
}

// ---------- KS-12 pump shotgun ----------
function buildSG(M) {
  const root = new THREE.Group();
  const metal = [], poly = [], black = [];
  metal.push(profile([[-0.03, -0.018], [0.21, -0.018], [0.21, -0.08], [0.06, -0.082], [-0.03, -0.07]], 0.04, 0.003));
  black.push(bx(0.002, 0.022, 0.07, 0.0205, -0.042, 0.1)); // ejection port
  black.push(bx(0.024, 0.002, 0.08, 0, -0.0825, 0.12)); // loading port
  metal.push(cyl(0.012, 0.2, 0.73, -0.032, 18));
  metal.push(cyl(0.0125, 0.2, 0.64, -0.062, 16));
  metal.push(cyl(0.014, 0.64, 0.66, -0.062, 16));
  metal.push(bx(0.008, 0.032, 0.014, 0, -0.047, 0.64));
  poly.push(profile([[0.0, -0.075], [-0.03, -0.07], [-0.07, -0.17], [-0.1, -0.175], [-0.065, -0.07]], 0.032, 0.004));
  poly.push(profile([[-0.03, -0.02], [-0.33, -0.04], [-0.34, -0.15], [-0.3, -0.155], [-0.1, -0.09], [-0.03, -0.075]], 0.04, 0.005));
  metal.push(profile([[0.06, -0.08], [0.06, -0.1], [-0.005, -0.102], [-0.005, -0.095], [0.054, -0.094], [0.054, -0.08]], 0.009, 0.001));
  black.push(bx(0.004, 0.018, 0.006, 0, -0.088, 0.035));
  // sights: rear notch on the receiver, front post with fiber tip near the muzzle
  metal.push(...rearNotch(-0.018, 0.0, 0.0085));
  metal.push(...frontPost(-0.02, 0.7, 0.0034));
  const fiber = new THREE.Mesh(new THREE.BoxGeometry(0.0036, 0.0028, 0.006), M.fiber); fiber.position.set(0, -0.0014, -0.7);
  // pump with ribs (moves with the left hand)
  const pump = new THREE.Group();
  const pg = [cyl(0.024, 0.3, 0.47, -0.058, 18)];
  for (let i = 0; i < 7; i++) { const t = new THREE.TorusGeometry(0.0245, 0.003, 6, 18); t.translate(0, -0.058, -(0.32 + i * 0.022)); pg.push(t); }
  pump.add(mesh(pg, M.olive));
  root.add(mesh(metal, M.metal), mesh(poly, M.olive), mesh(black, M.black), fiber, pump);
  const { group: handG, left } = hands(M, new THREE.Vector3(-0.045, -0.115, 0.0), new THREE.Vector3(0, -0.085, -0.39), new THREE.Vector3(-0.14, -0.22, 0.34));
  root.remove(handG); root.add(handG);
  // left hand rides on the pump
  handG.remove(left); pump.add(left);
  const shell = mesh([cyl(0.0105, 0, 0.05, 0, 12), cyl(0.0115, 0.05, 0.064, 0, 12)], M.hull);
  shell.visible = false; root.add(shell);
  return { root, pump, leftHand: left, shell, muzzle: new THREE.Vector3(0, -0.032, -0.74), eject: new THREE.Vector3(0.025, -0.04, -0.1) };
}

// ---------- MR-30 marksman with reflex sight ----------
function buildMR(M, redDotMat) {
  const root = new THREE.Group();
  const metal = [], fde = [], poly = [], black = [];
  const railTop = -0.034;
  fde.push(profile([[-0.06, -0.075], [0.25, -0.075], [0.25, -0.042], [-0.06, -0.042]], 0.04, 0.003));
  metal.push(...rail(-0.06, 0.25, railTop + 0.0)); // optics rail
  fde.push(profile([[0.25, -0.083], [0.58, -0.08], [0.58, -0.04], [0.25, -0.04]], 0.046, 0.004));
  metal.push(...rail(0.26, 0.56, -0.036));
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) black.push(bx(0.002, 0.01, 0.034, s * 0.0232, -0.06, 0.29 + i * 0.048));
  metal.push(cyl(0.011, 0.58, 0.79, -0.058, 16));
  metal.push(bx(0.03, 0.03, 0.06, 0, -0.058, 0.82));
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) black.push(bx(0.002, 0.018, 0.009, s * 0.0152, -0.058, 0.8 + i * 0.016));
  poly.push(profile([[0.03, -0.075], [0.005, -0.075], [-0.025, -0.175], [-0.055, -0.18], [-0.035, -0.075]], 0.032, 0.004));
  fde.push(profile([[-0.06, -0.044], [-0.33, -0.05], [-0.34, -0.165], [-0.3, -0.17], [-0.22, -0.1], [-0.06, -0.09]], 0.036, 0.005));
  poly.push(profile([[-0.12, -0.04], [-0.27, -0.042], [-0.27, -0.05], [-0.12, -0.05]], 0.034, 0.003)); // cheek riser
  metal.push(profile([[0.07, -0.075], [0.07, -0.098], [0.0, -0.1], [0.0, -0.094], [0.064, -0.092], [0.064, -0.075]], 0.009, 0.001));
  black.push(bx(0.004, 0.018, 0.006, 0, -0.085, 0.04));
  black.push(bx(0.002, 0.016, 0.06, 0.0205, -0.058, 0.13));
  const bolt = mesh([bx(0.014, 0.012, 0.03, -0.026, -0.052, 0.12), cyl(0.006, 0.115, 0.125, -0.052, 10, -0.04)], M.metal);
  // reflex sight (open RMR-style): base, hood frame, lens with collimated dot shader
  const opt = [];
  opt.push(bx(0.03, 0.012, 0.042, 0, railTop + 0.006, 0.02)); // mount
  opt.push(bx(0.035, 0.009, 0.034, 0, -0.0175, 0.019)); // housing base (holds the emitter)
  const hood = new THREE.Group();
  const optMesh = mesh(opt, M.metal);
  const walls = [
    bx(0.004, 0.032, 0.03, -0.0155, 0.001, 0.019), bx(0.004, 0.032, 0.03, 0.0155, 0.001, 0.019), bx(0.035, 0.004, 0.03, 0, 0.0185, 0.019),
    bx(0.035, 0.003, 0.004, 0, 0.0165, 0.033), bx(0.003, 0.032, 0.004, -0.0145, 0.001, 0.033), bx(0.003, 0.032, 0.004, 0.0145, 0.001, 0.033),
  ];
  hood.add(optMesh, mesh(walls, M.metal));
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.027, 0.03), redDotMat);
  lens.position.set(0, 0.002, -0.032);
  hood.add(lens);
  const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.004), M.darkMetal); emitter.position.set(0, -0.014, -0.006); hood.add(emitter);
  const mag = new THREE.Group();
  mag.add(mesh([bx(0.026, 0.12, 0.05, 0, -0.06, 0.1), bx(0.03, 0.01, 0.054, 0, -0.123, 0.1)], M.polymer));
  mag.position.set(0, -0.075, 0); mag.rotation.x = 0.06;
  root.add(mesh(metal, M.metal), mesh(fde, M.fde), mesh(poly, M.polymer), mesh(black, M.black), bolt, hood, mag);
  const { group: handG, left } = hands(M, new THREE.Vector3(-0.012, -0.115, 0.0), new THREE.Vector3(0, -0.1, -0.37), new THREE.Vector3(-0.15, -0.22, 0.33));
  root.add(handG);
  return { root, mag, bolt, leftHand: left, lens, muzzle: new THREE.Vector3(0, -0.058, -0.855), eject: new THREE.Vector3(0.022, -0.058, -0.13), magHome: mag.position.clone() };
}

// Collimated red dot: the dot sits at infinity along the weapon's bore axis,
// so it is only visible through the glass and stays on target while the gun sways.
export function redDotMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { axis: { value: new THREE.Vector3(0, 0, -1) }, radius: { value: 0.0021 }, brightness: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vView; varying vec2 vUv;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 axis; uniform float radius, brightness; varying vec3 vView; varying vec2 vUv;
      void main() {
        vec3 rd = normalize(vView);
        float ang = acos(clamp(dot(rd, normalize(axis)), -1.0, 1.0));
        float dotCore = smoothstep(radius, radius * 0.45, ang);
        float halo = exp(-ang / (radius * 1.6)) * 0.35;
        vec3 tint = mix(vec3(0.25, 0.6, 0.55), vec3(0.6, 0.3, 0.7), vUv.y) * 0.06;
        float edge = smoothstep(0.5, 0.42, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)));
        vec3 col = tint + vec3(1.0, 0.08, 0.05) * (dotCore * 3.5 + halo) * brightness;
        float a = (0.1 + dotCore + halo) * edge;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  });
}

export function buildWeaponModels() {
  const M = gunMaterials();
  const dot = redDotMaterial();
  return { ar: buildAR(M), sg: buildSG(M), mr: buildMR(M, dot), materials: M, redDot: dot };
}
