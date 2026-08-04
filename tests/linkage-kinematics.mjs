/**
 * Checks the LINKS-10M solver against the dataset itself.
 *
 * The thing worth testing here is not that the code runs but that it agrees
 * with the data: every row ships the path its output joint is supposed to walk,
 * so solving a full turn and comparing against that path is a real check on the
 * rod lengths, the stored solution order, and the branch choice all at once.
 *
 *   node tests/linkage-kinematics.mjs            # 12 random rows, live
 *   ROWS=40 node tests/linkage-kinematics.mjs    # more of them
 *   OFFLINE=1 node tests/linkage-kinematics.mjs  # bundled rows and edge cases only
 *
 * esbuild comes along with Vite, and is only used to load the TypeScript.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(mkdtempSync(join(tmpdir(), 'links-')), 'kinematics.mjs');
execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [
    join(root, 'src/entries/ten-million-linkages/kinematics.ts'),
    '--bundle',
    '--format=esm',
    `--outfile=${out}`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
const { preprocess, solve, survey, flipBranch, tracePath } = await import(pathToFileURL(out).href);

const samplesOut = join(dirname(out), 'samples.mjs');
execFileSync(
  join(root, 'node_modules/.bin/esbuild'),
  [
    join(root, 'src/entries/ten-million-linkages/samples.ts'),
    '--bundle',
    '--format=esm',
    `--outfile=${samplesOut}`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
const { BUILT_IN } = await import(pathToFileURL(samplesOut).href);

const TAU = Math.PI * 2;
let failures = 0;
let checks = 0;

function check(name, ok, detail = '') {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Four tokens a joint: kind, separator, and two references offset by six. */
function encode(plan) {
  const seq = [];
  for (const [kind, a, b] of plan) {
    seq.push(kind, 3, a === null ? 4 : a + 6, b === null ? 4 : b + 6);
  }
  seq.push(26);
  return seq;
}

const row = (over) => ({
  index: 0,
  total: 1,
  source: 'dataset',
  positions: [],
  edges: [],
  fixed: [],
  sequence: [],
  curve: [],
  ...over,
});

/* ------------------------------------------------------- rows from the API */

const OFFLINE = process.env.OFFLINE === '1';
const WANT_ROWS = Number(process.env.ROWS ?? 12);
const API =
  'https://datasets-server.huggingface.co/rows?dataset=ahn1376%2FLINKS-10M&config=default&split=train';

async function fetchRow(offset) {
  const res = await fetch(`${API}&offset=${offset}&length=1`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const payload = await res.json();
  const r = payload.rows[0].row;
  return row({
    index: offset,
    total: payload.num_rows_total,
    positions: r['initial positions'],
    edges: r.edges,
    fixed: r['fixed joints'],
    sequence: r.sequence,
    curve: r['target curve'],
  });
}

/** Solves a full turn and measures the gap to the curve the row shipped. */
function agreesWithStoredCurve(mech, curve) {
  const pose = new Float64Array(mech.n * 2);
  const samples = curve.length / 2;
  let worst = 0;
  for (let i = 0; i < samples; i++) {
    if (!solve(mech, (i / samples) * TAU, pose)) return { worst: Infinity, stalledAt: i };
    worst = Math.max(
      worst,
      Math.hypot(pose[mech.output * 2] - curve[i * 2], pose[mech.output * 2 + 1] - curve[i * 2 + 1]),
    );
  }
  return { worst, stalledAt: -1 };
}

if (!OFFLINE) {
  let total = 10_000_000;
  const seen = new Set();
  let sizes = { min: Infinity, max: 0 };
  let worstOverall = 0;
  let fetched = 0;

  for (let i = 0; i < WANT_ROWS; i++) {
    const offset = Math.floor(Math.random() * total);
    let mech;
    let data;
    try {
      data = await fetchRow(offset);
      total = data.total || total;
      mech = preprocess(data);
      fetched += 1;
    } catch (err) {
      check(`row ${offset} loads and preprocesses`, false, String(err.message ?? err));
      continue;
    }

    seen.add(mech.n);
    sizes = { min: Math.min(sizes.min, mech.n), max: Math.max(sizes.max, mech.n) };

    // The rod count is what the stored plan implies: two rods for every joint
    // that has to be solved, plus the crank.
    const expectedRods = mech.steps.length * 2 + 1;
    check(
      `row ${mech.index}: ${mech.n} joints, ${mech.rods.length / 2} rods, plan accounts for them`,
      mech.rods.length / 2 === expectedRods,
      `expected ${expectedRods}`,
    );

    const { worst, stalledAt } = agreesWithStoredCurve(mech, mech.curve);
    worstOverall = Math.max(worstOverall, worst === Infinity ? 0 : worst);
    check(
      `row ${mech.index}: output joint follows the stored curve for a full turn`,
      worst < 1e-3,
      stalledAt >= 0 ? `stalled at sample ${stalledAt}` : `worst gap ${worst.toExponential(1)}`,
    );
    check(`row ${mech.index}: turns all the way round`, mech.stallAngle === null);
  }

  if (fetched > 0) {
    console.log(
      `\n${fetched} rows, ${sizes.min}–${sizes.max} joints, worst gap to a stored curve ${worstOverall.toExponential(1)}\n`,
    );
  } else {
    console.log('\nno rows loaded — network trouble? try OFFLINE=1\n');
  }
}

/* ------------------------------------------------------------ bundled rows */

for (const sample of BUILT_IN) {
  const mech = preprocess(row({ ...sample, source: 'built-in' }));
  check(`bundled row ${sample.index}: preprocesses and turns`, mech.stallAngle === null);

  // Every rod must hold its length at every angle. This is the invariant the
  // whole viewer rests on, and it does not depend on the stored curve.
  const pose = new Float64Array(mech.n * 2);
  let worstRod = 0;
  for (let i = 0; i < 180; i++) {
    solve(mech, (i / 180) * TAU, pose);
    for (let r = 0; r < mech.rods.length; r += 2) {
      const a = mech.rods[r];
      const b = mech.rods[r + 1];
      const rest = Math.hypot(
        mech.start[a * 2] - mech.start[b * 2],
        mech.start[a * 2 + 1] - mech.start[b * 2 + 1],
      );
      const now = Math.hypot(pose[a * 2] - pose[b * 2], pose[a * 2 + 1] - pose[b * 2 + 1]);
      worstRod = Math.max(worstRod, Math.abs(now - rest));
    }
  }
  check(
    `bundled row ${sample.index}: every rod holds its length`,
    worstRod < 1e-9,
    `worst stretch ${worstRod.toExponential(1)}`,
  );
}

/* --------------------------------------------------------- assembly branch */

{
  // A plain four-bar: two ground pivots, a crank, and a coupler.
  const fourBar = row({
    positions: [
      [0, 0],
      [1, 0],
      [4, 0],
      [3.2, 2],
    ],
    edges: [
      [0, 1],
      [1, 3],
      [2, 3],
    ],
    fixed: [0, 2],
    sequence: encode([
      [0, null, null],
      [1, 0, null],
      [0, null, null],
      [2, 1, 2],
    ]),
  });

  const mech = preprocess(fourBar);
  check('four-bar: crank turns all the way round', mech.stallAngle === null);

  const path = tracePath(mech, mech.output, 64);
  const before = path ? Array.from(path) : [];
  flipBranch(mech, 0);
  const after = tracePath(mech, mech.output, 64);
  const moved = after && before.some((v, i) => Math.abs(v - after[i]) > 1e-6);
  check('four-bar: flipping the branch gives a different assembly', Boolean(moved));

  // Mirrored, but still a mechanism: the rods are the lengths they always were.
  const pose = new Float64Array(mech.n * 2);
  solve(mech, 1.1, pose);
  const coupler = Math.hypot(pose[6] - pose[2], pose[7] - pose[3]);
  const rocker = Math.hypot(pose[6] - pose[4], pose[7] - pose[5]);
  check(
    'four-bar: the mirrored assembly keeps both rod lengths',
    Math.abs(coupler - Math.hypot(3.2 - 1, 2)) < 1e-9 && Math.abs(rocker - Math.hypot(0.8, 2)) < 1e-9,
  );

  flipBranch(mech, 0);
  const restored = tracePath(mech, mech.output, 64);
  check(
    'four-bar: flipping back restores the original path',
    Boolean(restored && before.every((v, i) => Math.abs(v - restored[i]) < 1e-12)),
  );
}

/* ------------------------------------------------- tangency and dead points */

{
  // Rods of 1 and 2 between a crank pin and a pivot 3 away: the circles touch
  // at exactly one point at θ = 0 and pull apart immediately after.
  const tangent = preprocess(
    row({
      positions: [
        [0, 0],
        [1, 0],
        [4, 0],
        [2, 0],
      ],
      edges: [
        [0, 1],
        [1, 3],
        [2, 3],
      ],
      fixed: [0, 2],
      sequence: encode([
        [0, null, null],
        [1, 0, null],
        [0, null, null],
        [2, 1, 2],
      ]),
    }),
  );

  const pose = new Float64Array(8);
  check('tangent circles still solve at the touching angle', solve(tangent, 0, pose));
  check(
    'the tangent solution is the point the circles share',
    Math.abs(pose[6] - 2) < 1e-6 && Math.abs(pose[7]) < 1e-6,
    `got ${pose[6].toFixed(6)}, ${pose[7].toFixed(6)}`,
  );
  check('circles that miss are reported, not fudged', !solve(tangent, 0.2, pose));
  check('a mechanism that cannot turn is flagged', tangent.stallAngle !== null);

  // survey() is idempotent: asking again finds the same first stall.
  const first = tangent.stallAngle;
  survey(tangent);
  check('the stall angle is stable across surveys', tangent.stallAngle === first);
}

/* --------------------------------------------------------- malformed input */

const rejects = [
  [
    'a sequence of the wrong length',
    row({
      positions: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      edges: [[0, 1]],
      fixed: [0],
      sequence: [0, 3, 4, 4, 26],
    }),
  ],
  [
    'a joint that references a joint solved later',
    row({
      positions: [
        [0, 0],
        [1, 0],
        [4, 0],
        [3, 2],
      ],
      edges: [
        [0, 1],
        [1, 3],
        [2, 3],
      ],
      fixed: [0, 2],
      sequence: encode([
        [0, null, null],
        [1, 0, null],
        [0, null, null],
        [2, 1, 5],
      ]),
    }),
  ],
  [
    'a missing separator token',
    row({
      positions: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      edges: [[0, 1]],
      fixed: [0],
      sequence: [0, 3, 4, 4, 1, 9, 6, 4, 0, 3, 4, 4, 26],
    }),
  ],
  [
    'a position that is not a number',
    row({
      positions: [
        [0, 0],
        [1, 'x'],
        [2, 0],
      ],
      edges: [[0, 1]],
      fixed: [0],
      sequence: encode([
        [0, null, null],
        [1, 0, null],
        [0, null, null],
      ]),
    }),
  ],
  [
    'a crank on top of its own pivot',
    row({
      positions: [
        [0, 0],
        [0, 0],
        [2, 0],
      ],
      edges: [[0, 1]],
      fixed: [0],
      sequence: encode([
        [0, null, null],
        [1, 0, null],
        [0, null, null],
      ]),
    }),
  ],
  [
    'a row with no rods',
    row({
      positions: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
      edges: [],
      fixed: [0],
      sequence: encode([
        [0, null, null],
        [1, 0, null],
        [0, null, null],
      ]),
    }),
  ],
];

for (const [name, bad] of rejects) {
  let threw = false;
  try {
    preprocess(bad);
  } catch {
    threw = true;
  }
  check(`rejected: ${name}`, threw);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
