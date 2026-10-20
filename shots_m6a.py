# Usage: python3 shots_m6a.py <url> <outdir> [only,list]   (gore milestone)
import sys, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else None
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(url); pg.wait_for_timeout(4000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(50)
    def shot(name):
        if only is None or name in only: pg.screenshot(path=f'{out}/m6a-{name}.png'); print('shot', name, flush=True)
    ev("__debug.start(); __debug.god(true); __debug.quality('medium'); game.horde.running=false; game.horde.reset(); game.fx.clear()")
    # stand facing a container wall (+x) with the target between us and it
    def stage(x, weapon):
        ev(f"game.horde.reset(); __debug.select({weapon}); __debug.teleport(8, 0, -10); __debug.look(0, 0)")
        gt(0.7)
        ev(f"(() => {{ const e = game.horde.spawn('runner', new game.player.pos.constructor(8, 0, -10 - ({x} - 6))); e.speed = 0.01; e.attackCd = 99; e.yaw = 0; e.aware = true; return 1; }})()")
        gt(0.15)
    def aim(j):
        ev(f"(() => {{ const e = game.horde.enemies[0], P = game.player, t = e.joints[{j}]; const ex = P.pos.x, ey = P.pos.y + P.eyeSmooth, ez = P.pos.z; const dx = t.x-ex, dz = t.z-ez; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(t.y - ey, Math.hypot(dx, dz)); return 1; }})()")
    def fire(hold=0.06):
        ev("__debug.set({ left: true, leftPressed: true })"); gt(hold); ev("__debug.set({ left: false })")
    # AR: burst into the chest -> spray onto the wall behind
    stage(11, 0); aim(1); fire(0.3); gt(0.08); shot('ar-burst')
    aim(1); fire(0.35); gt(0.1)
    # shotgun point blank -> gibs + screen blood
    stage(8.4, 1); aim(1); gt(0.1); fire(); gt(0.1); shot('sg-gib')
    print('gibs', ev("game.fx.gibs.items.length"), 'screen', ev("game.screenBlood"), flush=True)
    gt(1.2); shot('sg-after')
    # marksman headshot (aimed)
    stage(12, 2); ev("__debug.set({ right: true })"); gt(0.45); aim(2); gt(0.05); fire(); gt(0.12); shot('mr-headshot'); ev("__debug.set({ right: false })")
    print('mr', ev("JSON.stringify({dead: game.horde.enemies[0].dead, lost: game.horde.enemies[0].lost})"), flush=True)
    # dismemberment: legs off, arteries pumping, wound blotches
    stage(10, 0)
    ev("""(() => { const H = game.horde, e = H.enemies[0]; const d = e.pos.clone().sub(game.player.pos).setY(0).normalize();
      H.damage(e, 55, 'limb', e.joints[10].clone(), d, {id:'mr'}, 6); H.damage(e, 32, 'limb', e.joints[4].clone(), d, {id:'mr'}, 3); return 1; })()""")
    ev("__debug.look(0, -0.25)"); gt(0.55); shot('stumps')
    gt(1.5); ev("__debug.look(0.15, -0.12)"); gt(0.3); shot('aftermath')
    print('decals', ev("JSON.stringify({blood: game.fx.blood.mesh.count, splat: game.fx.splat.mesh.count, particles: game.fx.alpha.p.length})"), flush=True)
    print(json.dumps(ev('__debug.info()')))
    print('ERRORS:', errors)
    b.close()
