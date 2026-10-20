# Usage: python3 shots_world.py <url> <outdir> <prefix>  (world wide shots)
import sys, json, time
from playwright.sync_api import sync_playwright
url, out, pre = sys.argv[1], sys.argv[2], sys.argv[3]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    t0 = time.time(); pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=120000); print('load s', round(time.time() - t0, 1), flush=True)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(50)
    ev("__debug.start(); __debug.god(true); __debug.quality('medium'); game.horde.running=false; game.horde.reset(); game.fx.clear()")
    views = [('street', (0, 2, 12), (0, 0.05)), ('corner', (-24, 0, 24), (2.35, 0.18)), ('facade', (20, 0, -26), (-2.0, 0.12)), ('gate', (-6, 0, 26), (-0.25, 0.08)), ('overpass', (0, 0, -6), (0.5, 0.15))]
    for name, pos, look in views:
        ev(f"__debug.teleport({pos[0]}, {pos[1]}, {pos[2]}); __debug.look({look[0]}, {look[1]})"); gt(0.5)
        pg.screenshot(path=f'{out}/{pre}-{name}.png'); print('shot', name, flush=True)
    print(json.dumps(ev('__debug.info()')), ev('JSON.stringify(game.arena.stats)'), ev('JSON.stringify(game.renderer.info.render)'))
    print('ERRORS:', errors[:10])
    b.close()
