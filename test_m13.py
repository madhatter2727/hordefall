# M13 doors test (logic sim, no screenshots): buy each barrier, check nav opens, zombies path in, area spawns
# switch on, the Colossus reaches the player inside each area (and back out). usage: test_m13.py URL
import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 640, 'height': 360}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:400])); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if 'vercel.app' in url: pg.route('**/api/scores', lambda r: r.abort() if r.request.method == 'POST' else r.continue_())
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=240000); ev = pg.evaluate
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset(); __debug.pts(5000)")
    R = {}
    PROBE = """() => { const H = game.horde, r = {};
      for (const [k, x, z] of [['stairMid', -23.1, -30], ['gate', -20.3, -30], ['roof', -30, -31], ['shutter', 31, 27], ['underIn', 30, 31]]) r[k] = [__debug.navAt(x, z), __debug.navAt(x, z, true)].map((q) => q.blocked + '/' + q.h).join(' ');
      // can a zombie standing in the plaza reach the roof / underpass? (flow field from the target)
      for (const [k, x, y, z, big] of [['roofReach', -30, 3.2, -31, 0], ['roofReachBig', -30, 3.2, -31, 1], ['underReach', 30, 0, 31, 0], ['underReachBig', 30, 0, 31, 1]]) {
        const N = big ? H.navBig : H.nav, F = N.build(x, z, y, 'probe' + k), c = N.cellOf(0, 6); r[k] = F.dist[c] < 0x3fffffff; }
      return r; }"""
    R['nav before'] = ev(PROBE)
    R['doors before'] = ev("__debug.doors()")
    # buy each door the real way: walk up, read the prompt, press F
    for id, x, z, yaw in [('roof', -18.9, -30, 1.5708), ('underpass', 31, 25.6, 3.1416)]:
        ev(f"__debug.teleport({x}, 0.05, {z}); __debug.look({yaw}, 0.05); __debug.frames(3)")
        R['prompt ' + id] = ev("document.getElementById('buyprompt').textContent")
        pts0 = ev("game.pts"); ev("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }))"); ev("__debug.frames(40)")
        R['bought ' + id] = {'paid': pts0 - ev("game.pts"), 'doors': ev("__debug.doors()"), 'promptAfter': ev("document.getElementById('buyprompt').textContent")}
    R['nav after'] = ev(PROBE)
    # zombies walk in: player stands inside; runners start out in the plaza
    R['path'] = ev("""() => { const H = game.horde, P = game.player, V = P.pos.constructor, out = {}; game.state = 'paused';
      for (const [k, px, py, pz, sx, sz] of [['roof', -31, 3.2, -31.5, -8, -24], ['underpass', 30, 0, 31.5, 14, 16]]) {
        H.reset(); H.running = false; H.wave = 6; const es = [];
        for (let i = 0; i < 4; i++) { const e = H.spawn(i % 2 ? 'brute' : 'runner', new V(sx + i, 0, sz + i * 0.7)); e.aware = true; es.push(e); }
        const reach = es.map(() => -1);
        for (let f = 0; f < 70 * 30; f++) { game.time += 1/30; P.pos.set(px, py, pz); H.update(1/30, game.time, game.camera);
          es.forEach((e, i) => { e.attackCd = 99; if (reach[i] < 0 && Math.hypot(e.pos.x - px, e.pos.z - pz) < 2.6 && Math.abs(e.pos.y - py) < 1) reach[i] = +(f / 30).toFixed(1); });
          if (reach.every((t) => t >= 0)) break; }
        out[k] = { reachS: reach, respawns: H.navStats.respawns };
      }
      H.reset(); game.state = 'play'; return out; }""")
    # area spawns: run a real wave with the player in the plaza; log where zombies spawn
    R['spawns'] = ev("""() => { const H = game.horde, P = game.player, V = P.pos.constructor; game.state = 'paused';
      H.reset(); P.pos.set(4, 0, 6); H.running = true; H.wave = 7; H.cleared = false; H.hold = false; H.nextWave();
      const orig = H.spawn.bind(H), log = { roof: 0, underpass: 0, street: 0 }, firstIn = {}; H.spawn = (k, at, idle) => { const e = orig(k, at, idle);
        if (at.x < -20 && at.z < -27) log.roof++; else if (at.x > 26 && at.z > 27) log.underpass++; else log.street++;
        if (at.x > 26 && at.z > 27) firstIn.underpass = firstIn.underpass || e; if (at.x < -20 && at.z < -27) firstIn.roof = firstIn.roof || e; return e; };
      const leave = {};
      for (let f = 0; f < 90 * 30; f++) { game.time += 1/30; P.pos.set(4, 0, 6); H.update(1/30, game.time, game.camera);
        for (const [k, e] of Object.entries(firstIn)) if (!leave[k] && !e.dead) { e.attackCd = 99; if (Math.hypot(e.pos.x - 4, e.pos.z - 6) < 3) leave[k] = +(f / 30).toFixed(1); } }
      H.spawn = orig; H.reset(); H.running = false; game.state = 'play';
      return { ...log, fromAreaReachedPlayerS: leave }; }""")
    # the Colossus: chase the player into each area and back out again
    CASES = [('boss to roof', -31, 3.2, -31.5, -6, -24), ('boss to underpass', 30, 0, 32, 10, 14), ('boss out of underpass', 8, 0, 10, 31, 31), ('boss off roof', -10, 0, -8, -31, -31)]
    R['boss'] = ev("""(cases) => { const H = game.horde, P = game.player, V = P.pos.constructor, out = []; game.state = 'paused';
      for (const [name, px, py, pz, bx, bz] of cases) {
        H.reset(); H.running = false; H.wave = 5; P.pos.set(px, py, pz); P.vel.set(0, 0, 0);
        const by = bx < -25 && bz < -27 ? 3.2 : 0;
        const e = H.spawnBoss(new V(bx, by, bz)); e.pos.y = by; e.aware = true;
        let reachT = -1, still = 0, maxStill = 0, lp = e.pos.clone(); const r0 = H.navStats.respawns;
        for (let f = 0; f < 120 * 30; f++) { game.time += 1/30; H.update(1/30, game.time, game.camera); e.hp = e.maxHp; e.attackCd = 99; P.pos.set(px, py, pz);
          if (reachT < 0 && Math.hypot(e.pos.x - px, e.pos.z - pz) < 4.6 && Math.abs(e.pos.y - py) < 1.8) { reachT = f / 30; break; }
          if (f % 30 === 0) { still = lp.distanceTo(e.pos) < 0.3 ? still + 1 : 0; maxStill = Math.max(maxStill, still); lp.copy(e.pos); } }
        out.push({ name, reachS: +reachT.toFixed(1), maxStillS: maxStill, respawns: H.navStats.respawns - r0, end: e.pos.toArray().map((v) => +v.toFixed(1)) });
      }
      H.reset(); game.state = 'play'; return out; }""", CASES)
    # restart closes the doors again
    ev("game.restart(true); game.show(null)"); R['after restart'] = ev("__debug.doors()"); R['nav after restart'] = ev(PROBE)
    for k, v in R.items(): print(k, json.dumps(v))
    print('ERRORS', len(errs)); [print('  ', e[:300]) for e in errs[:10]]
    b.close()
