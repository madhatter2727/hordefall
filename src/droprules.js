// Pure power-up drop rule (no DOM / three.js) so it can be simulated in node.
// st = { drops, kills, gap } for the current wave; returns true when this kill should drop something.
import { POWERUPS as P } from './tuning.js';
export function dropChance(wave) { const C = P.chance; return Math.min(C.max, C.base + C.perWave * Math.max(0, wave - 1)); }
export function shouldDrop(st, wave, total, isLast, rnd = Math.random) {
  st.kills++;
  const X = st.extra || 0;
  if (st.drops >= P.perWave(wave) + X) return false;
  const G = P.guaranteed(wave) + X, owed = G - st.drops;
  if (owed > 0) {
    // the i-th guaranteed drop is due once kills pass forceAt * total * i / G, and always before the last husk
    const due = Math.min(Math.ceil(P.forceAt * total * (st.drops + 1) / G), total - 1);
    if (st.kills >= due || isLast) return true; // on the last husk only if it was unavoidable
  }
  if (isLast) return false;
  if (st.gap > 0) return false;
  return rnd() < dropChance(wave);
}
