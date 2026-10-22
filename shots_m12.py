# M12 checks: perk drinks (machines, drink animation, HUD icons, each effect measured, LAST GASP revive, reset on death).
# usage: shots_m12.py URL OUTDIR
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
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=240000)
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
    import json
    def F(): ev("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }))")
    prompt = lambda: ev("document.getElementById('buyprompt').textContent")
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset(); __debug.pts(30000)")
    res = {'before': ev("__debug.drinks()")}
    # machine fronts: stand 2.2 m out along each machine's facing, look back at it
    spots = ev("game.drinks.list.map(m => ({ id: m.d.id, x: m.pos.x + m.normal.x * 2.5, z: m.pos.z + m.normal.z * 2.5, yaw: Math.atan2(m.normal.x, m.normal.z) }))")
    def go(s, pitch=-0.05): ev(f"__debug.teleport({s['x']}, 0.05, {s['z']}); __debug.look({s['yaw']}, {pitch})"); gt(0.4)
    go(spots[0], 0.12); res['prompt'] = prompt(); shot('m12-perk-machines')
    go(spots[2], 0.12); shot('m12-perk-machines-2'); go(spots[0], 0.05)
    F(); gt(0.75); shot('m12-drinking'); gt(1.3)
    res['after BULWARK'] = ev("__debug.drinks()")
    for s in spots[1:]:
        go(s); res['prompt ' + s['id']] = prompt(); F(); gt(1.9); res['after ' + s['id']] = ev("__debug.drinks()")
    res['pts left'] = ev("game.pts")
    go(spots[1]); res['buy again'] = prompt()
    ev("__debug.teleport(12, 0.05, 6); __debug.look(0.2, 0)"); gt(0.5)
    shot('m12-perk-hud'); res['hud icons'] = ev("[...document.querySelectorAll('#drinkicons .dk span')].map(e => e.textContent)")
    # LAST GASP: a killing blow revives you once, then the next one kills
    ev("__debug.god(false)"); gt(0.1)
    ev("(() => { const P = game.player; game.onPlayerHit(9999, P.pos.clone().add(new P.pos.constructor(1, 0, 0)), null, { knock: 0.1 }); })()")
    res['after lethal hit #1'] = ev("__debug.drinks()") ; res['state #1'] = ev("game.state")
    gt(3.3)
    ev("(() => { const P = game.player; game.onPlayerHit(9999, P.pos.clone().add(new P.pos.constructor(1, 0, 0)), null, { knock: 0.1 }); })()")
    res['after lethal hit #2'] = ev("__debug.drinks()"); res['state #2'] = ev("game.state")
    ev("__debug.start()"); gt(0.3); res['after restart'] = ev("__debug.drinks()"); res['hud icons after restart'] = ev("document.getElementById('drinkicons').children.length")
    res['minimap drink icons'] = ev("game.drinks.icons().length")
    for k, v in res.items(): print(k, '=>', json.dumps(v), flush=True)
    print('ERRORS:', errs)
    b.close()
