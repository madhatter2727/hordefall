# M7 checks: intermission shop, barrels, new guns, game over. usage: shots_m7.py URL OUTDIR [only,names]
import sys, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else None
want = lambda n: only is None or n in only
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=180000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(40)
    def shot(name): pg.screenshot(path=f'{out}/m7-{name}.png'); print('shot', name, flush=True)
    ev("__debug.start(); __debug.god(true)")
    if want('shop'):
        gt(3.5)
        ev("__debug.clearWave()")
        pg.wait_for_function("game.state === 'shop'", timeout=60000)
        ev("__debug.pts(2600)"); ev("game.renderBuys()")
        pg.wait_for_timeout(900); shot('shop')
        pg.keyboard.press('Digit2'); pg.wait_for_timeout(500)
        pg.click('.buy[data-k="armor"]'); pg.wait_for_timeout(600); shot('shop-picked')
        print('perks', ev("JSON.stringify(game.perks)"), 'pts', ev("game.pts"), 'armor', ev("game.player.armor"), 'mods', ev("JSON.stringify(game.arsenal.mods)"))
        pg.click('#ready'); pg.wait_for_timeout(300)
        ev("game.forceLock = true; game.input.locked = true; game.show(null)")
        gt(3.2)
        print('after ready', ev("JSON.stringify({s: game.state, wave: game.horde.wave, left: game.horde.remaining()})"))
        gt(0.6); shot('hud')
    print('ERRORS:', errs[:8])
    b.close()
