# M11 checks: salvage crate (spin, offer, take, jam/move), rare guns (AURORA LANCE, HAILSTRIKE), THE FORGE upgrade.
# usage: shots_m11.py URL OUTDIR
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
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    ev("""(() => { window.__stand = (type, x, z, hp) => { const V = game.player.pos.constructor; const e = game.horde.spawn(type, new V(x, 0, z), true); e.wander.copy(e.pos); e.wanderT = 99; e.speed = 0.01; e.yaw = 0; if (hp) e.hp = hp; return game.horde.enemies.indexOf(e); }; })()""")
    import json
    def F(): ev("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }))")
    prompt = lambda: ev("document.getElementById('buyprompt').textContent")
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    ev("""(() => { window.__stand = (type, x, z, hp) => { const V = game.player.pos.constructor; const e = game.horde.spawn(type, new V(x, 0, z), true); e.wander.copy(e.pos); e.wanderT = 99; e.speed = 0.01; e.yaw = 0; if (hp) e.hp = hp; return game.horde.enemies.indexOf(e); }; })()""")
    ev("(() => { window.__aim = (i) => { const e = game.horde.enemies[i], j = e.joints[1], c = game.camera.position; const dx = j.x - c.x, dy = j.y - c.y, dz = j.z - c.z; __debug.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); }; })()")
    res = {}
    parts = sys.argv[3].split(',') if len(sys.argv) > 3 else ['crate', 'guns', 'forge']
    def dump():
        for k, v in res.items(): print(k, '=>', json.dumps(v), flush=True)
        res.clear()
    if 'crate' in parts:
      ev("__debug.pts(20000); __debug.teleport(-11.0, 0.05, 3.6); __debug.look(Math.PI / 2 + 0.12, -0.2)"); gt(0.5)
      res['crate prompt'] = prompt()
      pts0 = ev("game.pts"); F(); gt(1.9)
      res['paid'] = pts0 - ev("game.pts")
      res['spinning'] = ev("__debug.crate()")
      shot('m11-crate-spinning')
      ev("game.stations.crate.t = 4.0"); t = 0
      while ev("game.stations.crate.state") == 'spin' and t < 10: gt(0.25); t += 0.25
      gt(0.6); res['landed'] = ev("__debug.crate()"); res['offer prompt'] = prompt()
      shot('m11-crate-weapon')
      won = ev("game.stations.crate.result"); F(); gt(0.8)
      res['took'] = won; res['loadout after take'] = ev("game.arsenal.weapons.map(w => w.base.id)")
      # take with full slots replaces the gun in your hands, machete stays
      t = 0
      while ev("game.stations.crate.state") != 'idle' and t < 5: gt(0.2); t += 0.2
      held = ev("game.arsenal.current.base.id"); F(); gt(0.1); ev("game.stations.crate.t = 4.1"); t = 0
      while ev("game.stations.crate.state") != 'offer' and t < 10: gt(0.25); t += 0.25
      won2 = ev("game.stations.crate.result"); F(); gt(0.9)
      res['3 slots full: held'] = held; res['won'] = won2; res['loadout'] = ev("game.arsenal.weapons.map(w => w.base.id)"); res['machete still on 4'] = ev("document.getElementById('slots').textContent")
      # let one offer time out
      t = 0
      while ev("game.stations.crate.state") != 'idle' and t < 5: gt(0.2); t += 0.2
      F(); gt(0.1); ev("game.stations.crate.t = 4.1"); t = 0
      while ev("game.stations.crate.state") != 'offer' and t < 10: gt(0.25); t += 0.25
      ev("game.stations.crate.t = 9.5"); gt(1.2); res['offer timed out ->'] = ev("game.stations.crate.state")
      # roulette pool / odds (20000 rolls with an empty-ish loadout)
      res['roll odds'] = ev("""(() => { const S = game.stations, n = {}; const keep = game.arsenal.weapons; game.arsenal.weapons = [game.arsenal.all.ar, game.arsenal.all.rv]; for (let i = 0; i < 20000; i++) { const id = S.roll(); n[id] = (n[id] || 0) + 1; } game.arsenal.weapons = keep; for (const k in n) n[k] = (100 * n[k] / 20000).toFixed(1) + '%'; return n; })()""")
      # jam: force it on the next spin
      t = 0
      while ev("game.stations.crate.state") != 'idle' and t < 5: gt(0.2); t += 0.2
      pts0 = ev("game.pts"); F(); ev("game.stations.crate.jam = true"); gt(0.1); ev("game.stations.crate.t = 4.1"); t = 0
      while ev("game.stations.crate.state") == 'spin' and t < 10: gt(0.25); t += 0.25
      gt(1.8); res['jam'] = ev("__debug.crate()"); res['refunded'] = ev("game.pts") - pts0 + 0
      res['sign visible at old spot'] = ev("game.stations.crates[0].sign.visible")
      ev("__debug.look(Math.PI / 2 + 0.12, -0.05)"); gt(0.3); shot('m11-crate-moved')
      ev("game.stations.crate.t = 5.9"); t = 0
      while ev("game.stations.crate.state") != 'idle' and t < 12: gt(0.25); t += 0.25
      res['after move'] = ev("__debug.crate()")
      ev("game.stations.reset()")
      dump()
    if 'guns' in parts:
      ev("game.arsenal.setLoadout(['ar', 'rv']); __debug.teleport(12, 0.05, 6); __debug.look(0, 0)"); gt(0.3)
      ev("__debug.give('lance')"); gt(0.8)
      ids = [ev(f"__stand('runner', {12 + dx}, {-4 - i * 1.2}, 400)") for i, dx in enumerate([0, 0.9, -0.9])]
      gt(0.3)
      pts0 = ev("game.pts"); k0 = ev("game.kills")
      ev("__aim(%d)" % ids[0])
      ev("game.input.mouse.right = true"); gt(0.4); fire(); ev("__debug.frames(2)")
      gt(0.4); fire(); gt(0.6); ev("game.input.mouse.right = false")
      res['lance'] = { 'name': ev("game.arsenal.def.name"), 'pts': ev("game.pts") - pts0, 'kills': ev("game.kills") - k0, 'hp': ev(f"[{','.join(str(i) for i in ids)}].map(i => Math.round(game.horde.enemies[i].hp))") }
      ev("game.horde.reset()"); ev("__debug.give('hail')"); gt(0.9)
      ids = [ev(f"__stand('runner', {12 + dx}, {-8 + dz}, 260)") for dx, dz in [(0, 0), (1.2, 0.5), (-1.2, 0.5), (0.4, -1.2)]]
      gt(0.3); pts0 = ev("game.pts"); k0 = ev("game.kills")
      ev("__aim(%d)" % ids[0])
      gt(0.2); fire(); gt(0.8)
      res['hailstrike'] = { 'name': ev("game.arsenal.def.name"), 'pts': ev("game.pts") - pts0, 'kills': ev("game.kills") - k0, 'boltVisibleAfter': ev("game.arsenal.all.hail.model.arrow.visible") }
      ev("game.horde.reset()")
      dump()
    if 'forge' in parts:
      ev("game.arsenal.setLoadout(['ar', 'rv']); __debug.pts(20000); game.horde.wave = 3")
      ev("__debug.teleport(-20.6, 0.05, -17.5); __debug.look(-0.12, -0.16)"); gt(1.0)
      res['forge prompt (wave 3)'] = prompt()
      shot('m11-upgrade-machine-idle')
      before = ev("(() => { const d = game.arsenal.all.ar.def; return { name: d.name, dmg: d.damage, mag: d.mag, reserve: d.reserve }; })()")
      ev("game.horde.wave = 6"); gt(0.3); res['forge prompt (wave 6)'] = prompt()
      pts0 = ev("game.pts"); F(); gt(1.6)
      res['forge paid'] = pts0 - ev("game.pts"); res['held while forging'] = ev("game.arsenal.current.base.id"); res['forge'] = ev("__debug.forge()")
      shot('m11-upgrade-machine')
      ev("game.stations.forge.t = Math.max(game.stations.forge.t, 3.3)"); t = 0
      while ev("game.stations.forge.state") != 'ready' and t < 10: gt(0.25); t += 0.25
      res['forge ready prompt'] = prompt()
      F(); gt(1.2)
      after = ev("(() => { const w = game.arsenal.current, d = w.def; return { id: w.base.id, name: d.name, dmg: d.damage, mag: d.mag, reserve: d.reserve, magNow: w.mag, up: !!w.up }; })()")
      res['before'] = before; res['after'] = after; res['hud name'] = ev("document.getElementById('wname').textContent + ' | ' + document.getElementById('wtype').textContent")
      ev("__debug.teleport(12, 0.05, 6); __debug.look(0.25, -0.02)"); gt(0.6)
      shot('m11-upgraded-gun')
      res['forge prompt again (held upgraded)'] = (ev("__debug.teleport(-20.6, 0.05, -17.5); __debug.look(-0.12, -0.16)"), gt(0.4), prompt())[2]
      res['minimap icons'] = ev("game.stations.icons()")
      dump()
    print('ERRORS:', errs)
    b.close()
