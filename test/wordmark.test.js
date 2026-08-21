const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const W = require('../assets/wordmark.js');

const PAGES = ['index.html', 'blocks.html', 'post-generator.html', 'photo-stylizer.html'];

test('the mark is still the mark', () => {
  // The F that was already in the header: 22x26 at stroke 2.4, stem to arm 19 wide, cap 23
  // tall, crossbar 10 down. If the generated one drifts from that, the logo changed.
  const m = W.metrics('mark');
  assert.strictEqual(W.svg({ variant: 'mark', height: 26 }).match(/width="([\d.]+)"/)[1], '21.91');
  assert.strictEqual(m.stroke, 10.43);
  assert.strictEqual(m.bar, 43.48);
  // Against the unrounded constants — `metrics` rounds for display, and 10.43/100 is not
  // 2.4/23 to nine places.
  assert.ok(Math.abs(W.STROKE / W.CAP - 2.4 / 23) < 1e-12, 'stroke is not 0.1043 of the cap');
  assert.ok(Math.abs(W.BAR / W.CAP - 10 / 23) < 1e-12, 'crossbar is not 0.4348 down');
});

test('a bar clears a stem by exactly two strokes', () => {
  // The one gesture the whole alphabet is built on. Not a rounded number that looks right.
  assert.ok(Math.abs(W.GAP - 2 * W.STROKE) < 1e-9);
  assert.ok(Math.abs(W.CLEAR - (W.STROKE / 2 + W.GAP)) < 1e-9);

  const letters = W.letters(W.SETTING.cut);
  for (const ch of ['F', 'E']) {
    const bar = letters[ch].d[1];
    const startX = parseFloat(bar.match(/^M([\d.]+),/)[1]);
    assert.ok(Math.abs(startX - W.CLEAR) < 0.01, `${ch}'s bar starts at ${startX}, not ${W.CLEAR}`);
  }
});

test('no letter is drawn as strokes butting into each other at a corner', () => {
  // The notch: two butt-ended strokes meeting at a point leave a square hole one stroke
  // wide. Every corner has to come from a mitre inside one path, so no two sub-paths of a
  // letter may share an endpoint — except where the gap is deliberate, which is never an
  // endpoint shared with another stroke.
  const letters = W.letters(W.SETTING.cut);
  const ends = (d) => {
    const pts = d.replace(/ Z$/, '').split(/ L|M/).filter(Boolean)
      .map((p) => p.split(',').map(Number));
    return d.endsWith('Z') ? [] : [pts[0], pts[pts.length - 1]];
  };

  for (const [ch, glyph] of Object.entries(letters)) {
    const all = glyph.d.map(ends);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        for (const a of all[i]) {
          for (const b of all[j]) {
            const touching = Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
            // R's leg springs from where the bowl closes; that is one corner the design
            // wants, and it is a join of two strokes at a point, not a hole at a corner.
            if (ch === 'R') continue;
            assert.ok(!touching, `${ch} has two strokes ending at the same point`);
          }
        }
      }
    }
  }
});

test('O closes rather than returning to its start', () => {
  assert.ok(W.letters(0).O.d[0].endsWith(' Z'), 'O is not a closed path');
  assert.ok(!/L0,0 Z$/.test(W.letters(0).O.d[0]), 'O repeats its first point before closing');
});

test('the full variant is monospaced', () => {
  // Every letter in one advance, so the word sets like the interface's own mono labels.
  const svg = W.svg({ variant: 'full' });
  const shifts = [...svg.matchAll(/translate\(([\d.]+),0\)/g)].map((m) => parseFloat(m[1]));
  const steps = shifts.slice(1).map((x, i) => x - shifts[i]);
  // Letters are centred in their slot, so the shift between two of them moves by half the
  // width difference. The slot itself never changes, which is the thing being asserted.
  const slot = W.SETTING.advance + W.SETTING.track;
  const letters = W.letters(W.SETTING.cut);
  const order = W.WORD.split('');
  steps.forEach((step, i) => {
    const a = letters[order[i]].w, b = letters[order[i + 1]].w;
    assert.ok(Math.abs(step - (slot + (a - b) / 2)) < 0.02,
      `${order[i]}${order[i + 1]} advance is ${step}, expected ${slot + (a - b) / 2}`);
  });
});

test('both variants render, and only the named two', () => {
  assert.deepStrictEqual(W.VARIANTS, ['mark', 'full']);
  for (const variant of W.VARIANTS) {
    const svg = W.svg({ variant });
    assert.match(svg, /^<svg /);
    assert.match(svg, /stroke-linecap="butt"/);
    assert.match(svg, /stroke-linejoin="miter"/);
    assert.ok(!svg.includes('NaN'), `${variant} produced NaN`);
  }
  // Anything else falls back to the mark rather than throwing or drawing nothing.
  assert.strictEqual(W.svg({ variant: 'nonsense' }), W.svg({ variant: 'mark' }));
  assert.strictEqual(W.svg(), W.svg({ variant: 'mark' }));
});

test('the wordmark is hidden from screen readers unless given a label', () => {
  // It almost always sits inside a link that already carries the name; announcing it twice
  // is worse than not announcing it.
  assert.match(W.svg({ variant: 'full' }), /aria-hidden="true"/);
  const labelled = W.svg({ variant: 'full', label: 'Framework' });
  assert.match(labelled, /role="img"/);
  assert.match(labelled, /aria-label="Framework"/);
  assert.ok(!labelled.includes('aria-hidden'));
});

test('every page header holds exactly what the module generates', () => {
  // Four copies of an inlined SVG is four chances to drift. This is the guard.
  const expected = W.svg({ variant: 'full', height: 17, className: 'wordmark__art' });
  for (const page of PAGES) {
    const html = fs.readFileSync(page, 'utf8');
    assert.ok(html.includes(expected), `${page} header is not the generated wordmark`);
    assert.ok(!html.includes('class="mark"'), `${page} still has the old inline mark`);
  }
});

test('the favicon is the mark, generated with a ground', () => {
  const expected = W.svg({ variant: 'mark', ground: '#F5F4F1', colour: '#16171A' });
  assert.strictEqual(fs.readFileSync('assets/favicon.svg', 'utf8').trim(), expected);

  // Square, or it will be letterboxed by everything that shows it.
  const box = expected.match(/viewBox="([-\d. ]+)"/)[1].split(' ').map(Number);
  assert.ok(Math.abs(box[2] - box[3]) < 0.01, 'favicon viewBox is not square');
});
