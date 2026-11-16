/**
 * Checks the game behind the "Back to one tile" post and prints the numbers
 * the post quotes. Needs Node 22.18 or newer.
 *
 *   node tests/grid-check.mjs             # SEEDS=100 for the numbers in the post
 *
 * For every instance it checks that every step of every walk is one rule used
 * once, that the generator started from a single tile, and that a walk marked
 * "found" really runs from the mess to that tile.
 */
import { RULE_SETS, SIZES, makeInstance, tiles, verifyStep } from '../src/entries/one-tile/grid.ts';

const SEEDS = Number(process.env.SEEDS ?? 40);
let failures = 0;
const fail = (msg) => {
  failures++;
  if (failures < 12) console.log('FAIL ', msg);
};

const check = (name, walk, inst, tag, from, to) => {
  for (let i = 0; i < walk.steps.length; i++) {
    if (!verifyStep(walk.frames[i], walk.frames[i + 1], inst.size, inst.rules, walk.steps[i])) {
      fail(`${tag} ${name}: step ${i} is not one rule used once`);
      return;
    }
  }
  if (walk.frames[0] !== from) fail(`${tag} ${name}: starts in the wrong place`);
  if (walk.outcome !== 'stuck' && walk.outcome !== 'gave up' && walk.frames[walk.frames.length - 1] !== to) fail(`${tag} ${name}: ends in the wrong place`);
};

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

console.log(`${SEEDS} instances per row.\n`);
console.log('rules                       board   λ  tiles  greedy  standard form  search  search path  boards looked at');
const t0 = Date.now();
for (let rules = 0; rules < RULE_SETS.length; rules++) {
  for (const size of [1, 3]) {
    for (const lambda of [6, 10, 14, 20, 30, 40]) {
      const row = { tiles: [], greedy: 0, standard: 0, search: 0, path: [], seen: [] };
      for (let seed = 0; seed < SEEDS; seed++) {
        const inst = makeInstance({ rules, lambda, size, seed });
        const tag = `rules ${rules} size ${size} λ ${lambda} seed ${seed}`;
        if (tiles(inst.one) !== 1) fail(`${tag}: the generator did not start from one tile`);
        check('grown', inst.grown, inst, tag, inst.one, inst.mess);
        for (const name of ['planted', 'greedy', 'standard', 'search']) check(name, inst[name], inst, tag, inst.mess, inst.one);
        row.tiles.push(tiles(inst.mess));
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
      const board = `${SIZES[size].w}×${SIZES[size].h}`;
      console.log(
        `${rules} ${RULE_SETS[rules].padEnd(25)} ${board.padStart(5)}  ${String(lambda).padStart(2)}  ${String(median(row.tiles)).padStart(5)}  ${pct(row.greedy).padStart(6)}  ${pct(row.standard).padStart(13)}  ${pct(row.search).padStart(6)}  ${String(median(row.path)).padStart(11)}  ${String(median(row.seen)).padStart(16)}`,
      );
    }
  }
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${failures} failures, ${Date.now() - t0} ms`);
process.exit(failures === 0 ? 0 : 1);
