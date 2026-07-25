/**
 * Exercises the hardware path without hardware.
 *
 * The LPD8 is stubbed at `navigator.requestMIDIAccess`, so these checks cover
 * the one part of the site that cannot be tried by hand in a browser: how raw
 * note and CC numbers become pad and knob slots.
 *
 * Run against a built site:
 *   npm run build && npx vite preview --port 4173 &
 *   npx playwright@latest install chromium   # once
 *   node tests/midi-mapping.mjs
 *
 * Set CHROME_PATH to use a Chromium you already have.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// Stub a fake LPD8 before any app code runs.
await page.addInitScript(() => {
  const input = {
    id: 'fake-1',
    name: 'LPD8 mk2',
    manufacturer: 'Akai',
    state: 'connected',
    type: 'input',
    onmidimessage: null,
  };
  window.__lpd8 = input;
  navigator.requestMIDIAccess = () =>
    Promise.resolve({ inputs: new Map([['fake-1', input]]), onstatechange: null });
});

const send = (bytes) =>
  page.evaluate(
    (b) => window.__lpd8.onmidimessage?.({ data: new Uint8Array(b), timeStamp: performance.now() }),
    bytes,
  );

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const results = [];
const check = (name, pass, detail = '') =>
  results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

await page.goto(`${BASE}/posts/pulse-lattice`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// 1. device shows up in the status strip
const chip = await page.textContent('.midi-chip-text');
check('device is listed', chip.includes('LPD8 mk2'), chip);

// 2. mk2 factory notes 36-43 land on pads 1-8 in order
const padSlots = [];
for (let note = 36; note <= 43; note++) {
  await send([0x90, note, 100]);
  await send([0x80, note, 0]);
}
await page.waitForTimeout(150);
const log = await page.$$eval('.midi-log li', (els) =>
  els.map((el) => el.textContent.replace(/[·→]/g, ' ').replace(/\s+/g, ' ').trim()),
);
for (let note = 36; note <= 43; note++) {
  const line = log.find((l) => l.includes(`note on`) && l.includes(` ${note} 100`));
  padSlots.push(line ?? `missing ${note}`);
}
check(
  'mk2 notes 36-43 map to pads 1-8',
  padSlots.every((line, i) => line.includes(`pad ${i + 1}`)),
  padSlots[0],
);

// 3. knob CC 70-77 move knobs 1-8; check knob 3 reads 100
await send([0xb0, 72, 127]);
await page.waitForTimeout(120);
const knobValues = await page.$$eval('.knob-value', (els) => els.map((e) => e.textContent));
check('CC 72 drives knob 3 to 100', knobValues[2] === '100', knobValues.join(','));

// 4. a held note lights its pad
await send([0x90, 38, 127]);
await page.waitForTimeout(100);
const held = await page.$$eval('.pad', (els) => els.map((e) => getComputedStyle(e).boxShadow));
check('a held pad is lit', held.some((s) => s !== 'none'), '');
await send([0x90, 38, 0]); // note-on velocity 0 = note off

// 5. a controller on a different bank (mk1 notes 40-47) rebases, out of order
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
for (const note of [44, 47, 40, 41]) {
  await send([0x90, note, 90]);
  await send([0x80, note, 0]);
}
await page.waitForTimeout(150);
const log2 = await page.$$eval('.midi-log li', (els) =>
  els.map((el) => el.textContent.replace(/[·→]/g, ' ').replace(/\s+/g, ' ').trim()),
);
void log2;
// Once the window has settled, the whole bank must map in hardware order.
for (let note = 40; note <= 47; note++) {
  await send([0x90, note, 70]);
  await send([0x80, note, 0]);
}
await page.waitForTimeout(150);
const log2b = await page.$$eval('.midi-log li', (els) =>
  els.map((el) => el.textContent.replace(/[·\u2192]/g, ' ').replace(/\s+/g, ' ').trim()),
);
const settled = [];
for (let note = 40; note <= 47; note++) {
  settled.push(log2b.find((l) => l.includes('note on') && l.includes(` ${note} 70`)) ?? `missing ${note}`);
}
check(
  'mk1 bank 40-47 settles to pads 1-8 in order',
  settled.every((line, i) => line.includes(`pad ${i + 1}`)),
  settled.map((l) => l.slice(-6)).join(','),
);

// 6. the rebase persisted
const stored = await page.evaluate(() => localStorage.getItem('eightpads.mapping.v1'));
check('learned mapping persists', stored?.includes('"padBaseNote":40'), stored);

// 7. scattered layout still gets slots
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
for (const note of [12, 60, 90]) {
  await send([0x90, note, 80]);
  await send([0x80, note, 0]);
}
await page.waitForTimeout(150);
const log3 = await page.$$eval('.midi-log li', (els) =>
  els.map((el) => el.textContent.replace(/[·→]/g, ' ').replace(/\s+/g, ' ').trim()),
);
const scattered = [12, 60, 90].map(
  (n) => log3.find((l) => l.includes('note on') && l.includes(` ${n} 80`)) ?? '',
);
check(
  'scattered notes claim slots in order',
  scattered[0].includes('pad 1') && scattered[1].includes('pad 2') && scattered[2].includes('pad 3'),
  scattered.join(' | '),
);

console.log(results.join('\n'));
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
