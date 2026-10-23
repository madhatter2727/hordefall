# M13 screenshots: doors (locked w/ prompt, opened, new area) + nightfall (dusk, night). usage: shots_m13.py URL OUTDIR [doors|night]
import sys, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]; sec = sys.argv[3] if len(sys.argv) > 3 else 'doors,night'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:600]))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if 'vercel.app' in url:
        pg.route('**/api/scores', lambda route: route.abort() if route.request.method == 'POST' else route.continue_())
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=240000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(20)
    def shot(name): pg.screenshot(path=f'{out}/{name}.png'); print('shot', name, flush=True)
    def F(): ev("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }))")
    prompt = lambda: ev("document.getElementById('buyprompt').textContent")
    def go(x, y, z, yaw, pitch=0.0): ev(f"__debug.teleport({x}, {y}, {z}); __debug.look({yaw}, {pitch})"); gt(0.3)
    def wave(w): ev(f"(() => {{ game.horde.wave = {w}; __debug.night({w}); }})()")
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset(); __debug.pts(6000)")
    R = {}
    if 'doors' in sec:
        wave(1)
        go(-16.9, 0.05, -30.4, 1.5, 0.16); R['prompt roof'] = prompt(); shot('m13-door-locked')
        F(); gt(2.6); go(-14.6, 0.05, -30.0, 1.5708, 0.2); shot('m13-door-opened'); R['doors'] = ev("__debug.doors()")
        go(31.0, 0.05, 23.2, 3.1416, 0.2); R['prompt under'] = prompt(); shot('m13-door-locked-2'); F(); gt(2.4)
        ev("__debug.crateTo(4)")
        go(27.0, 0.05, 28.0, -2.35, 0.06); shot('m13-new-area')
        go(-26.3, 3.25, -29.6, 1.14, -0.04); shot('m13-new-area-roof')
        ev("(() => { const v = new (game.player.pos.constructor)(); return 0; })()")
        go(-27.0, 3.25, -31.2, 1.5708, -0.02); R['prompt lastgasp'] = prompt()
    if 'night' in sec:
        ev("game.horde.reset()")
        for w, name in [(6, 'm13-dusk'), (12, 'm13-night')]:
            ev("game.horde.reset()"); wave(w)
            go(14, 0.05, 5, 0.42, 0.05)
            ev("__debug.spawn(5, 8, true, 'runner', game.player.yaw + Math.PI)")
            gt(1.2); R[name] = ev("__debug.night()"); shot(name)
    for k, v in R.items(): print(k, json.dumps(v))
    print('ERRORS', len(errs)); [print('  ', e[:300]) for e in errs[:10]]
    b.close()
