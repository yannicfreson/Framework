/* Framework — post document model.
 *
 * One plain object describes a post completely: it is the draft in localStorage, the
 * payload in the share URL, and the only input to rendering. Nothing else holds state.
 *
 * Pure and UMD-wrapped, matching assets/blocks.js, so it loads unchanged in Node (for
 * tests) and in the browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrameworkPostState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LAYOUTS = ['headline-above', 'split', 'art-full', 'statement'];
  var THEMES = ['paper', 'ink'];
  var RATIOS = ['1:1', '4:5', '9:16'];

  // Read the named sculptures from blocks.js when it is loaded, so adding one there
  // reaches the post generator without a second edit here. The literal is the fallback
  // for Node, where blocks.js is a CommonJS module rather than a global — a test keeps
  // the two in step.
  var NAMED = (typeof FrameworkBlocks !== 'undefined' && FrameworkBlocks.compositions)
    ? FrameworkBlocks.compositions.slice()
    : ['mark', 'mark-loose', 'stack', 'row', 'tower', 'gate'];

  // 'random' is deliberately appended and is deliberately absent from
  // FrameworkBlocks.compositions, which lists only the named sculptures.
  var COMPOSITIONS = NAMED.concat(['random']);

  var LIMITS = { eyebrow: 60, headline: 120, footer: 60 };
  var MAX_URL_CHARS = 1800;
  var STORAGE_KEY = 'framework-post-draft';

  var SIZES = {
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 },
    '9:16': { width: 1080, height: 1920 }
  };

  function defaults() {
    return {
      v: 1,
      layout: 'headline-above',
      theme: 'paper',
      eyebrow: 'Framework',
      headline: '',
      footer: 'framework.studio',
      art: { composition: 'stack', seed: null },
      preview: '4:5'
    };
  }

  function ratioSize(ratio) {
    var size = SIZES[ratio] || SIZES['4:5'];
    return { width: size.width, height: size.height };
  }

  /* ---------- Validation ---------- */

  function pick(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function clamp(value, limit, fallback) {
    if (typeof value !== 'string') return fallback;
    return value.slice(0, limit);
  }

  // The only way a document enters the system — from defaults, from storage, or from a
  // URL. Anything malformed becomes a valid document rather than an exception.
  function normalise(raw) {
    var base = defaults();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    var art = (raw.art && typeof raw.art === 'object' && !Array.isArray(raw.art)) ? raw.art : {};
    var composition = pick(art.composition, COMPOSITIONS, base.art.composition);
    var seed = parseInt(art.seed, 10);
    if (!isFinite(seed)) seed = null;

    // A null seed would make blocks.js fall back to seed 1, so a shared "random" post
    // would reproduce as a different sculpture for the recipient than the author saw.
    if (composition === 'random' && seed === null) seed = Math.floor(Math.random() * 1e6);

    return {
      v: 1,
      layout: pick(raw.layout, LAYOUTS, base.layout),
      theme: pick(raw.theme, THEMES, base.theme),
      eyebrow: clamp(raw.eyebrow, LIMITS.eyebrow, base.eyebrow),
      headline: clamp(raw.headline, LIMITS.headline, base.headline),
      footer: clamp(raw.footer, LIMITS.footer, base.footer),
      art: { composition: composition, seed: seed },
      preview: pick(raw.preview, RATIOS, base.preview)
    };
  }

  /* ---------- URL encoding ---------- */

  var SHORT = {
    v: 'v', layout: 'l', theme: 't', eyebrow: 'e',
    headline: 'h', footer: 'f', composition: 'c', seed: 's', preview: 'p'
  };

  // btoa is byte-oriented and would mangle anything outside Latin-1 — the middot in
  // "Framework · Studio" alone breaks it — so text goes through UTF-8 encoding first.
  function toBase64(text) {
    if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function fromBase64(encoded) {
    if (typeof Buffer !== 'undefined') return Buffer.from(encoded, 'base64').toString('utf8');
    var binary = atob(encoded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function urlSafe(b64) {
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function urlUnsafe(text) {
    return text.replace(/-/g, '+').replace(/_/g, '/');
  }

  function encode(doc) {
    var d = normalise(doc);
    var packed = {};
    packed[SHORT.v] = d.v;
    packed[SHORT.layout] = d.layout;
    packed[SHORT.theme] = d.theme;
    packed[SHORT.eyebrow] = d.eyebrow;
    packed[SHORT.headline] = d.headline;
    packed[SHORT.footer] = d.footer;
    packed[SHORT.composition] = d.art.composition;
    packed[SHORT.seed] = d.art.seed;
    packed[SHORT.preview] = d.preview;
    return urlSafe(toBase64(JSON.stringify(packed)));
  }

  function decode(text) {
    if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
    try {
      var packed = JSON.parse(fromBase64(urlUnsafe(text)));
      if (!packed || typeof packed !== 'object' || Array.isArray(packed)) return null;
      return normalise({
        v: packed[SHORT.v],
        layout: packed[SHORT.layout],
        theme: packed[SHORT.theme],
        eyebrow: packed[SHORT.eyebrow],
        headline: packed[SHORT.headline],
        footer: packed[SHORT.footer],
        art: { composition: packed[SHORT.composition], seed: packed[SHORT.seed] },
        preview: packed[SHORT.preview]
      });
    } catch (e) {
      return null;
    }
  }

  /* ---------- Draft ---------- */

  function save(doc) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalise(doc)));
    } catch (e) {
      /* private window, or storage disabled — the tool works without a draft */
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
    LAYOUTS: LAYOUTS,
    THEMES: THEMES,
    RATIOS: RATIOS,
    COMPOSITIONS: COMPOSITIONS,
    LIMITS: LIMITS,
    MAX_URL_CHARS: MAX_URL_CHARS,
    defaults: defaults,
    normalise: normalise,
    encode: encode,
    decode: decode,
    save: save,
    load: load,
    ratioSize: ratioSize
  };
});
