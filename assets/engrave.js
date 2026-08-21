/* Framework — the engraving.
 *
 * How a tone becomes ink, and nothing else. One grey goes in, one coverage comes out:
 * 0 leaves the paper alone, 1 lays ink down. What counts as a tone in the first place is
 * the caller's business — a shaded block face, a pixel of a photograph — which is exactly
 * why this is a file of its own.
 *
 * It exists because there are now two things being engraved. `blocks3d.js` re-inks a
 * rendered sculpture; `photo/render.js` re-inks an uploaded portrait; and a portrait next
 * to a sculpture in the same post only holds together if a mid grey draws the same line in
 * both. Two copies of these functions would agree on the day they were written.
 *
 * Shipped as GLSL source rather than as JavaScript, because both callers run it on the
 * GPU over every pixel. `INK` is pasted into a fragment shader; it declares no uniforms
 * and reads no varyings, so it drops into any shader that can call it.
 */

// Index order is part of the contract: it is what both callers pass as `style`, and what
// the post document stores. Append, never reorder.
export const STYLES = ['plain', 'cel', 'hatch', 'halftone', 'dither'];

// The house treatment. Engraving lines at 135 degrees, the same angle as the striped
// panels the sculptures sit on, so art and backdrop share one texture.
export const DEFAULT_STYLE = 'hatch';

// Pattern units per pattern, at the reference size. A hatch line is 7 device pixels apart
// on a 700px-tall render, and callers scale from there so a thumbnail and a full-size
// export have the same apparent texture rather than the same pixel count.
export const REFERENCE_HEIGHT = 700;

export function scaleFor(heightInDevicePixels) {
  return Math.max(1, heightInDevicePixels / REFERENCE_HEIGHT);
}

export const INK = [
  '// ---- Framework engraving (assets/engrave.js) ----',
  '',
  '// Linear light to perceptual. Thresholds read against what the eye sees, not against',
  '// what the renderer stored, so anything arriving linear converts before it inks.',
  'float toSRGB(float c) {',
  '  return c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;',
  '}',
  '',
  '// Bit-reversed interleave of x and y — the standard ordered-dither matrix, in floats.',
  '// The integer % operator this was first written with is GLSL ES 3.00 and above; three.js',
  '// hid that by compiling the sculpture shader as 3.00 on a WebGL2 context, and it only',
  '// surfaced when a second caller compiled the same source as 1.00. A file whose whole',
  '// job is to drop into another shader has no business demanding a version of it.',
  'float bayer8(vec2 p) {',
  '  vec2 c = floor(mod(p, 8.0));',
  '  float b = 16.0 * (floor(c.y / 4.0) + 2.0 * floor(c.x / 4.0))',
  '          +  4.0 * (mod(floor(c.y / 2.0), 2.0) + 2.0 * mod(floor(c.x / 2.0), 2.0))',
  '          +        (mod(c.y, 2.0) + 2.0 * mod(c.x, 2.0));',
  '  return (b + 0.5) / 64.0;',
  '}',
  '',
  'vec2 spin(vec2 p, float a) {',
  '  float s = sin(a); float c = cos(a);',
  '  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);',
  '}',
  '',
  '// Line width grows as the tone darkens, which is the whole of it. Capped below a',
  '// full-width line so even the darkest passage keeps its gaps and reads as a dense',
  '// screen rather than a flat black fill — and past a third of the way down, a second',
  '// pass at the opposite angle closes it further.',
  'float hatchInk(float L, vec2 p, float scale) {',
  '  float pitch = 7.0 * scale;',
  '  float d = mod(dot(p, vec2(0.7071, -0.7071)), pitch);',
  '  float ink = step(d, min(1.0 - L, 0.80) * pitch);',
  '  if (L < 0.34) {',
  '    float d2 = mod(dot(p, vec2(0.7071, 0.7071)), pitch);',
  '    ink = max(ink, step(d2, ((0.34 - L) / 0.34) * pitch * 0.9));',
  '  }',
  '  return ink;',
  '}',
  '',
  'float halftoneInk(float L, vec2 p, float scale) {',
  '  float cell = 8.0 * scale;',
  '  vec2 g = spin(p, 0.7854) / cell;',
  '  vec2 c = fract(g) - 0.5;',
  '  float radius = min(sqrt(clamp(1.0 - L, 0.0, 1.0)), 0.94) * 0.56;',
  '  return step(length(c), radius);',
  '}',
  '',
  'float ditherInk(float L, vec2 p, float scale) {',
  '  return step(L, bayer8(p / max(scale, 1.0)));',
  '}',
  '',
  'float posterise(float L) {',
  '  return floor(clamp(L, 0.0, 0.999) * 4.0) / 3.0;',
  '}',
  '',
  '// Style indices match STYLES in engrave.js. 0 and 1 lay down no screen — they are',
  '// tone treatments, and their callers handle them before reaching here.',
  'float ink(int style, float L, vec2 p, float scale) {',
  '  return style == 2 ? hatchInk(L, p, scale)',
  '       : style == 3 ? halftoneInk(L, p, scale)',
  '       : style == 4 ? ditherInk(L, p, scale)',
  '                    : 0.0;',
  '}',
  '',
  '// ---- end engraving ----'
].join('\n');
