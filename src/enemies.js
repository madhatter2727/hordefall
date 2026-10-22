import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, damp, rand, rayCapsule, raySphere, rayAABB } from './core/util.js';
import { ARENA } from './world/arena.js';
import { waveParams, RUNNER_SPEED, SPRINTER_SPEED, BOSS_EVERY, SPITTERS, IDLE_CHANCE } from './tuning.js';
import { NavGrid } from './nav.js';
import { ZombieFactory, resetRig, play, readJoints, captureRef, solveFromJoints, addStump, makeLimb, poseLimb, PART_BONE, GAIT, blendLayers } from './rig.js';

// ---------------------------------------------------------------------------
// HUSKS: skinned, mocap-animated zombies (see rig.js). Gameplay runs on a 15-joint
// skeleton read back from the bones (hit zones, gore anchors); dead they become Verlet
// ragdolls (or play a death clip) and rot away with a dissolve shader.
// ---------------------------------------------------------------------------
const J = { pelvis: 0, chest: 1, head: 2, lSh: 3, lEl: 4, lHa: 5, rSh: 6, rEl: 7, rHa: 8, lHip: 9, lKn: 10, lFt: 11, rHip: 12, rKn: 13, rFt: 14 };
const NJ = 15;
// part: [jointA, jointB, radius, kind]
const PARTS = [
  ['torso', J.pelvis, J.chest, 0.19, 'body'],
  ['head', J.chest, J.head, 0.125, 'head'],
  ['upperL', J.lSh, J.lEl, 0.068, 'limb'], ['foreL', J.lEl, J.lHa, 0.058, 'limb'],
  ['upperR', J.rSh, J.rEl, 0.068, 'limb'], ['foreR', J.rEl, J.rHa, 0.058, 'limb'],
  ['thighL', J.lHip, J.lKn, 0.092, 'limb'], ['shinL', J.lKn, J.lFt, 0.07, 'limb'],
  ['thighR', J.rHip, J.rKn, 0.092, 'limb'], ['shinR', J.rKn, J.rFt, 0.07, 'limb'],
];
const LEN = { torso: 0.5, head: 0.24, upper: 0.3, fore: 0.31, thigh: 0.44, shin: 0.44 };
// extra ragdoll constraints that keep the trunk rigid-ish
const BRACES = [[J.pelvis, J.lHip], [J.pelvis, J.rHip], [J.lHip, J.rHip], [J.chest, J.lSh], [J.chest, J.rSh], [J.lSh, J.rSh],
  [J.lSh, J.pelvis], [J.rSh, J.pelvis], [J.lHip, J.chest], [J.rHip, J.chest], [J.lSh, J.head], [J.rSh, J.head]];

export const TYPES = {
  runner: { name: 'Husk', hp: 90, speed: 6.3, scale: 1, reach: 1.55, dmg: 14, windup: 0.3, cd: 0.95, mass: 1, points: 100, color: new THREE.Color(0.16, 0.13, 0.12), heat: 1, lean: 0.22, sever: 1, turn: 5 },
  brute: { name: 'Brute', hp: 650, speed: 3.5, scale: 1.42, reach: 2.2, dmg: 34, windup: 0.55, cd: 1.7, mass: 4.5, points: 400, color: new THREE.Color(0.1, 0.085, 0.08), heat: 1.8, lean: 0.38, brute: true, sever: 2.2, turn: 3 },
  spitter: { name: 'Spitter', hp: 120, speed: 4.6, scale: 0.97, reach: 1.5, dmg: 10, windup: 0.3, cd: 1.2, mass: 1, points: 175, color: new THREE.Color(0.14, 0.15, 0.11), heat: 1, lean: 0.3, hue: 1, ranged: true, bulk: 1.3, sever: 1, turn: 4.5 },
  boss: { name: 'Colossus', hp: 5200, speed: 3.5, scale: 2.2, reach: 3.4, dmg: 30, windup: 0.6, cd: 1.5, mass: 40, points: 3000, color: new THREE.Color(0.1, 0.085, 0.08), heat: 1.4, lean: 0.34, brute: true, boss: true, sever: 0, bulk: 1.3, turn: 1.8 },
};
// part index groups: severing an upper limb takes the whole arm/leg
const SEVER_GROUP = { 2: [2, 3], 3: [3], 4: [4, 5], 5: [5], 6: [6, 7], 7: [7], 8: [8, 9], 9: [9], 1: [1] };
const SEVER_THR = [1e9, 50, 55, 45, 55, 45, 75, 60, 75, 60];
const SEVER_F = { machete: 2.8, ar: 0.55, sg: 1.0, mr: 1.45, smg: 0.5, lmg: 0.7, rv: 1.35, boom: 2.2 };
const LIMB_MAX = 10, MAXI = 72 + LIMB_MAX;
const SPIT_CHARGE = 0.85, SPIT_G = 14;

function emberTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
  x.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    let px = Math.random() * 256, py = Math.random() * 256;
    x.strokeStyle = `rgba(255,${120 + Math.random() * 90},40,${0.5 + Math.random() * 0.5})`;
    x.lineWidth = 0.6 + Math.random() * 1.3;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 5; k++) { px += (Math.random() - 0.5) * 26; py += (Math.random() - 0.5) * 26; x.lineTo(px, py); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(2, 2); return t;
}
// rotate a bone by a world-space axis/angle about its own pivot
const _wq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
function worldRotate(bone, axis, ang) {
  bone.parent.getWorldQuaternion(_pq);
  _rq.setFromAxisAngle(axis, ang);
  _wq.copy(_pq).invert().multiply(_rq).multiply(_pq);
  bone.quaternion.premultiply(_wq);
  bone.updateMatrixWorld(true);
}
const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3(), tN = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), tX = new THREE.Vector3(), tY = new THREE.Vector3(), tZ = new THREE.Vector3(), tS = new THREE.Vector3();

export class Horde {
  constructor(scene, arena, hooks) {
    this.scene = scene; this.arena = arena; this.hooks = hooks; this.player = hooks.player;
    this.colliders = arena.colliders.filter((c) => !c.ground);
    this.max = 72; this.maxI = MAXI;
    const ember = emberTexture();
    this.parts = PARTS.map(([name, a, b, r, kind]) => ({ name, a, b, r, kind, len: LEN[name.replace(/[LR]$/, '')] }));
    this.factory = new ZombieFactory(hooks.assets.models.zombie);
    this.rigPool = []; this.limbRigPool = [];
    for (let i = 0; i < 20; i++) { const R = this.factory.make(); scene.add(R.root); this.rigPool.push(R); }
    this.pool = [];
    this.enemies = [];
    // flow field
    this.nav = new NavGrid(arena.colliders, ARENA.half, 0.5);
    this.flowT = 0; this.playerF = null; this.lureF = null;
    this.navStats = { sidesteps: 0, vaults: 0, climbs: 0, respawns: 0, builds: 0, buildMs: 0 };
    this._v = new THREE.Vector3();
    this.hash = new Map();
    this.wave = 0; this.toSpawn = 0; this.spawnT = 0; this.intermission = 0; this.running = false; this.lures = [];
    this.growlT = 0; this.alertT = 0; this.screamT = 0;
    this.limbs = []; this.limbPool = [];
    this.puddles = []; this.boss = null; this.bossDelay = 0;
    // pooled acid globs
    const orbGeo = new THREE.SphereGeometry(1, 14, 10), haloGeo = new THREE.SphereGeometry(1.7, 12, 8);
    const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 4.2, 0.5), toneMapped: false });
    const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 0.15), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.proj = Array.from({ length: 14 }, () => {
      const m = new THREE.Mesh(orbGeo, orbMat); m.add(new THREE.Mesh(haloGeo, haloMat)); m.visible = false; scene.add(m);
      return { mesh: m, vel: new THREE.Vector3(), state: 'free', life: 0, trailT: 0 };
    });
    this.buildBossRig(scene, ember);
  }

  // armor plates + glowing weak points that ride the boss skeleton
  buildBossRig(scene, ember) {
    const armor = new THREE.MeshStandardMaterial({ color: '#2e2925', roughness: 0.38, metalness: 0.85, emissive: new THREE.Color(1.6, 0.45, 0.1), emissiveMap: ember, emissiveIntensity: 0.5 });
    const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.4, 0.6), toneMapped: false });
    const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.9, 0.2), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const L = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const pieces = [];
    const add = (geo, mat, part, local) => { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.castShadow = mat === armor; m.frustumCulled = false; m.visible = false; scene.add(m); pieces.push({ m, part, local }); };
    const rb = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, r);
    add(rb(0.5, 0.36, 0.12, 0.04), armor, 0, L(0, 0.32, 0.15, -0.12));          // chest plate
    add(rb(0.44, 0.14, 0.11, 0.035), armor, 0, L(0, 0.08, 0.14, 0.15));          // belly band
    for (const sx of [-1, 1]) add(rb(0.17, 0.4, 0.1, 0.03), armor, 0, L(sx * 0.17, 0.3, -0.13, 0.1, sx * 0.25)); // back plates beside the core
    add(new THREE.TorusGeometry(0.1, 0.025, 8, 20), armor, 0, L(0, 0.34, -0.17));  // core collar
    add(new THREE.SphereGeometry(0.085, 16, 12), core, 0, L(0, 0.34, -0.17));     // back core (weak point)
    add(new THREE.SphereGeometry(0.16, 12, 8), halo, 0, L(0, 0.34, -0.19));
    for (const pi of [2, 4]) add(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), armor, pi, L(0, 0.02, 0, 0, 0, 0, 1.1, 1, 1.1)); // pauldrons
    for (const pi of [3, 5]) add(new THREE.CylinderGeometry(0.07, 0.085, 0.2, 10), armor, pi, L(0, 0.13, 0));  // gauntlets
    for (const pi of [6, 8]) add(rb(0.17, 0.3, 0.09, 0.03), armor, pi, L(0, 0.2, 0.08));                  // thigh plates
    for (const pi of [7, 9]) add(rb(0.12, 0.26, 0.07, 0.025), armor, pi, L(0, 0.2, 0.06));                // shin guards
    add(new THREE.TorusGeometry(0.105, 0.016, 6, 20, Math.PI), core, 1, L(0, 0.2, 0.03, Math.PI / 2 - 0.2, 0, 0)); // glowing brow band (head weak point)
    const spike = new THREE.ConeGeometry(0.035, 0.18, 6);
    for (const pi of [2, 4]) for (let k = 0; k < 3; k++) add(spike, armor, pi, L((k - 1) * 0.05, 0.08 + k * 0.02, -0.02 - k * 0.03, -0.5 - k * 0.2, 0, (k - 1) * 0.3));
    for (let k = 0; k < 4; k++) add(spike, armor, 0, L((k - 1.5) * 0.09, 0.42, -0.14, -1.1, 0, 0)); // spine spikes
    
    this.rig = { pieces, core, halo, m: new THREE.Matrix4() };
  }
  updateBossRig(time) {
    const e = this.boss, R = this.rig;
    const vis = !!e && (!e.dead || e.dissolve < 0.15);
    for (const p of R.pieces) p.m.visible = vis;
    if (!vis) return;
    const pulse = 0.7 + 0.3 * Math.sin(time * 6), stun = e.bs === 'stun' ? 1.6 : 1;
    R.core.color.setRGB(3.2 * pulse * stun, 1.25 * pulse * stun, 0.3 * pulse);
    R.halo.opacity = (0.08 + 0.08 * pulse) * stun;
    for (const p of R.pieces) {
      const P = this.parts[p.part];
      this.partBasis(e, e.joints[P.a], e.joints[P.b], e.scale, R.m);
      p.m.matrix.multiplyMatrices(R.m, p.local);
      p.m.matrixWorldNeedsUpdate = true;
    }
  }
  // orthonormal frame on a bone (x across the shoulders, y along the bone), uniformly scaled
  partBasis(e, A, B, s, out) {
    tY.copy(B).sub(A).normalize();
    tX.copy(e.joints[J.lSh]).sub(e.joints[J.rSh]); // rig convention: character's left is +x
    tZ.crossVectors(tX, tY); if (tZ.lengthSq() < 1e-6) tZ.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    tZ.normalize(); tX.crossVectors(tY, tZ).normalize();
    out.makeBasis(tX.multiplyScalar(s), tY.multiplyScalar(s), tZ.multiplyScalar(s)); out.setPosition(A);
    return out;
  }

  // ---------------------------------------------------------------- waves
  reset() {
    for (const e of this.enemies) { this.releaseRig(e); this.pool.push(e); }
    for (const L of this.limbs) { this.releaseLimb(L); this.limbPool.push(L); }
    this.limbs.length = 0; this.puddles.length = 0; this.boss = null; this.bossDelay = 0; this.bossWave = false;
    for (const pr of this.proj) { pr.state = 'free'; pr.mesh.visible = false; }
    this.enemies.length = 0; this.wave = 0; this.toSpawn = 0; this.running = false; this.waveKilled = 0; this.waveTotal = 0; this.W = null;
  }
  takeRig() { const R = this.rigPool.pop() || (() => { const r = this.factory.make(); this.scene.add(r.root); return r; })(); resetRig(R); R.root.visible = true; return R; }
  releaseRig(e) { if (!e.rig) return; resetRig(e.rig); e.rig.root.visible = false; this.rigPool.push(e.rig); e.rig = null; }
  releaseLimb(L) { if (!L.rig) return; resetRig(L.rig); L.rig.root.visible = false; this.limbRigPool.push(L.rig); L.rig = null; }
  start() { this.running = true; this.intermission = 2.5; this.cleared = false; this.hold = false; }
  ready(t = 2.5) { this.hold = false; this.intermission = t; }
  remaining() { return this.toSpawn + (this.bossDelay > 0 ? 1 : 0) + this.enemies.filter((e) => !e.dead).length; }
  aliveCount() { return this.enemies.filter((e) => !e.dead).length; }
  nextWave() {
    this.wave++;
    this.bossWave = this.wave % BOSS_EVERY === 0;
    const W = (this.W = waveParams(this.wave));
    const n = W.count;
    this.brutesLeft = this.bossWave ? 0 : W.brutes;
    if (this.bossWave) this.bossDelay = 2.4;
    this.toSpawn = n; this.waveTotal = n; this.spawnT = this.bossWave ? 4 : 1.2;
    this.hooks.onWaveStart?.(this.wave, n + (this.bossWave ? 1 : 0), this.bossWave);
  }
  spawnBoss(at) {
    if (!at) { // farthest spawn point from the player
      let best = null, bd = -1;
      for (const sp of this.arena.spawns) { const d = sp.distanceTo(this.player.pos); if (d > bd) { bd = d; best = sp; } }
      at = best.clone();
    }
    const e = this.spawn('boss', at);
    e.hp = e.maxHp = TYPES.boss.hp * (1 + (Math.max(5, this.wave) / 5 - 1) * 0.5);
    this.boss = e;
    this.hooks.audio.play('roar');
    this.hooks.onBoss?.(e);
    return e;
  }
  lureFor(e) {
    for (const L of this.lures) { const dx = e.pos.x - L.pos.x, dz = e.pos.z - L.pos.z; if (dx * dx + dz * dz < L.r * L.r) return L; }
    return null;
  }
  spittersAlive() { let n = 0; for (const e of this.enemies) if (!e.dead && e.type.ranged) n++; return n; }
  // gunfire wakes idle husks within earshot (closer ones react first)
  alert(pos, radius = 34) {
    for (const e of this.enemies) {
      if (e.dead || e.aware) continue;
      const d = e.pos.distanceTo(pos);
      if (d < radius) e.alertIn = Math.min(e.alertIn ?? 9, 0.12 + d / 70 + rand(0, 0.2));
    }
  }
  wake(e) {
    if (e.aware) return;
    e.aware = true; e.alertIn = undefined; e.flinchV -= 4; e.stagger = Math.max(e.stagger, 0.12);
    if (this.screamT <= 0) { this.hooks.audio.play('scream', this.spatial(e)); this.screamT = 0.25; }
  }
  // quick melee: nearest husk in a short cone in front of the player
  // every living zombie in a sweeping arc, nearest first (machete cleave)
  meleeCleave(o, f, range, cone, max) {
    const out = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      const c = e.joints[J.chest].clone().lerp(e.joints[J.pelvis], 0.3);
      const v = c.clone().sub(o); const d = v.length();
      if (d > range + 0.35 * e.scale) continue;
      v.normalize();
      if (v.dot(f) < cone && d > 1.0) continue;
      out.push({ e, t: d, point: c });
    }
    out.sort((a, b) => a.t - b.t);
    return out.slice(0, max);
  }
  meleeHit(o, f, range) {
    let best = null, bd = range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const c = e.joints[J.chest].clone().lerp(e.joints[J.pelvis], 0.3);
      const v = c.clone().sub(o); const d = v.length();
      if (d > range + 0.3 * e.scale) continue;
      v.normalize();
      if (v.dot(f) < 0.55 && d > 0.9) continue;
      if (d < bd + 0.3 * e.scale) { bd = d; best = { e, t: d, point: c }; }
    }
    return best;
  }

  spawn(typeKey, at, idle = false) {
    const T = TYPES[typeKey];
    const e = this.pool.pop() || { joints: Array.from({ length: NJ }, () => new THREE.Vector3()), prev: Array.from({ length: NJ }, () => new THREE.Vector3()), pos: new THREE.Vector3(), vel: new THREE.Vector3(), kb: new THREE.Vector3(), gatePt: new THREE.Vector3() };
    e.type = T; e.key = typeKey;
    const W = this.W || waveParams(Math.max(1, this.wave));
    e.hp = T.hp * (T.boss ? 1 : W.hp); e.dmgMul = T.boss ? 1 : W.dmg;
    e.pos.copy(at); e.vel.set(0, 0, 0); e.kb.set(0, 0, 0); e.vy = 0;
    e.yaw = Math.atan2(-at.x, -at.z); e.phase = rand(0, 6.28);
    // speed class: shamblers early, joggers mid, sprinters late (see tuning.js)
    e.cls = 'shambler';
    if (T.boss) e.speed = T.speed;
    else if (T.brute || T.ranged) e.speed = T.speed * W.pace * rand(0.9, 1.1);
    else {
      const r = Math.random();
      if (r < W.sprinters) { e.cls = 'sprinter'; e.speed = rand(...SPRINTER_SPEED); }
      else if (r < W.sprinters + W.runners) { e.cls = 'runner'; e.speed = rand(...RUNNER_SPEED); }
      else e.speed = W.shamble * rand(0.85, 1.15);
    }
    e.flank = rand(-0.7, 0.7); e.speedNow = 0;
    e.dead = false; e.deadT = 0; e.dissolve = 0; e.flash = 0; e.stagger = 0;
    e.flinch = 0; e.flinchV = 0; e.headSnap = 0; e.headSnapV = 0; e.twist = 0; e.twistV = 0;
    e.attackT = -1; e.attackCd = rand(0.2, 0.6); e.leapCd = 1;
    e.growlT = rand(1, 5); e.grounded = true; e.scale = T.scale * rand(0.95, 1.06);
    e.armHeight = rand(0.75, 1.25);
    // gait personality: phase offset, cadence/stride, limp, lurch, how hard the arms reach
    const limp = Math.random() < (T.boss ? 0 : 0.3) ? rand(0.12, 0.3) : 0;
    e.gait = { offset: Math.random(), cadence: 1, stride: 1, limp, limpSide: Math.random() < 0.5 ? 0.3 : Math.PI + 0.3,
      lurch: T.boss ? 0.16 : rand(0.04, 0.2), reach: T.boss ? 0.15 : T.ranged ? 0.1 : Math.random() < 0.65 ? rand(0.5, 1.0) : rand(0, 0.25), swing: rand(0.15, 0.35),
      armL: rand(-0.2, 0.2), armR: rand(-0.2, 0.2), walkMax: T.boss ? 1.6 : rand(3.6, 4.4), runMin: T.boss ? 0.45 : rand(0.75, 0.9), turn: T.turn ?? 4 };
    e.gph = Math.random(); e.reachNow = 0; e.hunt = false; e.lastStep = -1;
    e.heat = T.heat * rand(0.8, 1.2);
    e.lastHit = -1; e.rest = {}; e.pooled = false; e.near = null;
    e.maxHp = e.hp; e.lost = 0; e.limbDmg = e.limbDmg || new Float32Array(10); e.limbDmg.fill(0); e.wound = e.wound || new Float32Array(10); e.wound.fill(0);
    e.crawl = false; e.crawlRef = false; e.armless = false; e.stumps = []; e.facePlayer = false;
    e.spitCd = rand(1.2, 2.5); e.charge = -1; e.orb = null; e.strafe = Math.random() < 0.5 ? -1 : 1; e.strafeT = rand(1.5, 3); e.spitRecoil = 0;
    e.bs = 'walk'; e.bt = 0; e.chargeCd = 3; e.slamCd = 2; e.stunDur = 1; e.chargeDir = e.chargeDir || new THREE.Vector3(); e.chargeHit = false; e.prePos = e.prePos || new THREE.Vector3();
    e.stk = { t: 0, x: at.x, z: at.z, fd: 1e9, n: 0, side: 1, sideT: 0 }; e.navNext = -1; e.navDh = 0; e.respawned = 0;
    e.aware = !idle; e.alertIn = undefined; e.wander = new THREE.Vector3(rand(-28, 28), 0, rand(-28, 28)); e.wanderT = rand(4, 9);
    // walk in through the nearest gate
    const g = Math.abs(at.x) > Math.abs(at.z) ? new THREE.Vector3(Math.sign(at.x) * (ARENA.half - 1.5), 0, clamp(at.z, -2.5, 2.5)) : new THREE.Vector3(clamp(at.x, -2.5, 2.5), 0, Math.sign(at.z) * (ARENA.half - 1.5));
    e.gatePt.copy(g); e.outside = Math.max(Math.abs(at.x), Math.abs(at.z)) > ARENA.half - 2;
    e.rig = this.takeRig(); e.ragdoll = false; e.ref = e.ref || {}; e.anim = null;
    const tint = T.boss ? [0.42, 0.36, 0.36] : T.brute ? [0.8, 0.74, 0.72] : [rand(0.88, 1.08), rand(0.9, 1.08), rand(0.85, 1.0)];
    e.rig.u.uTint.value.setRGB(...tint); e.rig.u.uHue.value = T.hue || 0;
    for (const a of Object.values(e.rig.actions)) a.time = rand(0, 3);
    if (T.boss) { const B = e.rig.bones; B.Spine2.scale.set(1.32, 1.12, 1.4); B.Neck.scale.setScalar(0.8); B.LeftArm.scale.setScalar(1.18); B.RightArm.scale.setScalar(1.18); B.LeftUpLeg.scale.set(1.2, 1, 1.2); B.RightUpLeg.scale.set(1.2, 1, 1.2); e.rig.u.uEmber.value = 1; }
    else if (T.brute) e.rig.bones.Spine2.scale.set(1.18, 1.05, 1.22);
    else if (T.hue) e.rig.bones.Spine1.scale.set(1.12, 1, 1.25);
    this.animate(e, 0);
    this.enemies.push(e);
    return e;
  }
  debugSpawn(n, dist = 14, idle = false, type = null, ang = null) {
    const P = this.player.pos, out = [];
    for (let i = 0; i < n; i++) {
      const a = ang !== null ? ang + i * 0.35 : (i / n) * Math.PI * 2 + rand(-0.2, 0.2), d = ang !== null ? dist : dist + rand(-2, 3);
      const x = clamp(P.x + Math.sin(a) * d, -34, 34), z = clamp(P.z + Math.cos(a) * d, -34, 34);
      const at = new THREE.Vector3(x, this.groundAt(x, z, 10), z);
      out.push(type === 'boss' ? this.spawnBoss(at) : this.spawn(type || (i % 7 === 6 ? 'brute' : 'runner'), at, idle));
    }
    return out;
  }

  // ---------------------------------------------------------------- navigation
  // flow fields toward the player (and an active Screamer); rebuilt when the target changes cell
  updateFields(dt) {
    const P = this.player, nav = this.nav;
    this.flowT -= dt;
    const pc = nav.cellOf(P.pos.x, P.pos.z);
    this.navCd = (this.navCd || 0) - dt;
    if (!this.playerF || (pc !== this.playerF.cell && this.navCd <= 0) || this.flowT <= 0) { // at most ~5 rebuilds/s
      const t0 = performance.now();
      this.playerF = nav.build(P.pos.x, P.pos.z, P.pos.y, "player");
      this.navStats.builds++; this.navStats.buildMs = performance.now() - t0; this.flowT = 2; this.navCd = 0.2;
    }
    const L = this.lures[0];
    if (L) { const lc = nav.cellOf(L.pos.x, L.pos.z); if (!this.lureF || this.lureF.cell !== lc) this.lureF = nav.build(L.pos.x, L.pos.z, L.pos.y, 'lure'); }
    else this.lureF = null;
  }
  // steer along the flow field; remembers the next cell so the caller can climb/vault into it
  navDir(e, F, out) {
    const nav = this.nav, c = nav.next(F, e.pos.x, e.pos.z, e.pos.y);
    e.navNext = c;
    if (c < 0) return false;
    const dh = nav.height[c] - e.pos.y;
    e.navDh = dh;
    const tc = Math.abs(dh) <= 0.6 ? nav.ahead(F, c, 3) : c;
    nav.center(tc, this._v);
    out.set(this._v.x - e.pos.x, 0, this._v.z - e.pos.z);
    const l = out.length(); if (l < 1e-4) return false;
    out.divideScalar(l);
    return true;
  }
  // a hidden spot to put a hopelessly stuck zombie back: a gate the player is not looking at
  hiddenSpawn() {
    const P = this.player, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bs = -1e9;
    for (const sp of this.arena.spawns) {
      const dx = sp.x - P.pos.x, dz = sp.z - P.pos.z, d = Math.hypot(dx, dz);
      const facing = (dx * fx + dz * fz) / (d || 1);
      const score = -facing * 20 + d * 0.3 + rand(0, 4);
      if (score > bs) { bs = score; best = sp; }
    }
    return best;
  }
  unstick(e, dir, dt, dist) {
    // progress check once a second: did we get any closer (by flow cost) or move at all?
    const S = e.stk;
    S.t += dt;
    if (S.t < 1) return;
    const moved = Math.hypot(e.pos.x - S.x, e.pos.z - S.z);
    const F = e.lured ? this.lureF : this.playerF, c = this.nav.cellOf(e.pos.x, e.pos.z);
    const fd = F && c >= 0 ? F.dist[c] : 0;
    const progressing = moved > 0.45 || fd < S.fd - 8;
    const trying = e.aware && !e.outside && e.attackT < 0 && (dist > 2.2 || Math.abs(this.player.pos.y - e.pos.y) > 1.2) && !(e.type.ranged && dist < 18) && e.charge < 0 && e.stagger <= 0 && !(e.lured && dist < 3);
    S.t = 0; S.x = e.pos.x; S.z = e.pos.z; S.fd = fd;
    if (!e.aware && moved < 0.3) { e.wander.set(rand(-28, 28), 0, rand(-28, 28)); return; }
    if (progressing || !trying) { S.n = 0; return; }
    S.n++;
    if (S.n === 2) { S.side = Math.random() < 0.5 ? -1 : 1; S.sideT = 0.9; this.navStats.sidesteps++; }
    else if (S.n === 3 || S.n === 5) { if (e.grounded && !e.type.boss) { e.vy = 7.2; e.grounded = false; e.vel.addScaledVector(dir, 2.5); this.navStats.vaults++; } }
    else if (S.n >= 7 && !e.type.boss) { // last resort: quietly re-enter through a gate the player can't see
      const sp = this.hiddenSpawn();
      e.pos.set(sp.x + rand(-2, 2), 0, sp.z + rand(-2, 2)); e.vel.set(0, 0, 0); e.vy = 0;
      const g = Math.abs(sp.x) > Math.abs(sp.z) ? new THREE.Vector3(Math.sign(sp.x) * (ARENA.half - 1.5), 0, clamp(sp.z, -2.5, 2.5)) : new THREE.Vector3(clamp(sp.x, -2.5, 2.5), 0, Math.sign(sp.z) * (ARENA.half - 1.5));
      e.gatePt.copy(g); e.outside = true; S.n = 0; e.respawned = (e.respawned || 0) + 1; this.navStats.respawns++;
    }
  }
  groundAt(x, z, y, r = 0.15) {
    let g = 0;
    for (const c of this.colliders) {
      if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
      if (c.maxY <= y + 0.6 && c.maxY > g) g = c.maxY;
    }
    return g;
  }
  collide(e) {
    const r = 0.32 * e.scale, p = e.pos, top = p.y + 1.6 * e.scale;
    for (const c of this.colliders) {
      if (c.maxY <= p.y + 0.6 || c.minY >= top) continue;
      if (p.x < c.minX - r || p.x > c.maxX + r || p.z < c.minZ - r || p.z > c.maxZ + r) continue;
      const qx = clamp(p.x, c.minX, c.maxX), qz = clamp(p.z, c.minZ, c.maxZ);
      let dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d < 1e-5) { // center inside: push out the shortest way
        const opts = [[c.minX - r - p.x, 0], [c.maxX + r - p.x, 0], [0, c.minZ - r - p.z], [0, c.maxZ + r - p.z]];
        opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += opts[0][0]; p.z += opts[0][1]; continue;
      }
      p.x = qx + (dx / d) * r; p.z = qz + (dz / d) * r;
    }
    if (!e.outside) { p.x = clamp(p.x, -35.5, 35.5); p.z = clamp(p.z, -35.5, 35.5); }
  }

  // ---------------------------------------------------------------- combat
  raycast(o, d, maxT) {
    const hits = [], c = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead && (e.deadT > 0 || !e.type.sever)) continue; // the rest of a blast still tears into a fresh corpse
      c.copy(e.pos); c.y += 0.95 * e.scale;
      if (raySphere(o, d, c, 1.25 * e.scale, maxT) < 0 && c.distanceToSquared(o) > 2.5) continue;
      let best = maxT, part = null, hp = -1;
      for (let pi = 0; pi < this.parts.length; pi++) {
        const P = this.parts[pi];
        if (e.lost & (1 << pi)) continue;
        let t;
        if (P.kind === 'head') { t = raySphere(o, d, e.joints[J.head], 0.15 * e.scale, best); }
        else t = rayCapsule(o, d, e.joints[P.a], e.joints[P.b], P.r * e.scale * (P.name === 'torso' ? 1.15 : 1.1), best);
        if (t >= 0 && t < best) { best = t; part = P.kind; hp = pi; }
      }
      if (part) hits.push({ t: best, e, part, pi: hp, point: o.clone().addScaledVector(d, best) });
    }
    return hits.sort((a, b) => a.t - b.t);
  }
  damage(e, amount, part, point, dir, def, pi = -1) {
    if (e.dead) {
      if (pi >= 0) e.wound[pi] = Math.min(1, e.wound[pi] + 0.3);
      if (e.deadT === 0 && e.type.sever && pi > 0 && (def.id === 'sg' || def.id === 'mr')) {
        e.limbDmg[pi] += amount * SEVER_F[def.id];
        if (e.limbDmg[pi] >= SEVER_THR[pi] * e.type.sever * (pi === 1 ? 0.5 : 0.35)) this.sever(e, pi, dir);
      }
      return { killed: false, corpse: true };
    }
    const T = e.type, big = def.id !== 'ar';
    const local = Math.sin(e.yaw) * dir.x + Math.cos(e.yaw) * dir.z; // + when shot from behind
    let weak = false, armor = false;
    if (T.boss) {
      // armored: the glowing head and back core take full damage, plates shrug most of it off
      const backCore = part === 'body' && local > 0.3 && point.y > e.pos.y + 1.0 * e.scale;
      if (part === 'head') { amount *= 1.25; weak = true; }
      else if (backCore) { amount *= 2.2; weak = true; }
      else { amount *= part === 'limb' ? 0.4 : 0.28; armor = def.id !== 'melee'; }
      if (e.bs === 'stun') amount *= 1.5;
    } else if (this.instaKill && def.id !== 'deadfall') amount = Math.max(amount, e.hp + 1); // REAPER power-up
    e.hp -= amount; e.flash = armor ? 0.35 : 1; e.lastHit = performance.now();
    if (!e.aware) this.wake(e);
    if (pi >= 0 && !armor) e.wound[pi] = Math.min(1, e.wound[pi] + 0.25 + amount / 60);
    if (armor) { this.hooks.fx.impact(point, dir.clone().negate(), 'metal'); if (Math.random() < 0.5) this.hooks.audio.play('armor'); }
    else if (T.hue) this.hooks.fx.ichor(point, dir, big ? 0.6 : 0.35, true);
    else this.hooks.fx.bloodHit(point, dir, big || part === 'head');
    const dist = point.distanceTo(this.player.pos);
    this.hooks.audio.play('flesh', { gain: clamp(8 / (dist + 3), 0.2, 1) });
    // dismemberment: limb damage builds per part, scaled by how violent the weapon is
    if (T.sever && pi > 0) {
      e.limbDmg[pi] += amount * (SEVER_F[def.id] ?? 0) * (dist < 6 && def.id === 'sg' ? 1.3 : 1);
      if (pi !== 1 && e.limbDmg[pi] >= SEVER_THR[pi] * T.sever) this.sever(e, pi, dir);
    }
    // stagger + knockback (heavier enemies resist)
    const imp = (amount / 30) / T.mass;
    e.kb.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), Math.min(def.knock ? 9 : 6, imp * (def.knock ?? (def.id === 'sg' ? 1.6 : 1.1))));
    e.stagger = Math.max(e.stagger, Math.min(0.55, 0.12 + imp * 0.25));
    if (e.charge >= 0 && imp > 0.9) this.cancelSpit(e);
    // flinch: torso jerks back, head snaps
    e.flinchV -= imp * 9 * Math.sign(local || 1) * -1;
    if (part === 'head') e.headSnapV -= 14 * Math.min(1.5, imp + 0.4) * -Math.sign(local || 1);
    e.twistV += (Math.random() - 0.5) * imp * 22;
    if (e.hp <= 0) {
      const head = part === 'head';
      this.kill(e, point, dir, amount, def, head);
      this.hooks.onKill?.(e, { head, def, weak });
      return { killed: true, head, weak, armor };
    }
    return { killed: false, weak, armor };
  }
  // explosion: falloff damage, limbs torn off up close, corpses thrown. Returns kills.
  blast(p, radius, maxDmg) {
    const def = { id: 'boom', knock: 9 }, h = 1 / 120;
    let kills = 0;
    for (const e of this.enemies) {
      const c = e.joints[J.chest], d = c.distanceTo(p), R = radius + 0.3 * e.scale;
      if (d > R) continue;
      const f = clamp(1 - d / R, 0, 1);
      const dir = c.clone().sub(p); dir.y = Math.max(0, dir.y) + 0.7 + f * 0.6; dir.normalize();
      if (e.dead) { // fling fresh corpses
        if (e.ragdoll && e.deadT < 2.5) for (let i = 0; i < NJ; i++) e.prev[i].addScaledVector(dir, -h * 5 * f / Math.sqrt(e.type.mass));
        continue;
      }
      const amt = maxDmg * (0.3 + 0.7 * f), res = this.damage(e, amt, 'body', c.clone(), dir, def, 0);
      if (res.killed) kills++;
      this.hooks.onBlastHit?.(e, amt, res, c);
      if (e.type.sever && (res.killed || f > 0.55)) {
        const opts = [2, 4, 6, 8, 3, 5, 7, 9, 1].sort(() => Math.random() - 0.5), n = f > 0.65 ? 2 + Math.floor(Math.random() * 2) : f > 0.35 ? 1 : 0;
        for (let k = 0; k < n; k++) this.sever(e, opts[k], dir);
        if (res.killed && f > 0.5) this.hooks.fx.gib(c.clone(), dir, 8, this.groundAt(c.x, c.z, c.y));
      }
      e.stagger = Math.max(e.stagger, 0.9 * f);
    }
    return kills;
  }
  sever(e, pi, dir) {
    const idxs = (SEVER_GROUP[pi] || [pi]).filter((i) => !(e.lost & (1 << i)));
    if (!idxs.length) return;
    for (const i of idxs) e.lost |= 1 << i;
    const PARENT = { 1: 0, 2: 0, 3: 2, 4: 0, 5: 4, 6: 0, 7: 6, 8: 0, 9: 8 };
    e.wound[PARENT[idxs[0]]] = 1;
    const jIdx = [PARTS[idxs[0]][1], ...idxs.map((i) => PARTS[i][2])];
    // detached limb: a little Verlet chain (drawn with its own rig showing just that limb) that tumbles and rots away
    if (this.limbs.length >= LIMB_MAX) { const old = this.limbs.shift(); this.releaseLimb(old); this.limbPool.push(old); }
    const L = this.limbPool.pop() || { pts: [0, 1, 2].map(() => new THREE.Vector3()), prev: [0, 1, 2].map(() => new THREE.Vector3()), side: new THREE.Vector3(), len: [0, 0] };
    L.n = jIdx.length; L.segs = idxs; L.wound = 1; L.t = 0; L.dis = 0; L.scale = e.scale; L.hue = e.type.hue || 0; L.heat = e.heat * 1.4;
    L.side.copy(e.joints[J.rSh]).sub(e.joints[J.lSh]).normalize();
    const h = 1 / 120, base = dir.clone().setY(0).normalize().multiplyScalar(rand(2.5, 5)).add(e.vel.clone().multiplyScalar(0.5)); base.y += rand(2.2, 4.2);
    for (let k = 0; k < L.n; k++) {
      L.pts[k].copy(e.joints[jIdx[k]]);
      const v = base.clone().add(new THREE.Vector3(rand(-2.5, 2.5), rand(-1, 1.5), rand(-2.5, 2.5)));
      L.prev[k].copy(L.pts[k]).addScaledVector(v, -h);
    }
    for (let k = 0; k < L.n - 1; k++) L.len[k] = L.pts[k].distanceTo(L.pts[k + 1]);
    if (e.rig) {
      L.rig = this.limbRigPool.pop() || (() => { const r = this.factory.make(); this.scene.add(r.root); return r; })();
      makeLimb(L.rig, e.rig, idxs[0], e.joints, L.pts.slice(0, L.n));
      L.rig.u.uWound.value[idxs[0]] = 0.85; if (idxs[1] !== undefined) L.rig.u.uWound.value[idxs[1]] = 0.6;
      e.rig.bones[PART_BONE[idxs[0]]].scale.setScalar(0.0001);
      addStump(this.factory, e.rig, idxs[0], (idxs[0] === 1 ? 0.075 : idxs[0] >= 6 ? 0.085 : 0.06) * 1.0);
    }
    this.limbs.push(L);
    const stump = e.joints[jIdx[0]];
    this.hooks.fx.ichor(stump, dir, 1.4, !!e.type.hue);
    e.stumps.push({ j: jIdx[0], t: 3.0 });
    this.hooks.audio.play('sever');
    if (!e.dead) {
      if (idxs.some((i) => i >= 6)) { e.crawl = true; e.stagger = Math.max(e.stagger, 0.7); e.attackT = -1; this.cancelSpit(e); }
      const armsLost = (e.lost & 0b1100) && (e.lost & 0b110000);
      if (armsLost) e.armless = true;
    }
    this.hooks.onSever?.(e, PARTS[pi][0]);
  }
  kill(e, point, dir, amount, def, head) {
    e.dead = true; e.deadT = 0;
    if (e.charge >= 0) this.cancelSpit(e);
    // big headshots pop the head off
    if (head && e.type.sever && e.limbDmg[1] >= SEVER_THR[1] * e.type.sever) this.sever(e, 1, dir);
    // violent kills (shotgun up close, marksman) tear off limbs that were already badly hurt
    if (e.type.sever && (def.id === 'sg' || def.id === 'mr')) {
      for (let pi = 1; pi < 10; pi++) if (e.limbDmg[pi] >= SEVER_THR[pi] * e.type.sever * (pi === 1 ? 0.5 : 0.35)) this.sever(e, pi, dir);
    }
    if (e.type.ranged) { this.hooks.fx.acidBurst(e.joints[J.chest].clone(), false); this.hooks.audio.play('splash', { gain: 0.6 }); }
    if (e.type.boss) {
      for (let i = 0; i < 4; i++) this.hooks.fx.ichor(e.joints[[J.chest, J.head, J.pelvis, J.chest][i]], new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)), 3);
      this.hooks.audio.play('roar', { gain: 0.8 }); this.hooks.onBossDead?.(e);
    }
    // violent / headshot / dismembered / airborne kills go limp (ragdoll); plain body kills play the mocap death
    const clip = !e.crawl && !head && !e.lost && e.grounded && (e.type.boss || (def.id === 'ar' && Math.random() < 0.6));
    e.ragdoll = !clip;
    if (clip) { play(e.rig, 'die', 0.15, e.type.boss ? 0.75 : rand(1.1, 1.4), true); e.anim = 'die'; }
    else captureRef(e.rig, e.joints, e.ref);
    // ragdoll: previous positions encode velocity (motion + shot impulse, strongest near the hit)
    const h = 1 / 120;
    const v = e.vel.clone().add(e.kb);
    const push = dir.clone().multiplyScalar(clamp(amount / 22, 1.5, def.id === 'sg' ? 9 : def.id === 'boom' ? 7.5 : 6) / Math.sqrt(e.type.mass));
    push.y += def.id === 'boom' ? 2.6 : 1.2;
    for (let i = 0; i < NJ; i++) {
      const j = e.joints[i];
      const w = Math.exp(-j.distanceTo(point) * 2.2);
      e.prev[i].copy(j).addScaledVector(v, -h).addScaledVector(push, -h * (0.35 + w * 1.4));
    }
    if (head) this.hooks.fx.bloodHit(e.joints[J.head], dir, true);
    if (!e.type.hue) this.hooks.fx.bloodMist(point, dir, e.type.brute ? 2 : 1);
    this.hooks.audio.play('scream', { gain: 0.5 });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time, camera) {
    if (dt <= 0) { return; }
    const P = this.player;
    // waves
    if (this.running && P.alive) {
      if (this.bossDelay > 0) { this.bossDelay -= dt; if (this.bossDelay <= 0) this.spawnBoss(); }
      if (this.toSpawn <= 0 && this.aliveCount() === 0 && this.bossDelay <= 0) {
        // cleared: hold until the player readies up in the intermission shop
        if (this.wave > 0 && !this.cleared) { this.cleared = true; this.hold = true; this.hooks.onWaveEnd?.(this.wave); }
        if (!this.hold) { this.intermission -= dt; if (this.intermission <= 0) { this.cleared = false; this.nextWave(); } }
      } else if (this.toSpawn > 0) {
        this.spawnT -= dt;
        const W = this.W || (this.W = waveParams(Math.max(1, this.wave)));
        if (this.spawnT <= 0 && this.aliveCount() < W.maxAlive) {
          const spawns = this.arena.spawns;
          const sp = spawns[Math.floor(Math.random() * spawns.length)];
          const brute = this.brutesLeft > 0 && Math.random() < this.brutesLeft / this.toSpawn + 0.05;
          if (brute) this.brutesLeft--;
          const at = sp.clone().add(new THREE.Vector3(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)));
          let type = brute ? 'brute' : 'runner';
          if (!brute && this.wave >= SPITTERS.fromWave && this.spittersAlive() < SPITTERS.maxAlive(this.wave) && Math.random() < SPITTERS.baseChance + this.wave * SPITTERS.perWave) type = 'spitter';
          this.spawn(type, at, type === 'runner' && Math.random() < IDLE_CHANCE);
          this.toSpawn--;
          this.spawnT = W.gap * rand(0.5, 1.5);
        }
      }
    }
    this.updateFields(dt);
    // spatial hash for separation
    this.hash.clear();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const k = (Math.floor(e.pos.x / 2) + 64) * 256 + Math.floor(e.pos.z / 2) + 64;
      let b = this.hash.get(k); if (!b) this.hash.set(k, (b = [])); b.push(e);
    }
    this.growlT -= dt; this.alertT -= dt; this.screamT -= dt;
    const dir = new THREE.Vector3(), toP = new THREE.Vector3(), sep = new THREE.Vector3(), perp = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.stumps.length) this.updateStumps(e, dt);
      if (e.dead) {
        e.flash = Math.max(0, e.flash - dt * 9);
        if (e.ragdoll) { this.updateRagdoll(e, dt); if (e.deadT < 3.6) solveFromJoints(e.rig, e.joints, e.ref); }
        else this.updateDeathClip(e, dt);
        continue;
      }
      const T = e.type;
      toP.copy(P.pos).sub(e.pos); let dy = toP.y; toP.y = 0;
      let dist = toP.length(); toP.divideScalar(dist || 1);
      // idle husks shamble between random points until they see/hear the player
      if (!e.aware) {
        if (e.alertIn !== undefined) { e.alertIn -= dt; if (e.alertIn <= 0) this.wake(e); }
        if (dist < 11 && Math.abs(dy) < 3) this.wake(e);
      }
      // a Screamer decoy in range overrides the player as the target (the boss isn't fooled)
      const lure = !T.boss && !e.outside && !e.dead ? this.lureFor(e) : null;
      e.lured = !!lure;
      if (lure) {
        if (!e.aware) { e.aware = true; e.alertIn = undefined; }
        if (e.lureR === undefined) e.lureR = rand(0.9, 2.3);
        toP.copy(lure.pos).sub(e.pos); dy = toP.y; toP.y = 0;
        dist = toP.length(); toP.divideScalar(dist || 1);
      }
      // steering
      e.navNext = -1; e.navDh = 0;
      if (!e.aware && !e.outside) {
        e.wanderT -= dt;
        dir.copy(e.wander).sub(e.pos).setY(0);
        if (dir.length() < 1.5 || e.wanderT <= 0) { e.wander.set(rand(-28, 28), 0, rand(-28, 28)); e.wanderT = rand(4, 9); }
        dir.normalize();
      } else if (e.outside) {
        dir.copy(e.gatePt).sub(e.pos).setY(0);
        if (dir.length() < 1.2) e.outside = false;
        dir.normalize();
      } else {
        // straight at the target when there's a clear walk, otherwise follow the flow field round obstacles
        const F = e.lured ? this.lureF : this.playerF, tgt = e.lured ? lure.pos : P.pos;
        if (dist < 7 && Math.abs(dy) < 0.7 && this.nav.clear(e.pos.x, e.pos.z, tgt.x, tgt.z, e.pos.y)) dir.copy(toP);
        else if (!F || !this.navDir(e, F, dir)) dir.copy(toP);
      }
      // flank: bend the approach sideways when far, converge when close
      if (e.aware && !e.outside && !e.lured && dist > 7 && e.navNext < 0) {
        const f = e.flank * clamp((dist - 7) / 12, 0, 1);
        const c = Math.cos(f), s = Math.sin(f); dir.set(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
      }
      if (e.stk.sideT > 0) { e.stk.sideT -= dt; dir.set(dir.x - dir.z * e.stk.side * 1.4, 0, dir.z + dir.x * e.stk.side * 1.4).normalize(); }
      // separation
      sep.set(0, 0, 0);
      const kx = Math.floor(e.pos.x / 2) + 64, kz = Math.floor(e.pos.z / 2) + 64;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const b = this.hash.get((kx + ox) * 256 + kz + oz); if (!b) continue;
        for (const o of b) {
          if (o === e || Math.abs(o.pos.y - e.pos.y) > 1.1) continue; // a crowd below doesn't push you off a ledge
          const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
          const rr = 0.75 * (e.scale + o.scale);
          if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); sep.x += (dx / d) * (rr - d) / rr; sep.z += (dz / d) * (rr - d) / rr; }
        }
      }
      // spitters hold a firing distance and strafe instead of rushing
      if (T.ranged && e.aware && !e.outside && !e.crawl && !e.lured && dist < 18) {
        e.strafeT -= dt; if (e.strafeT <= 0) { e.strafe = -e.strafe; e.strafeT = rand(1.5, 3.5); }
        perp.set(-toP.z, 0, toP.x).multiplyScalar(e.strafe);
        if (dist < 8) dir.copy(toP).multiplyScalar(-1).addScaledVector(perp, 0.6);
        else dir.copy(perp).addScaledVector(toP, dist < 11 ? -0.25 : 0.25);
        dir.normalize();
      }
      dir.addScaledVector(sep, 1.6);
      // stop at melee range
      let want = e.aware ? e.speed : e.speed * 0.2;
      if (e.crawl) want = clamp(e.speed * 0.4, 0.55, 1.2);
      const reach = e.crawl ? 1.3 : T.reach;
      if (e.aware && dist < reach * 0.75 && Math.abs(dy) < 1.2) want = 0;
      if (e.lured && dist < e.lureR) want = 0;
      if (T.ranged && e.charge >= 0) want = 0;
      if (T.ranged && dist < 18 && !e.crawl) want *= 0.75;
      if (e.stagger > 0) { want *= 0.15; e.stagger -= dt; }
      if (e.attackT >= 0) want *= 0.35;
      // brutes charge when close
      if (e.aware && T.brute && !T.boss && !e.lured && dist < 10 && dist > 3) want *= 1.8;
      e.facePlayer = false;
      if (T.boss) want = this.bossBrain(e, dt, dist, dy, toP, dir, want);
      const dl = dir.length(); if (dl > 0) dir.divideScalar(Math.max(1, dl));
      // turn toward the steering direction at a limited rate and walk where the body points,
      // so nobody glides sideways; hard turns slow them down
      e.hunt = e.aware && !e.outside && dist < 9;
      const faceTo = e.aware && !e.outside && (dist < 3.2 || e.facePlayer) ? Math.atan2(toP.x, toP.z) : dl > 0.05 ? Math.atan2(dir.x, dir.z) : e.yaw;
      let dyaw = faceTo - e.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const turn = (e.gait.turn) * (e.stagger > 0 ? 0.3 : 1) * dt;
      e.yaw += clamp(dyaw, -turn, turn);
      const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
      let mx = dir.x, mz = dir.z;
      if (!T.ranged || dist > 18) { // strafing spitters are the exception
        const align = clamp(fx * dir.x + fz * dir.z, 0, 1), dlen = Math.hypot(dir.x, dir.z) || 1;
        const k = 0.8; mx = (fx * k + dir.x / dlen * (1 - k)) * (0.2 + 0.8 * align) * Math.min(1, dlen); mz = (fz * k + dir.z / dlen * (1 - k)) * (0.2 + 0.8 * align) * Math.min(1, dlen);
      }
      const acc = e.grounded ? 6 : 1.5;
      e.vel.x = damp(e.vel.x, mx * want, acc, dt); e.vel.z = damp(e.vel.z, mz * want, acc, dt);
      e.kb.multiplyScalar(Math.exp(-7 * dt));
      e.prePos.copy(e.pos);
      e.pos.x += (e.vel.x + e.kb.x) * dt; e.pos.z += (e.vel.z + e.kb.z) * dt;
      this.collide(e);
      if (T.boss && e.bs === 'charge' && e.bt > 0.25) { // slammed into a wall: stunned
        const moved = (e.pos.x - e.prePos.x) * e.chargeDir.x + (e.pos.z - e.prePos.z) * e.chargeDir.z;
        if (moved < 15 * dt * 0.3) { e.bs = 'stun'; e.bt = 0; e.stunDur = 2.2; this.hooks.onShake?.(0.5); this.hooks.audio.play('slam', { gain: 0.6 }); this.hooks.fx.slam(e.pos, 3); }
      }
      // vertical: gravity, step up, leap toward an elevated player
      const g = this.groundAt(e.pos.x, e.pos.z, e.pos.y);
      if (e.grounded && g > e.pos.y) e.pos.y = g;
      e.vy -= 18 * dt; e.pos.y += e.vy * dt;
      if (e.pos.y <= g) { if (!e.grounded && e.vy < -4) e.stagger = 0.15; e.pos.y = g; e.vy = 0; e.grounded = true; } else if (e.pos.y > g + 0.05) e.grounded = false;
      e.leapCd -= dt;
      if (e.aware && e.grounded && e.navNext >= 0 && e.navDh > 0.6 && e.leapCd <= 0 && !e.crawl) {
        this.nav.center(e.navNext, this._v);
        const hx = this._v.x - e.pos.x, hz = this._v.z - e.pos.z, hd = Math.hypot(hx, hz);
        if (hd < 0.95) { // hop up onto the prop / container
          e.vy = Math.sqrt(2 * 18 * (e.navDh + 0.55)); e.grounded = false; e.leapCd = 0.8;
          const k = Math.max(2.2, Math.min(4, e.speed)) / (hd || 1); e.vel.x = hx * k; e.vel.z = hz * k;
          this.navStats.climbs++;
          if (e.navDh > 1.5) this.hooks.audio.play('growl', this.spatial(e, { brute: T.brute }));
        }
      }
      if (e.aware && !e.lured && e.grounded && dy > 0.9 && dy < 4 && dist < 4.5 && e.leapCd <= 0 && !T.boss && !e.crawl) {
        e.vy = Math.sqrt(2 * 18 * (dy + 0.9)); e.leapCd = 2.2;
        const tt = e.vy / 18 * 1.6; e.vel.copy(toP).multiplyScalar(Math.min(9, dist / tt + 1)); e.grounded = false;
        this.hooks.audio.play('growl', this.spatial(e, { brute: false }));
      }
      this.unstick(e, dir, dt, dist);
      // facing + gait
      // stride speed = actual ground speed this frame (after collisions), measured along the body
      const mvx = (e.pos.x - e.prePos.x) / dt, mvz = (e.pos.z - e.prePos.z) / dt;
      const sp = Math.max(0, Math.hypot(mvx, mvz) * 0.4 + Math.max(0, mvx * Math.sin(e.yaw) + mvz * Math.cos(e.yaw)) * 0.6);
      e.speedNow = damp(e.speedNow, Math.min(sp, e.speed * 1.9 + 1), 12, dt);
      e.phase += dt * (e.crawl ? (e.speedNow / e.scale) * (Math.PI * 2 / 0.56) + 0.4 : sp * 2.05 / e.scale + 0.5);
      // attack
      e.attackCd -= dt;
      if (e.aware && e.attackT < 0 && e.attackCd <= 0 && dist < reach && Math.abs(dy) < 1.3 && P.alive && e.charge < 0 && (!T.boss || e.bs === 'walk')) {
        e.attackT = 0; this.hooks.audio.play('growl', this.spatial(e, { brute: T.brute }));
      }
      if (e.attackT >= 0) {
        const before = e.attackT; e.attackT += dt;
        if (before < T.windup && e.attackT >= T.windup) {
          this.hooks.audio.play('swing', this.spatial(e));
          if (!e.lured && dist < reach + 0.45 && Math.abs(dy) < 1.4 && e.stagger <= 0) this.hooks.onPlayerHit?.(T.dmg * (e.dmgMul ?? 1) * (e.armless ? 0.45 : e.crawl ? 0.7 : 1), e.pos, e);
        }
        if (e.attackT > T.windup + 0.35) { e.attackT = -1; e.attackCd = T.cd * rand(0.8, 1.2); }
      }
      if (T.ranged && e.aware && !e.outside && !e.lured && P.alive && !e.crawl) this.updateSpit(e, dt, dist);
      e.spitRecoil = Math.max(0, e.spitRecoil - dt * 3);
      // ambient voices
      e.growlT -= dt;
      if (e.growlT <= 0 && this.growlT <= 0) { this.hooks.audio.play('growl', this.spatial(e, { brute: T.brute })); e.growlT = rand(3, 8); this.growlT = 0.35; }
      // flinch springs
      e.flinchV += (-e.flinch * 140 - e.flinchV * 14) * dt; e.flinch += e.flinchV * dt;
      e.headSnapV += (-e.headSnap * 160 - e.headSnapV * 12) * dt; e.headSnap += e.headSnapV * dt;
      e.twistV += (-e.twist * 120 - e.twistV * 12) * dt; e.twist += e.twistV * dt;
      e.flash = Math.max(0, e.flash - dt * 9);
      this.animate(e, dt);
    }
    this.updateProjectiles(dt);
    this.updateLimbs(dt);
    this.updatePuddles(dt);
    // recycle burned corpses
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.dissolve >= 1) { this.enemies.splice(i, 1); this.releaseRig(e); this.pool.push(e); if (e === this.boss) this.boss = null; }
    }
    this.syncRigs();
    this.updateBossRig(time);
  }
  // ---------------------------------------------------------------- boss
  bossBrain(e, dt, dist, dy, toP, dir, want) {
    const P = this.player, H = this.hooks;
    e.chargeCd -= dt; e.slamCd -= dt; e.bt += dt;
    if (!e.aware || e.outside) return want;
    switch (e.bs) {
      case 'walk':
        if (dist < 5.8 && e.slamCd <= 0 && Math.abs(dy) < 2 && e.attackT < 0) { e.bs = 'slamWind'; e.bt = 0; H.audio.play('growl', this.spatial(e, { brute: true })); return 0; }
        if (dist > 8 && dist < 26 && e.chargeCd <= 0 && e.attackT < 0 && Math.abs(dy) < 1.5 && this.los(e.joints[J.chest], P.pos.clone().setY(P.pos.y + 1.2))) {
          e.bs = 'chargeWind'; e.bt = 0; H.audio.play('roar', { gain: 0.7 }); H.onShake?.(0.12); return 0;
        }
        return want;
      case 'chargeWind':
        e.facePlayer = true;
        if (e.bt > 0.95) { e.bs = 'charge'; e.bt = 0; e.chargeDir.copy(toP); e.chargeHit = false; }
        return 0;
      case 'charge': {
        dir.copy(e.chargeDir);
        if (Math.random() < 0.5) this.hooks.fx.smoke(e.pos.clone().setY(e.pos.y + 0.2), e.chargeDir.clone().negate(), 1.4);
        if (!e.chargeHit && dist < 2.8 && Math.abs(dy) < 1.8) { e.chargeHit = true; H.onPlayerHit?.(36, e.pos, e, { knock: 15 }); H.onShake?.(0.6); }
        const ahead = toP.x * e.chargeDir.x + toP.z * e.chargeDir.z;
        if (e.bt > 1.6 || (ahead < -0.2 && dist > 4)) { e.bs = 'stun'; e.bt = 0; e.stunDur = 1.2; }
        return 15;
      }
      case 'stun':
        if (e.bt > e.stunDur) { e.bs = 'walk'; e.bt = 0; e.chargeCd = rand(7, 10); }
        return 0;
      case 'slamWind':
        e.facePlayer = true;
        if (e.bt > 1.0) {
          e.bs = 'slamRecover'; e.bt = 0; e.slamCd = rand(5, 7);
          const hit = e.pos.clone().addScaledVector(toP, 1.6 * e.scale * 0.5);
          this.hooks.fx.slam(hit, 8.5); H.audio.play('slam');
          const d = Math.hypot(P.pos.x - hit.x, P.pos.z - hit.z);
          H.onShake?.(clamp(1.1 - d / 22, 0.3, 0.95));
          if (P.grounded && d < 7.5 && Math.abs(P.pos.y - e.pos.y) < 1.6) H.onPlayerHit?.(34 * (1 - (d / 7.5) * 0.55), hit, e, { knock: 10 });
        }
        return 0;
      case 'slamRecover':
        if (e.bt > 0.75) { e.bs = 'walk'; e.bt = 0; }
        return 0;
    }
    return want;
  }

  // ---------------------------------------------------------------- spitter
  los(a, b) {
    const d = tA.copy(b).sub(a); const L = d.length(); d.divideScalar(L || 1);
    for (const c of this.colliders) if (rayAABB(a.x, a.y, a.z, d.x, d.y, d.z, c, L, tN) >= 0) return false;
    return true;
  }
  mouth(e, out) { return out.copy(e.joints[J.head]).add(tB.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).multiplyScalar(0.16 * e.scale)); }
  updateSpit(e, dt, dist) {
    const P = this.player;
    e.spitCd -= dt;
    if (e.charge < 0) {
      if (e.spitCd > 0 || e.attackT >= 0 || e.stagger > 0) return;
      if (dist > 3.5 && dist < 28 && this.los(e.joints[J.head], tC.copy(P.pos).setY(P.pos.y + 1.2))) {
        const pr = this.proj.find((q) => q.state === 'free');
        if (!pr) { e.spitCd = 0.5; return; }
        e.charge = 0; e.orb = pr; pr.state = 'hold'; pr.mesh.visible = true; pr.mesh.scale.setScalar(0.01);
        this.hooks.audio.play('spitCharge', this.spatial(e));
      } else e.spitCd = 0.4;
      return;
    }
    e.charge += dt; e.facePlayer = true;
    const k = Math.min(1, e.charge / SPIT_CHARGE);
    const pr = e.orb; this.mouth(e, pr.mesh.position); pr.mesh.scale.setScalar(0.03 + 0.1 * k * (0.9 + 0.1 * Math.sin(e.charge * 40)));
    if (k < 1) return;
    // launch a lobbed glob at where the player is heading (half lead, so strafing dodges it)
    const start = pr.mesh.position, tgt = tC.copy(P.pos);
    tgt.y += 1.0;
    const T = clamp(dist / 13, 0.6, 1.45);
    tgt.x += P.vel.x * T * 0.5; tgt.z += P.vel.z * T * 0.5;
    pr.vel.copy(tgt).sub(start).divideScalar(T); pr.vel.y += 0.5 * SPIT_G * T;
    pr.state = 'fly'; pr.life = 3; pr.trailT = 0; pr.mesh.scale.setScalar(0.11);
    e.orb = null; e.charge = -1; e.spitCd = rand(2.6, 3.8); e.spitRecoil = 1;
    this.hooks.audio.play('spit', this.spatial(e));
  }
  cancelSpit(e) {
    if (e.orb) { e.orb.state = 'free'; e.orb.mesh.visible = false; e.orb = null; }
    e.charge = -1; e.spitCd = Math.max(e.spitCd, 1.2);
  }
  updateProjectiles(dt) {
    const P = this.player;
    for (const pr of this.proj) {
      if (pr.state !== 'fly') continue;
      const p = pr.mesh.position;
      pr.vel.y -= SPIT_G * dt; p.addScaledVector(pr.vel, dt); pr.life -= dt;
      pr.trailT -= dt; if (pr.trailT <= 0) { this.hooks.fx.acidTrail(p); pr.trailT = 0.03; }
      // player capsule
      const cy = clamp(p.y, P.pos.y + 0.3, P.pos.y + 1.5);
      if (Math.hypot(p.x - P.pos.x, p.y - cy, p.z - P.pos.z) < 0.55) { this.explode(pr, p, true); continue; }
      const g = this.groundAt(p.x, p.z, p.y, 0);
      if (p.y <= g + 0.05) { p.y = g; this.explode(pr, p, false, true); continue; }
      let wall = false;
      for (const c of this.colliders) if (p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.minY && p.y < c.maxY) { wall = true; break; }
      if (wall || pr.life <= 0 || p.y < -5) this.explode(pr, p, false, false);
    }
  }
  explode(pr, at, direct, ground) {
    const P = this.player, pt = at.clone();
    pr.state = 'free'; pr.mesh.visible = false;
    const idx = this.hooks.fx.acidBurst(pt, !!ground);
    if (ground) this.puddles.push({ pos: pt, t: 4.5, idx });
    const d = Math.hypot(pt.x - P.pos.x, pt.z - P.pos.z, Math.max(0, Math.abs(pt.y - (P.pos.y + 0.9)) - 0.8));
    const dd = Math.hypot(pt.x - P.pos.x, pt.z - P.pos.z);
    this.hooks.audio.play('splash', { gain: clamp(10 / (dd + 4), 0.15, 1) });
    if (direct || d < 2.6) this.hooks.onAcid?.(direct ? 28 : 24 * (1 - d / 2.6) + 6, pt);
  }
  updatePuddles(dt) {
    const P = this.player;
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const q = this.puddles[i]; q.t -= dt;
      if (q.t <= 0) { if (q.idx !== undefined) this.hooks.fx.acid.hide(q.idx); this.puddles.splice(i, 1); continue; }
      if (P.grounded && Math.hypot(P.pos.x - q.pos.x, P.pos.z - q.pos.z) < 1.2 && Math.abs(P.pos.y - q.pos.y) < 0.5) this.hooks.onAcid?.(11 * dt, q.pos, true);
    }
  }

  // ---------------------------------------------------------------- severed limbs
  updateStumps(e, dt) {
    for (let i = e.stumps.length - 1; i >= 0; i--) {
      const st = e.stumps[i]; st.t -= dt;
      if (st.t <= 0 || e.dissolve > 0.2) { e.stumps.splice(i, 1); continue; }
      const j = e.joints[st.j];
      tA.copy(j).sub(e.joints[st.j === J.chest ? J.pelvis : J.chest]); tA.y += 0.35; tA.normalize();
      if (e.type.hue) { if (Math.random() < 0.7) this.hooks.fx.stumpSpray(j, tA, true); continue; }
      // arterial pumping: strong pulses that weaken as it bleeds out
      st.ph = (st.ph || 0) + dt * 8.5;
      const pulse = Math.max(0, Math.sin(st.ph)) * Math.min(1, st.t / 1.5 + 0.25);
      if (pulse > 0.25) for (let k = 0; k < 2; k++) this.hooks.fx.artery(j, tA, pulse);
      else if (Math.random() < 0.3) this.hooks.fx.stumpSpray(j, tA, false);
    }
  }
  updateLimbs(dt) {
    const steps = clamp(Math.round(dt * 120), 1, 4), h = 1 / 120;
    for (let i = this.limbs.length - 1; i >= 0; i--) {
      const L = this.limbs[i]; L.t += dt;
      if (L.t > 2.6) L.dis = Math.min(1, L.dis + dt / 1.3);
      if (L.dis >= 1) { this.limbs.splice(i, 1); this.releaseLimb(L); this.limbPool.push(L); continue; }
      if (L.rig) L.rig.u.uDiss.value = L.dis * 1.05;
      if (L.t > 4) continue;
      for (let st = 0; st < steps; st++) {
        for (let k = 0; k < L.n; k++) {
          const j = L.pts[k], p = L.prev[k];
          const vx = (j.x - p.x) * 0.996, vy = (j.y - p.y) * 0.996, vz = (j.z - p.z) * 0.996;
          p.copy(j); j.x += vx; j.y += vy - 18 * h * h; j.z += vz;
        }
        for (let it = 0; it < 2; it++) for (let k = 0; k < L.n - 1; k++) this.constrain(L.pts[k], L.pts[k + 1], L.len[k]);
        for (let k = 0; k < L.n; k++) {
          const j = L.pts[k], rad = 0.06 * L.scale, g = this.groundAt(j.x, j.z, j.y, 0);
          if (j.y < g + rad) { j.y = g + rad; const p = L.prev[k]; p.x = lerp(p.x, j.x, 0.3); p.z = lerp(p.z, j.z, 0.3); if (p.y < j.y) p.y = lerp(p.y, j.y, 0.6); }
        }
      }
      if (L.rig) poseLimb(L.rig, L.pts.slice(0, L.n));
      if (Math.random() < 0.25 && L.t < 1.5) this.hooks.fx.stumpSpray(L.pts[0], tA.set(0, 1, 0), !!L.hue);
    }
  }
  spatial(e, o = {}) {
    const P = this.player, dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    return { ...o, pan: clamp((dx * rx + dz * rz) / (d + 1), -0.9, 0.9), gain: clamp(10 / (d + 4), 0.06, 1) };
  }

  // legless: dragging itself along on its arms
  poseCrawl(e) {
    const s = e.scale, ph = e.phase, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const att = e.attackT >= 0 ? Math.sin(Math.min(1, e.attackT / (e.type.windup + 0.2)) * Math.PI) : 0;
    const pelvis = V(0, 0.2, 0), chest = V(Math.sin(ph) * 0.03, 0.34 + att * 0.15, 0.46 + att * 0.1);
    const head = chest.clone().add(V(Math.sin(e.headSnap * 0.5) * 0.05, 0.17 + 0.02 * Math.sin(ph * 2), 0.15));
    const lSh = chest.clone().add(V(-0.2, -0.04, -0.02)), rSh = chest.clone().add(V(0.2, -0.04, -0.02));
    const arm = (sh, sx, off) => {
      const k = Math.sin(ph + off), f = 0.5 + 0.5 * k;
      const el = sh.clone().add(V(sx * 0.2, 0.05 + 0.12 * Math.max(0, k), 0.05 + 0.16 * f));
      const ha = V(el.x + sx * 0.04, 0.04 + 0.1 * Math.max(0, k) + att * 0.3, el.z + 0.2 + 0.12 * f + att * 0.3);
      return [el, ha];
    };
    const [lEl, lHa] = arm(lSh, -1, 0), [rEl, rHa] = arm(rSh, 1, Math.PI);
    const leg = (sx) => {
      const hip = pelvis.clone().add(V(sx * 0.1, 0, -0.03));
      const knee = hip.clone().add(V(sx * 0.07, -0.1 + 0.03 * Math.sin(ph * 1.3 + sx), -0.42));
      const foot = knee.clone().add(V(sx * 0.03, -0.04, -0.42));
      return [hip, knee, foot];
    };
    const [lHip, lKn, lFt] = leg(-1), [rHip, rKn, rFt] = leg(1);
    const Lp = [pelvis, chest, head, lSh, lEl, lHa, rSh, rEl, rHa, lHip, lKn, lFt, rHip, rKn, rFt];
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    for (let i = 0; i < NJ; i++) {
      const v = Lp[i];
      e.joints[i].set((v.x * cy + v.z * sy) * s + e.pos.x, v.y * s + e.pos.y, (-v.x * sy + v.z * cy) * s + e.pos.z);
    }
  }

  updateRagdoll(e, dt) {
    e.deadT += dt;
    if (e.deadT > 1.6) e.dissolve = Math.min(1, e.dissolve + dt / 1.3);
    if (e.deadT > 3.5) return;
    const steps = clamp(Math.round(dt * 120), 1, 4), h = 1 / 120;
    const s = e.scale;
    if (!e.near) {
      const c0 = e.joints[J.pelvis];
      e.near = this.colliders.filter((c) => c0.x > c.minX - 3 && c0.x < c.maxX + 3 && c0.z > c.minZ - 3 && c0.z < c.maxZ + 3);
    }
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i < NJ; i++) {
        const j = e.joints[i], p = e.prev[i];
        const vx = (j.x - p.x) * 0.995, vy = (j.y - p.y) * 0.995, vz = (j.z - p.z) * 0.995;
        p.copy(j);
        j.x += vx; j.y += vy - 18 * h * h; j.z += vz;
      }
      for (let it = 0; it < 3; it++) {
        for (const P of this.parts) this.constrain(e.joints[P.a], e.joints[P.b], this.restLen(e, P.a, P.b));
        for (const [a, b] of BRACES) this.constrain(e.joints[a], e.joints[b], this.restLen(e, a, b));
      }
      for (let i = 0; i < NJ; i++) {
        const j = e.joints[i], rad = 0.08 * s;
        let g = 0;
        for (const c of e.near) {
          if (j.x < c.minX || j.x > c.maxX || j.z < c.minZ || j.z > c.maxZ) continue;
          if (c.maxY <= j.y + 0.35) { if (c.maxY > g) g = c.maxY; continue; }
          if (j.y < c.minY) continue;
          // inside a wall: push out sideways
          const dxm = j.x - c.minX, dxM = c.maxX - j.x, dzm = j.z - c.minZ, dzM = c.maxZ - j.z, m = Math.min(dxm, dxM, dzm, dzM);
          if (m === dxm) j.x = c.minX; else if (m === dxM) j.x = c.maxX; else if (m === dzm) j.z = c.minZ; else j.z = c.maxZ;
        }
        if (j.y < g + rad) {
          j.y = g + rad;
          const p = e.prev[i]; p.x = lerp(p.x, j.x, 0.35); p.z = lerp(p.z, j.z, 0.35); // friction
        }
      }
    }
    if (e.deadT > 0.6 && !e.pooled) { e.pooled = true; const c = e.joints[J.chest]; this.hooks.fx.bloodPool(c, s, this.groundAt(c.x, c.z, c.y)); }
  }
  restLen(e, a, b) {
    const k = a * 16 + b;
    if (e.rest[k] === undefined) e.rest[k] = e.joints[a].distanceTo(e.joints[b]);
    return e.rest[k];
  }
  constrain(a, b, len) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const k = ((d - len) / d) * 0.5;
    a.x += dx * k; a.y += dy * k; a.z += dz * k; b.x -= dx * k; b.y -= dy * k; b.z -= dz * k;
  }

  // ---------------------------------------------------------------- skinned rigs
  // alive: pick + blend mocap clips from the brain state, then read the gameplay joints back
  animate(e, dt) {
    const R = e.rig, T = e.type;
    if (e.crawl) { this.poseCrawl(e); if (!e.crawlRef) { e.crawlRef = true; this.crawlBase(e); } solveFromJoints(R, e.joints, e.ref); return; }
    R.root.position.copy(e.pos); R.root.rotation.set(0, e.yaw, 0); R.root.scale.setScalar(e.scale);
    const G = e.gait, sp = e.speedNow / e.scale; // per unit of body scale
    // one-shot / state clips
    let clip = null, ts = 1, start = 0;
    if (e.attackT >= 0) { clip = e.attackSide ? 'attack2' : 'attack'; ts = 2.0 / (T.windup + 0.35) * (T.boss ? 0.8 : 1); start = 0.9; }
    else if (e.charge >= 0) { clip = 'scream'; ts = 1.6; start = 0.4; }
    else if (T.boss && e.bs === 'chargeWind') { clip = 'scream'; ts = 1.4; start = 0.4; }
    else if (T.boss && e.bs === 'slamWind') { clip = 'attack2'; ts = 1.25; start = 0.9; }
    else if (T.boss && e.bs === 'stun') { clip = 'hit'; ts = 0.8; }
    if (e.attackT >= 0 && e.anim !== 'attack' && e.anim !== 'attack2') { e.attackSide = Math.random() < 0.5; clip = e.attackSide ? 'attack2' : 'attack'; }
    // locomotion blend tree: idle -> walk -> run by ground speed, both stride-matched and phase-locked
    const W = GAIT.walk, Rn = GAIT.run;
    const walkTop = W.speed * G.walkMax, runLow = Rn.speed * G.runMin;
    const b = T.noRun ? 0 : clamp((sp - walkTop) / Math.max(0.05, runLow - walkTop), 0, 1);
    const cycleDist = lerp(W.speed * W.cycle, Rn.speed * Rn.cycle, b) * G.stride; // metres per full gait cycle
    // limp: uneven cadence inside the cycle (one leg hurried, one dragged)
    const ph = e.gph % 1;
    const limpK = 1 + G.limp * Math.sin(ph * Math.PI * 2 + G.limpSide);
    e.gph += dt * (sp / cycleDist) * limpK * G.cadence;
    const idleW = clamp(1 - (sp - 0.06) / 0.22, 0, 1);
    const targets = {};
    if (clip) targets[clip] = 1;
    else { targets.idle = idleW; targets.walk = (1 - idleW) * (1 - b); targets.run = (1 - idleW) * b; }
    if (clip && e.anim !== clip) { const A = R.actions[clip]; A.enabled = true; A.reset(); A.play(); A.time = start; }
    e.anim = clip || 'loco';
    const ph2 = (e.gph + G.offset) % 1;
    blendLayers(R, targets, dt, clip ? 9 : 7, clip ? null : { walk: ph2, run: ph2 }, clip ? { [clip]: ts } : { idle: 1 });
    R.mixer.update(dt);
    this.gaitLayer(e, sp, b, ph2, dt);
    // hit reactions layered on top of the clip: torso jerk, head snap, twist
    const B = R.bones;
    if (B.Spine) B.Spine.quaternion.multiply(tmpQ.setFromAxisAngle(tX.set(1, 0, 0), clamp(e.flinch, -0.9, 0.9) * 0.8));
    if (B.Spine1) B.Spine1.quaternion.multiply(tmpQ.setFromAxisAngle(tX.set(0, 1, 0), clamp(e.twist, -0.8, 0.8)));
    if (B.Head) B.Head.quaternion.multiply(tmpQ.setFromAxisAngle(tX.set(1, 0, 0), clamp(e.headSnap, -1, 1) * 0.9));
    if (e.spitRecoil > 0 && B.Spine1) B.Spine1.quaternion.multiply(tmpQ.setFromAxisAngle(tX.set(1, 0, 0), 0.5 * e.spitRecoil));
    for (let pi = 1; pi < 10; pi++) if (e.lost & (1 << pi)) B[PART_BONE[pi]].scale.setScalar(0.0001);
    R.root.updateMatrixWorld(true);
    readJoints(R, e.joints, e.scale);
  }
  // procedural layer over the mocap: reaching / swinging arms, lurch, limp hip drop, heavy boss stomp
  gaitLayer(e, sp, b, ph, dt) {
    const R = e.rig, B = R.bones, G = e.gait, T = e.type;
    R.root.updateMatrixWorld(true);
    const right = tX.set(1, 0, 0).applyQuaternion(R.root.quaternion);
    const fwd = tZ.set(0, 0, 1).applyQuaternion(R.root.quaternion);
    const moving = clamp(sp / 0.5, 0, 1);
    const s2 = Math.sin(ph * Math.PI * 2);
    // arms: reach toward prey when hunting nearby, otherwise a loose swing opposite to the legs
    e.reachNow = damp(e.reachNow || 0, e.aware && e.hunt ? G.reach : G.reach * 0.25, 3, dt);
    const swing = G.swing * moving * (1 - 0.6 * e.reachNow);
    const armRot = (bone, side, extra) => {
      if (!bone || !bone.parent) return;
      const ang = -(e.reachNow * (1.15 + extra) + swing * s2 * side);
      worldRotate(bone, right, ang);
    };
    if (!(e.lost & (1 << 2))) armRot(B.LeftArm, 1, G.armL);
    if (!(e.lost & (1 << 4))) armRot(B.RightArm, -1, G.armR);
    // elbows bend a little when reaching so the hands claw forward instead of pointing
    if (B.LeftForeArm && !(e.lost & (1 << 3))) worldRotate(B.LeftForeArm, right, -0.35 * e.reachNow);
    if (B.RightForeArm && !(e.lost & (1 << 5))) worldRotate(B.RightForeArm, right, -0.35 * e.reachNow);
    // lurch: torso pitches forward on each step + leans into the run
    const step = Math.abs(Math.sin(ph * Math.PI * 2));
    const pitch = G.lurch * moving * (0.55 + 0.45 * step) + 0.12 * b + (T.boss ? 0.1 * step : 0);
    if (B.Spine1) worldRotate(B.Spine1, right, pitch);
    // limp: hip drops and the torso rolls over the bad leg
    if (G.limp > 0 && B.Hips) worldRotate(B.Hips, fwd, G.limp * 0.5 * moving * s2 * (G.limpSide > 1 ? 1 : -1));
    // heavy stride: boss/brute torso dips on footfalls
    if ((T.boss || T.brute) && B.Hips) { const sc = B.Hips.parent.getWorldScale(tS).y || 1; B.Hips.position.y -= (T.boss ? 0.045 : 0.025) * e.scale * step * moving / sc; }
    // footfall thumps for the boss
    if (T.boss) { const k = Math.floor(ph * 2); if (k !== e.lastStep) { e.lastStep = k; if (moving > 0.5) { this.hooks.onShake?.(0.05); } } }
  }
  // crawlers: reference pose = the bind pose mapped through the procedural crawl joints
  crawlBase(e) {
    const R = e.rig, saved = e.joints.map((j) => j.clone());
    R.mixer.stopAllAction(); R.cur = null; e.anim = null;
    for (const b of Object.values(R.bones)) { const r = R.rest[b.name]; b.quaternion.copy(r.q); b.position.copy(r.p); }
    for (let pi = 1; pi < 10; pi++) if (e.lost & (1 << pi)) R.bones[PART_BONE[pi]].scale.setScalar(0.0001);
    R.root.updateMatrixWorld(true);
    readJoints(R, e.joints, e.scale);
    captureRef(R, e.joints, e.ref);
    for (let i = 0; i < saved.length; i++) e.joints[i].copy(saved[i]);
  }
  updateDeathClip(e, dt) {
    e.deadT += dt;
    if (e.deadT > (e.type.boss ? 5 : 3.2)) e.dissolve = Math.min(1, e.dissolve + dt / 1.3);
    if (e.deadT > 6) return;
    e.rig.mixer.update(dt);
    e.rig.root.updateMatrixWorld(true);
    readJoints(e.rig, e.joints, e.scale);
    if (e.deadT > 1.4 && !e.pooled) { e.pooled = true; const c = e.joints[J.chest]; this.hooks.fx.bloodPool(c, e.scale, this.groundAt(c.x, c.z, c.y)); }
  }
  syncRigs() {
    for (const e of this.enemies) {
      const R = e.rig; if (!R) continue;
      R.u.uFlash.value = e.flash; R.u.uDiss.value = e.dissolve * 1.05;
      R.u.uGlow.value = e.charge >= 0 ? 1 + 3 * Math.min(1, e.charge / SPIT_CHARGE) : 0.6;
      for (let i = 0; i < 10; i++) R.u.uWound.value[i] = e.wound[i];
      // corpses stop casting shadows once they start rotting away
      if (e.dead && e.dissolve > 0.3 && R.meshes[0].castShadow) for (const m of R.meshes) m.castShadow = false;
      else if (!e.dead && !R.meshes[0].castShadow) for (const m of R.meshes) m.castShadow = true;
    }
  }
}
