// Throwables: frag grenades (G, hold to cook) and the Screamer, an original wind-up noisemaker decoy (Q / 4).
// Simple sphere-vs-AABB physics against the arena colliders so both bounce off walls, crates and the ground.
import * as THREE from 'three';
import { clamp, rand, damp } from './core/util.js';

// ---- tuning: everything about throwables lives here ----
export const THROW = {
  frag: {
    fuse: 3.2,          // seconds from pulling the pin (cooking eats into this)
    speed: 17, up: 4.2, // throw velocity (m/s) along aim, plus upward loft
    radius: 7, dmg: 320, fx: 0.8, // blast radius (m), max damage, explosion FX scale
    start: 2, perWave: 2, max: 4, cost: 350, // carried at start, refilled after each wave, carry cap, shop price
  },
  screamer: {
    speed: 12.5, up: 4.8,
    lureTime: 7, lureRadius: 26, // zombies inside this radius chase the toy instead of you
    radius: 8.5, dmg: 460, fx: 1.35,
    max: 3, cost: 1250,
  },
  gravity: 20, bounce: 0.42, friction: 0.72, r: 0.07,
};

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.2, ...o });

export function fragModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), mat('#3d4a2a', { roughness: 0.7 }));
  body.scale.set(1, 1.22, 1); g.add(body);
  for (let i = 0; i < 3; i++) { // segmented grip rings
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.054 - Math.abs(i - 1) * 0.012, 0.006, 6, 16), mat('#2f3a20'));
    ring.rotation.x = Math.PI / 2; ring.position.y = (i - 1) * 0.03; g.add(ring);
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.035, 10), mat('#8a8a80', { metalness: 0.7, roughness: 0.35 }));
  top.position.y = 0.075; g.add(top);
  const spoon = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.09, 0.008), mat('#9a9a90', { metalness: 0.7, roughness: 0.35 }));
  spoon.position.set(0.03, 0.045, 0); spoon.rotation.z = -0.35; g.add(spoon);
  const ringPin = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 14), mat('#c8c8c0', { metalness: 0.8, roughness: 0.3 }));
  ringPin.position.set(-0.03, 0.08, 0); g.add(ringPin);
  g.userData.pin = ringPin;
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

// "Screamer": a tin wind-up toy with a siren dome, crashing cymbals and a big key on its back
export function screamerModel() {
  const g = new THREE.Group(), s = new THREE.Group(); g.add(s); s.scale.setScalar(1.35);
  const tin = mat('#c8321e', { metalness: 0.55, roughness: 0.35 }), cream = mat('#efe2c0', { metalness: 0.3, roughness: 0.4 });
  const brass = mat('#d9a73a', { metalness: 0.9, roughness: 0.25 }), dark = mat('#1b1b1f', { roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.03, 16), dark); base.position.y = 0.015; s.add(base);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 16), tin); body.position.y = 0.09; s.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0645, 0.0665, 0.03, 16), cream); band.position.y = 0.09; s.add(band);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), cream); head.position.y = 0.19; s.add(head);
  for (const x of [-0.02, 0.02]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), dark); eye.position.set(x, 0.2, 0.045); s.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.005, 6, 12), dark); mouth.position.set(0, 0.172, 0.047); s.add(mouth);
  const domeMat = new THREE.MeshStandardMaterial({ color: '#ff3a1a', emissive: '#ff2a0a', emissiveIntensity: 0.4, roughness: 0.2, transparent: true, opacity: 0.92 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat); dome.position.y = 0.237; s.add(dome);
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(side * 0.07, 0.12, 0); s.add(pivot);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.075), tin); arm.position.set(0, 0, 0.035); pivot.add(arm);
    const cym = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.005, 20), brass);
    cym.rotation.z = Math.PI / 2; cym.position.set(-side * 0.008, 0, 0.075); pivot.add(cym);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), brass); nub.position.set(-side * 0.012, 0, 0.075); pivot.add(nub);
    arms.push({ pivot, side });
  }
  const key = new THREE.Group(); key.position.set(0, 0.1, -0.075); s.add(key);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 8), brass); shaft.rotation.x = Math.PI / 2; shaft.position.z = -0.02; key.add(shaft);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 6, 14), brass); wing.position.set(side * 0.024, 0, -0.042); wing.rotation.y = Math.PI / 2; key.add(wing);
  }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.userData = { arms, key, domeMat, spin: s };
  return g;
}

export class Throwables {
  constructor(scene, colliders, hooks) {
    this.scene = scene; this.colliders = colliders; this.hooks = hooks;
    this.list = [];
    this.frags = THROW.frag.start; this.screamers = 0;
    this.cook = null; // { t } while G is held
    this.throwAnim = 0;
    this.light = new THREE.PointLight('#ff3010', 0, 9, 2); scene.add(this.light); // shared siren light (no shader recompiles)
    this.ind = document.getElementById('nadeind');
    this.indEls = [];
  }
  reset() {
    for (const o of this.list) this.scene.remove(o.mesh);
    this.list.length = 0; this.cook = null; this.throwAnim = 0;
    this.frags = THROW.frag.start; this.screamers = 0; this.light.intensity = 0;
    this.hooks.horde.lures = [];
  }
  refillWave() { this.frags = Math.min(THROW.frag.max, this.frags + THROW.frag.perWave); }

  // ---------- input (only while playing) ----------
  input(dt, input, alive) {
    if (!alive) { this.cook = null; return; }
    if (input.hit('KeyG') && !this.cook && this.frags > 0 && this.throwAnim <= 0) {
      this.frags--; this.cook = { t: 0, tick: 0 }; this.hooks.audio.play('pin'); this.hooks.onCount?.();
    } else if (input.hit('KeyG') && this.frags <= 0 && !this.cook) this.hooks.audio.play('dry');
    if (this.cook) {
      this.cook.t += dt;
      const left = THROW.frag.fuse - this.cook.t;
      // ticks speed up as the fuse burns down
      this.cook.tick -= dt;
      if (this.cook.tick <= 0) { this.hooks.audio.play('tick', { hot: left < 1.2 }); this.cook.tick = left < 1.2 ? 0.25 : 0.5; }
      if (left <= 0) { // held it too long
        const p = this.hand(); this.cook = null; this.throwAnim = 0;
        this.hooks.explode(p, THROW.frag.fx, { radius: THROW.frag.radius, dmg: THROW.frag.dmg, inHand: true });
        this.hooks.feed?.('<b>COOKED OFF</b>');
      } else if (!input.down('KeyG')) { this.launch('frag', left); this.cook = null; }
    }
    if ((input.hit('KeyQ') || input.hit('Digit4')) && !this.cook && this.throwAnim <= 0) {
      if (this.screamers > 0) { this.screamers--; this.launch('screamer'); this.hooks.onCount?.(); } else this.hooks.audio.play('dry');
    }
  }
  hand() {
    const cam = this.hooks.camera;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), r = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    return cam.position.clone().addScaledVector(f, 0.45).addScaledVector(r, -0.18).add(new THREE.Vector3(0, -0.15, 0));
  }
  launch(kind, fuse) {
    const C = THROW[kind], cam = this.hooks.camera, P = this.hooks.player;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const pos = this.hand();
    const vel = f.clone().multiplyScalar(C.speed).add(new THREE.Vector3(0, C.up, 0));
    vel.x += P.vel.x * 0.6; vel.z += P.vel.z * 0.6;
    this.spawn(kind, pos, vel, fuse);
    this.throwAnim = 0.35;
    this.hooks.audio.play('throw');
  }
  spawn(kind, pos, vel, fuse) {
    const mesh = kind === 'frag' ? fragModel() : screamerModel();
    if (kind === 'frag') mesh.userData.pin.visible = false;
    mesh.position.copy(pos); this.scene.add(mesh);
    const o = { kind, mesh, pos: pos.clone(), vel: vel.clone(), spin: new THREE.Vector3(rand(-14, 14), rand(-8, 8), rand(-14, 14)), fuse: fuse ?? THROW.frag.fuse, t: 0, rest: false, grounded: false, active: false, lureT: 0, clash: 0, note: 0 };
    this.list.push(o);
    return o;
  }

  // ---------- simulation ----------
  update(dt, time) {
    this.throwAnim = Math.max(0, this.throwAnim - dt);
    const H = this.hooks.horde;
    H.lures = [];
    let lit = null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.t += dt;
      if (!o.rest) this.physics(o, dt);
      if (o.kind === 'frag') {
        o.fuse -= dt;
        if (o.fuse <= 0) { this.detonate(o, i); continue; }
      } else {
        // the toy wakes up once it lands (or after a long flight)
        if (!o.active && ((o.grounded && o.vel.length() < 2.5) || o.t > 2.5)) { o.active = true; this.hooks.audio.play('windup', this.spatial(o.pos)); }
        if (o.active) {
          o.lureT += dt;
          H.lures.push({ pos: o.pos, r: THROW.screamer.lureRadius });
          this.animateToy(o, dt, time);
          if (!lit || o.lureT > lit.lureT) lit = o;
          if (o.lureT >= THROW.screamer.lureTime) { this.detonate(o, i); continue; }
        }
      }
    }
    if (lit) {
      const blink = Math.sin(time * 26) > 0 ? 1 : 0.08;
      this.light.position.copy(lit.pos).setY(lit.pos.y + 0.45); this.light.intensity = 9 * blink;
      lit.mesh.userData.domeMat.emissiveIntensity = 0.4 + 7 * blink;
    } else this.light.intensity = 0;
    this.updateIndicators();
  }
  physics(o, dt) {
    const n = Math.max(1, Math.ceil(o.vel.length() * dt / 0.05)), h = dt / n, r = THROW.r;
    o.grounded = false;
    for (let s = 0; s < n; s++) {
      o.vel.y -= THROW.gravity * h;
      o.pos.addScaledVector(o.vel, h);
      for (const c of this.colliders) {
        const p = o.pos;
        if (p.x < c.minX - r || p.x > c.maxX + r || p.y < c.minY - r || p.y > c.maxY + r || p.z < c.minZ - r || p.z > c.maxZ + r) continue;
        // push out along the axis of least penetration and bounce
        const pen = [p.x - (c.minX - r), (c.maxX + r) - p.x, p.y - (c.minY - r), (c.maxY + r) - p.y, p.z - (c.minZ - r), (c.maxZ + r) - p.z];
        let k = 0; for (let j = 1; j < 6; j++) if (pen[j] < pen[k]) k = j;
        const axis = k >> 1, sign = k & 1 ? 1 : -1, comp = ['x', 'y', 'z'][axis];
        p[comp] += sign * pen[k];
        const vn = o.vel[comp];
        if (vn * sign < 0) {
          const imp = Math.abs(vn);
          o.vel[comp] = -vn * THROW.bounce;
          for (const t of ['x', 'y', 'z']) if (t !== comp) o.vel[t] *= THROW.friction;
          o.spin.multiplyScalar(0.7);
          if (imp > 1.8) this.hooks.audio.play('bounce', { ...this.spatial(o.pos), k: Math.min(1, imp / 12), toy: o.kind === 'screamer' });
          if (axis === 1 && sign > 0 && Math.abs(o.vel.y) < 1.2) o.vel.y = 0;
        }
        if (axis === 1 && sign > 0) o.grounded = true;
      }
    }
    if (o.grounded) { // rolling friction, then settle
      const k = Math.exp(-3.5 * dt); o.vel.x *= k; o.vel.z *= k; o.spin.multiplyScalar(Math.exp(-5 * dt));
      if (o.vel.lengthSq() < 0.05) { o.vel.set(0, 0, 0); o.rest = true; }
    }
    o.mesh.position.copy(o.pos);
    if (o.kind === 'screamer' && o.grounded) { // settle upright
      o.mesh.rotation.x = damp(o.mesh.rotation.x, 0, 10, dt); o.mesh.rotation.z = damp(o.mesh.rotation.z, 0, 10, dt);
      o.mesh.position.y -= THROW.r;
    } else { o.mesh.rotation.x += o.spin.x * dt; o.mesh.rotation.y += o.spin.y * dt; o.mesh.rotation.z += o.spin.z * dt; }
    if (o.kind === 'frag' && o.grounded) o.mesh.position.y -= THROW.r * 0.3;
  }
  animateToy(o, dt, time) {
    const U = o.mesh.userData, t = o.lureT;
    o.mesh.rotation.x = 0; o.mesh.rotation.z = 0;
    // clattering: hops, wobbles and slowly shuffles round in circles
    const hop = Math.abs(Math.sin(t * 22)) * 0.018;
    U.spin.position.y = hop; U.spin.rotation.z = Math.sin(t * 17) * 0.12; U.spin.rotation.x = Math.sin(t * 13) * 0.06;
    o.mesh.rotation.y += dt * 1.6;
    U.key.rotation.z += dt * 9;
    const clap = Math.pow(Math.abs(Math.sin(t * Math.PI * 2.6)), 3);
    for (const a of U.arms) a.pivot.rotation.y = a.side * (0.55 - 0.55 * clap);
    o.clash -= dt;
    if (o.clash <= 0) { this.hooks.audio.play('cymbal', this.spatial(o.pos)); o.clash = 1 / 2.6; }
    o.note -= dt;
    if (o.note <= 0) { this.hooks.audio.play('jingle', { ...this.spatial(o.pos), bar: Math.floor(t / 1.6) }); o.note = 1.6; }
  }
  detonate(o, i) {
    const C = THROW[o.kind];
    this.scene.remove(o.mesh); this.list.splice(i, 1);
    const p = o.pos.clone(); p.y += 0.25;
    this.hooks.explode(p, C.fx, { radius: C.radius, dmg: C.dmg });
  }
  spatial(p) {
    const P = this.hooks.player, dx = p.x - P.pos.x, dz = p.z - P.pos.z, d = Math.hypot(dx, dz);
    const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    return { pan: clamp((dx * rx + dz * rz) / (d + 1), -0.9, 0.9), gain: clamp(10 / (d + 4), 0.08, 1) };
  }

  // ---------- grenade danger indicator ----------
  updateIndicators() {
    const cam = this.hooks.camera, P = this.hooks.player, W = innerWidth, Hh = innerHeight;
    const eye = new THREE.Vector3(P.pos.x, P.pos.y + 1, P.pos.z);
    let k = 0;
    for (const o of this.list) {
      const C = THROW[o.kind], d = o.pos.distanceTo(eye);
      const live = o.kind === 'frag' || (o.active && THROW.screamer.lureTime - o.lureT < 2.2);
      if (!live || d > C.radius + 1.5) continue;
      let el = this.indEls[k];
      if (!el) { el = document.createElement('div'); el.className = 'gind'; el.innerHTML = '<i></i><svg viewBox="0 0 24 24"><path d="M12 7a6 6 0 1 0 .01 0z M10 3h4v3h-4z M14 4l3-2"/></svg>'; this.ind.appendChild(el); this.indEls.push(el); }
      k++;
      const v = o.pos.clone().project(cam);
      let x = v.x, y = v.y;
      const behind = v.z > 1;
      if (behind) { x = -x; y = -y; }
      const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
      if (off) { // pin to an ellipse around the screen centre, pointing toward the grenade
        const a = Math.atan2(y, x); x = Math.cos(a) * 0.42; y = Math.sin(a) * 0.36;
      }
      const sx = ((x + 1) / 2) * W, sy = ((1 - y) / 2) * Hh;
      const danger = clamp(1 - d / C.radius, 0, 1);
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%,-50%) scale(${0.9 + danger * 0.5})`;
      el.style.setProperty('--d', danger.toFixed(2));
      el.classList.toggle('hot', danger > 0.25);
      el.firstChild.style.transform = off ? `rotate(${-Math.atan2(y, x)}rad)` : '';
      el.firstChild.style.opacity = off ? 1 : 0;
      el.style.display = 'block';
    }
    for (let j = k; j < this.indEls.length; j++) this.indEls[j].style.display = 'none';
  }
}
