import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { corrugated, crateWood, facade } from './textures.js';
import { pbr } from '../assets.js';
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

const NOISE_GLSL = /* glsl */ `
  float gh3(vec3 p){ return fract(sin(dot(p, vec3(17.13, 113.71, 51.37))) * 43758.5453); }
  float gn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(gh3(i), gh3(i+vec3(1,0,0)), f.x), mix(gh3(i+vec3(0,1,0)), gh3(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(gh3(i+vec3(0,0,1)), gh3(i+vec3(1,0,1)), f.x), mix(gh3(i+vec3(0,1,1)), gh3(i+vec3(1,1,1)), f.x), f.y), f.z); }
  float gfbm(vec3 p){ return gn3(p) * 0.55 + gn3(p * 2.1) * 0.3 + gn3(p * 4.3) * 0.15; }`;
// world-space position varying that also works for InstancedMesh
function worldPosVarying(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wp4 = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4;
      #endif
      vWP = (modelMatrix * wp4).xyz;`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;' + NOISE_GLSL);
}
// grime: soot/dirt rising from the street, rain streaks running down, random water stains
function grime(mat, { amount = 1, streaks = 1 } = {}) {
  mat.onBeforeCompile = (sh) => {
    worldPosVarying(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        float h = vWP.y;
        float n = gfbm(vWP * 0.45);
        float base = smoothstep(2.2, 0.0, h + n * 1.2) * 0.55;
        float st = gn3(vec3(vWP.x * 3.1 + vWP.z * 3.1, h * 0.12, 0.0));
        float streak = smoothstep(0.62, 0.95, st) * (0.35 + 0.65 * gn3(vWP * 0.2)) * ${streaks.toFixed(2)};
        float blot = smoothstep(0.6, 0.85, gfbm(vWP * 0.18 + 3.0)) * 0.35;
        float g = clamp((base + streak * 0.45 + blot) * ${amount.toFixed(2)}, 0.0, 0.85);
        diffuseColor.rgb *= 1.0 - g * vec3(0.72, 0.75, 0.78);
      }`);
  };
  return mat;
}
// puddles: smooth dark mirror-like water pooled in low spots of the asphalt
function puddles(mat) {
  mat.onBeforeCompile = (sh) => {
    worldPosVarying(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        float pud = smoothstep(0.68, 0.72, gfbm(vec3(vWP.xz * 0.11, 1.7)) + gn3(vec3(vWP.xz * 0.9, 4.0)) * 0.05);
        float wetEdge = smoothstep(0.58, 0.68, gfbm(vec3(vWP.xz * 0.11, 1.7)));
        diffuseColor.rgb *= mix(1.0, 0.72, wetEdge);
        diffuseColor.rgb *= mix(1.0, 0.25, pud);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, wetEdge);
        roughnessFactor = mix(roughnessFactor, 0.09, pud);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal), pud));`);
  };
  return mat;
}
// interior behind window openings: dark rooms, a few lit warmly, fake depth falloff
function interiorMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#0b0a0a', roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    worldPosVarying(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec2 cell = floor(vec2(vWP.x + vWP.z, vWP.y) / 3.0);
        float r = gh3(vec3(cell, 7.0));
        vec2 f = fract(vec2(vWP.x + vWP.z, vWP.y) / 3.0);
        float vign = smoothstep(0.0, 0.35, f.y) * smoothstep(1.0, 0.6, f.y) * smoothstep(0.0, 0.3, f.x) * smoothstep(1.0, 0.7, f.x);
        vec3 warm = mix(vec3(1.0, 0.55, 0.22), vec3(0.9, 0.75, 0.55), gh3(vec3(cell, 3.0)));
        float lit = step(0.86, r) * (0.6 + 0.4 * gh3(vec3(cell, 11.0)));
        float fire = step(0.975, r);
        totalEmissiveRadiance += warm * lit * vign * 1.6 + vec3(2.5, 0.8, 0.2) * fire * vign;
        diffuseColor.rgb *= 0.4 + 0.6 * vign;
      }`);
  };
  return m;
}

export function buildArena(scene, quality, A) {
  const colliders = []; // {minX..maxZ, walk, mat}
  const buckets = new Map(); // material -> geometries
  const add = (mat, geo, x, y, z, rotY = 0) => {
    geo.rotateY(rotY); geo.translate(x, y, z);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  };
  const solid = (mat, w, h, d, x, y0, z, opts = {}) => {
    if (mat) add(mat, tiledBox(w, h, d, opts.density ?? 0.25), x, y0 + h / 2, z);
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + h, minZ: z - d / 2, maxZ: z + d / 2, walk: !!opts.walk, mat: opts.surface || 'concrete' });
  };
  const H = ARENA.half, r = mulberry(1337);

  // ---------- materials (Poly Haven CC0 PBR sets) ----------
  const groundMat = puddles(pbr(A, 'road_damaged', { color: '#a7a19c', normalScale: 1.1 }));
  const walkMat = grime(pbr(A, 'concrete_pavement', { color: '#b8b2aa' }), { amount: 0.6, streaks: 0 });
  const concreteMat = grime(pbr(A, 'concrete_wall_008', { color: '#aeb0ae', normalScale: 1.2 }), { amount: 0.8 });
  const darkConcrete = grime(pbr(A, 'concrete_wall_008', { color: '#8a837c', normalScale: 1.2 }), { amount: 1 });
  const floorMat = pbr(A, 'damaged_concrete_floor_02', { color: '#b9b2aa', normalScale: 1.2 });
  const brickMat = grime(pbr(A, 'red_brick_03', { color: '#c4b2a6' }), { amount: 0.9 });
  const plasterBox = grime(pbr(A, 'plastered_wall_04', { color: '#b5a99b' }), { amount: 1 });
  const rustSteel = pbr(A, 'rusty_metal_02', { metal: true, envMapIntensity: 1.2 });
  const shutterMat = grime(pbr(A, 'rusted_shutter', { metal: true }), { amount: 0.6, streaks: 0.5 });
  const containerMats = [[150, 48, 34], [38, 74, 110], [40, 104, 96], [176, 112, 36]].map((col, i) => {
    const t = corrugated({ color: col, seed: 3 + i });
    return grime(new THREE.MeshStandardMaterial({ ...t, metalness: 0.55, roughness: 1, normalScale: new THREE.Vector2(1.4, 1.4) }), { amount: 0.7 });
  });
  const crate = new THREE.MeshStandardMaterial({ ...crateWood(), roughness: 0.85 });
  const darkSteel = pbr(A, 'rusty_metal_02', { metal: true, color: '#5a5550', envMapIntensity: 1 });
  const interior = interiorMaterial();

  // ---------- ground: cracked wet asphalt, pavements along the buildings ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), groundMat);
  ground.geometry.attributes.uv.array.forEach((v, i, a) => (a[i] = v * 220 / 5));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  colliders.push({ minX: -200, maxX: 200, minY: -1, maxY: 0, minZ: -200, maxZ: 200, walk: true, mat: 'concrete', ground: true });
  const gate = 7;
  for (const s of [-1, 1]) for (const ax of ['x', 'z']) for (const seg of [[-H - 8, -gate / 2 - 0.6], [gate / 2 + 0.6, H + 8]]) {
    const len = seg[1] - seg[0], c = (seg[0] + seg[1]) / 2, wdt = 2.6, pos = s * (H - wdt / 2);
    const g = tiledBox(ax === 'x' ? len : wdt, 0.07, ax === 'x' ? wdt : len, 1 / 2.5);
    add(walkMat, g, ax === 'x' ? c : pos, 0.035, ax === 'x' ? pos : c);
    const curb = tiledBox(ax === 'x' ? len : 0.25, 0.13, ax === 'x' ? 0.25 : len, 1 / 2);
    add(concreteMat, curb, ax === 'x' ? c : s * (H - wdt), 0.065, ax === 'x' ? s * (H - wdt) : c);
  }

  // ---------- modular facade kit (Poly Haven "modular urban apartments facade") ----------
  const kit = A.models.modular_urban_apartments_facade.scene;
  kit.updateMatrixWorld(true);
  const glassMat = new THREE.MeshStandardMaterial({ color: '#1a2128', roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0.55, envMapIntensity: 1.6, depthWrite: false });
  const pieces = new Map(); // name -> [{geo, mat, local}]
  kit.traverse((o) => {
    if (!o.isMesh) return;
    const node = o.userData.o ? o : o.parent;
    const name = node.name, oo = node.userData.o || [0, 0, 0];
    // pieces are authored with their origin at the right/bottom corner of a 3 m module (kept in extras through quantization)
    const local = new THREE.Matrix4().makeTranslation(-oo[0], -oo[1], -oo[2]).multiply(o.matrixWorld);
    let mat = o.material;
    if (/glass/.test(mat.name)) mat = glassMat;
    else if (/plaster/.test(mat.name) && !mat.userData.g) { mat.userData.g = true; grime(mat, { amount: 1 }); }
    else if (!mat.userData.g) { mat.userData.g = true; grime(mat, { amount: 0.55, streaks: 0.3 }); }
    if (!pieces.has(name)) pieces.set(name, []);
    pieces.get(name).push({ geo: o.geometry, mat, local, glass: mat === glassMat });
  });
  const inst = new Map(); // name -> [{m: Matrix4, c: Color, noGlass}]
  const put = (name, m, color = null, opt = {}) => {
    if (!pieces.has(name)) return;
    if (!inst.has(name)) inst.set(name, []);
    inst.get(name).push({ m: m.clone(), c: color, ...opt });
  };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const props = []; // [modelId, matrix, castShadow]
  const propAt = (id, x, y, z, rotY = 0, s = 1, sy = s) => props.push([id, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, rotY), new THREE.Vector3(s, sy, s))]);
  const tints = ['#d8cbb8', '#9fb0bf', '#bfc8cc', '#d6c2a8', '#8f9aa6', '#e2d6c8', '#a9aaa2', '#c7b6a8', '#b4c2c8', '#7f8a8e'].map((c) => new THREE.Color(c));
  const winSets = [
    ['wall_window_centered_large_01', 'window_centered_large_01'], ['wall_window_centered_large_02', 'window_centered_large_02'],
    ['wall_window_centered_small_01', 'window_centered_small_01'], ['wall_window_centered_small_02', 'window_centered_small_02'],
    ['wall_window_centered_double_01', 'window_centered_double_01'], ['wall_window_centered_double_02', 'window_centered_double_02'],
    ['wall_window_offset_small_01', 'window_offset_small_01'], ['wall_window_offset_small_03', 'window_offset_small_03'],
  ];
  const doorSets = [['wall_door_centered_large_01', 'door_centered_large_01'], ['wall_door_centered_small_01', 'door_centered_small_01'], ['wall_door_offset_small_01', 'door_offset_small_01']];
  const soot = [];
  const balconies = [];
  // one facade: origin = left end at street level, a = along (unit), n = outward normal, cols of 3 m, floors of 3 m
  const facadeRun = (o, a, n, width, floors, seed) => {
    const rr = mulberry(seed);
    const cols = Math.max(1, Math.round(width / 3)), sx = width / (cols * 3);
    Q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(a, UP, n));
    const tint = tints[Math.floor(rr() * tints.length)];
    const style = winSets[Math.floor(rr() * winSets.length)], style2 = winSets[Math.floor(rr() * winSets.length)];
    const balc = rr() < 0.45;
    const shop = rr() < 0.55;
    const at = (col, y, ox = 0, oz = 0) => P.copy(o).addScaledVector(a, (col + 1) * 3 * sx + ox).addScaledVector(n, oz).setY(y);
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        M.compose(at(c, f * 3), Q, S.set(sx, 1, 1));
        if (f === 0) {
          if (shop && c % 2 === 0 && c < cols) { // shopfront with a rusted roller shutter
            put('wall_door_centered_large_01', M, tint);
            const p = at(c, 0, -1.5 * sx, 0.02); props.push([rr() < 0.5 ? 'rollershutter_door#rollershutter_door' : 'rollershutter_door#rollershutter_door_graffiti', new THREE.Matrix4().compose(p.clone(), Q.clone(), new THREE.Vector3(sx * 1.95, 1.06, 1))]);
          } else if (rr() < 0.35) { const d = doorSets[Math.floor(rr() * doorSets.length)]; put(d[0], M, tint); put(d[1], M); }
          else { const w = winSets[Math.floor(rr() * 4)]; put(w[0], M, tint); put(w[1], M, null, { broken: rr() < 0.35 }); }
          continue;
        }
        let set = rr() < 0.75 ? style : style2;
        if (balc && c % 3 === 1 && rr() < 0.7) {
          set = rr() < 0.5 ? ['wall_door_window_small_01', 'door_window_small_01'] : ['wall_door_window_small_05', 'door_window_small_05'];
          balconies.push({ p: at(c, f * 3, -1.5 * sx, 0).clone(), q: Q.clone(), w: 2.6 * sx });
        }
        if (rr() < 0.06) { put('wall_standard_standard_01', M, tint); continue; }
        put(set[0], M, tint);
        const broken = rr() < 0.22;
        put(set[1], M, null, { broken });
        if (broken && rr() < 0.6) soot.push({ p: at(c, f * 3 + 2.0, -1.5 * sx, 0.03).clone(), q: Q.clone() });
        // AC units under some windows, hanging off the facade
        if (rr() < 0.13 && f < floors) props.push([rr() < 0.5 ? 'exterior_aircon_unit#exterior_aircon_unit' : 'exterior_aircon_unit#exterior_aircon_unit_rusted', new THREE.Matrix4().compose(at(c, f * 3 - 0.35, -1.5 * sx, 0.2).clone(), Q.clone(), new THREE.Vector3(0.9, 0.9, 0.9))]);
      }
      // floor band between storeys
      if (f > 0) for (let c = 0; c < cols; c++) put('cornice_standard_standard_01', M.compose(at(c, f * 3 - 0.1), Q, S.set(sx, 1, 1)), tint);
    }
    for (let c = 0; c < cols; c++) {
      put('base_standard_01', M.compose(at(c, 0), Q, S.set(sx, 0.8, 1)), tint);
      put('crown_standard_standard_01', M.compose(at(c, floors * 3), Q, S.set(sx, 1, 1)), tint);
    }
    // corner piers
    for (const e of [0, cols * 3 * sx + 0.12]) for (let f = 0; f < floors; f++) put('wall_pier_standard_01', M.compose(P.copy(o).addScaledVector(a, e).setY(f * 3), Q, S.set(1, 1, 1)), tint);
    // downpipe at one end
    if (rr() < 0.7) {
      const end = rr() < 0.5 ? 0.35 : cols * 3 * sx - 0.35, hgt = floors * 3 + 0.6;
      const pipe = new THREE.CylinderGeometry(0.06, 0.06, hgt, 8);
      pipe.applyMatrix4(new THREE.Matrix4().compose(P.copy(o).addScaledVector(a, end).addScaledVector(n, 0.12).setY(hgt / 2), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
      if (!buckets.has(rustSteel)) buckets.set(rustSteel, []); buckets.get(rustSteel).push(pipe);
    }
    // fire escape zig-zag on some tall blocks
    if (floors >= 4 && rr() < 0.35 && cols >= 3) fireEscapes.push({ o: o.clone(), a: a.clone(), n: n.clone(), floors, col: 1 + Math.floor(rr() * (cols - 2)), sx });
  };
  const fireEscapes = [];

  // ---------- perimeter buildings with four gates ----------
  const bodyMats = [brickMat, plasterBox, concreteMat];
  let bseed = 1;
  const sideRun = (fixed, axis, from, to) => {
    let p = from;
    while (p < to - 0.5) {
      let len = [6, 9, 9, 12, 12, 15][Math.floor(r() * 6)];
      if (to - p - len < 5) len = to - p;
      const floors = 3 + Math.floor(r() * 4), h = floors * 3 + 0.75, depth = 8;
      const cx = p + len / 2, sgn = Math.sign(fixed), inset = 0.45;
      const body = bodyMats[Math.floor(r() * bodyMats.length)];
      // collider covers the full block; the visible body sits a little behind the facade plane
      solid(null, axis === 'x' ? len : depth, h, axis === 'x' ? depth : len, axis === 'x' ? cx : fixed + sgn * depth / 2, 0, axis === 'x' ? fixed + sgn * depth / 2 : cx, { surface: 'concrete' });
      const bd = depth - inset;
      if (axis === 'x') add(body, tiledBox(len, h, bd, 1 / 3), cx, h / 2, fixed + sgn * (inset + bd / 2));
      else add(body, tiledBox(bd, h, len, 1 / 3), fixed + sgn * (inset + bd / 2), h / 2, cx);
      // dark interiors behind the openings
      const ip = new THREE.PlaneGeometry(len, h - 0.75);
      if (axis === 'x') { ip.rotateY(sgn > 0 ? Math.PI : 0); ip.translate(cx, (h - 0.75) / 2, fixed + sgn * (inset - 0.02)); }
      else { ip.rotateY(sgn > 0 ? -Math.PI / 2 : Math.PI / 2); ip.translate(fixed + sgn * (inset - 0.02), (h - 0.75) / 2, cx); }
      if (!buckets.has(interior)) buckets.set(interior, []); buckets.get(interior).push(ip);
      // facade faces the arena (outward normal = -sgn on the fixed axis)
      const n = axis === 'x' ? new THREE.Vector3(0, 0, -sgn) : new THREE.Vector3(-sgn, 0, 0);
      const a = new THREE.Vector3().crossVectors(UP, n);
      const startAlong = a.x + a.z > 0 ? p : p + len; // left end when looking at the facade
      const o = axis === 'x' ? new THREE.Vector3(startAlong, 0, fixed) : new THREE.Vector3(fixed, 0, startAlong);
      facadeRun(o, a, n, len, floors, bseed++ * 7919);
      // roof clutter for silhouette: water tank / vents
      if (r() < 0.5) {
        const tx = axis === 'x' ? cx + (r() - 0.5) * (len - 4) : fixed + sgn * (depth * 0.6), tz = axis === 'x' ? fixed + sgn * (depth * 0.6) : cx + (r() - 0.5) * (len - 4);
        const tank = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 14); tank.translate(tx, h + 2.0, tz);
        add(rustSteel, tank, 0, 0, 0);
        for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) add(rustSteel, new THREE.BoxGeometry(0.12, 0.9, 0.12), tx + lx, h + 0.45, tz + lz);
      }
      if (r() < 0.4) add(concreteMat, tiledBox(2.4, 1.6, 2.4, 1 / 2), axis === 'x' ? cx + (r() - 0.5) * (len - 3) : fixed + sgn * 5, h + 0.8, axis === 'x' ? fixed + sgn * 5 : cx + (r() - 0.5) * (len - 3));
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
      solid(rustSteel, 0.8, 7, 0.8, px, 0, pz, { surface: 'metal', density: 0.5 });
    }
    add(rustSteel, tiledBox(gate + 1.6, 0.8, 0.8, 0.5), x, 7.2, z, rot);
    const out = new THREE.Vector3(x, 0, z).normalize();
    spawns.push(new THREE.Vector3(x + out.x * 6, 0, z + out.z * 6));
  }

  // ---------- central platform with stairs (verticality) ----------
  const PH = 2.0;
  solid(concreteMat, 10, PH, 9, 0, 0, 0, { walk: true });
  add(floorMat, tiledBox(10.02, 0.04, 9.02, 1 / 3), 0, PH + 0.005, 0);
  // steel edge angle round the deck + a darker plinth band at the foot
  for (const s2 of [-1, 1]) {
    add(rustSteel, tiledBox(10.1, 0.12, 0.08, 1), 0, PH - 0.04, s2 * 4.53); add(rustSteel, tiledBox(0.08, 0.12, 9.1, 1), s2 * 5.03, PH - 0.04, 0);
    add(darkConcrete, tiledBox(10.06, 0.35, 0.05, 1 / 2), 0, 0.175, s2 * 4.51); add(darkConcrete, tiledBox(0.05, 0.35, 9.06, 1 / 2), s2 * 5.01, 0.175, 0);
  }
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
      // worn steel nosing on each tread
      const nx = cx + dirX * (d / 2 - 0.03), nz = cz + dirZ * (d / 2 - 0.03);
      if (dirX) add(rustSteel, tiledBox(0.07, 0.035, width + 0.01, 1), nx, h - 0.012, nz);
      else add(rustSteel, tiledBox(width + 0.01, 0.035, 0.07, 1), nx, h - 0.012, nz);
    }
  };
  stairs(0, -4.5, 0, -1, 3, PH, 8);
  stairs(0, 4.5, 0, 1, 3, PH, 8);

  // ---------- containers (cover + a climbable stack) ----------
  const container = (x, z, rotY, mi, y0 = 0) => {
    const L = 6.1, W = 2.44, Hc = 2.6;
    const w = rotY ? W : L, d = rotY ? L : W;
    add(containerMats[mi], tiledBox(w, Hc, d, 1 / 2.6), x, y0 + Hc / 2, z);
    // corner castings, posts and top/bottom rails so it reads as a real ISO box
    const P = 0.13, e = 0.02;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      add(rustSteel, tiledBox(P, Hc + e, P, 2), x + sx * (w / 2 - P / 2 + e), y0 + Hc / 2, z + sz * (d / 2 - P / 2 + e));
      for (const yy of [0.09, Hc - 0.09]) add(darkSteel, tiledBox(0.18, 0.18, 0.18, 2), x + sx * (w / 2 - 0.08 + e), y0 + yy, z + sz * (d / 2 - 0.08 + e));
    }
    for (const yy of [0.06, Hc - 0.05]) for (const s2 of [-1, 1]) {
      if (w > d) add(rustSteel, tiledBox(w - 0.1, 0.1, 0.06, 1), x, y0 + yy, z + s2 * (d / 2 + 0.01));
      else add(rustSteel, tiledBox(0.06, 0.1, d - 0.1, 1), x + s2 * (w / 2 + 0.01), y0 + yy, z);
    }
    // door end: locking bars
    const endX = w > d ? x + w / 2 + 0.03 : x, endZ = w > d ? z : z + d / 2 + 0.03;
    for (const k of [-0.75, -0.3, 0.3, 0.75]) {
      if (w > d) add(darkSteel, tiledBox(0.04, Hc - 0.3, 0.04, 1), endX, y0 + Hc / 2, z + k * d / 2);
      else add(darkSteel, tiledBox(0.04, Hc - 0.3, 0.04, 1), x + k * w / 2, y0 + Hc / 2, endZ);
    }
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y0, maxY: y0 + Hc, minZ: z - d / 2, maxZ: z + d / 2, walk: false, mat: 'metal', top: y0 + Hc });
  };
  container(-16, -8, 0, 0); container(-16, -5.4, 0, 1); container(-16, -8, 0, 2, 2.6);
  container(17, 9, 1, 3); container(14.4, 9, 1, 0);
  container(-12, 15, 0, 2); container(20, -15, 1, 1); container(8, -20, 0, 3);
  container(-24, 22, 1, 0); container(24, 24, 0, 2);
  stairs(-12.95, -5.4, 1, 0, 2.2, 2.6, 10);

  // ---------- jersey barriers (scanned concrete road barriers, two per 3 m run) ----------
  const barrier = (x, z, rot) => {
    const w = rot ? 0.6 : 3, d = rot ? 3 : 0.6;
    solid(null, w, 0.95, d, x, 0, z);
    for (const k of [-0.75, 0.75]) propAt('concrete_road_barrier', x + (rot ? 0 : k), 0, z + (rot ? k : 0), rot ? Math.PI / 2 : 0, 1.0, 1.12);
  };
  [[-6, -12, 0], [6, 12, 0], [-9, 9, 1], [10, -8, 1], [-22, 2, 1], [23, -2, 1], [0, -26, 0], [0, 26, 0], [-27, -18, 0], [28, 16, 0], [13, 22, 1], [-10, -22, 1]]
    .forEach(([x, z, rot]) => barrier(x, z, rot));

  // ---------- crates ----------
  // scanned Poly Haven crate (unit-normalised from its bounds), procedural boxes as a fallback
  const crateBox = A.models.wooden_crate_01 && new THREE.Box3().setFromObject(A.models.wooden_crate_01.scene);
  const crateAt = (x, y, z, s, rot) => {
    if (crateBox) {
      const sz = crateBox.getSize(new THREE.Vector3()), k = s / Math.max(sz.x, sz.z), ky = s / sz.y;
      propAt('wooden_crate_01', x, y - crateBox.min.y * ky, z, rot, k, ky);
      solid(null, s, s, s, x, y, z, { surface: 'wood' });
    } else solid(crate, s, s, s, x, y, z, { density: 1 / s, surface: 'wood' });
  };
  [[-4, -15], [-3, -16.2], [7, 17], [16, -6], [-19, 12], [26, 6], [-26, -6], [4, -29]].forEach(([x, z], i) => {
    const s = 1.1 + (i % 3) * 0.15;
    crateAt(x, 0, z, s, (i % 2) * Math.PI / 2);
    if (i % 3 === 0) crateAt(x + 0.1, s, z - 0.05, 0.9, 0.3);
  });

  // ---------- broken overpass ----------
  for (const x of [-26, -13, 13, 26]) solid(darkConcrete, 1.4, 6.6, 1.4, x, 0, -17, { surface: 'concrete' });
  solid(darkConcrete, 30, 0.9, 7, -21, 6.6, -17); solid(darkConcrete, 24, 0.9, 7, 24, 6.6, -17);
  add(rustSteel, tiledBox(30, 0.4, 0.3, 0.5), -21, 6.4, -13.6); add(rustSteel, tiledBox(24, 0.4, 0.3, 0.5), 24, 6.4, -13.6);
  const fallen = tiledBox(9, 0.8, 6.6, 0.25); fallen.rotateZ(-0.62); fallen.translate(1.5, 3.1, -17);
  add(darkConcrete, fallen, 0, 0, 0);
  for (let i = 0; i < 4; i++) colliders.push({ minX: -2 + i * 1.9, maxX: -0.1 + i * 1.9, minY: 0, maxY: 5.9 - i * 1.55, minZ: -20.3, maxZ: -13.7, walk: false, mat: 'concrete' });
  // exposed rebar sticking out of the broken deck ends
  for (const [x0, sgn] of [[-6, 1], [12, -1]]) for (let i = 0; i < 9; i++) {
    const g = new THREE.CylinderGeometry(0.018, 0.018, 0.6 + r() * 0.9, 4); g.rotateZ(Math.PI / 2 + (r() - 0.5) * 0.6); g.rotateY((r() - 0.5) * 0.5);
    g.translate(x0 + sgn * 0.4, 6.4 + r() * 0.9, -20 + r() * 6); add(rustSteel, g, 0, 0, 0);
  }

  // ---------- rubble + debris ----------
  for (let i = 0; i < 110; i++) {
    const s = 0.12 + r() * 0.5;
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.scale(1, 0.45 + r() * 0.5, 0.8 + r() * 0.4);
    g.rotateY(r() * 6); g.rotateX(r() * 0.5);
    let x = (r() * 2 - 1) * (H - 2), z = (r() * 2 - 1) * (H - 2);
    if (Math.abs(x) < 6 && Math.abs(z) < 8) x += 9;
    // piles at the foot of buildings and under the broken overpass
    if (i < 40) { const side = Math.floor(r() * 4); const t = (r() * 2 - 1) * (H - 4); [x, z] = side === 0 ? [t, -H + 0.8 + r() * 2] : side === 1 ? [t, H - 0.8 - r() * 2] : side === 2 ? [-H + 0.8 + r() * 2, t] : [H - 0.8 - r() * 2, t]; }
    else if (i < 55) { x = -2 + r() * 8; z = -20 + r() * 6; }
    g.translate(x, s * 0.2, z);
    add(i % 3 ? darkConcrete : brickMat, g, 0, 0, 0);
  }

  // ---------- street props ----------
  const lights = [];
  const lampPost = (x, z, rot) => {
    propAt('street_lamp_01', x, 0, z, rot, 1.65);
    colliders.push({ minX: x - 0.15, maxX: x + 0.15, minY: 0, maxY: 6.3, minZ: z - 0.15, maxZ: z + 0.15, walk: false, mat: 'metal' });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2.4) }));
    const hx = x + Math.sin(rot) * 0.35 * 1.65, hz = z + Math.cos(rot) * 0.35 * 1.65;
    head.position.set(hx, 6.05, hz); scene.add(head);
    const L = new THREE.PointLight('#ffad52', 26, 22, 1.6);
    L.position.set(hx, 5.8, hz); scene.add(L); lights.push({ light: L, base: 26, flicker: 0.02, head });
  };
  lampPost(-9, 6, 0); lampPost(10, -5, Math.PI); lampPost(-20, -26, 0); lampPost(21, 20, Math.PI);
  const fires = [];
  const barrel = (x, z) => {
    propAt('barrel_03', x, 0, z, r() * 6, 1.0);
    colliders.push({ minX: x - 0.32, maxX: x + 0.32, minY: 0, maxY: 0.9, minZ: z - 0.32, maxZ: z + 0.32, walk: false, mat: 'metal' });
    const L = new THREE.PointLight('#ff6a1c', 14, 12, 1.8);
    L.position.set(x, 1.4, z); scene.add(L);
    lights.push({ light: L, base: 14, flicker: 0.35 });
    fires.push(new THREE.Vector3(x, 0.92, z));
  };
  barrel(-5, 10.5); barrel(14, -13); barrel(-18, -14); barrel(17, 14);
  // abandoned cars under tarps along the pavements
  const car = (x, z, rot) => {
    propAt('covered_car', x, 0, z, rot, 1);
    const w = Math.abs(Math.sin(rot)) > 0.5 ? 4.4 : 1.8, d = Math.abs(Math.sin(rot)) > 0.5 ? 1.8 : 4.4;
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: 1.35, minZ: z - d / 2, maxZ: z + d / 2, walk: false, mat: 'metal' });
  };
  car(-20, 31.6, Math.PI / 2 + 0.06); car(12, 31.8, -Math.PI / 2); car(-9, -31.7, Math.PI / 2 - 0.08); car(25, -31.6, Math.PI / 2);
  car(31.6, -25, 0.05); car(31.8, 11, Math.PI); car(-31.6, 27, 0); car(-31.7, -12, Math.PI + 0.1);
  // small clutter (no collision)
  const clutter = [['trashbag', 0.9], ['old_tyre', 1], ['water_manhole_cover', 1], ['wooden_crate_01', 1], ['utility_box_01', 1], ['metal_trash_can', 0.8], ['fire_hydrant', 1]];
  const spots = [[-33.4, 18], [-33.2, -24], [33.3, 22], [33.5, -6], [18, 33.4], [-26, 33.2], [6, -33.4], [-30, -33.3], [29, -33.2], [-5, 33.5], [33.4, 30], [-33.5, 4]];
  spots.forEach(([x, z], i) => {
    const [id, s] = clutter[i % clutter.length];
    const rot = Math.abs(x) > Math.abs(z) ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : (z > 0 ? Math.PI : 0);
    propAt(id, x, 0, z, rot + (r() - 0.5) * 0.4, s);
    if (id === 'trashbag') { propAt('trashbag', x + 0.6, 0, z + 0.3, r() * 6, 0.8); propAt('trashbag', x - 0.4, 0.35, z + 0.1, r() * 6, 0.7); }
    if (id === 'utility_box_01' || id === 'metal_trash_can') colliders.push({ minX: x - 0.4, maxX: x + 0.4, minY: 0, maxY: 1.1, minZ: z - 0.4, maxZ: z + 0.4, walk: false, mat: 'metal' });
  });
  for (const [x, z] of [[-6, 20], [14, 2], [-20, -2], [2, -11], [22, -24], [-14, 28]]) propAt('water_manhole_cover', x, 0.0, z, r() * 6, 1);
  for (const [x, z] of [[-12, 17.5], [9.5, -22], [-22.5, 19.5], [19, 10.8], [-2.2, 6]]) propAt('old_tyre', x, 0.08, z, r() * 6, 1);

  // ---------- balconies (slab + railing) + soot above burned-out windows ----------
  const railMat = rustSteel;
  for (const b of balconies) {
    const slab = tiledBox(b.w, 0.14, 1.05, 1 / 2);
    slab.applyMatrix4(new THREE.Matrix4().compose(b.p.clone().add(new THREE.Vector3(0, -0.07, 0).add(new THREE.Vector3(0, 0, 0.52).applyQuaternion(b.q))), b.q, new THREE.Vector3(1, 1, 1)));
    add(concreteMat, slab, 0, 0, 0);
    const parts = [];
    parts.push(new THREE.BoxGeometry(b.w, 0.05, 0.05).translate(0, 1.0, 1.02));
    parts.push(new THREE.BoxGeometry(0.05, 0.05, 1.02).translate(-b.w / 2 + 0.03, 1.0, 0.51), new THREE.BoxGeometry(0.05, 0.05, 1.02).translate(b.w / 2 - 0.03, 1.0, 0.51));
    for (let k = 0; k <= 12; k++) parts.push(new THREE.BoxGeometry(0.022, 1.0, 0.022).translate(-b.w / 2 + 0.05 + (k / 12) * (b.w - 0.1), 0.5, 1.02));
    const rail = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    rail.applyMatrix4(new THREE.Matrix4().compose(b.p, b.q, new THREE.Vector3(1, 1, 1)));
    add(railMat, rail, 0, 0, 0);
  }
  const sootTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256; const x = c.getContext('2d');
    for (let i = 0; i < 60; i++) {
      const gx = 64 + (Math.random() - 0.5) * 50, gy = 200 - Math.random() * 190, rad = 14 + Math.random() * 30;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, rad); g.addColorStop(0, `rgba(10,8,7,${0.12 + Math.random() * 0.12})`); g.addColorStop(1, 'rgba(10,8,7,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 256);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const sootMat = new THREE.MeshStandardMaterial({ map: sootTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const s of soot) {
    const g = new THREE.PlaneGeometry(2.4, 3.2); g.translate(0, 1.2, 0);
    g.applyMatrix4(new THREE.Matrix4().compose(s.p, s.q, new THREE.Vector3(1, 1, 1)));
    add(sootMat, g, 0, 0, 0);
  }
  // fire escapes: platform + railing per floor, stairs between
  const fe = A.models.modular_fire_escape.scene; fe.updateMatrixWorld(true);
  const feParts = {};
  fe.traverse((o) => { if (o.isMesh) { const nm = o.parent && /modular_fire_escape_/.test(o.parent.name) ? o.parent.name : o.name; (feParts[nm] = feParts[nm] || []).push(o); } });
  const feBox = (nm) => { const b = new THREE.Box3(); for (const o of feParts[nm] || []) b.expandByObject(o); return b; };
  const fePiece = (nm, mtx) => { for (const o of feParts[nm] || []) { const g = o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(mtx); if (!buckets.has(o.material)) buckets.set(o.material, []); buckets.get(o.material).push(g); } };
  const plat = feBox('modular_fire_escape_platform_middle'), rail = feBox('modular_fire_escape_railing_middle'), st = feBox('modular_fire_escape_stairs');
  for (const F of fireEscapes) {
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(F.a, UP, F.n));
    const cxp = F.o.clone().addScaledVector(F.a, (F.col + 0.5) * 3 * F.sx).addScaledVector(F.n, 0.78);
    for (let f = 1; f < F.floors; f++) {
      const y = f * 3 - 0.05;
      const base = new THREE.Matrix4().compose(cxp.clone().setY(y), q, new THREE.Vector3(1, 1, 1));
      fePiece('modular_fire_escape_platform_middle', base.clone().multiply(new THREE.Matrix4().makeTranslation(-(plat.min.x + plat.max.x) / 2, -plat.max.y, -(plat.min.z + plat.max.z) / 2)));
      fePiece('modular_fire_escape_railing_middle', base.clone().multiply(new THREE.Matrix4().makeTranslation(-(rail.min.x + rail.max.x) / 2, -rail.min.y, -(rail.min.z + rail.max.z) / 2)));
      if (f < F.floors - 1) fePiece('modular_fire_escape_stairs', base.clone().multiply(new THREE.Matrix4().makeScale(1, 3 / (st.max.y - st.min.y), 1)).multiply(new THREE.Matrix4().makeTranslation(-(st.min.x + st.max.x) / 2, -st.min.y, -(st.min.z + st.max.z) / 2)));
    }
  }

  // ---------- merge static geometry per material ----------
  for (const [mat, geos] of buckets) {
    const list = geos.map((g) => {
      g = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return g;
    });
    const merged = mergeGeometries(list, false);
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = mat !== sootMat && mat !== interior; m.receiveShadow = true;
    scene.add(m);
  }
  // instanced facade pieces
  let facadeTris = 0;
  for (const [name, list] of inst) {
    for (const part of pieces.get(name)) {
      const use = part.glass ? list.filter((x) => !x.broken) : list;
      if (!use.length) continue;
      const im = new THREE.InstancedMesh(part.geo, part.mat, use.length);
      use.forEach((x, i) => { im.setMatrixAt(i, M.multiplyMatrices(x.m, part.local)); if (x.c && !part.glass) im.setColorAt(i, x.c); });
      im.castShadow = !part.glass; im.receiveShadow = true;
      if (part.glass) im.renderOrder = 1;
      im.computeBoundingSphere();
      scene.add(im);
      facadeTris += (part.geo.index ? part.geo.index.count : part.geo.attributes.position.count) / 3 * use.length;
    }
  }
  // GLB props, instanced per mesh
  const byId = new Map();
  for (const [id, m] of props) { if (!byId.has(id)) byId.set(id, []); byId.get(id).push(m); }
  const box = new THREE.Box3();
  for (const [key, list] of byId) {
    const [id, sub] = key.split('#');
    const g = A.models[id]; if (!g) continue;
    g.scene.updateMatrixWorld(true);
    const root = sub ? g.scene.getObjectByName(sub) : g.scene; if (!root) continue;
    // normalise: footprint centred on the origin, resting on y = 0
    box.setFromObject(root);
    const off = new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
      const lm = new THREE.Matrix4().multiplyMatrices(off, o.matrixWorld);
      list.forEach((m, i) => im.setMatrixAt(i, M.multiplyMatrices(m, lm)));
      im.castShadow = !/manhole/.test(id); im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    });
  }

  // ---------- distant skyline in the haze ----------
  const skyline = [];
  for (let i = 0; i < 70; i++) {
    const a = (i / 70) * Math.PI * 2 + r() * 0.05, d = 70 + r() * 50;
    const w = 6 + r() * 14, h = 18 + r() * 45;
    const g = tiledBox(w, h, w, 1 / 12); g.rotateY(-a); g.translate(Math.cos(a) * d, h / 2, Math.sin(a) * d);
    skyline.push(g);
    if (r() < 0.6) { const w2 = w * (0.45 + r() * 0.3), h2 = 4 + r() * 12; const t = tiledBox(w2, h2, w2, 1 / 12); t.rotateY(-a); t.translate(Math.cos(a) * d, h + h2 / 2, Math.sin(a) * d); skyline.push(t); }
    if (r() < 0.3) { const m = new THREE.CylinderGeometry(0.15, 0.15, 6 + r() * 8, 4); m.translate(Math.cos(a) * d + (r() - 0.5) * w * 0.5, h + 4, Math.sin(a) * d); skyline.push(m.toNonIndexed().index ? m : tiledBox(0.3, 8 + r() * 6, 0.3, 1).translate(Math.cos(a) * d, h + 5, Math.sin(a) * d)); }
  }
  const fac = facade({ seed: 7 });
  const skyMat = new THREE.MeshStandardMaterial({ map: fac.map, emissiveMap: fac.emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.8, roughness: 1, color: '#6f6670' });
  const sk = new THREE.Mesh(mergeGeometries(skyline), skyMat);
  scene.add(sk);

  return { colliders, spawns, lights, fires, nav: buildNav(colliders), stats: { facadeTris } };
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
  return { N, H, height, blocked };
}
