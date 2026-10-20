import sys, time, json
from collections import Counter
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2]
errs = Counter()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('console', lambda m: m.type in ('error','warning') and errs.update([f'{m.type}: {m.text[:200]}']))
    pg.on('pageerror', lambda e: errs.update([f'pageerror: {e}']))
    pg.goto(url); pg.wait_for_timeout(4000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time'); end = time.time() + 120
        while ev('game.time') - t0 < sec and time.time() < end: pg.wait_for_timeout(100)
    pg.screenshot(path=f'{out}/screenshot-menu.png')
    ev("__debug.start(); __debug.god(true); game.horde.running=false; game.horde.reset();")
    ev("__debug.teleport(6, 0, 14); __debug.look(Math.PI*0.92, -0.02)"); gt(0.6)
    # a few husks down range
    ev("""(() => { const H = game.horde; for (const [x,z] of [[3,30],[8,32],[12,29],[0,33]]) { const e = H.spawn('runner', new game.player.pos.constructor(x,0,z)); e.speed = 0; e.outside = false; } })()""")
    gt(0.3)
    ev("__debug.set({left:true, leftPressed:true})"); gt(0.18)
    ev("__debug.frames(1)")
    pg.screenshot(path=f'{out}/screenshot-hipfire.png')
    ev("__debug.set({left:false})"); gt(0.3)
    ev("__debug.set({right:true})"); gt(0.5)
    pg.screenshot(path=f'{out}/screenshot-ads-iron.png')
    ev("__debug.set({right:false})"); ev("__debug.select(2)"); gt(0.8)
    ev("(() => { const e = game.horde.enemies[1]; const P = game.player.pos; const dx = e.pos.x - P.x, dz = e.pos.z - P.z; __debug.look(Math.atan2(-dx, -dz), Math.atan2(1.4 - 1.65, Math.hypot(dx, dz))); })()")
    ev("__debug.set({right:true})"); gt(0.7)
    pg.screenshot(path=f'{out}/screenshot-ads-reddot.png')
    ev("__debug.set({right:false})"); ev("__debug.select(0)"); gt(0.6)
    ev("game.horde.reset(); __debug.spawn(30, 16)"); gt(1.6)
    ev("__debug.set({left:true, leftPressed:true})"); gt(0.5)
    pg.screenshot(path=f'{out}/screenshot-horde.png')
    gt(0.4); ev("__debug.set({left:false})")
    print(ev("JSON.stringify(__debug.info())"))
    b.close()
print('ERRORS:', json.dumps(errs.most_common(20), indent=1))
