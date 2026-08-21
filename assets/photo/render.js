/* Framework — photo engraving.
 *
 * Takes a photograph and re-inks it with the same screen the sculptures use, so a
 * portrait can sit next to a block composition without either looking pasted in.
 *
 * Two stages, and the split is deliberate:
 *
 *   1. A 2D canvas crops the photo to the frame and prepares the tone — grey, exposure,
 *      contrast, and a blur. Photographs carry noise and detail that the blocks simply do
 *      not have; hatch a raw photo and the lines break up into speckle. Softening first is
 *      what turns a face into the handful of broad tones an engraving can actually hold.
 *
 *   2. A WebGL pass turns tone into ink, using `INK` from assets/engrave.js — the same
 *      source the sculptures' post pass compiles. A mid grey draws the same line here as
 *      it does on the side of a block, because it is the same line.
 *
 * There is no three.js here. This page renders no geometry, and the engraving is one
 * full-screen fragment shader.
 */
import { INK, STYLES, scaleFor } from '../engrave.js';

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSource;
uniform vec2 uTexel;
uniform float uScale;
uniform int uStyle;
uniform float uContour;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uBlack;
uniform float uWhite;
uniform float uMidtone;
uniform float uInvert;

${INK}

// The canvas handed us sRGB bytes, so this is already a tone — no linear conversion, the
// step the sculptures need and a photograph does not. Rec. 709 weights.
//
// Then levels, which is the whole job. A block face arrives at whatever tone the key light
// made it and the screen is built around that range; a photograph arrives with a black
// background, a blown highlight and everything that matters squeezed into the middle. The
// black and white points say which part of that range the engraving gets to use, and the
// midtone says where in it a face should sit. Without them a dark portrait engraves as a
// solid field of cross-hatch, which is a true reading of the pixels and a useless picture.
float tone(vec2 uv) {
  vec3 c = texture2D(tSource, uv).rgb;
  float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
  L = clamp((L - uBlack) / max(uWhite - uBlack, 0.02), 0.0, 1.0);
  L = pow(L, uMidtone);
  // On a dark page the ink is light, so coverage has to run the other way or the portrait
  // comes out a negative: a lit face would take no ink and read as a hole. The sculptures
  // behave the same — a block's top face stays the brightest thing on the post whichever
  // ground it sits on, because only the page changed colour, not the light.
  return uInvert > 0.5 ? 1.0 - L : L;
}

// Where the tone turns a corner. The sculptures get their contour free, because the flat
// renderer strokes every face edge; a photograph has no edges to stroke, so the darkest
// gradients stand in for them and give the engraving something to hold on to.
float contour() {
  float c = tone(vUv);
  float best = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = i == 0 ? vec2(uTexel.x, 0.0)
           : i == 1 ? vec2(-uTexel.x, 0.0)
           : i == 2 ? vec2(0.0, uTexel.y)
                    : vec2(0.0, -uTexel.y);
    best = max(best, abs(tone(vUv + o * uScale) - c));
  }
  return best;
}

void main() {
  float L = tone(vUv);
  vec2 p = gl_FragCoord.xy;

  float laid;
  if (uStyle == 0) laid = 1.0 - L;
  else if (uStyle == 1) laid = 1.0 - posterise(L);
  else laid = ink(uStyle, L, p, uScale);

  if (uContour > 0.0) laid = max(laid, step(0.055 / uContour, contour()));

  gl_FragColor = vec4(mix(uPaper, uInk, clamp(laid, 0.0, 1.0)), 1.0);
}
`;

/* ---------- Tone stage ---------- */

// The frame is filled the way `object-fit: cover` fills a box, then panned and zoomed
// within it. Cover rather than contain because a portrait with letterbox bars either side
// is not a portrait — and because the crop is the point of the framing controls.
export function coverRect(image, width, height, zoom, focusX, focusY) {
  const scale = Math.max(width / image.width, height / image.height) * zoom;
  const w = image.width * scale;
  const h = image.height * scale;
  return {
    x: (width - w) * focusX,
    y: (height - h) * focusY,
    w,
    h
  };
}

// Softening is expressed against the same reference height as the hatch pitch, so a
// 200px thumbnail and a 1600px export carry the same amount of blur relative to the
// lines — otherwise the preview lies about what the export will look like.
function prepare(image, doc, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);

  const scale = scaleFor(height);
  const blur = (doc.smooth / 100) * 6 * scale;

  // Grey and blur only. Levels belong in the shader, where the arithmetic is exactly the
  // arithmetic and not whatever the browser means by `contrast()` — and where the same
  // numbers can be read back off this canvas to fit them automatically.
  ctx.filter = 'grayscale(1)' + (blur > 0.05 ? ` blur(${blur.toFixed(2)}px)` : '');

  // Drawn a touch outside the frame so the blur pulls in real pixels at the edges rather
  // than fading into the grey ground and drawing a border that is not in the photograph.
  const r = coverRect(image, width, height, doc.zoom / 100, doc.x / 100, doc.y / 100);
  const bleed = Math.ceil(blur * 2);
  ctx.drawImage(image, r.x - bleed, r.y - bleed, r.w + bleed * 2, r.h + bleed * 2);
  ctx.filter = 'none';

  return canvas;
}

/* ---------- Ink stage ---------- */

let gl = null;
let program = null;
let uniforms = null;
let texture = null;

// Built once and cached — but only cached once it is whole. Assigning the context before
// the shader compiles is what turned a compile error into a null-uniform crash three calls
// later: the second call saw a context and returned it, and `supported()` cheerfully said
// yes. Nothing is published to the module until all of it worked.
let failure = null;

function build() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
  if (!ctx) throw new Error('no WebGL context');

  const compile = (type, source) => {
    const shader = ctx.createShader(type);
    ctx.shaderSource(shader, source);
    ctx.compileShader(shader);
    if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
      throw new Error(ctx.getShaderInfoLog(shader));
    }
    return shader;
  };

  const prog = ctx.createProgram();
  ctx.attachShader(prog, compile(ctx.VERTEX_SHADER, VERTEX));
  ctx.attachShader(prog, compile(ctx.FRAGMENT_SHADER, FRAGMENT));
  ctx.linkProgram(prog);
  if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
    throw new Error(ctx.getProgramInfoLog(prog));
  }
  ctx.useProgram(prog);

  const quad = ctx.createBuffer();
  ctx.bindBuffer(ctx.ARRAY_BUFFER, quad);
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
  const aPos = ctx.getAttribLocation(prog, 'aPos');
  ctx.enableVertexAttribArray(aPos);
  ctx.vertexAttribPointer(aPos, 2, ctx.FLOAT, false, 0, 0);

  const found = {};
  const names = ['tSource', 'uTexel', 'uScale', 'uStyle', 'uContour', 'uPaper', 'uInk',
    'uBlack', 'uWhite', 'uMidtone', 'uInvert'];
  for (const name of names) {
    found[name] = ctx.getUniformLocation(prog, name);
  }

  const tex = ctx.createTexture();
  ctx.bindTexture(ctx.TEXTURE_2D, tex);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR);
  ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR);

  gl = ctx;
  program = prog;
  uniforms = found;
  texture = tex;
  return gl;
}

function context() {
  if (gl) return gl;
  if (failure) return null;
  try {
    return build();
  } catch (e) {
    failure = String(e.message || e).replace(/\u0000/g, '').trim();
    return null;
  }
}

export function supported() {
  return !!context();
}

// Why it is unsupported, for the page to say out loud. A driver refusing to compile and a
// browser with no WebGL at all are not the same problem and should not read the same.
export function unsupportedReason() {
  context();
  return failure;
}

function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Paper and ink both come from the post generator's palette, so a portrait dropped into a
// post sits on exactly the ground the post is already painted with.
export const GROUNDS = {
  paper: { paper: '#F5F4F1', ink: '#16171A', invert: false },
  ink: { paper: '#16171A', ink: '#F5F4F1', invert: true }
};

/* ---------- Draw ---------- */

// Engraves `image` into `canvas` at the canvas's own backing size. The canvas is the
// export: what a preview shows at 300px is what a 1440px file will hold, only smaller.
export function engrave(canvas, image, doc) {
  const width = canvas.width;
  const height = canvas.height;
  const source = prepare(image, doc, width, height);
  const ctx = canvas.getContext('2d');
  const ground = GROUNDS[doc.theme] || GROUNDS.paper;

  if (!supported()) {
    // No WebGL: the prepared tone is still a true crop at true exposure, so the tool
    // stays usable and only the screen is missing.
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0);
    if (ground.invert) {
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'source-over';
    }
    return false;
  }

  gl.canvas.width = width;
  gl.canvas.height = height;
  gl.viewport(0, 0, width, height);

  gl.bindTexture(gl.TEXTURE_2D, texture);
  // A canvas hands its rows over top-down and GL reads them bottom-up, so without this the
  // portrait engraves upside down. three.js sets flipY on every texture it makes, which is
  // why the sculptures never showed it and this did the moment it stopped using three.
  //
  // Flipping the upload rather than the coordinates is deliberate: gl_FragCoord then still
  // runs bottom-up exactly as it does in the sculpture pass, so the hatch leans the same
  // way across both. Flipping in the shader would have mirrored the screen instead.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

  gl.uniform1i(uniforms.tSource, 0);
  gl.uniform2f(uniforms.uTexel, 1 / width, 1 / height);
  gl.uniform1f(uniforms.uScale, scaleFor(height) * (doc.pitch / 100));
  gl.uniform1i(uniforms.uStyle, Math.max(0, STYLES.indexOf(doc.style)));
  gl.uniform1f(uniforms.uContour, doc.contour ? 1 : 0);
  gl.uniform3fv(uniforms.uPaper, rgb(ground.paper));
  gl.uniform3fv(uniforms.uInk, rgb(ground.ink));
  gl.uniform1f(uniforms.uBlack, doc.black / 100);
  gl.uniform1f(uniforms.uWhite, doc.white / 100);
  // Inverted on the way in, so the slider reads like the gamma control in any photo editor:
  // drag right and the midtones open up. Left of 100 closes them down.
  gl.uniform1f(uniforms.uMidtone, 100 / Math.max(1, doc.midtone));
  gl.uniform1f(uniforms.uInvert, ground.invert ? 1 : 0);

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(gl.canvas, 0, 0);
  return true;
}

/* ---------- Fitting the levels to a photograph ---------- */

// Reads the tone the crop actually contains and reports the black and white points that
// would use all of it. Percentiles rather than the extremes: one blown specular highlight
// or one truly black pixel would otherwise decide the whole range and nothing would move.
export function fitLevels(image, doc, lowPercentile = 0.02, highPercentile = 0.985) {
  const probe = prepare(image, doc, 120, Math.round(120 * 4 / 3));
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, probe.width, probe.height).data;

  const histogram = new Uint32Array(256);
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) histogram[data[i]]++;

  const at = (fraction) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += histogram[v];
      if (seen >= total * fraction) return v / 255 * 100;
    }
    return 100;
  };

  const black = at(lowPercentile);
  const white = at(highPercentile);
  // A flat photograph — a wall, an over-exposed frame — can report a range too narrow to
  // stretch without turning noise into structure. Refuse rather than wreck it.
  if (white - black < 8) return null;
  return { black: Math.round(black), white: Math.round(white) };
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read ' + file.name)); };
    image.src = url;
  });
}
