# M13 regression smoke: crate (incl. jam into THE UNDERPASS only once open), forge, all 4 drinks (LAST GASP on the
# roof), machete kill, nightfall stages. usage: smoke_m13.py URL
import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 640, 'height': 360}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:400])); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if 'vercel.app' in url: pg.route('**/api/scores', lambda r: r.abort() if r.request.method == 'POST' else r.continue_())
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=240000); ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(20)
    def F(): ev("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }))")
    prompt = lambda: ev("document.getElementById('buyprompt').textContent")
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset(); __debug.pts(60000)")
    # stand in front of something along its facing normal and look back at it
    def front(pos, n, d, y=0.05):
        ev(f"(() => {{ const yaw = Math.atan2({n[0]}, {n[2]}); __debug.teleport({pos[0]} + {n[0]} * {d}, {y}, {pos[2]} + {n[2]} * {d}); __debug.look(yaw, 0.02); }})()"); gt(0.3)
    R = {}
    c = ev("(() => { const c = game.stations.crates[0]; return { p: c.pos.toArray(), n: c.normal.toArray() }; })()")
    front(c['p'], c['n'], 1.6); R['crate prompt'] = prompt(); p0 = ev("game.pts"); F(); gt(0.2); R['crate paid'] = p0 - ev("game.pts")
    ev("game.stations.crate.t = 4.1"); t = 0
    while ev("game.stations.crate.state") != 'offer' and t < 10: gt(0.25); t += 0.25
    won = ev("game.stations.crate.result"); F(); gt(0.6); R['crate won/loadout'] = [won, ev("game.arsenal.weapons.map(w => w.base.id)")]
    # jam destinations: locked -> never spot 4; open -> spot 4 shows up
    def jams(n):
        out = []
        for i in range(n):
            ev("game.stations.reset()"); front(c['p'], c['n'], 1.6); F(); ev("game.stations.crate.jam = true; game.stations.crate.t = 4.1"); gt(0.3)
            out.append(ev("game.stations.crate.next"))
        return out
    R['jam next (underpass locked)'] = jams(6)
    ev("__debug.openDoor('underpass', true); __debug.openDoor('roof', true)")
    R['jam next (underpass open)'] = jams(6)
    ev("game.stations.reset()")
    # forge (wave 6 price) on the gun in hand
    ev("game.horde.wave = 6; __debug.select(0)"); f = ev("(() => { const F = game.stations.forge; return { p: F.pos.toArray(), n: F.normal.toArray() }; })()")
    front(f['p'], f['n'], 1.7); R['forge prompt'] = prompt(); p0 = ev("game.pts"); F(); gt(0.2); R['forge paid'] = p0 - ev("game.pts")
    ev("game.stations.forge.t = 3.3"); t = 0
    while ev("__debug.forge().state") != 'ready' and t < 12: gt(0.25); t += 0.25
    F(); gt(0.5); R['forged'] = ev("game.arsenal.current.up ? game.arsenal.current.def.name : null")
    # all four drinks (LAST GASP up on the roof)
    for m in ev("game.drinks.list.map(m => ({ id: m.d.id, p: m.pos.toArray(), n: m.normal.toArray() }))"):
        front(m['p'], m['n'], 1.9, m['p'][1] + 0.05); pr = prompt(); F(); gt(2.0); R['drink ' + m['id']] = [pr[:40], ev("__debug.drinks().owned.length")]
    # machete kill
    ev("game.horde.reset(); __debug.teleport(6, 0.05, 6); __debug.look(0, 0)"); gt(0.2)
    ev("__debug.spawn(1, 1.5, true, 'runner', game.player.yaw + Math.PI)"); k0 = ev("game.kills")
    for i in range(4): ev("__debug.key('KeyV', true)"); gt(0.05); ev("__debug.key('KeyV', false)"); gt(0.7)
    R['machete kills'] = ev("game.kills") - k0
    for w in [1, 3, 6, 9, 10, 14]: R[f'night wave {w}'] = ev(f"(() => {{ game.horde.wave = {w}; return __debug.night({w}); }})()")
    for k, v in R.items(): print(k, json.dumps(v))
    print('ERRORS', len(errs)); [print('  ', e[:300]) for e in errs[:10]]
    b.close()
