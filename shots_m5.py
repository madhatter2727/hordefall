# Usage: python3 shots_m5.py <url> <outdir> [only,list]
import sys, json, math
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
    def gt(sec, cond=None, cap=None):
        t0 = ev('game.time')
        while ev('game.time') - t0 < (cap or sec):
            if cond and ev(cond): return True
            if not cond and ev('game.time') - t0 >= sec: break
            pg.wait_for_timeout(60)
        return False
    def shot(name):
        if only is None or name in only:
            pg.screenshot(path=f'{out}/m5-{name}.png'); print('shot', name, flush=True)
    def want(*names): return only is None or any(n in only for n in names)
    def clear(): ev("game.horde.running=false; game.horde.reset(); game.fx.clear(); game.arsenal.resetAll()")
    ev("__debug.start(); __debug.god(true); __debug.quality('medium')"); clear()
    ev("__debug.teleport(6, 0, 14); __debug.look(Math.PI*0.92, -0.02)"); gt(0.4)
    F = "game.player.yaw + Math.PI"
    if want('spitter-charge', 'spitter-glob', 'spitter-hit'):
        ev(f"__debug.spawn(1, 12, false, 'spitter', {F})"); ev("game.horde.enemies[0].spitCd = 0.6")
        gt(0, "game.horde.enemies[0].charge > 0.55", 8); shot('spitter-charge')
        gt(0, "game.horde.proj.some(p => p.state==='fly' && p.life < 2.65)", 4); shot('spitter-glob')
        gt(0, "(game.acidFx||0) > 0.3", 4); gt(0.12); shot('spitter-hit')
        print('acid', ev("game.acidFx"), flush=True)
        clear(); gt(0.5)
    if want('crawler', 'sever'):
        # legs off with an MR shot to each thigh: the husk keeps coming on its arms
        ev(f"__debug.spawn(1, 4.2, false, 'runner', {F})"); ev("__debug.look(Math.PI*0.92, -0.2)")
        ev("""(() => { const H = game.horde, e = H.enemies[0]; const d = e.pos.clone().sub(game.player.pos).setY(0).normalize();
          H.damage(e, 55, 'limb', e.joints[10].clone(), d, {id:'mr'}, 6); H.damage(e, 32, 'limb', e.joints[4].clone(), d, {id:'mr'}, 3); })()""")
        gt(0.35); shot('sever')
        ev("(() => { const e = game.horde.enemies[0], P = game.player; e.pos.set(P.pos.x - Math.sin(P.yaw)*4.2, e.pos.y, P.pos.z - Math.cos(P.yaw)*4.2); e.yaw = P.yaw + 0.5; e.attackCd = 99; e.speed = 0.01; })()"); gt(1.0); shot('crawler')
        print('crawl', ev("JSON.stringify({crawl: game.horde.enemies[0].crawl, lost: game.horde.enemies[0].lost, hp: game.horde.enemies[0].hp, limbs: game.horde.limbs.length})"), flush=True)
        clear(); gt(0.3)
    if want('sg-dismember'):
        # real shotgun blast at 4 m
        ev("__debug.select(1)"); gt(0.8)
        ev(f"__debug.spawn(1, 4.5, false, 'runner', {F})"); gt(0.05)
        ev("(() => { const e = game.horde.enemies[0], P = game.player; const dx = e.pos.x-P.pos.x, dz = e.pos.z-P.pos.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(e.pos.y + 0.55 - (P.pos.y + P.eyeSmooth), Math.hypot(dx, dz)); })()"); gt(0.3)
        ev("__debug.set({ left: true, leftPressed: true })"); gt(0.06); ev("__debug.set({ left: false })"); gt(0.22); shot('sg-dismember')
        print('sg', ev("JSON.stringify({lost: game.horde.enemies[0].lost, dead: game.horde.enemies[0].dead, limbs: game.horde.limbs.length})"), flush=True)
        clear(); ev("__debug.select(0)"); gt(0.8)
    if want('boss-intro', 'boss-charge', 'boss-slam', 'boss-back'):
        ev("__debug.teleport(0, 0, 8); __debug.look(Math.PI, 0.02)"); gt(0.3)
        ev("__debug.boss(15)"); gt(0.9); ev("game.banner('THE COLOSSUS', 'Armored. Hit the glowing head and back core', 'boss')"); pg.wait_for_timeout(900); shot('boss-intro')
        print('boss', ev("JSON.stringify(__debug.bossInfo())"), flush=True)
        # chip some health so the bar moves
        ev("(() => { const H = game.horde, b = H.boss; for (let i = 0; i < 6; i++) H.damage(b, 92*2.4, 'head', b.joints[2].clone(), new THREE_DIR(), {id:'mr'}, 1); })()".replace('new THREE_DIR()', 'b.joints[2].clone().sub(game.player.pos).normalize()'))
        STAGE = "(() => { const b = game.horde.boss, P = game.player; b.pos.set(0, 0, %s); b.outside = false; b.aware = true; b.yaw = %s; P.pos.set(0, 0, 8); P.vel.set(0,0,0); P.yaw = Math.PI; P.pitch = %s; b.vel.set(0,0,0); b.kb.set(0,0,0); %s })()"
        ev(STAGE % ('24', 'Math.PI', '0.08', "b.bs='chargeWind'; b.bt=0.3; b.chargeCd=99; b.slamCd=99;")); gt(0, "game.horde.boss.bs === 'charge' && game.horde.boss.bt > 0.2", 4); shot('boss-charge')
        ev(STAGE % ('13.5', 'Math.PI', '0.2', "b.bs='slamWind'; b.bt=0; b.chargeCd=99; b.slamCd=99;")); gt(0.75); shot('boss-slamwind')
        gt(0, "game.horde.boss.bs === 'slamRecover'", 3); gt(0.1); shot('boss-slam')
        print('boss', ev("JSON.stringify(__debug.bossInfo())"), flush=True)
        ev(STAGE % ('14', '0', '0.2', "b.bs='stun'; b.bt=0; b.stunDur=30;")); gt(0.8); shot('boss-back')
        clear(); gt(0.3)
    if want('action'):
        ev("__debug.teleport(6, 0, 14); __debug.look(Math.PI*0.92, -0.02); __debug.select(1)"); gt(0.8)
        ev(f"__debug.spawn(3, 9, false, 'runner', {F} - 0.35); __debug.spawn(1, 15, false, 'spitter', {F} + 0.25); __debug.spawn(1, 13, false, 'brute', {F} + 0.05)")
        gt(0, "game.horde.enemies.some(e => !e.dead && e.pos.distanceTo(game.player.pos) < 5.5)", 6)
        ev("(() => { const P = game.player; let best=null, bd=1e9; for (const e of game.horde.enemies) { if (e.dead || e.type.ranged) continue; const d = e.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = e; } } if (best) { const dx = best.pos.x-P.pos.x, dz = best.pos.z-P.pos.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(best.pos.y + 0.6 - (P.pos.y + P.eyeSmooth), Math.hypot(dx, dz)); } })()")
        ev("__debug.set({ left: true, leftPressed: true })"); gt(0.06); ev("__debug.set({ left: false })"); gt(0.14); shot('action')
    print(json.dumps(ev('__debug.info()')))
    print('ERRORS:', errors)
    b.close()
