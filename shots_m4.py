import sys, time, json
from collections import Counter
from playwright.sync_api import sync_playwright
url = sys.argv[1]; out = sys.argv[2]; only = sys.argv[3].split(',') if len(sys.argv) > 3 else None
errs = Counter()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('console', lambda m: m.type in ('error','warning') and errs.update([f'{m.type}: {m.text[:200]}']))
    pg.on('pageerror', lambda e: errs.update([f'pageerror: {e}']))
    pg.goto(url); pg.wait_for_timeout(5000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time'); end = time.time() + 120
        while ev('game.time') - t0 < sec and time.time() < end: pg.wait_for_timeout(60)
    def shot(name):
        if only is None or name in only: pg.screenshot(path=f'{out}/m4-{name}.png')
    ev("__debug.start(); __debug.god(true); game.horde.running=false; game.horde.reset();")
    ev("__debug.teleport(6, 0, 14); __debug.look(Math.PI*0.92, -0.02)"); gt(0.5)
    ev("""(() => { const H = game.horde; for (const [x,z] of [[3,30],[8,32],[12,29],[0,33]]) { const e = H.spawn('runner', new game.player.pos.constructor(x,0,z)); e.speed = 0; e.outside = false; } })()""")
    gt(0.3)
    def fire_frame(name):
        ev("__debug.set({left:true, leftPressed:true})"); ev("__debug.frames(1)")
        shot(name); ev("__debug.set({left:false})"); gt(0.5)
    for i, n in enumerate(['ar', 'sg', 'mr']):
        ev(f"__debug.select({i})"); gt(0.8)
        fire_frame(f'hipfire-{n}')
        ev("game.arsenal.aimRecoil.pitch = 0; game.arsenal.aimRecoil.yaw = 0"); gt(0.5)
        ev("__debug.set({right:true})"); gt(0.7)
        if n == 'mr':
            ev("(() => { const e = game.horde.enemies[1]; const P = game.player.pos; const dx = e.pos.x - P.x, dz = e.pos.z - P.z; __debug.look(Math.atan2(-dx, -dz), Math.atan2(1.3 - 1.65, Math.hypot(dx, dz))); })()"); gt(0.4)
        shot(f'ads-{n}')
        if n == 'ar':
            fire_frame('ads-fire-ar')
        ev("__debug.set({right:false})"); gt(0.4)
        ev("__debug.look(Math.PI*0.92, -0.02)")
    # reloads
    ev("__debug.select(0)"); gt(0.8)
    ev("game.arsenal.current.mag = 0; __debug.key('KeyR', true)"); gt(0.05); ev("__debug.key('KeyR', false)")
    # freeze the reload timeline at chosen beats so slow software rendering gets exact frames
    for t, n in [(0.24, 'reload-ar-magout'), (0.54, 'reload-ar-magin'), (0.74, 'reload-ar-charge')]:
        ev(f"game.arsenal.freezeT = {t}"); gt(0.4); shot(n)
    ev("game.arsenal.freezeT = undefined")
    gt(1.0)
    ev("__debug.select(1)"); gt(0.8)
    ev("game.arsenal.current.mag = 3; __debug.key('KeyR', true)"); gt(0.05); ev("__debug.key('KeyR', false)")
    gt(0.5); ev("game.arsenal.freezeK = 0.45"); gt(0.4); shot('reload-sg-shell'); ev("game.arsenal.freezeK = undefined")
    gt(2.5)
    ev("__debug.select(0)"); gt(0.8)
    ev("__debug.key('KeyV', true)"); gt(0.05); ev("__debug.key('KeyV', false)"); gt(0.13); shot('melee')
    gt(0.8)
    # idle alert test
    ev("game.horde.reset(); __debug.spawn(8, 24, true)"); gt(0.5)
    before = ev("__debug.info().idle")
    ev("__debug.set({left:true, leftPressed:true})"); gt(0.1); ev("__debug.set({left:false})"); gt(1.2)
    after = ev("__debug.info().idle")
    print('idle before/after shot:', before, after)
    ev("__debug.spawn(24, 15)"); gt(1.5)
    ev("__debug.set({left:true, leftPressed:true})"); gt(0.6)
    shot('horde'); ev("__debug.set({left:false})")
    print(ev("JSON.stringify(__debug.info())"))
    b.close()
print('ERRORS:', json.dumps(errs.most_common(20), indent=1))
