// Neon Coast — wires the editor: photos, layouts, grades, per-panel crop,
// drag-to-pan on the preview, and PNG export in the three post sizes.
// A `?shot=` query sets up a fixed scene for a screenshot instead (./shots.js).
import { drawCover, defaultPanels, layoutPanels, LAYOUTS, GRADES } from './cover.js';
import { runShot } from './shots.js';

export const SIZES = {
  square: { w: 1080, h: 1080, label: '1080 x 1080' },
  portrait: { w: 1080, h: 1350, label: '1080 x 1350' },
  wide: { w: 1920, h: 1080, label: '1920 x 1080' },
};

const canvas = document.getElementById('cover');
const statusEl = document.getElementById('status');
const captionInput = document.getElementById('caption');
const subtitleInput = document.getElementById('subtitle');
const badgeInput = document.getElementById('badge');
const panelBox = document.getElementById('panel-controls');
const zoomInput = document.getElementById('zoom');
const panXInput = document.getElementById('panx');
const panYInput = document.getElementById('pany');
const photoSelect = document.getElementById('panel-photo');

const state = {
  layout: 'grid',
  grade: 'sunset',
  title: 'Neon Coast',
  subtitle: 'sunset run',
  badge: 'Est. 2026',
  photos: [], // { img, name }
  panels: defaultPanels('grid', 1),
  selected: 0,
};

let lastGeometry = null;

function redraw() {
  const view = {
    layout: state.layout,
    grade: state.grade,
    title: state.title,
    subtitle: state.subtitle,
    badge: state.badge,
    photos: state.photos.map((p) => p.img),
    panels: state.panels,
  };
  lastGeometry = drawCover(canvas, view);
  syncPanelControls();
}

/** Loads an image from a URL, resolving once it can be drawn. */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load('80px Anton'),
      document.fonts.load('40px Pacifico'),
    ]);
    await document.fonts.ready;
  } catch (e) {
    // Fall back to system fonts if a vendored font fails to load.
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

function applyLayout(layout) {
  state.layout = layout;
  state.panels = defaultPanels(layout, Math.max(1, state.photos.length));
  state.selected = 0;
  document.querySelectorAll('[data-layout]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === layout);
  });
  redraw();
}

function applyGrade(grade) {
  state.grade = grade;
  document.querySelectorAll('[data-grade]').forEach((b) => {
    b.classList.toggle('active', b.dataset.grade === grade);
  });
  redraw();
}

// ---- photo loading ---------------------------------------------------------

async function addPhotoFile(file) {
  const img = await loadImage(URL.createObjectURL(file));
  state.photos.push({ img, name: file.name });
  refreshPhotoLists();
  if (state.photos.length === 1) {
    state.panels = defaultPanels(state.layout, 1);
  }
  redraw();
  return img;
}

async function loadSample(name) {
  const img = await loadImage(`samples/${name}.jpg`);
  state.photos.push({ img, name });
  refreshPhotoLists();
  redraw();
  return img;
}

function refreshPhotoLists() {
  photoSelect.innerHTML = '';
  state.photos.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Photo ${i + 1} — ${p.name}`;
    photoSelect.appendChild(opt);
  });
  document.getElementById('photo-count').textContent =
    state.photos.length === 0 ? 'No photos yet — add one below or try a sample.'
      : `${state.photos.length} photo${state.photos.length > 1 ? 's' : ''} loaded.`;
}

// ---- per-panel controls ----------------------------------------------------

function syncPanelControls() {
  const spec = state.panels[state.selected];
  if (!spec) { panelBox.hidden = true; return; }
  panelBox.hidden = false;
  document.getElementById('panel-title').textContent =
    `Panel ${state.selected + 1} of ${state.panels.length}`;
  photoSelect.value = String(spec.photo);
  zoomInput.value = String(spec.zoom);
  panXInput.value = String(spec.ox);
  panYInput.value = String(spec.oy);
  document.getElementById('zoom-val').textContent = `${Math.round(spec.zoom * 100)}%`;
}

// Click a panel on the preview to select it; drag pans it; wheel zooms it.
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * canvas.width,
    y: ((e.clientY - r.top) / r.height) * canvas.height,
  };
}

function hitPanel(p) {
  if (!lastGeometry) return -1;
  const idx = lastGeometry.panels.findIndex((r) =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  return idx;
}

let dragging = null;
canvas.addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e);
  const idx = hitPanel(p);
  if (idx < 0) return;
  if (state.layout === 'nine' && idx === 4) return;
  state.selected = idx;
  const spec = state.panels[idx];
  dragging = { startX: p.x, startY: p.y, ox: spec.ox, oy: spec.oy };
  canvas.setPointerCapture(e.pointerId);
  syncPanelControls();
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const p = canvasPoint(e);
  const spec = state.panels[state.selected];
  const rect = lastGeometry.panels[state.selected];
  spec.ox = Math.max(-1, Math.min(1, dragging.ox + ((p.x - dragging.startX) / rect.w) * 4));
  spec.oy = Math.max(-1, Math.min(1, dragging.oy + ((p.y - dragging.startY) / rect.h) * 4));
  redraw();
});
canvas.addEventListener('pointerup', () => { dragging = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  const idx = hitPanel(p);
  if (idx < 0) return;
  state.selected = idx;
  const spec = state.panels[idx];
  spec.zoom = Math.max(1, Math.min(3, spec.zoom * (e.deltaY < 0 ? 1.08 : 0.93)));
  redraw();
}, { passive: false });

// ---- export ---------------------------------------------------------------

async function exportSize(key) {
  const size = SIZES[key];
  await fontsReady();
  const off = document.createElement('canvas');
  off.width = size.w;
  off.height = size.h;
  drawCover(off, {
    layout: state.layout,
    grade: state.grade,
    title: state.title,
    subtitle: state.subtitle,
    badge: state.badge,
    photos: state.photos.map((p) => p.img),
    panels: state.panels,
  });
  return new Promise((resolve) => {
    off.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `neon-coast-${size.w}x${size.h}.png`;
      a.click();
      setStatus(`Saved neon-coast-${size.w}x${size.h}.png`);
      resolve(blob);
    }, 'image/png');
  });
}

// ---- wiring ---------------------------------------------------------------

document.getElementById('photos').addEventListener('change', async (e) => {
  for (const file of e.target.files) await addPhotoFile(file);
  setStatus(`${state.photos.length} photo${state.photos.length > 1 ? 's' : ''} loaded — drag a panel to frame it.`);
});
document.getElementById('sample-boulevard').addEventListener('click', async () => {
  await loadSample('boulevard');
  setStatus('Sample photo loaded: boulevard.');
});
document.getElementById('sample-pier').addEventListener('click', async () => {
  await loadSample('pier');
  setStatus('Sample photo loaded: pier.');
});
document.getElementById('fill-one').addEventListener('click', () => {
  state.panels.forEach((p) => { p.photo = 0; p.zoom = 1; p.ox = 0; p.oy = 0; });
  redraw();
  setStatus('One photo fills every panel.');
});
document.querySelectorAll('[data-layout]').forEach((b) => {
  b.addEventListener('click', () => applyLayout(b.dataset.layout));
});
document.querySelectorAll('[data-grade]').forEach((b) => {
  b.addEventListener('click', () => applyGrade(b.dataset.grade));
});
captionInput.addEventListener('input', () => { state.title = captionInput.value; redraw(); });
subtitleInput.addEventListener('input', () => { state.subtitle = subtitleInput.value; redraw(); });
badgeInput.addEventListener('input', () => { state.badge = badgeInput.value; redraw(); });
photoSelect.addEventListener('change', () => {
  state.panels[state.selected].photo = Number(photoSelect.value);
  redraw();
});
zoomInput.addEventListener('input', () => {
  state.panels[state.selected].zoom = Number(zoomInput.value);
  redraw();
});
panXInput.addEventListener('input', () => {
  state.panels[state.selected].ox = Number(panXInput.value);
  redraw();
});
panYInput.addEventListener('input', () => {
  state.panels[state.selected].oy = Number(panYInput.value);
  redraw();
});
document.getElementById('panel-center').addEventListener('click', () => {
  const spec = state.panels[state.selected];
  spec.zoom = 1; spec.ox = 0; spec.oy = 0;
  redraw();
});
document.querySelectorAll('[data-export]').forEach((b) => {
  b.addEventListener('click', () => exportSize(b.dataset.export));
});
document.getElementById('export-all').addEventListener('click', async () => {
  for (const key of Object.keys(SIZES)) await exportSize(key);
  setStatus('Saved all three sizes: 1080x1080, 1080x1350, 1920x1080.');
});

// ---- boot ------------------------------------------------------------------

const query = new URLSearchParams(location.search);
const shot = query.get('shot');
if (shot) {
  await fontsReady();
  await runShot(shot, query, { loadSample, loadImage, state, redraw, exportSize });
} else {
  await fontsReady();
  redraw();
}
