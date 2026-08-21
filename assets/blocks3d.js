/* Framework — block art, rendered.
 *
 * Same sculptures as blocks.js, same (a, b, z) box data, but built in WebGL so the
 * solids cast real shadows on each other and on the ground.
 *
 * Lighting is deliberately brutal: one hard directional light, a floor of ambient just
 * high enough to keep the dark faces readable, unfiltered shadow maps so edges stay
 * knife-sharp, and nothing in the scene carrying colour. White solids, grey faces,
 * black shadows.
 *
 * The camera is orthographic and looks down the same isometric diagonal the SVG
 * projects with, so the 2D and 3D versions of a composition sit at the same angle.
 *
 * Every sculpture shares ONE WebGL context and blits into its own 2D canvas — browsers
 * drop the oldest context once a page holds a dozen or so, and a post builder will want
 * many previews on screen at once.
 *
 * Needs blocks.js loaded first — that module owns the geometry.
 *
 *   <script src="/assets/blocks.js"></script>
 *   <script type="module" src="/assets/blocks3d.js"></script>
 *   <fw-blocks-3d composition="tower" ratio="1:1" theme="ink"></fw-blocks-3d>
 *
 *   import { createSculpture, renderToDataURL } from '/assets/blocks3d.js';
 */
import * as THREE from './vendor/three-0.185.1/three.module.min.js';

/* ---------- Look ---------- */

var THEMES = {
  paper: {
    solid: 0xffffff,
    ambient: 0.33,
    key: 3.8,
    shadow: 0.72,     // opacity of the cast shadow on a transparent ground
    shadowInk: [0, 0, 0],
    ground: null      // null = let the page background show through
  },
  ink: {
    solid: 0xffffff,
    ambient: 0.40,
    key: 3.8,
    shadow: 0.62,
    // On a near-black ground a black shadow cannot be seen at any opacity, so the ink
    // theme lays its shadow down in grey instead. Physically odd, legible on stock.
    shadowInk: [0.42, 0.42, 0.42],
    ground: 0x16171A
  }
};

// True isometric: down the (1,1,1) diagonal, which is exactly what blocks.js projects
// with — its ground axes land at 30° on the page and all three axes foreshorten alike.
// The distinction matters more than it looks: (1,1,1) is the one direction a solid can
// travel without moving on screen, and the mark composition is built out of that.
var VIEW = new THREE.Vector3(1, 1, 1).normalize();

// Upper left on screen at ~42°, and — this is the part that matters — swung round so the
// three faces a box shows this camera each catch a different amount of it: the top full
// on, one side glancing, the other nothing but ambient. Point it at 45° between them and
// two of the three faces come out the same brightness and the form goes flat.
var KEY = new THREE.Vector3(-0.68, 0.669, 0.30).normalize();

// How much of the cast shadow the framing makes room for. Below 1 the tip runs off the
// edge, which keeps the solids large; at 1 the whole shadow is guaranteed in frame.
var SHADOW_ROOM = 0.42;

var MAX_PIXELS = 4096; // guard against absurd canvas sizes

// Shadow maps are sized to the output, not fixed at maximum. A 4096² depth texture is
// ~67MB, and a builder showing a dozen previews would hold one per sculpture.
function shadowResolution(pixels) {
  var wanted = Math.pow(2, Math.ceil(Math.log(Math.max(1, pixels) * 1.5) / Math.LN2));
  return Math.max(1024, Math.min(4096, wanted));
}

/* ---------- The one renderer ---------- */

var renderer = null;
var rendererFailed = false;

function getRenderer() {
  if (renderer || rendererFailed) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.shadowMap.enabled = true;
    // Unfiltered. PCF would round the shadow edges off, which is the whole thing we
    // do not want here.
    renderer.shadowMap.type = THREE.BasicShadowMap;
    renderer.setPixelRatio(1); // sizes are already in device pixels
  } catch (e) {
    rendererFailed = true;
    renderer = null;
  }
  return renderer;
}

var supportChecked = false;
var supportResult = false;

export function supported() {
  if (supportChecked) return supportResult;
  supportChecked = true;
  try {
    var probe = document.createElement('canvas');
    var gl = probe.getContext('webgl2') || probe.getContext('webgl');
    supportResult = !!gl;
    // Hand the context straight back — probes count against the browser's cap too.
    if (gl && gl.getExtension) {
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) {
    supportResult = false;
  }
  return supportResult;
}

/* ---------- Stylised output ---------- */

// Everything below is a screen-space treatment of the straight render: the scene goes to
// a render target, then one full-screen pass re-inks it. Working in screen space is what
// lets a shadow become a dot screen or a set of hatch lines rather than a flat fill.
//
// The alpha channel carries the structure the pass needs: 1 is a solid, anything between
// is cast shadow on transparent ground, 0 is empty. So a solid can be re-inked opaquely
// while a shadow keeps its gaps and lets the page through.

var STYLES = ['plain', 'cel', 'hatch', 'halftone', 'dither'];

// Hatch is the house treatment: engraving lines at the same 135 degrees as the striped
// panels the sculptures sit on, so art and backdrop share one texture. The others stay
// available per call for a post that wants something different.
var DEFAULT_STYLE = 'hatch';

// Which treatments ink a contour unless told otherwise. Hatch is on the list because the
// flat SVG strokes every face edge, and the two renderers have to agree.
var OUTLINED = { cel: true, hatch: true };

var POST_VERTEX = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}'
].join('\n');

var POST_FRAGMENT = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D tSource;',
  'uniform vec2 uTexel;',
  'uniform float uScale;',   // device pixels per pattern unit, keeps texture size stable
  'uniform int uStyle;',
  'uniform float uOutline;',
  'uniform vec3 uShadowInk;',
  '',
  '// The render target is linear; thresholds read better against perceptual values.',
  'float toSRGB(float c) {',
  '  return c < 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;',
  '}',
  '',
  'float luma(vec4 texel) {',
  '  return toSRGB(clamp(texel.r, 0.0, 1.0));',
  '}',
  '',
  'float bayer8(vec2 p) {',
  '  int x = int(mod(p.x, 8.0));',
  '  int y = int(mod(p.y, 8.0));',
  '  int i = y * 8 + x;',
  '  int b = 0;',
  '  // Bit-reversed interleave of x and y — the standard ordered-dither matrix.',
  '  int xi = x; int yi = y;',
  '  b += ((yi / 4) + (xi / 4) * 2) % 4 * 16;',
  '  b += (((yi / 2) % 2) + ((xi / 2) % 2) * 2) % 4 * 4;',
  '  b += ((yi % 2) + (xi % 2) * 2) % 4;',
  '  return (float(b) + 0.5) / 64.0;',
  '}',
  '',
  'vec2 spin(vec2 p, float a) {',
  '  float s = sin(a); float c = cos(a);',
  '  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);',
  '}',
  '',
  '// Line width grows as the tone darkens. 135 degrees, matching the stripe texture the',
  '// panels behind these sculptures already use.',
  'float hatchInk(float L, vec2 p) {',
  '  float pitch = 7.0 * uScale;',
  '  float d = mod(dot(p, vec2(0.7071, -0.7071)), pitch);',
  '  // Capped below a full-width line, so even the cast shadow keeps its gaps and reads',
  '  // as a dense screen rather than a flat black fill.',
  '  float ink = step(d, min(1.0 - L, 0.80) * pitch);',
  '  if (L < 0.34) {',
  '    float d2 = mod(dot(p, vec2(0.7071, 0.7071)), pitch);',
  '    ink = max(ink, step(d2, ((0.34 - L) / 0.34) * pitch * 0.9));',
  '  }',
  '  return ink;',
  '}',
  '',
  'float halftoneInk(float L, vec2 p) {',
  '  float cell = 8.0 * uScale;',
  '  vec2 g = spin(p, 0.7854) / cell;',
  '  vec2 c = fract(g) - 0.5;',
  '  float radius = min(sqrt(clamp(1.0 - L, 0.0, 1.0)), 0.94) * 0.56;',
  '  return step(length(c), radius);',
  '}',
  '',
  'float ditherInk(float L, vec2 p) {',
  '  return step(L, bayer8(p / max(uScale, 1.0)));',
  '}',
  '',
  'float posterise(float L) {',
  '  return floor(clamp(L, 0.0, 0.999) * 4.0) / 3.0;',
  '}',
  '',
  'float edge(vec2 uv) {',
  '  vec4 c = texture2D(tSource, uv);',
  '  float best = 0.0;',
  '  for (int i = 0; i < 4; i++) {',
  '    vec2 o = i == 0 ? vec2(uTexel.x, 0.0)',
  '           : i == 1 ? vec2(-uTexel.x, 0.0)',
  '           : i == 2 ? vec2(0.0, uTexel.y)',
  '                    : vec2(0.0, -uTexel.y);',
  '    vec4 n = texture2D(tSource, uv + o * uOutline);',
  '    best = max(best, abs(luma(n) - luma(c)) * step(0.5, min(n.a, c.a)));',
  '    best = max(best, abs(n.a - c.a));',
  '  }',
  '  return best;',
  '}',
  '',
  'void main() {',
  '  vec4 src = texture2D(tSource, vUv);',
  '  if (src.a < 0.02) discard;',
  '',
  '  bool solid = src.a > 0.9;',
  '  // Cast shadow is given a floor rather than pure black: at zero every screen fills',
  '  // solid and the texture vanishes precisely where it should be strongest.',
  '  float L = solid ? luma(src) : 0.14;',
  '  vec2 p = gl_FragCoord.xy;',
  '',
  '  if (uStyle == 0) {',
  '    gl_FragColor = vec4(vec3(luma(src)), src.a);',
  '    return;',
  '  }',
  '',
  '  if (uStyle == 1) {',
  '    float e = uOutline > 0.0 ? step(0.07, edge(vUv)) : 0.0;',
  '    vec3 tone = solid ? vec3(posterise(luma(src))) : uShadowInk;',
  '    gl_FragColor = vec4(mix(tone, vec3(0.0), e), max(src.a, e));',
  '    return;',
  '  }',
  '',
  '  float ink = uStyle == 2 ? hatchInk(L, p)',
  '            : uStyle == 3 ? halftoneInk(L, p)',
  '                          : ditherInk(L, p);',
  '',
  '  if (solid && uOutline > 0.0) ink = max(ink, step(0.07, edge(vUv)));',
  '',
  '  // A solid re-inks opaquely onto paper white; a shadow only lays down its ink and',
  '  // leaves the gaps clear, so the ground keeps showing through the texture.',
  '  if (solid) gl_FragColor = vec4(vec3(1.0 - ink), 1.0);',
  '  else if (ink > 0.5) gl_FragColor = vec4(uShadowInk, src.a);',
  '  else discard;',
  '}'
].join('\n');

var postScene = null;
var postCamera = null;
var postMaterial = null;
var target = null;

function getPost() {
  if (postMaterial) return postMaterial;
  postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postMaterial = new THREE.ShaderMaterial({
    vertexShader: POST_VERTEX,
    fragmentShader: POST_FRAGMENT,
    uniforms: {
      tSource: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uScale: { value: 1 },
      uStyle: { value: 0 },
      uOutline: { value: 0 },
      uShadowInk: { value: new THREE.Vector3(0, 0, 0) }
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending
  });
  postScene = new THREE.Scene();
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));
  return postMaterial;
}

function getTarget(w, h) {
  if (!target) {
    target = new THREE.WebGLRenderTarget(w, h, { samples: 4, stencilBuffer: false });
  } else if (target.width !== w || target.height !== h) {
    target.setSize(w, h);
  }
  return target;
}

/* ---------- Geometry ---------- */

function boxesFor(composition, seed) {
  if (Array.isArray(composition)) return composition;

  var FB = (typeof window !== 'undefined' && window.FrameworkBlocks) || null;
  if (!FB || typeof FB.boxes !== 'function') {
    throw new Error('blocks3d: load /assets/blocks.js first — it owns the geometry.');
  }
  return FB.boxes(composition, seed);
}

function parseRatio(ratio) {
  if (typeof ratio === 'number' && ratio > 0) return ratio;
  var parts = String(ratio || '3:4').split(':');
  var w = parseFloat(parts[0]);
  var h = parseFloat(parts[1]);
  return (w > 0 && h > 0) ? w / h : 3 / 4;
}

// blocks.js draws +a to the lower right and +b to the lower left. Under this camera
// world +x runs to the lower right and +z to the lower left, so a maps to x and b to z.
// Swapping the two mirrors every composition.
function buildSolids(boxes, material, shadows) {
  var group = new THREE.Group();

  boxes.forEach(function (box) {
    var z = box.z || 0;
    // A stacked box shares a plane with the one under it, which z-fights. Sink it.
    var sink = z > 0 ? 0.6 : 0;
    var geometry = new THREE.BoxGeometry(box.da, box.h + sink, box.db);
    var mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(box.a + box.da / 2, z + box.h / 2 - sink / 2, box.b + box.db / 2);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
  });

  return group;
}

/* ---------- Camera fitting ---------- */

// The eight corners of a Box3, as points.
function boxCorners(box3) {
  var corners = [];
  for (var i = 0; i < 8; i++) {
    corners.push(new THREE.Vector3(
      (i & 1) ? box3.max.x : box3.min.x,
      (i & 2) ? box3.max.y : box3.min.y,
      (i & 4) ? box3.max.z : box3.min.z
    ));
  }
  return corners;
}

// Every corner of every solid. A composition that only lines up from one angle leaves
// the corners of its bounding box empty, and framing on those would leave the art
// floating in the middle of a canvas half of which is nothing.
function solidCorners(boxes) {
  var corners = [];
  boxes.forEach(function (box) {
    var z = box.z || 0;
    for (var i = 0; i < 8; i++) {
      corners.push(new THREE.Vector3(
        box.a + ((i & 1) ? box.da : 0),
        z + ((i & 4) ? box.h : 0),
        box.b + ((i & 2) ? box.db : 0)
      ));
    }
  });
  return corners;
}

// Every corner of every solid at every sampled angle, so a sculpture that turns is
// framed for the whole turn rather than for the angle it happens to start at.
function turnedCorners(boxes, centre, yaws) {
  var base = solidCorners(boxes);
  var points = [];

  yaws.forEach(function (yaw) {
    var cos = Math.cos(yaw);
    var sin = Math.sin(yaw);

    base.forEach(function (corner) {
      var x = corner.x - centre.x;
      var z = corner.z - centre.z;
      points.push(new THREE.Vector3(
        x * cos + z * sin + centre.x,
        corner.y,
        -x * sin + z * cos + centre.z
      ));
    });
  });

  return points;
}

// Where those points land on the floor once the key pushes them, walked `room` of the
// way out. Used two ways, and the difference is deliberate: the camera frame takes the
// shadow only as it falls at rest, because a turning sculpture swings its shadow much
// further than it moves itself and reserving frame for all of that costs the letter a
// third of its width. The shadow map has to cover every angle, or a block stops casting
// halfway through the turn.
function floorPoints(points, room) {
  return points.map(function (point) {
    var floor = point.clone().addScaledVector(KEY, -point.y / KEY.y);
    return point.clone().lerp(floor, room);
  });
}

// Even samples across a yaw range. The widest the art ever reaches is not always at one
// of the ends, so walking the range beats taking the two extremes.
function yawSamples(range) {
  var from = 0;
  var to = 0;
  if (Array.isArray(range)) { from = range[0] || 0; to = range[1] || 0; }
  else if (typeof range === 'number') { to = range; }
  if (from === to) return [from];

  var steps = 8;
  var out = [];
  for (var i = 0; i <= steps; i++) out.push(from + (to - from) * (i / steps));
  return out;
}

// Frames an orthographic camera around a set of points — or a box — in that camera's
// own space, so an off-centre composition still sits centred in frame.
function fitOrtho(camera, target, aspect, pad) {
  var corners = Array.isArray(target) ? target : boxCorners(target);

  camera.updateMatrixWorld();
  var toCamera = camera.matrixWorldInverse;
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxDepth = 0;

  corners.forEach(function (corner) {
    var v = corner.clone().applyMatrix4(toCamera);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    maxDepth = Math.max(maxDepth, -v.z);
  });

  var w = (maxX - minX) * pad;
  var h = (maxY - minY) * pad;
  if (aspect) {
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
  }

  var cx = (minX + maxX) / 2;
  var cy = (minY + maxY) / 2;

  camera.left = cx - w / 2;
  camera.right = cx + w / 2;
  camera.top = cy + h / 2;
  camera.bottom = cy - h / 2;
  camera.near = 0.1;
  camera.far = maxDepth * 2 + 100;
  camera.updateProjectionMatrix();
}

/* ---------- Sculpture ---------- */

export function createSculpture(options) {
  var opt = options || {};
  var theme = typeof opt.theme === 'object' ? opt.theme : (THEMES[opt.theme] || THEMES.paper);
  var boxes = boxesFor(opt.composition || 'stack', opt.seed);
  var aspect = parseRatio(opt.ratio);
  var style = STYLES.indexOf(opt.style) >= 0 ? opt.style : DEFAULT_STYLE;
  var outline = opt.outline === true || (opt.outline !== false && OUTLINED[style] === true);

  var scene = new THREE.Scene();

  // Parity with <fw-blocks shadow="false">.
  var withShadow = opt.shadow !== false;

  var material = new THREE.MeshLambertMaterial({ color: theme.solid });
  var solids = buildSolids(boxes, material, withShadow);
  var pivot = new THREE.Group();
  pivot.add(solids);
  scene.add(pivot);

  // Centre the pivot on the composition so yaw turns it on the spot.
  var bounds = new THREE.Box3().setFromObject(solids);
  var centre = bounds.getCenter(new THREE.Vector3());
  solids.position.set(-centre.x, 0, -centre.z);
  pivot.position.set(centre.x, 0, centre.z);

  // A pose is a composition asked for at a fixed angle — `mark-loose` is the mark seen
  // from the far end of the hero's turn. The angle belongs to the name, so a still of it
  // comes out the same here as it does from the flat renderer. The hero still drives
  // setYaw itself.
  pivot.rotation.y = typeof opt.yaw === 'number' ? opt.yaw
    : ((window.FrameworkBlocks && window.FrameworkBlocks.poseYaw)
      ? window.FrameworkBlocks.poseYaw(opt.composition) : 0);

  var span = bounds.getSize(new THREE.Vector3()).length();

  // Framing defaults come from the composition itself, so every caller drawing `mark`
  // frames it the same way without having to know the numbers. The hero and the post
  // generator drifted apart precisely because those numbers lived at the call site.
  var framingDefaults = (window.FrameworkBlocks && window.FrameworkBlocks.framingFor)
    ? window.FrameworkBlocks.framingFor(opt.composition)
    : {};

  var room = typeof opt.shadowRoom === 'number' ? opt.shadowRoom
    : (typeof framingDefaults.shadowRoom === 'number' ? framingDefaults.shadowRoom : SHADOW_ROOM);
  var pad = typeof opt.padding === 'number' ? opt.padding
    : (typeof framingDefaults.padding === 'number' ? framingDefaults.padding : 1.06);
  var yaws = yawSamples(opt.yawRange !== undefined ? opt.yawRange : framingDefaults.yawRange);
  var turned = turnedCorners(boxes, centre, yaws);
  var framing = withShadow
    ? turned.concat(floorPoints(solidCorners(boxes), room))
    : turned;

  // The ground only ever carries shadow. A themed background is painted underneath on
  // the 2D canvas — keeping the WebGL pass transparent is what lets alpha mean
  // "solid vs cast shadow vs empty", which every stylised treatment reads.
  // Black is invisible on a near-black ground, so the ink theme lays its shadow down in
  // grey. Physically odd; legible on stock. Read once here, used by both the material
  // and the post pass so the plain and stylised paths agree.
  var shadowInk = theme.shadowInk || [0, 0, 0];

  var groundMaterial = null;
  var ground = null;
  if (withShadow) {
    groundMaterial = new THREE.ShadowMaterial({
      color: new THREE.Color(shadowInk[0], shadowInk[1], shadowInk[2]),
      opacity: theme.shadow
    });
    ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 8, span * 8), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  scene.add(new THREE.AmbientLight(0xffffff, theme.ambient));

  var key = new THREE.DirectionalLight(0xffffff, theme.key);
  key.position.copy(KEY).multiplyScalar(span * 2).add(centre);
  key.target.position.copy(centre);
  key.castShadow = withShadow;
  // normalBias trades shadow acne for light leaking through contact points. A one-bit
  // treatment turns any leak into a hard white wedge, so keep it small and lean on the
  // depth bias instead.
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.2;
  scene.add(key);
  scene.add(key.target);

  var camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  camera.position.copy(VIEW).multiplyScalar(span * 2).add(centre);
  camera.lookAt(centre);

  // The shadow map has to cover the whole cast, including the part the framing crops.
  // three re-points shadow.camera at the light and target every frame, so the frustum
  // has to be measured in THAT space, not in world space — a stand-in camera set up the
  // same way gives the numbers to copy across.
  var shadowBounds = new THREE.Box3()
    .setFromPoints(turned.concat(floorPoints(turned, 1)))
    .expandByScalar(span * 0.1);
  shadowBounds.min.y = Math.min(shadowBounds.min.y, -1);

  var lightCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  lightCamera.position.copy(key.position);
  lightCamera.lookAt(key.target.position);
  lightCamera.updateMatrixWorld();
  fitOrtho(lightCamera, shadowBounds, null, 1.05);

  var shadowCamera = key.shadow.camera;
  shadowCamera.left = lightCamera.left;
  shadowCamera.right = lightCamera.right;
  shadowCamera.top = lightCamera.top;
  shadowCamera.bottom = lightCamera.bottom;
  shadowCamera.near = lightCamera.near;
  shadowCamera.far = lightCamera.far;
  shadowCamera.updateProjectionMatrix();

  // Output surface. The shared WebGL canvas draws here, so several sculptures can be
  // on screen without each holding a context.
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');
  var width = 0;
  var height = 0;

  function setSize(cssWidth, cssHeight, pixelRatio) {
    var dpr = pixelRatio || Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.min(MAX_PIXELS, Math.round(cssWidth * dpr)));
    height = Math.max(1, Math.min(MAX_PIXELS, Math.round(cssHeight * dpr)));
    canvas.width = width;
    canvas.height = height;
    fitOrtho(camera, framing, width / height, pad);

    var resolution = shadowResolution(Math.max(width, height));
    if (key.shadow.mapSize.x !== resolution) {
      key.shadow.mapSize.set(resolution, resolution);
      if (key.shadow.map) {
        key.shadow.map.dispose();
        key.shadow.map = null;
      }
    }
  }

  function render() {
    var gl = getRenderer();
    if (!gl || !width || !height) return;

    gl.setSize(width, height, false);
    gl.setClearColor(0x000000, 0);

    if (style === 'plain' && !outline) {
      gl.setRenderTarget(null);
      gl.render(scene, camera);
    } else {
      var rt = getTarget(width, height);
      gl.setRenderTarget(rt);
      gl.clear(true, true, true);
      gl.render(scene, camera);

      var material = getPost();
      material.uniforms.tSource.value = rt.texture;
      material.uniforms.uTexel.value.set(1 / width, 1 / height);
      // Keeps a hatch line or a halftone dot the same apparent size whether this is a
      // thumbnail or a full-size post export.
      material.uniforms.uScale.value = Math.max(1, height / 700);
      material.uniforms.uStyle.value = Math.max(0, STYLES.indexOf(style));
      material.uniforms.uOutline.value = outline ? 1.5 : 0;
      material.uniforms.uShadowInk.value.set(shadowInk[0], shadowInk[1], shadowInk[2]);

      gl.setRenderTarget(null);
      gl.clear(true, true, true);
      gl.render(postScene, postCamera);
    }

    ctx.clearRect(0, 0, width, height);
    if (theme.ground !== null) {
      ctx.fillStyle = '#' + ('000000' + theme.ground.toString(16)).slice(-6);
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(gl.domElement, 0, 0, width, height);
  }

  setSize(opt.width || 600, opt.height || 800, opt.pixelRatio);

  return {
    canvas: canvas,
    scene: scene,
    camera: camera,
    setSize: setSize,
    render: render,

    // Turns the sculpture on the spot. Radians.
    setYaw: function (radians) { pivot.rotation.y = radians; },

    setStyle: function (next, wantOutline) {
      if (STYLES.indexOf(next) >= 0) style = next;
      outline = wantOutline === undefined ? OUTLINED[style] === true : !!wantOutline;
    },

    dispose: function () {
      solids.traverse(function (child) { if (child.geometry) child.geometry.dispose(); });
      if (ground) {
        ground.geometry.dispose();
        groundMaterial.dispose();
      }
      material.dispose();
      if (key.shadow.map) {
        key.shadow.map.dispose();
        key.shadow.map = null;
      }
    }
  };
}

/* ---------- Export for the social builder ---------- */

export function renderToDataURL(options) {
  var opt = options || {};
  var width = opt.width || 1080;
  var height = opt.height || 1080;

  var sculpture = createSculpture(Object.assign({}, opt, {
    ratio: opt.ratio || (width / height),
    width: width,
    height: height,
    pixelRatio: 1
  }));

  sculpture.render();

  var url = sculpture.canvas.toDataURL(opt.type || 'image/png');
  sculpture.dispose();
  return url;
}

export { THEMES as themes, STYLES as styles };

/* ---------- <fw-blocks-3d> ---------- */

if (typeof customElements !== 'undefined' && !customElements.get('fw-blocks-3d')) {
  class FwBlocks3D extends HTMLElement {
    static get observedAttributes() {
      return ['composition', 'ratio', 'theme', 'seed', 'label', 'style', 'outline', 'shadow'];
    }

    connectedCallback() {
      if (this.isConnected && !this._sculpture) this.build();
    }

    attributeChangedCallback() {
      if (!this.isConnected) return;
      this.teardown();
      this.build();
    }

    disconnectedCallback() { this.teardown(); }

    build() {
      if (!supported()) return;

      var seed = this.getAttribute('seed');
      try {
        this._sculpture = createSculpture({
          composition: this.getAttribute('composition') || 'stack',
          ratio: this.getAttribute('ratio') || '3:4',
          theme: this.getAttribute('theme') || 'paper',
          seed: seed === null ? undefined : parseInt(seed, 10),
          style: this.getAttribute('style') || 'plain',
          shadow: this.hasAttribute('shadow')
            ? this.getAttribute('shadow') !== 'false'
            : undefined,
          outline: this.hasAttribute('outline')
            ? this.getAttribute('outline') !== 'false'
            : undefined
        });
      } catch (e) {
        return;
      }

      var canvas = this._sculpture.canvas;
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label',
        this.getAttribute('label') || 'Abstract sculpture of stacked white blocks');

      this.innerHTML = '';
      this.appendChild(canvas);

      this._onResize = () => this.measure();
      window.addEventListener('resize', this._onResize);

      if (typeof ResizeObserver === 'function') {
        this._observer = new ResizeObserver(this._onResize);
        this._observer.observe(this);
      }

      this.measure();
    }

    measure() {
      if (!this._sculpture) return;
      var rect = this.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      this._sculpture.setSize(rect.width, rect.height);
      this._sculpture.render();
    }

    teardown() {
      if (this._onResize) window.removeEventListener('resize', this._onResize);
      if (this._observer) this._observer.disconnect();
      if (this._sculpture) this._sculpture.dispose();
      this._sculpture = null;
      this._observer = null;
      this._onResize = null;
    }
  }

  customElements.define('fw-blocks-3d', FwBlocks3D);
}
