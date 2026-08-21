const test = require('node:test');
const assert = require('node:assert');
const S = require('../assets/post/state.js');

test('defaults are a valid document', () => {
  const d = S.defaults();
  assert.strictEqual(d.v, 1);
  assert.ok(S.LAYOUTS.includes(d.layout));
  assert.ok(S.THEMES.includes(d.theme));
  assert.ok(S.RATIOS.includes(d.preview));
  assert.ok(S.COMPOSITIONS.includes(d.art.composition));
});

test('encode/decode round-trips every field', () => {
  const d = S.defaults();
  d.eyebrow = 'Framework · How we work';
  d.headline = 'Four weeks to something real.';
  d.footer = 'framework.studio';
  d.layout = 'split';
  d.theme = 'ink';
  d.preview = '9:16';
  d.art = { composition: 'random', seed: 42 };
  assert.deepStrictEqual(S.decode(S.encode(d)), d);
});

test('encoded output is URL-safe', () => {
  const s = S.encode(S.defaults());
  assert.match(s, /^[A-Za-z0-9_-]+$/);
});

test('decode rejects junk without throwing', () => {
  for (const bad of ['', 'not-base64!!', 'YWJj', null, undefined, '////']) {
    assert.strictEqual(S.decode(bad), null);
  }
});

test('normalise repairs hostile input and never throws', () => {
  const d = S.normalise({
    layout: 'nope', theme: 'purple', preview: '3:2',
    eyebrow: 'x'.repeat(500), headline: 'y'.repeat(500), footer: 'z'.repeat(500),
    art: { composition: 'banana', seed: 'NaN' }
  });
  assert.ok(S.LAYOUTS.includes(d.layout));
  assert.ok(S.THEMES.includes(d.theme));
  assert.ok(S.RATIOS.includes(d.preview));
  assert.ok(S.COMPOSITIONS.includes(d.art.composition));
  assert.strictEqual(d.eyebrow.length, S.LIMITS.eyebrow);
  assert.strictEqual(d.headline.length, S.LIMITS.headline);
  assert.strictEqual(d.footer.length, S.LIMITS.footer);
});

test('normalise never leaves a random composition without a seed', () => {
  const d = S.normalise({ art: { composition: 'random', seed: null } });
  assert.strictEqual(typeof d.art.seed, 'number');
  assert.ok(Number.isInteger(d.art.seed));
});

test('normalise tolerates non-objects', () => {
  for (const bad of [null, undefined, 7, 'str', []]) {
    assert.deepStrictEqual(S.normalise(bad), S.defaults());
  }
});

test('the composition list stays in step with blocks.js', () => {
  const Blocks = require('../assets/blocks.js');
  // The picker must offer every sculpture blocks.js can draw, plus 'random', which
  // blocks.js does not name. Drift here silently resets a valid post to the default.
  assert.deepStrictEqual(S.COMPOSITIONS, Blocks.compositions.concat(['random']));
});

test('a composition added to blocks.js survives normalise', () => {
  const Blocks = require('../assets/blocks.js');
  for (const name of Blocks.compositions) {
    assert.strictEqual(S.normalise({ art: { composition: name } }).art.composition, name);
  }
});

test('ratioSize returns the Instagram export sizes', () => {
  assert.deepStrictEqual(S.ratioSize('1:1'), { width: 1080, height: 1080 });
  assert.deepStrictEqual(S.ratioSize('4:5'), { width: 1080, height: 1350 });
  assert.deepStrictEqual(S.ratioSize('9:16'), { width: 1080, height: 1920 });
});
