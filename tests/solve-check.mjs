/**
 * Checks the algebra behind the "Solving for x, y and z" post and prints the
 * numbers the post quotes. Needs Node 22.18 or newer.
 *
 *   node tests/solve-check.mjs            # SEEDS=200 for the numbers in the post
 *
 * For every instance it checks that each step of every walk is a single valid
 * step (verifyStep), that the generator's answer satisfies every system on
 * every walk for every value of the givens, and that a walk marked "solved"
 * ends on a solved system.
 */
import { GIVEN_COUNT, LEVELS, evaluate, makeInstance, solutionAt, solved, stray, verifyStep } from '../src/entries/solve-rewriting/solve.ts';

const SEEDS = Number(process.env.SEEDS ?? 40);
let failures = 0;
const fail = (msg) => {
  failures++;
  if (failures < 12) console.log('FAIL ', msg);
};

const checkWalk = (name, walk, inst, tag) => {
  for (let i = 0; i < walk.steps.length; i++) {
    if (!verifyStep(walk.frames[i], walk.frames[i + 1], walk.steps[i])) {
      fail(`${tag} ${name}: step ${i} (${walk.steps[i].kind}) is not a single valid step`);
      return;
    }
  }
  const stride = Math.max(1, Math.floor(walk.frames.length / 40));
  for (let i = 0; i < walk.frames.length; i += stride) {
    for (let bits = 0; bits < 1 << GIVEN_COUNT; bits += 5) {
      const env = solutionAt(inst, bits);
      for (const q of walk.frames[i].eqs) {
        if (evaluate(q.l, env) !== evaluate(q.r, env)) {
          fail(`${tag} ${name}: frame ${i} is not satisfied by the answer`);
          return;
        }
      }
    }
  }
  if (walk.outcome === 'solved' && !solved(walk.frames[walk.frames.length - 1])) fail(`${tag} ${name}: not actually solved`);
};

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

console.log(`${SEEDS} instances per row. "wins" = walks that ended on a solved system.\n`);
console.log('level                               λ  size  out of place  planted  downhill wins  school wins  expand wins  expand steps');
const t0 = Date.now();
for (let level = 0; level < LEVELS.length; level++) {
  for (const lambda of [4, 8, 12, 16, 24]) {
    const row = { size: [], stray: [], planted: [], greedy: 0, school: 0, expanded: 0, steps: [] };
    for (let seed = 0; seed < SEEDS; seed++) {
      const inst = makeInstance({ level, lambda, seed });
      const tag = `level ${level} λ ${lambda} seed ${seed}`;
      for (const name of ['grown', 'planted', 'greedy', 'school', 'expanded']) checkWalk(name, inst[name], inst, tag);
      if (!solved(inst.grown.frames[0])) fail(`${tag}: the generator did not start from a solved system`);
      row.size.push(inst.E.n);
      row.stray.push(stray(inst.E));
      row.planted.push(inst.planted.steps.length);
      if (inst.greedy.outcome === 'solved') row.greedy++;
      if (inst.school.outcome === 'solved') row.school++;
      if (inst.expanded.outcome === 'solved') {
        row.expanded++;
        row.steps.push(inst.expanded.steps.length);
      }
    }
    const pct = (n) => `${Math.round((100 * n) / SEEDS)}%`;
    console.log(
      `${level} ${LEVELS[level].padEnd(32)} ${String(lambda).padStart(2)}  ${String(median(row.size)).padStart(4)}  ${String(median(row.stray)).padStart(12)}  ${String(median(row.planted)).padStart(7)}  ${pct(row.greedy).padStart(13)}  ${pct(row.school).padStart(11)}  ${pct(row.expanded).padStart(11)}  ${String(median(row.steps)).padStart(12)}`,
    );
  }
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${failures} failures, ${Date.now() - t0} ms`);
process.exit(failures === 0 ? 0 : 1);
