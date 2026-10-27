# M14 screenshots. usage: shots_m14.py URL OUTDIR [enemies|waves]
import sys, json
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]; sec = sys.argv[3] if len(sys.argv) > 3 else 'enemies,waves'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:600]))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    if 'vercel.app' in url: pg.route('**/api/scores', lambda route: route.abort() if route.request.method == 'POST' else route.continue_())
    pg.goto(url); pg.wait_for_function('window.__ready === true', timeout=240000)
    ev = pg.evaluate
    def gt(s):
        t0 = ev('game.time')
        while ev('game.time') - t0 < s: pg.wait_for_timeout(20)
    def shot(name): pg.screenshot(path=f'{out}/{name}.png'); print('shot', name, flush=True)
    def go(x, y, z, yaw, pitch=0.0): ev(f"__debug.teleport({x}, {y}, {z}); __debug.look({yaw}, {pitch})"); gt(0.3)
    CLEAR = """(R) => { const H = game.horde, N = H.nav, V = game.player.pos.constructor; for (let x = -30; x <= 30; x += 2) for (let z = -18; z <= 34; z += 2) { let ok = true;
        for (const dx of [-3, 0, 3]) for (let d = 0; d <= 13 && ok; d += 1) { const c = N.cellOf(x + dx, z - d); if (c < 0 || N.blocked[c] || Math.abs(N.height[c]) > 0.3) ok = false; }
        if (!ok) continue; for (const dx of [-3, 0, 3]) if (!H.los(new V(x, 1.7, z), new V(x + dx, 1.2, z - 12))) ok = false; if (ok) return [x, z]; } return [0, 0]; }"""
    ev("__debug.start(); __debug.god(true); game.horde.running = false; game.horde.reset()")
    cx, cz = ev(CLEAR, 10); print('clear spot', cx, cz)
    R = {'clear': [cx, cz]}
    # facing -z (yaw 0 looks toward -z): put things at cz - d
    def stage(w):
        ev("game.horde.reset(); game.horde.running = false"); ev(f"(() => {{ game.horde.wave = {w}; __debug.night({w}); }})()"); go(cx, 0.05, cz, 0.0, 0.02)
    def freeze(): ev("game.state = 'paused'")
    def thaw(): ev("game.state = 'play'")
    if 'enemies' in sec:
        stage(6)
        ev(f"(() => {{ const H = game.horde, V = game.player.pos.constructor; for (const [dx, dz] of [[-0.5, -5.4], [2.4, -8.5]]) {{ const e = H.spawn('jumper', new V({cx} + dx, 0, {cz} + dz)); e.aware = true; e.jcd = 0; e.attackCd = 99; }} }})()")
        pg.wait_for_function('game.horde.enemies.some((e) => e.jp === 1 && e.jt > 0.4)', polling='raf', timeout=60000); freeze(); shot('m14-jumper-windup'); thaw()
        pg.wait_for_function('game.horde.enemies.some((e) => e.jp === 2)', polling='raf', timeout=60000); freeze(); shot('m14-jumper')
        R['jumper'] = ev("game.horde.enemies.map((e) => ({ jp: e.jp, y: +e.pos.y.toFixed(2), kind: e.jkind }))"); thaw()
        stage(8)
        ev(f"(() => {{ const H = game.horde, V = game.player.pos.constructor; const e = H.spawn('brute', new V({cx}, 0, {cz} - 8.5)); e.aware = false; e.yaw = 0; window.__brute = e; const e2 = H.spawn('runner', new V({cx} + 4, 0, {cz} - 10)); e2.aware = false; }})()")
        gt(1.0); shot('m14-brute-stand'); freeze()
        ev("(() => { const H = game.horde, e = window.__brute, V = e.pos.constructor, d = new V(0, 0, 1); for (let i = 0; i < 4; i++) { H.damage(e, 30, 'body', e.joints[1].clone().add(new V(i * 0.05 - 0.1, 0, 0.2)), d, { id: 'ar' }, 0); H.damage(e, 30, 'limb', e.joints[3].clone(), d, { id: 'ar' }, 3); } })()")
        thaw(); gt(0.12); freeze(); shot('m14-brute'); R['brute'] = ev("({ hp: Math.round(game.horde.enemies.find((e) => e.type.brute).hp), max: Math.round(game.horde.enemies.find((e) => e.type.brute).maxHp) })")
        ev("(() => { const H = game.horde, e = window.__brute, V = e.pos.constructor, d = new V(0, 0, 1); for (let i = 0; i < 6; i++) H.damage(e, 30, 'limb', e.joints[10].clone(), d, { id: 'ar' }, 7); })()")
        thaw(); gt(1.2); shot('m14-brute-crippled'); R['crippled'] = ev("window.__brute.crippled")
        stage(7)
        ev(f"(() => {{ const H = game.horde, V = game.player.pos.constructor; const b = H.spawn('bloater', new V({cx}, 0, {cz} - 7)); b.aware = false; b.yaw = 0; window.__bl = b; b.hp = b.maxHp * 0.3; for (const [dx, dz] of [[-2.5, -8], [2.5, -8.5], [-1, -10.5], [1.5, -5.5], [-3.5, -6], [3.5, -6.5]]) {{ const z = H.spawn('runner', new V({cx} + dx, 0, {cz} + dz)); z.aware = false; }} }})()")
        gt(0.6); shot('m14-bloater')
        ev("window.__blast = 0; (() => { const H = game.horde, oh = H.hooks.onBloaterBurst; H.hooks.onBloaterBurst = (p, e) => { window.__blast++; oh(p, e); }; })()")
        ev("(() => { const H = game.horde, b = window.__bl, V = b.pos.constructor; H.damage(b, 9999, 'body', b.joints[1].clone(), new V(0, 0, 1), { id: 'ar' }, 0); if (!b.dead) H.kill(b, b.pos.clone(), new V(0, 0, 1), 30, { id: 'ar' }, false); })()")
        pg.wait_for_function('window.__blast > 0', polling='raf', timeout=30000); gt(0.1); freeze(); shot('m14-bloater-blast'); thaw()
    if 'waves' in sec:
        def begin(w, name_banner=None):
            ev("game.horde.reset()"); ev("game.horde.running = true; game.horde.cleared = false; game.horde.hold = false"); go(cx, 0.05, cz, 0.0, 0.03)
            ev(f"__debug.wave({w}); __debug.night({w})"); ev("game.horde.running = true"); ev(f"(() => {{ for (let i = 0; i < 150; i++) game.nightfall.update(1/30, {w}); }})()")
        begin(3); pg.wait_for_timeout(700); shot('m14-banner'); R['banner'] = ev("document.getElementById('banner-t').textContent + ' | ' + document.getElementById('banner-s').textContent + ' | ' + document.getElementById('banner').className")
        ev("(() => { const H = game.horde; for (const e of H.debugSpawn(14, 9, false, 'crawler', game.player.yaw + Math.PI)) e.attackCd = 99; })()"); gt(1.2); shot('m14-crawler-rush'); R['crawl'] = ev("__debug.info()")
        begin(8); gt(0.5); shot('m14-fog-wave'); R['fog'] = ev("__debug.special()")
        begin(18); gt(0.5); shot('m14-blackout'); R['blackout'] = ev("__debug.special()")
    R['errors'] = errs[:6]; print(json.dumps(R, indent=1)); b.close()
