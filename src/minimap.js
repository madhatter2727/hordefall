// Circular radar in the top-left: rotates with the player, 2D canvas only.
// Static layout (buildings, containers, props) is pre-rendered once; blips are drawn each frame at ~30 Hz.
import { ARENA } from './world/arena.js';

const PX = 5;            // pixels per metre in the pre-rendered layout
const SPAN = 96;         // metres covered by the layout image (arena + streets outside the gates)
const RANGE = 26;        // metres from centre to rim

export class Minimap {
  constructor(el, colliders, wallbuys, stations) {
    this.stations = stations;
    this.el = el; this.ctx = el.getContext('2d');
    const dpr = Math.min(2, devicePixelRatio || 1); this.dpr = dpr;
    this.size = 176; el.width = el.height = this.size * dpr; el.style.width = el.style.height = this.size + 'px';
    this.layout = this.bake(colliders);
    this.wallbuys = wallbuys; this.t = 0; this.acc = 0;
  }
  bake(colliders) {
    const c = document.createElement('canvas'); c.width = c.height = SPAN * PX;
    const g = c.getContext('2d'), o = (SPAN / 2) * PX;
    const X = (x) => o + x * PX, Z = (z) => o + z * PX;
    // plaza floor
    const H = ARENA.half;
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(X(-H), Z(-H), 2 * H * PX, 2 * H * PX);
    // footprints, coloured by what they are
    const sorted = colliders.filter((k) => !k.ground && k.maxY > 0.4).sort((a, b) => a.maxY - b.maxY);
    for (const k of sorted) {
      const w = (k.maxX - k.minX) * PX, d = (k.maxZ - k.minZ) * PX;
      if (w > 300 || d > 300) continue;
      let fill, line;
      if (k.minY > 2.2) { fill = 'rgba(160,170,180,0.10)'; line = 'rgba(190,200,210,0.25)'; } // overpass deck overhead
      else if (k.maxY > 6) { fill = 'rgba(205,195,180,0.30)'; line = 'rgba(240,230,210,0.55)'; } // buildings, piers
      else if (k.walk) { fill = 'rgba(255,190,110,0.22)'; line = 'rgba(255,200,130,0.5)'; } // platform + stairs
      else if (k.mat === 'metal' && k.maxY > 2) { fill = 'rgba(120,170,200,0.32)'; line = 'rgba(150,200,230,0.6)'; } // containers
      else { fill = 'rgba(200,200,200,0.18)'; line = 'rgba(220,220,220,0.35)'; } // barriers, crates, cars
      g.fillStyle = fill; g.fillRect(X(k.minX), Z(k.minZ), w, d);
      g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(X(k.minX) + 0.5, Z(k.minZ) + 0.5, w - 1, d - 1);
    }
    // gate gaps
    g.strokeStyle = 'rgba(255,122,42,0.8)'; g.lineWidth = 3;
    for (const [x, z, horiz] of [[0, -H, 1], [0, H, 1], [-H, 0, 0], [H, 0, 0]]) {
      g.beginPath(); if (horiz) { g.moveTo(X(x - 2.5), Z(z)); g.lineTo(X(x + 2.5), Z(z)); } else { g.moveTo(X(x), Z(z - 2.5)); g.lineTo(X(x), Z(z + 2.5)); } g.stroke();
    }
    return c;
  }
  draw(dt, player, horde, barrels, throwables) {
    this.t += dt; this.acc += dt;
    if (this.acc < 1 / 30) return; this.acc = 0;
    const g = this.ctx, S = this.size, R = S / 2 - 6, dpr = this.dpr, k = R / RANGE;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;
    // disc
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    const bg = g.createRadialGradient(cx, cy, 4, cx, cy, R); bg.addColorStop(0, 'rgba(30,22,18,0.78)'); bg.addColorStop(1, 'rgba(10,8,8,0.86)');
    g.fillStyle = bg; g.fillRect(0, 0, S, S);
    // world -> radar: rotate so the player's facing points up
    const yaw = player.yaw, cs = Math.cos(yaw), sn = Math.sin(yaw), px = player.pos.x, pz = player.pos.z;
    const toR = (x, z) => { const dx = (x - px) * k, dz = (z - pz) * k; return [cx + dx * cs - dz * sn, cy + dx * sn + dz * cs]; };
    g.save(); g.translate(cx, cy); g.rotate(yaw); g.scale(k / PX, k / PX); g.translate(-(px + SPAN / 2) * PX, -(pz + SPAN / 2) * PX);
    g.drawImage(this.layout, 0, 0); g.restore();
    // range rings + sweep
    g.strokeStyle = 'rgba(255,170,90,0.12)'; g.lineWidth = 1;
    for (const r of [R / 3, (2 * R) / 3]) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
    const sw = (this.t * 1.4) % (Math.PI * 2);
    const grad = g.createConicGradient ? g.createConicGradient(sw - 0.9, cx, cy) : null;
    if (grad) { grad.addColorStop(0, 'rgba(255,140,60,0)'); grad.addColorStop(0.14, 'rgba(255,140,60,0.16)'); grad.addColorStop(0.145, 'rgba(255,140,60,0)'); g.fillStyle = grad; g.fillRect(0, 0, S, S); }
    // wall-buys
    for (const b of this.wallbuys.list) {
      const [x, y] = toR(b.pos.x, b.pos.z);
      g.fillStyle = '#ffcf6a'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1;
      g.beginPath(); g.rect(x - 3, y - 3, 6, 6); g.fill(); g.stroke();
    }
    // salvage crate ("?" box, cyan) + forge (anvil, magenta); pinned to the rim when out of range
    if (this.stations) for (const ic of this.stations.icons()) {
      let [x, y] = toR(ic.x, ic.z); const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d > R - 7) { x = cx + (dx / d) * (R - 7); y = cy + (dy / d) * (R - 7); }
      g.save(); g.translate(x, y);
      if (ic.kind === 'drink') {
        g.fillStyle = ic.color; g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1; g.shadowColor = ic.color; g.shadowBlur = 6;
        g.beginPath(); g.rect(-2.5, -1, 5, 7); g.rect(-1.2, -4.5, 2.4, 3.5); g.fill(); g.stroke(); g.shadowBlur = 0;
      } else if (ic.kind === 'crate') {
        const a = ic.moving ? 0.45 + 0.55 * Math.abs(Math.sin(this.t * 6)) : 1;
        g.globalAlpha = a; g.fillStyle = '#0d2a33'; g.strokeStyle = '#6fe3ff'; g.lineWidth = 1.5;
        g.beginPath(); g.rect(-5.5, -5.5, 11, 11); g.fill(); g.stroke();
        g.fillStyle = '#6fe3ff'; g.font = '700 11px Teko, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 0, 1);
      } else {
        g.globalAlpha = ic.on ? 1 : 0.6; g.fillStyle = '#ff6af0'; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(-6, -3); g.lineTo(6, -3); g.lineTo(3, 0); g.lineTo(3, 2); g.lineTo(5, 5); g.lineTo(-5, 5); g.lineTo(-3, 2); g.lineTo(-3, 0); g.closePath(); g.fill(); g.stroke();
      }
      g.restore();
    }
    // barrels
    for (const b of barrels.list) {
      if (!b.alive) continue;
      const [x, y] = toR(b.pos.x, b.pos.z);
      g.fillStyle = '#ff7a2a'; g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,210,150,.7)'; g.stroke();
    }
    // throwables: frags blink, Screamers pulse a lure ring
    for (const o of throwables.list) {
      const [x, y] = toR(o.pos.x, o.pos.z);
      if (o.kind === 'frag') { if (Math.sin(this.t * 22) > -0.2) { g.fillStyle = '#ffe66a'; g.beginPath(); g.arc(x, y, 2.8, 0, Math.PI * 2); g.fill(); } }
      else {
        g.fillStyle = '#ff3a1a'; g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
        if (o.active) { const ph = (this.t * 1.5) % 1; g.strokeStyle = `rgba(255,70,40,${0.7 * (1 - ph)})`; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 4 + ph * 26 * k, 0, Math.PI * 2); g.stroke(); }
      }
    }
    // zombies (out-of-range ones become rim ticks)
    const edge = [];
    for (const e of horde.enemies) {
      if (e.dead) continue;
      const [x, y] = toR(e.pos.x, e.pos.z), dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d > R - 3) { edge.push([dx / d, dy / d, e]); continue; }
      const above = e.pos.y - player.pos.y;
      if (e.type.boss) { this.skull(g, x, y); continue; }
      const col = e.type.ranged ? '#7dff5a' : e.type.brute ? '#ff4a3a' : '#ff2a2a';
      const r = e.type.brute ? 3.6 : 2.6;
      g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 5;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      if (Math.abs(above) > 1.2) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 3, y + (above > 0 ? -5 : 5)); g.lineTo(x, y + (above > 0 ? -8 : 8)); g.lineTo(x + 3, y + (above > 0 ? -5 : 5)); g.stroke(); }
    }
    g.restore();
    // rim: ring, ticks for threats beyond range, north marker
    g.strokeStyle = 'rgba(255,170,90,0.55)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    for (const [ux, uy, e] of edge) {
      const a = Math.atan2(uy, ux), w = e.type.boss ? 0.16 : 0.07;
      g.strokeStyle = e.type.boss ? '#ffd23f' : e.type.ranged ? 'rgba(125,255,90,.8)' : 'rgba(255,60,50,.8)'; g.lineWidth = e.type.boss ? 4 : 3;
      g.beginPath(); g.arc(cx, cy, R + 1, a - w, a + w); g.stroke();
    }
    const [nx, ny] = (() => { const dx = 0, dz = -1; return [cx + (dx * cs - dz * sn) * (R + 0.5), cy + (dx * sn + dz * cs) * (R + 0.5)]; })();
    g.fillStyle = '#ffcf6a'; g.font = '600 11px Teko, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(10,8,8,.9)'; g.beginPath(); g.arc(nx, ny, 6.5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ffcf6a'; g.fillText('N', nx, ny + 1);
    // player arrow + view cone
    g.fillStyle = 'rgba(255,230,190,0.10)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R * 0.55, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 5, cy + 5); g.lineTo(cx, cy + 2.5); g.lineTo(cx - 5, cy + 5); g.closePath(); g.fill(); g.stroke();
  }
  skull(g, x, y) {
    const p = 1 + Math.sin(this.t * 6) * 0.12;
    g.save(); g.translate(x, y); g.scale(p, p);
    g.fillStyle = 'rgba(255,60,20,.35)'; g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffe9d0'; g.beginPath(); g.arc(0, -1.5, 6, 0, Math.PI * 2); g.fill(); g.fillRect(-3.5, 2, 7, 4);
    g.fillStyle = '#2a0a06'; g.beginPath(); g.arc(-2.3, -1.5, 1.6, 0, Math.PI * 2); g.arc(2.3, -1.5, 1.6, 0, Math.PI * 2); g.fill();
    g.fillRect(-2.2, 3.6, 1, 2.4); g.fillRect(-0.5, 3.6, 1, 2.4); g.fillRect(1.2, 3.6, 1, 2.4);
    g.restore();
  }
}
