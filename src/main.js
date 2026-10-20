import * as THREE from 'three';
import './style.css';
import { Input } from './core/input.js';
import { clamp, lerp, damp, rand, rayAABB } from './core/util.js';
import { buildArena } from './world/arena.js';
import { makeSky, SUN_DIR } from './world/sky.js';
import { Player } from './player.js';
import { Arsenal } from './weapons/arsenal.js';
import { Audio } from './audio.js';
import { Effects } from './fx/effects.js';
import { Post } from './post.js';
import { Horde } from './enemies.js';

const DEG = Math.PI / 180;
const HIP_FOV = 70, VM_HIP_FOV = 54;
const QUALITY = {
  low: { pr: 0.7, shadow: 1024 },
  medium: { pr: 1, shadow: 2048 },
  high: { pr: Math.min(devicePixelRatio, 1.5), shadow: 2048 },
};
const $ = (id) => document.getElementById(id);

class Game {
  constructor() {
    this.quality = localStorage.getItem('hf-q') || 'medium';
    this.state = 'menu'; // menu | play | paused | dead
    const canvas = $('game');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;

    // ---------- world ----------
    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.27, 0.2, 0.24, THREE.LinearSRGBColorSpace), 0.0115);
    this.sky = makeSky(); scene.add(this.sky);
    const pm = new THREE.PMREMGenerator(r);
    const skyScene = new THREE.Scene(); const skyCopy = makeSky(); skyScene.add(skyCopy);
    this.env = pm.fromScene(skyScene, 0.03).texture;
    scene.environment = this.env; scene.environmentIntensity = 0.55;

    const sun = (this.sun = new THREE.DirectionalLight('#ffb27e', 3.4));
    sun.position.copy(SUN_DIR).multiplyScalar(70); sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 170;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
    sun.shadow.mapSize.setScalar(QUALITY[this.quality].shadow);
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight('#7f78a8', '#3b2a22', 1.1));

    this.camera = new THREE.PerspectiveCamera(HIP_FOV, innerWidth / innerHeight, 0.05, 600);
    this.aim = new THREE.Object3D(); this.aim.rotation.order = 'YXZ';
    this.camera.rotation.order = 'YXZ';

    // ---------- viewmodel (own scene so the gun never clips into walls) ----------
    this.vmScene = new THREE.Scene();
    this.vmScene.environment = this.env; this.vmScene.environmentIntensity = 0.7;
    this.vmCamera = new THREE.PerspectiveCamera(VM_HIP_FOV, innerWidth / innerHeight, 0.01, 10);
    this.vmScene.add(this.vmCamera);
    this.vmSun = new THREE.DirectionalLight('#ffb27e', 2.6); this.vmScene.add(this.vmSun, this.vmSun.target);
    this.vmHemi = new THREE.HemisphereLight('#8a80b0', '#3b2a22', 1.2); this.vmScene.add(this.vmHemi);
    this.vmLocal = new THREE.PointLight('#ff8a3a', 0, 4, 2); this.vmScene.add(this.vmLocal);

    this.arena = buildArena(scene, this.quality);
    this.player = new Player(this.arena.colliders);
    this.fx = new Effects(scene, this.quality);
    this.audio = new Audio();
    this.input = new Input(canvas);
    this.input.onLockChange = (l) => this.onLock(l);

    this.player.onStep = (sprint, crouch) => this.audio.play('step', { sprint, crouch });
    this.player.onLand = (k) => { this.audio.play('land', { k }); this.shake(0.15 * k); };
    this.player.onJump = () => this.audio.play('jump');
    this.player.onSlide = () => { this.audio.play('slide'); this.shake(0.08); };

    this.arsenal = new Arsenal(this.vmCamera, {
      audio: this.audio,
      shoot: (o, d, def, first) => this.shoot(o, d, def, first),
      muzzleWorld: () => { this.fx.muzzle(this.muzzleNow); this.flushPellets(); },
      onFire: (def) => { this.crossKick = 1; this.shake(def.id === 'sg' ? 0.16 : def.id === 'mr' ? 0.11 : 0.025); this.horde.alert(this.player.pos); },
      onAmmo: () => (this.hudDirty = true),
      onSwap: () => (this.hudDirty = true),
    });

    this.horde = new Horde(scene, this.arena, {
      player: this.player, fx: this.fx, audio: this.audio,
      onPlayerHit: (dmg, from, e) => this.onPlayerHit(dmg, from, e),
      onKill: (e, info) => this.onKill(e, info),
      onWaveStart: (n, count) => this.banner(`WAVE ${n}`, `${count} hostiles inbound`),
      onWaveEnd: (n) => { this.arsenal.refill(); this.banner(`WAVE ${n} CLEARED`, 'Ammo restocked'); this.audio.play('waveEnd'); this.score += 250 * n; },
    });

    this.post = new Post(r, scene, this.camera, this.vmScene, this.vmCamera);
    this.applyQuality(this.quality);

    this.timer = new THREE.Timer(); this.timer.connect?.(document);
    this.time = 0; this.trauma = 0; this.hitstop = 0; this.damageFx = 0; this.crossKick = 0;
    this.score = 0; this.kills = 0; this.headshots = 0; this.shotsFired = 0; this.shotsHit = 0;
    this.muzzleNow = new THREE.Vector3(); this.hudDirty = true;
    this.dmgNums = []; this.pelletAcc = new Map(); this.deadT = 0; this.fps = 60;
    this.tmpN = new THREE.Vector3();

    this.initUI();
    this.onResize(); addEventListener('resize', () => this.onResize());
    this.player.reset();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------------------ UI
  initUI() {
    $('deploy').onclick = () => this.start();
    $('resume').onclick = () => { this.input.lock(); };
    $('restart').onclick = () => this.restart();
    $('restart2').onclick = () => this.restart();
    document.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => this.applyQuality(b.dataset.q)));
    const sens = $('sens'); sens.value = this.input.sensitivity;
    sens.oninput = () => { this.input.sensitivity = parseFloat(sens.value); localStorage.setItem('hf-sens', sens.value); $('sensv').textContent = (+sens.value).toFixed(2); };
    $('sensv').textContent = this.input.sensitivity.toFixed(2);
    const vol = $('vol'); vol.value = this.audio.volume;
    vol.oninput = () => this.audio.setVolume(parseFloat(vol.value));
    this.dmgNumsOn = localStorage.getItem('hf-dn') !== '0';
    const dn = $('dmgnums'); dn.checked = this.dmgNumsOn; dn.onchange = () => { this.dmgNumsOn = dn.checked; localStorage.setItem('hf-dn', dn.checked ? '1' : '0'); };
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && this.state === 'play') document.exitPointerLock();
    });
    const pool = $('dmgnums-layer');
    for (let i = 0; i < 28; i++) { const d = document.createElement('div'); d.className = 'dn'; pool.appendChild(d); this.dmgNums.push({ el: d, life: 0, pos: new THREE.Vector3() }); }
    this.show('menu');
  }
  show(screen) {
    for (const id of ['menu', 'pause', 'dead']) $(id).classList.toggle('on', id === screen);
    document.body.classList.toggle('playing', screen === null);
  }
  applyQuality(q) {
    this.quality = q; localStorage.setItem('hf-q', q);
    document.querySelectorAll('[data-q]').forEach((b) => b.classList.toggle('sel', b.dataset.q === q));
    const Q = QUALITY[q];
    this.renderer.setPixelRatio(Q.pr);
    this.post.composer.setPixelRatio(Q.pr);
    this.post.setQuality(q);
    if (this.sun.shadow.mapSize.x !== Q.shadow) { this.sun.shadow.mapSize.setScalar(Q.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.onResize();
  }
  onResize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.post?.setSize(w, h);
    this.camera.aspect = this.vmCamera.aspect = w / h;
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
  }
  start() {
    this.audio.init();
    this.input.lock();
    if (this.state === 'menu') { this.restart(true); }
  }
  restart(fromMenu) {
    this.audio.init();
    this.player.reset(); this.arsenal.resetAll(); this.horde.reset(); this.fx.clear();
    this.score = 0; this.kills = 0; this.headshots = 0; this.shotsFired = 0; this.shotsHit = 0; this.deadT = 0;
    this.damageFx = 0; this.hudDirty = true;
    this.horde.start();
    this.state = 'play';
    if (!fromMenu) this.input.lock();
    if (this.input.locked || this.forceLock) this.show(null);
  }
  onLock(locked) {
    if (locked) {
      if (this.state === 'paused' || this.state === 'play') { this.state = 'play'; this.show(null); }
    } else if (this.state === 'play') { this.state = 'paused'; this.show('pause'); }
  }
  banner(title, sub) {
    const b = $('banner'); $('banner-t').textContent = title; $('banner-s').textContent = sub;
    b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
    if (title.startsWith('WAVE') && !title.includes('CLEARED')) this.audio.play('waveStart');
  }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }

  // ------------------------------------------------------------ combat
  vmToWorld(p, out) {
    const ndc = p.clone().project(this.vmCamera);
    const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    return out.copy(this.camera.position).addScaledVector(dir, p.length());
  }
  raycastWorld(o, d, maxT, outN) {
    let best = maxT, hit = null; const n = new THREE.Vector3();
    for (const c of this.arena.colliders) {
      const t = rayAABB(o.x, o.y, o.z, d.x, d.y, d.z, c, best, n);
      if (t >= 0 && t < best) { best = t; hit = c; outN.copy(n); }
    }
    return hit ? { t: best, c: hit } : null;
  }
  shoot(origin, dir, def, first) {
    if (first) { this.vmToWorld(this.arsenal.muzzleWorld(), this.muzzleNow); this.shotsFired++; }
    this.pelletMode = def.pellets > 1;
    if (first) this.pelletSounded = false;
    const n = this.tmpN;
    const wh = this.raycastWorld(origin, dir, 300, n);
    const wallT = wh ? wh.t : 300;
    const hits = this.horde.raycast(origin, dir, wallT);
    let pierce = def.pierce || 0, endT = wallT, hitAny = false;
    for (const h of hits) {
      const fall = clamp((h.t - def.falloffStart) / (def.falloffEnd - def.falloffStart), 0, 1);
      let dmg = lerp(def.damage, def.damageMin, fall);
      dmg *= h.part === 'head' ? def.headMult : h.part === 'limb' ? def.limbMult : 1;
      if (hitAny) dmg *= 0.7; // pierced
      const res = this.horde.damage(h.e, dmg, h.part, h.point, dir, def);
      this.onHit(h, dmg, res);
      hitAny = true;
      if (pierce-- <= 0) { endT = h.t; break; }
    }
    if (endT === wallT && wh) {
      const p = origin.clone().addScaledVector(dir, wallT);
      this.fx.impact(p, n.clone(), wh.c.mat);
      if (Math.random() < (def.pellets > 1 ? 0.25 : 1)) {
        const dist = p.distanceTo(this.player.pos);
        this.audio.play('impact', { mat: wh.c.mat, gain: clamp(6 / (dist + 2), 0.15, 1) });
      }
    }
    if (hitAny) this.shotsHit++;
    const tracer = def.pellets > 1 ? Math.random() < def.tracerChance : first && Math.random() < def.tracerChance;
    if (tracer) {
      const end = origin.clone().addScaledVector(dir, Math.min(endT, 250));
      // begin a bit ahead of the muzzle so it doesn't cover the sights
      const from = this.muzzleNow.clone().addScaledVector(dir, 1.2);
      if (end.distanceTo(from) > 2) this.fx.tracers.add(from, end, def.id === 'mr' ? 520 : 400, def.id === 'mr' ? 10 : 6, def.id === 'mr' ? 0.03 : 0.02);
    }
  }
  onHit(h, dmg, res) {
    const head = h.part === 'head';
    const mk = $('hitmarker');
    mk.className = ''; void mk.offsetWidth;
    mk.className = res.killed ? 'kill' : head ? 'head' : 'hit';
    if (!res.killed && !(this.pelletMode && this.pelletSounded)) { this.audio.play(head ? 'headshot' : 'hit'); this.pelletSounded = this.pelletMode; }
    if (!this.dmgNumsOn) return;
    if (this.pelletMode) { // shotgun: one number per target per shot
      const a = this.pelletAcc.get(h.e) || { dmg: 0, point: h.point, head: false, killed: false };
      a.dmg += dmg; a.head ||= head; a.killed ||= res.killed; this.pelletAcc.set(h.e, a);
    } else this.damageNumber(h.point, Math.round(dmg), head, res.killed);
  }
  flushPellets() {
    for (const a of this.pelletAcc.values()) this.damageNumber(a.point, Math.round(a.dmg), a.head, a.killed);
    this.pelletAcc.clear();
  }
  onKill(e, info) {
    this.kills++; if (info.head) this.headshots++;
    const pts = (e.type.points + (info.head ? 50 : 0)) * (1 + Math.floor((this.horde.wave - 1) / 3) * 0.5);
    this.score += Math.round(pts);
    this.audio.play('kill'); if (info.head) this.audio.play('headshot');
    this.hitstop = e.type.brute ? 0.07 : 0.035;
    this.shake(e.type.brute ? 0.2 : 0.06);
    this.feed(`${info.head ? '<b>HEADSHOT</b> ' : ''}${e.type.name}`, Math.round(pts));
    this.hudDirty = true;
  }
  feed(text, pts) {
    const f = $('feed'); const d = document.createElement('div'); d.className = 'fe';
    d.innerHTML = `<span>+${pts}</span> ${text}`;
    f.prepend(d); setTimeout(() => d.remove(), 2400);
    while (f.children.length > 5) f.lastChild.remove();
  }
  damageNumber(p, v, head, kill) {
    const s = this.dmgNums.find((x) => x.life <= 0) || this.dmgNums[0];
    s.life = 0.8; s.pos.copy(p).add(new THREE.Vector3(rand(-0.15, 0.15), 0.1, rand(-0.15, 0.15)));
    s.el.textContent = v; s.el.className = 'dn on' + (head ? ' head' : '') + (kill ? ' kill' : '');
  }
  onPlayerHit(dmg, from, e) {
    if (!this.player.alive) return;
    this.player.hurt(dmg);
    this.damageFx = Math.min(1, this.damageFx + dmg / 35);
    this.audio.play('hurt');
    this.shake(0.25 + dmg / 80);
    this.arsenal.camKick.impulse(rand(-6, 6), rand(-8, 8), rand(-10, 10));
    // knockback from brutes
    const away = this.player.pos.clone().sub(from); away.y = 0; away.normalize();
    this.player.vel.addScaledVector(away, e.type.brute ? 9 : 2.5);
    if (e.type.brute) this.player.vel.y = Math.max(this.player.vel.y, 3);
    // directional indicator
    const ang = Math.atan2(away.x, away.z) - this.player.yaw;
    const di = $('dmgdir'); di.style.transform = `translate(-50%,-50%) rotate(${-ang + Math.PI}rad)`;
    di.classList.remove('on'); void di.offsetWidth; di.classList.add('on');
    if (!this.player.alive) this.onDeath();
  }
  onDeath() {
    this.state = 'dead'; this.deadT = 0;
    const best = Math.max(+localStorage.getItem('hf-best') || 0, this.score); localStorage.setItem('hf-best', best);
    $('d-wave').textContent = this.horde.wave; $('d-kills').textContent = this.kills; $('d-heads').textContent = this.headshots;
    $('d-score').textContent = this.score; $('d-best').textContent = best;
    $('d-acc').textContent = this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) + '%' : '—';
    setTimeout(() => { if (this.state === 'dead') { document.exitPointerLock?.(); this.show('dead'); } }, 1600);
  }

  // ------------------------------------------------------------ frame
  frame() {
    const t0 = performance.now();
    this.timer.update();
    const raw = Math.min(this.timer.getDelta(), 0.05);
    this.fps = lerp(this.fps, 1 / Math.max(raw, 1e-3), 0.05);
    const input = this.input, p = this.player, A = this.arsenal;
    const active = this.state === 'play' || this.state === 'dead';
    let dt = active ? raw : 0;
    this.time += dt;

    // hitstop slows the world (not your view) for a few frames on kills
    let worldDt = dt;
    if (this.hitstop > 0) { this.hitstop -= raw; worldDt = dt * 0.12; }

    let ads = 0;
    if (this.state === 'play') {
      const d = A.def;
      const fovNow = this.camera.fov;
      p.update(dt, input, { lookScale: Math.tan((fovNow * DEG) / 2) / Math.tan((HIP_FOV * DEG) / 2), ads: A.ads > 0.5, blockSprint: A.blockSprint > 0 || A.reload?.kind === 'never', weightSpeed: 1 - (d.weight - 1) * 0.12 });
      this.placeCamera(0);
      ads = A.update(dt, input, p, this.aim);
      this.adsNow = ads;
    } else if (this.state === 'dead') {
      this.deadT += dt;
      p.eyeSmooth = damp(p.eyeSmooth, 0.35, 3, dt);
      p.camTilt = damp(p.camTilt, 0.5, 2, dt);
      A.root.position.y = damp(A.root.position.y, -0.6, 3, dt);
    }
    // FOV: ADS zoom + sprint/slide punch
    const d = A.def;
    const sprintF = p.sprinting && p.grounded ? 5 : 0, slideF = p.sliding > 0 ? 8 : 0;
    const targetFov = lerp(HIP_FOV + sprintF + slideF, d.adsFov, ads);
    if (this.state === 'play') this.camera.fov = damp(this.camera.fov, targetFov, ads > 0 && ads < 1 ? 40 : 14, dt);
    this.vmCamera.fov = lerp(VM_HIP_FOV, d.vmAdsFov, ads);
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
    this.placeCamera(dt);

    if (active) {
      this.horde.update(worldDt, this.time, this.camera);
      this.fx.update(worldDt, this.camera, this.time);
    }
    // lights
    for (const L of this.arena.lights) L.light.intensity = L.base * (1 - L.flicker + L.flicker * (0.6 + 0.4 * Math.sin(this.time * 17 + L.base) * Math.sin(this.time * 7.3 + L.base * 3)));
    this.sky.material.uniforms.time.value = this.time;
    this.updateViewmodelLights();

    // post uniforms
    this.damageFx = Math.max(0, this.damageFx - dt * 1.4);
    const u = this.post.u;
    u.time.value = this.time; u.damage.value = this.damageFx; u.ads.value = ads;
    u.lowHealth.value = p.alive ? clamp((45 - p.health) / 45, 0, 1) : 1;
    u.dead.value = this.state === 'dead' ? clamp(this.deadT / 1.5, 0, 1) : 0;
    u.flash.value = Math.max(0, A.flashT / 0.05);

    this.updateHUD(raw, ads);
    this.cpuMs = lerp(this.cpuMs || 0, performance.now() - t0, 0.1);
    this.post.render();
    input.endFrame();
  }
  placeCamera(dt) {
    const p = this.player, A = this.arsenal;
    const eye = new THREE.Vector3(p.pos.x, p.pos.y + p.eyeSmooth, p.pos.z);
    this.aim.position.copy(eye);
    this.aim.rotation.set(clamp(p.pitch + A.aimRecoil.pitch, -1.55, 1.55), p.yaw + A.aimRecoil.yaw, 0, 'YXZ');
    this.aim.updateMatrixWorld();
    // visual layers: camera kick spring + trauma shake + strafe/slide tilt
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma, t = this.time * 32;
    const k = A.camKick.value;
    this.camera.position.copy(eye);
    this.camera.rotation.set(
      this.aim.rotation.x + k.x * DEG + Math.sin(t * 1.1) * s * 1.6 * DEG,
      this.aim.rotation.y + k.y * DEG + Math.sin(t * 0.9 + 1.3) * s * 1.6 * DEG,
      k.z * DEG + p.camTilt + Math.sin(t * 1.3 + 2.1) * s * 2.2 * DEG, 'YXZ');
    this.camera.updateMatrixWorld();
  }
  updateViewmodelLights() {
    const inv = this.camera.matrixWorldInverse;
    const sd = SUN_DIR.clone().transformDirection(inv);
    this.vmSun.position.copy(sd).multiplyScalar(5);
    // nearest fire/lamp tints the gun
    let best = null, bd = 1e9;
    for (const L of this.arena.lights) { const dd = L.light.position.distanceTo(this.camera.position); if (dd < bd) { bd = dd; best = L; } }
    if (best) {
      const lp = best.light.position.clone().applyMatrix4(inv);
      const len = lp.length(); lp.multiplyScalar(Math.min(1, 2.5 / len));
      this.vmLocal.position.copy(lp); this.vmLocal.color.copy(best.light.color);
      this.vmLocal.intensity = best.light.intensity * 0.12 * clamp(1 - bd / best.light.distance, 0, 1);
    }
  }

  updateHUD(dt, ads) {
    const A = this.arsenal, p = this.player, w = A.current;
    // crosshair bloom (hidden while aiming)
    this.crossKick = Math.max(0, this.crossKick - dt * 8);
    const fovR = Math.tan((this.camera.fov * DEG) / 2);
    const gap = (Math.tan((A.spreadNow * DEG) / 2) / fovR) * (innerHeight / 2) + 4 + this.crossKick * 4;
    const ch = $('cross');
    ch.style.setProperty('--gap', `${Math.min(gap, 140).toFixed(1)}px`);
    ch.style.opacity = (1 - Math.min(1, ads * 2.5)) * (p.sprinting ? 0.25 : 1);
    if (this.hudDirty) {
      this.hudDirty = false;
      $('mag').textContent = w.mag; $('reserve').textContent = w.reserve;
      $('wname').textContent = w.def.name; $('wtype').textContent = w.def.type;
      $('mag').classList.toggle('low', w.mag <= Math.ceil(w.def.mag * 0.25));
      $('score').textContent = this.score.toLocaleString();
      $('kills').textContent = this.kills;
      document.querySelectorAll('.slot').forEach((s, i) => s.classList.toggle('sel', i === A.index));
    }
    $('mag').textContent = w.mag; $('reserve').textContent = w.reserve;
    const hint = $('hint');
    const hintText = A.reload ? 'RELOADING' : w.mag === 0 && w.reserve === 0 ? 'NO AMMO — SWAP' : w.mag <= Math.ceil(w.def.mag * 0.25) ? 'R  RELOAD' : '';
    if (hint.textContent !== hintText) hint.textContent = hintText;
    $('hpfill').style.width = `${p.health}%`;
    $('hpfill').classList.toggle('low', p.health < 35);
    $('wave').textContent = this.horde.wave || '—';
    $('left').textContent = this.horde.remaining();
    if (this.debugFps) $('fps').textContent = `${Math.round(this.fps)} fps`;
    // floating damage numbers
    const v = new THREE.Vector3();
    for (const n of this.dmgNums) {
      if (n.life <= 0) continue;
      n.life -= dt; n.pos.y += dt * 0.9;
      v.copy(n.pos).project(this.camera);
      if (v.z > 1 || n.life <= 0) { n.el.className = 'dn'; continue; }
      n.el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%,-50%)`;
      n.el.style.opacity = Math.min(1, n.life * 3);
    }
  }
}

const game = new Game();
window.game = game;

// Hooks for automated testing (headless browsers have no pointer lock).
window.__debug = {
  start() { game.forceLock = true; game.audio.init(); game.input.locked = true; game.restart(true); game.show(null); },
  set(o) { Object.assign(game.input.mouse, o); },
  key(code, down) { if (down) { game.input.keys.add(code); game.input.pressed.add(code); } else game.input.keys.delete(code); },
  look(yaw, pitch) { game.player.yaw = yaw; game.player.pitch = pitch; },
  teleport(x, y, z) { game.player.pos.set(x, y, z); game.player.vel.set(0, 0, 0); },
  select(i) { game.arsenal.select(i); },
  info() { const A = game.arsenal; return { state: game.state, weapon: A.def.id, mag: A.current.mag, ads: A.ads, fps: game.fps, cpuMs: game.cpuMs, hp: game.player.health, wave: game.horde.wave, alive: game.horde.aliveCount(), kills: game.kills, pos: game.player.pos.toArray() }; },
  spawn(n, dist) { game.horde.debugSpawn(n, dist); },
  god(on) { game.god = on; game.player.hurt = on ? () => {} : Player.prototype.hurt; },
  quality(q) { game.applyQuality(q); },
  frames(n) { return new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }); },
};
