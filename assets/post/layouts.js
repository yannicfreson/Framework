/* Framework — post layouts.
 *
 * Turns a post document plus a canvas size into positioned draw ops. Pure: no canvas,
 * no DOM, no colours. Text metrics arrive as an injected `measure` function, because
 * line breaking needs metrics and metrics need a canvas — inverting that dependency is
 * what keeps this module testable in Node.
 *
 * Layouts are functions rather than templates with baked positions: composing once and
 * exporting 1:1, 4:5 and 9:16 means those ratios need genuinely different proportions,
 * not a stretched copy of one another.
 *
 * Everything is expressed in units, where one unit = width / 1080. That gives a 1:1 and
 * a 9:16 post the same optical type size, and makes a 2x export exactly 2x everything.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FrameworkPostLayouts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LAYOUTS = ['headline-above', 'split', 'art-full', 'statement'];

  // The eyebrow and the footer are the same rank of label, so they share one spec
  // rather than two constants that can drift apart.
  var TYPE = { margin: 72, label: 22, headlineSteps: [96, 84, 72, 62] };
  var LINE = { headline: 1.03, label: 1.4 };
  var TRACK = { headline: -0.02, label: 0.18 };

  // Fraction of the frame height the headline may occupy before it has to shrink.
  var HEADLINE_BOX = 0.30;

  function scaler(width) {
    var u = width / 1080;
    return function (n) { return n * u; };
  }

  function mono(size, tracking) {
    return { family: 'IBM Plex Mono', weight: 400, size: size, tracking: tracking, lineHeight: LINE.label };
  }

  // Single source for both labels — call this, never mono() directly, and they cannot
  // end up different sizes again.
  function label(u) {
    return mono(u(TYPE.label), TRACK.label);
  }

  function jost(size) {
    return { family: 'Jost', weight: 400, size: size, tracking: TRACK.headline, lineHeight: LINE.headline };
  }

  /* ---------- Text fitting ---------- */

  // Greedy wrap. A word wider than the column is left long — fitHeadline decides
  // whether that counts as a shrink or a clip.
  //
  // A newline the writer typed is a hard break, and every paragraph either side of it
  // wraps on its own. A blank line between two paragraphs is kept, so a deliberate gap
  // survives; blank lines at either end are not, so trailing returns left over from
  // typing do not silently eat the box's height.
  function wrap(text, font, maxWidth, measure) {
    var paragraphs = String(text || '').split(/\r?\n/);
    var lines = [];

    paragraphs.forEach(function (paragraph) {
      var words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); return; }

      var line = words[0];
      for (var i = 1; i < words.length; i++) {
        var candidate = line + ' ' + words[i];
        if (measure(candidate, font) <= maxWidth) line = candidate;
        else { lines.push(line); line = words[i]; }
      }
      lines.push(line);
    });

    while (lines.length && lines[0] === '') lines.shift();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();

    return lines;
  }

  function widestLine(lines, font, measure) {
    return lines.reduce(function (widest, line) {
      return Math.max(widest, measure(line, font));
    }, 0);
  }

  // Walks down the type scale until the block fits its box. Reports how far it had to
  // go, and whether it still did not fit.
  function fitHeadline(text, u, maxWidth, maxHeight, measure) {
    var steps = TYPE.headlineSteps;

    for (var i = 0; i < steps.length; i++) {
      var font = jost(u(steps[i]));
      var lines = wrap(text, font, maxWidth, measure);
      var height = lines.length * font.size * LINE.headline;
      if (height <= maxHeight && widestLine(lines, font, measure) <= maxWidth) {
        return { font: font, lines: lines, height: height, shrunk: i, clipped: false };
      }
    }

    // The smallest step still does not fit. Keep only the lines that do, and report it —
    // a headline can sit comfortably at 1:1 and overflow at 9:16, and both get exported.
    var smallest = jost(u(steps[steps.length - 1]));
    var all = wrap(text, smallest, maxWidth, measure);
    var step = smallest.size * LINE.headline;
    var fits = Math.max(1, Math.floor(maxHeight / step));
    var kept = all.slice(0, fits);

    return {
      font: smallest,
      lines: kept,
      height: kept.length * step,
      shrunk: steps.length - 1,
      clipped: all.length > fits || widestLine(all, smallest, measure) > maxWidth
    };
  }

  // Labels are drawn in caps, and a label the writer left empty is not there at all: no
  // op, and no space held where it would have gone. That is what lets a run of posts
  // carry a number and hold the url back for the one post that reveals it, without a gap
  // opening in all the others.
  function caps(text) {
    var trimmed = String(text || '').trim();
    return trimmed ? trimmed.toUpperCase() : '';
  }

  function noteFit(warnings, fit) {
    if (fit.shrunk > 0) warnings.push({ kind: 'shrunk', field: 'headline', steps: fit.shrunk });
    if (fit.clipped) warnings.push({ kind: 'clipped', field: 'headline', steps: fit.shrunk });
  }

  /* ---------- Layouts ---------- */

  function headlineAbove(doc, size, measure, u, warnings) {
    var m = u(TYPE.margin);
    var column = size.width - m * 2;
    var ops = [{ type: 'fill', x: 0, y: 0, w: size.width, h: size.height, role: 'bg' }];

    var eyebrowFont = label(u);
    var eyebrow = caps(doc.eyebrow);
    var boxTop = m;

    if (eyebrow) {
      ops.push({
        type: 'text', x: m, y: m + eyebrowFont.size, lines: [eyebrow],
        font: eyebrowFont, role: 'muted'
      });
      boxTop = m + eyebrowFont.size + u(46);
    }

    var fit = fitHeadline(doc.headline, u, column, size.height * HEADLINE_BOX, measure);
    noteFit(warnings, fit);
    ops.push({ type: 'text', x: m, y: boxTop + fit.font.size, lines: fit.lines, font: fit.font, role: 'fg' });

    var artTop = boxTop + fit.height + u(48);
    // Runs to all three edges: any box edge short of the post's own crops the cast
    // shadow along an invisible line, which reads as a mistake rather than a bleed.
    // The footer is pushed after this op, so it overlays the artwork.
    ops.push({
      type: 'art', x: 0, y: artTop, w: size.width,
      h: Math.max(u(80), size.height - artTop),
      composition: doc.art.composition, seed: doc.art.seed, theme: doc.theme
    });

    var footer = caps(doc.footer);
    if (footer) {
      ops.push({
        type: 'text', x: m, y: size.height - m, lines: [footer],
        font: label(u), role: 'muted'
      });
    }

    return ops;
  }

  function split(doc, size, measure, u, warnings) {
    var m = u(TYPE.margin);
    // 4:5 is already too tall to give type and art half the width each — side by side
    // only survives at roughly square.
    var stacked = size.height / size.width > 1.15;
    var ops = [{ type: 'fill', x: 0, y: 0, w: size.width, h: size.height, role: 'bg' }];

    var eyebrowFont = label(u);
    var footerFont = label(u);
    var eyebrow = caps(doc.eyebrow);
    var footer = caps(doc.footer);

    // The footer always sits on the bottom margin. When the panel is stacked it has to
    // stop short of it, or the footer floats in the middle of the post — and with no
    // footer to clear, the panel runs to the bottom edge like the other three.
    var footerBand = footer ? m + footerFont.size + u(30) : 0;
    var panel = stacked
      ? { x: 0, y: size.height * 0.44, w: size.width, h: size.height - size.height * 0.44 - footerBand }
      : { x: size.width * 0.52, y: 0, w: size.width * 0.48, h: size.height };
    var column = stacked ? size.width - m * 2 : panel.x - m - u(40);

    var boxTop = m;
    if (eyebrow) {
      ops.push({
        type: 'text', x: m, y: m + eyebrowFont.size, lines: [eyebrow],
        font: eyebrowFont, role: 'muted'
      });
      boxTop = m + eyebrowFont.size + u(46);
    }

    var boxHeight = (stacked ? panel.y : size.height - footerBand) - boxTop - u(40);
    var fit = fitHeadline(doc.headline, u, column, boxHeight, measure);
    noteFit(warnings, fit);
    ops.push({ type: 'text', x: m, y: boxTop + fit.font.size, lines: fit.lines, font: fit.font, role: 'fg' });

    ops.push({ type: 'fill', x: panel.x, y: panel.y, w: panel.w, h: panel.h, role: 'panel' });

    // Fills the panel rather than sitting inset inside it, for the same reason.
    ops.push({
      type: 'art', x: panel.x, y: panel.y, w: panel.w, h: panel.h,
      composition: doc.art.composition, seed: doc.art.seed, theme: doc.theme
    });

    if (footer) {
      ops.push({
        type: 'text', x: m, y: size.height - m,
        lines: [footer], font: footerFont, role: 'muted'
      });
    }

    return ops;
  }

  function artFull(doc, size, measure, u, warnings) {
    var m = u(TYPE.margin);
    var column = size.width - m * 2;
    var labelFont = label(u);
    var eyebrow = caps(doc.eyebrow);
    var footer = caps(doc.footer);

    // Both labels keep the margin they hold in every other layout, so someone going
    // through a run of posts finds the number in the same corner every time and this
    // layout stops being the one that quietly drops it.
    //
    // Which means the artwork can no longer bleed to all four edges. It keeps the ones
    // with no label against them and stops short of the ones that have — headline-above's
    // rule, for headline-above's reason: a label over a full-bleed sculpture lands on a
    // block sooner or later, and a number crossing an edge reads as a mistake.
    var footerBand = footer ? m + labelFont.size + u(30) : m;
    var artTop = eyebrow ? m + labelFont.size + u(24) : 0;
    var artBottom = footer ? size.height - footerBand : size.height;

    var ops = [
      { type: 'fill', x: 0, y: 0, w: size.width, h: size.height, role: 'bg' },
      {
        type: 'art', x: 0, y: artTop, w: size.width, h: artBottom - artTop,
        composition: doc.art.composition, seed: doc.art.seed, theme: doc.theme
      }
    ];

    if (eyebrow) {
      ops.push({
        type: 'text', x: m, y: m + labelFont.size, lines: [eyebrow],
        font: labelFont, role: 'muted'
      });
    }

    // The bar takes the bottom margin, and steps up out of the way when there is a
    // footer underneath to clear.
    var fit = fitHeadline(doc.headline, u, column, size.height * 0.32, measure);
    noteFit(warnings, fit);

    var padding = u(48);
    var barHeight = fit.height + padding * 2;
    var barTop = size.height - footerBand - barHeight;

    ops.push({ type: 'fill', x: 0, y: barTop, w: size.width, h: barHeight, role: 'bar' });
    ops.push({
      type: 'text', x: m, y: barTop + padding + fit.font.size,
      lines: fit.lines, font: fit.font, role: 'barFg'
    });

    if (footer) {
      ops.push({
        type: 'text', x: m, y: size.height - m, lines: [footer],
        font: labelFont, role: 'muted'
      });
    }

    return ops;
  }

  function statement(doc, size, measure, u, warnings) {
    var m = u(TYPE.margin);
    var column = size.width - m * 2;
    var ops = [{ type: 'fill', x: 0, y: 0, w: size.width, h: size.height, role: 'bg' }];

    var eyebrowFont = label(u);
    var footerFont = label(u);
    var eyebrow = caps(doc.eyebrow);
    var footer = caps(doc.footer);

    var topRule = m;
    if (eyebrow) {
      ops.push({
        type: 'text', x: m, y: m + eyebrowFont.size, lines: [eyebrow],
        font: eyebrowFont, role: 'muted'
      });
      topRule = m + eyebrowFont.size + u(24);
    }
    ops.push({ type: 'rule', x: m, y: topRule, w: column, thickness: Math.max(1, u(2)), role: 'fg' });

    // The rules are the layout, so both stay whether or not a label sits against them —
    // a rule simply moves onto the margin the missing label would have used.
    var bottomRule = footer ? size.height - m - footerFont.size - u(30) : size.height - m;

    // No artwork competing for space, so the headline gets the whole middle.
    var boxTop = topRule + u(60);
    var boxHeight = bottomRule - u(60) - boxTop;
    var fit = fitHeadline(doc.headline, u, column, boxHeight, measure);
    noteFit(warnings, fit);

    var centred = boxTop + Math.max(0, (boxHeight - fit.height) / 2);
    ops.push({ type: 'text', x: m, y: centred + fit.font.size, lines: fit.lines, font: fit.font, role: 'fg' });

    ops.push({ type: 'rule', x: m, y: bottomRule, w: column, thickness: Math.max(1, u(2)), role: 'fg' });
    if (footer) {
      ops.push({
        type: 'text', x: m, y: size.height - m, lines: [footer],
        font: footerFont, role: 'muted'
      });
    }

    return ops;
  }

  var BUILDERS = {
    'headline-above': headlineAbove,
    'split': split,
    'art-full': artFull,
    'statement': statement
  };

  function build(doc, size, measure) {
    var u = scaler(size.width);
    var warnings = [];
    var builder = BUILDERS[doc.layout] || headlineAbove;
    return { ops: builder(doc, size, measure, u, warnings), warnings: warnings };
  }

  return {
    LAYOUTS: LAYOUTS,
    TYPE: TYPE,
    LINE: LINE,
    build: build
  };
});
