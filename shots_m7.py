# M7 checks: intermission shop, barrels, new guns, game over. usage: shots_m7.py URL OUTDIR [only,names]
import sys, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 else None
want = lambda n: only is None or n in only
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:600]))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=180000)
    ev = pg.evaluate
    def gt(sec):
        t0 = ev('game.time')
        while ev('game.time') - t0 < sec: pg.wait_for_timeout(40)
    def shot(name): pg.screenshot(path=f'{out}/m7-{name}.png'); print('shot', name, flush=True)
    ev("__debug.start(); __debug.god(true)")
    if want('shop'):
        gt(3.5)
        ev("__debug.clearWave()")
        pg.wait_for_function("game.state === 'shop'", timeout=60000)
        ev("__debug.pts(2600)"); ev("game.renderBuys()")
        pg.wait_for_timeout(900); shot('shop')
        pg.keyboard.press('Digit2'); pg.wait_for_timeout(500)
        pg.click('.buy[data-k="armor"]'); pg.wait_for_timeout(600); shot('shop-picked')
        print('perks', ev("JSON.stringify(game.perks)"), 'pts', ev("game.pts"), 'armor', ev("game.player.armor"), 'mods', ev("JSON.stringify(game.arsenal.mods)"))
        pg.click('#ready'); pg.wait_for_timeout(300)
        ev("game.forceLock = true; game.input.locked = true; game.show(null)")
        gt(3.2)
        print('after ready', ev("JSON.stringify({s: game.state, wave: game.horde.wave, left: game.horde.remaining()})"))
        gt(0.6); shot('hud')
    if want('boom'):
        ev("game.horde.running = false; game.horde.reset(); game.barrels.respawn(); __debug.give('mr')"); gt(0.8)
        print('barrels', ev("JSON.stringify(__debug.barrels())"))
        # pack of husks around the drum cluster by the containers
        ev("""(() => { const V = game.player.pos.constructor; const pts = [[-14.9,-11.4],[-11.9,-12.2],[-13.4,-12.6],[-11.4,-9.2],[-15.6,-10.2],[-12.6,-13.8],[-14.6,-13.4],[-10.6,-12.6]];
          for (const [x,z] of pts) { const e = game.horde.spawn('runner', new V(x, 0, z), true); e.aware = true; e.speed = 0.01; e.attackCd = 99; } })()""")
        ev("__debug.teleport(-5.5, 0, -6.5)")
        ev("""(() => { const b = game.barrels.list[0].pos, p = game.player.pos; const dx = b.x - p.x, dz = b.z - p.z, dy = 0.45 - (p.y + 1.65);
          __debug.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); })()""")
        gt(0.8); shot('boom-before')
        ev("__debug.set({left:true, leftPressed:true})"); gt(0.06); ev("__debug.set({left:false, leftPressed:false})")
        ev("__debug.look(game.player.yaw, game.player.pitch + 0.12)")
        gt(0.1); shot('boom-0')
        gt(0.18); shot('boom-1')
        gt(0.45); shot('boom-2')
        gt(1.4); shot('boom-3')
        print('after', ev("JSON.stringify({alive: game.horde.aliveCount(), dead: game.horde.enemies.filter(e=>e.dead).length, lost: game.horde.enemies.map(e=>e.lost).join(','), barrels: __debug.barrels().filter(b=>!b.alive).length, kills: game.kills, hp: game.player.health})"))
        ev("game.barrels.respawn(game.player.pos)"); print('respawned', sum(1 for b in json.loads(ev("JSON.stringify(__debug.barrels())")) if b['alive']))
    if want('guns'):
        ev("game.horde.running = false; game.horde.reset()"); gt(0.5)
        def idx(i): return ev(f"game.arsenal.weapons.findIndex(w => w.def.id === '{i}')")
        for gid in ['rv', 'smg', 'lmg']:
            ev(f"__debug.give('{gid}')"); gt(0.2)
            ev(f"game.arsenal.select({idx(gid)})"); gt(1.0)
            print(gid, 'slots', ev("game.arsenal.weapons.map(w=>w.def.id).join(',')"), 'cur', ev("game.arsenal.current.def.id"))
            shot(f'{gid}-hip')
            ev("__debug.set({right:true})"); gt(0.6); shot(f'{gid}-ads')
            ev("__debug.set({left:true, leftPressed:true})"); gt(0.03); shot(f'{gid}-fire'); gt(0.25 if gid != 'rv' else 0.02); ev("__debug.set({left:false, leftPressed:false})")
            ev("__debug.set({right:false})"); gt(0.6)
            ev("game.arsenal.startReload()")
            for ft in ([0.14, 0.27, 0.45, 0.6] if gid == 'rv' else [0.35, 0.6]):
                ev(f"game.arsenal.freezeT = {ft}"); gt(0.15); shot(f'{gid}-reload-{int(ft*100)}')
            ev("game.arsenal.freezeT = undefined"); gt(3.0 if gid != 'lmg' else 5.2)
            print(gid, 'ammo', ev("JSON.stringify({mag: game.arsenal.current.mag, res: game.arsenal.current.reserve, rel: !!game.arsenal.reload})"))
    print('ERRORS:', errs[:8])
    b.close()
