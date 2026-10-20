// HORDEFALL global top-10. One small public JSON blob, rewritten only when a run makes the board.
import { put, head } from '@vercel/blob';

const KEY = 'leaderboard.json', MAX = 10;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// public URL straight from the store id in the token (no metadata call needed); head() as a fallback
function blobUrl() {
  const id = (process.env.BLOB_READ_WRITE_TOKEN || '').split('_')[3];
  return id ? `https://${id.toLowerCase()}.public.blob.vercel-storage.com/${KEY}` : null;
}
async function load(fresh) {
  try {
    let url = blobUrl();
    if (!url) url = (await head(KEY)).url;
    const r = await fetch(fresh ? url + '?t=' + Date.now() : url, { cache: 'no-store' });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

// loose sanity checks so a curl'd 9,999,999 doesn't sit on top forever
function clean(b) {
  const name = String(b?.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  const n = (v, max) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v >= 0 && v <= max ? v : null; };
  const e = { name, score: n(b?.score, 5e6), wave: n(b?.wave, 500), kills: n(b?.kills, 50000), heads: n(b?.heads, 50000), acc: n(b?.acc, 100), time: n(b?.time, 360000) };
  if (name.length < 1 || Object.values(e).some((v) => v === null)) return null;
  if (e.heads > e.kills || e.score > (e.kills + 50) * 2500 || e.wave > e.kills + 3) return null;
  e.date = new Date().toISOString().slice(0, 10);
  return e;
}

export async function GET() {
  // the CDN keeps this for 20 s so page views don't each cost a blob read
  return new Response(JSON.stringify({ top: await load(false) }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=20, stale-while-revalidate=120' } });
}

export async function POST(request) {
  let body; try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
  const e = clean(body);
  if (!e) return json({ error: 'rejected' }, 400);
  const top = await load(true);
  if (top.length >= MAX && e.score <= top[top.length - 1].score) return json({ top, rank: null });
  top.push(e); top.sort((a, b) => b.score - a.score || a.time - b.time);
  const next = top.slice(0, MAX), rank = next.indexOf(e);
  await put(KEY, JSON.stringify(next), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
  return json({ top: next, rank: rank >= 0 ? rank + 1 : null });
}
