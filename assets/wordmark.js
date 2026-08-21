/* Framework — the wordmark.
 *
 * Two variants of one thing:
 *
 *   mark   the F on its own, for a favicon, an avatar, any square
 *   full   FRAMEWORK, for the header and anywhere the name is set
 *
 * Three ways in, matching assets/blocks.js:
 *
 *   Browser, declarative
 *     <fw-wordmark variant="full" height="17"></fw-wordmark>
 *
 *   Browser or Node, programmatic
 *     FrameworkWordmark.svg({ variant: 'full' })   -> SVG string
 *     FrameworkWordmark.element({ variant: 'mark' })
 *
 *   Node, CLI
 *     node assets/wordmark.js --variant mark --ground '#F5F4F1' > assets/favicon.svg
 *
 * None of these letters were designed. The F already in the header is three straight
 * strokes on a grid with one deliberate gap, and every measurement below is taken off it:
 * the stroke is 0.1043 of the cap height, the crossbar sits 0.4348 down, and the bar
 * clears the stem by exactly two stroke widths. The other eight letters are those same
 * rules applied to eight more shapes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrameworkWordmark = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Taken off the mark ---------- */

  // The header F, normalised to a cap height of 100. Changing any of these four numbers
  // changes the logo; they are here rather than inline so that is obvious.
  var CAP = 100;
  var STROKE = 100 * 2.4 / 23;      // 10.4348
  var GAP = 2 * STROKE;             // the mark's one gesture, exactly two strokes
  var CLEAR = STROKE / 2 + GAP;     // 26.09 — stem centre-line to where a bar may begin
  var BAR = 100 * 10 / 23;          // 43.478 — the crossbar's height
  var MARK_W = 100 * 19 / 23;       // 82.61 — the mark's own width

  // The settled cut. Square corners, one advance per letter, tracked at 22. These are not
  // options: a logo with knobs on it is four logos.
  var SETTING = { cut: 0, track: 22, advance: 104 };

  var VARIANTS = ['mark', 'full'];
  var WORD = 'FRAMEWORK';

  /* ---------- Path helpers ---------- */

  function round(n) { return Number(n.toFixed(2)); }

  // Consecutive duplicate points appear the moment a chamfer is dialled to zero, and a
  // zero-length segment is a corner the renderer has no angle to mitre. Dropped here.
  function line() {
    var pts = Array.prototype.slice.call(arguments);
    var kept = pts.filter(function (p, i) {
      return i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1];
    });
    return 'M' + kept.map(function (p) { return round(p[0]) + ',' + round(p[1]); }).join(' L');
  }

  // Z returns to the first point and mitres that corner. Two butt-ended strokes meeting
  // there instead would leave a square hole one stroke wide — which is what O had.
  function ring() {
    var pts = Array.prototype.slice.call(arguments);
    var last = pts[pts.length - 1];
    if (last[0] === pts[0][0] && last[1] === pts[0][1]) pts = pts.slice(0, -1);
    return line.apply(null, pts) + ' Z';
  }

  // A stroke aimed at a stem but stopped CLEAR short of it. K's two arms, and nothing else.
  function toward(fx, fy, tx, ty) {
    var dx = tx - fx, dy = ty - fy;
    var len = Math.sqrt(dx * dx + dy * dy);
    var k = (len - CLEAR) / len;
    return line([fx, fy], [fx + dx * k, fy + dy * k]);
  }

  /* ---------- The letters ---------- */

  // `cut` is the 45-degree corner taken off a shoulder. The house setting is 0 — every
  // corner a right angle, like the flat faces of the block sculptures. It stays a
  // parameter because it is what the alternatives were, and a test still draws them.
  function letters(cut) {
    var c = cut;

    // A takes a deeper cut than the other shoulders, deep enough at higher settings that
    // its two strokes meet in an apex. Without it, A and M are the same arch and AM reads
    // as one blur. At the house setting both are square and the crossbar tells them apart.
    var cA = Math.min(38, c * 1.9);

    return {
      F: { w: MARK_W, d: [
            line([0, CAP], [0, 0], [MARK_W, 0]),
            line([CLEAR, BAR], [MARK_W, BAR])
          ] },

      // Bowl closes at a hard corner; the bar runs back towards the stem and stops short,
      // and the leg springs from the same corner. A stepped orthogonal leg reads as a P.
      R: { w: 80, d: [
            line([0, CAP], [0, 0], [58 - c, 0], [58, c], [58, 56]),
            line([CLEAR, 56], [58, 56]),
            line([58, 56], [80, CAP])
          ] },

      A: { w: 76, d: [
            cA >= 38
              ? line([0, CAP], [0, 38], [38, 0], [76, 38], [76, CAP])
              : line([0, CAP], [0, cA], [cA, 0], [76 - cA, 0], [76, cA], [76, CAP]),
            line([CLEAR, 66], [76, 66])
          ] },

      // M and W are mirror twins: two verticals and a vee at exactly 45 degrees, which is
      // the angle every chamfer is cut at, so they need no cut of their own. They were an
      // arch with a stroke hanging down the middle — a silhouette a wordmark cannot have.
      M: { w: 100, d: [line([0, CAP], [0, 0], [50, 50], [100, 0], [100, CAP])] },
      W: { w: 100, d: [line([0, 0], [0, CAP], [50, 50], [100, CAP], [100, 0])] },

      // One continuous outline. Drawn as three separate strokes it left a hole at both
      // left-hand corners, because a butt end is not a join.
      E: { w: 76, d: [
            line([76, 0], [0, 0], [0, CAP], [76, CAP]),
            line([CLEAR, BAR], [76, BAR])
          ] },

      O: { w: 76, d: [ring([c, 0], [76 - c, 0], [76, c], [76, CAP - c], [76 - c, CAP],
                           [c, CAP], [0, CAP - c], [0, c])] },

      K: { w: 80, d: [
            line([0, 0], [0, CAP]),
            toward(80, 0, 0, BAR),
            toward(80, CAP, 0, BAR)
          ] }
    };
  }

  /* ---------- Setting the word ---------- */

  // Every letter sits in one advance rather than being stretched to fill it: the strokes
  // keep the weight they were drawn at and only the air around them changes. That is what
  // makes the word set like the mono labels the interface already uses.
  function place(variant, setting) {
    var glyphs = letters(setting.cut);
    var chars = variant === 'mark' ? ['F'] : WORD.split('');
    var parts = [];
    var x = 0;

    chars.forEach(function (ch) {
      var glyph = glyphs[ch];
      var slot = variant === 'mark' ? glyph.w : setting.advance;
      var inset = variant === 'mark' ? 0 : (setting.advance - glyph.w) / 2;
      parts.push({ x: x + inset, d: glyph.d });
      x += slot + setting.track;
    });

    return { parts: parts, width: x - setting.track };
  }

  function metrics(variant) {
    var laid = place(variant === 'mark' ? 'mark' : 'full', SETTING);
    return {
      width: round(laid.width + STROKE),
      height: round(CAP + STROKE),
      ratio: round((laid.width + STROKE) / (CAP + STROKE)),
      stroke: round(STROKE),
      gap: round(GAP),
      bar: round(BAR)
    };
  }

  /* ---------- Render ---------- */

  function escapeAttr(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function svg(options) {
    var opt = options || {};
    var variant = VARIANTS.indexOf(opt.variant) >= 0 ? opt.variant : 'mark';
    var setting = {
      cut: typeof opt.cut === 'number' ? opt.cut : SETTING.cut,
      track: typeof opt.track === 'number' ? opt.track : SETTING.track,
      advance: SETTING.advance
    };

    var laid = place(variant, setting);
    var pad = STROKE / 2;

    // A ground turns the wordmark into a tile — a favicon, an avatar. The extra air is a
    // multiple of the artwork, so it holds whatever the artwork is.
    var ground = opt.ground || null;
    var air = ground ? (typeof opt.pad === 'number' ? opt.pad : 0.24) * CAP : 0;

    var x = -pad - air;
    var y = -pad - air;
    var w = laid.width + STROKE + air * 2;
    var h = CAP + STROKE + air * 2;
    if (ground) {
      // Square tile: whichever side is short gets the difference, split evenly.
      if (w > h) { y -= (w - h) / 2; h = w; } else { x -= (h - w) / 2; w = h; }
    }

    var body = laid.parts.map(function (part) {
      var paths = part.d.map(function (d) { return '<path d="' + d + '"/>'; }).join('');
      return part.x ? '<g transform="translate(' + round(part.x) + ',0)">' + paths + '</g>' : paths;
    }).join('');

    var attrs = [
      'xmlns="http://www.w3.org/2000/svg"',
      'viewBox="' + [round(x), round(y), round(w), round(h)].join(' ') + '"'
    ];

    if (opt.className) attrs.push('class="' + escapeAttr(opt.className) + '"');

    if (typeof opt.height === 'number') {
      attrs.push('width="' + round(opt.height * (w / h)) + '"', 'height="' + round(opt.height) + '"');
    }

    // Labelled or hidden, never neither: the wordmark is usually inside a link that
    // already carries the name, and two announcements of it is worse than one.
    if (opt.label) attrs.push('role="img"', 'aria-label="' + escapeAttr(opt.label) + '"');
    else attrs.push('aria-hidden="true"', 'focusable="false"');

    attrs.push(
      'fill="none"',
      'stroke="' + escapeAttr(opt.colour || 'currentColor') + '"',
      'stroke-width="' + round(STROKE) + '"',
      // Butt ends and mitred joins are the whole look. Round anything and the gaps stop
      // reading as deliberate.
      'stroke-linecap="butt"',
      'stroke-linejoin="miter"'
    );

    return '<svg ' + attrs.join(' ') + '>' +
      (ground ? '<rect x="' + round(x) + '" y="' + round(y) + '" width="' + round(w) +
        '" height="' + round(h) + '" fill="' + escapeAttr(ground) + '" stroke="none"/>' : '') +
      body + '</svg>';
  }

  function element(options) {
    var holder = document.createElement('div');
    holder.innerHTML = svg(options);
    return holder.firstChild;
  }

  var api = {
    svg: svg,
    element: element,
    metrics: metrics,
    VARIANTS: VARIANTS,
    SETTING: SETTING,
    WORD: WORD,
    // Geometry only, for anything that wants to reason about the letters rather than draw
    // them — the tests do.
    letters: letters,
    CAP: CAP,
    STROKE: STROKE,
    GAP: GAP,
    CLEAR: CLEAR,
    BAR: BAR
  };

  /* ---------- <fw-wordmark> ---------- */

  if (typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined' &&
      !customElements.get('fw-wordmark')) {
    var FwWordmark = function () { return Reflect.construct(HTMLElement, [], FwWordmark); };
    FwWordmark.prototype = Object.create(HTMLElement.prototype);
    FwWordmark.prototype.constructor = FwWordmark;
    Object.setPrototypeOf(FwWordmark, HTMLElement);

    FwWordmark.observedAttributes = ['variant', 'height', 'label', 'colour', 'ground', 'svg-class'];

    FwWordmark.prototype.connectedCallback = function () { this.render(); };
    FwWordmark.prototype.attributeChangedCallback = function () {
      if (this.isConnected) this.render();
    };
    FwWordmark.prototype.render = function () {
      var height = parseFloat(this.getAttribute('height'));
      this.innerHTML = svg({
        variant: this.getAttribute('variant') || 'mark',
        className: this.getAttribute('svg-class') || undefined,
        height: isFinite(height) ? height : undefined,
        label: this.getAttribute('label') || undefined,
        colour: this.getAttribute('colour') || undefined,
        ground: this.getAttribute('ground') || undefined
      });
    };

    Object.setPrototypeOf(FwWordmark.prototype, HTMLElement.prototype);
    customElements.define('fw-wordmark', FwWordmark);
  }

  /* ---------- CLI ---------- */

  if (typeof module === 'object' && module.exports && typeof process !== 'undefined' &&
      require.main === module) {
    var flags = {};
    process.argv.slice(2).forEach(function (arg, i, all) {
      if (arg.indexOf('--') === 0) flags[arg.slice(2)] = all[i + 1];
    });
    process.stdout.write(svg({
      variant: flags.variant,
      className: flags['class'],
      label: flags.label,
      colour: flags.colour,
      ground: flags.ground,
      height: flags.height === undefined ? undefined : parseFloat(flags.height),
      pad: flags.pad === undefined ? undefined : parseFloat(flags.pad)
    }) + '\n');
  }

  return api;
});
