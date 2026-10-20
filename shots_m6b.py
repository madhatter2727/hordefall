# Usage: python3 shots_m6b.py <url> <outdir> [only,list]   (realism milestone: enemies + boss)
import sys, json, time
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else None
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=120000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(50)
    def shot(name):
        if only is None or name in only: pg.screenshot(path=f'{out}/m6b-{name}.png'); print('shot', name, flush=True)
    ev("__debug.start(); __debug.god(true); __debug.quality('medium'); game.horde.running=false; game.horde.reset(); game.fx.clear()")
    V = "game.player.pos.constructor"
    def spawn(kind, x, z, speed=0.01, attack=False, yaw=0):
        return ev(f"(() => {{ const e = game.horde.spawn('{kind}', new {V}({x}, 0, {z})); e.speed = {speed}; e.attackCd = {0 if attack else 99}; e.yaw = {yaw}; e.aware = true; e.outside = false; return game.horde.enemies.length - 1; }})()")
    def aim(i, j):
        ev(f"(() => {{ const e = game.horde.enemies[{i}], P = game.player, t = e.joints[{j}]; const ex = P.pos.x, ey = P.pos.y + P.eyeSmooth, ez = P.pos.z; const dx = t.x-ex, dz = t.z-ez; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(t.y - ey, Math.hypot(dx, dz)); return 1; }})()")
    def fire(hold=0.06):
        ev("__debug.set({ left: true, leftPressed: true })"); gt(hold); ev("__debug.set({ left: false })")
    # close-up: a zombie shambling in, then swiping
    ev("game.horde.reset(); __debug.select(0); __debug.teleport(0, 0, 14); __debug.look(0, -0.05)"); gt(0.4)
    spawn('runner', 0.3, 10.6, 0.9, yaw=0)
    gt(1.2); aim(0, 1); ev("game.player.pitch += 0.02"); gt(0.05); shot('enemy-close')
    print('anim', ev("game.horde.enemies[0].anim"), flush=True)
    ev("game.horde.enemies[0].attackCd = 0"); gt(0.45); shot('enemy-attack')
    # a pack coming down the street
    ev("game.horde.reset(); __debug.teleport(0, 0, 22); __debug.look(0, 0.02)"); gt(0.3)
    for i, (x, z) in enumerate([(-3, 10), (2, 8.5), (5, 12), (-6, 13), (0.5, 14.5), (-1.5, 6.5), (7, 9)]):
        spawn('brute' if i == 3 else 'runner', x, z, 2.5 + (i % 3) * 1.5, yaw=0)
    spawn('spitter', 9, 15, 0.01, yaw=-0.4)
    gt(1.0); shot('pack')
    print(json.dumps(ev('__debug.info()')), ev('JSON.stringify(game.renderer.info.render)'), flush=True)
    # kills: AR body (death clip), shotgun close (ragdoll + dismember)
    aim(1, 1); fire(0.5); gt(0.5); shot('ar-kill')
    ev("__debug.select(1)"); gt(0.6)
    aim(5, 1); gt(0.05); fire(); gt(0.15); shot('sg-kill')
    gt(1.0); shot('sg-after')
    # dismember a live one (legs off -> crawler, arm off)
    ev("game.horde.reset(); __debug.select(0); __debug.teleport(0, 0, 14); __debug.look(0, -0.2)"); gt(0.3)
    spawn('runner', 0.4, 10.8, 0.01)
    gt(0.3)
    ev("""(() => { const H = game.horde, e = H.enemies[0]; const d = e.pos.clone().sub(game.player.pos).setY(0).normalize();
      H.damage(e, 55, 'limb', e.joints[10].clone(), d, {id:'mr'}, 6); H.damage(e, 35, 'limb', e.joints[4].clone(), d, {id:'mr'}, 3); return 1; })()""")
    gt(0.8); shot('crawler')
    # boss
    ev("game.horde.reset(); __debug.teleport(0, 0, 8); __debug.look(Math.PI, 0.12)"); gt(0.3)
    ev("(() => { const e = game.horde.spawnBoss(new game.player.pos.constructor(0, 0, 16)); e.speed = 0.6; e.chargeCd = 99; e.slamCd = 99; e.attackCd = 99; e.aware = true; e.outside = false; return 1; })()")
    gt(1.6); aim(0, 1); ev("game.player.pitch += 0.12"); gt(0.05); shot('boss')
    ev("game.horde.boss.bs = 'slamWind'; game.horde.boss.bt = 0; game.horde.boss.slamCd = 0"); gt(0.6); shot('boss-slam')
    print(json.dumps(ev('__debug.info()')))
    print('ERRORS:', errors[:10])
    b.close()
