# Usage: python3 shots_m6b_gore.py <url> <outdir>   (gore on rigged zombies: sever, crawler, shotgun close kill)
import sys, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
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
    def shot(name): pg.screenshot(path=f'{out}/m6b-{name}.png'); print('shot', name, flush=True)
    ev("__debug.start(); __debug.god(true); __debug.quality('medium'); game.horde.running=false; game.horde.reset(); game.fx.clear()")
    def stage(x, weapon):
        ev(f"game.horde.reset(); game.fx.clear(); __debug.select({weapon}); __debug.teleport(8, 0, -10); __debug.look(0, 0)"); gt(0.7)
        ev(f"(() => {{ const e = game.horde.spawn('runner', new game.player.pos.constructor(8, 0, -10 - ({x} - 6))); e.speed = 0.01; e.attackCd = 99; e.yaw = 0; e.aware = true; e.outside = false; return 1; }})()"); gt(0.2)
    def aim(j, dp=0):
        ev(f"(() => {{ const e = game.horde.enemies[0], P = game.player, t = e.joints[{j}]; const ex = P.pos.x, ey = P.pos.y + P.eyeSmooth, ez = P.pos.z; const dx = t.x-ex, dz = t.z-ez; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(t.y - ey, Math.hypot(dx, dz)) + {dp}; return 1; }})()")
    def fire(hold=0.06):
        ev("__debug.set({ left: true, leftPressed: true })"); gt(hold); ev("__debug.set({ left: false })")
    # severed arm + legs: stumps, artery spurts, limb rig on the ground, crawler solve
    stage(9.5, 0)
    ev("""(() => { const H = game.horde, e = H.enemies[0]; const d = e.pos.clone().sub(game.player.pos).setY(0).normalize();
      H.damage(e, 60, 'limb', e.joints[4].clone(), d, {id:'mr'}, 2); return 1; })()""")
    gt(0.35); aim(1, -0.05); shot('sever-arm')
    print('lost', ev("game.horde.enemies[0].lost"), 'limbs', ev("game.horde.limbs.length"), 'limbRig', ev("!!game.horde.limbs[0].rig"), flush=True)
    ev("""(() => { const H = game.horde, e = H.enemies[0]; const d = e.pos.clone().sub(game.player.pos).setY(0).normalize();
      H.damage(e, 60, 'limb', e.joints[10].clone(), d, {id:'mr'}, 6); H.damage(e, 60, 'limb', e.joints[13].clone(), d, {id:'mr'}, 8); return 1; })()""")
    ev("game.horde.enemies[0].speed = 1.2"); gt(1.0); ev("__debug.look(0, -0.32)"); gt(0.1); shot('crawler-close')
    print('crawl', ev("game.horde.enemies[0].crawl"), ev("JSON.stringify(game.horde.enemies[0].joints[0])"), flush=True)
    # hit zones still map to rig parts: headshot ray from the camera
    print('ray', ev("(() => { const e = game.horde.enemies[0]; const o = game.camera.position.clone(); const d = e.joints[2].clone().sub(o).normalize(); const h = game.horde.raycast(o, d, 50)[0]; return h ? h.part + ':' + h.pi : 'miss'; })()"), flush=True)
    # shotgun point blank -> gibs, spray on the container wall, screen blood
    stage(8.6, 1); aim(1); gt(0.1); fire(); gt(0.12); shot('sg-closekill')
    print('dead', ev("game.horde.enemies[0].dead"), 'ragdoll', ev("game.horde.enemies[0].ragdoll"), 'lost', ev("game.horde.enemies[0].lost"), 'gibs', ev("game.fx.gibs.items.length"), flush=True)
    gt(1.0); ev("__debug.look(0.05, -0.3)"); gt(0.1); shot('sg-aftermath')
    # marksman headshot
    stage(14, 2); ev("__debug.set({ right: true })"); gt(0.45); aim(2); gt(0.05); fire(); gt(0.15); shot('mr-headshot'); ev("__debug.set({ right: false })")
    print('mr', ev("JSON.stringify({dead: game.horde.enemies[0].dead, lost: game.horde.enemies[0].lost})"), flush=True)
    print('ERRORS:', errors[:10])
    b.close()
