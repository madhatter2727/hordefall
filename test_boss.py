# Colossus nav + hit-registration test. usage: test_boss.py URL [spots]
import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 640, 'height': 360}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if 'vercel.app' in url: pg.route('**/api/scores', lambda r: r.abort() if r.request.method == 'POST' else r.continue_())
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=180000); ev = pg.evaluate
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    # [name, player x,y,z, boss x,z]
    CASES = [('platform via N stairs', 0, 2.0, 0, 0, -12), ('platform via S stairs', 0, 2.0, 1, 0, 12), ('container stack via side stairs', -16, 2.6, -5.4, -6, -5.4),
             ('container top from far side', -16, 2.6, -5.4, -16, -14), ('between containers', -16, 0, -3.6, -22, 2), ('behind container N', 8, 0, -22.2, 8, -12),
             ('under overpass', 3, 0, -22, -6, -26), ('crate stack top', -4, 2.0, -15, 6, -10), ('behind car', -20, 0, 34.0, -8, 26), ('stuck at stair foot', 0, 2.0, 0, 1.4, -6.2)]
    res = ev("""(cases) => { const H = game.horde, P = game.player, V = P.pos.constructor, out = []; game.state = 'paused';
      for (const [name, px, py, pz, bx, bz] of cases) {
        H.reset(); H.running = false; H.wave = 5; P.pos.set(px, py, pz); P.vel.set(0, 0, 0);
        const e = H.spawnBoss(new V(bx, 0, bz)); e.aware = true; e.chargeCd = 1e9; // walk only: charges can't help it climb
        let reachT = -1, maxStill = 0, still = 0, lp = e.pos.clone(), hitsOk = 0, hitsTry = 0, desync = 0;
        for (let f = 0; f < 90 * 30; f++) {
          game.time += 1/30; H.update(1/30, game.time, game.camera); e.hp = e.maxHp; e.attackCd = 99; P.pos.set(px, py, pz);
          const d = Math.hypot(e.pos.x - px, e.pos.z - pz);
          if (reachT < 0 && d < 4.6 && Math.abs(e.pos.y - py) < 1.8) reachT = f / 30;
          if (f % 30 === 0) { still = lp.distanceTo(e.pos) < 0.3 && reachT < 0 ? still + 1 : 0; maxStill = Math.max(maxStill, still); lp.copy(e.pos);
            // can we hit it? cast from the player's eye at the chest joint and at the body centre
            const eye = new V(px, py + 1.65, pz), c = e.joints[1], dir = c.clone().sub(eye).normalize();
            hitsTry++; if (H.raycast(eye, dir, 200).some((h) => h.e === e)) hitsOk++;
            const root = e.rig ? e.rig.root.position : e.pos; if (Math.hypot(c.x - e.pos.x, c.z - e.pos.z) > 2 * e.scale || Math.abs(c.y - e.pos.y) > 4 * e.scale) desync++; }
          if (reachT >= 0 && f / 30 > reachT + 3) break;
        }
        // real shots from point-blank to mid range: points + hit marker must register every time
        let shotOk = 0, shotTry = 0;
        const A = game.arsenal.all.ar.def;
        for (const r of [1.8, 2.2, 2.6, 3.5, 6]) {
          const c = e.joints[1], to = new V(px - c.x, 0, pz - c.z); if (to.lengthSq() < 0.01) to.set(1, 0, 0); to.normalize(); const eye = new V(c.x + to.x * r, c.y, c.z + to.z * r), dir = c.clone().sub(eye).normalize();
          const pts0 = game.pts, mk = document.getElementById('hitmarker'); mk.className = '';
          game.shoot(eye, dir, A, null); shotTry++; if (game.pts > pts0 && mk.className) shotOk++;
        }
        out.push({ name, shots: shotOk + '/' + shotTry, reachT: +reachT.toFixed(1), maxStillS: maxStill, end: e.pos.toArray().map((v) => +v.toFixed(1)), raycastHits: hitsOk + '/' + hitsTry, desync, respawns: H.navStats.respawns });
      }
      H.reset(); game.state = 'play'; return JSON.stringify(out); }""", [c for c in CASES if len(sys.argv) < 3 or c[0] in sys.argv[2].split(',')])
    for r in json.loads(res): print(json.dumps(r))
    # real waves: kill everything as it arrives, count power-up drops (guaranteed from wave 4) and check placement
    drops = ev("""() => { const H = game.horde, P = game.player, PU = game.powerups, V = P.pos.constructor, out = []; game.state = 'paused';
      for (const w of [2, 4, 6, 8, 12]) {
        H.reset(); PU.reset(); P.pos.set(12, 0, 6); H.running = true; H.wave = w - 1; H.cleared = false; H.hold = false; H.nextWave(); PU.newWave(w);
        let lastDrop = false, bad = 0, k0 = game.kills;
        for (let f = 0; f < 200 * 30 && !H.cleared; f++) {
          game.time += 1/30; H.update(1/30, game.time, game.camera); PU.update(1/30, game.time, { pos: new V(99, 0, 99), alive: true });
          for (const e of H.enemies) if (!e.dead && !e.outside && f % 20 === 0) {
            const before = PU.st.drops; H.damage(e, 1e6, 'body', e.joints[1].clone(), new V(0, 0, 1), { id: 'ar' });
            if (PU.st.drops > before) { const s = PU.slots.find((q) => q.type && q.life > 21.9); const c = H.nav.cellOf(s.pos.x, s.pos.z);
              if (c < 0 || H.nav.blocked[c] || H.playerF.dist[c] >= 0x3fffffff) bad++;
              if (H.toSpawn <= 0 && H.bossDelay <= 0 && H.aliveCount() === 0) lastDrop = true; }
          }
          if (H.boss && !H.boss.dead) H.boss.hp = Math.min(H.boss.hp, 10);
        }
        out.push({ wave: w, kills: game.kills - k0, drops: PU.st.drops, onLastKill: lastDrop, unreachable: bad, cleared: H.cleared });
      }
      H.reset(); PU.reset(); H.running = false; game.state = 'play'; return JSON.stringify(out); }""")
    for r in json.loads(drops): print(json.dumps(r))
    print('ERRORS:', errs[:5]); b.close()
