import * as THREE from 'three';
import { WEAPONS } from './defs.js';
import { buildWeaponModels } from './models.js';
import { Spring3, clamp, damp, lerp, rand, randSign, smooth, easeInOut } from '../core/util.js';

const DEG = Math.PI / 180;
const POSES = {
  ar: { hip: new THREE.Vector3(0.105, -0.088, -0.3), hipRot: new THREE.Euler(0.0, 0.04, 0.03), ads: new THREE.Vector3(0, 0, -0.17) },
  sg: { hip: new THREE.Vector3(0.115, -0.095, -0.32), hipRot: new THREE.Euler(0.0, 0.04, 0.02), ads: new THREE.Vector3(0, 0, -0.2) },
  mr: { hip: new THREE.Vector3(0.112, -0.094, -0.33), hipRot: new THREE.Euler(0.0, 0.035, 0.02), ads: new THREE.Vector3(0, 0, -0.245) },
};

function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.15, 'rgba(255,220,140,1)'); g.addColorStop(0.4, 'rgba(255,140,40,.6)'); g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.translate(64, 64);
  for (let i = 0; i < 7; i++) {
    ctx.rotate((Math.PI * 2) / 7);
    ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(0, -60 - Math.random() * 4); ctx.lineTo(7, 0); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(c);
}
function sideFlameTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.3, 'rgba(255,190,90,.9)'); g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(32, 256); ctx.quadraticCurveTo(64, 120, 32, 0); ctx.quadraticCurveTo(0, 120, 32, 256); ctx.fill();
  return new THREE.CanvasTexture(c);
}

// keyframe track: keys = [[t, x, y, z], ...]; smooth interpolation between keys
const _kv = new THREE.Vector3();
function track(keys, t, out = _kv) {
  if (t <= keys[0][0]) return out.set(keys[0][1], keys[0][2], keys[0][3]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t < b[0]) { const k = smooth((t - a[0]) / (b[0] - a[0])); return out.set(lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)); }
  }
  const l = keys[keys.length - 1]; return out.set(l[1], l[2], l[3]);
}
const k3 = (t, v) => [t, v.x, v.y, v.z];

export class Arsenal {
  constructor(vmCamera, hooks) {
    this.hooks = hooks; // { shoot(origin, dir, def, isFirstPellet), audio, muzzleWorld(vec), onAmmo(), onSwap() }
    this.models = buildWeaponModels();
    this.redDot = this.models.redDot;
    this.root = new THREE.Group();
    vmCamera.add(this.root);
    this.weapons = WEAPONS.map((def) => {
      const model = this.models[def.id];
      model.root.visible = false;
      model.leftHome = model.leftHand.position.clone();
      this.root.add(model.root);
      return { def, model, mag: def.mag, reserve: def.reserve };
    });
    this.index = 0; this.current = this.weapons[0]; this.current.model.root.visible = true;
    this.ads = 0; this.adsTarget = 0;
    this.cooldown = 0; this.shotIndex = 0; this.lastShot = -1; this.bloom = 0; this.buffered = 0;
    this.reload = null; this.swap = null; this.pumpT = 1; this.sprintBlend = 0; this.sprintOut = 0;
    this.posKick = new Spring3(190, 17); this.rotKick = new Spring3(240, 19);
    this.swayRot = new Spring3(80, 11); this.swayPos = new Spring3(110, 13); this.land = new Spring3(140, 12);
    this.camKick = new Spring3(170, 15); // visual-only camera layer
    this.aimRecoil = { pitch: 0, yaw: 0 };
    this.bobPhase = 0; this.time = 0; this.firing = false;
    this.spreadNow = 2;

    // muzzle flash (view-model space) + flash light
    const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide };
    this.flash = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(3, 2.4, 1.6), ...add }));
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.22), new THREE.MeshBasicMaterial({ map: sideFlameTexture(), color: new THREE.Color(2.5, 2, 1.4), ...add }));
    s1.rotation.x = -Math.PI / 2; s1.position.z = -0.1;
    const s2 = s1.clone(); s2.rotation.y = Math.PI / 2;
    this.flash.add(front, s1, s2); this.flash.visible = false; this.flashFront = front;
    this.flashLight = new THREE.PointLight('#ffb766', 0, 1.6, 2);
    this.root.add(this.flashLight);
    this.flashT = 0;

    // ejected casings (view-model space)
    this.shells = [];
    const brass = this.models.materials.brass, hull = this.models.materials.hull;
    const caseGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 8); caseGeo.rotateZ(Math.PI / 2);
    const hullGeo = new THREE.CylinderGeometry(0.0105, 0.0105, 0.06, 10); hullGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(caseGeo, brass); m.visible = false; vmCamera.add(m);
      const mh = new THREE.Mesh(hullGeo, hull); mh.visible = false; vmCamera.add(mh);
      this.shells.push({ m, mh, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), active: null });
    }
    this.shellCursor = 0;
    this.attachFlash();
  }

  get def() { return this.current.def; }
  attachFlash() {
    const m = this.current.model;
    m.root.add(this.flash); this.flash.position.copy(m.muzzle);
    this.flashLight.position.copy(m.muzzle);
    m.root.add(this.flashLight);
  }

  select(i) {
    if (i === this.index || this.swap || i < 0 || i >= this.weapons.length) return;
    if (this.reload) this.resetReloadPose();
    this.reload = null; this.melee = null;
    this.swap = { t: 0, to: i, switched: false };
    this.hooks.audio?.play('swap');
  }

  startReload() {
    const w = this.current, d = w.def;
    if (this.reload || this.swap || w.mag >= d.mag || w.reserve <= 0) return;
    const empty = w.mag === 0;
    if (d.pump) {
      this.reload = { t: 0, kind: 'shells', empty, phase: 'start', phaseT: 0, inserted: false };
    } else {
      this.reload = { t: 0, kind: 'mag', empty, dur: empty ? d.reloadEmpty : d.reload, events: new Set() };
    }
    this.adsTarget = 0;
    this.hooks.audio?.play('reloadStart', { weapon: d.id });
  }

  // ------------------------------------------------------------
  update(dt, input, player, camera) {
    this.time += dt;
    this.flashT -= dt;
    const w = this.current, d = w.def, model = w.model;
    const sprinting = player.sprinting && player.grounded;

    // ---- input: swap ----
    if (input.hit('Digit1')) this.select(0);
    if (input.hit('Digit2')) this.select(1);
    if (input.hit('Digit3')) this.select(2);
    if (input.mouse.wheel) this.select((this.index + (input.mouse.wheel > 0 ? 1 : -1) + 3) % 3);
    if (input.hit('KeyR')) this.startReload();
    if (input.hit('KeyV') && !this.melee && !this.swap) {
      this.melee = { t: 0, hit: false };
      if (this.reload && this.reload.kind === 'shells') this.reload = null;
      else if (this.reload && this.reload.t < 0.55) { this.resetReloadPose(); this.reload = null; }
      this.hooks.audio?.play('swing', { gain: 0.8 });
    }

    // ---- ADS ----
    const canAds = !this.swap && !this.melee && !(this.reload && this.reload.kind === 'mag' && this.reload.t < 0.85);
    this.adsTarget = input.mouse.right && canAds ? 1 : 0;
    const adsSpeed = 1 / d.adsTime;
    this.ads = clamp(this.ads + Math.sign(this.adsTarget - this.ads) * adsSpeed * dt, 0, 1);
    const a = easeInOut(this.ads);

    // ---- sprint blend & sprint-out delay ----
    this.sprintBlend = damp(this.sprintBlend, sprinting ? 1 : 0, sprinting ? 9 : 14, dt);
    if (sprinting) this.sprintOut = 0.14; else this.sprintOut = Math.max(0, this.sprintOut - dt);

    // ---- firing ----
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - d.bloomRecover * dt * (this.firing ? 0.3 : 1));
    if (input.mouse.leftPressed) this.buffered = 0.14;
    this.buffered -= dt;
    const trigger = d.auto ? input.mouse.left : this.buffered > 0;
    this.wantsFire = trigger;
    this.firing = false;
    if (trigger && sprinting) this.blockSprint = 0.35;
    this.blockSprint = Math.max(0, (this.blockSprint || 0) - dt);
    if (trigger && !this.swap && !this.melee && this.sprintOut <= 0.0 && this.cooldown <= 0) {
      if (this.reload && d.pump && w.mag > 0) this.reload = null; // shotgun: fire interrupts reload
      if (!this.reload) {
        if (w.mag > 0) { this.fire(player, camera); this.buffered = 0; }
        else if (input.mouse.leftPressed) { this.hooks.audio?.play('dry'); this.cooldown = 0.25; if (w.reserve > 0) this.startReload(); }
      }
    }
    if (this.time - this.lastShot > 0.28) this.shotIndex = 0;
    // aim recoil recovery (only when not shooting)
    if (this.time - this.lastShot > 60 / d.rpm + 0.05) {
      const k = 1 - Math.exp(-d.recoil.recover * dt);
      this.aimRecoil.pitch -= this.aimRecoil.pitch * k; this.aimRecoil.yaw -= this.aimRecoil.yaw * k;
    }

    // ---- reload / swap / pump timelines ----
    const anim = { pos: new THREE.Vector3(), rot: new THREE.Vector3() };
    this.updateReload(dt, anim);
    this.updateSwap(dt, anim);
    this.updateMelee(dt, anim);
    if (d.pump) {
      this.pumpT = Math.min(1, this.pumpT + dt / (60 / d.rpm * 0.85));
      const p = this.pumpT, back = p < 0.2 ? 0 : p < 0.5 ? smooth((p - 0.2) / 0.3) : p < 0.82 ? 1 - smooth((p - 0.5) / 0.32) : 0;
      model.pump.position.z = back * 0.085;
      anim.rot.x += back * 0.05; anim.rot.z += back * 0.06; anim.pos.y -= back * 0.006;
      if (p > 0.2 && !this.pumpBack) { this.pumpBack = true; this.hooks.audio?.play('pumpBack'); }
      if (p > 0.55 && !this.pumpFwd) { this.pumpFwd = true; this.hooks.audio?.play('pumpFwd'); this.ejectShell(true); }
    }

    // ---- sway / inertia ----
    const wgt = d.weight;
    const adsDamp = lerp(1, 0.28, a);
    const mdx = clamp(input.mouse.dx, -120, 120), mdy = clamp(input.mouse.dy, -120, 120);
    this.swayRot.k = 80 / wgt; this.swayRot.d = 11 / Math.sqrt(wgt);
    this.swayRot.target.set(clamp(mdy * 0.0011 * wgt, -0.09, 0.09), clamp(mdx * 0.0013 * wgt, -0.12, 0.12), clamp(mdx * 0.0016 * wgt, -0.14, 0.14)).multiplyScalar(adsDamp);
    // movement lag in camera space
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const lx = player.vel.x * cy - player.vel.z * sy, lz = player.vel.x * sy + player.vel.z * cy;
    this.swayPos.target.set(clamp(-mdx * 0.00007 - lx * 0.0016, -0.03, 0.03), clamp(mdy * 0.00007 - player.vel.y * 0.0012, -0.03, 0.03), clamp(lz * 0.0012, -0.02, 0.02)).multiplyScalar(adsDamp);
    this.swayRot.update(dt); this.swayPos.update(dt);
    if (player.landImpact > 0) { this.land.impulse(0, -0.35 * player.landImpact, 0); this.camKick.impulse(-2.5 * player.landImpact, 0, 0); player.landImpact = 0; }
    this.land.update(dt);

    // ---- bob ----
    const moving = player.grounded ? clamp(player.speed / 5.4, 0, 1.6) : 0;
    this.bobPhase += dt * (player.grounded ? player.speed * 1.55 + 0.001 : 0);
    const bobAmp = moving * lerp(1, 0.12, a) * (player.sliding > 0 ? 0.15 : 1);
    const bp = this.bobPhase;
    const breath = Math.sin(this.time * 1.5) * lerp(1, 0.4, a);

    // ---- compose ----
    const pose = POSES[d.id];
    const pos = new THREE.Vector3().lerpVectors(pose.hip, pose.ads, a);
    const rot = new THREE.Vector3(pose.hipRot.x * (1 - a), pose.hipRot.y * (1 - a), pose.hipRot.z * (1 - a));
    pos.x += Math.sin(bp) * 0.012 * bobAmp; pos.y += (Math.cos(bp * 2) * 0.007 - 0.004) * bobAmp + breath * 0.0012;
    rot.z += Math.sin(bp) * 0.018 * bobAmp; rot.x += Math.cos(bp * 2) * 0.01 * bobAmp + breath * 0.004;
    // sprint pose: rifle canted across the chest
    const s = smooth(this.sprintBlend);
    pos.add(new THREE.Vector3(0.0, -0.065, 0.045).multiplyScalar(s));
    rot.x += -0.32 * s; rot.y += 0.62 * s; rot.z += 0.42 * s;
    pos.x += Math.sin(bp) * 0.02 * s; pos.y += Math.abs(Math.sin(bp)) * 0.014 * s;
    // crouch dip + slide tilt
    if (player.crouching) { pos.y -= 0.008 * (1 - a); rot.z += player.sliding > 0 ? 0.25 : 0.04 * (1 - a); }
    pos.add(this.swayPos.value).add(this.land.value);
    rot.x += this.swayRot.value.x; rot.y += this.swayRot.value.y; rot.z += this.swayRot.value.z;
    const kp = this.posKick.update(dt), kr = this.rotKick.update(dt);
    pos.add(kp); rot.x += kr.x * lerp(1, 0.35, a); rot.y += kr.y * lerp(1, 0.4, a); rot.z += kr.z * lerp(1, 0.5, a);
    pos.add(anim.pos); rot.add(anim.rot);
    if (this.dbgPose) { pos.add(this.dbgPose.p); rot.add(this.dbgPose.r); }
    this.root.position.copy(pos);
    this.root.rotation.set(rot.x, rot.y, rot.z, 'YXZ');
    this.camKick.update(dt);

    // red dot axis in view space = bore direction
    if (d.sight === 'reddot') {
      this.root.updateMatrixWorld();
      const axis = new THREE.Vector3(0, 0, -1).transformDirection(this.root.matrix);
      this.redDot.uniforms.axis.value.copy(axis);
    }

    // muzzle flash (decayed at the start of the frame so it always shows for >= 1 frame)
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = Math.max(0, this.flashT / 0.05) * (d.id === 'sg' ? 1.3 : 3.5);
    this.updateShells(dt);

    // current spread (degrees) for the crosshair and shooting
    const moveSp = clamp(player.speed / 5.4, 0, 1.5) * d.moveSpread + (player.grounded ? 0 : 2.5);
    const hip = d.hipSpread * (1 + this.bloom) + moveSp + (player.crouching ? -0.4 : 0);
    this.spreadNow = lerp(Math.max(0.3, hip), d.adsSpread + this.bloom * 0.12 + moveSp * 0.15, a);
    return a;
  }

  fire(player, camera) {
    const w = this.current, d = w.def;
    w.mag--; this.cooldown = 60 / d.rpm; this.lastShot = this.time; this.firing = true;
    const a = easeInOut(this.ads);
    // hitscan pellets
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const spreadRad = Math.tan(this.spreadNow * DEG * 0.5);
    for (let p = 0; p < d.pellets; p++) {
      // shotgun uses a fixed-ish ring pattern + jitter so spread is readable; rifles use uniform disc
      let ox, oy;
      if (d.pellets > 1) {
        const ang = (p / d.pellets) * Math.PI * 2 + rand(-0.3, 0.3), rr = p === 0 ? 0.1 : rand(0.45, 1);
        ox = Math.cos(ang) * rr; oy = Math.sin(ang) * rr;
      } else { const ang = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()); ox = Math.cos(ang) * rr; oy = Math.sin(ang) * rr; }
      const dir = fwd.clone().addScaledVector(right, ox * spreadRad).addScaledVector(up, oy * spreadRad).normalize();
      this.hooks.shoot(origin, dir, d, p === 0);
    }
    this.bloom = Math.min(d.bloomMax, this.bloom + d.bloomPerShot);

    // aim recoil (moves your aim; recovers when you stop)
    const R = d.recoil, i = this.shotIndex++;
    const adsM = lerp(1, R.adsMult, a), crouchM = player.crouching ? 0.85 : 1;
    const up_ = Math.min(R.upMax, R.up + R.upRamp * i) * adsM * crouchM * rand(0.9, 1.1);
    const side = (R.pattern[i % R.pattern.length] + rand(-R.side, R.side)) * adsM * crouchM;
    this.aimRecoil.pitch += up_ * DEG; this.aimRecoil.yaw += side * DEG;

    // view-model kick: spring impulses (position back/up, rotation up with random yaw/roll)
    const K = d.kick, km = lerp(1, 0.55, a);
    this.posKick.impulse(rand(-0.15, 0.15) * K.up, K.up * 9 * km, K.back * 22 * lerp(1, 0.75, a));
    this.rotKick.impulse(K.pitch * 22 * km, randSign() * K.yaw * 22 * km, randSign() * K.roll * 22 * km);
    // visual camera layer (doesn't change aim)
    this.camKick.impulse(K.cam * rand(0.8, 1.2) * lerp(1, 0.6, a), rand(-1, 1) * K.cam * 0.4, rand(-1, 1) * K.cam * 0.6);

    this.flashT = 0.05; this.flash.rotation.z = rand(0, Math.PI * 2);
    this.flash.scale.setScalar(rand(0.8, 1.25) * (d.id === 'sg' ? 1.35 : d.id === 'mr' ? 1.1 : 1) * lerp(1, 0.7, a));
    this.flashFront.rotation.z = rand(0, 6.28);
    // world-space muzzle position for tracers + light
    const m = w.model;
    this.root.updateMatrixWorld(true);
    const mw = m.muzzle.clone().applyMatrix4(m.root.matrixWorld);
    this.hooks.muzzleWorld?.(mw, d);
    this.hooks.audio?.play('shot', { weapon: d });
    if (d.pump) { this.pumpT = 0; this.pumpBack = false; this.pumpFwd = false; }
    else { this.ejectShell(false); }
    this.hooks.onFire?.(d);
  }

  muzzleWorld() {
    const m = this.current.model; this.root.updateMatrixWorld(true);
    return m.muzzle.clone().applyMatrix4(m.root.matrixWorld);
  }

  ejectShell(hull) {
    const m = this.current.model;
    const s = this.shells[this.shellCursor++ % this.shells.length];
    if (s.active) s.active.visible = false;
    const mesh = hull ? s.mh : s.m;
    s.active = mesh; mesh.visible = true;
    this.root.updateMatrixWorld(true);
    mesh.position.copy(m.eject).applyMatrix4(m.root.matrix); // root is a child of the vm camera
    mesh.position.applyMatrix4(this.root.matrix);
    mesh.position.copy(m.eject.clone().applyMatrix4(m.root.matrixWorld));
    // velocity: out to the right, up and slightly back
    s.vel.set(rand(1.1, 1.6), rand(0.9, 1.4), rand(0.1, 0.5));
    s.spin.set(rand(-25, 25), rand(-25, 25), rand(-30, 30));
    s.life = 0.9;
    mesh.rotation.set(0, rand(0, 1), 0);
  }
  updateShells(dt) {
    for (const s of this.shells) {
      if (!s.active || s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 9 * dt;
      s.active.position.addScaledVector(s.vel, dt);
      s.active.rotation.x += s.spin.x * dt; s.active.rotation.y += s.spin.y * dt; s.active.rotation.z += s.spin.z * dt;
      if (s.life <= 0) { s.active.visible = false; if (s.active === s.m) this.hooks.audio?.play('tink'); }
    }
  }

  resetReloadPose() {
    const m = this.current.model;
    if (m.magHome) { m.mag.position.copy(m.magHome); m.mag.rotation.x = this.current.def.id === 'mr' ? 0.03 : 0; m.mag.visible = true; }
    if (m.bolt) m.bolt.position.z = 0;
    m.leftHand.position.copy(m.leftHome); m.leftHand.rotation.set(0, 0, 0);
    if (m.shell) m.shell.visible = false;
  }
  updateReload(dt, anim) {
    const r = this.reload; if (!r) return;
    const w = this.current, d = w.def, m = w.model;
    if (r.kind === 'mag') {
      r.t += dt / r.dur;
      if (this.freezeT !== undefined) r.t = this.freezeT;
      const t = r.t, ev = (name, at, fn) => { if (t >= at && !r.events.has(name)) { r.events.add(name); fn(); } };
      const E = r.empty;
      // whole-gun choreography: cant toward the camera, roll back for the charging handle
      // raise the gun and turn its left side (magwell) toward the eye
      const tilt = (this.dbgPose ? 0 : 1) * smooth(clamp(t / 0.1, 0, 1)) * (1 - smooth(clamp((t - (E ? 0.86 : 0.74)) / 0.13, 0, 1)));
      anim.rot.z -= 0.6 * tilt; anim.rot.x += 0.12 * tilt; anim.rot.y += 0.05 * tilt;
      anim.pos.y += 0.05 * tilt; anim.pos.x -= 0.05 * tilt;
      if (E) { const c = smooth(clamp((t - 0.64) / 0.06, 0, 1)) * (1 - smooth(clamp((t - 0.82) / 0.08, 0, 1))); anim.rot.z += 0.3 * c; anim.rot.y -= 0.2 * c; anim.rot.x -= 0.12 * c; anim.pos.y -= 0.01 * c; }
      // magazine path (offset from its seated position)
      const magKeys = [[0, 0, 0, 0], [0.13, 0, 0, 0], [0.17, 0, -0.012, 0.002], [0.3, 0, -0.24, 0.16], [0.38, 0, -0.3, 0.2], [0.53, 0, -0.05, 0.012], [0.6, 0, 0, 0]];
      const mo = track(magKeys, t, new THREE.Vector3());
      m.mag.position.copy(m.magHome).add(mo);
      m.mag.rotation.x = (d.id === 'mr' ? 0.03 : 0) + track([[0, 0, 0, 0], [0.17, 0, 0, 0], [0.3, -0.7, 0, 0], [0.38, -0.55, 0, 0], [0.53, -0.1, 0, 0], [0.6, 0, 0, 0]], t).x;
      m.mag.visible = t < 0.3 || t >= 0.38;
      // left hand: grab the mag, strip it, fetch a new one, seat + slap, (empty) rack the charging handle
      const home = m.leftHome, grab = m.points.magBottom.clone().add(new THREE.Vector3(-0.016, 0.04, 0.004)).sub(home);
      let hand;
      if (t < 0.13) hand = grab.clone().multiplyScalar(smooth(t / 0.13));
      else if (t < 0.6) hand = grab.clone().add(mo);
      else if (t < 0.64) hand = grab.clone().add(new THREE.Vector3(0, 0.012 * Math.sin(((t - 0.6) / 0.04) * Math.PI), 0));
      else if (E) {
        const ch = m.points.charge.clone().sub(home);
        hand = track([k3(0.64, grab), k3(0.71, ch), k3(0.74, ch), k3(0.79, ch.clone().add(new THREE.Vector3(0, 0, 0.055))), k3(0.82, ch.clone().add(new THREE.Vector3(0, -0.02, 0.06))), [0.95, 0, 0, 0]], t, new THREE.Vector3());
      } else hand = track([k3(0.64, grab), [0.8, 0, 0, 0]], t, new THREE.Vector3());
      m.leftHand.position.copy(home).add(hand);
      const gr = t < 0.13 ? smooth(t / 0.13) : t < 0.64 ? 1 : E ? 0 : 1 - smooth(clamp((t - 0.64) / 0.16, 0, 1));
      const cr = E ? smooth(clamp((t - 0.64) / 0.07, 0, 1)) * (1 - smooth(clamp((t - 0.82) / 0.13, 0, 1))) : 0;
      const CR = m.points.chargeRot;
      m.leftHand.rotation.set(0.25 * gr + CR.x * cr, 0.1 * gr + CR.y * cr, -0.45 * gr + CR.z * cr);
      if (E) m.bolt.position.z = track([[0.74, 0, 0, 0], [0.79, 0.055, 0, 0], [0.8, 0.055, 0, 0], [0.812, 0, 0, 0]], t).x;
      ev('out', 0.17, () => { this.hooks.audio?.play('magOut'); this.rotKick.impulse(0.3, 0, -0.4); });
      ev('in', 0.6, () => {
        this.hooks.audio?.play('magIn'); this.posKick.impulse(0, 0.32, 0); this.rotKick.impulse(-1.0, 0, -0.7);
        const take = Math.min(d.mag - w.mag, w.reserve); w.mag += take; w.reserve -= take; this.hooks.onAmmo?.();
      });
      if (E) {
        ev('pull', 0.75, () => this.hooks.audio?.play('pumpBack'));
        ev('bolt', 0.8, () => { this.hooks.audio?.play('bolt'); this.rotKick.impulse(1.4, 0.3, 0.6); this.posKick.impulse(0, 0.12, 0.45); });
      }
      if (t >= 1) { this.reload = null; this.resetReloadPose(); }
    } else {
      // shotgun: tilt in, one shell per cycle (hand: caddy -> under the loading port -> thumb it in), tilt out
      r.phaseT += dt;
      if (this.freezeK !== undefined) { r.phase = 'shell'; r.phaseT = this.freezeK * d.reloadShell; r.inserted = true; }
      const tilt = (this.dbgPose ? 0 : 1) * (r.phase === 'start' ? smooth(clamp(r.phaseT / d.reloadStart, 0, 1)) : r.phase === 'end' ? 1 - smooth(clamp(r.phaseT / d.reloadEnd, 0, 1)) : 1);
      anim.rot.z -= 0.8 * tilt; anim.rot.x += 0.1 * tilt; anim.rot.y += 0.05 * tilt; anim.pos.y += 0.05 * tilt; anim.pos.x -= 0.05 * tilt;
      const lh = m.leftHand, home = m.leftHome, shell = m.shell;
      const caddy = m.points.caddy.clone().sub(home), port = m.points.port.clone().add(new THREE.Vector3(0.0, 0.0, 0.035)).sub(home);
      const below = port.clone().add(new THREE.Vector3(0.01, -0.045, 0.02)), pushed = port.clone().add(new THREE.Vector3(0, 0.008, -0.01));
      const rot = new THREE.Vector3(0.3, 0.0, -0.75);
      let hand, rk = 1;
      if (r.phase === 'start') { const k = clamp(r.phaseT / d.reloadStart, 0, 1); hand = caddy.clone().multiplyScalar(smooth(k)); rk = smooth(k); shell.visible = false; }
      else if (r.phase === 'shell') {
        const k = clamp(r.phaseT / d.reloadShell, 0, 1);
        hand = track([k3(0, caddy), k3(0.35, below), k3(0.58, port), k3(0.7, pushed), k3(1, caddy)], k, new THREE.Vector3());
        shell.visible = k > 0.04 && k < 0.7;
        // shell rides between thumb and fingers, then slides up and forward into the tube
        const ins = smooth(clamp((k - 0.58) / 0.12, 0, 1));
        shell.position.copy(m.pump.position).add(home).add(hand).add(new THREE.Vector3(-0.004, 0.03 + 0.006 * ins, -0.03 - 0.03 * ins));
        shell.rotation.set(0.08 * (1 - ins), 0, 0);
        if (k > 0.66 && !r.inserted) {
          r.inserted = true; w.mag++; w.reserve--; this.hooks.onAmmo?.();
          this.hooks.audio?.play('shellIn'); this.posKick.impulse(0, 0.14, 0.12); this.rotKick.impulse(-0.5, 0, -0.35);
        }
        if (k >= 1) {
          r.phaseT = 0; r.inserted = false;
          if (w.mag >= d.mag || w.reserve <= 0) { r.phase = 'end'; shell.visible = false; }
        }
      } else { const k = clamp(r.phaseT / d.reloadEnd, 0, 1); hand = caddy.clone().multiplyScalar(1 - smooth(k)); rk = 1 - smooth(k); }
      lh.position.copy(home).add(hand);
      lh.rotation.set(rot.x * rk, rot.y * rk, rot.z * rk);
      if (r.phase === 'start' && r.phaseT >= d.reloadStart) { r.phase = 'shell'; r.phaseT = 0; }
      if (r.phase === 'end' && r.phaseT >= d.reloadEnd) {
        this.reload = null; this.resetReloadPose();
        if (r.empty) { this.pumpT = 0; this.pumpBack = false; this.pumpFwd = true; }
      }
    }
  }

  // quick melee: rifle-butt/side swing across the screen; damage is dealt by hooks.melee at the strike frame
  updateMelee(dt, anim) {
    const me = this.melee; if (!me) return;
    me.t += dt;
    const t = me.t;
    const p = track([[0, 0, 0, 0], [0.09, 0.045, 0.012, 0.05], [0.19, -0.14, 0.035, -0.11], [0.26, -0.13, 0.03, -0.1], [0.55, 0, 0, 0]], t, new THREE.Vector3());
    const r = track([[0, 0, 0, 0], [0.09, 0.05, -0.3, -0.2], [0.19, -0.16, 0.8, 0.5], [0.26, -0.14, 0.75, 0.45], [0.55, 0, 0, 0]], t, new THREE.Vector3());
    anim.pos.add(p); anim.rot.add(r);
    if (!me.kicked && t > 0.1) { me.kicked = true; this.camKick.impulse(-1.2, 4.5, 5); }
    if (!me.hit && t > 0.16) { me.hit = true; this.hooks.melee?.(); }
    if (t > 0.55) this.melee = null;
  }

  updateSwap(dt, anim) {
    const s = this.swap; if (!s) return;
    s.t += dt;
    const lower = 0.17, raise = 0.3;
    if (s.t < lower) { const k = smooth(s.t / lower); anim.pos.y -= 0.2 * k; anim.rot.x -= 0.7 * k; anim.rot.z += 0.2 * k; }
    else {
      if (!s.switched) {
        s.switched = true;
        this.current.model.root.visible = false;
        this.index = s.to; this.current = this.weapons[s.to];
        this.current.model.root.visible = true;
        this.current.model.leftHand.position.copy(this.current.model.leftHome);
        this.attachFlash(); this.shotIndex = 0; this.bloom = 0; this.ads = 0;
        this.hooks.onSwap?.(this.current.def); this.hooks.audio?.play('raise');
      }
      const k = 1 - smooth(clamp((s.t - lower) / raise, 0, 1));
      anim.pos.y -= 0.2 * k; anim.rot.x -= 0.7 * k; anim.rot.z += 0.2 * k;
      if (s.t >= lower + raise) { this.swap = null; this.rotKick.impulse(0.6, 0, 0.3); }
    }
  }

  refill() { for (const w of this.weapons) w.reserve = w.def.reserve; this.hooks.onAmmo?.(); }
  resetAll() { for (const w of this.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve; } if (this.reload) this.resetReloadPose(); this.reload = null; this.melee = null; this.aimRecoil.pitch = this.aimRecoil.yaw = 0; }
}
