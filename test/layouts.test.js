const test = require('node:test');
const assert = require('node:assert');
const L = require('../assets/post/layouts.js');
const S = require('../assets/post/state.js');

// Deterministic stand-in for canvas metrics: width is linear in font size and in
// tracking, which is all the engine relies on. Linearity is what makes the
// "doubling width doubles everything" assertion meaningful.
const measure = (text, font) => text.length * font.size * (0.55 + (font.tracking || 0));

function doc(over) {
  return S.normalise(Object.assign({
    layout: 'headline-above',
    eyebrow: 'Framework',
    headline: 'Four weeks to something real.',
    footer: 'framework.studio'
  }, over));
}

test('every op stays inside the frame, at every ratio', () => {
  for (const layout of L.LAYOUTS) {
    for (const ratio of S.RATIOS) {
      const size = S.ratioSize(ratio);
      const { ops } = L.build(doc({ layout }), size, measure);
      for (const op of ops) {
        if (op.type === 'text') continue; // placed by baseline; checked below
        assert.ok(op.x >= 0, `${layout} ${ratio}: ${op.type} x=${op.x}`);
        assert.ok(op.y >= 0, `${layout} ${ratio}: ${op.type} y=${op.y}`);
        assert.ok(op.x + (op.w || 0) <= size.width + 0.5, `${layout} ${ratio}: ${op.type} right edge`);
        assert.ok(op.y + (op.h || 0) <= size.height + 0.5, `${layout} ${ratio}: ${op.type} bottom edge`);
      }
    }
  }
});

test('text baselines sit inside the frame at every ratio', () => {
  for (const layout of L.LAYOUTS) {
    for (const ratio of S.RATIOS) {
      const size = S.ratioSize(ratio);
      const { ops } = L.build(doc({ layout }), size, measure);
      for (const op of ops.filter((o) => o.type === 'text')) {
        assert.ok(op.y > 0 && op.y <= size.height, `${layout} ${ratio}: baseline ${op.y}`);
        assert.ok(op.x >= 0 && op.x < size.width, `${layout} ${ratio}: text x ${op.x}`);
      }
    }
  }
});

test('doubling width doubles every size exactly', () => {
  const a = L.build(doc(), { width: 1080, height: 1350 }, measure).ops;
  const b = L.build(doc(), { width: 2160, height: 2700 }, measure).ops;
  assert.strictEqual(a.length, b.length);
  a.forEach((op, i) => {
    const other = b[i];
    assert.strictEqual(other.type, op.type);
    if (op.type === 'text') {
      assert.strictEqual(other.font.size, op.font.size * 2);
      assert.strictEqual(other.y, op.y * 2);
      assert.strictEqual(other.x, op.x * 2);
    } else {
      assert.strictEqual(other.x, op.x * 2);
      assert.strictEqual(other.w, op.w * 2);
    }
  });
});

test('a headline too big for its box shrinks through the scale', () => {
  const { warnings } = L.build(doc({ headline: 'word '.repeat(30).trim() }),
    S.ratioSize('1:1'), measure);
  const shrunk = warnings.find((w) => w.kind === 'shrunk');
  assert.ok(shrunk, 'expected a shrunk warning');
  assert.strictEqual(shrunk.field, 'headline');
  assert.ok(shrunk.steps >= 1 && shrunk.steps <= 3, `steps=${shrunk && shrunk.steps}`);
});

test('a headline that cannot fit vertically is clipped, not overflowed', () => {
  const cramped = { width: 1080, height: 420 };
  const { ops, warnings } = L.build(doc({ headline: 'word '.repeat(30).trim() }), cramped, measure);
  assert.ok(warnings.some((w) => w.kind === 'clipped' && w.field === 'headline'));
  const headline = ops.find((o) => o.type === 'text' && o.font.family === 'Jost');
  const block = headline.lines.length * headline.font.size * 1.03;
  assert.ok(block <= cramped.height, `block ${block} exceeded ${cramped.height}`);
});

test('a single unbreakable word too wide for the column is clipped', () => {
  const { warnings } = L.build(doc({ headline: 'x'.repeat(110) }), S.ratioSize('1:1'), measure);
  assert.ok(warnings.some((w) => w.kind === 'clipped' && w.field === 'headline'));
});

test('a headline that fits raises no warnings', () => {
  const { warnings } = L.build(doc({ headline: 'Short.' }), S.ratioSize('1:1'), measure);
  assert.deepStrictEqual(warnings, []);
});

test('statement emits no art op', () => {
  const { ops } = L.build(doc({ layout: 'statement' }), S.ratioSize('4:5'), measure);
  assert.strictEqual(ops.filter((o) => o.type === 'art').length, 0);
});

test('the other layouts all emit exactly one art op', () => {
  for (const layout of ['headline-above', 'split', 'art-full']) {
    const { ops } = L.build(doc({ layout }), S.ratioSize('4:5'), measure);
    assert.strictEqual(ops.filter((o) => o.type === 'art').length, 1, layout);
  }
});

test('headline-above runs its artwork to all three edges', () => {
  for (const ratio of S.RATIOS) {
    const size = S.ratioSize(ratio);
    const { ops } = L.build(doc({ layout: 'headline-above' }), size, measure);
    const art = ops.find((o) => o.type === 'art');
    assert.strictEqual(art.x, 0, `${ratio}: left`);
    assert.strictEqual(art.w, size.width, `${ratio}: width`);
    assert.strictEqual(art.y + art.h, size.height, `${ratio}: reaches the bottom`);
  }
});

test('the footer paints after the artwork, so it overlays rather than clipping it', () => {
  const { ops } = L.build(doc({ layout: 'headline-above' }), S.ratioSize('4:5'), measure);
  const artIndex = ops.findIndex((o) => o.type === 'art');
  const footerIndex = ops.map((o, i) => [o, i])
    .filter(([o]) => o.type === 'text' && o.font.family === 'IBM Plex Mono')
    .map(([, i]) => i)
    .pop();
  assert.ok(footerIndex > artIndex, 'footer must be drawn after the art op');
});

test('the eyebrow and the footer are set identically, in every layout and ratio', () => {
  for (const layout of L.LAYOUTS) {
    for (const ratio of S.RATIOS) {
      const { ops } = L.build(doc({ layout }), S.ratioSize(ratio), measure);
      const labels = ops.filter((o) => o.type === 'text' && o.font.family === 'IBM Plex Mono');
      if (!labels.length) continue; // art-full carries neither
      const first = labels[0];
      for (const other of labels.slice(1)) {
        assert.strictEqual(other.font.size, first.font.size, `${layout} ${ratio}: size`);
        assert.strictEqual(other.font.tracking, first.font.tracking, `${layout} ${ratio}: tracking`);
        assert.strictEqual(other.font.weight, first.font.weight, `${layout} ${ratio}: weight`);
        assert.strictEqual(other.font.lineHeight, first.font.lineHeight, `${layout} ${ratio}: line height`);
      }
    }
  }
});

test('both labels carry the same role, so they render the same colour', () => {
  const { ops } = L.build(doc({ layout: 'headline-above' }), S.ratioSize('4:5'), measure);
  const roles = ops
    .filter((o) => o.type === 'text' && o.font.family === 'IBM Plex Mono')
    .map((o) => o.role);
  assert.strictEqual(roles.length, 2);
  assert.strictEqual(roles[0], roles[1]);
});

test('layouts reference roles, never literal colours', () => {
  for (const layout of L.LAYOUTS) {
    const json = JSON.stringify(L.build(doc({ layout }), S.ratioSize('1:1'), measure).ops);
    assert.ok(!/#[0-9a-fA-F]{6}/.test(json), `${layout} leaked a hex colour`);
  }
});

test('the art op carries the document theme through to the renderer', () => {
  const { ops } = L.build(doc({ layout: 'headline-above', theme: 'ink' }),
    S.ratioSize('1:1'), measure);
  assert.strictEqual(ops.find((o) => o.type === 'art').theme, 'ink');
});

test('a typed newline breaks the headline where the writer put it', () => {
  const size = S.ratioSize('1:1');
  const headlineOf = (over) => {
    const { ops } = L.build(doc(over), size, measure);
    // the headline is the only multi-line text op that is not upper-cased
    return ops.filter((op) => op.type === 'text' && op.role !== 'muted')
      .map((op) => op.lines)
      .find((lines) => lines.join(' ').includes('Four'));
  };

  const flowed = headlineOf({ headline: 'Four weeks to something real.' });
  const broken = headlineOf({ headline: 'Four weeks\nto something real.' });

  assert.deepStrictEqual(broken.slice(0, 2), ['Four weeks', 'to something real.']);
  assert.notDeepStrictEqual(broken, flowed);
});

test('a blank line is kept between paragraphs but not at either end', () => {
  const size = S.ratioSize('1:1');
  const linesFor = (headline) => {
    const { ops } = L.build(doc({ headline }), size, measure);
    return ops.filter((op) => op.type === 'text' && op.role !== 'muted')
      .map((op) => op.lines)
      .find((lines) => lines.join(' ').includes('One'));
  };

  assert.deepStrictEqual(linesFor('One\n\nTwo'), ['One', '', 'Two']);
  assert.deepStrictEqual(linesFor('\n\nOne\nTwo\n\n'), ['One', 'Two']);
});
