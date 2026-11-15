/**
 * Checks the algebra behind the "Hiding a zero in algebra" post and prints the numbers
 * the post quotes. Needs Node 22.18 or newer, which loads TypeScript directly.
 *
 *   node tests/rewrite-check.mjs
 *
 * For every instance it checks that each step of every walk is one identity
 * used once or one sharing move (verifyStep), that no step changes the value
 * at a random point modulo a prime,
 * and that the planted path and any walk marked "reached" end on 0.
 */
import { LEVELS, evalCircuit, makeInstance, verifyStep } from '../src/entries/bit-rewriting/rewrite.ts';

const SEEDS = Number(process.env.SEEDS ?? 40);
let failures = 0;
const fail = (msg) => {
  failures++;
  if (failures < 12) console.log('FAIL ', msg);
};

const checkWalk = (name, walk, inst, tag) => {
  for (let i = 0; i < walk.steps.length; i++) {
    if (!verifyStep(walk.frames[i], walk.frames[i + 1], walk.steps[i])) {
      fail(`${tag} ${name}: step ${i} (${walk.steps[i].kind} ${walk.steps[i].id ?? walk.steps[i].name}) is not a single valid step`);
      return;
    }
  }
  // Values are compared on a sample of frames: a long walk has thousands.
  const stride = Math.max(1, Math.floor(walk.frames.length / 60));
  for (let i = 0; i < walk.frames.length; i += stride) {
    if (evalCircuit(walk.frames[i], inst.env) !== inst.bit) {
      fail(`${tag} ${name}: frame ${i} is not worth ${inst.bit}`);
      return;
    }
  }
  const last = walk.frames[walk.frames.length - 1];
  if (walk.outcome === 'reached' && !(last.root.k === 'num' && last.root.v === inst.bit && last.defs.length === 0)) {
    fail(`${tag} ${name}: says it reached 0 but ended on something else`);
  }
};

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

console.log(`${SEEDS} instances per row. "wins" = walks that reached 0.\n`);
console.log(
  'level                          λ   |E|  planted  greedy wins  sorted wins  canonical wins  canonical steps  canonical peak',
);
const t0 = Date.now();
for (let level = 0; level < LEVELS.length; level++) {
  for (const lambda of [8, 16, 24, 32, 40]) {
    const row = { size: [], planted: [], greedy: 0, sorted: 0, canon: 0, canonSteps: [], canonPeak: [] };
    for (let seed = 0; seed < SEEDS; seed++) {
      const inst = makeInstance({ level, lambda, seed });
      const tag = `level ${level} λ ${lambda} seed ${seed}`;
      checkWalk('grown', inst.grown, inst, tag);
      checkWalk('planted', inst.planted, inst, tag);
      checkWalk('greedy', inst.greedy, inst, tag);
      checkWalk('sorted', inst.sorted, inst, tag);
      checkWalk('canonical', inst.canonical, inst, tag);
      if (inst.sample !== inst.bit) fail(`${tag}: E is not worth 0`);
      if (inst.canonical.outcome === 'stuck') fail(`${tag}: canonical form stopped short of a number`);
      row.size.push(inst.E.n);
      row.planted.push(inst.planted.steps.length);
      if (inst.greedy.outcome === 'reached') row.greedy++;
      if (inst.sorted.outcome === 'reached') row.sorted++;
      if (inst.canonical.outcome === 'reached') {
        row.canon++;
        row.canonSteps.push(inst.canonical.steps.length);
        row.canonPeak.push(inst.canonical.peak);
      }
    }
    const pct = (n) => `${Math.round((100 * n) / SEEDS)}%`.padStart(4);
    console.log(
      `${level} ${LEVELS[level].padEnd(28)} ${String(lambda).padStart(2)}  ${String(median(row.size)).padStart(4)}  ${String(median(row.planted)).padStart(7)}  ${pct(row.greedy).padStart(11)}  ${pct(row.sorted).padStart(11)}  ${pct(row.canon).padStart(14)}  ${String(median(row.canonSteps)).padStart(15)}  ${String(median(row.canonPeak)).padStart(14)}`,
    );
  }
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${failures} failures, ${Date.now() - t0} ms`);
process.exit(failures === 0 ? 0 : 1);
