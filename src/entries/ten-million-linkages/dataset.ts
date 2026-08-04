/**
 * Where a mechanism comes from.
 *
 * The dataset is ten million rows and twenty-four gigabytes; none of that is
 * downloaded. Hugging Face's dataset viewer will hand over any single row over
 * HTTP, so the post asks for one row at a random offset and reads the total
 * back out of the same response.
 *
 * Two ways in, tried in order:
 *
 * 1. `/api/links-row`, the serverless proxy in `netlify/functions`, which
 *    caches, retries, rate-limits, and hands back only the five fields this
 *    post draws.
 * 2. The API itself, which sends permissive CORS headers, so a browser can
 *    talk to it directly. This is what `vite dev` uses, since no functions are
 *    running there.
 *
 * If both fail, a bundled sample stands in and the readout says so.
 */
import type { DatasetRow, Mechanism } from './kinematics';
import { preprocess, tracePath } from './kinematics';
import { BUILT_IN } from './samples';

const DATASET = 'ahn1376/LINKS-10M';
const CONFIG = 'default';
const SPLIT = 'train';
const PROXY = '/api/links-row';
const UPSTREAM = 'https://datasets-server.huggingface.co/rows';

/** Rows in the train split. Replaced by whatever the API reports. */
const ASSUMED_TOTAL = 10_000_000;
const TIMEOUT_MS = 12_000;

let total = ASSUMED_TOTAL;
/** Set false the first time the proxy is not there, so we stop knocking. */
let proxyLikely = true;
let builtInCursor = Math.floor(Math.random() * BUILT_IN.length);

export interface Deal {
  mechanism: Mechanism;
  /** Set when the row on screen is not the row we set out to fetch. */
  note: string | null;
}

const asRows = (v: unknown): number[][] => (Array.isArray(v) ? (v as number[][]) : []);
const asList = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : []);

/**
 * Accepts both shapes we might be handed: the API's own row envelope, with its
 * spaced-out field names, and the proxy's flattened version. Anything missing
 * is left empty for `preprocess` to reject.
 */
function readRow(payload: Record<string, unknown>, offset: number): DatasetRow {
  const envelope = payload.rows as { row?: Record<string, unknown> }[] | undefined;
  const row = (envelope?.[0]?.row ?? payload) as Record<string, unknown>;
  const reported = Number(payload.num_rows_total ?? payload.total);
  if (Number.isFinite(reported) && reported > 0) total = reported;

  return {
    index: Number.isFinite(Number(payload.index)) ? Number(payload.index) : offset,
    total,
    source: 'dataset',
    positions: asRows(row['initial positions'] ?? row.positions),
    edges: asRows(row.edges),
    fixed: asList(row['fixed joints'] ?? row.fixed),
    sequence: asList(row.sequence),
    curve: asRows(row['target curve'] ?? row.curve),
  };
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: abort.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

const upstreamUrl = (offset: number): string =>
  `${UPSTREAM}?dataset=${encodeURIComponent(DATASET)}&config=${CONFIG}&split=${SPLIT}` +
  `&offset=${offset}&length=1`;

function builtIn(note: string | null): Deal {
  const sample = BUILT_IN[builtInCursor % BUILT_IN.length];
  builtInCursor += 1;
  const mechanism = preprocess({ ...sample, total, source: 'built-in', curve: [] });
  mechanism.curve = tracePath(mechanism, mechanism.output);
  return { mechanism, note };
}

const message = (err: unknown): string =>
  err instanceof Error
    ? err.name === 'AbortError'
      ? 'the request timed out'
      : err.message
    : 'unknown error';

let lastTrouble = 'the dataset API did not answer';

/** One offset, through whichever door is open. */
async function fetchRow(offset: number): Promise<DatasetRow> {
  if (proxyLikely) {
    try {
      return readRow(await getJson(`${PROXY}?offset=${offset}`), offset);
    } catch (err) {
      // A 404 means the proxy is not deployed here, which is the normal state
      // in development. Stop knocking, and take the upstream route instead.
      proxyLikely = false;
      lastTrouble = message(err);
    }
  }
  return readRow(await getJson(upstreamUrl(offset)), offset);
}

/**
 * Pulls one uniformly random row and preprocesses it. Never rejects: a row
 * that will not load, or will not parse, is retried at another offset once and
 * then gives way to a bundled sample and a note. Rows that fail to parse are
 * the reason for the retry — the schema is regular, but ten million of
 * anything has a tail.
 */
export async function deal(): Promise<Deal> {
  let offset = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    offset = Math.floor(Math.random() * total);
    try {
      return { mechanism: preprocess(await fetchRow(offset)), note: null };
    } catch (err) {
      lastTrouble = message(err);
    }
  }
  return builtIn(`row ${offset.toLocaleString('en-US')} did not load — ${lastTrouble}`);
}

/** A mechanism to start on, without waiting for the network. */
export const opener = (): Deal => builtIn(null);
