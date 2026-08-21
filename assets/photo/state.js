/* Framework — photo stylizer document model.
 *
 * Two plain objects, and the split between them is the whole design.
 *
 * The **look** is one document shared by every photo in the session: screen, ground,
 * levels, softening, line pitch. Five portraits of five people are only a set if they
 * were treated identically, so there is deliberately nowhere to put a per-photo exposure.
 * It persists to localStorage, which is how the sixth person photographed next month
 * gets the same treatment as the first five.
 *
 * The **frame** is per photo — zoom and focal point — because a face is never in the same
 * place twice and cropping is not a look.
 *
 * Pure and UMD-wrapped, matching assets/post/state.js, so it loads unchanged in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrameworkPhotoState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Mirrors engrave.js, which owns the screens. Node cannot import an ES module from a
  // UMD one, so this is a literal — and a test asserts the two match, the same guard the
  // post generator keeps over its composition list.
  var STYLES = ['plain', 'cel', 'hatch', 'halftone', 'dither'];
  var THEMES = ['paper', 'ink'];

  // 3:4 first and by default: it is what `.member__photo` on the site already is, so a
  // portrait exported here drops into the team grid without being re-cropped by CSS.
  var RATIOS = ['3:4', '1:1', '4:5'];

  var SIZES = {
    '3:4': { width: 1080, height: 1440 },
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 }
  };

  // Every slider, with the range it is allowed and what it means. One table so the UI, the
  // clamping and the tests cannot disagree about what a legal document is.
  var SLIDERS = {
    black: { min: 0, max: 90, step: 1, label: 'Black point' },
    white: { min: 10, max: 100, step: 1, label: 'White point' },
    midtone: { min: 40, max: 250, step: 5, label: 'Midtone' },
    smooth: { min: 0, max: 100, step: 1, label: 'Softening' },
    pitch: { min: 50, max: 250, step: 5, label: 'Line pitch' }
  };

  var FRAME = {
    zoom: { min: 100, max: 400, step: 1 },
    x: { min: 0, max: 100, step: 0.1 },
    y: { min: 0, max: 100, step: 0.1 }
  };

  var STORAGE_KEY = 'framework-photo-look';

  function defaults() {
    return {
      v: 1,
      style: 'hatch',
      theme: 'paper',
      ratio: '3:4',
      // A photograph arrives with far more tonal range than an engraving can hold, so the
      // levels start well inside it — clipping both ends is what gives the screen a range
      // it can actually draw. Fit levels to this photo replaces the two with what the
      // picture in hand contains.
      //
      // Softening starts off. It is the control most worth reaching for on a noisy or
      // high-detail photograph, where hatching the raw pixels breaks the lines into
      // speckle, but starting at zero shows the photograph as it is and leaves the
      // blurring a decision rather than something already done to it.
      black: 15,
      white: 85,
      midtone: 100,
      smooth: 0,
      pitch: 100,
      contour: false
    };
  }

  function defaultFrame() {
    return { zoom: 100, x: 50, y: 50 };
  }

  function ratioSize(ratio) {
    var size = SIZES[ratio] || SIZES['3:4'];
    return { width: size.width, height: size.height };
  }

  /* ---------- Validation ---------- */

  function pick(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function number(value, range, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback;
    return Math.min(range.max, Math.max(range.min, n));
  }

  // The only way a look enters the system. Anything malformed becomes a valid document
  // rather than an exception — a stored draft from an older version included.
  function normalise(raw) {
    var base = defaults();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    var out = {
      v: 1,
      style: pick(raw.style, STYLES, base.style),
      theme: pick(raw.theme, THEMES, base.theme),
      ratio: pick(raw.ratio, RATIOS, base.ratio),
      contour: raw.contour === true
    };

    Object.keys(SLIDERS).forEach(function (key) {
      out[key] = number(raw[key], SLIDERS[key], base[key]);
    });

    // A white point at or below the black point divides by nothing and flattens the
    // picture to one tone. Cheaper to make it impossible here than to guard in a shader.
    if (out.white <= out.black) {
      out.black = base.black;
      out.white = base.white;
    }

    return out;
  }

  function normaliseFrame(raw) {
    var base = defaultFrame();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    return {
      zoom: number(raw.zoom, FRAME.zoom, base.zoom),
      x: number(raw.x, FRAME.x, base.x),
      y: number(raw.y, FRAME.y, base.y)
    };
  }

  /* ---------- The stored look ---------- */

  function save(doc) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalise(doc)));
    } catch (e) {
      /* private window, or storage disabled — the tool works without a stored look */
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalise(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  return {
    STYLES: STYLES,
    THEMES: THEMES,
    RATIOS: RATIOS,
    SLIDERS: SLIDERS,
    FRAME: FRAME,
    defaults: defaults,
    defaultFrame: defaultFrame,
    normalise: normalise,
    normaliseFrame: normaliseFrame,
    ratioSize: ratioSize,
    save: save,
    load: load
  };
});
