import * as THREE from 'three';
import './style.css';
import { Input } from './core/input.js';
import { clamp, lerp, damp, rand, rayAABB } from './core/util.js';
import { buildArena } from './world/arena.js';
import { WallBuys } from './world/wallbuys.js';
import { Stations } from './world/stations.js';
import { Drinks, drinkIconURL } from './world/drinks.js';
import { Barrels } from './world/barrels.js';
import { makeSky, SUN_DIR } from './world/sky.js';
import { Player } from './player.js';
import { Arsenal } from './weapons/arsenal.js';
import { Audio } from './audio.js';
import { Effects } from './fx/effects.js';
import { Post } from './post.js';
import { Horde } from './enemies.js';
import { Throwables, THROW, fragModel } from './throwables.js';
import { MacheteVM, MACHETE, POSES as BLADE_POSES } from './weapons/machete.js';
import { Minimap } from './minimap.js';
import { loadAssets } from './assets.js';
import { PERKS, PERK, dealPerks, SHOP } from './perks.js';
import { WEAPONS } from './weapons/defs.js';
import { PowerUps, POWER_TYPES, powerIconURL } from './powerups.js';
import { POWERUPS, FEEDBACK, BOSS_HIT, CRATE, FORGE, DRINKS, ENEMIES as EN, SPECIAL } from './tuning.js';
import { Areas } from './world/areas.js';
import { Nightfall } from './world/nightfall.js';

const DEG = Math.PI / 180;
const HIP_FOV = 70, VM_HIP_FOV = 54;
const QUALITY = {
  low: { pr: 0.7, shadow: 1024 },
  medium: { pr: 1, shadow: 2048 },
  high: { pr: Math.min(devicePixelRatio, 1.5), shadow: 2048 },
};
const $ = (id) => document.getElementById(id);
const fmtTime = (t) => { t = Math.max(0, Math.round(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

class Game {
  constructor(assets) {
    this.assets = assets;
    this.quality = localStorage.getItem('hf-q') || 'medium';
    this.state = 'menu'; // menu | play | paused | shop | dead
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
    // image-based lighting + reflections from a real dusk HDRI (Poly Haven, CC0), turned so its sun sits near ours
    this.env = pm.fromEquirectangular(assets.hdr).texture; assets.hdr.dispose();
    scene.environment = this.env; scene.environmentIntensity = 0.5;
    scene.environmentRotation.set(0, 2.2, 0);

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
    this.vmScene.environment = this.env; this.vmScene.environmentIntensity = 0.6; this.vmScene.environmentRotation.set(0, 2.2, 0);
    this.vmCamera = new THREE.PerspectiveCamera(VM_HIP_FOV, innerWidth / innerHeight, 0.01, 10);
    this.vmScene.add(this.vmCamera);
    this.vmSun = new THREE.DirectionalLight('#ffb27e', 2.6); this.vmScene.add(this.vmSun, this.vmSun.target);
    this.vmHemi = new THREE.HemisphereLight('#8a80b0', '#3b2a22', 1.2); this.vmScene.add(this.vmHemi);
    this.vmLocal = new THREE.PointLight('#ff8a3a', 0, 4, 2); this.vmScene.add(this.vmLocal);

    this.arena = buildArena(scene, this.quality, assets);
    this.barrels = new Barrels(scene, this.arena, assets); // adds its colliders before anyone copies the list
    this.player = new Player(this.arena.colliders);
    this.player.onLethal = () => this.secondWind();
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
      muzzleWorld: (mw, def) => {
        this.fx.muzzle(this.muzzleNow); this.flushPellets();
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.aim.quaternion);
        this.fx.smoke(this.muzzleNow, fwd, def.smoke ?? (def.id === 'sg' ? 1.6 : def.id === 'mr' ? 1.1 : 0.45));
      },
      onFire: (def) => { this.crossKick = 1; this.shake(def.shake ?? (def.id === 'sg' ? 0.16 : def.id === 'mr' ? 0.11 : 0.025)); this.horde.alert(this.player.pos, def.id === 'mr' ? 42 : 34); },
      onAmmo: () => (this.hudDirty = true),
      onSwap: () => (this.hudDirty = true),
      onDowngrade: (w) => this.stations?.removeCamo(w.model.root),
    });
    // M11: salvage crate + forge (solid props: their colliders go in before the nav grids are built)
    this.stations = new Stations(scene, this.arena.colliders, this.arsenal, {
      audio: this.audio,
      wave: () => this.horde?.wave || 0,
      spend: (n) => { if (this.pts < n) { this.audio.play('dry'); return false; } this.pts -= n; this.hudDirty = true; return true; },
      refund: (n) => { this.pts += n; this.hudDirty = true; },
      give: (id) => { const r = this.arsenal.give(id); const d = this.arsenal.all[id].def; this.feed(`<b>${d.name}</b>${d.rare ? ' · RARE' : ''}`, 0); return r; },
      banner: (t, sub, cls) => this.banner(t, sub, cls),
      areaOpen: (id) => !!this.areas?.isOpen(id),
      spark: (p, col, n) => this.spark(p, col, n),
      smoke: (p) => this.fx.alpha.spawn({ pos: p.clone(), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.8, 1.4), rand(-0.2, 0.2)), life: rand(1.4, 2.4), size: rand(0.12, 0.2), grow: 0.8, col: new THREE.Color(0.3, 0.29, 0.3), alpha: 0.3, drag: 1.2, grav: -0.2 }),
      upgraded: (w) => { this.announce('WEAPON UPGRADED', w.def.name, '#ff6af0'); this.shake(0.15); this.hudDirty = true; },
    });
    // M12: perk-drink machines (solid props too)
    this.drinksOwned = {};
    this.drinks = new Drinks(scene, this.arena.colliders, {
      audio: this.audio, vmCamera: this.vmCamera, owned: () => this.drinksOwned,
      spend: (n) => { if (this.pts < n) { this.audio.play('dry'); return false; } this.pts -= n; this.hudDirty = true; return true; },
      buy: (d) => this.drinkPerk(d),
    });

    // M13: locked areas (their walls + barrier colliders go in before the nav grids are built)
    this.areas = new Areas(scene, this.arena.colliders, {
      audio: this.audio,
      onOpen: (a) => this.areaOpened(a),
      onReset: () => this.areaLayoutChanged(),
    });

    this.blade = new MacheteVM(this.vmCamera, this.arsenal.models.materials);
    this.horde = new Horde(scene, this.arena, {
      assets, player: this.player, fx: this.fx, audio: this.audio,
      onPlayerHit: (dmg, from, e, o) => this.onPlayerHit(dmg, from, e, o),
      onKill: (e, info) => this.onKill(e, info),
      onBlastHit: (e, dmg, res, point) => this.onHit({ e, part: 'body', point }, dmg, res, true),
      onWaveStart: (n, count, boss, sp) => this.onWaveStart(n, count, boss, sp),
      onBoss: (e) => { this.banner('THE COLOSSUS', 'Armored. Hit the glowing head and back core', 'boss'); this.shake(0.4); $('bossbar').classList.add('on'); },
      onBossDead: () => { this.banner('COLOSSUS DOWN', '+3000', 'boss'); this.shake(0.8); this.hitstop = 0.25; $('bossbar').classList.remove('on'); },
      onShake: (a) => this.shake(a),
      onArmor: (p, dir) => this.spark(p, 0xffc070, 7),
      onCripple: (e) => this.feed('<b>BRUTE CRIPPLED</b>', 60),
      onBloaterBurst: (p, e) => this.bloaterBurst(p, e),
      onSever: (e, name) => { if (this.blasting) return; if (!e.dead || name === 'head') this.feed(name === 'head' ? '<b>DECAPITATED</b>' : '<b>DISMEMBERED</b>', 25); this.addScore(25); },
      onWaveEnd: (n) => this.onWaveEnd(n),
    });

    this.throwables = new Throwables(scene, this.arena.colliders, {
      horde: this.horde, audio: this.audio, camera: this.camera, player: this.player,
      explode: (p, k, o) => this.explode(p, k, o), onCount: () => (this.hudDirty = true),
    });
    // grenade held in the off hand while cooking
    this.vmFrag = fragModel(); this.vmFrag.scale.setScalar(0.55); this.vmFrag.position.set(-0.2, -0.16, -0.42); this.vmFrag.rotation.set(0.3, 0.4, 0.2); this.vmFrag.visible = false;
    this.vmCamera.add(this.vmFrag);
    this.wallbuys = new WallBuys(scene, this.arsenal, WEAPONS);
    this.powerups = new PowerUps(scene, { groundAt: (x, z, y) => this.horde.groundAt(x, z, y), audio: this.audio, walkable: (p) => this.walkableNear(p) });
    this.power = { bounty: 0, reaper: 0 }; this.slowT = 0;
    this.minimap = new Minimap($('minimap'), this.arena.colliders, this.wallbuys, { areas: this.areas, icons: () => [...this.stations.icons(), ...this.drinks.icons()] });
    this.nightfall = new Nightfall(this); this.lampMul = 1; this.lampFlick = 0;
    this.post = new Post(r, scene, this.camera, this.vmScene, this.vmCamera);
    this.applyQuality(this.quality);

    this.timer = new THREE.Timer(); this.timer.connect?.(document);
    this.time = 0; this.trauma = 0; this.hitstop = 0; this.damageFx = 0; this.crossKick = 0;
    this.score = 0; this.pts = 0; this.kills = 0; this.headshots = 0; this.shotsFired = 0; this.shotsHit = 0; this.runTime = 0;
    this.perks = {}; this.ptsMul = 1; this.shopT = 0;
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
    $('d-entry').onsubmit = (e) => this.saveScore(e);
    $('d-name').value = localStorage.getItem('hf-name') || '';
    $('d-name').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    $('lb-local').onclick = () => { this.lbTab = 'local'; this.renderBoard(); };
    $('lb-global').onclick = () => { this.lbTab = 'global'; this.renderBoard(); if (!this.global) this.fetchGlobal().then(() => this.renderBoard()); };
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
      if (e.code === 'KeyF' && this.state === 'play') {
        const st = this.stationTarget;
        if (this.areaTarget) { const A = this.areaTarget; if (this.pts < A.def.price) this.audio.play('dry'); else { this.pts -= A.def.price; this.hudDirty = true; this.areas.open(A); } }
        else if (this.drinkTarget) this.drinks.use(this.drinkTarget);
        else if (st?.kind === 'crate') this.stations.useCrate();
        else if (st?.kind === 'forge') this.stations.useForge();
        else if (this.wallTarget) this.buy('gun:' + this.wallTarget.id);
      }
      if (this.state === 'shop') {
        const k = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
        if (k >= 0) this.pickPerk(k);
        if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); this.readyUp(); }
      }
    });
    $('ready').onclick = () => this.readyUp();
    $('skip').onclick = () => this.skipPerk();
    const pool = $('dmgnums-layer');
    for (let i = 0; i < 28; i++) { const d = document.createElement('div'); d.className = 'dn'; pool.appendChild(d); this.dmgNums.push({ el: d, life: 0, pos: new THREE.Vector3() }); }
    this.show('menu');
  }
  show(screen) {
    for (const id of ['menu', 'pause', 'dead', 'shop']) $(id).classList.toggle('on', id === screen);
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
    this.score = 0; this.pts = 0; this.kills = 0; this.headshots = 0; this.shotsFired = 0; this.shotsHit = 0; this.deadT = 0; this.runTime = 0;
    this.perks = {}; this.drinksOwned = {}; this.shopT = 0; this.applyPerks(); this.renderPerkRow(); this.barrels.respawn(); this.throwables.reset(); this.blade.reset(); this.powerups.reset(); this.stations.reset(); this.drinks.reset(); this.areas.reset(); this.nightfall.snap(1); this.immuneT = 0; this.renderDrinks(); this.power.bounty = this.power.reaper = 0; this.horde.instaKill = false; this.slowT = 0; this.audio.pitch = 1; this.renderPowers(); this.arsenal.bladeOut = false;
    this.damageFx = 0; this.minHpFrac = 1; this.gaspUsed = false; this.specialLive = null; this.screenBlood = 0; this.hudDirty = true; $('bossbar').classList.remove('on');
    this.horde.start();
    this.state = 'play';
    if (!fromMenu) this.input.lock();
    if (this.input.locked || this.forceLock) this.show(null);
  }
  onLock(locked) {
    if (this.state === 'shop') return;
    if (locked) {
      if (this.state === 'paused' || this.state === 'play') { this.state = 'play'; this.show(null); }
    } else if (this.state === 'play') { this.state = 'paused'; this.show('pause'); }
  }
  // M13: a barrier was bought — new layout for nav + minimap, its spawns switch on
  areaOpened(a) {
    this.areaLayoutChanged();
    this.banner(a.def.name + ' OPEN', a.def.id === 'roof' ? 'Up the stairs: LAST GASP TONIC waits on the roof' : 'The salvage crate can turn up down here now', 'area');
    this.feed(`<b>${a.def.name}</b> opened`, 0); this.shake(0.12);
  }
  areaLayoutChanged() {
    this.horde.rebuildNav(); this.horde.extraSpawns = this.areas.openSpawns(); this.minimap?.rebake();
  }
  banner(title, sub, cls = '', color = '') {
    const b = $('banner'); $('banner-t').textContent = title; $('banner-s').textContent = sub;
    b.classList.remove('on', 'boss', 'crate', 'area', 'special'); if (color) b.style.setProperty('--sc', color); void b.offsetWidth; b.classList.add('on'); if (cls) b.classList.add(cls);
    if (title.startsWith('WAVE') && !title.includes('CLEARED')) this.audio.play('waveStart');
  }
  // M14: wave start (special waves get their own banner, siren and colour)
  onWaveStart(n, count, boss, sp) {
    this.powerups?.newWave(n, sp?.drops || 0);
    this.minHpFrac = 1; this.gaspUsed = false; this.specialLive = sp || null;
    if (boss) return this.banner(`BOSS WAVE ${n}`, 'Something big is coming', 'boss');
    if (sp) { this.banner(sp.name, `${sp.sub} · ${count} inbound`, 'special', sp.color); this.audio.play('special'); this.shake(0.25); this.hudDirty = true; return; }
    this.banner(`WAVE ${n}`, `${count} hostiles inbound`);
  }
  // M14: a Bloater popped. Blast the husks (and you, if too close), splash gore
  bloaterBurst(p, e) {
    const B = EN.bloater.blast;
    this.audio.play('bloaterBurst', { gain: clamp(16 / (this.camera.position.distanceTo(p) + 5), 0.3, 1) });
    this.fx.gib?.(p, new THREE.Vector3(0, 1, 0), 12, this.horde.groundAt(p.x, p.z, p.y));
    this.explode(p, B.radius / 6.5, { radius: B.radius, dmg: B.zombieDmg, pmax: B.playerDmg, noFx: false });
    this.bloaterBlasts = (this.bloaterBlasts || 0) + 1;
  }
  shake(a) { this.trauma = Math.min(1, this.trauma + a); }

  // ------------------------------------------------------------ explosions (fuel drums, explosive rounds)
  explode(p, k = 1, opts = {}) {
    const g = this.horde.groundAt(p.x, p.z, p.y);
    this.fx.explosion(p, k, g);
    const eye = this.camera.position, d = eye.distanceTo(p);
    this.audio.play('explosion', { k, gain: clamp(16 / (d + 5), 0.25, 1) });
    const R = opts.radius ?? 6.5 * k;
    const kills = this.horde.blast(p, R, opts.dmg ?? 260 * k);
    if (kills >= 3) this.feed(`<b>${kills}× MULTI-KILL</b>`, 50 * kills), this.addScore(50 * kills);
    for (const b of this.barrels.near(p, 4.6 * Math.max(k, 0.6))) this.barrels.damage(b, 999, 0.1 + b.pos.distanceTo(p) * 0.05);
    const P = this.player, pd = P.pos.clone().setY(P.pos.y + 0.9).distanceTo(p);
    if (!opts.noSelf && pd < R && P.alive) {
      const f = 1 - pd / R;
      this.onPlayerHit(opts.pmax ? Math.round(opts.pmax * (0.35 + 0.65 * f)) : Math.round(70 * f * f + 8 * f) + (opts.inHand ? 15 : 0), p, null, { knock: 9 * f, blast: true });
    }
    this.shake(clamp(1.15 * k * (1 - d / 30), 0.05, 1));
    if (d < 14 && k >= 0.8) this.hitstop = Math.max(this.hitstop, 0.06);
  }
  // ------------------------------------------------------------ M12 perk drinks
  drinkPerk(d) {
    this.drinksOwned[d.id] = true; this.applyPerks();
    if (d.hp) this.player.health = this.player.maxHealth;
    const tint = $('drinktint'); tint.style.setProperty('--c', d.color); tint.classList.remove('on'); void tint.offsetWidth; tint.classList.add('on');
    this.announce(d.name, d.blurb, d.color); this.audio.play('drinkDone', { id: d.id });
    this.renderDrinks(); this.hudDirty = true;
  }
  renderDrinks() {
    const box = $('drinkicons');
    box.innerHTML = DRINKS.list.filter((d) => this.drinksOwned[d.id]).map((d) => `<div class="dk" style="--c:${d.color}" title="${d.name}"><img src="${drinkIconURL(d)}" alt=""><span>${d.name.split(' ').slice(0, -1).join(' ')}</span></div>`).join('');
  }
  // LAST GASP TONIC: a killing blow puts you back on your feet once
  secondWind() {
    if (!this.drinksOwned.lastgasp) return false;
    this.gaspUsed = true;
    const R = DRINKS.list.find((d) => d.id === 'lastgasp').revive, P = this.player;
    delete this.drinksOwned.lastgasp; this.renderDrinks();
    P.health = R.hp; this.immuneT = R.immune;
    const p = P.pos.clone(); p.y += 0.9;
    for (const e of this.horde.enemies) { if (e.dead) continue; const v = e.pos.clone().sub(P.pos); v.y = 0; const dd = v.length(); if (dd < R.push && !e.type.boss) { e.kb.addScaledVector(v.normalize(), 12 * (1 - dd / R.push)); } }
    this.horde.blast(p, 4, R.dmg);
    const tint = $('drinktint'); tint.style.setProperty('--c', '#b47bff'); tint.classList.remove('on'); void tint.offsetWidth; tint.classList.add('on');
    this.announce('LAST GASP', 'Back on your feet. Make it count', '#b47bff'); this.audio.play('secondWind'); this.shake(0.6); this.hitstop = 0.2;
    return true;
  }
  // ------------------------------------------------------------ points, perks, intermission shop
  addScore(n, kill = false) {
    if (this.power.bounty > 0) n *= POWERUPS.bounty.mult; // BOUNTY ×2
    this.score += n; this.pts += Math.round(kill ? n * this.ptsMul : n); this.hudDirty = true;
  }
  applyPerks() {
    const L = (id) => this.perks[id] || 0, P = this.player;
    const D = (id) => (this.drinksOwned?.[id] ? DRINKS.list.find((d) => d.id === id) : null);
    this.arsenal.setMods({ dmg: 1 + 0.15 * L('dmg'), rof: (1 + 0.12 * L('rof')) * (D('hairtrigger')?.rof || 1), reload: (1 + 0.25 * L('reload')) * (D('snapload')?.reload || 1), mag: 1 + 0.3 * L('mag'), head: 1 + 0.3 * L('head'), explosive: L('boom') });
    P.maxHealth = 100 + 25 * L('hp') + (D('bulwark')?.hp || 0); P.health = Math.min(P.health, P.maxHealth);
    P.regenDelay = 4 * Math.pow(0.65, L('regen')); P.regenRate = 30 * (1 + 0.5 * L('regen'));
    P.speedMul = 1 + 0.08 * L('speed');
    this.ptsMul = 1 + 0.25 * L('greed');
  }
  renderPerkRow() {
    $('perkrow').innerHTML = PERKS.filter((p) => this.perks[p.id]).map((p) => `<div class="pk ${p.cat}" title="${p.name}">${p.icon}<i>${this.perks[p.id]}</i></div>`).join('');
  }
  onWaveEnd(n) {
    this.banner(`WAVE ${n} CLEARED`, `+${250 * n} · Intermission`);
    const sp = this.specialLive; this.specialLive = null;
    if (sp) this.specialCleared(sp);
    this.audio.play('waveEnd'); this.addScore(250 * n); this.throwables.refillWave(); this.hudDirty = true;
    this.barrels.respawn(this.player.pos);
    this.onWaveCleared?.(n);
    this.shopT = 2.6; // let the banner land, then open the shop
  }
  specialCleared(sp) {
    const S = SPECIAL.bonus, s = sp.index, flawless = this.minHpFrac > S.flawlessHp && !this.gaspUsed && this.player.alive;
    const pts = Math.round(S.clear * (1 + 0.25 * s)), fl = flawless ? Math.round(S.flawless * (1 + 0.25 * s)) : 0;
    this.addScore(pts + fl);
    this.feed(`<b>${sp.name} CLEARED</b> +${pts}${flawless ? ` · FLAWLESS +${fl}` : ''}`, 0);
    const P = this.player, ang = P.yaw + Math.PI;
    const types = ['bounty', 'resupply', 'reaper', 'deadfall'], type = types[Math.floor(Math.random() * types.length)];
    for (let i = 0; i < S.reward; i++) { const q = this.walkableNear(P.pos.clone().add(new THREE.Vector3(Math.sin(ang) * 2.5, 0, Math.cos(ang) * 2.5))); this.powerups.spawn(type, q.x, q.z, q.y); }
  }
  openShop() {
    this.state = 'shop';
    this.shopDeal = dealPerks(this.perks); this.shopPicked = -1; this.shopLeft = 45;
    $('sh-wave').textContent = this.horde.wave;
    $('sh-s').textContent = this.shopDeal.length ? 'Choose one upgrade' : 'All upgrades maxed';
    const box = $('perks'); box.classList.remove('picked');
    box.innerHTML = this.shopDeal.map((p, i) => {
      const lv = this.perks[p.id] || 0;
      const pips = Array.from({ length: p.max }, (_, k) => `<i class="${k < lv ? 'on' : k === lv ? 'new' : ''}"></i>`).join('');
      return `<div class="card ${p.cat}" data-i="${i}"><div class="ic">${p.icon}</div><div class="cat">${p.cat}</div><div class="nm">${p.name}</div><div class="ds">${p.desc}</div><div class="lv">${pips}</div><div class="key">${i + 1}</div></div>`;
    }).join('');
    box.querySelectorAll('.card').forEach((c) => (c.onclick = () => this.pickPerk(+c.dataset.i)));
    $('skip').disabled = !this.shopDeal.length;
    this.renderBuys();
    this.audio.play('shopOpen');
    document.exitPointerLock?.();
    this.show('shop');
  }
  pickPerk(i) {
    if (this.state !== 'shop' || this.shopPicked >= 0 || !this.shopDeal[i]) return;
    const p = this.shopDeal[i]; this.shopPicked = i;
    this.perks[p.id] = (this.perks[p.id] || 0) + 1;
    if (p.id === 'hp') this.player.health += 25;
    this.applyPerks(); this.renderPerkRow();
    const box = $('perks'); box.classList.add('picked'); box.children[i].classList.add('sel');
    box.children[i].querySelector('.new')?.classList.replace('new', 'on');
    $('sh-s').textContent = `${p.name} acquired`; $('skip').disabled = true;
    this.audio.play('perk'); this.renderBuys();
  }
  skipPerk() {
    if (this.state !== 'shop' || this.shopPicked >= 0) return;
    this.shopPicked = 99; this.pts += 300; $('perks').classList.add('picked'); $('skip').disabled = true;
    $('sh-s').textContent = 'Upgrade skipped · +300 points'; this.audio.play('buy'); this.renderBuys();
  }
  shopItems() {
    const A = this.arsenal, P = this.player, items = [];
    items.push({ key: 'ammo', name: SHOP.ammo.name, desc: SHOP.ammo.desc, cost: SHOP.ammo.cost, ok: A.weapons.some((w) => w.reserve < w.def.reserve) });
    items.push({ key: 'armor', name: SHOP.armor.name, desc: SHOP.armor.desc, cost: SHOP.armor.cost, ok: P.armor < SHOP.armor.max });
    const T = this.throwables;
    items.push({ key: 'frag', name: SHOP.frag.name, desc: `${SHOP.frag.desc} · ${T.frags}/${THROW.frag.max}`, cost: THROW.frag.cost, ok: T.frags < THROW.frag.max });
    items.push({ key: 'screamer', name: SHOP.screamer.name, desc: `${SHOP.screamer.desc} · ${T.screamers}/${THROW.screamer.max}`, cost: THROW.screamer.cost, ok: T.screamers < THROW.screamer.max });
    for (const d of WEAPONS) {
      if (!d.cost || !A.all[d.id]) continue;
      const owned = A.owns(d.id);
      items.push({ key: 'gun:' + d.id, name: d.name, desc: owned ? 'Owned · refill its ammo' : A.weapons.length >= 3 ? `${d.type} · replaces ${A.current.def.short}` : d.type, cost: owned ? Math.round(d.cost / 2) : d.cost, ok: true, owned });
    }
    return items;
  }
  renderBuys() {
    const box = $('buys');
    box.innerHTML = this.shopItems().map((it) => `<button class="buy${it.owned ? ' owned' : ''}" data-k="${it.key}" ${it.ok && this.pts >= it.cost ? '' : 'disabled'}><span class="bn">${it.name}</span><span class="bd">${it.desc}</span><span class="bc">${it.cost.toLocaleString()}</span></button>`).join('');
    box.querySelectorAll('.buy').forEach((b) => (b.onclick = () => this.buy(b.dataset.k, b)));
    $('sh-pts').textContent = this.pts.toLocaleString();
    $('sh-hp').textContent = Math.round(this.player.health) + '/' + this.player.maxHealth; $('sh-armor').textContent = Math.round(this.player.armor);
  }
  buy(key, btn) {
    const it = this.shopItems().find((x) => x.key === key);
    if (!it || !it.ok || this.pts < it.cost) { this.audio.play('dry'); return false; }
    this.pts -= it.cost;
    if (key === 'ammo') this.arsenal.refill();
    else if (key === 'armor') this.player.armor = Math.min(SHOP.armor.max, this.player.armor + 50);
    else if (key === 'frag') this.throwables.frags++;
    else if (key === 'screamer') this.throwables.screamers++;
    else if (key.startsWith('gun:')) this.arsenal.give(key.slice(4));
    this.audio.play('buy'); this.hudDirty = true;
    if (this.state === 'shop') { this.renderBuys(); const nb = $('buys').querySelector(`[data-k="${key}"]`); nb?.classList.add('flash'); }
    return true;
  }
  updateWallPrompt() {
    const el = $('buyprompt');
    const b = this.state === 'play' ? this.wallbuys.nearest(this.player.pos, this.camera.getWorldDirection(this._wbDir || (this._wbDir = new THREE.Vector3()))) : null;
    const dk = this.state === 'play' && !b ? this.drinks.target(this.player.pos, this._wbDir) : null;
    const st = this.state === 'play' && !b && !dk ? this.stations.target(this.player.pos, this._wbDir) : null;
    const ar = this.state === 'play' && !b && !dk && !st ? this.areas.target(this.player.pos, this._wbDir) : null;
    this.wallTarget = b; this.stationTarget = st; this.drinkTarget = dk; this.areaTarget = ar;
    let html = '';
    if (ar) html = `<kbd>F</kbd> OPEN <b class="area">${ar.def.name}</b> <i>${ar.def.blurb}</i> <span class="${this.pts >= ar.def.price ? 'ok' : 'no'}">${ar.def.price.toLocaleString()}</span>`;
    if (dk) {
      const d = dk.d, n = Object.keys(this.drinksOwned).length;
      html = this.drinksOwned[d.id] ? `<i>${d.name} · ALREADY IN YOUR SYSTEM</i>`
        : n >= DRINKS.limit ? `<i>${d.name} · YOU CAN'T HOLD ANY MORE (${DRINKS.limit} MAX)</i>`
        : this.drinks.drinking ? '' : `<kbd>F</kbd> DRINK <b style="color:${d.color}">${d.name}</b> <i>${d.blurb}</i> <span class="${this.pts >= d.price ? 'ok' : 'no'}">${d.price.toLocaleString()}</span>`;
    }
    const price = (n) => `<span class="${this.pts >= n ? 'ok' : 'no'}">${n.toLocaleString()}</span>`;
    if (st?.kind === 'crate') {
      const A = this.arsenal, full = A.weapons.length >= 3;
      if (st.state === 'idle') html = `<kbd>F</kbd> SALVAGE CRATE · RANDOM WEAPON ${price(CRATE.cost)}`;
      else if (st.state === 'offer') { const d = A.all[st.id].def; html = `<kbd>F</kbd> TAKE ${d.rare ? '<b class="rare">' + d.name + '</b>' : d.name}${full ? ` <i>(swaps ${A.current.def.short})</i>` : ''}`; }
      else if (st.state === 'spin') html = `<i>SPINNING…</i>`;
    } else if (st?.kind === 'forge') {
      const A = this.arsenal, w = A.current, S = this.stations, cost = S.forgeCost();
      if (st.state === 'idle') {
        if (A.bladeOut || !w) html = `<i>THE FORGE · hold a gun to upgrade it</i>`;
        else if (w.up) html = `<i>${w.def.name} · ALREADY UPGRADED</i>`;
        else html = `<kbd>F</kbd> FORGE ${w.def.short} → ${FORGE.names[w.base.id] || w.def.name + ' MK II'} ${price(cost)}${this.horde.wave < FORGE.unlockWave ? ` <i>(${FORGE.cost.toLocaleString()} from wave ${FORGE.unlockWave})</i>` : ''}`;
      } else if (st.state === 'ready') html = `<kbd>F</kbd> TAKE <b class="up">${FORGE.names[S.forge.w.base.id] || S.forge.w.base.name + ' MK II'}</b>`;
      else html = `<i>FORGING…</i>`;
    }
    if (b) {
      const owned = this.arsenal.owns(b.id), cost = owned ? Math.round(b.def.cost / 2) : b.def.cost;
      const what = owned ? `${b.def.short} AMMO` : this.arsenal.weapons.length >= 3 ? `${b.def.name} <i>(swaps ${this.arsenal.current.def.short})</i>` : b.def.name;
      html = `<kbd>F</kbd> BUY ${what} <span class="${this.pts >= cost ? 'ok' : 'no'}">${cost.toLocaleString()}</span>`;
    }
    if (el.innerHTML !== html) { el.innerHTML = html; el.classList.toggle('on', !!html); }
  }
  readyUp() {
    if (this.state !== 'shop') return;
    this.state = 'play'; this.show(null);
    this.input.lock();
    this.horde.ready(2.5);
    this.banner(`WAVE ${this.horde.wave + 1}`, 'Incoming');
  }

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
    if (first) { this.vmToWorld(this.arsenal.muzzleWorld(), this.muzzleNow); this.shotsFired++; this.splatsThisShot = 0; this.boomThisShot = false; }
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
      const res = this.horde.damage(h.e, dmg, h.part, h.point, dir, def, h.pi);
      if (!h.e.type.hue && !res.armor) this.splatter(h.point, dir, def, h.part === 'head' || res.killed);
      if (res.killed) this.killFx(h, dir, def, res);
      this.onHit(h, dmg, res);
      hitAny = true;
      if (pierce-- <= 0) { endT = h.t; break; }
    }
    // rare guns: the HAILSTRIKE bolt blows up where it lands; the AURORA LANCE arcs into husks near each hit
    if (def.boom && first !== null) {
      const at = origin.clone().addScaledVector(dir, Math.max(0.5, (hitAny ? Math.min(endT, hits[0].t) : wallT) - 0.15));
      if (endT < 300 || wh) this.explode(at, 0.75, { radius: def.boom.radius, dmg: def.boom.dmg, noSelf: at.distanceTo(origin) > 3 });
    }
    if (def.zap && hitAny) {
      for (const h of hits) { if (h.t > endT + 0.01) break; this.zapArc(h.point, def); }
    }
    if (def.energy && endT === wallT && wh) this.spark(origin.clone().addScaledVector(dir, wallT), 0x58d6ff, 10);
    if (hitAny && def.explosive && first !== null && !this.boomThisShot && Math.random() < 0.1 * def.explosive) {
      this.boomThisShot = true; this.explode(origin.clone().addScaledVector(dir, Math.min(endT, hits[0].t)), 0.42, { noSelf: true, dmg: 75, radius: 2.8 });
    }
    if (endT === wallT && wh) {
      const p = origin.clone().addScaledVector(dir, wallT);
      if (wh.c.barrel) { const fall = clamp((wallT - def.falloffStart) / (def.falloffEnd - def.falloffStart), 0, 1); this.barrels.damage(wh.c.barrel, lerp(def.damage, def.damageMin, fall)); }
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
      const heavy = def.id === 'mr' || def.energy;
      if (end.distanceTo(from) > 2) this.fx.tracers.add(from, end, def.bolt ? 140 : heavy ? 520 : 400, def.energy ? 40 : def.bolt ? 1.2 : heavy ? 10 : 6, def.energy ? 0.07 : def.bolt ? 0.04 : heavy ? 0.03 : 0.02, def.tracerColor);
    }
  }
  spark(p, col, n = 8) {
    const c = new THREE.Color(col).multiplyScalar(4);
    for (let i = 0; i < n; i++) this.fx.add.spawn({ pos: p.clone(), vel: new THREE.Vector3(rand(-3, 3), rand(0.5, 5), rand(-3, 3)), life: rand(0.15, 0.45), size: rand(0.012, 0.028), col: c, grav: 12, drag: 2, kind: 1 });
  }
  // AURORA LANCE: a short arc of energy from the hit to husks standing close by
  zapArc(p, def) {
    this.spark(p, 0x58d6ff, 8);
    const Z = def.zap, near = this.horde.enemies.filter((e) => !e.dead && e.pos.distanceTo(p) < Z.radius + 0.6).slice(0, 3);
    for (const e of near) {
      const to = e.joints?.[1] || e.pos;
      if (to.distanceTo(p) < 0.5) continue;
      this.fx.tracers.add(p, to.clone(), 260, 3, 0.03, [0.4, 1.4, 3]);
    }
    this.horde.blast(p, Z.radius, Z.dmg);
  }
  // blood thrown past the target lands on the nearest wall behind it and on the ground
  splatter(point, dir, def, heavy) {
    if ((this.splatsThisShot = (this.splatsThisShot || 0) + 1) > (def.pellets > 1 ? 4 : 2)) return;
    const n = this.tmpN2 || (this.tmpN2 = new THREE.Vector3());
    const big = heavy || !(def.id === 'ar' || def.id === 'smg');
    const wh = this.raycastWorld(point, dir, big ? 4.5 : 3, n);
    if (wh && n.y < 0.7) this.fx.splat.add(point.clone().addScaledVector(dir, wh.t), n.clone(), rand(0.45, 0.8) * (big ? 1.5 : 1) * (1 - wh.t / 6), dir, 1.4);
    if (Math.random() < (big ? 0.9 : 0.5)) {
      const fwd = dir.clone().setY(0); const L = fwd.length(); if (L > 1e-3) fwd.divideScalar(L);
      const at = point.clone().addScaledVector(fwd, rand(0.4, big ? 1.8 : 1.1));
      const g = this.horde.groundAt(at.x, at.z, point.y);
      this.fx.splat.add(new THREE.Vector3(at.x, g + 0.012, at.z), new THREE.Vector3(0, 1, 0), rand(0.5, 0.9) * (big ? 1.5 : 1), fwd, 1.7);
    }
  }
  // kill flourish: chunks on violent kills, screen splash when it happens in your face
  killFx(h, dir, def, res) {
    const e = h.e; if (e.type.hue) return;
    const dist = h.point.distanceTo(this.camera.position);
    const violent = (def.id === 'sg' && dist < 7) || ((def.id === 'mr' || def.id === 'rv') && (res.head || dist < 12)) || def.id === 'melee' || e.type.boss;
    if (violent) {
      const g = this.horde.groundAt(h.point.x, h.point.z, h.point.y);
      this.fx.gib(h.point, dir, e.type.boss ? 16 : res.head ? 7 : 9, g);
      const n = this.tmpN2 || (this.tmpN2 = new THREE.Vector3());
      for (let i = 0; i < 3; i++) {
        const d2 = dir.clone().add(new THREE.Vector3(rand(-0.35, 0.35), rand(-0.2, 0.3), rand(-0.35, 0.35))).normalize();
        const wh = this.raycastWorld(h.point, d2, 5, n);
        if (wh && n.y < 0.7) this.fx.splat.add(h.point.clone().addScaledVector(d2, wh.t), n.clone(), rand(0.8, 1.3), d2, 1.5);
      }
    }
    if (dist < 4.2) { this.screenBlood = Math.min(1, (this.screenBlood || 0) + (violent ? 1 : 0.7)); this.post.u.bloodSeed.value = Math.random(); }
  }
  onHit(h, dmg, res, quiet = false) {
    if (res.corpse) return;
    if (h.e.type.boss && !res.killed) this.addScore(res.weak ? BOSS_HIT.weak : BOSS_HIT.armor); // every shot on the Colossus pays
    const head = h.part === 'head';
    const mk = $('hitmarker');
    mk.className = ''; void mk.offsetWidth;
    mk.className = res.killed ? (head || res.weak ? 'kill head' : 'kill') : head || res.weak ? 'head' : res.armor ? 'armor' : 'hit';
    if (!quiet && !res.killed && !res.armor && !(this.pelletMode && this.pelletSounded)) { this.audio.play(head || res.weak ? 'headshot' : 'hit'); this.pelletSounded = this.pelletMode; }
    if (!this.dmgNumsOn) return;
    if (this.pelletMode && !quiet) { // shotgun: one number per target per shot
      const a = this.pelletAcc.get(h.e) || { dmg: 0, point: h.point, head: false, killed: false };
      a.dmg += dmg; a.head ||= head; a.killed ||= res.killed; this.pelletAcc.set(h.e, a);
    } else this.damageNumber(h.point, Math.round(dmg), head || res.weak, res.killed);
  }
  flushPellets() {
    for (const a of this.pelletAcc.values()) this.damageNumber(a.point, Math.round(a.dmg), a.head, a.killed);
    this.pelletAcc.clear();
  }
  lungeTarget() {
    const o = this.aim.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.aim.quaternion);
    for (const h of this.horde.meleeCleave(o, f, MACHETE.lungeMax, 0.85, 1)) if (h.t > MACHETE.lungeMin) return h;
    return null;
  }
  // the machete connects: cleave up to three husks in the arc, lopping limbs and heads
  bladeHit(kind) {
    const o = this.aim.position, f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.aim.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.aim.quaternion);
    const hits = this.horde.meleeCleave(o, f, kind === 'lunge' ? MACHETE.lungeRange : MACHETE.range, MACHETE.cone, 3);
    if (!hits.length) { this.arsenal.camKick.impulse(-0.6, (kind === 'R' ? -1 : 1) * 2.5, (kind === 'R' ? -1 : 1) * 3); return; }
    const sweep = kind === 'R' ? -1 : kind === 'L' ? 1 : 0;
    let kills = 0;
    this.pelletMode = false;
    hits.forEach((h, i) => {
      const e = h.e, dir = f.clone().addScaledVector(right, sweep * 0.8).add(new THREE.Vector3(0, kind === 'lunge' ? -0.4 : 0.1, 0)).normalize();
      const def = { id: 'machete', knock: kind === 'lunge' ? 5.5 : 4.2 };
      const dmg = MACHETE.dmg[i] * (kind === 'lunge' ? 1.25 : 1);
      const res = this.horde.damage(e, dmg, 'body', h.point, dir, def);
      if (res.killed) kills++;
      if (e.type.sever && !e.type.boss) {
        const limbs = kind === 'lunge' ? [2, 4] : sweep < 0 ? [4, 5, 2] : [2, 3, 4];
        if (res.killed || Math.random() < 0.6) this.horde.sever(e, limbs[Math.floor(Math.random() * limbs.length)], dir);
        if (res.killed && Math.random() < (kind === 'lunge' ? 0.75 : 0.45)) { this.horde.sever(e, 1, dir); this.feed('<b>DECAPITATED</b>', 25); this.addScore(25); }
      }
      if (!e.type.hue) { this.splatsThisShot = 0; this.splatter(h.point, dir, def, true); }
      this.fx.bloodHit(h.point, dir, true); this.fx.bloodMist(h.point, dir, 0.7);
      if (res.killed) this.killFx(h, dir, { id: 'melee' }, res);
      this.onHit({ ...h, part: 'body' }, dmg, res);
    });
    if (kills >= 2) { this.feed(`<b>CLEAVE ×${kills}</b>`, 75 * kills); this.addScore(75 * kills); }
    this.screenBlood = Math.min(this.screenBlood || 0, 0.3); // gore on the lens, but you can still see
    this.audio.play('bladeHit', { n: hits.length });
    this.shake(0.3 + 0.08 * hits.length); this.hitstop = Math.max(this.hitstop, 0.085 + 0.02 * hits.length);
    this.arsenal.camKick.impulse(kind === 'lunge' ? -6 : -2, sweep * 6, sweep * 8);
  }
  // ------------------------------------------------------------ power-ups
  updatePowers(dt) {
    const got = this.powerups.update(dt, this.time, this.player);
    if (got) this.applyPower(got);
    for (const k of ['bounty', 'reaper']) {
      if (this.power[k] <= 0) continue;
      this.power[k] -= dt;
      if (this.power[k] <= 0) { this.power[k] = 0; this.audio.play('powerEnd'); if (k === 'reaper') this.horde.instaKill = false; this.renderPowers(); }
    }
    this.tickPowers();
  }
  applyPower(type) {
    const T = POWER_TYPES[type];
    this.audio.play('powerup', { type });
    this.announce(T.name, T.sub, T.color);
    this.shake(0.15);
    if (type === 'bounty') this.power.bounty = POWERUPS.bounty.time;
    else if (type === 'reaper') { this.power.reaper = POWERUPS.reaper.time; this.horde.instaKill = true; }
    else if (type === 'resupply') {
      for (const w of this.arsenal.weapons) { w.mag = w.def.mag; w.reserve = w.def.reserve; }
      this.throwables.frags = THROW.frag.max; this.throwables.screamers = Math.max(this.throwables.screamers, 1);
      this.hudDirty = true;
    } else if (type === 'deadfall') this.deadfall();
    this.renderPowers();
  }
  // nearest walkable nav cell (with a route to the player) to drop a pickup on
  walkableNear(p) {
    const nav = this.horde.nav, F = this.horde.playerF, N = nav.N, c0 = nav.cellOf(p.x, p.z), out = this._wk || (this._wk = new THREE.Vector3());
    out.copy(p);
    if (c0 < 0) { out.x = clamp(p.x, -30, 30); out.z = clamp(p.z, -30, 30); return out; }
    const ok = (c) => !nav.blocked[c] && !nav.near[c] && (!F || F.dist[c] < 0x3fffffff);
    for (let ring = 0; ring < 8; ring++) for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      const x = (c0 % N) + dx, z = ((c0 / N) | 0) + dz; if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const c = z * N + x; if (!ok(c)) continue;
      if (ring === 0) { out.y = nav.height[c]; return out; }
      nav.center(c, out); out.y = nav.height[c]; return out;
    }
    return out;
  }
  // DEADFALL: every husk on the map drops at once (the Colossus only takes heavy damage)
  deadfall() {
    const H = this.horde, P = this.player.pos, cfg = POWERUPS.deadfall, dir = this._dfDir || (this._dfDir = new THREE.Vector3());
    this.blasting = true; let kills = 0, booms = 0;
    for (const e of H.enemies) {
      if (e.dead) continue;
      if (e.type.boss) { e.hp = Math.max(1, e.hp - e.maxHp * cfg.bossDmg); e.flash = 1; continue; }
      const c = e.joints[1] || e.pos;
      dir.set(e.pos.x - P.x, 0, e.pos.z - P.z).normalize(); dir.y = 0.8; dir.normalize();
      const res = H.damage(e, e.hp + 9999, 'body', c.clone(), dir.clone(), { id: 'deadfall', knock: 9 }, 0);
      if (!res.killed) continue;
      kills++;
      if (e.type.sever) { const n = 1 + Math.floor(Math.random() * 3); for (let k = 0; k < n; k++) H.sever(e, [2, 3, 4, 5, 6, 7, 8, 9, 1][Math.floor(Math.random() * 9)], dir); }
      if (!e.type.hue) { this.fx.bloodMist(c, dir, 1.5); if (booms < 10) this.fx.gib(c.clone(), dir, 6, H.groundAt(c.x, c.z, c.y)); }
      if (booms++ < 6) this.fx.explosion(c.clone(), 0.45, H.groundAt(c.x, c.z, c.y));
    }
    this.blasting = false;
    this.fx.slam(P.clone(), 34);
    this.audio.play('deadfall');
    this.addScore(cfg.bonus);
    this.feed(`<b>DEADFALL</b>${kills ? ` · ${kills} down` : ''}`, cfg.bonus * (this.power.bounty > 0 ? POWERUPS.bounty.mult : 1));
    const fl = $('pwflash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
    this.shake(1); this.hitstop = Math.max(this.hitstop, 0.12); this.arsenal.camKick.impulse(-5, 0, 3);
  }
  announce(title, sub, color) {
    const a = $('pwann'); $('pwann-t').textContent = title; $('pwann-s').textContent = sub; a.style.setProperty('--c', color);
    a.classList.remove('on'); void a.offsetWidth; a.classList.add('on');
  }
  renderPowers() {
    const box = $('powers');
    if (!this.powerEls) {
      this.powerEls = {};
      for (const k of ['bounty', 'reaper']) {
        const d = document.createElement('div'); d.className = 'pw'; d.style.setProperty('--c', POWER_TYPES[k].color);
        d.innerHTML = `<img src="${powerIconURL(k)}" alt=""><b></b><i></i>`; box.appendChild(d);
        this.powerEls[k] = { el: d, t: d.querySelector('b'), bar: d.querySelector('i'), last: -1 };
      }
    }
    for (const k in this.powerEls) this.powerEls[k].el.classList.toggle('on', this.power[k] > 0);
  }
  tickPowers() {
    for (const k in this.powerEls || {}) {
      const P = this.powerEls[k], left = this.power[k]; if (left <= 0) continue;
      const s = Math.ceil(left); if (s !== P.last) { P.last = s; P.t.textContent = s; P.el.classList.toggle('low', left < 5); }
      P.bar.style.transform = `scaleX(${(left / POWERUPS[k].time).toFixed(3)})`;
    }
  }
  onKill(e, info) {
    this.kills++; if (info.head) this.headshots++;
    const H = this.horde;
    const last = H.wave > 0 && H.toSpawn <= 0 && H.bossDelay <= 0 && H.aliveCount() === 0;
    if (last) this.slowT = FEEDBACK.slowmo.dur; // last husk of the wave
    // every kill counts toward the wave's guaranteed drops; DEADFALL kills and the Colossus never drop themselves
    this.powerups.maybeDrop(e.pos, H.wave, (H.waveTotal || 1) + (H.bossWave ? 1 : 0), last, !this.blasting && !e.type.boss);
    if (this.blasting) { this.hudDirty = true; return; } // DEADFALL pays a flat bonus instead
    const pts = (e.type.points + (info.head ? 50 : 0)) * (1 + Math.floor((this.horde.wave - 1) / 3) * 0.5);
    this.addScore(Math.round(pts), true);
    this.audio.play('kill'); if (info.head) this.audio.play('headshot');
    if (!e.type.boss) { this.hitstop = e.type.brute ? 0.07 : 0.035; this.shake(e.type.brute ? 0.2 : 0.06); }
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
    let s = this.dmgNums[0];
    for (const x of this.dmgNums) if (x.life <= 0) { s = x; break; } else if (x.life < s.life) s = x;
    s.life = FEEDBACK.dmgNumLife; s.pos.set(p.x + rand(-0.15, 0.15), p.y + 0.1, p.z + rand(-0.15, 0.15));
    s.el.textContent = v; s.el.className = 'dn on' + (head ? ' head' : '') + (kill ? ' kill' : '');
  }
  onPlayerHit(dmg, from, e, opts = {}) {
    if (!this.player.alive) return;
    if (this.immuneT > 0) return;
    this.player.hurt(dmg);
    this.damageFx = Math.min(1, this.damageFx + dmg / 35);
    this.audio.play('hurt');
    this.shake(0.25 + dmg / 80);
    this.arsenal.camKick.impulse(rand(-6, 6), rand(-8, 8), rand(-10, 10));
    // knockback from brutes
    const away = this.player.pos.clone().sub(from); away.y = 0; away.normalize();
    this.player.vel.addScaledVector(away, opts.knock ?? (e.type.brute ? 9 : 2.5));
    if (e?.type.brute || opts.knock) this.player.vel.y = Math.max(this.player.vel.y, opts.knock ? 4.5 : 3);
    // directional indicator
    const ang = Math.atan2(away.x, away.z) - this.player.yaw;
    const di = $('dmgdir'); di.style.transform = `translate(-50%,-50%) rotate(${-ang + Math.PI}rad)`;
    di.classList.remove('on'); void di.offsetWidth; di.classList.add('on');
    if (!this.player.alive) this.onDeath();
  }
  onDeath() {
    this.state = 'dead'; this.deadT = 0;
    const best = Math.max(+localStorage.getItem('hf-best') || 0, this.score); localStorage.setItem('hf-best', best);
    const acc = this.shotsFired ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;
    this.run = { score: this.score, wave: this.horde.wave, kills: this.kills, heads: this.headshots, acc, time: Math.round(this.runTime), saved: false };
    $('d-wave').textContent = this.horde.wave; $('d-kills').textContent = this.kills; $('d-heads').textContent = this.headshots;
    $('d-score').textContent = this.score.toLocaleString(); $('d-best').textContent = best.toLocaleString();
    $('d-acc').textContent = this.shotsFired ? acc + '%' : '—';
    $('d-time').textContent = fmtTime(this.runTime);
    const local = this.localScores(), lrank = this.score > 0 ? local.filter((e) => e.score >= this.score).length + 1 : 99;
    $('d-rank').textContent = lrank <= 10 ? `#${lrank} LOCAL` : '';
    this.run.qualifies = lrank <= 10;
    this.lbTab = 'local'; this.renderBoard();
    this.fetchGlobal().then(() => { this.updateEntry(); if (this.lbTab === 'global') this.renderBoard(); });
    this.updateEntry();
    setTimeout(() => { if (this.state === 'dead') { document.exitPointerLock?.(); this.show('dead'); if (this.run.qualifies || this.run.globalQualifies) $('d-name').focus(); } }, 1600);
  }
  localScores() { try { const l = JSON.parse(localStorage.getItem('hf-scores') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } }
  updateEntry() {
    const r = this.run; if (!r) return;
    const g = this.global?.top;
    r.globalQualifies = !!g && this.global.ok && r.score > 0 && (g.length < 10 || r.score > g[g.length - 1].score);
    $('d-entry').classList.toggle('on', !r.saved && (r.qualifies || r.globalQualifies));
  }
  async fetchGlobal() {
    try {
      const res = await fetch('/api/scores', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      this.global = await res.json(); this.global.ok = true;
    } catch { this.global = { top: [], ok: false }; }
  }
  async saveScore(ev) {
    ev?.preventDefault();
    const r = this.run; if (!r || r.saved) return;
    const name = ($('d-name').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (!name) { $('d-name').focus(); return; }
    localStorage.setItem('hf-name', name);
    r.saved = true; r.name = name; $('d-save').disabled = true;
    const entry = { name, score: r.score, wave: r.wave, kills: r.kills, heads: r.heads, acc: r.acc, time: r.time, date: new Date().toISOString().slice(0, 10) };
    if (r.qualifies) {
      const l = this.localScores(); l.push(entry); l.sort((a, b) => b.score - a.score || a.time - b.time);
      localStorage.setItem('hf-scores', JSON.stringify(l.slice(0, 10)));
    }
    this.audio.play('perk');
    if (r.globalQualifies) {
      try {
        const res = await fetch('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry) });
        if (res.ok) { const d = await res.json(); this.global = { top: d.top, ok: true }; r.globalRank = d.rank; if (d.rank) $('d-rank').textContent += (r.qualifies ? ' · ' : '') + `#${d.rank} GLOBAL`; }
      } catch {}
      this.lbTab = 'global';
    }
    $('d-save').disabled = false;
    this.updateEntry(); this.renderBoard();
  }
  renderBoard() {
    const tab = this.lbTab || 'local';
    $('lb-local').classList.toggle('sel', tab === 'local'); $('lb-global').classList.toggle('sel', tab === 'global');
    const list = tab === 'local' ? this.localScores() : this.global?.top || [];
    const r = this.run, me = (e) => r && r.saved && e.name === r.name && e.score === r.score && e.wave === r.wave;
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    $('lb').innerHTML = list.length ? list.map((e) => `<li class="${me(e) ? 'me' : ''}"><span class="n">${esc(e.name)}</span><span class="w">W${e.wave} · ${e.kills}K</span><span class="t">${fmtTime(e.time)}</span><span class="s">${Number(e.score).toLocaleString()}</span></li>`).join('')
      : `<li class="empty">${tab === 'global' && this.global && !this.global.ok ? 'Global board unavailable offline' : tab === 'global' && !this.global ? 'Loading…' : 'No scores yet. Be the first.'}</li>`;
    $('lb-note').textContent = tab === 'local' ? 'Saved in this browser' : 'Everyone, everywhere · top 10';
  }

  // ------------------------------------------------------------ frame
  frame() {
    const t0 = performance.now();
    this.timer.update();
    const raw = Math.min(this.timer.getDelta(), 0.05);
    this.fps = lerp(this.fps, 1 / Math.max(raw, 1e-3), 0.05);
    const input = this.input, p = this.player, A = this.arsenal;
    const active = this.state === 'play' || this.state === 'dead' || this.state === 'shop';
    let dt = active ? raw : 0;
    // slow motion on the last kill of a wave: quick ramp in, hold, ease back out (counts down in real time)
    let slowK = 0;
    if (this.slowT > 0) {
      const S = FEEDBACK.slowmo, el = S.dur - this.slowT; this.slowT -= raw;
      slowK = Math.min(1, el / 0.06, Math.max(0, this.slowT) / 0.3);
      dt *= lerp(1, S.scale, slowK);
    }
    this.slowK = slowK;
    if (this.audio.ctx) this.audio.pitch = lerp(1, FEEDBACK.slowmo.pitch, slowK);
    this.time += dt;

    // hitstop slows the world (not your view) for a few frames on kills
    let worldDt = dt;
    if (this.hitstop > 0) { this.hitstop -= raw; worldDt = dt * 0.12; }

    if (this.state === 'play') {
      this.runTime += dt;
      if (this.shopT > 0 && (this.shopT -= dt) <= 0 && p.alive) this.openShop();
    } else if (this.state === 'shop') {
      this.shopLeft -= raw; $('sh-timer').textContent = Math.max(0, Math.ceil(this.shopLeft));
      if (this.shopLeft <= 0) this.readyUp();
    }
    let ads = 0;
    if (this.state === 'play') {
      const d = A.def;
      const fovNow = this.camera.fov;
      p.update(dt, input, { lookScale: Math.tan((fovNow * DEG) / 2) / Math.tan((HIP_FOV * DEG) / 2), ads: A.ads > 0.5, blockSprint: A.blockSprint > 0 || A.reload?.kind === 'never', weightSpeed: 1 - (d.weight - 1) * 0.12 });
      this.placeCamera(0);
      const T = this.throwables;
      T.input(dt, input, p.alive);
      // machete: slot 4 draws it (left-click swings, 1/2/3 or wheel go back to a gun); V swings it from anything.
      // Swings lunge you in when a target is a few metres out.
      const X = this.blade;
      if (input.hit('Digit4') && X.draw()) { this.audio.play('bladeDraw'); this.hudDirty = true; A.reload && A.resetReloadPose(); A.reload = null; }
      if (X.drawn && (input.hit('Digit1') || input.hit('Digit2') || input.hit('Digit3') || input.mouse.wheel)) {
        const i = input.hit('Digit1') ? 0 : input.hit('Digit2') ? 1 : input.hit('Digit3') ? 2 : A.index;
        X.holster(); this.hudDirty = true; input.mouse.wheel = 0; if (i === A.index) this.audio.play('raise');
      }
      const wantSwing = !T.cook && (input.hit('KeyV') || (X.drawn && (input.mouse.leftPressed || (input.mouse.left && !X.busy()))));
      if (wantSwing && !A.swap) {
        if (!X.drawn && A.reload) { A.resetReloadPose(); A.reload = null; }
        const lunge = !X.busy() && p.grounded && this.lungeTarget();
        if (X.start(lunge ? 'lunge' : null) && lunge) {
          this.lungeT = 0.2; this.lungeTo = lunge.t - 1.4; this.audio.play('bladeLunge');
        }
      }
      if (this.lungeT > 0) { // dash in until we're in swinging distance
        this.lungeT -= dt; this.lungeTo -= MACHETE.lungeSpeed * dt;
        const f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        if (this.lungeTo > 0) { p.vel.x = f.x * MACHETE.lungeSpeed; p.vel.z = f.z * MACHETE.lungeSpeed; }
      }
      const moving = p.grounded ? Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 6) : 0;
      const xev = X.update(dt, moving, this.time);
      if (xev === 'whoosh') { this.audio.play('bladeSwing', { heavy: X.swing?.kind === 'lunge' }); const sd = X.swing?.kind === 'L' ? 1 : -1; A.camKick.impulse(-0.8, sd * 1.5, sd * 2.5); }
      if (xev === 'hit') this.bladeHit(X.swing?.kind || 'R');
      A.bladeOut = X.out();
      A.holster = !!T.cook || T.throwAnim > 0 || X.out() || this.drinks.drinking;
      ads = A.update(dt, input, p, this.aim);
      this.adsNow = ads;
      // dip the gun while the off hand cooks / throws
      this.throwPose = damp(this.throwPose || 0, A.holster ? 1 : 0, 14, dt);
      A.root.position.y -= 0.045 * this.throwPose; A.root.position.x += 0.03 * this.throwPose; A.root.rotation.x -= 0.12 * this.throwPose;
      this.bladePose = damp(this.bladePose || 0, X.out() ? 1 : 0, 16, dt);
      A.root.position.y -= 0.32 * this.bladePose; A.root.rotation.x -= 0.5 * this.bladePose; A.root.visible = this.bladePose < 0.97;
      this.vmFrag.visible = !!T.cook;
      if (T.cook) this.vmFrag.position.y = -0.16 + Math.sin(this.time * 3) * 0.004;
    } else if (this.state === 'dead') {
      this.deadT += dt;
      p.eyeSmooth = damp(p.eyeSmooth, 0.35, 3, dt);
      p.camTilt = damp(p.camTilt, 0.5, 2, dt);
      A.root.position.y = damp(A.root.position.y, -0.6, 3, dt);
    }
    // FOV: ADS zoom + sprint/slide punch
    const d = A.def;
    const sprintF = p.sprinting && p.grounded ? 5 : 0, slideF = p.sliding > 0 ? 8 : 0;
    const targetFov = lerp(HIP_FOV + sprintF + slideF, d.adsFov, ads) - FEEDBACK.slowmo.zoom * slowK;
    if (this.state === 'play') this.camera.fov = damp(this.camera.fov, targetFov, ads > 0 && ads < 1 ? 40 : 14, dt);
    this.vmCamera.fov = lerp(VM_HIP_FOV, d.vmAdsFov, ads);
    // when aiming, clip the stock/buffer tube right under the eye so it never fills the bottom of the screen
    this.vmCamera.near = lerp(0.01, d.adsNear ?? (d.id === 'ar' ? 0.1 : d.id === 'sg' ? 0.1 : 0.095), ads * ads);
    this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
    this.placeCamera(dt);

    if (active) {
      this.horde.update(worldDt, this.time, this.camera);
      this.barrels.update(worldDt, this.fx, (p) => this.explode(p, 1));
      this.throwables.update(worldDt, this.time);
      if (this.state === 'play') this.updatePowers(dt);
      this.wallbuys.update(this.time);
      this.stations.update(worldDt, this.time);
      this.drinks.update(dt, this.player.pos); this.immuneT = Math.max(0, (this.immuneT || 0) - dt);
      this.areas.update(dt, this.time);
      this.updateWallPrompt();
      this.fx.update(worldDt, this.camera, this.time);
    }
    // lights
    this.nightfall.update(dt, this.horde.wave || 1);
    if (this.state === 'play') this.minHpFrac = Math.min(this.minHpFrac ?? 1, this.player.health / this.player.maxHealth);
    this.arena.lights.forEach((L, i) => { const fl = L.flicker + (i % 2 ? this.lampFlick : 0), hum = Math.sin(this.time * 17 + L.base + i) * Math.sin(this.time * 7.3 + L.base * 3 + i * 1.7); L.light.intensity = L.base * this.lampMul * (1 - fl + fl * (0.6 + 0.4 * hum)) * (i % 2 && this.lampFlick > 0.05 && Math.sin(this.time * 2.1 + i) > 0.97 ? 0.25 : 1); });
    this.sky.material.uniforms.time.value = this.time;
    this.updateViewmodelLights();

    // post uniforms
    this.damageFx = Math.max(0, this.damageFx - dt * 1.4);
    const u = this.post.u;
    u.time.value = this.time; u.damage.value = this.damageFx; u.ads.value = ads;
    u.lowHealth.value = p.alive ? clamp((45 - p.health) / 45, 0, 1) : 1;
    u.dead.value = this.state === 'dead' ? clamp(this.deadT / 1.5, 0, 1) : 0;
    u.flash.value = Math.max(0, A.flashT / 0.05);
    this.screenBlood = Math.max(0, (this.screenBlood || 0) - dt * 0.55); u.blood.value = this.screenBlood;

    this.updateHUD(raw, ads);
    if (active) this.minimap.draw(raw, p, this.horde, this.barrels, this.throwables);
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
      this.vmLocal.intensity = best.light.intensity / (this.lampMul || 1) * 0.12 * clamp(1 - bd / best.light.distance, 0, 1);
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
      const bl = this.blade.drawn;
      $('wname').textContent = bl ? MACHETE.name : w.def.name; $('wtype').textContent = bl ? MACHETE.type : w.def.upgraded ? w.def.type + ' · FORGED' : w.def.rare ? w.def.type + ' · RARE' : w.def.type;
      $('wname').classList.toggle('up', !bl && !!w.def.upgraded); $('wname').classList.toggle('rare', !bl && !w.def.upgraded && !!w.def.rare);
      $('mag').classList.toggle('low', !bl && w.mag <= Math.ceil(w.def.mag * 0.25));
      $('score').textContent = this.score.toLocaleString();
      $('kills').textContent = this.kills;
      $('pts').textContent = this.pts.toLocaleString();
      const slots = [0, 1, 2].map((i) => { const w2 = A.weapons[i]; return `<span class="slot${i === A.index && !bl ? ' sel' : ''}${w2 ? '' : ' empty'}">${i + 1}${w2 ? ' ' + w2.def.short : ''}</span>`; }).join('') + `<span class="slot${bl ? ' sel' : ''}">4 ${MACHETE.short}</span>`;
      if ($('slots').innerHTML !== slots) $('slots').innerHTML = slots;
      const T = this.throwables;
      $('t-frag').textContent = T.frags; $('t-scr').textContent = T.screamers;
      $('t-frag').parentNode.classList.toggle('none', !T.frags); $('t-scr').parentNode.classList.toggle('none', !T.screamers);
    }
    if (this.blade.drawn) { $('mag').textContent = '∞'; $('reserve').textContent = 'BLADE'; } else { $('mag').textContent = w.mag; $('reserve').textContent = w.reserve; }
    const ck = this.throwables.cook, cookEl = $('cook');
    cookEl.classList.toggle('on', !!ck);
    if (ck) {
      const left = Math.max(0, THROW.frag.fuse - ck.t), f = left / THROW.frag.fuse;
      cookEl.style.setProperty('--f', f.toFixed(3)); cookEl.classList.toggle('hot', left < 1.2);
      $('cook-t').textContent = left.toFixed(1);
    }
    const hint = $('hint');
    const hintText = this.blade.drawn ? '' : A.reload ? 'RELOADING' : w.mag === 0 && w.reserve === 0 ? 'NO AMMO — SWAP' : w.mag <= Math.ceil(w.def.mag * 0.25) ? 'R  RELOAD' : '';
    if (hint.textContent !== hintText) hint.textContent = hintText;
    $('hpfill').style.width = `${(p.health / p.maxHealth) * 100}%`;
    $('armorrow').classList.toggle('on', p.armor > 0); $('armorfill').style.width = `${Math.min(100, (p.armor / 150) * 100)}%`;
    $('hpfill').classList.toggle('low', p.health < 35);
    $('wave').textContent = this.horde.wave || '—';
    { const sp = this.specialLive, c = sp ? sp.color : ''; const w = $('wave'); if (w.style.color !== c) { w.style.color = c; w.style.textShadow = sp ? `0 0 12px ${c}` : ''; } }
    $('left').textContent = this.horde.remaining();
    const boss = this.horde.boss;
    if (boss && !boss.dead) { $('bossfill').style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100).toFixed(1)}%`; $('bossbar').classList.toggle('stun', boss.bs === 'stun'); }
    else if (this.horde.bossDelay <= 0) $('bossbar').classList.remove('on');
    if (this.debugFps) $('fps').textContent = `${Math.round(this.fps)} fps`;
    // floating damage numbers
    const v = this._dnV || (this._dnV = new THREE.Vector3());
    for (const n of this.dmgNums) {
      if (n.life <= 0) continue;
      n.life -= dt; n.pos.y += dt * 0.9;
      v.copy(n.pos).project(this.camera);
      if (v.z > 1 || n.life <= 0) { n.el.className = 'dn'; continue; }
      n.el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%,-50%)`;
      n.el.style.opacity = Math.min(0.9, n.life * 3);
    }
  }
}

const deployBtn = $('deploy');
deployBtn.disabled = true; deployBtn.textContent = 'LOADING 0%';
const assets = await loadAssets((k) => (deployBtn.textContent = `LOADING ${Math.round(k * 100)}%`));
deployBtn.disabled = false; deployBtn.textContent = 'DEPLOY';
const game = new Game(assets);
window.game = game;
window.__ready = true;

// Hooks for automated testing (headless browsers have no pointer lock).
window.__bladePoses = BLADE_POSES;
window.__debug = {
  start() { game.forceLock = true; game.audio.init(); game.input.locked = true; game.restart(true); game.show(null); },
  set(o) { Object.assign(game.input.mouse, o); },
  key(code, down) { if (down) { game.input.keys.add(code); game.input.pressed.add(code); } else game.input.keys.delete(code); },
  look(yaw, pitch) { game.player.yaw = yaw; game.player.pitch = pitch; },
  teleport(x, y, z) { game.player.pos.set(x, y, z); game.player.vel.set(0, 0, 0); },
  select(i) { game.arsenal.select(i); },
  give(id) { return game.arsenal.give(id); },
  pts(n) { game.pts = n; game.hudDirty = true; },
  barrels() { return game.barrels.list.map((b) => ({ x: b.pos.x, z: b.pos.z, alive: b.alive })); },
  boom(i) { const b = game.barrels.list[i]; game.barrels.damage(b, 999); },
  clearWave() { const H = game.horde; H.toSpawn = 0; H.bossDelay = 0; for (const e of H.enemies) if (!e.dead) { e.hp = 0; H.kill(e, e.pos.clone(), new THREE.Vector3(0, 0, 1), 50, { id: 'ar' }, false); } },
  info() { const A = game.arsenal; return { state: game.state, weapon: A.def.id, mag: A.current.mag, ads: A.ads, fps: game.fps, cpuMs: game.cpuMs, hp: game.player.health, wave: game.horde.wave, alive: game.horde.aliveCount(), idle: game.horde.enemies.filter((e) => !e.dead && !e.aware).length, kills: game.kills, pos: game.player.pos.toArray() }; },
  wave(n) { const H = game.horde; H.wave = n - 1; H.toSpawn = 0; H.bossDelay = 0; for (const e of H.enemies) if (!e.dead) { e.hp = 0; H.kill(e, e.pos.clone(), new THREE.Vector3(0, 0, 1), 50, { id: 'ar' }, false); } H.cleared = false; H.hold = false; H.nextWave(); return { wave: H.wave, special: H.special?.type || null, count: H.toSpawn, hpMul: +H.W.hp.toFixed(2), gap: +H.W.gap.toFixed(2), maxAlive: H.W.maxAlive, brutes: H.brutesLeft, bloaters: H.bloatersLeft }; },
  special() { const H = game.horde; return { type: H.special?.type || null, live: !!game.specialLive, minHp: +game.minHpFrac.toFixed(2), lampMul: +game.lampMul.toFixed(3), fog: +game.scene.fog.density.toFixed(4), pts: game.pts }; },
  spawn(n, dist, idle, type, ang) { return game.horde.debugSpawn(n, dist, idle, type ?? null, ang ?? null).length; },
  boss(dist = 16) { game.horde.wave = 4; game.horde.toSpawn = 0; game.horde.nextWave(); game.horde.bossDelay = 0; game.horde.toSpawn = 0; game.horde.debugSpawn(1, dist, false, 'boss', game.player.yaw + Math.PI); },
  bossInfo() { const b = game.horde.boss; return b ? { hp: Math.round(b.hp), max: Math.round(b.maxHp), bs: b.bs, dead: b.dead } : null; },
  god(on) { game.god = on; game.player.hurt = on ? () => {} : Player.prototype.hurt; },
  quality(q) { game.applyQuality(q); },
  power(type, x, z) { const p = game.player.pos; return !!game.powerups.spawn(type, x ?? p.x, z ?? p.z - 3, p.y); },
  slowmo() { game.slowT = FEEDBACK.slowmo.dur; },
  drinks() { return { owned: Object.keys(game.drinksOwned), drinking: game.drinks.drinking, maxHealth: game.player.maxHealth, health: Math.round(game.player.health), alive: game.player.alive, rpmAR: Math.round(game.arsenal.all.ar.def.rpm), reloadAR: +game.arsenal.all.ar.def.reload.toFixed(3) }; },
  doors() { return { list: game.areas.list.map((a) => ({ id: a.id, open: a.open, price: a.def.price, t: +a.t.toFixed(2) })), target: game.areaTarget?.id || null, extraSpawns: game.horde.extraSpawns.length, colliders: game.arena.colliders.length, rebakeMs: +(game.horde.navStats.rebakeMs || 0).toFixed(1) }; },
  openDoor(id, silent = false) { const a = game.areas.list.find((x) => x.id === id); game.areas.open(a, silent); return this.doors(); },
  navAt(x, z, big = false) { const N = big ? game.horde.navBig : game.horde.nav, c = N.cellOf(x, z); return { blocked: N.blocked[c], h: +N.height[c].toFixed(2) }; },
  night(w) { if (w != null) { game.nightfall.snap(w); } return { k: +game.nightfall.k.toFixed(3), stage: game.nightfall.stageName(), exposure: +game.renderer.toneMappingExposure.toFixed(3), fog: +game.scene.fog.density.toFixed(4), sun: +game.sun.intensity.toFixed(2), flash: +game.nightfall.flash.intensity.toFixed(1), lights: game.renderer.info.programs?.length }; },
  crateTo(i) { game.stations.setActive(i); game.stations.crate.state = 'idle'; return this.crate(); },
  crate() { const C = game.stations.crate; return { at: C.at, state: C.state, t: +C.t.toFixed(2), result: C.result, next: C.next, spins: C.spins }; },
  forge() { const F = game.stations.forge; return { state: F.state, t: +F.t.toFixed(2), gun: F.w?.base.id || null }; },
  frames(n) { return new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }); },
};
