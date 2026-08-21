/* Framework — photo stylizer.
 *
 * Wires the form to the look, the look to every loaded photo, and the previews to the
 * export. Same shape as the post generator: the document is the only state, everything on
 * screen is derived from it, and the preview canvas is the export canvas at a smaller
 * backing size rather than a different drawing of it.
 *
 * Photographs are held in memory only. Nothing is uploaded anywhere — the engraving runs
 * on the GPU in this tab — which is also why there is no share link: a link cannot carry
 * the photograph. The look persists instead, so the set stays consistent across sessions.
 */
import { engrave, loadImage, supported, unsupportedReason, coverRect, fitLevels } from './render.js';

const State = window.FrameworkPhotoState;

/* ---------- State ---------- */

let look = State.normalise(State.load() || State.defaults());

// Each entry: { id, name, image, frame }. The look is shared; the frame is not.
const photos = [];
let selectedId = null;
let nextId = 1;

const el = (selector) => document.querySelector(selector);

/* ---------- Controls ---------- */

function choiceButton(value, checked, onPick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pg__choice';
  button.setAttribute('role', 'radio');
  button.setAttribute('aria-checked', String(checked));
  button.textContent = value;
  button.addEventListener('click', () => onPick(value));
  return button;
}

function renderChoices(name, values, current, onPick) {
  const host = el(`[data-choices="${name}"]`);
  host.setAttribute('role', 'radiogroup');
  host.setAttribute('aria-label', name);
  host.innerHTML = '';
  values.forEach((value) => host.appendChild(choiceButton(value, value === current, onPick)));
}

function buildSliders() {
  const host = el('[data-sliders]');
  host.innerHTML = '';

  for (const [key, spec] of Object.entries(State.SLIDERS)) {
    const label = document.createElement('label');
    label.className = 'pg__field ps__slider';

    const caption = document.createElement('span');
    caption.className = 'pg__label';
    caption.innerHTML = `<span>${spec.label}</span><em data-value="${key}"></em>`;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.dataset.look = key;
    input.addEventListener('input', () => {
      look[key] = parseFloat(input.value);
      update({ controls: false });
    });

    label.append(caption, input);
    host.appendChild(label);
  }
}

function syncControls() {
  renderChoices('style', State.STYLES, look.style, (value) => { look.style = value; update(); });
  renderChoices('theme', State.THEMES, look.theme, (value) => { look.theme = value; update(); });
  renderChoices('ratio', State.RATIOS, look.ratio, (value) => { look.ratio = value; update(); });

  for (const key of Object.keys(State.SLIDERS)) {
    const input = el(`[data-look="${key}"]`);
    if (input && input.value !== String(look[key])) input.value = String(look[key]);
    el(`[data-value="${key}"]`).textContent = String(Math.round(look[key]));
  }

  const contour = el('[data-contour]');
  contour.checked = look.contour;

  const zoom = el('[data-zoom]');
  const current = selected();
  zoom.disabled = !current;
  zoom.value = String(current ? current.frame.zoom : 100);
  el('[data-value="zoom"]').textContent = current ? Math.round(current.frame.zoom) + '%' : '—';
}

/* ---------- Photos ---------- */

function selected() {
  return photos.find((p) => p.id === selectedId) || null;
}

async function addFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;

  note(`Reading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
  for (const file of files) {
    try {
      const image = await loadImage(file);
      photos.push({
        id: nextId++,
        name: file.name.replace(/\.[^.]+$/, ''),
        image,
        frame: State.defaultFrame()
      });
    } catch (e) {
      note(e.message);
    }
  }
  if (!selected() && photos.length) selectedId = photos[photos.length - 1].id;
  note('');
  update();
}

function removePhoto(id) {
  const index = photos.findIndex((p) => p.id === id);
  if (index < 0) return;
  photos.splice(index, 1);
  if (selectedId === id) selectedId = photos.length ? photos[Math.min(index, photos.length - 1)].id : null;
  update();
}

/* ---------- Drawing ---------- */

// One canvas is sized for the frame's ratio and drawn at `height` device pixels. The
// engraving scales its own texture off that height, so a 200px strip thumbnail and a
// 1440px export are the same picture at two sizes rather than two different pictures.
function paint(canvas, photo, height) {
  const size = State.ratioSize(look.ratio);
  const width = Math.round(height * (size.width / size.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  engrave(canvas, photo.image, Object.assign({}, look, photo.frame));
}

function renderStrip() {
  const host = el('[data-strip]');
  host.innerHTML = '';

  for (const photo of photos) {
    const item = document.createElement('div');
    item.className = 'ps__thumb' + (photo.id === selectedId ? ' is-on' : '');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ps__thumb-pick';
    button.setAttribute('aria-pressed', String(photo.id === selectedId));
    button.title = photo.name;

    const canvas = document.createElement('canvas');
    paint(canvas, photo, 220);
    button.appendChild(canvas);
    button.addEventListener('click', () => { selectedId = photo.id; update(); });

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'ps__thumb-drop';
    drop.textContent = '×';
    drop.setAttribute('aria-label', 'Remove ' + photo.name);
    drop.addEventListener('click', () => removePhoto(photo.id));

    const name = document.createElement('span');
    name.className = 'ps__thumb-name';
    name.textContent = photo.name;

    item.append(button, drop, name);
    host.appendChild(item);
  }
}

function renderStage() {
  const stage = el('[data-preview]');
  const empty = el('[data-empty]');
  const photo = selected();

  stage.hidden = !photo;
  empty.hidden = !!photo;
  if (!photo) return;

  const canvas = el('[data-canvas]');
  const size = State.ratioSize(look.ratio);
  // Cap the backing store rather than the CSS box: the preview must be cheap to redraw on
  // every drag of a slider, and 720 device pixels tall is already past what the screen
  // shows it at.
  paint(canvas, photo, Math.min(720, size.height));
  canvas.style.aspectRatio = `${size.width} / ${size.height}`;
  el('[data-name]').textContent = photo.name;
  el('[data-dims]').textContent = `${size.width}×${size.height}`;
}

let pending = 0;
function update(options) {
  const opts = options || {};
  if (opts.controls !== false) syncControls();
  else {
    for (const key of Object.keys(State.SLIDERS)) {
      el(`[data-value="${key}"]`).textContent = String(Math.round(look[key]));
    }
  }

  State.save(look);
  el('[data-export]').disabled = !photos.length;
  el('[data-export-all]').disabled = photos.length < 2;

  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    // One failing photo must not take the rest of the interface with it: a redraw that
    // throws halfway leaves the stage sized but unpainted and no way to tell why.
    try {
      renderStage();
      renderStrip();
    } catch (e) {
      note('Could not draw that: ' + e.message);
    }
  });
}

/* ---------- Framing by hand ---------- */

// Dragging the preview moves the crop, which is the only way to frame a face without
// arithmetic. The pointer is mapped through the same cover rectangle the renderer uses,
// so the photo tracks the cursor one-to-one instead of at some guessed gain.
function bindFraming() {
  const canvas = el('[data-canvas]');
  let dragging = null;

  canvas.addEventListener('pointerdown', (event) => {
    const photo = selected();
    if (!photo) return;
    canvas.setPointerCapture(event.pointerId);
    dragging = { x: event.clientX, y: event.clientY, frame: Object.assign({}, photo.frame) };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const photo = selected();
    const box = canvas.getBoundingClientRect();
    const size = State.ratioSize(look.ratio);
    const r = coverRect(photo.image, size.width, size.height, photo.frame.zoom / 100, 0, 0);

    // Travel is the overhang: the part of the photo that does not fit the frame. With no
    // overhang on an axis there is nothing to pan along it, hence the guards.
    const overX = r.w - size.width;
    const overY = r.h - size.height;
    const dx = ((event.clientX - dragging.x) / box.width) * size.width;
    const dy = ((event.clientY - dragging.y) / box.height) * size.height;

    photo.frame = State.normaliseFrame({
      zoom: dragging.frame.zoom,
      x: overX > 1 ? dragging.frame.x + (dx / overX) * 100 : dragging.frame.x,
      y: overY > 1 ? dragging.frame.y + (dy / overY) * 100 : dragging.frame.y
    });
    update({ controls: false });
  });

  const stop = (event) => {
    if (!dragging) return;
    dragging = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    syncControls();
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  canvas.addEventListener('wheel', (event) => {
    const photo = selected();
    if (!photo) return;
    event.preventDefault();
    photo.frame = State.normaliseFrame(Object.assign({}, photo.frame, {
      zoom: photo.frame.zoom * (event.deltaY > 0 ? 0.96 : 1.04)
    }));
    update();
  }, { passive: false });

  el('[data-zoom]').addEventListener('input', (event) => {
    const photo = selected();
    if (!photo) return;
    photo.frame = State.normaliseFrame(Object.assign({}, photo.frame, {
      zoom: parseFloat(event.target.value)
    }));
    update({ controls: false });
    el('[data-value="zoom"]').textContent = Math.round(photo.frame.zoom) + '%';
  });

  el('[data-recentre]').addEventListener('click', () => {
    const photo = selected();
    if (!photo) return;
    photo.frame = State.defaultFrame();
    update();
  });
}

/* ---------- Export ---------- */

function slug(text) {
  const cleaned = String(text || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return cleaned || 'portrait';
}

function download(canvas, name) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      // Revoked on the next frame rather than immediately: Safari has not started reading
      // the blob by the time click() returns.
      requestAnimationFrame(() => URL.revokeObjectURL(url));
      resolve();
    }, 'image/png');
  });
}

async function exportPhoto(photo) {
  const size = State.ratioSize(look.ratio);
  const canvas = document.createElement('canvas');
  paint(canvas, photo, size.height);
  await download(canvas, `framework-${slug(photo.name)}-${look.ratio.replace(':', 'x')}.png`);
}

function note(text) {
  el('[data-note]').textContent = text;
}

/* ---------- Wiring ---------- */

function bindInputs() {
  el('[data-contour]').addEventListener('change', (event) => {
    look.contour = event.target.checked;
    update();
  });

  // Fits the levels to whichever photo is on the stage, then leaves them alone. Deliberately
  // a button rather than something that happens on load: the look is shared, so the moment
  // it fires is a decision — fit to the best-lit portrait of the set, then let the other
  // four be measured against it.
  el('[data-fit]').addEventListener('click', () => {
    const photo = selected();
    if (!photo) return;
    const fitted = fitLevels(photo.image, Object.assign({}, look, photo.frame));
    if (!fitted) {
      note('Too little range in that crop to fit — set the levels by hand.');
      return;
    }
    look.black = fitted.black;
    look.white = fitted.white;
    update();
    note(`Levels fitted to ${photo.name}: ${fitted.black}–${fitted.white}.`);
  });

  el('[data-reset]').addEventListener('click', () => {
    look = State.defaults();
    update();
    note('Look reset.');
  });

  const picker = el('[data-file]');
  picker.addEventListener('change', () => {
    addFiles(picker.files);
    picker.value = '';
  });

  el('[data-export]').addEventListener('click', async () => {
    const photo = selected();
    if (!photo) return;
    note('Exporting…');
    await exportPhoto(photo);
    note('Saved ' + photo.name + '.');
  });

  el('[data-export-all]').addEventListener('click', async () => {
    for (const photo of photos) {
      note(`Exporting ${photo.name}…`);
      await exportPhoto(photo);
    }
    note(`Saved ${photos.length} portraits.`);
  });

  // Dropping anywhere on the page, not just on the well: the well is small once the
  // strip fills up, and by then dropping a sixth photo is the most likely thing to do.
  const stop = (event) => { event.preventDefault(); };
  document.addEventListener('dragover', (event) => {
    stop(event);
    document.body.classList.add('is-dropping');
  });
  document.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) document.body.classList.remove('is-dropping');
  });
  document.addEventListener('drop', (event) => {
    stop(event);
    document.body.classList.remove('is-dropping');
    if (event.dataTransfer && event.dataTransfer.files) addFiles(event.dataTransfer.files);
  });
}

buildSliders();
bindInputs();
bindFraming();
update();

if (!supported()) {
  note('No screen: ' + unsupportedReason() + ' — showing prepared tone, crop and exposure still true.');
}
