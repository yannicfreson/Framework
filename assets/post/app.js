/* Framework — post generator.
 *
 * Wires the form to the document, the document to the previews, and the previews to the
 * export. The document is the only state; everything on screen is derived from it.
 */
import { createMeasure, createCache, paint, fontsReady } from './render.js';

const State = window.FrameworkPostState;
const Layouts = window.FrameworkPostLayouts;

const RATIO_LABELS = { '1:1': 'Feed square', '4:5': 'Feed portrait', '9:16': 'Story' };

/* ---------- Document ---------- */

function readInitialDoc() {
  const fromUrl = State.decode((location.hash || '').replace(/^#s=/, ''));
  return State.normalise(fromUrl || State.load() || State.defaults());
}

let doc = readInitialDoc();

const cache = createCache();
const measure = createMeasure(document.createElement('canvas').getContext('2d'));

/* ---------- Controls ---------- */

function choiceButton(value, checked, onPick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg__choice';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', String(checked));
  button.textContent = value.replace(/-/g, ' ');
  button.addEventListener('click', () => onPick(value));
  return button;
}

function renderChoices(name, values, current, onPick) {
  const host = document.querySelector(`[data-choices="${name}"]`);
  host.setAttribute('role', 'radiogroup');
  host.setAttribute('aria-label', name);
  host.innerHTML = '';
  values.forEach((value) => host.appendChild(choiceButton(value, value === current, onPick)));
}

function renderControls() {
  renderChoices('layout', State.LAYOUTS, doc.layout, (value) => {
    doc.layout = value;
    update();
  });

  renderChoices('theme', State.THEMES, doc.theme, (value) => {
    doc.theme = value;
    update();
  });

  renderChoices('composition', State.COMPOSITIONS, doc.art.composition, (value) => {
    doc.art.composition = value;
    // A random sculpture needs a concrete seed the moment it is chosen, or the share
    // link would reproduce a different one for whoever opens it.
    doc.art.seed = value === 'random' ? Math.floor(Math.random() * 1e6) : null;
    update();
  });

  document.querySelector('[data-reroll]').hidden = doc.art.composition !== 'random';

  for (const field of ['eyebrow', 'headline', 'footer']) {
    const input = document.querySelector(`[data-field="${field}"]`);
    if (input.value !== doc[field]) input.value = doc[field];
    document.querySelector(`[data-count="${field}"]`).textContent =
      `${doc[field].length}/${State.LIMITS[field]}`;
  }
}

/* ---------- Previews ---------- */

const shots = new Map();

function buildShots() {
  const stage = document.querySelector('[data-stage]');
  const major = document.createElement('div');
  major.dataset.major = '';
  const minors = document.createElement('div');
  minors.className = 'pg__minors';
  minors.dataset.minors = '';
  stage.append(major, minors);

  for (const ratio of State.RATIOS) {
    const size = State.ratioSize(ratio);
    const shot = document.createElement('div');
    shot.className = 'pg__shot';
    // The box derives its shape from the bitmap, never the other way round.
    shot.style.setProperty('--ar', String(size.width / size.height));

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.dataset.preview = ratio;
    canvas.setAttribute('role', 'img');

    const caption = document.createElement('div');
    caption.className = 'pg__caption';
    caption.innerHTML = `<span>${ratio} · ${RATIO_LABELS[ratio]}</span><span>${size.width}×${size.height}</span>`;

    const warning = document.createElement('div');
    warning.className = 'pg__warning';
    warning.dataset.warning = ratio;

    shot.append(canvas, caption, warning);
    shots.set(ratio, shot);
  }
}

function renderRatioTabs() {
  const host = document.querySelector('[data-ratios]');
  host.innerHTML = '';
  State.RATIOS.forEach((ratio) => {
    host.appendChild(choiceButton(ratio, ratio === doc.preview, (value) => {
      doc.preview = value;
      update();
    }));
  });
}

function arrangeShots() {
  const major = document.querySelector('[data-major]');
  const minors = document.querySelector('[data-minors]');
  // Re-parenting keeps each canvas's pixels, and the backing store never changes size,
  // so switching the enlarged ratio costs nothing and never re-runs WebGL.
  for (const ratio of State.RATIOS) {
    const shot = shots.get(ratio);
    const isMajor = ratio === doc.preview;
    shot.classList.toggle('pg__shot--minor', !isMajor);
    (isMajor ? major : minors).appendChild(shot);
  }
}

function describe(ratio) {
  const words = [doc.eyebrow, doc.headline, doc.footer].filter(Boolean).join('. ');
  return `Framework post, ${ratio}, ${doc.layout} layout. ${words}`;
}

function showWarnings(ratio, warnings) {
  const clipped = warnings.find((w) => w.kind === 'clipped');
  document.querySelector(`[data-warning="${ratio}"]`).textContent =
    clipped ? `Headline clipped at ${ratio}` : '';
}

async function renderAll() {
  cache.theme = doc.theme;
  for (const ratio of State.RATIOS) {
    const size = State.ratioSize(ratio);
    const canvas = shots.get(ratio).querySelector('canvas');
    const { ops, warnings } = Layouts.build(doc, size, measure);
    await paint(canvas, ops, cache);
    canvas.setAttribute('aria-label', describe(ratio));
    showWarnings(ratio, warnings);
  }
}

/* ---------- Share ---------- */

function updateShare() {
  const encoded = State.encode(doc);
  const button = document.querySelector('[data-share]');
  const note = document.querySelector('[data-share-note]');

  if (encoded.length > State.MAX_URL_CHARS) {
    button.disabled = true;
    note.textContent = 'Too long to share — shorten the headline';
    return;
  }

  button.disabled = false;
  if (note.textContent.startsWith('Too long')) note.textContent = '';
  // replaceState, never pushState: typing must not fill the back stack.
  history.replaceState(null, '', `#s=${encoded}`);
}

/* ---------- Export ---------- */

function slug(text) {
  const cleaned = String(text || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return cleaned || new Date().toISOString().slice(0, 10);
}

// The preview canvas's backing store is already exactly the export bitmap, so export
// hands back that very canvas rather than painting a second one. Re-rendering into a
// detached canvas would not even match: Chrome rasterises text differently on a
// composited canvas than on an offscreen one, so the two drifted by a level or two of
// antialiasing. Returning the same object makes preview-is-export structural.
export async function exportRatio(ratio) {
  await flush();
  return shots.get(ratio).querySelector('canvas');
}

export function fileName(headline, ratio) {
  return `framework-${slug(headline)}-${ratio.replace(':', 'x')}.png`;
}

// A data URL rather than an object URL, deliberately. The object-URL version revoked
// synchronously after click(), which tears the blob down before the browser has read it
// — the save then fails or loses the filename, and with it the extension. A data URL has
// no lifetime to race: nothing to revoke, nothing to get the ordering wrong.
function saveCanvas(canvas, filename) {
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  // Browsers throttle downloads fired in a tight loop, so leave a gap and let the
  // anchor live until the save is under way.
  return new Promise((resolve) => setTimeout(() => {
    link.remove();
    resolve();
  }, 350));
}

async function exportAll() {
  const button = document.querySelector('[data-export]');
  button.disabled = true;
  const label = button.textContent;
  button.textContent = 'Exporting…';

  try {
    await flush();
    for (const ratio of State.RATIOS) {
      await saveCanvas(shots.get(ratio).querySelector('canvas'), fileName(doc.headline, ratio));
    }
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
}

/* ---------- Loop ---------- */

let pending = null;
let inFlight = Promise.resolve();

// Runs any debounced repaint right now and resolves when the canvases are current.
// Export goes through this, so hitting export mid-keystroke cannot ship a stale post.
function flush() {
  clearTimeout(pending);
  pending = null;
  inFlight = inFlight.then(renderAll);
  return inFlight;
}

function update() {
  renderControls();
  renderRatioTabs();
  arrangeShots();
  State.save(doc);
  updateShare();
  clearTimeout(pending);
  pending = setTimeout(flush, 120);
}

function bindInputs() {
  for (const field of ['eyebrow', 'headline', 'footer']) {
    document.querySelector(`[data-field="${field}"]`).addEventListener('input', (event) => {
      doc[field] = event.target.value.slice(0, State.LIMITS[field]);
      update();
    });
  }

  document.querySelector('[data-reroll]').addEventListener('click', () => {
    doc.art.seed = Math.floor(Math.random() * 1e6);
    update();
  });

  document.querySelector('[data-share]').addEventListener('click', async () => {
    const note = document.querySelector('[data-share-note]');
    try {
      await navigator.clipboard.writeText(location.href);
      note.textContent = 'Link copied';
    } catch (e) {
      note.textContent = 'Copy failed — the URL bar has it';
    }
    setTimeout(() => { if (note.textContent.startsWith('Link') || note.textContent.startsWith('Copy')) note.textContent = ''; }, 2400);
  });

  document.querySelector('[data-export]').addEventListener('click', exportAll);
}

async function start() {
  buildShots();
  bindInputs();
  update();

  // Exporting before the faces load would silently ship the post in Helvetica, which is
  // invisible until it is public.
  await fontsReady();
  const button = document.querySelector('[data-export]');
  button.textContent = 'Export all three';
  button.disabled = false;

  await flush();
  window.__postGeneratorReady = true;
}

start();
