# M9 checks: nav stuck test, melee, minimap, skyline. usage: shots_m9.py URL OUTDIR [only,names]
import sys, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else None
want = lambda n: only is None or n in only
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:600]))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if 'vercel.app' in url:
        pg.route('**/api/scores', lambda route: route.abort() if route.request.method == 'POST' else route.continue_())
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=180000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(30)
    def shot(name): pg.screenshot(path=f'{out}/m9-{name}.png'); print('shot', name, flush=True)
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    ev("window.__step = (n) => { const H = game.horde, T = game.throwables; for (let i = 0; i < n; i++) { game.time += 1/30; H.update(1/30, game.time, game.camera); T.update(1/30, game.time); game.fx.update(1/30, game.camera, game.time); } }")
    if want('stuck'):
        spots = sys.argv[4].split(';') if len(sys.argv) > 4 else None
        SPOTS = [('platform top', 0, 2.0, 0), ('container top', -16, 2.6, -5.4), ('crate stack top', -4, 2.0, -15),
                 ('behind container N', 8, 0, -22.2), ('behind container S', -12, 0, 17), ('behind car', -20, 0, 34.0),
                 ('behind crate', 27.4, 0, 6), ('under overpass', 3, 0, -22), ('between containers', -16, 0, -3.6), ('open plaza', 12, 0, 0)]
        res = ev("""(spots) => { const H = game.horde, P = game.player, V = P.pos.constructor, nav = H.nav; game.state = 'paused';
          const out = []; let totalMs = 0, frames = 0, worst = 0;
          for (const [name, x, y, z] of spots) {
            H.reset(); H.running = false; P.pos.set(x, y, z); P.vel.set(0, 0, 0);
            for (const k in H.navStats) H.navStats[k] = 0;
            const zs = [];
            H.arena.spawns.forEach((sp, gi) => { for (let i = 0; i < 6; i++) { const e = H.spawn(i === 5 ? 'brute' : 'runner', new V(sp.x + (Math.random() - 0.5) * 4, 0, sp.z + (Math.random() - 0.5) * 4), false); e.speed = i % 2 ? 1.2 : 3.4; zs.push(e); } });
            for (let i = 0; i < 10; i++) { let c; do { c = Math.floor(Math.random() * nav.N * nav.N); } while (nav.blocked[c] || nav.height[c] > 0 || nav.near[c]); const q = nav.center(c, new V()); const e = H.spawn('runner', new V(q.x, 0, q.z), false); e.speed = 2.6; zs.push(e); }
            let reachT = 0; const nb0 = H.navStats.builds;
            for (let f = 0; f < 60 * 30; f++) {
              game.time += 1/30; const t0 = performance.now(); H.update(1/30, game.time, game.camera); const ms = performance.now() - t0;
              totalMs += ms; frames++; if (f > 60) worst = Math.max(worst, ms);
              for (const e of zs) e.hp = 1e9; // nobody dies of fatigue
              P.pos.set(x, y, z); P.vel.set(0, 0, 0);
              if (f === 52 * 30) for (const e of zs) e._p = e.pos.clone();
            }
            const F = H.playerF;
            const info = (e) => { const c = nav.cellOf(e.pos.x, e.pos.z); let nn = 9; for (const o of zs) if (o !== e) nn = Math.min(nn, o.pos.distanceTo(e.pos));
              return { p: [+e.pos.x.toFixed(1), +e.pos.y.toFixed(1), +e.pos.z.toFixed(1)], d: +Math.hypot(e.pos.x - x, e.pos.z - z).toFixed(1), moved8: +e.pos.distanceTo(e._p).toFixed(2), nn: +nn.toFixed(2), fd: c >= 0 ? F.dist[c] : -1, nx: e.navNext, dh: +e.navDh.toFixed(2), stk: e.stk.n, sp: +e.speedNow.toFixed(2), att: e.attackT >= 0, out: e.outside, aw: e.aware }; };
            const reached = (e) => Math.hypot(e.pos.x - x, e.pos.z - z) < 3.2 && Math.abs(e.pos.y - y) < 1.7;
            const notR = zs.filter((e) => !reached(e)).map(info);
            // stuck = hasn't moved in the last 8 s and isn't just queued shoulder-to-shoulder in the crowd
            const fail = notR.filter((i) => i.moved8 < 0.6 && i.nn > 1.05);
            out.push({ spot: name, zombies: zs.length, reached: zs.length - notR.length, queued: notR.length - fail.length, stuck: fail.length, respawns: H.navStats.respawns, climbs: H.navStats.climbs, sidesteps: H.navStats.sidesteps, vaults: H.navStats.vaults, fieldMs: +H.navStats.buildMs.toFixed(2), builds: H.navStats.builds,
              where: fail.slice(0, 5), q: notR.filter((i) => !fail.includes(i)).slice(0, 4) });
          }
          H.reset(); game.state = 'play';
          return JSON.stringify({ out, avgMs: +(totalMs / frames).toFixed(2), worstMs: +worst.toFixed(2) }); }""", [s for s in SPOTS if not spots or s[0] in spots])
        r = json.loads(res)
        for o in r['out']: print(json.dumps(o))
        print('horde.update ms/frame avg', r['avgMs'], 'worst', r['worstMs'])
    print('ERRORS:', errs[:5])
    b.close()
