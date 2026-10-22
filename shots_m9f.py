# M9f checks: machete held / mid-swing poses, live slash on a pack, lunge, axe board gone. usage: shots_m9f.py URL OUTDIR [tag]
import sys
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
tag = sys.argv[3] if len(sys.argv) > 3 else 'local'
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
    def shot(name): pg.screenshot(path=f'{out}/m9f-{tag}-{name}.png'); print('shot', name, flush=True)
    def tap(k): ev(f"__debug.key('{k}', true)"); ev("__debug.frames(2)"); ev(f"__debug.key('{k}', false)")
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    print('loadout', ev("game.arsenal.weapons.map(w => w.def.id)"), 'slots', ev("document.getElementById('slots').textContent"))
    ev("__debug.teleport(0, 0.05, 14); __debug.look(0.35, -0.02)"); gt(0.4)
    tap('Digit4'); gt(0.7)
    print('drawn', ev("game.blade.drawn"), 'hud', ev("document.getElementById('wname').textContent"), ev("document.getElementById('slots').textContent"))
    shot('held')
    ev("game.state = 'paused'")
    for k, t in [('R', 0.13), ('R', 0.2), ('R', 0.31), ('L', 0.2), ('lunge', 0.27)]:
        ev(f"""(() => {{ const X = game.blade; X.swing = null; X.queued = false; X.side = '{k}' === 'L' ? -1 : 1; X.start('{k}' === 'lunge' ? 'lunge' : null);
             for (let i = 0; i < Math.round({t} / 0.012); i++) X.update(0.012, 0, game.time); }})()""")
        pg.wait_for_timeout(1500); shot(f'pose-{k}-{t}')
    ev("game.blade.swing = null; game.state = 'play'"); gt(0.3)
    ev("__debug.look(0, -0.05)")
    ev("(() => { const V = game.player.pos.constructor; for (const [x, z] of [[-0.9, 12.3], [0.1, 12.0], [1.0, 12.4]]) { const e = game.horde.spawn('runner', new V(x, 0, z), true); e.wander.copy(e.pos); e.wanderT = 99; e.speed = 0.01; e.yaw = 0; } })()"); gt(0.6)
    k0 = ev("game.kills")
    ev("game.input.mouse.leftPressed = true"); ev("__debug.frames(2)")
    t0 = ev("game.time")
    while ev("game.time") - t0 < 0.2: pg.wait_for_timeout(8)
    shot('slash-hit'); gt(0.12); shot('slash-hit2'); gt(0.6); shot('slash-after')
    print('slash kills', ev("game.kills") - k0, 'alive', ev("game.horde.aliveCount()"))
    ev("game.horde.reset(); (() => { const V = game.player.pos.constructor; const e = game.horde.spawn('runner', new V(0, 0, 10), true); e.wander.copy(e.pos); e.wanderT = 99; e.speed = 0.01; })()"); gt(0.5)
    z0 = ev("game.player.pos.z"); tap('KeyV'); gt(0.7)
    print('lunge moved', round(z0 - ev("game.player.pos.z"), 2), 'kills', ev("game.kills") - k0)
    # back to guns, quick V swing from a gun, fire works
    tap('Digit1'); gt(0.5); print('after 1: drawn', ev("game.blade.drawn"), 'gun', ev("game.arsenal.current.def.id"), 'gunVisible', ev("game.arsenal.root.visible"))
    tap('KeyV'); gt(0.12); shot('quickswing'); gt(0.6)
    m0 = ev("game.arsenal.current.mag"); ev("game.input.mouse.leftPressed = true; game.input.mouse.left = true"); gt(0.3); ev("game.input.mouse.left = false")
    print('gun fired', m0 - ev("game.arsenal.current.mag"))
    # old fire-axe board spot
    ev("game.horde.reset(); __debug.teleport(17.0, 0.05, -16.7); __debug.look(-Math.PI / 2, -0.12)"); gt(0.5); shot('old-axe-spot')
    print('wallbuys', ev("game.wallbuys.list.map(b => b.id)"), 'prompt', repr(ev("document.getElementById('buyprompt').textContent")))
    ev("game.pts = 9999; game.openShop()"); gt(0.3)
    print('shop', ev("[...document.querySelectorAll('#buys .bn')].map(e => e.textContent)"))
    shot('shop')
    print('ERRORS:', errs[:5])
    b.close()
