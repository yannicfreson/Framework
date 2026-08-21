const test = require('node:test');
const assert = require('node:assert');
const P = require('../assets/photo/state.js');

test('defaults are a valid look', () => {
  const d = P.defaults();
  assert.strictEqual(d.v, 1);
  assert.ok(P.STYLES.includes(d.style));
  assert.ok(P.THEMES.includes(d.theme));
  assert.ok(P.RATIOS.includes(d.ratio));
  assert.deepStrictEqual(P.normalise(d), d);
});

test('the style list stays in step with engrave.js', () => {
  // engrave.js is an ES module and this one is UMD, so Node cannot import it here — the
  // literal is a copy, and a copy needs a guard. The index order is the contract: it is
  // what gets passed to the shader as uStyle.
  const source = require('node:fs').readFileSync('assets/engrave.js', 'utf8');
  const listed = source.match(/export const STYLES = \[([^\]]+)\]/)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepStrictEqual(P.STYLES, listed);
});

test('every slider has a range, and every ranged field has a slider', () => {
  const d = P.defaults();
  for (const [key, spec] of Object.entries(P.SLIDERS)) {
    assert.ok(typeof d[key] === 'number', `${key} missing from defaults`);
    assert.ok(spec.min < spec.max, `${key} range`);
    assert.ok(d[key] >= spec.min && d[key] <= spec.max, `${key} default out of range`);
    assert.ok(spec.label, `${key} has no label`);
  }
});

test('anything malformed becomes a valid look rather than an exception', () => {
  for (const bad of [null, undefined, 0, 'x', [], { style: 'crosshatch' }, { ratio: '16:9' }]) {
    assert.deepStrictEqual(P.normalise(bad), P.defaults());
  }
});

test('numbers are clamped to their range, not rejected', () => {
  assert.strictEqual(P.normalise({ midtone: 5000 }).midtone, P.SLIDERS.midtone.max);
  assert.strictEqual(P.normalise({ midtone: -5000 }).midtone, P.SLIDERS.midtone.min);
  assert.strictEqual(P.normalise({ smooth: '42' }).smooth, 42);
  assert.strictEqual(P.normalise({ smooth: NaN }).smooth, P.defaults().smooth);
});

test('the white point can never sit at or below the black point', () => {
  // The shader divides by their difference. A crossed pair is not a strange-looking photo,
  // it is a division by nothing, so it never reaches the shader at all.
  const crossed = P.normalise({ black: 80, white: 20 });
  assert.ok(crossed.white > crossed.black);
  const equal = P.normalise({ black: 50, white: 50 });
  assert.ok(equal.white > equal.black);
  const fine = P.normalise({ black: 20, white: 80 });
  assert.deepStrictEqual([fine.black, fine.white], [20, 80]);
});

test('contour is only ever a boolean', () => {
  assert.strictEqual(P.normalise({ contour: true }).contour, true);
  assert.strictEqual(P.normalise({ contour: 'yes' }).contour, false);
  assert.strictEqual(P.normalise({}).contour, false);
});

test('the frame is per photo and clamps the same way', () => {
  assert.deepStrictEqual(P.normaliseFrame(null), P.defaultFrame());
  assert.strictEqual(P.normaliseFrame({ zoom: 9999 }).zoom, P.FRAME.zoom.max);
  assert.strictEqual(P.normaliseFrame({ zoom: 1 }).zoom, P.FRAME.zoom.min);
  assert.strictEqual(P.normaliseFrame({ x: -20 }).x, 0);
  assert.strictEqual(P.normaliseFrame({ y: 120 }).y, 100);
  // A frame is deliberately not part of the look — a shared exposure, a personal crop.
  assert.ok(!('zoom' in P.defaults()), 'zoom leaked into the shared look');
});

test('the default frame matches the team grid on the site', () => {
  // .member__photo is aspect-ratio 3/4, so the default export drops in uncropped.
  assert.strictEqual(P.defaults().ratio, '3:4');
  assert.deepStrictEqual(P.ratioSize('3:4'), { width: 1080, height: 1440 });
  for (const ratio of P.RATIOS) {
    assert.strictEqual(P.ratioSize(ratio).width, 1080, `${ratio} should export at 1080 wide`);
  }
});

test('the guides toggle is not part of the look', () => {
  // The fifths overlay never reaches the export, so it has no business in the document
  // every photo shares — and it must survive a reset of that document.
  const d = P.defaults();
  assert.ok(!('guides' in d), 'guides leaked into the look');
  assert.ok(!('grid' in d), 'grid leaked into the look');
  assert.ok(!Object.keys(P.SLIDERS).includes('guides'));
  assert.deepStrictEqual(P.normalise({ guides: false }), d);
});
