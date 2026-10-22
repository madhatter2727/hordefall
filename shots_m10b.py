# M10b: Colossus climbing the platform stairs and taking hits (points + hit marker).
# usage: shots_m10b.py URL OUTDIR
import sys, math
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
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
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(20)
    def shot(name): pg.screenshot(path=f'{out}/{name}.png'); print('shot', name, flush=True)
    def fire():
        ev("game.input.mouse.leftPressed = true; game.input.mouse.left = true"); gt(0.05); ev("game.input.mouse.left = false")
    # pause just the named element's CSS animation at a given time so slow headless frames don't miss it
    def freeze(ms, el): ev(f"document.getElementById('{el}').getAnimations().forEach(a => {{ a.pause(); a.currentTime = {ms}; }})")
    def thaw(): ev("document.getAnimations().forEach(a => a.play())")
    def tap(k, n=2): ev(f"__debug.key('{k}', true)"); ev(f"__debug.frames({n})"); ev(f"__debug.key('{k}', false)")
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    ev("""(() => { window.__stand = (type, x, z, hp) => { const V = game.player.pos.constructor; const e = game.horde.spawn(type, new V(x, 0, z), true); e.wander.copy(e.pos); e.wanderT = 99; e.speed = 0.01; e.yaw = 0; if (hp) e.hp = hp; return game.horde.enemies.indexOf(e); }; })()""")
    ev("""(() => { window.__aimAt = (i, part) => { const e = game.horde.enemies[i], j = e.joints[part === 'head' ? 2 : 1], c = game.camera.position, P = game.player;
      const dx = j.x - c.x, dy = j.y - c.y + (part === 'head' ? 0.03 : 0), dz = j.z - c.z; __debug.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }; })()""")
    # 1. three pickups on the ground
    ev("__debug.teleport(0, 0.05, 16); __debug.look(0, -0.12)"); gt(0.3)
    ev("__debug.teleport(2.2, 2.05, 2.5); __debug.look(0, -0.18)"); gt(0.3)
    ev("""(() => { const H = game.horde, V = game.player.pos.constructor; H.wave = 5; const e = H.spawnBoss(new V(0.3, 0, -11)); e.aware = true; e.chargeCd = 1e9; window.__b = e; })()""")
    t = 0
    while t < 40:
        gt(0.25); t += 0.25
        y, z = ev("[__b.pos.y, __b.pos.z]")
        if y > 0.7: break
    print('boss on stairs at', ev("__b.pos.toArray()"), 'after', t)
    ev("__b.speed = 0.01; __b.attackCd = 99")
    ev("game.arsenal.select(0)")
    pts0 = ev("game.pts")
    gt(0.2)
    ev("""(() => { const j = __b.joints[1], c = game.camera.position; const dx = j.x - c.x, dy = j.y - c.y, dz = j.z - c.z; __debug.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); })()""")
    ev("document.getElementById('hitmarker').className = ''; game.input.mouse.leftPressed = true; game.input.mouse.left = true"); gt(0.35)
    ev("game.input.mouse.left = false")
    freeze(60, 'hitmarker')
    shot('m10b-colossus-stairs'); thaw()
    print('pts gained', ev("game.pts") - pts0, 'marker', ev("document.getElementById('hitmarker').className"), 'boss hp', ev("__debug.bossInfo()"))
    print('ERRORS:', errs)
    b.close()
