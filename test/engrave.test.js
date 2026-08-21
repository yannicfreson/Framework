const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOURCE = path.resolve('assets/engrave.js');

let loaded = null;

// engrave.js is an ES module of GLSL strings, so importing it is the parse check — a
// stray apostrophe inside a shader line is a syntax error in the module, and cost an
// afternoon once by surfacing as a null uniform three call frames away.
//
// The copy is the only way to get there: this repo has no package.json, so Node reads a
// bare .js as CommonJS and `import()` still refuses the `export` keyword. Copying the
// bytes to a .mjs changes nothing about them, and a syntax error is still a syntax error.
async function load() {
  if (loaded) return loaded;
  const copy = path.join(os.tmpdir(), `framework-engrave-${process.pid}.mjs`);
  fs.writeFileSync(copy, fs.readFileSync(SOURCE));
  try {
    loaded = await import('file://' + copy);
  } finally {
    fs.rmSync(copy, { force: true });
  }
  return loaded;
}

test('engrave.js parses, and its shader lines carry no stray quotes', async () => {
  const m = await load();
  assert.ok(m.INK.length > 500);
  assert.strictEqual((m.INK.match(/'/g) || []).length, 0, 'apostrophe inside the GLSL');
});

test('the ink source is valid GLSL ES 1.00', async () => {
  const m = await load();
  // Two callers compile this: three.js as 3.00 on a WebGL2 context, and the photo page as
  // 1.00 on a plain one. The lower bar is the one that has to hold.
  assert.ok(!/\bint\b[^;\n]*%|%\s*\d+\s*\*/.test(m.INK), 'integer % is 3.00 and above only');
  assert.ok(!/\btexture\s*\(/.test(m.INK), 'texture() is 3.00; use texture2D');
  assert.ok(!/\bin\s+vec|out\s+vec/.test(m.INK), 'in/out qualifiers are 3.00');

  const opens = (m.INK.match(/{/g) || []).length;
  const closes = (m.INK.match(/}/g) || []).length;
  assert.strictEqual(opens, closes, 'unbalanced braces');
});

test('every style has a branch in the dispatcher', async () => {
  const m = await load();
  // 'plain' and 'cel' are tone treatments the callers handle themselves; the rest must
  // each be reachable through ink(), or picking one would silently draw nothing.
  for (let i = 2; i < m.STYLES.length; i++) {
    assert.ok(m.INK.includes(`style == ${i}`), `${m.STYLES[i]} has no branch`);
  }
  assert.ok(m.INK.includes('float ink(int style'), 'dispatcher missing');
});

test('the reference scale is what both renderers key their texture off', async () => {
  const m = await load();
  assert.strictEqual(m.scaleFor(m.REFERENCE_HEIGHT), 1);
  assert.strictEqual(m.scaleFor(m.REFERENCE_HEIGHT * 2), 2);
  // Never below 1: a tiny thumbnail with a sub-pixel pitch is just grey mush.
  assert.strictEqual(m.scaleFor(10), 1);
});

test('blocks3d compiles the shared source rather than a copy of it', async () => {
  const blocks3d = fs.readFileSync('assets/blocks3d.js', 'utf8');
  assert.ok(/import \{[^}]*INK[^}]*\} from '\.\/engrave\.js'/.test(blocks3d));
  for (const name of ['hatchInk', 'halftoneInk', 'ditherInk', 'bayer8']) {
    assert.ok(!blocks3d.includes(`float ${name}(`), `${name} was copied back into blocks3d`);
  }
});
