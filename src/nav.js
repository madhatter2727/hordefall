// Navigation grid + Dijkstra flow fields for the horde.
// Built once from the collision layout: every 0.5 m cell gets a floor height (ground, platform, stairs, prop tops)
// or is blocked (tall walls, posts). Edges allow walking (small rise), dropping off ledges (jump-downs) and
// climbing up to ~2.7 m (vault a barrier, leap onto a container) at a cost, so paths prefer stairs and gaps.
const STEP = 0.6, CLIMB = 2.7, TALL = 3.3;
const C_STRAIGHT = 10, C_DIAG = 14, C_CLIMB = 70, C_DROP = 12, C_NEAR = 9;

export class NavGrid {
  // opts: r = agent radius for clearance, climb = tallest ledge it can get up, head = head room it needs.
  // A big agent (the Colossus) gets its own grid: wider clearance, low climb, tall head room, so its flow
  // field never routes it through a gap or onto a ledge its body can't actually use.
  constructor(colliders, half, cell = 0.5, opts = {}) {
    this.half = half; this.cell = cell;
    const N = (this.N = Math.round((half * 2) / cell));
    this.height = new Float32Array(N * N); this.blocked = new Uint8Array(N * N); this.near = new Uint8Array(N * N);
    const r = opts.r ?? 0.3, head = opts.head ?? 1.7, big = !!opts.r && opts.r > 0.3;
    this.climb = opts.climb ?? CLIMB;
    for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++) {
      const x = (gx + 0.5) * cell - half, z = (gz + 0.5) * cell - half, i = gz * N + gx;
      let floor = 0, block = 0, near = 0;
      // pass 1: standing height = highest climbable surface under the cell centre (ground, deck, stair, prop top)
      for (const c of colliders) {
        if (c.ground || c.maxY > TALL) continue;
        if (x >= c.minX - 0.05 && x <= c.maxX + 0.05 && z >= c.minZ - 0.05 && z <= c.maxZ + 0.05) floor = Math.max(floor, c.maxY);
      }
      // pass 2: blocked by anything too tall to climb that occupies head room above that floor (walls, posts,
      // a container stacked on another); overhead decks well above head height don't count
      for (const c of colliders) {
        if (c.ground) continue;
        if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
        if (c.maxY > TALL && c.minY < floor + head) block = 1;
        else if (big && c.maxY > floor + this.climb && c.minY < floor + head) block = 1; // a ledge too tall for it to climb, within its body radius
        else if (c.maxY <= TALL && c.maxY > floor + 0.1 && !c.walk) near = 1; // hugging a prop: allowed but discouraged
      }
      this.height[i] = floor; this.blocked[i] = block; this.near[i] = near;
    }
    // heap + scratch for Dijkstra
    this.heapK = new Int32Array(N * N * 4); this.heapV = new Int32Array(N * N * 4);
    this.fields = new Map();
  }
  cellOf(x, z) {
    const N = this.N, gx = Math.floor((x + this.half) / this.cell), gz = Math.floor((z + this.half) / this.cell);
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -1;
    return gz * N + gx;
  }
  center(c, out) { const N = this.N; out.x = ((c % N) + 0.5) * this.cell - this.half; out.z = (((c / N) | 0) + 0.5) * this.cell - this.half; return out; }
  // Dijkstra *from the target outwards*, over reversed edges, so dist[c] = cost for an agent at c to reach the target
  build(tx, tz, ty, key = 'player') {
    const N = this.N, start = this.cellOf(tx, tz);
    let F = this.fields.get(key);
    if (!F) { F = { dist: new Int32Array(N * N), cell: -2, y: 0, t: 0 }; this.fields.set(key, F); }
    F.cell = start; F.y = ty; F.builds = (F.builds || 0) + 1;
    const dist = F.dist; dist.fill(0x3fffffff);
    if (start < 0) return F;
    const t0 = performance.now();
    const HK = this.heapK, HV = this.heapV; let n = 0;
    const push = (k, v) => { let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (HK[p] <= k) break; HK[i] = HK[p]; HV[i] = HV[p]; i = p; } HK[i] = k; HV[i] = v; };
    const pop = () => { const v = HV[0], k = HK[--n], vv = HV[n]; let i = 0; for (;;) { let l = 2 * i + 1; if (l >= n) break; if (l + 1 < n && HK[l + 1] < HK[l]) l++; if (HK[l] >= k) break; HK[i] = HK[l]; HV[i] = HV[l]; i = l; } HK[i] = k; HV[i] = vv; return v; };
    dist[start] = 0; push(0, start);
    const H = this.height;
    // the target's own cell uses the target's real height (standing on a crate, mid-jump...)
    while (n > 0) {
      const kTop = HK[0], c = pop();
      if (kTop > dist[c]) continue;
      const cx = c % N, cz = (c / N) | 0;
      const hc = c === start ? Math.min(ty, H[c] + 0.4) : H[c];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const nb = nz * N + nx, diag = dx && dz;
        if (this.blocked[nb]) continue;
        if (diag && (this.blocked[cz * N + nx] || this.blocked[nz * N + cx])) continue; // no corner cutting
        // agent moves nb -> c
        const dh = hc - H[nb];
        if (dh > this.climb) continue;
        let w = diag ? C_DIAG : C_STRAIGHT;
        if (dh > STEP) w += C_CLIMB; else if (dh < -STEP) w += C_DROP;
        if (this.near[c]) w += C_NEAR;
        const nd = dist[c] + w;
        if (nd < dist[nb]) { dist[nb] = nd; push(nd, nb); }
      }
    }
    F.ms = performance.now() - t0;
    return F;
  }
  // best neighbouring cell to step into from (x, z) at floor height y. Returns cell index or -1.
  next(F, x, z, y) {
    const N = this.N, c = this.cellOf(x, z);
    if (c < 0) return -1;
    const dist = F.dist, cx = c % N, cz = (c / N) | 0, H = this.height;
    if (c === F.cell) return c;
    let best = dist[c] >= 0x3fffffff ? 0x7fffffff : dist[c], bi = -1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const nb = nz * N + nx;
      if (this.blocked[nb] || dist[nb] >= 0x3fffffff) continue;
      if (dx && dz && (this.blocked[cz * N + nx] || this.blocked[nz * N + cx])) continue;
      const dh = H[nb] - y; if (dh > this.climb) continue;
      const s = dist[nb];
      if (s < best) { best = s; bi = nb; }
    }
    return bi;
  }
  // follow the gradient k cells ahead (for smoother steering); stops at height changes
  ahead(F, c, k) {
    const N = this.N, dist = F.dist, H = this.height;
    let cur = c;
    for (let s = 0; s < k; s++) {
      const cx = cur % N, cz = (cur / N) | 0; let best = dist[cur], bi = -1;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const nb = nz * N + nx;
        if (this.blocked[nb] || dist[nb] >= best) continue;
        if (dx && dz && (this.blocked[cz * N + nx] || this.blocked[nz * N + cx])) continue;
        best = dist[nb]; bi = nb;
      }
      if (bi < 0 || Math.abs(H[bi] - H[cur]) > STEP) break;
      cur = bi;
    }
    return cur;
  }
  // straight walkable line (no blocked cells or big height changes) between two points
  clear(x0, z0, x1, z1, y) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), n = Math.ceil(L / (this.cell * 0.5));
    for (let i = 1; i <= n; i++) {
      const t = i / n, c = this.cellOf(x0 + dx * t, z0 + dz * t);
      if (c < 0 || this.blocked[c] || Math.abs(this.height[c] - y) > STEP) return false;
    }
    return true;
  }
}
