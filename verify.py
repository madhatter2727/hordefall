import sys, time, json
from collections import Counter
from playwright.sync_api import sync_playwright
url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173/'
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/hf'
import os; os.makedirs(out, exist_ok=True)
errs = Counter()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('console', lambda m: m.type in ('error','warning') and errs.update([f'{m.type}: {m.text[:200]}']))
    pg.on('pageerror', lambda e: errs.update([f'pageerror: {e}']))
    pg.goto(url); pg.wait_for_timeout(4000)
    pg.screenshot(path=f'{out}/menu.png')
    ev = lambda js: pg.evaluate(js)
    def gt(sec):
        t0 = ev('game.time'); end = time.time() + 90
        while ev('game.time') - t0 < sec and time.time() < end: pg.wait_for_timeout(100)
    ev("__debug.start()"); gt(2.5)
    ev("__debug.look(Math.PI, -0.04)")
    gt(0.8)
    # hip-fire AR
    ev("__debug.set({left:true, leftPressed:true})"); gt(0.25)
    pg.screenshot(path=f'{out}/hipfire.png')
    ev("__debug.set({left:false})"); gt(0.6)
    print('after hip', ev("JSON.stringify(__debug.info())"))
    # ADS AR iron sights
    ev("__debug.set({right:true})"); gt(1.5)
    pg.screenshot(path=f'{out}/ads-iron-ar.png')
    ev("__debug.set({right:false})"); ev("__debug.select(1)"); gt(1.5)
    ev("__debug.set({right:true})"); gt(1.5)
    pg.screenshot(path=f'{out}/ads-iron-sg.png')
    ev("__debug.set({right:false})"); ev("__debug.select(2)"); gt(1.5)
    ev("__debug.set({right:true})"); gt(1.8)
    pg.screenshot(path=f'{out}/ads-reddot.png')
    ev("__debug.set({right:false})"); gt(0.8)
    # horde
    ev("__debug.god(true); __debug.select(0); __debug.spawn(16, 13)"); gt(2.5)
    ev("__debug.set({left:true, leftPressed:true})"); gt(0.5)
    pg.screenshot(path=f'{out}/horde.png')
    pg.wait_for_timeout(700); ev("__debug.set({left:false})")
    gt(1.5)
    pg.screenshot(path=f'{out}/horde2.png')
    print('final', ev("JSON.stringify(__debug.info())"))
    b.close()
print('ERRORS:', json.dumps(errs.most_common(20), indent=1))
