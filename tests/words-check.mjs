/**
 * Checks the game behind the "Two words, one path" post and prints the
 * numbers the post quotes. Needs Node 22.18 or newer.
 *
 *   node tests/words-check.mjs            # SEEDS=200 for the numbers in the post
 *
 * For every instance it checks that every step of every walk is one rule used
 * once, and that a walk marked "found" really runs from the first word to the
 * last.
 */
import { RULE_SETS, makeInstance, verifyStep } from '../src/entries/word-paths/words.ts';

const SEEDS = Number(process.env.SEEDS ?? 40);
const LENGTH = Number(process.env.LENGTH ?? 12);
let failures = 0;
const fail = (msg) => {
  failures++;
  if (failures < 12) console.log('FAIL ', msg);
};

const check = (name, walk, inst, tag) => {
  for (let i = 0; i < walk.steps.length; i++) {
    if (!verifyStep(walk.frames[i], walk.frames[i + 1], inst.rules, walk.steps[i])) {
      fail(`${tag} ${name}: step ${i} is not one rule used once`);
      return;
    }
  }
  if (walk.frames[0] !== inst.from) fail(`${tag} ${name}: does not start at the first word`);
  if (walk.outcome === 'found' && walk.frames[walk.frames.length - 1] !== inst.to) fail(`${tag} ${name}: does not end at the last word`);
};

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

console.log(`${SEEDS} instances per row, first word ${LENGTH} letters long.\n`);
console.log('rules                           λ  planted  greedy  standard form  search  search path  words looked at');
const t0 = Date.now();
for (let rules = 0; rules < RULE_SETS.length; rules++) {
  for (const lambda of [4, 8, 16, 24, 32, 48, 60]) {
    const row = { planted: [], greedy: 0, standard: 0, search: 0, path: [], seen: [] };
    for (let seed = 0; seed < SEEDS; seed++) {
      const inst = makeInstance({ rules, lambda, length: LENGTH, seed });
      const tag = `rules ${rules} λ ${lambda} seed ${seed}`;
      for (const name of ['planted', 'greedy', 'standard', 'search']) check(name, inst[name], inst, tag);
      row.planted.push(inst.planted.steps.length);
      if (inst.greedy.outcome === 'found') row.greedy++;
      if (inst.standard.outcome === 'found') row.standard++;
      if (inst.search.outcome === 'found') {
        row.search++;
        row.path.push(inst.search.steps.length);
        if (inst.search.steps.length > inst.planted.steps.length) fail(`${tag}: the search found a longer path than the planted one`);
      }
      row.seen.push(inst.search.seen);
    }
    const pct = (n) => `${Math.round((100 * n) / SEEDS)}%`;
    console.log(
      `${rules} ${RULE_SETS[rules].padEnd(28)} ${String(lambda).padStart(2)}  ${String(median(row.planted)).padStart(7)}  ${pct(row.greedy).padStart(6)}  ${pct(row.standard).padStart(13)}  ${pct(row.search).padStart(6)}  ${String(median(row.path)).padStart(11)}  ${String(median(row.seen)).padStart(15)}`,
    );
  }
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${failures} failures, ${Date.now() - t0} ms`);
process.exit(failures === 0 ? 0 : 1);
