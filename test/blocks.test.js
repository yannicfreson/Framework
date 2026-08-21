const test = require('node:test');
const assert = require('node:assert');
const Blocks = require('../assets/blocks.js');

function viewBox(markup) {
  return markup.match(/viewBox="([^"]+)"/)[1];
}

test('a pose draws the same solids as the composition it turns', () => {
  assert.deepStrictEqual(Blocks.boxes('mark-loose'), Blocks.boxes('mark'));
});

test('a pose frames identically to the composition it turns', () => {
  // Same sculpture, same box on screen — the whole point of a pose. If these drift, a
  // post switching between the two ends of the hero's cycle would jump size.
  assert.deepStrictEqual(Blocks.framingFor('mark-loose'), Blocks.framingFor('mark'));
  assert.strictEqual(
    viewBox(Blocks.svg({ composition: 'mark-loose', ratio: '1:1' })),
    viewBox(Blocks.svg({ composition: 'mark', ratio: '1:1' }))
  );
});

test('a pose is drawn turned, not at rest', () => {
  // The angle is the far end of the hero's own turn, so the still is the frame the hero
  // opens on rather than a number that merely used to match it.
  assert.strictEqual(Blocks.poseYaw('mark-loose'), Blocks.framingFor('mark').yawRange[1]);
  assert.strictEqual(Blocks.poseYaw('mark'), 0);
  assert.notStrictEqual(
    Blocks.svg({ composition: 'mark-loose', ratio: '1:1' }),
    Blocks.svg({ composition: 'mark', ratio: '1:1' })
  );
});

test('an explicit yaw overrides the pose, and zero means at rest', () => {
  assert.strictEqual(
    Blocks.svg({ composition: 'mark-loose', ratio: '1:1', yaw: 0 }),
    Blocks.svg({ composition: 'mark', ratio: '1:1' })
  );
});

test('every solid keeps three faces and its cast at any angle', () => {
  // Turning a box takes it off the grid, so the visible faces stop being a constant and
  // become a dot product. Nine bars, three faces each, plus nine casts.
  for (const yaw of [0, 0.3, 0.7, 1.25, 2.4, -1.1]) {
    const markup = Blocks.svg({ composition: 'mark', ratio: '1:1', yaw });
    const faces = markup.match(/fill="url\(#fw-hatch-(top|left|right)\)"/g) || [];
    const casts = markup.match(/fill="url\(#fw-hatch-cast\)"/g) || [];
    assert.strictEqual(faces.length, 27, `faces at yaw ${yaw}`);
    assert.strictEqual(casts.length, 9, `casts at yaw ${yaw}`);
  }
});

test('the frame is centred on the solids across, not on their shadow', () => {
  // A cast leans hard to one side, so counting it in the width pushed the objects off to
  // the left of their own picture — a fifth of the frame for `gate`.
  for (const name of Blocks.compositions) {
    const box = (opts) => viewBox(Blocks.svg(Object.assign(
      { composition: name, ratio: 'auto', padding: 1 }, opts))).split(' ').map(Number);

    const framed = box({});
    const solids = box({ shadow: false });
    const centre = (b) => b[0] + b[2] / 2;

    assert.ok(Math.abs(centre(framed) - centre(solids)) < 0.2,
      `${name}: solids sit ${(centre(solids) - centre(framed)).toFixed(0)} off centre`);
    assert.ok(Math.abs(framed[2] - solids[2]) < 0.2, `${name}: width still holds the cast`);
  }
});

test('the frame still holds the resting shadow downwards', () => {
  // Only the width stopped counting the cast. Height still does, or a composition would
  // stand on the very bottom edge of its own frame.
  const framed = viewBox(Blocks.svg({ composition: 'gate', ratio: 'auto', padding: 1 })).split(' ').map(Number);
  const solids = viewBox(Blocks.svg({ composition: 'gate', ratio: 'auto', padding: 1, shadow: false })).split(' ').map(Number);
  assert.ok(framed[3] > solids[3], 'height should still make room for the cast');
});
