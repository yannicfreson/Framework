# Instagram Post Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal tool at `/post-generator` that composes a templated Instagram post from Framework's block artwork plus text, and exports it as three PNGs (1:1, 4:5, 9:16) in one action.

**Architecture:** One plain document object describes a post completely and is the only state. A pure `layouts.js` turns that document plus a canvas size into positioned draw ops; `render.js` paints ops onto a canvas, caching the WebGL artwork. The preview canvas's backing store *is* the export bitmap, so preview and export cannot diverge. Draft persists in `localStorage`; the whole document also encodes into the URL hash for sharing.

**Tech Stack:** Vanilla JS, no build step. Canvas 2D for composition. Existing `assets/blocks.js` (UMD, geometry + hatched SVG) and `assets/blocks3d.js` (ES module, WebGL hatch renderer). `node --test` for the pure modules. Deployed to Vercel as static files.

**Spec:** `docs/superpowers/specs/2026-08-21-post-generator-design.md`

## Global Constraints

- **No new runtime dependencies.** Nothing is installed; nothing is bundled. Vendored code lives in `assets/vendor/` only.
- **No build step.** Every file is served as authored.
- **Node 20.18.1** is the floor. `node --test` only; no test framework.
- **`layouts.js` and `state.js` must be pure and UMD-wrapped**, matching the pattern at the top of `assets/blocks.js`, so they load in Node and the browser unchanged. They must not touch `document`, `window`, or a canvas.
- **`render.js` and `app.js` are ES modules** (they import `blocks3d.js`, which is one).
- **Export sizes are exactly** 1080×1080, 1080×1350, 1080×1920.
- **Unit scale:** one unit = `width / 1080`. Every size and margin in a layout is in units.
- **Colours are referenced by role, never by literal**, inside `layouts.js`. `render.js` owns the role→hex table. Roles: `bg`, `fg`, `muted`, `panel`, `bar`, `barFg`.
- **`random` is not in `FrameworkBlocks.compositions`** — add it explicitly.
- **A `random` seed is never null** — `normalise` fills one, or shared posts reproduce differently for the recipient.
- **Commits:** this repository currently has no commits and every file is untracked. The commit step in each task is written out but **must not be run until the user asks for commits.** Complete the task, report, and leave the working tree dirty.

---

## File Structure

| File | Responsibility |
|---|---|
| `assets/post/state.js` | Document defaults, validation, URL encode/decode, localStorage. Pure, UMD. |
| `assets/post/layouts.js` | Document + canvas size → draw ops + warnings. Pure, UMD. |
| `assets/post/render.js` | Draw ops → canvas pixels. Art cache, role→hex, text metrics. ES module. |
| `assets/post/app.js` | Form wiring, preview loop, draft, share link, export. ES module. |
| `assets/post/post.css` | Editor chrome. Not the post. |
| `post-generator.html` | The page. Served at `/post-generator` by `cleanUrls`. |
| `test/state.test.js` | Node tests for `state.js`. |
| `test/layouts.test.js` | Node tests for `layouts.js`. |
| `robots.txt` | Disallow `/post-generator` and `/blocks`. |

---

### Task 1: Document model and persistence (`state.js`)

**Files:**
- Create: `assets/post/state.js`
- Test: `test/state.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: global `FrameworkPostState` / CommonJS export with:
  - `LAYOUTS: string[]`, `THEMES: string[]`, `RATIOS: string[]`, `COMPOSITIONS: string[]`
  - `LIMITS: { eyebrow: 60, headline: 120, footer: 60 }`
  - `MAX_URL_CHARS: 1800`
  - `defaults() -> doc`
  - `normalise(raw: any) -> doc` — never throws
  - `encode(doc) -> string` (base64url)
  - `decode(str: string) -> doc | null`
  - `save(doc) -> void`, `load() -> doc | null`
  - `ratioSize(ratio: string) -> { width: number, height: number }`

A `doc` is `{ v, layout, theme, eyebrow, headline, footer, art: { composition, seed }, preview }`.

- [ ] **Step 1: Write the failing tests**

Create `test/state.test.js`:

```js
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

test('ratioSize returns the Instagram export sizes', () => {
  assert.deepStrictEqual(S.ratioSize('1:1'), { width: 1080, height: 1080 });
  assert.deepStrictEqual(S.ratioSize('4:5'), { width: 1080, height: 1350 });
  assert.deepStrictEqual(S.ratioSize('9:16'), { width: 1080, height: 1920 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/state.test.js`
Expected: FAIL — `Cannot find module '../assets/post/state.js'`

- [ ] **Step 3: Implement `state.js`**

Create `assets/post/state.js`. Use the UMD wrapper from the top of `assets/blocks.js` verbatim in shape, with the global named `FrameworkPostState`. Key implementation notes:

```js
var LIMITS = { eyebrow: 60, headline: 120, footer: 60 };
var KEYS = { v: 'v', layout: 'l', theme: 't', eyebrow: 'e',
             headline: 'h', footer: 'f', composition: 'c', seed: 's', preview: 'p' };

// Cross-environment base64. Node has Buffer; browsers have btoa, which is
// byte-oriented and would mangle anything non-ASCII without the encode step.
function toBase64(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  var bytes = new TextEncoder().encode(str);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64) {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
  var binary = atob(b64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function urlSafe(b64) { return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function urlUnsafe(s) { return s.replace(/-/g, '+').replace(/_/g, '/'); }
```

`encode(doc)` maps to short keys, `JSON.stringify`, `toBase64`, `urlSafe`.

`decode(str)`: guard `typeof str === 'string' && /^[A-Za-z0-9_-]+$/.test(str)`; wrap the
rest in try/catch; after parsing, run the result through `normalise` and return `null` on
any throw or if the parsed value is not a plain object. `'YWJj'` decodes to the string
`abc`, which is valid base64 but not valid JSON — the try/catch is what makes that
return `null` rather than throw.

`normalise(raw)`: start from `defaults()`, then for each field take `raw`'s value only if
it passes its whitelist; clamp strings with `.slice(0, LIMITS[field])`; coerce seed with
`parseInt` and fall back to a fresh `Math.floor(Math.random() * 1e6)` when the
composition is `random` and the seed is not a finite integer.

`save`/`load` use key `framework-post-draft` and wrap every `localStorage` access in
try/catch, returning `null` on failure.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/state.test.js`
Expected: PASS, 8/8.

- [ ] **Step 5: Verify it also loads in a browser context**

Run: `node -e "const S=require('./assets/post/state.js'); console.log(Object.keys(S).join(','))"`
Expected: the full export list printed, confirming the UMD wrapper exports correctly.

- [ ] **Step 6: Commit** *(hold — see Global Constraints)*

```bash
git add assets/post/state.js test/state.test.js
git commit -m "feat(post): document model, validation and URL encoding"
```

---

### Task 2: Layout engine core and `headline-above`

**Files:**
- Create: `assets/post/layouts.js`
- Test: `test/layouts.test.js`

**Interfaces:**
- Consumes: `state.js` only for its enum lists in tests. `layouts.js` itself imports nothing.
- Produces: global `FrameworkPostLayouts` / CommonJS export with:
  - `build(doc, size, measure) -> { ops, warnings }`
    - `size` is `{ width, height }`
    - `measure(text, font) -> number` where `font` is `{ family, weight, size, tracking }`
  - `TYPE: { margin: 72, eyebrow: 22, footer: 20, headlineSteps: [96, 84, 72, 62] }`
- Op shapes (exact, later tasks depend on these):
  - `{ type: 'fill', x, y, w, h, role }`
  - `{ type: 'rule', x, y, w, thickness, role }`
  - `{ type: 'text', x, y, lines: string[], font, role, align: 'left' }`
  - `{ type: 'art', x, y, w, h, composition, seed, theme }`
- Warning shape: `{ kind: 'shrunk' | 'clipped', field: 'headline', steps: number }`

- [ ] **Step 1: Write the failing tests**

Create `test/layouts.test.js`. The stub `measure` is deterministic so assertions are
stable — it models a monospace-ish face, which is close enough to exercise wrapping:

```js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../assets/post/layouts.js');
const S = require('../assets/post/state.js');

const measure = (text, font) =>
  text.length * font.size * (0.55 + (font.tracking || 0));

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
        if (op.type === 'text') continue; // text is placed by baseline, checked below
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
    } else {
      assert.strictEqual(other.x, op.x * 2);
      assert.strictEqual(other.w, op.w * 2);
    }
  });
});

test('a long headline shrinks before it wraps past the box', () => {
  const long = 'A headline of considerable length that will not fit on one line at any size';
  const { warnings } = L.build(doc({ headline: long }), S.ratioSize('1:1'), measure);
  const shrunk = warnings.find((w) => w.kind === 'shrunk');
  assert.ok(shrunk, 'expected a shrunk warning');
  assert.ok(shrunk.steps >= 1 && shrunk.steps <= 3);
});

test('an unfittable headline reports clipped rather than overflowing', () => {
  const huge = 'word '.repeat(60).trim();
  const size = S.ratioSize('9:16');
  const { ops, warnings } = L.build(doc({ headline: huge }), size, measure);
  assert.ok(warnings.some((w) => w.kind === 'clipped' && w.field === 'headline'));
  const text = ops.find((o) => o.type === 'text' && o.font.size >= L.TYPE.headlineSteps[3]);
  assert.ok(text.lines.length * text.font.size * 1.03 <= size.height);
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

test('layouts reference roles, never literal colours', () => {
  const json = JSON.stringify(L.build(doc(), S.ratioSize('1:1'), measure).ops);
  assert.ok(!/#[0-9a-fA-F]{6}/.test(json), 'found a hex colour in ops');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/layouts.test.js`
Expected: FAIL — `Cannot find module '../assets/post/layouts.js'`

- [ ] **Step 3: Implement the engine core plus `headline-above`**

Create `assets/post/layouts.js` with the UMD wrapper. Export `LAYOUTS` listing all four
names so the first test iterates them, but implement only `headline-above` in this step;
have the other three temporarily delegate to `headline-above` so the suite runs. Core
pieces:

```js
var TYPE = { margin: 72, eyebrow: 22, footer: 20, headlineSteps: [96, 84, 72, 62] };
var LINE = { headline: 1.03, label: 1.4 };

// Everything in a layout is expressed in units; u() converts once, at the edge.
function scaler(width) {
  var u = width / 1080;
  return function (n) { return n * u; };
}

// Greedy wrap. Words that are themselves too long are left long — the caller
// decides whether that is a shrink or a clip.
function wrap(text, font, maxWidth, measure) {
  var words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  var lines = [];
  var line = words[0];
  for (var i = 1; i < words.length; i++) {
    var candidate = line + ' ' + words[i];
    if (measure(candidate, font) <= maxWidth) line = candidate;
    else { lines.push(line); line = words[i]; }
  }
  lines.push(line);
  return lines;
}

// Try each step of the scale until the block fits the box. Reports how far it had
// to go, and whether it still failed.
function fitHeadline(text, u, maxWidth, maxHeight, measure) {
  var steps = TYPE.headlineSteps;
  for (var i = 0; i < steps.length; i++) {
    var font = { family: 'Jost', weight: 400, size: u(steps[i]), tracking: -0.02 };
    var lines = wrap(text, font, maxWidth, measure);
    var height = lines.length * font.size * LINE.headline;
    var widest = lines.reduce(function (m, l) { return Math.max(m, measure(l, font)); }, 0);
    if (height <= maxHeight && widest <= maxWidth) {
      return { font: font, lines: lines, height: height, shrunk: i, clipped: false };
    }
  }
  // Last step still does not fit: clip to the lines that do.
  var font = { family: 'Jost', weight: 400, size: u(steps[steps.length - 1]), tracking: -0.02 };
  var all = wrap(text, font, maxWidth, measure);
  var fits = Math.max(1, Math.floor(maxHeight / (font.size * LINE.headline)));
  return {
    font: font, lines: all.slice(0, fits),
    height: Math.min(all.length, fits) * font.size * LINE.headline,
    shrunk: steps.length - 1, clipped: all.length > fits
  };
}
```

`build(doc, size, measure)` calls `scaler(size.width)`, dispatches on `doc.layout`,
collects ops and pushes warnings when `shrunk > 0` or `clipped`. `headline-above` lays
out: `fill` the whole frame with role `bg`; eyebrow `text` at the top margin; headline
`text` below it; `art` filling from under the headline to above the footer; footer `text`
on the last baseline.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/layouts.test.js`
Expected: PASS. The "other layouts emit one art op" test passes because they currently
delegate; Task 3 makes them real without changing the assertion.

- [ ] **Step 5: Commit** *(hold — see Global Constraints)*

```bash
git add assets/post/layouts.js test/layouts.test.js
git commit -m "feat(post): layout engine, unit scale and headline-above"
```

---

### Task 3: The remaining three layouts

**Files:**
- Modify: `assets/post/layouts.js`
- Test: `test/layouts.test.js` (add cases; existing ones must keep passing)

**Interfaces:**
- Consumes: the engine from Task 2 — `scaler`, `wrap`, `fitHeadline`, `TYPE`, `LINE`.
- Produces: no new exports. `build` now dispatches to four distinct implementations.

- [ ] **Step 1: Add the failing layout-specific tests**

Append to `test/layouts.test.js`:

```js
test('split puts type and art side by side on square, stacked on story', () => {
  const wide = L.build(doc({ layout: 'split' }), S.ratioSize('1:1'), measure).ops;
  const tall = L.build(doc({ layout: 'split' }), S.ratioSize('9:16'), measure).ops;
  const artWide = wide.find((o) => o.type === 'art');
  const artTall = tall.find((o) => o.type === 'art');
  assert.ok(artWide.x > S.ratioSize('1:1').width * 0.4, 'square: art sits to the side');
  assert.ok(artTall.x < S.ratioSize('9:16').width * 0.2, 'story: art spans the width');
  assert.ok(artTall.w > S.ratioSize('9:16').width * 0.8);
});

test('art-full bleeds the art to every edge and puts the headline on a bar', () => {
  const size = S.ratioSize('4:5');
  const ops = L.build(doc({ layout: 'art-full' }), size, measure).ops;
  const art = ops.find((o) => o.type === 'art');
  assert.strictEqual(art.x, 0);
  assert.strictEqual(art.y, 0);
  assert.strictEqual(art.w, size.width);
  assert.strictEqual(art.h, size.height);
  assert.ok(ops.some((o) => o.type === 'fill' && o.role === 'bar'));
  assert.ok(ops.some((o) => o.type === 'text' && o.role === 'barFg'));
});

test('statement uses the largest step it can and draws rules', () => {
  const ops = L.build(doc({ layout: 'statement', headline: 'Short.' }), S.ratioSize('1:1'), measure).ops;
  assert.ok(ops.some((o) => o.type === 'rule'));
  const headline = ops.find((o) => o.type === 'text' && o.font.family === 'Jost');
  assert.strictEqual(headline.font.size, L.TYPE.headlineSteps[0] * (1080 / 1080));
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test test/layouts.test.js`
Expected: FAIL on the three new tests (the delegating stubs produce `headline-above`
geometry), while all Task 2 tests still pass.

- [ ] **Step 3: Implement the three layouts**

In `assets/post/layouts.js`, replace the delegating stubs:

- `split` — branch on `size.height / size.width`. At or below `1.3` place type in the
  left `52%` and the art panel in the right `48%` full-bleed vertically; above `1.3`
  stack: type in the top `45%`, art panel across the full width below it. Emit a `fill`
  with role `panel` behind the art in both cases.
- `art-full` — `art` op at `0, 0, size.width, size.height`; a `fill` with role `bar`
  spanning the full width, its height derived from the wrapped headline plus
  `u(48)` padding, sitting `u(margin)` above the bottom; headline `text` with role
  `barFg` inside it. No eyebrow, no footer — the bar is the whole message.
- `statement` — no art. Eyebrow at the top margin, a `rule` under it, headline centred
  in the remaining vertical space, a second `rule` above the footer. Pass a taller box to
  `fitHeadline` since there is no art competing for space.

- [ ] **Step 4: Run the full suite to verify everything passes**

Run: `node --test test/`
Expected: PASS, all tests in both files.

- [ ] **Step 5: Commit** *(hold — see Global Constraints)*

```bash
git add assets/post/layouts.js test/layouts.test.js
git commit -m "feat(post): split, art-full and statement layouts"
```

---

### Task 4: Painting ops to a canvas (`render.js`)

**Files:**
- Create: `assets/post/render.js`

**Interfaces:**
- Consumes: `FrameworkPostLayouts` op shapes from Task 2; `assets/blocks3d.js`
  (`createSculpture`, `supported`); `assets/blocks.js` (`svg`) for the fallback.
- Produces: ES module exports:
  - `createMeasure(ctx) -> (text, font) => number`
  - `createCache() -> cache`
  - `paint(canvas, ops, cache) -> Promise<void>`
  - `fontsReady() -> Promise<void>`
  - `ROLES` — the role→hex table, exported for the editor chrome to reuse

- [ ] **Step 1: Implement the module**

Create `assets/post/render.js`:

```js
import { createSculpture, supported } from '../blocks3d.js';

export const ROLES = {
  paper: { bg: '#F5F4F1', fg: '#16171A', muted: '#6B6B64', bar: '#16171A', barFg: '#F5F4F1',
           panelA: '#EAE8E3', panelB: '#F1EFEB' },
  ink:   { bg: '#16171A', fg: '#F5F4F1', muted: '#8E8E86', bar: '#F5F4F1', barFg: '#16171A',
           panelA: '#1C1D20', panelB: '#232427' }
};

// Chrome and Safari support ctx.letterSpacing; older Safari does not. Measuring and
// drawing MUST agree, so both go through this one flag.
const HAS_LETTER_SPACING = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.letterSpacing = '2px';
    return c.letterSpacing === '2px';
  } catch (e) { return false; }
})();

function applyFont(ctx, font) {
  ctx.font = `${font.weight} ${font.size}px "${font.family}", sans-serif`;
  if (HAS_LETTER_SPACING) ctx.letterSpacing = `${font.tracking || 0}em`;
}

export function createMeasure(ctx) {
  return (text, font) => {
    applyFont(ctx, font);
    const base = ctx.measureText(text).width;
    // Without native tracking the advance has to be added by hand, and drawTracked
    // adds exactly the same amount.
    return HAS_LETTER_SPACING ? base : base + text.length * font.size * (font.tracking || 0);
  };
}

function drawText(ctx, op) {
  applyFont(ctx, op.font);
  ctx.fillStyle = op.colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const step = op.font.size * (op.font.lineHeight || 1.03);
  op.lines.forEach((line, i) => {
    const y = op.y + i * step;
    if (HAS_LETTER_SPACING) { ctx.fillText(line, op.x, y); return; }
    let x = op.x;
    for (const ch of line) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + op.font.size * (op.font.tracking || 0);
    }
  });
}
```

`paint(canvas, ops, cache)`:

1. `const ctx = canvas.getContext('2d')`, clear the full canvas.
2. Resolve each op's `role` against `ROLES[theme]` into `op.colour` — read `theme` from
   the `art` op if present, otherwise from a `theme` property set on the ops array by
   `build`. **Simpler and less fragile: `paint` takes theme as `cache.theme`, set by the
   caller before each paint.** Use that.
3. `fill` → `ctx.fillRect`. `rule` → `fillRect` with `op.thickness`.
4. `panel` role → build a striped `CanvasPattern` once per (theme, scale) and cache it on
   `cache.patterns`: an offscreen 18×18 canvas with two 9px bands, rotated 135° by
   `setTransform` on the pattern.
5. `art` → `await artFor(op, cache)` then `ctx.drawImage`.
6. `text` → `drawText`.

`artFor(op, cache)` keys on `` `${op.composition}|${op.seed}|${op.theme}|${op.w}|${op.h}` ``.
On miss: if `supported()`, `createSculpture({ composition, seed, theme, ratio: op.w / op.h,
width: op.w, height: op.h, pixelRatio: 1 })`, `render()`, cache `sculpture.canvas`. If not
supported, build the SVG string from `window.FrameworkBlocks.svg({...})`, wrap in a
`data:image/svg+xml;base64,` URI, load through `new Image()`, and cache that.

`fontsReady()` awaits `document.fonts.load('400 100px Jost')`,
`document.fonts.load('400 100px "IBM Plex Mono"')` and then `document.fonts.ready`.
Loading each face explicitly matters — `document.fonts.ready` alone resolves before a
face that nothing has requested yet has actually loaded.

- [ ] **Step 2: Verify in the browser**

Serve the repo (`python3 -m http.server 8811`) and open a scratch page that imports
`render.js`, builds ops for `headline-above` at 1080×1350 with a real `measure`, paints
into a canvas and appends it. Screenshot it.
Expected: a recognisable post — eyebrow, headline, hatched sculpture, footer — in the
right typefaces, with no console errors.

- [ ] **Step 3: Verify tracking agrees between measure and draw**

In the same scratch page, measure a tracked mono string, draw it, and read back the
painted extent with `getImageData` to find the first and last non-background column.
Expected: painted width within 2px of the measured width. This is the assertion that
catches the letter-spacing fallback drifting from the metrics.

- [ ] **Step 4: Commit** *(hold — see Global Constraints)*

```bash
git add assets/post/render.js
git commit -m "feat(post): canvas painter, art cache and text metrics"
```

---

### Task 5: The editor page

**Files:**
- Create: `post-generator.html`, `assets/post/post.css`, `assets/post/app.js`
- Create: `robots.txt`

**Interfaces:**
- Consumes: `FrameworkPostState` (Task 1), `FrameworkPostLayouts` (Tasks 2–3),
  `render.js` (Task 4).
- Produces: a working editor. Export is Task 6.

Script order in `post-generator.html` matters — classic scripts run before deferred
modules, so the globals exist by the time `app.js` runs:

```html
<script src="/assets/blocks.js"></script>
<script src="/assets/post/state.js"></script>
<script src="/assets/post/layouts.js"></script>
<script type="module" src="/assets/post/app.js"></script>
```

- [ ] **Step 1: Build the page shell and chrome**

`post-generator.html`: `<meta name="robots" content="noindex">`, the Google Fonts link
used by the rest of the site, `/styles.css` for tokens then `/assets/post/post.css` for
the editor. Two columns — controls left, previews right — collapsing to one below 900px.

Controls: layout (4 radio-style buttons), theme (paper/ink), composition select
(**the four from `FrameworkBlocks.compositions` plus `random`**), a re-roll button shown
only for `random`, and three text inputs with live character counters bound to
`FrameworkPostState.LIMITS`.

Previews: the `doc.preview` ratio large, the other two as smaller live canvases beside
it, each labelled and each with a warning slot beneath.

`robots.txt`:

```
User-agent: *
Disallow: /post-generator
Disallow: /blocks
```

- [ ] **Step 2: Wire state and the render loop in `app.js`**

```js
import { createMeasure, createCache, paint, fontsReady } from './render.js';

const State = window.FrameworkPostState;
const Layouts = window.FrameworkPostLayouts;

let doc = State.normalise(
  State.decode((location.hash || '').replace(/^#s=/, '')) || State.load() || State.defaults()
);

const cache = createCache();
const measureCanvas = document.createElement('canvas');
const measure = createMeasure(measureCanvas.getContext('2d'));

let pending = null;
function scheduleRender() {
  clearTimeout(pending);
  pending = setTimeout(renderAll, 120);
}

async function renderAll() {
  cache.theme = doc.theme;
  for (const ratio of State.RATIOS) {
    const size = State.ratioSize(ratio);
    const canvas = document.querySelector(`[data-preview="${ratio}"]`);
    canvas.width = size.width;
    canvas.height = size.height;
    const { ops, warnings } = Layouts.build(doc, size, measure);
    await paint(canvas, ops, cache);
    showWarnings(ratio, warnings);
  }
  State.save(doc);
  updateShareLink();
}
```

Every control mutates `doc` then calls `scheduleRender()`. `showWarnings` writes
"Headline clipped at 9:16" into that ratio's slot, or clears it. Await `fontsReady()`
once before the first `renderAll()`.

- [ ] **Step 3: Wire the share link**

`updateShareLink()` sets `location.hash = 's=' + State.encode(doc)` via
`history.replaceState` (never `pushState` — typing would fill the back stack). The copy
button writes `location.href` to the clipboard. When
`State.encode(doc).length > State.MAX_URL_CHARS`, disable the button and show
"Too long to share — shorten the headline" rather than copying a broken link.

- [ ] **Step 4: Verify in the browser**

Open `/post-generator`, type a headline, switch layout and theme, pick each composition,
re-roll a random seed.
Expected: all three previews update within ~120ms; the sculpture only re-renders when
composition, seed, theme or size changes (confirm by timing a keystroke repaint); a long
headline raises a warning on the ratio that clips it and not on the others.

- [ ] **Step 5: Verify draft and share round-trip**

Reload the page — the draft returns. Copy the share URL, open it in a fresh context,
confirm an identical document including the `random` seed. Then open
`/post-generator#s=notvalid`.
Expected: a default document, no console error.

- [ ] **Step 6: Commit** *(hold — see Global Constraints)*

```bash
git add post-generator.html assets/post/post.css assets/post/app.js robots.txt
git commit -m "feat(post): editor page, live previews, draft and share link"
```

---

### Task 6: Export

**Files:**
- Modify: `assets/post/app.js`

**Interfaces:**
- Consumes: everything above.
- Produces: an `Export all three` action writing three PNGs.

- [ ] **Step 1: Implement the export**

```js
function slug(text) {
  const s = String(text).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return s || new Date().toISOString().slice(0, 10);
}

async function exportAll() {
  // Sequential: blocks3d shares one WebGL context, so these cannot overlap.
  for (const ratio of State.RATIOS) {
    const size = State.ratioSize(ratio);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const { ops } = Layouts.build(doc, size, measure);
    await paint(canvas, ops, cache);

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `framework-${slug(doc.headline)}-${ratio.replace(':', 'x')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
```

The export button stays disabled until `fontsReady()` resolves, with the label
"Preparing fonts…" until then. Shipping an export in Helvetica is invisible until the
post is public, which is why this gate exists.

- [ ] **Step 2: Verify the exports**

Click export. Open the three files.
Expected: exactly 1080×1080, 1080×1350, 1080×1920; correct typefaces; each file's pixels
match its on-screen preview.

- [ ] **Step 3: Verify preview and export are identical**

In the console, render the 4:5 preview, read its `toDataURL()`, then run the export path
for 4:5 into an offscreen canvas and read that `toDataURL()`.
Expected: byte-identical strings. This is the tool's core promise; assert it rather than
eyeball it.

- [ ] **Step 4: Commit** *(hold — see Global Constraints)*

```bash
git add assets/post/app.js
git commit -m "feat(post): export three Instagram sizes in one action"
```

---

### Task 7: Ship

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the full test suite**

Run: `node --test test/`
Expected: PASS, no skips.

- [ ] **Step 2: Document the tool in `README.md`**

Add a `## Post generator` section: what `/post-generator` is, the document model, how to
add a layout (write a function, add its name to `LAYOUTS`, add a case to the test that
iterates every layout), how to run the tests, and the note that it is unlinked, noindexed
and disallowed in `robots.txt` — and that on a static site this is obscurity, not
protection, so real access control has to be enforced at the edge.

- [ ] **Step 3: Deploy**

Run: `npx --yes vercel@latest --prod --yes`
Expected: `readyState: READY`, `target: production`.

- [ ] **Step 4: Verify live**

Check `/post-generator` returns 200, `/robots.txt` returns 200 with both Disallow lines,
and that the marketing site still works — the block art on `/` must be unchanged, since
this task touched none of it.
Expected: all green; a live export produces the three correct files.

- [ ] **Step 5: Commit** *(hold — see Global Constraints)*

```bash
git add README.md
git commit -m "docs: post generator"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Document model, defaults, seed rule | 1 |
| `state.js` API, encode/decode, localStorage | 1 |
| Unit scale, type scale, overflow | 2 |
| Four layouts | 2, 3 |
| `layouts.js` purity, injected `measure` | 2 (interface), 4 (browser impl) |
| Ops interface | 2 (produced), 4 (consumed) |
| `render.js`, art cache, WebGL + SVG fallback | 4 |
| Editor, three ratios visible, warnings | 5 |
| Preview-is-export | 5 (canvas sizing), 6 (asserted identical) |
| Draft, share URL, MAX_URL_CHARS | 5 |
| Export sizes, filenames, sequential | 6 |
| Fonts-not-loaded gate | 6 |
| No WebGL | 4 |
| Malformed URL, blocked localStorage | 1 (logic), 5 (verified) |
| Testing | 1, 2, 3, 7 |
| Login: noindex, robots.txt, standalone | 5, 7 |

No gaps.

**Placeholder scan:** none. Every step names its files, shows its code, and states its
expected result.

**Type consistency:** `build(doc, size, measure)` returns `{ ops, warnings }` in Tasks 2,
3, 5 and 6. Op shapes declared in Task 2 are consumed unchanged in Task 4. `createMeasure`,
`createCache`, `paint`, `fontsReady` are named identically in Tasks 4, 5 and 6.
`State.RATIOS` and `State.ratioSize` from Task 1 are used under those names throughout.
One deliberate correction carried into Task 4: theme is passed via `cache.theme` rather
than sniffed from the ops array.
