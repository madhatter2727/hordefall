import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { noiseField, normalFromHeight } from '../world/textures.js';
import { mulberry } from '../core/util.js';

// Model space: barrel points to -Z. y = 0 is the sight line. z = 0 is the rear sight / optic.
// "u" means distance forward (toward the muzzle), so z = -u.

// ======================================================================= textures
const TS = 512;
function canvasTex(c, srgb) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function scratchLayer(seed, count, maxLen) {
  const c = document.createElement('canvas'); c.width = c.height = TS;
  const x = c.getContext('2d'); const r = mulberry(seed);
  x.fillStyle = '#000'; x.fillRect(0, 0, TS, TS); x.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const a = (r() < 0.6 ? 0.3 : r() * 6.28) + r() * 0.5, len = 6 + r() * maxLen;
    const px = r() * TS, py = r() * TS;
    x.strokeStyle = `rgba(255,255,255,${0.25 + r() * 0.7})`; x.lineWidth = 0.5 + r() * 1.1;
    x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * len * 0.5 + (r() - 0.5) * 6, py + Math.sin(a) * len * 0.5 + (r() - 0.5) * 6, px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke();
  }
  for (let i = 0; i < count * 0.4; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.6})`; x.beginPath(); x.arc(r() * TS, r() * TS, 0.6 + r() * 1.8, 0, 6.28); x.fill(); }
  return x.getImageData(0, 0, TS, TS).data;
}
// generic PBR detail set: albedo variation, roughness, normal
function detailSet({ seed, noiseScale, noiseAmp, scratches = 0, scratchLen = 60, weave = 0, rough = 0.6, roughVar = 0.25, scratchRough = -0.3, normalStrength = 2.5, albedoVar = 0.12, scratchAlbedo = 0.25 }) {
  const n = noiseField(TS, TS, noiseScale, seed, 4), fine = noiseField(TS, TS, 3, seed + 7, 2);
  const s = scratches ? scratchLayer(seed + 3, scratches, scratchLen) : null;
  const h = new Float32Array(TS * TS);
  const [ca, cr] = [document.createElement('canvas'), document.createElement('canvas')];
  ca.width = ca.height = cr.width = cr.height = TS;
  const ia = ca.getContext('2d').createImageData(TS, TS), ir = cr.getContext('2d').createImageData(TS, TS);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const i = y * TS + x, sc = s ? s[i * 4] / 255 : 0;
    let w = 0;
    if (weave) { const p = weave; w = (Math.sin((x / p) * Math.PI) * Math.sin((y / p) * Math.PI) > 0 ? 1 : 0) * 0.5 + 0.5 * Math.abs(Math.sin(((x + y) / p) * Math.PI)); }
    h[i] = n[i] * noiseAmp + fine[i] * noiseAmp * 0.6 - sc * 0.7 + w * 0.6;
    const alb = 0.82 + (n[i] - 0.5) * albedoVar * 2 + (fine[i] - 0.5) * albedoVar + sc * scratchAlbedo - w * 0.08;
    const ro = rough + (n[i] - 0.5) * roughVar * 2 + (fine[i] - 0.5) * roughVar * 0.5 + sc * scratchRough;
    const av = Math.max(0, Math.min(255, alb * 255)), rv = Math.max(0, Math.min(255, ro * 255));
    ia.data.set([av, av, av, 255], i * 4); ir.data.set([rv, rv, rv, 255], i * 4);
  }
  ca.getContext('2d').putImageData(ia, 0, 0); cr.getContext('2d').putImageData(ir, 0, 0);
  return { map: canvasTex(ca, true), roughnessMap: canvasTex(cr, false), normalMap: canvasTex(normalFromHeight(h, TS, TS, normalStrength), false) };
}

// MeshStandardMaterial + edge wear: bevelled/rounded edges (tagged per vertex) get lighter, shinier "bare" finish.
// specular AA: raise roughness where the shading normal changes faster than a pixel can resolve
const GSAA = `#include <lights_physical_fragment>
  { vec3 dn = fwidth(normal); float g = clamp(max(max(dn.x, dn.y), dn.z) * 1.6, 0.0, 0.85);
    material.roughness = clamp(sqrt(material.roughness * material.roughness + g * g), 0.0, 1.0); }`;
function gsaa(m) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', GSAA); };
  const key = m.customProgramCacheKey?.() || ''; m.customProgramCacheKey = () => key + '|gsaa';
  return m;
}
function gunMat(opts, wear = null) {
  const m = new THREE.MeshStandardMaterial(opts);
  if (!wear) return gsaa(m);
  const wearCol = new THREE.Color(wear.color), amount = wear.amount ?? 0.6, wearMetal = wear.metal ?? 0.8;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.wearCol = { value: wearCol }; sh.uniforms.wearAmt = { value: amount }; sh.uniforms.wearMetal = { value: wearMetal };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float edge; varying float vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = edge;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 wearCol; uniform float wearAmt, wearMetal; varying float vEdge;')
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        float ew = clamp(vEdge, 0.0, 1.0) * wearAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb, wearCol, ew);
        metalnessFactor = mix(metalnessFactor, wearMetal, ew);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.55, ew);`);
  };
  m.customProgramCacheKey = () => 'gunwear';
  return gsaa(m);
}

export function gunMaterials() {
  const metalD = detailSet({ seed: 3, noiseScale: 40, noiseAmp: 0.35, scratches: 260, rough: 0.5, roughVar: 0.15, normalStrength: 2.2 });
  const steelD = detailSet({ seed: 8, noiseScale: 24, noiseAmp: 0.4, scratches: 160, scratchLen: 30, rough: 0.42, roughVar: 0.12, normalStrength: 2 });
  const polyD = detailSet({ seed: 5, noiseScale: 6, noiseAmp: 0.9, scratches: 60, scratchLen: 30, rough: 0.72, roughVar: 0.1, normalStrength: 3.5, albedoVar: 0.06, scratchAlbedo: 0.15, scratchRough: -0.15 });
  const ceraD = detailSet({ seed: 13, noiseScale: 16, noiseAmp: 0.5, scratches: 180, rough: 0.62, roughVar: 0.12, normalStrength: 2.2, albedoVar: 0.08, scratchAlbedo: 0.3 });
  const fabD = detailSet({ seed: 9, noiseScale: 20, noiseAmp: 0.3, weave: 3, rough: 0.92, roughVar: 0.05, normalStrength: 3, albedoVar: 0.1 });
  const fab2 = detailSet({ seed: 21, noiseScale: 30, noiseAmp: 0.4, weave: 4, rough: 0.95, roughVar: 0.04, normalStrength: 2.4, albedoVar: 0.22 });
  const ns = (v) => new THREE.Vector2(v, v);
  return {
    metal: gunMat({ color: '#41444a', metalness: 0.55, roughness: 1, ...metalD, normalScale: ns(0.45), envMapIntensity: 1.3 }, { color: '#a3a7ae', amount: 0.5, metal: 0.95 }),
    steel: gunMat({ color: '#34373c', metalness: 0.75, roughness: 1, ...steelD, normalScale: ns(0.4), envMapIntensity: 1.3 }, { color: '#979ba2', amount: 0.45, metal: 1 }),
    darkMetal: gunMat({ color: '#3a3c41', metalness: 0.6, roughness: 1, ...steelD, normalScale: ns(0.35) }, { color: '#9da1a8', amount: 0.5, metal: 1 }),
    polymer: gunMat({ color: '#3d4045', metalness: 0.0, roughness: 1, ...polyD, normalScale: ns(0.55) }, { color: '#6c7077', amount: 0.45, metal: 0 }),
    fde: gunMat({ color: '#b39a74', metalness: 0.12, roughness: 1, ...ceraD, normalScale: ns(0.4) }, { color: '#b9b7b1', amount: 0.55, metal: 0.85 }),
    fdePoly: gunMat({ color: '#a88f6a', metalness: 0.0, roughness: 1, ...polyD, normalScale: ns(0.55) }, { color: '#cfbf9f', amount: 0.4, metal: 0 }),
    olive: gunMat({ color: '#5e6646', metalness: 0.0, roughness: 1, ...polyD, normalScale: ns(0.55) }, { color: '#8b926f', amount: 0.45, metal: 0 }),
    rubber: gsaa(new THREE.MeshStandardMaterial({ color: '#232427', roughness: 1, ...polyD, normalScale: ns(0.8) })),
    black: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.85, metalness: 0.2 }),
    brass: new THREE.MeshStandardMaterial({ color: '#d0a253', metalness: 1, roughness: 0.28 }),
    hull: new THREE.MeshStandardMaterial({ color: '#9a231c', metalness: 0.1, roughness: 0.5 }),
    glove: gsaa(new THREE.MeshStandardMaterial({ color: '#4a4b4c', metalness: 0, roughness: 1, ...fabD, normalScale: ns(0.9) })),
    knuckle: gunMat({ color: '#2b2c2e', metalness: 0, roughness: 1, ...polyD, normalScale: ns(0.6) }, { color: '#55585c', amount: 0.5, metal: 0 }),
    palm: new THREE.MeshStandardMaterial({ color: '#6b5a48', metalness: 0, roughness: 1, ...polyD, normalScale: ns(0.5) }),
    sleeve: new THREE.MeshStandardMaterial({ color: '#5c624b', metalness: 0, roughness: 1, ...fab2, normalScale: ns(1.0) }),
    cuff: new THREE.MeshStandardMaterial({ color: '#3a3f31', metalness: 0, roughness: 1, ...fabD, normalScale: ns(0.8) }),
    fiber: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a10').multiplyScalar(3), toneMapped: false }),
    lensGlass: new THREE.MeshStandardMaterial({ color: '#0a0c0f', metalness: 0.9, roughness: 0.1 }),
    stainless: gunMat({ color: '#8e9197', metalness: 0.85, roughness: 1, ...steelD, normalScale: ns(0.3), envMapIntensity: 1.4 }, { color: '#c9ccd2', amount: 0.35, metal: 1 }),
    wood: gunMat({ color: '#6a3b20', metalness: 0, roughness: 1, ...ceraD, normalScale: ns(0.35) }, { color: '#9a6a44', amount: 0.5, metal: 0 }),
    gunmetal: gunMat({ color: '#2d3036', metalness: 0.7, roughness: 1, ...metalD, normalScale: ns(0.35), envMapIntensity: 1.3 }, { color: '#8e939b', amount: 0.5, metal: 1 }),
  };
}

// ======================================================================= geometry helpers
const DENS = 9; // texture tiles per metre (box-projected UVs give constant texel density)
function prep(g) {
  if (g.index) g = g.toNonIndexed();
  ['uv1', 'uv2'].forEach((a) => g.deleteAttribute(a));
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * DENS; uv[i * 2 + 1] = v * DENS;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (!g.attributes.edge) g.setAttribute('edge', new THREE.BufferAttribute(new Float32Array(p.count), 1));
  return g;
}
function tagEdges(g, test) {
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  const n = g.attributes.normal, e = new Float32Array(n.count);
  for (let i = 0; i < n.count; i++) e[i] = test(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))) ? 1 : 0;
  g.setAttribute('edge', new THREE.BufferAttribute(e, 1));
  return g;
}
function mesh(geos, mat) {
  const list = (Array.isArray(geos) ? geos : [geos]).map(prep);
  const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat);
  m.castShadow = false; return m;
}
// build a THREE.Shape from [u,y] points or [cu,cy,u,y] quadratic segments
function shapeOf(pts) {
  const s = new THREE.Shape();
  pts.forEach((p, i) => { if (i === 0) s.moveTo(p[0], p[1]); else if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]); else s.lineTo(p[0], p[1]); });
  s.closePath(); return s;
}
function slotPath(u0, u1, yc, h) {
  const r = h / 2, p = new THREE.Path();
  p.moveTo(u0 + r, yc - r); p.lineTo(u1 - r, yc - r); p.absarc(u1 - r, yc, r, -Math.PI / 2, Math.PI / 2, false);
  p.lineTo(u0 + r, yc + r); p.absarc(u0 + r, yc, r, Math.PI / 2, Math.PI * 1.5, false); return p;
}
// side-profile extrusion (shape in u/y, thickness across X), bevelled so edges catch highlights
function profile(pts, width, bevel = 0.0018, segs = 2, holes = [], x = 0) {
  const s = Array.isArray(pts) ? shapeOf(pts) : pts;
  holes.forEach((h) => s.holes.push(h));
  const depth = Math.max(0.0004, width - bevel * 2);
  let g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 10 });
  g.rotateY(Math.PI / 2); g.translate(-depth / 2 + x, 0, 0);
  return tagEdges(g, (ax) => ax > 0.08 && ax < 0.985);
}
// front-view extrusion (shape in x/y, depth along -z starting at u)
function front(shape, depth, u, bevel = 0.0006) {
  let g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.0003, depth - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, -u - depth + bevel);
  return tagEdges(g, (ax, ay, az) => az > 0.08 && az < 0.985);
}
function rbx(w, h, d, x, y, u, r, seg = 2) {
  r = r ?? Math.min(w, h, d) * 0.28;
  let g = new RoundedBoxGeometry(w, h, d, seg, r); g.translate(x, y, -u);
  return tagEdges(g, (ax, ay, az) => Math.max(ax, ay, az) < 0.93);
}
function bx(w, h, d, x, y, u) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, -u); return g; }
function cyl(r, u0, u1, y, seg = 18, x = 0, r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, u1 - u0, seg); g.rotateX(-Math.PI / 2); g.translate(x, y, -(u0 + u1) / 2); return g;
}
function crossPin(r, len, y, u, x = 0) { const g = new THREE.CylinderGeometry(r, r, len, 12); g.rotateZ(Math.PI / 2); g.translate(x, y, -u); return g; }
// lathe around the bore: pts [[radius, u], ...]
function lathe(pts, y, seg = 24, x = 0, sx = 1, sy = 1) {
  const g = new THREE.LatheGeometry(pts.map(([r, u]) => new THREE.Vector2(r, u)), seg);
  g.rotateX(-Math.PI / 2); g.scale(sx, sy, 1); g.translate(x, y, 0);
  return tagEdges(g, () => false);
}
// picatinny: base strip + rounded teeth; yTop = top of teeth
function rail(u0, u1, yTop, w = 0.021) {
  const out = [rbx(w, 0.0055, u1 - u0, 0, yTop - 0.003 - 0.00275, (u0 + u1) / 2, 0.0009)];
  for (let u = u0 + 0.004; u < u1 - 0.004; u += 0.0101) out.push(rbx(w + 0.0024, 0.0032, 0.0052, 0, yTop - 0.0016, u + 0.0026, 0.0007, 1));
  return out;
}
function screws(list, mat) { return mesh(list.map(([x, y, u, r = 0.0018]) => { const g = new THREE.CylinderGeometry(r, r, 0.0016, 10); g.rotateZ(Math.PI / 2); g.translate(x, y, -u); return g; }), mat); }

// ---------- iron sights ----------
// Rear aperture: thin ring on a slim stem with protective wings. Aperture centred on the sight line.
function rearAperture(baseY, u, hole = 0.0045, ring = 0.0016, wingX = 0.0085) {
  const outer = hole + ring;
  const s = new THREE.Shape(); s.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(h);
  const ringG = front(s, 0.0022, u - 0.0011, 0.0004);
  const geos = [ringG,
    rbx(0.0036, -outer - baseY + 0.0008, 0.0022, 0, (baseY - outer) / 2, u, 0.0005), // stem
    rbx(0.022, 0.006, 0.02, 0, baseY + 0.003, u - 0.002, 0.0012), // rail clamp
  ];
  // protective wings: thin tapered plates either side
  for (const sx of [-1, 1]) {
    const wing = profile([[u - 0.006, baseY + 0.004], [u + 0.006, baseY + 0.004], [u + 0.0025, outer + 0.0006], [u - 0.0025, outer + 0.0006]], 0.0016, 0.0003, 1);
    wing.translate(sx * wingX, 0, 0); geos.push(wing);
  }
  return geos;
}
// Front sight: slim post (top on the sight line) inside a round protective hood.
function frontHoodPost(baseY, u, hoodR = 0.0078, postW = 0.0021) {
  const hood = new THREE.TorusGeometry(hoodR, 0.00105, 8, 32); hood.translate(0, -0.0006, -u);
  const geos = [tagEdges(hood, () => true),
    rbx(postW, -(baseY + 0.006), 0.0022, 0, (baseY + 0.006) / 2, u, 0.0004), // post from the clamp up to y=0
    rbx(0.024, 0.0065, 0.016, 0, baseY + 0.00325, u, 0.0012), // rail clamp
  ];
  // A-frame struts from clamp to hood
  for (const sx of [-1, 1]) {
    const g = rbx(0.0018, Math.abs(baseY) - 0.002, 0.007, 0, 0, 0, 0.0004); g.rotateZ(sx * 0.42); g.translate(sx * hoodR * 0.62, (baseY + 0.0065 - hoodR) / 2 + 0.0005, -u); geos.push(g);
  }
  return geos;
}

// ======================================================================= hands
function limbGeo(a, b, r) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0005, len), 4, 10);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); return g;
}
function chain(start, segs, r, taper = 0.92) {
  const out = []; let p = start.clone(), rr = r;
  for (const [d, len] of segs) { const q = p.clone().addScaledVector(new THREE.Vector3(...d).normalize(), len); out.push(limbGeo(p, q, rr)); p = q; rr *= taper; }
  return out;
}
function taper(a, b, radii, seg = 20) {
  const len = a.distanceTo(b);
  const g = new THREE.LatheGeometry(radii.map(([t, r]) => new THREE.Vector2(r, t * len)), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z); return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RB = (w, h, d, x, y, z, r) => { const g = new RoundedBoxGeometry(w, h, d, 3, r ?? Math.min(w, h, d) * 0.45); g.translate(x, y, z); return g; };
function sleeveGeos(a, b, M) {
  const s = taper(a, b, [[0, 0.0], [0.0, 0.03], [0.06, 0.033], [0.14, 0.035], [0.18, 0.032], [0.24, 0.035], [0.5, 0.039], [0.8, 0.042], [1, 0.043]], 22);
  const band = taper(a.clone().lerp(b, 0.02), a.clone().lerp(b, 0.1), [[0, 0.0315], [0.15, 0.034], [0.85, 0.034], [1, 0.0315]], 22);
  return [mesh(s, M.sleeve), mesh(band, M.cuff)];
}

// Right hand around a raked pistol grip. Local frame: y up the grip, -z forward, x right.
function rightHand(M, at, rake, elbowDir) {
  const g = new THREE.Group(); g.position.copy(at); g.rotation.x = rake;
  const glove = [], pads = [];
  glove.push(RB(0.024, 0.082, 0.058, 0.026, -0.004, 0.006, 0.011)); // palm/back of hand
  glove.push(RB(0.05, 0.024, 0.03, 0.008, 0.037, 0.026, 0.011)); // web over the beavertail
  const fy = [0.011, -0.012, -0.034], fr = [0.0098, 0.0095, 0.0086];
  fy.forEach((y, i) => glove.push(...chain(V(0.027, y, -0.018), [[[-0.35, 0, -1], 0.017], [[-1, -0.05, -0.12], 0.026 - i * 0.002], [[-0.8, -0.05, 0.6], 0.016]], fr[i])));
  glove.push(...chain(V(0.027, 0.031, -0.016), [[[-0.15, -0.12, -1], 0.026], [[-0.55, -0.35, -0.75], 0.019], [[-0.8, -0.6, 0.05], 0.013]], 0.0092)); // trigger finger
  glove.push(...chain(V(0.012, 0.036, 0.012), [[[-0.75, 0.35, -0.55], 0.028], [[-0.15, 0.05, -1], 0.028]], 0.0105)); // thumb
  pads.push(RB(0.007, 0.064, 0.02, 0.04, -0.012, -0.017, 0.003)); // knuckle armour
  pads.push(RB(0.006, 0.046, 0.034, 0.039, -0.004, 0.011, 0.0028)); // back-of-hand pad
  const wrist = V(0.02, -0.044, 0.028), cuffEnd = V(0.024, -0.082, 0.052);
  glove.push(taper(wrist, cuffEnd, [[0, 0.0], [0, 0.024], [0.3, 0.027], [1, 0.029]], 18));
  g.add(mesh(glove, M.glove), mesh(pads, M.knuckle));
  g.updateMatrix();
  const base = cuffEnd.clone().applyMatrix4(g.matrix);
  return { group: g, arm: sleeveGeos(base, base.clone().add(elbowDir), M) };
}
// Left support hand under a handguard (half width hw, half height hh). Frame = gun frame.
function leftHand(M, at, hw, hh, elbowDir) {
  const g = new THREE.Group(); g.position.copy(at);
  const glove = [], pads = [], palm = [];
  palm.push(RB(0.05, 0.02, 0.074, -0.004, -hh - 0.0105, 0.004, 0.009));
  const zs = [-0.028, -0.009, 0.01, 0.028], rs = [0.0094, 0.0097, 0.0092, 0.0084];
  zs.forEach((z, i) => glove.push(...chain(V(hw - 0.004, -hh - 0.008, z), [[[0.55, 1, 0], 0.02], [[0.06, 1, 0], 0.021 - i * 0.002], [[-0.65, 0.75, 0], 0.013]], rs[i])));
  glove.push(...chain(V(-hw + 0.004, -hh - 0.004, 0.03), [[[-0.35, 0.6, -0.7], 0.03], [[-0.05, 0.25, -1], 0.027]], 0.0105));
  pads.push(RB(0.006, 0.016, 0.074, hw + 0.0125, -hh + 0.011, 0.0, 0.0026));
  const wrist = V(-0.008, -hh - 0.016, 0.04), cuffEnd = V(-0.028, -hh - 0.044, 0.078);
  glove.push(taper(wrist, cuffEnd, [[0, 0.0], [0, 0.024], [0.3, 0.027], [1, 0.029]], 18));
  g.add(mesh(glove, M.glove), mesh(palm, M.glove), mesh(pads, M.knuckle));
  const arm = new THREE.Group(); sleeveGeos(cuffEnd, cuffEnd.clone().add(elbowDir), M).forEach((m) => arm.add(m)); g.add(arm);
  return g;
}

// ======================================================================= AR-7 VANGUARD
function buildAR(M) {
  const root = new THREE.Group();
  const metal = [], steel = [], poly = [], black = [], rub = [];
  const RT = -0.0155; // rail top
  // upper receiver with chamfered top edges + rail
  metal.push(profile([[-0.034, -0.05], [0.18, -0.05], [0.18, -0.0215], [-0.024, -0.0215], [-0.034, -0.027]], 0.03, 0.0022, 3));
  metal.push(...rail(-0.03, 0.178, RT));
  metal.push(rbx(0.008, 0.012, 0.02, 0.0175, -0.031, 0.045, 0.002)); // brass deflector
  metal.push(rbx(0.0032, 0.016, 0.054, 0.0157, -0.037, 0.105, 0.0012)); // dust cover
  black.push(rbx(0.0015, 0.004, 0.05, 0.0172, -0.031, 0.105, 0.0005));
  metal.push(cyl(0.0062, -0.012, 0.016, -0.036, 14, 0.021), lathe([[0, -0.016], [0.0072, -0.016], [0.0072, -0.011], [0, -0.011]], -0.036, 14, 0.021)); // forward assist
  // lower receiver + flared magwell + trigger guard
  metal.push(profile([[-0.034, -0.05], [0.158, -0.05], [0.158, -0.064], [0.124, -0.066], [0.124, -0.073], [0.06, -0.073], [0.056, -0.068], [0.03, -0.072], [0.0, -0.068], [-0.034, -0.062]], 0.031, 0.002, 3));
  metal.push(profile([[0.058, -0.064], [0.126, -0.064], [0.13, -0.092], [0.054, -0.092]], 0.034, 0.002, 2));
  metal.push(profile([[0.062, -0.07], [0.062, -0.094], [0.004, -0.096], [-0.004, -0.088], [0.004, -0.088], [0.054, -0.088], [0.054, -0.07]], 0.009, 0.0012, 2));
  steel.push(crossPin(0.0027, 0.035, -0.057, -0.025), crossPin(0.0027, 0.035, -0.057, 0.148), crossPin(0.0045, 0.033, -0.064, 0.045));
  metal.push(rbx(0.006, 0.006, 0.006, 0.017, -0.06, 0.003, 0.0015)); // selector
  black.push(profile([[0.04, -0.07], [0.043, -0.07], [0.04, -0.081], [0.033, -0.087], [0.035, -0.08]], 0.005, 0.0008, 1));
  // pistol grip (stippled polymer, finger groove, beavertail)
  poly.push(profile([[0.028, -0.066], [0.022, -0.088], [0.019, -0.1, 0.012, -0.104], [0.012, -0.125, 0.0, -0.146], [-0.012, -0.17], [-0.03, -0.178, -0.05, -0.168], [-0.039, -0.12], [-0.03, -0.085, -0.042, -0.07], [-0.012, -0.064]], 0.03, 0.005, 3));
  // free-float handguard: slotted side walls (see-through), chamfers, top rail, bottom panel
  const H0 = 0.18, H1 = 0.462, HY0 = -0.066, HY1 = -0.0215, HW = 0.025;
  const slots = () => [0, 1, 2, 3].map((i) => slotPath(H0 + 0.034 + i * 0.062, H0 + 0.07 + i * 0.062, -0.0445, 0.0075));
  for (const sx of [-1, 1]) metal.push(profile([[H0, HY0 + 0.006], [H1, HY0 + 0.006], [H1, HY1 - 0.006], [H0, HY1 - 0.006]], 0.0034, 0.0006, 1, slots(), sx * (HW - 0.0017)));
  metal.push(rbx(0.036, 0.0034, H1 - H0, 0, HY1 - 0.0017, (H0 + H1) / 2, 0.0008));
  metal.push(rbx(0.036, 0.0034, H1 - H0, 0, HY0 + 0.0017, (H0 + H1) / 2, 0.0008));
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const g = rbx(0.0115, 0.0034, H1 - H0, 0, 0, (H0 + H1) / 2, 0.0008); g.rotateZ(sx * sy * Math.PI / 4);
    g.translate(sx * (HW - 0.0035), sy > 0 ? HY1 - 0.0045 : HY0 + 0.0045, 0); metal.push(g);
  }
  for (let i = 0; i < 4; i++) black.push(rbx(0.012, 0.0006, 0.026, 0, HY0 - 0.0001, H0 + 0.05 + i * 0.062, 0.0002));
  metal.push(...rail(H0 + 0.004, H1 - 0.004, RT));
  metal.push(lathe([[0.0105, H1 - 0.002], [0.0175, H1 - 0.002], [0.0175, H1 + 0.004], [0.0105, H1 + 0.004]], -0.0435, 24)); // end cap ring
  // barrel visible through the vents, gas block, flash hider
  steel.push(cyl(0.0086, H0, 0.575, -0.0435, 18), rbx(0.02, 0.022, 0.02, 0, -0.0425, 0.38, 0.003));
  steel.push(lathe([[0, 0.574], [0.0108, 0.574], [0.0118, 0.58], [0.0118, 0.6], [0.0112, 0.632], [0.0098, 0.636], [0.0055, 0.636], [0.0055, 0.6], [0, 0.6]], -0.0435, 24));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; const g = bx(0.0028, 0.006, 0.03, 0, 0, 0); g.rotateZ(a); g.translate(Math.cos(a + Math.PI / 2) * 0.0106, -0.0435 + Math.sin(a + Math.PI / 2) * 0.0106, -0.62); black.push(g); }
  // buffer tube, castle nut, stock with cheek weld + rubber butt pad
  metal.push(cyl(0.0145, -0.24, -0.034, -0.044, 20), lathe([[0, -0.046], [0.0175, -0.046], [0.0175, -0.036], [0, -0.036]], -0.044, 10));
  poly.push(profile([[-0.122, -0.025], [-0.15, -0.022, -0.27, -0.025], [-0.276, -0.03], [-0.276, -0.128], [-0.254, -0.131], [-0.205, -0.085, -0.16, -0.068], [-0.122, -0.063]], 0.042, 0.006, 3));
  poly.push(rbx(0.01, 0.016, 0.06, 0, -0.069, -0.15, 0.003)); // adjustment lever housing
  rub.push(rbx(0.044, 0.104, 0.012, 0, -0.08, -0.281, 0.004));
  metal.push(lathe([[0, -0.21], [0.006, -0.21], [0.006, -0.2], [0, -0.2]], -0.05, 12, 0.023)); // QD socket
  // irons: flip-up aperture rear + hooded front post
  metal.push(...rearAperture(RT, 0.0));
  metal.push(...frontHoodPost(RT, 0.44));
  // charging handle (animated)
  const bolt = new THREE.Group();
  bolt.add(mesh([rbx(0.012, 0.005, 0.032, 0, -0.0235, -0.022, 0.0012), rbx(0.042, 0.0055, 0.011, 0, -0.0235, -0.04, 0.002), rbx(0.006, 0.006, 0.012, -0.018, -0.022, -0.04, 0.0015)], M.metal));
  // PMAG-style curved polymer mag with grip ribs + baseplate (own group for reloads)
  const mag = new THREE.Group();
  const magBody = profile([[0.066, 0.0], [0.122, 0.0], [0.128, -0.06], [0.142, -0.12, 0.156, -0.158], [0.108, -0.168], [0.094, -0.12, 0.078, -0.06]], 0.025, 0.003, 3);
  const ribs = []; for (let i = 0; i < 4; i++) ribs.push(rbx(0.0262, 0.0022, 0.04, 0, -0.03 - i * 0.008, 0.1 + i * 0.002, 0.0008));
  const plate = profile([[0.104, -0.162], [0.16, -0.152], [0.163, -0.162], [0.106, -0.174]], 0.029, 0.002, 2);
  mag.add(mesh([magBody, ...ribs], M.polymer), mesh(plate, M.polymer)); mag.position.set(0, -0.071, 0);
  root.add(mesh(metal, M.metal), mesh(steel, M.steel), mesh(poly, M.polymer), mesh(black, M.black), mesh(rub, M.rubber), bolt, mag);
  root.add(screws([[0.0157, -0.03, 0.2], [0.0157, -0.03, 0.32], [-0.0157, -0.03, 0.2], [0.0157, -0.06, 0.26]], M.darkMetal));
  // hands
  const rh = rightHand(M, V(0.0, -0.112, 0.016), -0.22, V(0.09, -0.24, 0.4));
  root.add(rh.group, ...rh.arm);
  const left = leftHand(M, V(0, -0.0435, -0.32), HW, 0.0225, V(-0.24, -0.22, 0.27));
  root.add(left);
  return { root, mag, bolt, leftHand: left, muzzle: V(0, -0.0435, -0.64), eject: V(0.02, -0.036, -0.1), magHome: mag.position.clone(),
    points: { magBottom: V(0, -0.071 - 0.165, -0.13), charge: V(0.012, -0.03, 0.035), chargeRot: new THREE.Euler(0.2, 0.4, 1.2) } };
}

// ======================================================================= KS-12 BREACHER (pump)
function buildSG(M) {
  const root = new THREE.Group();
  const metal = [], steel = [], poly = [], black = [], rub = [];
  const BY = -0.0305; // bore axis
  // receiver with a rounded top contour
  metal.push(profile([[-0.034, -0.03], [-0.028, -0.022, -0.012, -0.019], [0.2, -0.019], [0.212, -0.019, 0.218, -0.026], [0.218, -0.084], [0.06, -0.087], [-0.034, -0.078]], 0.038, 0.0035, 3));
  black.push(rbx(0.0016, 0.022, 0.07, 0.0193, -0.041, 0.115, 0.0006)); // ejection port
  metal.push(rbx(0.0016, 0.003, 0.074, 0.0195, -0.0285, 0.115, 0.0006));
  black.push(rbx(0.026, 0.0016, 0.085, 0, -0.0873, 0.125, 0.0006)); // loading port
  steel.push(rbx(0.016, 0.003, 0.05, 0, -0.084, 0.12, 0.001)); // shell lifter
  steel.push(crossPin(0.0026, 0.04, -0.07, 0.02), crossPin(0.0026, 0.04, -0.07, 0.17), crossPin(0.0034, 0.042, -0.083, -0.012)); // pins + safety
  // barrel, vent rib, muzzle crown, front post with fibre
  steel.push(cyl(0.0118, 0.218, 0.745, BY, 24), lathe([[0, 0.742], [0.0125, 0.742], [0.0125, 0.752], [0.008, 0.752], [0, 0.752]], BY, 24));
  steel.push(rbx(0.0075, 0.0022, 0.49, 0, -0.0158, 0.48, 0.0006));
  for (let u = 0.25; u < 0.72; u += 0.045) steel.push(rbx(0.004, 0.0035, 0.004, 0, -0.0178, u, 0.0006));
  // front post: wings + post + fibre on top (post top at y = 0)
  steel.push(rbx(0.0034, 0.0148, 0.006, 0, -0.0074 - 0.0008, 0.716, 0.0006));
  for (const sx of [-1, 1]) steel.push(profile([[0.708, -0.016], [0.724, -0.016], [0.72, -0.0005], [0.712, -0.0005]], 0.0016, 0.0003, 1, [], sx * 0.0062));
  steel.push(rbx(0.016, 0.004, 0.018, 0, -0.016, 0.716, 0.001));
  const fiber = new THREE.Mesh(new THREE.CylinderGeometry(0.0013, 0.0013, 0.008, 10).rotateX(Math.PI / 2), M.fiber); fiber.position.set(0, -0.0013, -0.716);
  // ghost-ring rear on the receiver
  metal.push(...rearAperture(-0.019, 0.0, 0.0048, 0.0018, 0.0098));
  // magazine tube + barrel clamp + end cap with sling loop
  steel.push(cyl(0.0118, 0.218, 0.66, -0.0615, 20));
  steel.push(lathe([[0, 0.66], [0.0128, 0.66], [0.0132, 0.664], [0.0132, 0.684], [0.0115, 0.69], [0, 0.69]], -0.0615, 20));
  steel.push(rbx(0.014, 0.036, 0.014, 0, -0.046, 0.62, 0.003));
  metal.push(new THREE.TorusGeometry(0.007, 0.0016, 8, 16).rotateY(Math.PI / 2).translate(0, -0.076, -0.68));
  // trigger group, pistol grip, buttstock with comb and recoil pad
  metal.push(profile([[0.062, -0.084], [0.062, -0.104], [0.0, -0.106], [-0.008, -0.098], [0.0, -0.098], [0.054, -0.098], [0.054, -0.084]], 0.009, 0.0012, 2));
  black.push(profile([[0.04, -0.085], [0.043, -0.085], [0.04, -0.094], [0.033, -0.1], [0.035, -0.093]], 0.005, 0.0008, 1));
  poly.push(profile([[0.006, -0.08], [0.0, -0.1], [-0.004, -0.112, -0.012, -0.116], [-0.016, -0.135, -0.03, -0.158], [-0.04, -0.176], [-0.056, -0.184, -0.075, -0.172], [-0.064, -0.13], [-0.054, -0.094, -0.064, -0.08]], 0.031, 0.005, 3));
  poly.push(profile([[-0.034, -0.026], [-0.12, -0.03, -0.33, -0.036], [-0.334, -0.04], [-0.334, -0.152], [-0.3, -0.156], [-0.17, -0.11, -0.075, -0.088], [-0.034, -0.08]], 0.04, 0.007, 3));
  rub.push(rbx(0.044, 0.124, 0.016, 0, -0.096, -0.338, 0.005));
  for (let i = 0; i < 4; i++) rub.push(rbx(0.0452, 0.002, 0.012, 0, -0.06 - i * 0.022, -0.338, 0.0006));
  // pump: ribbed oval forend (lathe), action bars (moves with the left hand)
  const pump = new THREE.Group();
  const prof = [[0, 0.3], [0.019, 0.3], [0.0225, 0.306]];
  for (let i = 0; i < 9; i++) { const u = 0.312 + i * 0.018; prof.push([0.0232, u], [0.0232, u + 0.011], [0.0214, u + 0.012], [0.0214, u + 0.017]); }
  prof.push([0.0232, 0.476], [0.0225, 0.482], [0.017, 0.486], [0, 0.486]);
  const pg = [lathe(prof, 0, 32, 0, 1, 1.18)];
  pg.forEach((g) => g.translate(0, -0.058, 0));
  pump.add(mesh(pg, M.olive));
  pump.add(mesh([rbx(0.0028, 0.006, 0.17, 0.016, -0.06, 0.225, 0.0008), rbx(0.0028, 0.006, 0.17, -0.016, -0.06, 0.225, 0.0008)], M.steel));
  root.add(mesh(metal, M.darkMetal), mesh(steel, M.steel), mesh(poly, M.polymer), mesh(black, M.black), mesh(rub, M.rubber), fiber, pump);
  const rh = rightHand(M, V(-0.044, -0.128, 0.044), -0.26, V(0.09, -0.24, 0.4));
  root.add(rh.group, ...rh.arm);
  const left = leftHand(M, V(0, -0.058, -0.4), 0.023, 0.027, V(-0.24, -0.22, 0.27));
  pump.add(left); // left hand rides on the pump
  const shell = mesh([cyl(0.0103, 0, 0.05, 0, 14), cyl(0.0112, 0.05, 0.062, 0, 14), lathe([[0, 0.0], [0.0105, 0.0], [0.0105, 0.003], [0, 0.003]], 0, 14)], M.hull);
  shell.visible = false; root.add(shell);
  return { root, pump, leftHand: left, shell, muzzle: V(0, BY, -0.755), eject: V(0.024, -0.04, -0.11),
    points: { port: V(0, -0.099, -0.13), caddy: V(0.07, -0.17, -0.2) } };
}

// ======================================================================= MR-30 LONGBOW (DMR, red dot)
function buildMR(M, redDotMat) {
  const root = new THREE.Group();
  const fde = [], steel = [], poly = [], black = [], rub = [], metal = [];
  const RT = -0.034, BY = -0.0605;
  fde.push(profile([[-0.062, -0.078], [0.255, -0.078], [0.255, -0.0415], [-0.05, -0.0415], [-0.062, -0.048]], 0.036, 0.0025, 3));
  fde.push(profile([[-0.062, -0.078], [0.2, -0.078], [0.2, -0.094], [0.15, -0.098], [0.15, -0.104], [0.07, -0.104], [0.066, -0.094], [0.04, -0.098], [-0.062, -0.09]], 0.036, 0.0022, 3));
  metal.push(...rail(-0.056, 0.25, RT, 0.022));
  black.push(rbx(0.0016, 0.018, 0.064, 0.0186, -0.058, 0.13, 0.0006));
  steel.push(crossPin(0.003, 0.04, -0.084, -0.04), crossPin(0.003, 0.04, -0.084, 0.19), crossPin(0.0048, 0.038, -0.09, 0.05));
  // handguard: slotted, long
  const H0 = 0.255, H1 = 0.6, HY0 = -0.089, HY1 = -0.0415, HW = 0.0265;
  const slots = () => [0, 1, 2, 3, 4].map((i) => slotPath(H0 + 0.03 + i * 0.064, H0 + 0.068 + i * 0.064, -0.065, 0.008));
  for (const sx of [-1, 1]) fde.push(profile([[H0, HY0 + 0.006], [H1, HY0 + 0.006], [H1, HY1 - 0.006], [H0, HY1 - 0.006]], 0.0036, 0.0006, 1, slots(), sx * (HW - 0.0018)));
  fde.push(rbx(0.038, 0.0036, H1 - H0, 0, HY1 - 0.0018, (H0 + H1) / 2, 0.0008));
  fde.push(rbx(0.038, 0.0036, H1 - H0, 0, HY0 + 0.0018, (H0 + H1) / 2, 0.0008));
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const g = rbx(0.012, 0.0036, H1 - H0, 0, 0, (H0 + H1) / 2, 0.0008); g.rotateZ(sx * sy * Math.PI / 4);
    g.translate(sx * (HW - 0.0037), sy > 0 ? HY1 - 0.0047 : HY0 + 0.0047, 0); fde.push(g);
  }
  metal.push(...rail(H0 + 0.004, 0.45, -0.0365, 0.022));
  // heavy fluted barrel, muzzle brake with ports
  steel.push(cyl(0.0112, H0, 0.83, BY, 20));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const g = bx(0.003, 0.0016, 0.17, 0, 0, 0); g.rotateZ(a); g.translate(Math.cos(a + Math.PI / 2) * 0.0108, BY + Math.sin(a + Math.PI / 2) * 0.0108, -0.71); black.push(g); }
  steel.push(rbx(0.03, 0.03, 0.07, 0, BY, 0.86, 0.006));
  for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) black.push(rbx(0.0014, 0.018, 0.011, sx * 0.0151, BY, 0.837 + i * 0.019, 0.0005));
  black.push(cyl(0.0068, 0.893, 0.896, BY, 14));
  // grip, trigger guard, precision stock with cheek riser
  poly.push(profile([[0.03, -0.094], [0.024, -0.116], [0.02, -0.128, 0.014, -0.132], [0.014, -0.152, 0.002, -0.172], [-0.01, -0.196], [-0.028, -0.204, -0.048, -0.194], [-0.037, -0.146], [-0.028, -0.11, -0.04, -0.096], [-0.01, -0.09]], 0.031, 0.005, 3));
  fde.push(profile([[0.07, -0.096], [0.07, -0.12], [0.004, -0.122], [-0.004, -0.114], [0.004, -0.114], [0.062, -0.114], [0.062, -0.096]], 0.009, 0.0012, 2));
  black.push(profile([[0.046, -0.098], [0.049, -0.098], [0.046, -0.108], [0.039, -0.114], [0.041, -0.106]], 0.005, 0.0008, 1));
  metal.push(cyl(0.0155, -0.25, -0.062, -0.058, 20));
  fde.push(profile([[-0.13, -0.047], [-0.17, -0.044, -0.345, -0.048], [-0.352, -0.054], [-0.352, -0.172], [-0.322, -0.176], [-0.25, -0.13, -0.19, -0.1], [-0.13, -0.092]], 0.04, 0.006, 3));
  poly.push(profile([[-0.14, -0.038], [-0.29, -0.039], [-0.29, -0.05], [-0.14, -0.05]], 0.034, 0.003, 2)); // cheek riser
  steel.push(cyl(0.004, -0.24, -0.15, -0.038, 10, 0.012), cyl(0.004, -0.24, -0.15, -0.038, 10, -0.012)); // riser posts
  rub.push(rbx(0.044, 0.124, 0.014, 0, -0.112, -0.356, 0.005));
  // side charging handle (animated)
  const bolt = new THREE.Group();
  bolt.add(mesh([rbx(0.012, 0.012, 0.026, -0.026, -0.054, 0.12, 0.003), cyl(0.0055, 0.112, 0.128, -0.054, 12, -0.036)], M.steel));
  // ---- reflex sight (open, slim): mount, low housing, thin window frame, lens with collimated dot ----
  const opt = [];
  opt.push(rbx(0.022, 0.0075, 0.04, 0, RT + 0.00375, 0.016, 0.0012));
  opt.push(profile([[0.0, RT + 0.0075], [0.034, RT + 0.0075], [0.034, -0.0128], [0.026, -0.0128], [0.012, -0.021], [0.0, -0.0235]], 0.026, 0.0014, 2));
  const outer = new THREE.Shape();
  outer.moveTo(-0.0146, -0.0128); outer.lineTo(0.0146, -0.0128); outer.lineTo(0.0136, 0.0105);
  outer.quadraticCurveTo(0.0133, 0.0138, 0.0104, 0.0138); outer.lineTo(-0.0104, 0.0138); outer.quadraticCurveTo(-0.0133, 0.0138, -0.0136, 0.0105); outer.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.0129, -0.0112); hole.lineTo(0.0129, -0.0112); hole.lineTo(0.012, 0.0099);
  hole.quadraticCurveTo(0.0118, 0.0122, 0.0096, 0.0122); hole.lineTo(-0.0096, 0.0122); hole.quadraticCurveTo(-0.0118, 0.0122, -0.012, 0.0099); hole.closePath();
  outer.holes.push(hole);
  opt.push(front(outer, 0.0048, 0.0292, 0.0005));
  opt.push(crossPin(0.0022, 0.03, -0.024, 0.022)); // brightness buttons
  const emitter = rbx(0.005, 0.003, 0.004, 0, -0.0215, 0.006, 0.0008);
  const lensShape = new THREE.Shape(hole.getPoints(8));
  const lens = new THREE.Mesh(new THREE.ShapeGeometry(lensShape), redDotMat);
  lens.position.set(0, 0, -0.0312); lens.renderOrder = 5;
  const hood = new THREE.Group(); hood.add(mesh(opt, M.darkMetal), mesh(emitter, M.black), lens);
  // straight polymer box mag with ribs
  const mag = new THREE.Group();
  const mb = profile([[0.072, 0.0], [0.128, 0.0], [0.132, -0.128], [0.075, -0.128]], 0.027, 0.003, 3);
  const mr = []; for (let i = 0; i < 5; i++) mr.push(rbx(0.0284, 0.002, 0.05, 0, -0.03 - i * 0.012, 0.102, 0.0007));
  mag.add(mesh([mb, ...mr, rbx(0.031, 0.009, 0.064, 0, -0.131, 0.104, 0.002)], M.polymer)); mag.position.set(0, -0.08, 0); mag.rotation.x = 0.03;
  root.add(mesh(fde, M.fde), mesh(steel, M.steel), mesh(poly, M.polymer), mesh(black, M.black), mesh(rub, M.rubber), mesh(metal, M.darkMetal), bolt, hood, mag);
  root.add(screws([[0.0168, -0.055, 0.29], [0.0168, -0.055, 0.42], [-0.0168, -0.055, 0.29]], M.darkMetal));
  const rh = rightHand(M, V(-0.003, -0.142, 0.018), -0.22, V(0.09, -0.24, 0.4));
  root.add(rh.group, ...rh.arm);
  const left = leftHand(M, V(0, -0.065, -0.4), HW, 0.0238, V(-0.24, -0.22, 0.27));
  root.add(left);
  return { root, mag, bolt, leftHand: left, lens, muzzle: V(0, BY, -0.9), eject: V(0.022, -0.058, -0.13), magHome: mag.position.clone(),
    points: { magBottom: V(0, -0.08 - 0.13, -0.105), charge: V(-0.04, -0.06, -0.11), chargeRot: new THREE.Euler(0.1, -0.5, -0.4) } };
}


// ======================================================================= VX-9 HORNET (SMG, roller-delayed style)
function buildSMG(M) {
  const root = new THREE.Group();
  const metal = [], steel = [], poly = [], black = [], rub = [];
  const RT = -0.017;
  // receiver: flat sides + round top tube, cocking tube forward, end cap
  metal.push(profile([[-0.05, -0.066], [0.27, -0.066], [0.27, -0.034], [-0.05, -0.034]], 0.032, 0.002, 2));
  metal.push(cyl(0.0172, -0.048, 0.27, -0.0342, 22), lathe([[0, -0.052], [0.0176, -0.052], [0.0176, -0.046], [0, -0.046]], -0.0342, 22));
  metal.push(cyl(0.0105, 0.27, 0.365, -0.031, 18), lathe([[0, 0.364], [0.011, 0.364], [0.011, 0.372], [0, 0.372]], -0.031, 18));
  black.push(rbx(0.0016, 0.014, 0.05, 0.016, -0.046, 0.15, 0.0006)); // ejection port
  for (let i = 0; i < 3; i++) metal.push(rbx(0.0336, 0.002, 0.012, 0, -0.06 + i * 0.008, 0.215, 0.0006)); // stamped ribs
  black.push(rbx(0.0016, 0.022, 0.07, -0.0162, -0.05, 0.2, 0.0006)); // cocking slot (left)
  // iron sights: drum-style aperture rear, hooded post on the cocking tube
  metal.push(...rearAperture(RT, 0.0, 0.0042, 0.0018, 0.0095));
  metal.push(...frontHoodPost(-0.0205, 0.335, 0.0082));
  // barrel + three-lug muzzle
  steel.push(cyl(0.0078, 0.27, 0.4, -0.052, 16));
  steel.push(lathe([[0, 0.398], [0.0108, 0.398], [0.0108, 0.428], [0.009, 0.434], [0.0052, 0.434], [0.0052, 0.405], [0, 0.405]], -0.052, 18));
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const g = bx(0.004, 0.003, 0.012, 0, 0, 0); g.rotateZ(a); g.translate(Math.cos(a + Math.PI / 2) * 0.0112, -0.052 + Math.sin(a + Math.PI / 2) * 0.0112, -0.404); steel.push(g); }
  // polymer handguard with finger grooves
  poly.push(rbx(0.05, 0.04, 0.13, 0, -0.064, 0.22, 0.012));
  for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) black.push(rbx(0.0012, 0.026, 0.0045, sx * 0.0252, -0.066, 0.17 + i * 0.024, 0.0005));
  // lower: magwell, trigger guard, grip (AR geometry), selector
  metal.push(profile([[0.066, -0.062], [0.116, -0.062], [0.118, -0.082], [0.064, -0.082]], 0.03, 0.0018, 2));
  poly.push(profile([[-0.034, -0.066], [0.064, -0.066], [0.064, -0.074], [0.03, -0.076], [0.0, -0.072], [-0.034, -0.068]], 0.03, 0.0018, 2));
  poly.push(profile([[0.062, -0.07], [0.062, -0.094], [0.004, -0.096], [-0.004, -0.088], [0.004, -0.088], [0.054, -0.088], [0.054, -0.07]], 0.009, 0.0012, 2));
  black.push(profile([[0.04, -0.07], [0.043, -0.07], [0.04, -0.081], [0.033, -0.087], [0.035, -0.08]], 0.005, 0.0008, 1));
  poly.push(profile([[0.028, -0.066], [0.022, -0.088], [0.019, -0.1, 0.012, -0.104], [0.012, -0.125, 0.0, -0.146], [-0.012, -0.17], [-0.03, -0.178, -0.05, -0.168], [-0.039, -0.12], [-0.03, -0.085, -0.042, -0.07], [-0.012, -0.064]], 0.03, 0.005, 3));
  metal.push(rbx(0.006, 0.006, 0.008, 0.017, -0.072, 0.005, 0.0015));
  steel.push(crossPin(0.0026, 0.034, -0.06, -0.025), crossPin(0.0026, 0.034, -0.07, 0.04));
  // collapsing stock: twin rods + butt plate
  for (const sx of [-1, 1]) black.push(cyl(0.0042, -0.235, -0.04, -0.042, 10, sx * 0.0135));
  poly.push(rbx(0.042, 0.088, 0.014, 0, -0.072, -0.238, 0.005));
  rub.push(rbx(0.044, 0.09, 0.008, 0, -0.072, -0.249, 0.003));
  // cocking handle (left, forward): animated
  const bolt = new THREE.Group();
  bolt.add(mesh([rbx(0.012, 0.006, 0.01, -0.02, -0.031, 0.31, 0.002), cyl(0.0045, 0.3, 0.318, -0.031, 10, -0.028)], M.steel));
  // curved steel mag
  const mag = new THREE.Group();
  const mb = profile([[0.072, 0.0], [0.108, 0.0], [0.113, -0.06], [0.13, -0.128], [0.098, -0.136], [0.084, -0.068]], 0.022, 0.0022, 2);
  const mribs = []; for (let i = 0; i < 3; i++) mribs.push(rbx(0.0232, 0.0016, 0.026, 0, -0.03 - i * 0.03, 0.095 + i * 0.006, 0.0006));
  mag.add(mesh([mb, ...mribs], M.darkMetal), mesh(profile([[0.094, -0.13], [0.134, -0.122], [0.136, -0.13], [0.096, -0.14]], 0.025, 0.0015, 2), M.polymer));
  mag.position.set(0, -0.066, 0);
  root.add(mesh(metal, M.gunmetal), mesh(steel, M.steel), mesh(poly, M.polymer), mesh(black, M.black), mesh(rub, M.rubber), bolt, mag);
  root.add(screws([[0.0162, -0.05, 0.25], [-0.0162, -0.05, 0.25]], M.darkMetal));
  const rh = rightHand(M, V(0.0, -0.112, 0.016), -0.22, V(0.09, -0.24, 0.4));
  root.add(rh.group, ...rh.arm);
  const left = leftHand(M, V(0, -0.064, -0.235), 0.025, 0.02, V(-0.24, -0.22, 0.27));
  root.add(left);
  return { root, mag, bolt, leftHand: left, muzzle: V(0, -0.052, -0.436), eject: V(0.018, -0.046, -0.15), magHome: mag.position.clone(),
    points: { magBottom: V(0, -0.066 - 0.135, -0.11), charge: V(-0.026, -0.036, -0.3), chargeRot: new THREE.Euler(0.15, -0.35, -0.3) } };
}

// ======================================================================= HX-60 RAMPART (LMG)
function buildLMG(M) {
  const root = new THREE.Group();
  const metal = [], steel = [], poly = [], black = [], rub = [], olive = [];
  const BY = -0.054;
  // tall stamped receiver + feed cover with hinge and latch
  metal.push(profile([[-0.07, -0.088], [0.26, -0.088], [0.26, -0.03], [-0.055, -0.03], [-0.07, -0.04]], 0.048, 0.0025, 3));
  metal.push(rbx(0.05, 0.012, 0.215, 0, -0.0235, 0.1, 0.003));
  steel.push(crossPin(0.0035, 0.04, -0.024, -0.04)); // cover hinge pin
  black.push(rbx(0.012, 0.006, 0.014, 0, -0.016, 0.195, 0.002)); // cover latch
  black.push(rbx(0.0016, 0.024, 0.09, 0.0242, -0.06, 0.13, 0.0006), rbx(0.0016, 0.016, 0.05, -0.0242, -0.052, 0.12, 0.0006)); // ejection + feed ports
  for (let i = 0; i < 4; i++) metal.push(rbx(0.0496, 0.0018, 0.008, 0, -0.08 + i * 0.012, 0.235, 0.0006));
  // sights: aperture on the feed cover, tall hooded post on the barrel block
  metal.push(...rearAperture(-0.0175, 0.0, 0.0048, 0.0019, 0.0105));
  steel.push(rbx(0.03, 0.026, 0.03, 0, BY + 0.002, 0.8, 0.004));
  metal.push(...frontHoodPost(BY + 0.015, 0.8, 0.0088));
  // heavy barrel, gas tube, flash hider, carry handle
  steel.push(cyl(0.0125, 0.26, 0.9, BY, 22));
  steel.push(cyl(0.0075, 0.3, 0.64, BY - 0.026, 14));
  steel.push(lathe([[0, 0.898], [0.0145, 0.898], [0.0145, 0.96], [0.0125, 0.966], [0.007, 0.966], [0.007, 0.92], [0, 0.92]], BY, 24));
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const g = bx(0.0032, 0.006, 0.04, 0, 0, 0); g.rotateZ(a); g.translate(Math.cos(a + Math.PI / 2) * 0.0142, BY + Math.sin(a + Math.PI / 2) * 0.0142, -0.94); black.push(g); }
  steel.push(rbx(0.008, 0.008, 0.13, -0.036, BY + 0.03, 0.4, 0.002), rbx(0.008, 0.03, 0.01, -0.03, BY + 0.016, 0.34, 0.002), rbx(0.008, 0.03, 0.01, -0.03, BY + 0.016, 0.46, 0.002));
  // ribbed polymer handguard + folded bipod
  poly.push(rbx(0.064, 0.052, 0.22, 0, BY - 0.012, 0.38, 0.014));
  for (let i = 0; i < 7; i++) black.push(rbx(0.066, 0.003, 0.006, 0, BY - 0.039, 0.29 + i * 0.03, 0.001));
  steel.push(rbx(0.034, 0.016, 0.03, 0, BY - 0.02, 0.62, 0.004));
  for (const sx of [-1, 1]) { steel.push(cyl(0.0048, 0.5, 0.74, BY - 0.032, 10, sx * 0.011)); rub.push(rbx(0.012, 0.012, 0.02, sx * 0.011, BY - 0.032, 0.5, 0.004)); }
  // lower, grip, trigger guard (AR geometry dropped to this receiver)
  const low = [profile([[0.062, -0.07], [0.062, -0.094], [0.004, -0.096], [-0.004, -0.088], [0.004, -0.088], [0.054, -0.088], [0.054, -0.07]], 0.009, 0.0012, 2)];
  const grip = profile([[0.028, -0.066], [0.022, -0.088], [0.019, -0.1, 0.012, -0.104], [0.012, -0.125, 0.0, -0.146], [-0.012, -0.17], [-0.03, -0.178, -0.05, -0.168], [-0.039, -0.12], [-0.03, -0.085, -0.042, -0.07], [-0.012, -0.064]], 0.032, 0.005, 3);
  const trig = profile([[0.04, -0.07], [0.043, -0.07], [0.04, -0.081], [0.033, -0.087], [0.035, -0.08]], 0.005, 0.0008, 1);
  for (const g of [...low, grip, trig]) g.translate(0, -0.022, 0);
  metal.push(...low); poly.push(grip); black.push(trig);
  steel.push(crossPin(0.003, 0.052, -0.07, -0.04), crossPin(0.003, 0.052, -0.07, 0.22), crossPin(0.0045, 0.05, -0.08, 0.05));
  // skeletal-ish stock with cheek rest + thick pad
  poly.push(profile([[-0.07, -0.036], [-0.2, -0.04, -0.33, -0.046], [-0.34, -0.052], [-0.34, -0.168], [-0.31, -0.172], [-0.2, -0.12, -0.12, -0.1], [-0.07, -0.09]], 0.046, 0.007, 3));
  rub.push(rbx(0.048, 0.126, 0.02, 0, -0.11, -0.348, 0.006));
  // charging handle (right side): animated
  const bolt = new THREE.Group();
  bolt.add(mesh([rbx(0.01, 0.012, 0.03, 0.03, -0.062, 0.2, 0.003), rbx(0.02, 0.008, 0.008, 0.038, -0.062, 0.19, 0.002)], M.steel));
  // ammo box (olive) + a short brass belt into the feed port
  const mag = new THREE.Group();
  olive.push(rbx(0.074, 0.12, 0.11, -0.016, -0.062, 0.125, 0.007));
  olive.push(rbx(0.076, 0.008, 0.112, -0.016, -0.004, 0.125, 0.002));
  black.push(rbx(0.03, 0.01, 0.006, -0.016, -0.035, 0.069, 0.002));
  const belt = [];
  for (let i = 0; i < 4; i++) { const g = new THREE.CylinderGeometry(0.0042, 0.0042, 0.05, 8); g.rotateX(Math.PI / 2); g.translate(-0.034 + i * 0.0002, 0.006 + i * 0.006, -0.105 - i * 0.012); belt.push(g); }
  mag.add(mesh(olive, M.olive), mesh(belt, M.brass));
  mag.position.set(0, -0.088, 0);
  root.add(mesh(metal, M.darkMetal), mesh(steel, M.steel), mesh(poly, M.polymer), mesh(black, M.black), mesh(rub, M.rubber), bolt, mag);
  root.add(screws([[0.0245, -0.04, 0.05], [0.0245, -0.04, 0.24], [-0.0245, -0.04, 0.05]], M.steel));
  const rh = rightHand(M, V(0.0, -0.134, 0.016), -0.22, V(0.09, -0.24, 0.4));
  root.add(rh.group, ...rh.arm);
  const left = leftHand(M, V(0, BY - 0.012, -0.42), 0.032, 0.026, V(-0.24, -0.22, 0.27));
  root.add(left);
  return { root, mag, bolt, leftHand: left, muzzle: V(0, BY, -0.97), eject: V(0.026, -0.06, -0.13), magHome: mag.position.clone(),
    points: { magBottom: V(-0.016, -0.088 - 0.125, -0.125), charge: V(0.04, -0.064, -0.19), chargeRot: new THREE.Euler(0.2, 0.4, 1.0) } };
}

// ======================================================================= R-44 WARDEN (magnum revolver)
function buildRV(M) {
  const root = new THREE.Group();
  const frame = [], steel = [], black = [], wood = [];
  const BY = -0.025, CR = 0.0195, CU0 = 0.002, CU1 = 0.054, CY = BY - 0.0118; // bore, cylinder radius + span (u), cylinder axis (top chamber lines up with the bore)
  // frame: top strap, recoil shield, front frame, bottom, rear block
  frame.push(rbx(0.022, 0.007, 0.072, 0, -0.0085, 0.028, 0.0025));
  frame.push(profile([[-0.012, -0.005], [CU0, -0.005], [CU0, -0.062], [-0.008, -0.068], [-0.03, -0.07], [-0.042, -0.06], [-0.046, -0.02], [-0.034, -0.008]], 0.03, 0.003, 3));
  frame.push(profile([[CU1, -0.005], [0.066, -0.005], [0.068, -0.06], [CU1, -0.064]], 0.026, 0.0025, 2));
  frame.push(rbx(0.024, 0.01, CU1 - CU0, 0, -0.062, (CU0 + CU1) / 2, 0.003));
  // rear sight: notch shoulders on the top strap (tops on the sight line)
  for (const sx of [-1, 1]) frame.push(rbx(0.004, 0.006, 0.007, sx * 0.0047, -0.003, 0.004, 0.0008));
  // barrel: round tube + vent rib + full underlug, crowned muzzle
  steel.push(cyl(0.0098, 0.066, 0.215, BY, 22));
  frame.push(rbx(0.0125, 0.008, 0.15, 0, BY + 0.013, 0.14, 0.002));
  for (let u = 0.08; u < 0.2; u += 0.022) black.push(rbx(0.0128, 0.0025, 0.008, 0, BY + 0.0145, u, 0.0006));
  frame.push(rbx(0.017, 0.019, 0.15, 0, BY - 0.0155, 0.14, 0.004));
  black.push(lathe([[0, 0.2148], [0.0042, 0.2148], [0.0042, 0.2152], [0, 0.2152]], BY, 16));
  // front blade with an orange insert, top flush with the notch
  frame.push(rbx(0.0034, 0.009, 0.016, 0, -0.0045, 0.2, 0.0008));
  const insert = new THREE.Mesh(new THREE.BoxGeometry(0.0036, 0.0028, 0.004), M.fiber); insert.position.set(0, -0.002, -0.194);
  // trigger guard + trigger
  frame.push(profile([[0.036, -0.064], [0.036, -0.092], [-0.01, -0.094], [-0.015, -0.087], [-0.008, -0.086], [0.029, -0.086], [0.029, -0.064]], 0.008, 0.0012, 2));
  black.push(profile([[0.012, -0.065], [0.016, -0.065], [0.013, -0.078], [0.006, -0.084], [0.009, -0.076]], 0.005, 0.0008, 1));
  // wood grip with a medallion
  wood.push(profile([[-0.004, -0.064], [-0.034, -0.066], [-0.052, -0.084], [-0.066, -0.13], [-0.07, -0.152], [-0.054, -0.159], [-0.029, -0.154], [-0.019, -0.11], [-0.004, -0.084]], 0.034, 0.006, 3));
  // hammer (pivots behind the frame)
  const hammer = new THREE.Group(); hammer.position.set(0, -0.034, 0.036);
  hammer.add(mesh([profile([[-0.004, 0.0], [0.006, 0.0], [0.004, 0.02], [-0.006, 0.026], [-0.014, 0.026], [-0.008, 0.018]], 0.0075, 0.001, 1)], M.steel));
  // crane + cylinder (swings out to the left for reloads)
  const crane = new THREE.Group(); crane.position.set(-0.009, CY - CR - 0.002, 0);
  const cyl6 = new THREE.Group(); cyl6.position.set(0.009, CR + 0.002, -(CU0 + CU1) / 2); crane.add(cyl6);
  const L = CU1 - CU0 - 0.002;
  const cylBody = lathe([[0, -L / 2], [CR - 0.002, -L / 2], [CR, -L / 2 + 0.002], [CR, L / 2 - 0.003], [CR - 0.003, L / 2], [0, L / 2]], 0, 30);
  cylBody.translate(0, 0, 0);
  const flutes = [], chambers = [], heads = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6, ca = (i / 6) * Math.PI * 2;
    const f = rbx(0.0055, 0.004, L * 0.62, 0, 0, 0, 0.0018); f.translate(0, CR - 0.0012, -0.004); f.rotateZ(a); flutes.push(f);
    const ch = new THREE.CylinderGeometry(0.0046, 0.0046, 0.002, 12); ch.rotateX(Math.PI / 2); ch.translate(Math.sin(ca) * 0.0118, Math.cos(ca) * 0.0118, -L / 2 - 0.0002); chambers.push(ch);
    const hd = new THREE.CylinderGeometry(0.0052, 0.0052, 0.0016, 14); hd.rotateX(Math.PI / 2); hd.translate(Math.sin(ca) * 0.0118, Math.cos(ca) * 0.0118, L / 2 + 0.0004); heads.push(hd);
  }
  cyl6.add(mesh(cylBody, M.stainless), mesh(flutes, M.black), mesh(chambers, M.black));
  const cases = mesh(heads, M.brass); cyl6.add(cases);
  crane.add(mesh([cyl(0.0032, CU1 - 0.002, 0.11, CR + 0.002, 10, 0.009), lathe([[0, 0.108], [0.004, 0.108], [0.004, 0.116], [0, 0.116]], CR + 0.002, 10, 0.009)], M.steel)); // ejector rod
  root.add(mesh(frame, M.stainless), mesh(steel, M.steel), mesh(black, M.black), mesh(wood, M.wood), insert, hammer, crane);
  root.add(screws([[0.0152, -0.035, -0.02], [-0.0152, -0.035, -0.02], [0.0132, -0.03, 0.06]], M.steel));
  // right hand wraps the grip; the left hand stays off-screen until it brings the speedloader
  const rh = rightHand(M, V(0.0, -0.104, 0.04), -0.4, V(0.08, -0.22, 0.42));
  root.add(rh.group, ...rh.arm);
  const left = leftHand(M, V(-0.07, -0.34, 0.06), 0.012, 0.013, V(-0.24, -0.2, 0.27));
  const loader = new THREE.Group();
  const knob = lathe([[0, 0.0], [0.013, 0.0], [0.014, 0.004], [0.014, 0.012], [0.006, 0.02], [0, 0.02]], 0, 20); // knob behind the rounds (+u toward the eye)
  knob.rotateY(Math.PI); knob.translate(0, 0, -0.0);
  const rounds = [];
  for (let i = 0; i < 6; i++) { const ca = (i / 6) * Math.PI * 2; const g = new THREE.CylinderGeometry(0.0044, 0.0047, 0.034, 10); g.rotateX(Math.PI / 2); g.translate(Math.sin(ca) * 0.0118, Math.cos(ca) * 0.0118, -0.018); rounds.push(g); const tip = new THREE.SphereGeometry(0.0043, 8, 6); tip.translate(Math.sin(ca) * 0.0118, Math.cos(ca) * 0.0118, -0.035); rounds.push(tip); }
  const loaded = mesh(rounds, M.brass); loader.add(mesh(knob, M.black), loaded);
  left.add(loader);
  root.add(left);
  return { root, leftHand: left, crane, cyl: cyl6, cases, hammer, loader, loaderRounds: loaded, muzzle: V(0, BY, -0.218), eject: V(0, BY, -0.03),
    cylRear: V(0.009, CR + 0.002, -(CU0 + CU1) / 2 + L / 2), points: {} };
}

// Collimated red dot: drawn where the view ray is parallel to the bore, so it sits "at infinity",
// stays on target while the gun sways and is only visible through the glass.
// ======================================================================= rare crate guns
// same shader setup as the source material, new colour (keeps the edge-wear + specular AA hooks)
function tint(m, color, extra = {}) {
  const c = m.clone(); c.color = new THREE.Color(color); Object.assign(c, extra);
  c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; return c;
}
function glowMat(color, k) { return new THREE.MeshStandardMaterial({ color: '#0d1014', emissive: new THREE.Color(color), emissiveIntensity: k, roughness: 0.35, metalness: 0.3 }); }

// NX-2 AURORA LANCE: white ceramic marksman frame, emitter coils down the barrel, glowing cell in the mag
function buildLance(M, dot) {
  const ceramic = tint(M.fde, '#d8dce2'), dark = tint(M.polymer, '#252c3a'), blue = tint(M.darkMetal, '#2c3850');
  const g = buildMR({ ...M, fde: ceramic, polymer: dark, darkMetal: blue }, dot);
  const glow = glowMat('#58d6ff', 3.4), BY = -0.0605;
  const coils = [];
  for (let i = 0; i < 6; i++) { const t = new THREE.TorusGeometry(0.0175 - i * 0.0008, 0.0028, 8, 22); t.translate(0, BY, -(0.6 + i * 0.042)); coils.push(t); }
  const fins = [];
  for (const sx of [-1, 1]) { const f = rbx(0.003, 0.03, 0.2, sx * 0.03, -0.065, 0.46, 0.001); fins.push(f); }
  const core = cyl(0.0058, 0.26, 0.82, BY, 12);
  g.root.add(mesh(coils, glow), mesh(fins, ceramic), mesh([core], glow));
  g.mag.add(mesh([rbx(0.0295, 0.012, 0.042, 0, -0.045, 0.102, 0.002), rbx(0.0295, 0.012, 0.042, 0, -0.085, 0.104, 0.002)], glow));
  g.glow = glow; return g;
}

// SKV-3 HAILSTRIKE: rifle stock and grip carrying a bow riser, recurve limbs, a string and a loaded bolt
function buildHail(M) {
  const olive = tint(M.metal, '#4a5136'), sand = tint(M.polymer, '#7a6a4c');
  const g = buildAR({ ...M, metal: olive, polymer: sand });
  const RT = -0.0155, LY = -0.036, U0 = 0.47;
  // riser block and limbs (swept back), string to the nock
  const riser = [rbx(0.08, 0.034, 0.05, 0, LY, U0, 0.006), rbx(0.03, 0.02, 0.09, 0, LY - 0.022, U0 - 0.02, 0.004)];
  const limbs = [], strs = [];
  for (const sx of [-1, 1]) {
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(sx * 0.035, LY, -U0), new THREE.Vector3(sx * 0.2, LY, -(U0 + 0.05)), new THREE.Vector3(sx * 0.27, LY, -(U0 - 0.09)));
    const tube = new THREE.TubeGeometry(c, 16, 0.0075, 8); tube.scale(1, 0.7, 1); tube.translate(0, LY * 0.3, 0); limbs.push(tube);
    const tip = new THREE.Vector3(sx * 0.27, LY * 1.3, -(U0 - 0.09)), nock = new THREE.Vector3(0, RT + 0.002, -0.17);
    const d = tip.clone().sub(nock), L = d.length(); const s1 = new THREE.CylinderGeometry(0.0012, 0.0012, L, 5);
    s1.translate(0, L / 2, 0); s1.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); s1.translate(nock.x, nock.y, nock.z); strs.push(s1);
    limbs.push(new THREE.SphereGeometry(0.009, 10, 8).translate(tip.x, tip.y, tip.z)); // cam wheel
  }
  g.root.add(mesh(riser, M.darkMetal), mesh(limbs, M.black), mesh(strs, M.steel));
  // the loaded bolt: carbon shaft, fletching, glowing charge head (hidden while it re-cocks)
  const arrow = new THREE.Group();
  const shaft = cyl(0.0032, 0.17, 0.6, RT + 0.004, 10);
  const fl = []; for (let i = 0; i < 3; i++) { const f = bx(0.0006, 0.012, 0.04, 0, 0, 0); f.translate(0, 0.006, 0); f.rotateZ(i * 2.094); f.translate(0, RT + 0.004, -0.2); fl.push(f); }
  const head = new THREE.CylinderGeometry(0.0005, 0.0075, 0.04, 10); head.rotateX(-Math.PI / 2); head.translate(0, RT + 0.004, -0.635);
  const charge = new THREE.CylinderGeometry(0.0085, 0.0085, 0.026, 12); charge.rotateX(Math.PI / 2); charge.translate(0, RT + 0.004, -0.603);
  const glow = glowMat('#ff7a2a', 3.0);
  arrow.add(mesh([shaft], M.black), mesh(fl, M.hull), mesh([head], M.stainless), mesh([charge], glow));
  g.root.add(arrow);
  g.arrow = arrow; g.glow = glow; g.muzzle = V(0, RT + 0.004, -0.66);
  return g;
}

export function redDotMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { axis: { value: new THREE.Vector3(0, 0, -1) }, radius: { value: 0.0033 }, brightness: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vView; varying vec2 vPos;
      void main() { vPos = position.xy; vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 axis; uniform float radius, brightness; varying vec3 vView; varying vec2 vPos;
      void main() {
        vec3 rd = normalize(vView);
        float ang = acos(clamp(dot(rd, normalize(axis)), -1.0, 1.0));
        float core = smoothstep(radius, radius * 0.72, ang);
        float glow = exp(-ang / (radius * 0.9)) * 0.45;
        // faint anti-reflective coating tint + reflection near the top of the glass
        vec3 tint = mix(vec3(0.06, 0.16, 0.14), vec3(0.16, 0.08, 0.2), smoothstep(-0.012, 0.012, vPos.y)) * 0.25;
        vec3 col = tint + vec3(4.0, 0.12, 0.06) * core * brightness + vec3(1.4, 0.04, 0.02) * glow * brightness;
        float a = 0.07 + core + glow * 0.8;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, toneMapped: false,
  });
}

export function buildWeaponModels() {
  const M = gunMaterials();
  const dot = redDotMaterial();
  return { ar: buildAR(M), sg: buildSG(M), mr: buildMR(M, dot), smg: buildSMG(M), lmg: buildLMG(M), rv: buildRV(M), lance: buildLance(M, dot), hail: buildHail(M), materials: M, redDot: dot };
}
