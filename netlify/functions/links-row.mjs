/**
 * A row of LINKS-10M, with a little shock absorption.
 *
 * The browser could call Hugging Face's dataset viewer directly — it sends
 * permissive CORS headers, and the post falls back to doing exactly that when
 * this function is not deployed. Going through here buys four things:
 *
 *   - a cache, so a popular offset is fetched once rather than once per reader;
 *   - retries, because the viewer API 500s and times out like anything else;
 *   - a rate limit, so one tab cannot turn into a stream of upstream requests;
 *   - a fixed shape, so a rename upstream is one edit here rather than a
 *     broken post.
 *
 * The reply carries only the five fields the viewer draws with, plus the row
 * index and the split's row count.
 *
 * Netlify Functions API v2: a plain Request in, a Response out.
 */

const UPSTREAM = 'https://datasets-server.huggingface.co/rows';
const DATASET = 'ahn1376/LINKS-10M';
const CONFIG = 'default';
const SPLIT = 'train';

/** Rows in the split. Only a starting guess: the reply says what it really is. */
let rowCount = 10_000_000;

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;
/** Per-address budget. Generous next to one reader, mean next to a script. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const RETRIES = 2;

/**
 * Both of these live in module scope, which on a serverless platform means
 * per-instance and short-lived. That is the right size for this: it takes the
 * repeated load off the upstream API without pretending to be a real cache or
 * a real rate limiter.
 */
const cache = new Map();
const seen = new Map();

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      ...extra,
    },
  });

function rateLimited(ip) {
  const now = Date.now();
  const hits = (seen.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  seen.set(ip, hits);
  if (seen.size > 5000) {
    for (const [key, times] of seen) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) seen.delete(key);
    }
  }
  return hits.length > RATE_LIMIT;
}

async function fetchUpstream(offset) {
  const url =
    `${UPSTREAM}?dataset=${encodeURIComponent(DATASET)}&config=${CONFIG}` +
    `&split=${SPLIT}&offset=${offset}&length=1`;

  let lastError = 'unreachable';
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      // A 4xx is about this offset and will not improve by asking again.
      if (!res.ok) {
        if (res.status < 500) return { error: `upstream said ${res.status}`, status: res.status };
        lastError = `upstream said ${res.status}`;
        continue;
      }
      return { payload: await res.json() };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'upstream request failed';
    }
  }
  return { error: lastError, status: 502 };
}

/** Everything the viewer needs and nothing else, under names that will not move. */
function normalise(payload, offset) {
  const row = payload?.rows?.[0]?.row;
  if (!row) throw new Error('no row in the upstream reply');

  const positions = row['initial positions'];
  const edges = row.edges;
  const fixed = row['fixed joints'];
  const sequence = row.sequence;
  const curve = row['target curve'];

  const pairs = (v) =>
    Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite));
  const ints = (v) => Array.isArray(v) && v.every(Number.isInteger);

  if (!pairs(positions) || positions.length < 3) throw new Error('positions are not n×2');
  if (!ints(edges?.flat?.() ?? null)) throw new Error('edges are not integer pairs');
  if (!ints(fixed) || !ints(sequence)) throw new Error('fixed joints or sequence are not integers');

  const total = Number(payload.num_rows_total);
  if (Number.isFinite(total) && total > 0) rowCount = total;

  return {
    index: offset,
    total: rowCount,
    positions,
    edges,
    fixed,
    sequence,
    curve: pairs(curve) ? curve : [],
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-max-age': '86400',
      },
    });
  }
  if (req.method !== 'GET') return json({ error: 'use GET' }, 405);

  const asked = Number(new URL(req.url).searchParams.get('offset'));
  // No offset, or a silly one, means "surprise me" rather than an error.
  const offset =
    Number.isInteger(asked) && asked >= 0 && asked < rowCount
      ? asked
      : Math.floor(Math.random() * rowCount);

  const ip = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for') ?? 'anon';
  if (rateLimited(ip)) {
    return json({ error: 'slow down' }, 429, { 'retry-after': '30' });
  }

  const hit = cache.get(offset);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return json(hit.body, 200, { 'cache-control': 'public, max-age=600', 'x-cache': 'hit' });
  }

  const { payload, error, status } = await fetchUpstream(offset);
  if (error) return json({ error }, status ?? 502);

  let body;
  try {
    body = normalise(payload, offset);
  } catch (err) {
    // The upstream schema moved, or this row is not what the schema promised.
    return json({ error: err instanceof Error ? err.message : 'unreadable row' }, 502);
  }

  cache.set(offset, { at: Date.now(), body });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);

  return json(body, 200, { 'cache-control': 'public, max-age=600', 'x-cache': 'miss' });
};

export const config = { path: '/api/links-row' };
