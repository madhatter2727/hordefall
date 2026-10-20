import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// Critically-tunable spring-damper on a Vector3. Integrated with substeps for stability.
export class Spring3 {
  constructor(stiffness = 120, damping = 14) {
    this.k = stiffness; this.d = damping;
    this.value = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.target = new THREE.Vector3();
  }
  impulse(x, y, z) { this.vel.x += x; this.vel.y += y; this.vel.z += z; return this; }
  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const ax = this.k * (this.target.x - this.value.x) - this.d * this.vel.x;
      const ay = this.k * (this.target.y - this.value.y) - this.d * this.vel.y;
      const az = this.k * (this.target.z - this.value.z) - this.d * this.vel.z;
      this.vel.x += ax * h; this.vel.y += ay * h; this.vel.z += az * h;
      this.value.x += this.vel.x * h; this.value.y += this.vel.y * h; this.value.z += this.vel.z * h;
    }
    return this.value;
  }
  reset() { this.value.set(0, 0, 0); this.vel.set(0, 0, 0); }
}

// Seeded RNG for deterministic level dressing.
export function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ray vs axis-aligned box (slab method). Returns distance or -1, and writes the hit normal.
export function rayAABB(ox, oy, oz, dx, dy, dz, b, maxT, outN) {
  let tmin = 0, tmax = maxT, nAxis = -1, nSign = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mn[a] || o[a] > mx[a]) return -1;
    } else {
      const inv = 1 / d[a];
      let t1 = (mn[a] - o[a]) * inv, t2 = (mx[a] - o[a]) * inv, s = -1;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
      if (t1 > tmin) { tmin = t1; nAxis = a; nSign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  if (nAxis < 0) return -1; // origin inside the box
  if (outN) { outN.set(0, 0, 0); outN.setComponent(nAxis, nSign); }
  return tmin;
}

// Ray vs capsule (segment a-b, radius r). Returns distance or -1.
const _v = new THREE.Vector3();
export function rayCapsule(o, d, a, b, r, maxT) {
  // closest approach between ray and segment, then refine with sphere test at closest segment point
  const ba = _v.copy(b).sub(a);
  const oa = new THREE.Vector3().copy(o).sub(a);
  const baba = ba.dot(ba), bard = ba.dot(d), baoa = ba.dot(oa), rdoa = d.dot(oa), oaoa = oa.dot(oa);
  let A = baba - bard * bard, B = baba * rdoa - baoa * bard, C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0 && A > 1e-9) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t > 0 && t < maxT) return t;
    // caps
    const oc = y <= 0 ? oa : new THREE.Vector3().copy(o).sub(b);
    const bb = d.dot(oc), cc = oc.dot(oc) - r * r;
    h = bb * bb - cc;
    if (h > 0) { const t2 = -bb - Math.sqrt(h); if (t2 > 0 && t2 < maxT) return t2; }
    return -1;
  }
  return raySphere(o, d, a, r, maxT);
}

export function raySphere(o, d, c, r, maxT) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t > 0 && t < maxT ? t : -1;
}
