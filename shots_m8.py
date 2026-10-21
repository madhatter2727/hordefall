# M8 checks: gait (stride matching), pacing, decoy, grenades. usage: shots_m8.py URL OUTDIR [only,names]
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
    def shot(name): pg.screenshot(path=f'{out}/m8-{name}.png'); print('shot', name, flush=True)
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    gt(0.5)
    if want('gait'):
        # deterministic: step the horde at 60 Hz in-page and measure how fast the planted foot skates
        res = ev("""(() => { const H = game.horde, V = game.player.pos.constructor, out = [];
          game.player.pos.set(-20, 0, 26);
          const cases = [['runner', 0.9, 0], ['runner', 1.4, 0], ['runner', 3.4, 0], ['runner', 5.6, 0], ['spitter', 2.6, 0], ['brute', 2.4, 0], ['boss', 3.5, 0], ['runner', 1.0, 1]];
          for (const [type, sp, crawl] of cases) {
            H.reset(); const e = type === 'boss' ? H.spawnBoss(new V(-20, 0, -26)) : H.spawn(type, new V(-20, 0, -26), false);
            e.speed = sp; e.attackCd = 99; e.outside = false; if (e.gait) e.gait.limp = 0; e.spitCd = 99; e.chargeCd = 99; e.slamCd = 99;
            if (crawl) { e.crawl = true; e.lost |= (1<<6)|(1<<8); }
            const rec = [];
            for (let i = 0; i < 300; i++) { H.update(1/60, game.time + i/60, game.camera); const j = e.joints; rec.push([e.pos.x, e.pos.z, j[11].x, j[11].y, j[11].z, j[14].x, j[14].y, j[14].z, j[5].x, j[5].y, j[5].z, j[8].x, j[8].y, j[8].z]); }
            const r = rec.slice(90); let body = 0, slip = 0, n = 0;
            const fi = crawl ? [8, 11] : [2, 5];
            const minY = Math.min(...r.map(q => Math.min(q[fi[0]+1], q[fi[1]+1])));
            for (let i = 1; i < r.length; i++) { const a = r[i-1], b = r[i];
              body += Math.hypot(b[0]-a[0], b[1]-a[1]) * 60;
              const v0 = Math.hypot(b[fi[0]]-a[fi[0]], b[fi[0]+2]-a[fi[0]+2]) * 60, v1 = Math.hypot(b[fi[1]]-a[fi[1]], b[fi[1]+2]-a[fi[1]+2]) * 60;
              slip += Math.min(v0, v1); n++; }
            out.push({ type: type + (crawl ? '-crawl' : ''), set: sp, body: +(body / (r.length - 1)).toFixed(2), plantedFoot: +(slip / Math.max(1, n)).toFixed(2), plantedFrames: n, anim: e.anim });
          }
          H.reset(); return out; })()""")
        for r in res: print(json.dumps(r))
    if want('walk'):
        # side-on parade below the platform: unaware husks wander across at fixed ground speeds
        ev("__debug.give('mr')"); gt(0.2); ev("game.arsenal.select(game.arsenal.weapons.findIndex(w => w.def.id === 'mr'))")
        ev("__debug.teleport(0, 2.4, -3.5)"); ev("__debug.look(0, -0.16)"); gt(1.0); print("player", ev("JSON.stringify(game.player.pos)"), ev("game.arsenal.current.def.id"))
        ev("""(() => { const V = game.player.pos.constructor; window.__w = [];
          const mk = (type, x, z, sp, crawl) => { const e = type === 'boss' ? game.horde.spawnBoss(new V(x, 0, z)) : game.horde.spawn(type, new V(x, 0, z), true);
            e.aware = false; e.outside = false; e.speed = sp / 0.2; e.wander.set(x + 30, 0, z); e.wanderT = 99; e.alertIn = undefined; e.yaw = Math.PI / 2;
            if (crawl) { e.crawl = true; e.lost |= (1<<6)|(1<<8); } window.__w.push(e); return e; };
          mk('runner', -7, -15, 1.0); mk('runner', -10, -17.5, 1.3); mk('runner', -13, -20, 3.4, 0); mk('spitter', -15, -22.5, 2.4); mk('brute', -9, -13, 1.6); mk('runner', -6, -12.4, 0.7, 1);
        })()""")
        ev("__debug.set({right:true})"); gt(2.2)
        for i in range(6): shot(f'walk-{i}'); gt(0.1)
        ev("__debug.set({right:false})")
        ev("game.horde.reset()")
    if want('pace'):
        info = "JSON.stringify((() => { const H = game.horde, a = H.enemies.filter(e => !e.dead); const c = {}; for (const e of a) { const k = e.key === 'runner' ? e.cls : e.key; c[k] = (c[k] || 0) + 1; } return { wave: H.wave, alive: a.length, toSpawn: H.toSpawn, mix: c, speeds: a.map(e => +e.speed.toFixed(1)).sort((x, y) => x - y), hp: a.map(e => Math.round(e.maxHp)) }; })())"
        ev("game.horde.reset(); game.horde.start()"); ev("__debug.teleport(0, 2.4, 2)"); ev("__debug.look(Math.PI, -0.1)")
        step = "(n) => { const H = game.horde; for (let i = 0; i < n; i++) H.update(1/30, game.time + i/30, game.camera); }"
        ev(f"({step})(14*30)"); gt(0.3); print('wave1', ev(info)); shot('wave1')
        ev("game.horde.reset(); game.horde.start(); game.horde.wave = 10; game.horde.nextWave()"); ev(f"({step})(12*30)"); gt(0.3); print('wave11', ev(info)); shot('wave11')
        ev("game.horde.reset()")
    print('ERRORS:', errs[:8])
    b.close()
