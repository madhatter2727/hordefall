import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { concrete, corrugated, facade, crateWood, hazard } from './textures.js';
import { mulberry } from '../core/util.js';

// Box geometry whose UVs tile at a fixed world density (texel size independent of box size).
function tiledBox(w, h, d, density = 0.25) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const su = ax > 0.5 ? d : w, sv = ay > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * su * density, uv.getY(i) * sv * density);
  }
  return g;
}

export const ARENA = { half: 36, cell: 1 };

export function buildArena(scene, quality) {
  const colliders = []; // {minX..maxZ, walk, mat}
  const buckets = new Map(); // material -> geometries
  const add = (mat, geo, x, y, z, rotY = 0) => {
    geo.rotateY(rotY); geo.translate(x, y, z);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  };
  const solid = (mat, w, h, d, x, y0, z, opts = {}) => {
    add(mat, tiledBox(w, h, d, opts.density ?? 0.25), x, y0 + h / 2, z);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + h, minZ: z - d / 2, maxZ: z + d / 2, walk: !!opts.walk, mat: opts.surface || 'concrete' });
  };

  // ---------- materials ----------
  const c1 = concrete({ seed: 11, base: [112, 108, 104], puddles: true });
  [c1.map, c1.roughnessMap, c1.normalMap].forEach((t) => t.repeat.set(1, 1));
  const groundMat = new THREE.MeshStandardMaterial({ ...c1, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 0.9 });
  const c2 = concrete({ seed: 23, base: [128, 122, 114], cracks: true });
  const concreteMat = new THREE.MeshStandardMaterial({ ...c2, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) });
  const c3 = concrete({ seed: 41, base: [84, 80, 80], cracks: false, stains: 1.6 });
  const darkConcrete = new THREE.MeshStandardMaterial({ ...c3, roughness: 1 });
  const fac = facade({ seed: 7 });
  const facadeMat = new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.6, roughness: 0.95 });
  const containerMats = [[150, 48, 34], [38, 74, 110], [40, 104, 96], [176, 112, 36]].map((col, i) => {
    const t = corrugated({ color: col, seed: 3 + i });
    return new THREE.MeshStandardMaterial({ ...t, metalness: 0.55, roughness: 1, normalScale: new THREE.Vector2(1.4, 1.4) });
  });
  const crate = new THREE.MeshStandardMaterial({ ...crateWood(), roughness: 0.85 });
  const hz = hazard();
  const barrierMat = new THREE.MeshStandardMaterial({ map: c2.map, normalMap: c2.normalMap, roughnessMap: c2.roughnessMap, roughness: 1 });
  const stripeMat = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: '#3a3c40', metalness: 0.85, roughness: 0.45 });
  const rustSteel = new THREE.MeshStandardMaterial({ color: '#5a3a28', metalness: 0.6, roughness: 0.75 });

  // ---------- ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), groundMat);
  ground.geometry.attributes.uv.array.forEach((v, i, a) => (a[i] = v * 220 * 0.125));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  colliders.push({ minX: -200, maxX: 200, minY: -1, maxY: 0, minZ: -200, maxZ: 200, walk: true, mat: 'concrete', ground: true });

  const H = ARENA.half, r = mulberry(1337);

  // ---------- perimeter buildings with four gates ----------
  const gate = 7;
  const sideRun = (fixed, axis, from, to) => {
    let p = from;
    while (p < to - 0.5) {
      const len = Math.min(to - p, 6 + r() * 8), h = 9 + r() * 11, depth = 8;
      const cx = p + len / 2;
      if (axis === 'x') solid(facadeMat, len, h, depth, cx, 0, fixed + Math.sign(fixed) * depth / 2, { density: 1 / 12, surface: 'concrete' });
      else solid(facadeMat, depth, h, len, fixed + Math.sign(fixed) * depth / 2, 0, cx, { density: 1 / 12, surface: 'concrete' });
      p += len;
    }
  };
  for (const s of [-1, 1]) {
    sideRun(s * H, 'x', -H - 8, -gate / 2); sideRun(s * H, 'x', gate / 2, H + 8);
    sideRun(s * H, 'z', -H, -gate / 2); sideRun(s * H, 'z', gate / 2, H);
  }
  // gate frames (rusted steel portals)
  const spawns = [];
  for (const [x, z, rot] of [[0, -H, 0], [0, H, 0], [-H, 0, Math.PI / 2], [H, 0, Math.PI / 2]]) {
    const dx = Math.cos(rot), dz = Math.sin(rot);
    for (const s of [-1, 1]) {
      const px = x + dx * s * (gate / 2 + 0.4), pz = z + dz * s * (gate / 2 + 0.4);
      solid(rustSteel, 0.8, 7, 0.8, px, 0, pz, { surface: 'metal' });
    }
    add(rustSteel, new THREE.BoxGeometry(gate + 1.6, 0.8, 0.8), x, 7.2, z, rot);
    const out = new THREE.Vector3(x, 0, z).normalize();
    spawns.push(new THREE.Vector3(x + out.x * 6, 0, z + out.z * 6));
  }

  // ---------- central platform with stairs (verticality) ----------
  const PH = 2.0;
  solid(concreteMat, 10, PH, 9, 0, 0, 0, { walk: true });
  add(stripeMat, new THREE.BoxGeometry(10.02, 0.18, 9.02), 0, PH - 0.105, 0);
  // low parapets for cover on top
  solid(concreteMat, 3.2, 0.9, 0.35, -3, PH, -4.3); solid(concreteMat, 3.2, 0.9, 0.35, 3, PH, 4.3);
  solid(concreteMat, 0.35, 0.9, 2.6, 4.8, PH, -2.6); solid(concreteMat, 0.35, 0.9, 2.6, -4.8, PH, 2.6);
  const stairs = (x, z, dirX, dirZ, width, height, steps) => {
    const run = 0.5, rise = height / steps;
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1), d = run;
      const along = (steps - i - 0.5) * run;
      const cx = x + dirX * along, cz = z + dirZ * along;
      if (dirX) solid(concreteMat, d, h, width, cx, 0, cz, { walk: true });
      else solid(concreteMat, width, h, d, cx, 0, cz, { walk: true });
    }
  };
  stairs(0, -4.5, 0, -1, 3, PH, 8); // north stairs descend toward -z
  stairs(0, 4.5, 0, 1, 3, PH, 8);

  // ---------- containers (cover + a climbable stack) ----------
  const container = (x, z, rotY, mi, y0 = 0) => {
    const L = 6.1, W = 2.44, Hc = 2.6;
    const w = rotY ? W : L, d = rotY ? L : W;
    const geo = tiledBox(w, Hc, d, 1 / 2.6);
    add(containerMats[mi], geo, x, y0 + Hc / 2, z);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + Hc, minZ: z - d / 2, maxZ: z + d / 2, walk: false, mat: 'metal', top: y0 + Hc });
  };
  container(-16, -8, 0, 0); container(-16, -5.4, 0, 1); container(-16, -8, 0, 2, 2.6);
  container(17, 9, 1, 3); container(14.4, 9, 1, 0);
  container(-12, 15, 0, 2); container(20, -15, 1, 1); container(8, -20, 0, 3);
  container(-24, 22, 1, 0); container(24, 24, 0, 2);
  // stairs up to the container stack top (5.2m is too high: stack is a landmark; climb onto the single-high pair)
  stairs(-12.95, -5.4, 1, 0, 2.2, 2.6, 10);

  // ---------- jersey barriers ----------
  const barrier = (x, z, rot) => {
    const w = rot ? 0.6 : 3, d = rot ? 3 : 0.6;
    solid(barrierMat, w, 0.95, d, x, 0, z);
    add(stripeMat, new THREE.BoxGeometry(w + 0.01, 0.22, d + 0.01), x, 0.62, z);
  };
  [[-6, -12, 0], [6, 12, 0], [-9, 9, 1], [10, -8, 1], [-22, 2, 1], [23, -2, 1], [0, -26, 0], [0, 26, 0], [-27, -18, 0], [28, 16, 0], [13, 22, 1], [-10, -22, 1]]
    .forEach(([x, z, rot]) => barrier(x, z, rot));

  // ---------- crates ----------
  [[-4, -15], [-3, -16.2], [7, 17], [16, -6], [-19, 12], [26, 6], [-26, -6], [4, -29]].forEach(([x, z], i) => {
    const s = 1.1 + (i % 3) * 0.15;
    solid(crate, s, s, s, x, 0, z, { density: 1 / s, surface: 'wood' });
    if (i % 3 === 0) solid(crate, 0.9, 0.9, 0.9, x + 0.1, s, z - 0.05, { density: 1 / 0.9, surface: 'wood' });
  });

  // ---------- broken overpass (overhead silhouette + pillars as cover) ----------
  for (const x of [-26, -13, 0, 13, 26]) {
    if (x === 0) continue;
    solid(darkConcrete, 1.4, 6.6, 1.4, x, 0, -17, { surface: 'concrete' });
  }
  // deck pieces (one fallen section angled to the ground for drama)
  solid(darkConcrete, 30, 0.9, 7, -21, 6.6, -17); solid(darkConcrete, 24, 0.9, 7, 24, 6.6, -17);
  add(steel, new THREE.BoxGeometry(30, 0.4, 0.3), -21, 6.4, -13.6); add(steel, new THREE.BoxGeometry(24, 0.4, 0.3), 24, 6.4, -13.6);
  const fallen = tiledBox(9, 0.8, 6.6, 0.25); fallen.rotateZ(-0.62); fallen.translate(1.5, 3.1, -17);
  if (!buckets.has(darkConcrete)) buckets.set(darkConcrete, []);
  buckets.get(darkConcrete).push(fallen);
  // collider approximation for the fallen slab (stepped boxes so it blocks bullets + feet)
  for (let i = 0; i < 4; i++) colliders.push({ minX: -2 + i * 1.9, maxX: -0.1 + i * 1.9, minY: 0, maxY: 5.9 - i * 1.55, minZ: -20.3, maxZ: -13.7, walk: false, mat: 'concrete' });

  // ---------- rubble (decor only) ----------
  const rub = [];
  for (let i = 0; i < 90; i++) {
    const s = 0.15 + r() * 0.55;
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.scale(1, 0.5 + r() * 0.5, 1);
    g.rotateY(r() * 6); g.rotateX(r() * 0.5);
    let x = (r() * 2 - 1) * (H - 2), z = (r() * 2 - 1) * (H - 2);
    if (Math.abs(x) < 6 && Math.abs(z) < 8) x += 9;
    g.translate(x, s * 0.25, z);
    rub.push(g);
  }
  buckets.set(darkConcrete, [...(buckets.get(darkConcrete) || []), ...rub]);

  // ---------- lamp posts + fire barrels ----------
  const lights = [];
  const lampPost = (x, z) => {
    add(steel, new THREE.CylinderGeometry(0.09, 0.13, 6.5, 10), x, 3.25, z);
    add(steel, new THREE.BoxGeometry(1.4, 0.12, 0.2), x + 0.6, 6.4, z);
    colliders.push({ minX: x - 0.15, maxX: x + 0.15, minY: 0, maxY: 6.5, minZ: z - 0.15, maxZ: z + 0.15, walk: false, mat: 'metal' });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), new THREE.MeshBasicMaterial({ color: '#ffcf8a' }));
    head.material.color.multiplyScalar(6);
    head.position.set(x + 1.15, 6.3, z); scene.add(head);
    const L = new THREE.PointLight('#ffad52', 26, 22, 1.6);
    L.position.set(x + 1.15, 6.1, z); scene.add(L); lights.push({ light: L, base: 26, flicker: 0.02 });
  };
  lampPost(-9, 6); lampPost(10, -5); lampPost(-20, -26); lampPost(21, 20);
  const fires = [];
  const barrel = (x, z) => {
    add(rustSteel, new THREE.CylinderGeometry(0.32, 0.3, 0.9, 16, 1, true), x, 0.45, z);
    colliders.push({ minX: x - 0.32, maxX: x + 0.32, minY: 0, maxY: 0.9, minZ: z - 0.32, maxZ: z + 0.32, walk: false, mat: 'metal' });
    const L = new THREE.PointLight('#ff6a1c', 14, 12, 1.8);
    L.position.set(x, 1.4, z); scene.add(L);
    lights.push({ light: L, base: 14, flicker: 0.35 });
    fires.push(new THREE.Vector3(x, 0.9, z));
  };
  barrel(-5, 10.5); barrel(14, -13); barrel(-18, -14); barrel(17, 14);

  // ---------- merge static geometry per material ----------
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv1'); return g; }), false);
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
  }

  // ---------- distant skyline in the haze ----------
  const skyline = [];
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + r() * 0.05, d = 70 + r() * 50;
    const w = 6 + r() * 14, h = 18 + r() * 45;
    const g = new THREE.BoxGeometry(w, h, w); g.rotateY(-a); g.translate(Math.cos(a) * d, h / 2, Math.sin(a) * d);
    skyline.push(g);
  }
  const sk = new THREE.Mesh(mergeGeometries(skyline), new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, roughness: 1, color: '#7a6f78' }));
  scene.add(sk);

  return { colliders, spawns, lights, fires, nav: buildNav(colliders) };
}

// ---------- navigation grid: floor height per cell + blocked cells ----------
function buildNav(colliders) {
  const H = ARENA.half, N = H * 2;
  const height = new Float32Array(N * N), blocked = new Uint8Array(N * N);
  const margin = 0.35;
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) {
    const x = gx - H + 0.5, z = gz - H + 0.5;
    let floor = 0, block = 0;
    for (const c of colliders) {
      if (c.ground || c.minY > 2.5) continue;
      if (x < c.minX - margin || x > c.maxX + margin || z < c.minZ - margin || z > c.maxZ + margin) continue;
      const inside = x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ;
      if (c.walk && inside) floor = Math.max(floor, c.maxY);
      else if (!c.walk) block = 1;
    }
    height[gz * N + gx] = floor; blocked[gz * N + gx] = block;
  }
  // a walk-collider's own cells are not blocked by its parapets' margins unless covered
  return { N, H, height, blocked };
}
