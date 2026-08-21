/* Framework — post painter.
 *
 * Takes the draw ops from layouts.js and puts them on a canvas. Owns everything the
 * layout module deliberately does not: colour, text metrics, and the artwork.
 *
 * The artwork is cached by composition, seed, theme and size, so typing a headline
 * repaints text over a cached bitmap instead of re-running WebGL on every keystroke.
 */
import { createSculpture, supported } from '../blocks3d.js';

export const ROLES = {
  paper: {
    bg: '#F5F4F1', fg: '#16171A', muted: '#6B6B64',
    bar: '#16171A', barFg: '#F5F4F1',
    panelA: '#EAE8E3', panelB: '#F1EFEB'
  },
  ink: {
    bg: '#16171A', fg: '#F5F4F1', muted: '#8E8E86',
    bar: '#F5F4F1', barFg: '#16171A',
    panelA: '#1C1D20', panelB: '#232427'
  }
};

// Chrome and Safari support ctx.letterSpacing; older Safari does not. Measuring and
// drawing must agree exactly or lines wrap at one width and paint at another, so both
// branch on this single flag.
const HAS_LETTER_SPACING = (() => {
  try {
    const probe = document.createElement('canvas').getContext('2d');
    probe.letterSpacing = '2px';
    return probe.letterSpacing === '2px';
  } catch (e) {
    return false;
  }
})();

function applyFont(ctx, font) {
  ctx.font = `${font.weight} ${font.size}px "${font.family}", sans-serif`;
  if (HAS_LETTER_SPACING) ctx.letterSpacing = `${font.tracking || 0}em`;
}

export function createMeasure(ctx) {
  return (text, font) => {
    applyFont(ctx, font);
    const base = ctx.measureText(text).width;
    // Without native tracking the advance has to be added by hand — and drawText adds
    // exactly the same amount, character by character.
    return HAS_LETTER_SPACING
      ? base
      : base + text.length * font.size * (font.tracking || 0);
  };
}

export function createCache() {
  return { theme: 'paper', art: new Map(), patterns: new Map() };
}

/* ---------- Drawing ---------- */

function drawText(ctx, op, colour) {
  applyFont(ctx, op.font);
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const step = op.font.size * (op.font.lineHeight || 1.03);

  op.lines.forEach((line, index) => {
    const y = op.y + index * step;
    if (HAS_LETTER_SPACING) {
      ctx.fillText(line, op.x, y);
      return;
    }
    let x = op.x;
    for (const character of line) {
      ctx.fillText(character, x, y);
      x += ctx.measureText(character).width + op.font.size * (op.font.tracking || 0);
    }
  });
}

// The striped panel the sculptures sit on across the site: 9px bands at 135 degrees.
function stripePattern(ctx, cache, scale) {
  const key = `${cache.theme}|${scale.toFixed(3)}`;
  if (cache.patterns.has(key)) return cache.patterns.get(key);

  const band = Math.max(2, Math.round(9 * scale));
  const tile = document.createElement('canvas');
  tile.width = 1;
  tile.height = band * 2;

  const tileCtx = tile.getContext('2d');
  const palette = ROLES[cache.theme] || ROLES.paper;
  tileCtx.fillStyle = palette.panelA;
  tileCtx.fillRect(0, 0, 1, band);
  tileCtx.fillStyle = palette.panelB;
  tileCtx.fillRect(0, band, 1, band);

  const pattern = ctx.createPattern(tile, 'repeat');
  pattern.setTransform(new DOMMatrix().rotate(-45));
  cache.patterns.set(key, pattern);
  return pattern;
}

async function artFor(op, cache) {
  const key = `${op.composition}|${op.seed}|${op.theme}|${Math.round(op.w)}|${Math.round(op.h)}`;
  if (cache.art.has(key)) return cache.art.get(key);

  const width = Math.max(1, Math.round(op.w));
  const height = Math.max(1, Math.round(op.h));
  let bitmap;

  if (supported()) {
    const sculpture = createSculpture({
      composition: op.composition,
      seed: op.seed === null ? undefined : op.seed,
      theme: op.theme,
      ratio: width / height,
      width, height,
      pixelRatio: 1
    });
    sculpture.render();
    bitmap = sculpture.canvas;
  } else {
    // No WebGL: the flat renderer draws the same engraving, so this is a difference of
    // degree rather than of look.
    const markup = window.FrameworkBlocks.svg({
      composition: op.composition,
      seed: op.seed === null ? undefined : op.seed,
      theme: op.theme,
      ratio: width / height
    });
    bitmap = await loadImage('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(markup))));
  }

  cache.art.set(key, bitmap);
  return bitmap;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export async function paint(canvas, ops, cache) {
  const ctx = canvas.getContext('2d');
  const palette = ROLES[cache.theme] || ROLES.paper;
  const scale = canvas.width / 1080;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const op of ops) {
    if (op.type === 'fill') {
      ctx.fillStyle = op.role === 'panel' ? stripePattern(ctx, cache, scale) : palette[op.role];
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else if (op.type === 'rule') {
      ctx.fillStyle = palette[op.role];
      ctx.fillRect(op.x, op.y, op.w, op.thickness);
    } else if (op.type === 'art') {
      const bitmap = await artFor(op, cache);
      ctx.drawImage(bitmap, op.x, op.y, op.w, op.h);
    } else if (op.type === 'text') {
      drawText(ctx, op, palette[op.role]);
    }
  }
}

// document.fonts.ready alone resolves before a face nothing has requested yet has
// actually loaded, which would silently export the post in Helvetica.
export async function fontsReady() {
  if (!document.fonts) return;
  await Promise.all([
    document.fonts.load('400 100px "Jost"'),
    document.fonts.load('400 100px "IBM Plex Mono"')
  ]);
  await document.fonts.ready;
}
