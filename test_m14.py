# M14 logic tests (no screenshots): spitter gone, jumpers cross cover, brute armour/leg numbers, bloater blast radius,
# every special-wave type runs and completes, waves 2..13 full sim with zero errors. usage: test_m14.py URL [cases]
import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]; cases = sys.argv[2].split(',') if len(sys.argv) > 2 else ['gone', 'jumper', 'brute', 'bloater', 'special', 'waves']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 640, 'height': 360}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:400])); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if 'vercel.app' in url: pg.route('**/api/scores', lambda r: r.abort() if r.request.method == 'POST' else r.continue_())
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=240000); ev = pg.evaluate
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    R = {}
    if 'gone' in cases:
        R['gone'] = ev("""() => { const H = game.horde, bad = []; let threw = null;
          try { H.spawn('spitter', new game.player.pos.constructor(5, 0, 5)); } catch (e) { threw = String(e).slice(0, 60); }
          H.reset(); const o = {}; for (const t of ['runner', 'brute', 'jumper', 'bloater', 'crawler']) o[t] = !!H.spawn(t, new game.player.pos.constructor(8, 0, 8)); H.reset();
          return { spawnSpitterThrows: threw, spawnOthers: o, acidHookInMain: typeof game.onAcid, hasProj: 'projectiles' in H || 'puddles' in H }; }""")
    if 'jumper' in cases:
        R['jumper'] = ev("""() => { const CLEAR = (R, W = 33) => { const H = game.horde, N = H.nav; for (let x = -W; x <= W; x += 3) for (let z = -W; z <= W; z += 3) { let ok = true; for (let a = 0; a < 16 && ok; a++) for (const rr of [2, 4, 6, 8, R]) { const c = N.cellOf(x + Math.cos(a / 16 * 6.283) * rr, z + Math.sin(a / 16 * 6.283) * rr); if (c < 0 || N.blocked[c] || Math.abs(N.height[c]) > 0.3) { ok = false; break; } } if (ok) return [x, z]; } return null; };
 const H = game.horde, P = game.player, V = P.pos.constructor; game.state = 'paused'; const out = {};
          // find a low obstacle (car/crate/barrier) with open ground on both sides
          const lows = game.arena.colliders.filter((c) => !c.ground && c.maxY > 0.7 && c.maxY < 1.7 && c.minY < 0.3 && (c.maxX - c.minX) < 6 && (c.maxZ - c.minZ) < 6 && Math.abs((c.minX + c.maxX) / 2) < 28 && Math.abs((c.minZ + c.maxZ) / 2) < 28);
          const tries = [];
          for (const c of lows) {
            const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2, hx = (c.maxX - c.minX) / 2 + 1.0, hz = (c.maxZ - c.minZ) / 2 + 1.0;
            for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const px = cx - ax * (hx + 5), pz = cz - az * (hz + 5), sx = cx + ax * (hx + 0.2), sz = cz + az * (hz + 0.2);
              const ok = (x, z) => { const n = H.nav.cellOf(x, z); return n >= 0 && !H.nav.blocked[n] && Math.abs(x) < 33 && Math.abs(z) < 33; };
              if (ok(px, pz) && ok(sx, sz)) { tries.push({ c, px, pz, sx, sz, ax, az, h: c.maxY }); break; }
            }
            if (tries.length >= 4) break;
          }
          out.candidates = tries.length;
          const run = (T, mode) => {
            H.reset(); H.running = false; H.wave = 8; P.pos.set(T.px, 0, T.pz); P.vel.set(0, 0, 0);
            const e = H.spawn('jumper', new V(T.sx, 0, T.sz)); e.aware = true; e.attackCd = 99;
            if (mode === 'hop') { e.jcd = 999; } else { e.hopCd = 999; e.jcd = 0; }
            const l0 = H.navStats.leaps || 0, h0 = H.navStats.hops || 0; let reach = -1, maxY = 0, stuck = 0;
            for (let f = 0; f < 15 * 30; f++) { game.time += 1/30; P.pos.set(T.px, 0, T.pz); e.attackCd = 99; H.update(1/30, game.time, game.camera); maxY = Math.max(maxY, e.pos.y);
              if (Math.hypot(e.pos.x - T.px, e.pos.z - T.pz) < 2.0) { reach = +(f / 30).toFixed(2); break; } }
            return { h: +T.h.toFixed(2), reachS: reach, leaps: (H.navStats.leaps || 0) - l0, hops: (H.navStats.hops || 0) - h0, apex: +maxY.toFixed(2) };
          };
          out.hop = tries.map((T) => run(T, 'hop')); out.leap = tries.map((T) => run(T, 'leap'));
          // leap vs open ground: windup tell + arc + hit
          const [JX, JZ] = CLEAR(9) || [0, 0]; H.reset(); P.pos.set(JX, 0, JZ); P.vel.set(0, 0, 0); const e = H.spawn('jumper', new V(JX, 0, JZ + 7)); e.aware = true; e.jcd = 0; e.hopCd = 999;
          let hits = 0, st = {}, hp0 = 0; const orig = H.hooks.onPlayerHit; H.hooks.onPlayerHit = (d, f, en, o) => { hits++; st.dmg = d; st.knock = o?.knock; };
          for (let f = 0; f < 6 * 30; f++) { game.time += 1/30; P.pos.set(JX, 0, JZ); H.update(1/30, game.time, game.camera); if (e.jp > 0 && st['jp' + e.jp] === undefined) st['jp' + e.jp] = +(f / 30).toFixed(2); if (hits) break; }
          H.hooks.onPlayerHit = orig; out.open = { hits, ...st };
          H.reset(); game.state = 'play'; return out; }""")
    if 'brute' in cases:
        R['brute'] = ev("""() => { const H = game.horde, P = game.player, V = P.pos.constructor; game.state = 'paused'; const out = {}, d = new V(0, 0, 1);
          const hit = (amt, part, pi, def) => { H.reset(); const e = H.spawn('brute', new V(0, 0, 9)); const hp0 = e.hp; H.damage(e, amt, part, e.joints[1].clone(), d, def || { id: 'ar' }, pi); return { lost: +(hp0 - e.hp).toFixed(1), maxHp: e.maxHp }; };
          const run = hit(100, 'body', 0), brun = (() => { H.reset(); const e = H.spawn('runner', new V(0, 0, 9)); const hp0 = e.hp; H.damage(e, 100, 'body', e.joints[1].clone(), d, { id: 'ar' }, 0); return hp0 - e.hp; })();
          out.runnerBodyFor100 = brun; out.body = hit(100, 'body', 0).lost; out.head = hit(100, 'head', 1).lost; out.arm = hit(100, 'limb', 3).lost; out.leg = hit(100, 'limb', 7).lost; out.thigh = hit(100, 'limb', 6).lost;
          out.machete = hit(100, 'body', -1, { id: 'machete' }).lost; out.boom = hit(100, 'body', 0, { id: 'boom' }).lost; out.deadfallIgnoresArmor = hit(100, 'body', 0, { id: 'deadfall' }).lost;
          // cripple: shoot the legs until it limps
          H.reset(); const e = H.spawn('brute', new V(0, 0, 9)), spd0 = e.speed; let shots = 0;
          while (!e.crippled && shots < 200) { H.damage(e, 30, 'limb', e.joints[10].clone(), d, { id: 'ar' }, shots % 2 ? 7 : 9); shots++; }
          out.cripple = { shots, hpLeftPct: +(e.hp / e.maxHp * 100).toFixed(1), speedBefore: +spd0.toFixed(2), speedAfter: +e.speed.toFixed(2), limp: e.gait.limp };
          // how many body shots (AR 30) vs head to kill, and leg-kill
          const shotsToKill = (part, pi) => { H.reset(); const e = H.spawn('brute', new V(0, 0, 9)); let n = 0; while (!e.dead && n < 2000) { H.damage(e, 30, part, e.joints[1].clone(), d, { id: 'ar' }, pi); n++; if (e.hp <= 0 && !e.dead) { H.kill(e, e.pos.clone(), d, 30, { id: 'ar' }, false); } } return n; };
          out.shotsToKill = { body: shotsToKill('body', 0), head: shotsToKill('head', 1), legs: shotsToKill('limb', 7) };
          // melee reach / hit
          out.cfg = { hp: H.spawn('brute', new V(0, 0, 9)).maxHp, dmg: 46 };
          H.reset(); game.state = 'play'; return out; }""")
    if 'bloater' in cases:
        R['bloater'] = ev("""() => { const CLEAR = (R, W = 33) => { const H = game.horde, N = H.nav; for (let x = -W; x <= W; x += 3) for (let z = -W; z <= W; z += 3) { let ok = true; for (let a = 0; a < 16 && ok; a++) for (const rr of [2, 4, 6, 8, R]) { const c = N.cellOf(x + Math.cos(a / 16 * 6.283) * rr, z + Math.sin(a / 16 * 6.283) * rr); if (c < 0 || N.blocked[c] || Math.abs(N.height[c]) > 0.3) { ok = false; break; } } if (ok) return [x, z]; } return null; };
 const [CX, CZ] = CLEAR(9) || [0, 0]; const H = game.horde, P = game.player, V = P.pos.constructor; game.state = 'paused'; const out = { zombies: [], player: [] };
          // 1) zombies at 1..9 m (all aware, idle to stay put): hp lost
          H.reset(); P.pos.set(-30, 0, -30); const b = H.spawn('bloater', new V(CX, 0, CZ)); b.aware = false; const zs = [];
          for (let r = 1; r <= 9; r++) { const z = H.spawn('runner', new V(CX + r * Math.cos(r), 0, CZ + r * Math.sin(r))); z.aware = false; z.alertIn = undefined; z.hp = z.maxHp = 400; zs.push([r, z]); }
          let blasts = 0; const oh = H.hooks.onBloaterBurst; H.hooks.onBloaterBurst = (p, e) => { blasts++; oh(p, e); };
          H.damage(b, 99999, 'body', b.joints[1].clone(), new V(0, 0, 1), { id: 'ar' }, 0); if (b.hp <= 0 && !b.dead) H.kill(b, b.pos.clone(), new V(0, 0, 1), 30, { id: 'ar' }, false);
          for (let f = 0; f < 15; f++) { game.time += 1/30; P.pos.set(-30, 0, -30); H.update(1/30, game.time, game.camera); }
          out.blasts = blasts; out.zombies = zs.map(([r, z]) => ({ m: r, lost: Math.round(400 - Math.max(0, z.hp)), dead: z.dead }));
          out.zombieRadiusM = Math.max(0, ...out.zombies.filter((z) => z.lost > 0).map((z) => z.m));
          // 2) player at 1..8 m: damage taken
          for (const r of [1, 2, 3, 4, 5, 5.5, 6, 7]) { H.reset(); P.health = P.maxHealth = 100; P.alive = true; game.god = false; game.player.hurt = P.constructor.prototype.hurt; game.immuneT = 0;
            const b2 = H.spawn('bloater', new V(CX, 0, CZ)); b2.aware = false; P.pos.set(CX + r, 0, CZ); P.vel.set(0, 0, 0);
            H.damage(b2, 99999, 'body', b2.joints[1].clone(), new V(0, 0, 1), { id: 'ar' }, 0); if (b2.hp <= 0 && !b2.dead) H.kill(b2, b2.pos.clone(), new V(0, 0, 1), 30, { id: 'ar' }, false);
            for (let f = 0; f < 10; f++) { game.time += 1/30; P.pos.set(CX + r, 0, CZ); H.update(1/30, game.time, game.camera); }
            out.player.push({ m: r, dmg: Math.round(100 - P.health) }); }
          // 3) chain: two bloaters 3 m apart
          H.reset(); P.pos.set(-30, 0, -30); P.health = 100; game.god = true; P.hurt = () => {}; blasts = 0; const c1 = H.spawn('bloater', new V(CX, 0, CZ)), c2 = H.spawn('bloater', new V(CX + 3, 0, CZ)); c1.aware = c2.aware = false;
          H.damage(c1, 99999, 'body', c1.joints[1].clone(), new V(0, 0, 1), { id: 'ar' }, 0); if (c1.hp <= 0 && !c1.dead) H.kill(c1, c1.pos.clone(), new V(0, 0, 1), 30, { id: 'ar' }, false);
          for (let f = 0; f < 20; f++) { game.time += 1/30; P.pos.set(-30, 0, -30); H.update(1/30, game.time, game.camera); }
          out.chainBlasts = blasts; out.pulse = (() => { H.reset(); const e = H.spawn('bloater', new V(CX, 0, CZ + 5)); e.aware = false; const r = {}; for (const f of [1, 0.6, 0.3, 0.1]) { e.hp = e.maxHp * f; let beats = 0, last = e.lastBeat; for (let i = 0; i < 90; i++) { game.time += 1/30; H.update(1/30, game.time, game.camera); } const a = e.pulsePh; for (let i = 0; i < 30; i++) { game.time += 1/30; H.update(1/30, game.time, game.camera); } r['hp' + Math.round(f * 100)] = +(e.pulsePh - a).toFixed(2) + ' beats/s'; } return r; })();
          H.hooks.onBloaterBurst = oh; H.reset(); game.god = true; game.state = 'play'; return out; }""")
    if 'special' in cases:
        R['special'] = {}
        for w in [3, 8, 13, 18, 23, 28]:
            R['special'][w] = ev("""(w) => { const H = game.horde, P = game.player, V = P.pos.constructor; game.state = 'paused'; H.reset(); H.running = true; P.pos.set(4, 0, 6); P.health = P.maxHealth; P.alive = true; game.minHpFrac = 1;
              H.hold = false; const pts0 = game.pts; const info = __debug.wave(w); const t0 = H.spawn.length;
              const types = {}; const orig = H.spawn.bind(H); H.spawn = (k, at, idle) => { const e = orig(k, at, idle); types[k + (e.cls === 'sprinter' ? '*' : '')] = (types[k + (e.cls === 'sprinter' ? '*' : '')] || 0) + 1; return e; };
              let ended = false, sec = 0, fogMax = 0, lampMin = 9, hp0 = null, spMax = 0, hpAll = []; const oe = game.onWaveEnd.bind(game); game.onWaveEnd = (n) => { ended = true; oe(n); };
              const live0 = !!game.specialLive; const banner = document.getElementById('banner-t').textContent, bcls = document.getElementById('banner').className, wcol = (game.hudUpdate?.(), document.getElementById('wave').style.color);
              for (let f = 0; f < 240 * 30 && !ended; f++) { game.time += 1/30; P.pos.set(4, 0, 6); H.update(1/30, game.time, game.camera); game.nightfall.update(1/30, H.wave); game.minHpFrac = Math.min(game.minHpFrac, 1);
                fogMax = Math.max(fogMax, game.scene.fog.density); lampMin = Math.min(lampMin, game.lampMul);
                for (const e of H.enemies) { if (e.dead) continue; if (hp0 === null) hp0 = e.maxHp; const d = Math.hypot(e.pos.x - 4, e.pos.z - 6); if (d < 9 && e.aware) { e.hp = 0; H.kill(e, e.pos.clone(), new V(0, 0, 1), 50, { id: 'ar' }, false); } }
                if (f % 30 === 0 && H.aliveCount() === 0 && H.toSpawn === 0) sec = f; }
              H.spawn = orig; game.onWaveEnd = oe;
              const res = { w, info, ended, banner, bcls: bcls.replace(/\\s+/g, ' '), hudColor: wcol, liveAtStart: live0, types, fogMax: +fogMax.toFixed(4), lampMin: +lampMin.toFixed(3), maxHp: hp0 && Math.round(hp0), specialAfter: !!game.specialLive, ptsGain: game.pts - pts0, powerupsOut: game.powerups.slots.filter((s) => s.type).length };
              H.reset(); H.running = false; game.state = 'play'; return res; }""", w)
    if 'waves' in cases:
        R['waves'] = ev("""() => { const H = game.horde, P = game.player, V = P.pos.constructor; game.state = 'paused'; H.reset(); H.running = true; P.pos.set(4, 0, 6); const rows = [];
          const seen = {}; const orig = H.spawn.bind(H); H.spawn = (k, at, idle) => { seen[k] = (seen[k] || 0) + 1; return orig(k, at, idle); };
          for (let w = 2; w <= 13; w++) { for (const k in seen) delete seen[k]; H.hold = false; H.cleared = false; H.wave = w - 1; H.toSpawn = 0; H.bossDelay = 0; H.nextWave(); let ended = false; const oe = game.onWaveEnd.bind(game); game.onWaveEnd = (n) => { ended = true; oe(n); }; let f = 0, maxAlive = 0;
            for (; f < 300 * 30 && !ended; f++) { game.time += 1/30; P.pos.set(4, 0, 6); P.health = P.maxHealth; H.update(1/30, game.time, game.camera); game.nightfall.update(1/30, H.wave); maxAlive = Math.max(maxAlive, H.aliveCount());
              for (const e of H.enemies) { if (e.dead) continue; const d = Math.hypot(e.pos.x - 4, e.pos.z - 6); e.aware = true; if (d < 3.2) { e.hp = 0; H.kill(e, e.pos.clone(), new V(0, 0, 1), 50, { id: 'ar' }, false); } } }
            game.onWaveEnd = oe; rows.push({ w, special: H.special?.type || null, ended, sec: +(f / 30).toFixed(0), maxAlive, spawned: { ...seen }, leaps: H.navStats.leaps, hops: H.navStats.hops }); }
          H.spawn = orig; H.reset(); H.running = false; game.state = 'play'; return rows; }""")
    R['errors'] = errs[:8]
    print(json.dumps(R, indent=1))
    b.close()
