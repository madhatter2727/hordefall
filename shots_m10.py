# M10 checks: power-up drops (ground, HUD, DEADFALL, REAPER, RESUPPLY), hit markers, damage numbers, grenade/machete feedback, last-kill slow-mo.
# usage: shots_m10.py URL OUTDIR
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
    ev("__debug.power('bounty', -2.2, 11.5); __debug.power('reaper', 0, 10.5); __debug.power('deadfall', 2.2, 11.5)"); gt(1.2)
    shot('m10-powerup-on-ground')
    print('on map', ev("game.powerups.active().map(s => s.type)"))
    # 2. walk over BOUNTY and REAPER -> HUD timers
    ev("__debug.teleport(-2.2, 0.05, 11.5)"); gt(0.15); ev("__debug.teleport(0, 0.05, 10.5); __debug.look(-0.6, -0.05)"); gt(0.15)
    ev("__debug.teleport(0, 0.05, 10.5)"); gt(0.4)
    freeze(500, 'pwann'); shot('m10-powerup-active-hud'); thaw()
    print('power', ev("JSON.stringify(game.power)"), 'instaKill', ev("game.horde.instaKill"), 'hud', ev("[...document.querySelectorAll('#powers .pw.on b')].map(e => e.textContent)"), 'announce', ev("document.getElementById('pwann-t').textContent"))
    # bounty doubles points; reaper kills a tanky brute with one body shot
    pts0 = ev("game.pts"); ev("game.addScore(100)"); print('bounty +100 ->', ev("game.pts") - pts0)
    ev("__debug.teleport(12, 0.05, 6)"); bi = ev("__stand('brute', 12, -1, 5000)"); gt(0.4); ev(f"__aimAt({bi}, 'body')"); gt(0.05); fire(); gt(0.3)
    print('reaper brute dead', ev(f"game.horde.enemies[{bi}].dead"))
    # 3. DEADFALL with a crowd + the Colossus
    ev("game.horde.reset(); game.power.reaper = 0.01"); gt(0.2)
    ev("""(() => { for (let i = 0; i < 12; i++) { const a = -0.9 + i * 0.15, r = 7 + (i % 3) * 2.5; __stand(i % 5 === 0 ? 'brute' : 'runner', Math.sin(a) * r, 14 - Math.cos(a) * r); } })()""")
    ev("__debug.teleport(0, 0.05, 14)"); ev("__debug.boss(18)"); gt(0.8)
    boss0 = ev("JSON.stringify(__debug.bossInfo())"); alive0 = ev("game.horde.aliveCount()"); k0 = ev("game.kills"); pts0 = ev("game.pts")
    ev("game.powerups.reset(); __debug.look(0, -0.02); __debug.power('deadfall', 0, 14)"); pg.wait_for_function('game.powerups.active().length === 0', timeout=20000); gt(0.1)
    freeze(330, 'pwflash'); freeze(330, 'pwann'); shot('m10-blast'); thaw(); gt(0.5); shot('m10-blast-after')
    print('deadfall: alive', alive0, '->', ev("game.horde.aliveCount()"), 'kills', ev("game.kills") - k0, 'pts', ev("game.pts") - pts0, 'boss', boss0, '->', ev("JSON.stringify(__debug.bossInfo())"))
    # 4. headshot hit marker + damage numbers
    ev("game.horde.reset(); game.power.bounty = 0.01; __debug.teleport(12, 0.05, 6)"); gt(0.4)
    ids = [ev(f"__stand('runner', {x}, {z}, 5000)") for x, z in [(10.4, -1.5), (12, -1), (13.6, -1.5)]]; gt(0.6)
    ev(f"__aimAt({ids[0]}, 'body')"); gt(0.4)
    for i, part in [(ids[0], 'body'), (ids[2], 'body'), (ids[0], 'head')]:
        ev(f"__aimAt({i}, '{part}')"); fire(); gt(0.02)
    ev("game.input.mouse.right = true"); gt(0.45)
    for attempt in range(8):
        ev(f"__aimAt({ids[1]}, 'head')"); gt(0.12); ev(f"__aimAt({ids[1]}, 'head')"); ev("document.getElementById('hitmarker').className = ''"); fire(); ev("__debug.frames(1)")
        if 'head' in ev("document.getElementById('hitmarker').className"): break
        for i in (ids[0], ids[2]): ev(f"__aimAt({i}, 'body')"); fire()
    freeze(40, 'hitmarker'); shot('m10-hitmarker-headshot'); thaw()
    print('attempts', attempt + 1)
    ev("game.input.mouse.right = false")
    print('marker', ev("document.getElementById('hitmarker').className"), 'numbers', ev("[...document.querySelectorAll('.dn.on')].map(e => e.textContent + (e.classList.contains('head') ? 'H' : ''))"))
    # grenade blast + machete both give markers / numbers
    ev("game.horde.reset()"); gt(0.2); gi = ev("__stand('runner', 12, 1, 5000)"); gt(0.4)
    ev("document.getElementById('hitmarker').className = ''; (() => { const e = game.horde.enemies[%d]; game.explode(e.pos.clone().setY(0.3), 0.8, { radius: 7, dmg: 320, noSelf: true }); })()" % gi); ev("__debug.frames(2)")
    print('grenade marker', ev("document.getElementById('hitmarker').className"), 'numbers', ev("document.querySelectorAll('.dn.on').length"))
    ev("game.horde.reset()"); gt(0.2); mi = ev("__stand('runner', 12, 4.3, 5000)"); gt(0.3); ev(f"__aimAt({mi}, 'body')")
    ev("document.getElementById('hitmarker').className = ''"); tap('KeyV'); gt(0.35)
    print('machete marker', ev("document.getElementById('hitmarker').className"), 'hp', ev(f"Math.round(game.horde.enemies[{mi}].hp)"))
    # 5. last husk of a wave -> slow motion + zoom
    ev("game.horde.reset(); const H = game.horde; H.wave = 3; H.toSpawn = 0; H.bossDelay = 0"); gt(0.2)
    li = ev("__stand('runner', 12.4, -1)"); gt(0.5); ev(f"__aimAt({li}, 'head')"); gt(0.05)
    ev("game.arsenal.select(1)"); gt(0.6); ev(f"__aimAt({li}, 'head')"); gt(0.05)
    ev("game.input.mouse.leftPressed = true"); pg.wait_for_function('game.slowT > 0', timeout=20000); gt(0.06)
    print('slowmo', ev("JSON.stringify({ slowT: +game.slowT.toFixed(2), k: +game.slowK.toFixed(2), fov: +game.camera.fov.toFixed(1), pitch: game.audio.pitch, dead: game.horde.enemies[%d].dead })" % li))
    shot('m10-slowmo')
    pg.wait_for_timeout(2500); print('after slowmo', ev("JSON.stringify({ slowT: +game.slowT.toFixed(2), k: game.slowK, fov: +game.camera.fov.toFixed(1) })"))
    # 6. RESUPPLY + natural drop roll
    ev("game.horde.reset(); game.arsenal.current.mag = 1; game.arsenal.current.reserve = 0; game.throwables.frags = 0; __debug.teleport(0, 0.05, 14); __debug.power('resupply', 0, 14)"); gt(0.3)
    print('resupply mag', ev("game.arsenal.current.mag"), 'reserve', ev("game.arsenal.current.reserve"), 'frags', ev("game.throwables.frags"))
    print('drop sim', ev("""(() => { const P = game.powerups, V = game.player.pos.constructor, out = {}; for (const w of [1, 3, 8]) { let n = 0;
      for (let run = 0; run < 200; run++) { P.reset(); P.newWave(w); P.gap = 0; for (let k = 0; k < 20; k++) { P.gap = 0; if (P.maybeDrop(new V(0, 0, 0), w)) n++; } } out['w' + w] = (n / 200).toFixed(2) + ' drops per 20 kills'; }
      P.reset(); return JSON.stringify(out); })()"""))
    ev("game.pts = 9999; game.openShop()"); gt(0.3); print('shop ok', ev("document.querySelectorAll('#buys .buy').length"))
    print('ERRORS:', errs[:6])
    b.close()
