# M9e checks: skyline wide shots + zombie close-ups. usage: shots_m9e.py URL OUTDIR sections TAG
import sys
from playwright.sync_api import sync_playwright
url, out, secs, tag = sys.argv[1], sys.argv[2], set(sys.argv[3].split(',')), sys.argv[4]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if 'vercel.app' in url:
        pg.route('**/api/scores', lambda route: route.abort() if route.request.method == 'POST' else route.continue_())
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=180000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(30)
    def shot(name): pg.screenshot(path=f'{out}/m9e-{name}-{tag}.png'); print('shot', name, flush=True)
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    if 'sky' in secs:
        ev("__debug.teleport(0, 2.4, 3.5)")
        for i, (yaw, pitch) in enumerate([(0.0, 0.12), (2.4, 0.1), (-1.9, 0.16), (-0.9, 0.22)]):
            ev(f"__debug.look({yaw}, {pitch})"); gt(0.6); shot(f'sky{i}')
        ev("__debug.teleport(-16, 5.3, -8); __debug.look(0.6, 0.05)"); gt(0.6); shot('sky4')
    if 'zom' in secs:
        ev("game.horde.reset(); __debug.teleport(0, 0.05, 14); __debug.look(0, -0.08)"); gt(0.3)
        ev("""(() => { const V = game.player.pos.constructor; const ks = ['runner', 'spitter', 'runner', 'brute'];
          [[-1.3, 11.4], [0.2, 11.0], [1.4, 11.6], [0.4, 8.6]].forEach(([x, z], i) => { const e = game.horde.spawn(ks[i], new V(x, 0, z), true); e.wander.copy(e.pos); e.wanderT = 99; e.speed = 0.01; e.yaw = 0; }); })()""")
        gt(1.2); ev("game.state = 'paused'"); pg.wait_for_timeout(1200); shot('zom')
        ev("for (const e of game.horde.list || []) e.flash = 1; for (const e of game.horde.alive?.() || []) e.flash = 1"); 
        ev("(() => { const H = game.horde; const arr = H.enemies || H.list || H.pool || []; for (const e of arr) if (e.rig) e.rig.u.uFlash.value = 1; })()"); pg.wait_for_timeout(1200); shot('zomflash')
        ev("game.state = 'play'")
        ev("__debug.teleport(-6, 0.05, 6); __debug.look(-2.4, -0.05)"); gt(0.2)
        ev("""(() => { const V = game.player.pos.constructor; for (const [x, z] of [[-3.6, 8.6], [-4.4, 9.4]]) { const e = game.horde.spawn('runner', new V(x, 0, z), true); e.wander.copy(e.pos); e.wanderT = 99; e.speed = 0.01; } })()""")
        gt(1.0); ev("game.state = 'paused'"); pg.wait_for_timeout(1200); shot('zom2'); ev("game.state = 'play'")
    print('ERRORS:', errs[:5])
