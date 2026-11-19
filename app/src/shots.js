// Fixed scenes for screenshots: ?shot=cover shows one exported cover full-frame,
// ?shot=editor shows the editor with photos loaded, ?shot=sizes shows all three
// post sizes side by side. window.__shotReady is set once the scene is painted.
import { drawCover, defaultPanels } from './cover.js';
import { SIZES } from './main.js';

const canvas = document.getElementById('cover');

function markReady() {
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}

function applyScene(query, ctx) {
  if (query.get('layout')) ctx.state.layout = query.get('layout');
  if (query.get('grade')) ctx.state.grade = query.get('grade');
  // Keep the editor's highlighted buttons in step with the scene.
  document.querySelectorAll('[data-layout]').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === ctx.state.layout);
  });
  document.querySelectorAll('[data-grade]').forEach((b) => {
    b.classList.toggle('active', b.dataset.grade === ctx.state.grade);
  });
  if (query.get('caption')) {
    ctx.state.title = query.get('caption');
    document.getElementById('caption').value = query.get('caption');
  }
  if (query.get('subtitle')) {
    ctx.state.subtitle = query.get('subtitle');
    document.getElementById('subtitle').value = query.get('subtitle');
  }
  if (query.get('badge')) {
    ctx.state.badge = query.get('badge');
    document.getElementById('badge').value = query.get('badge');
  }
}

async function loadScenePhotos(query, ctx) {
  const names = (query.get('photos') || query.get('photo') || 'pier').split(',');
  for (const name of names) await ctx.loadSample(name.trim());
}

export async function runShot(shot, query, ctx) {
  applyScene(query, ctx);
  await loadScenePhotos(query, ctx);
  // Spread the loaded photos across the panels, like a person would.
  const n = Math.max(1, ctx.state.photos.length);
  ctx.state.panels = ctx.state.panels.map((p, i) => ({ ...p, photo: i % n }));
  if (shot === 'cover') {
    document.body.classList.add('shot-cover');
    const size = SIZES[query.get('size') || 'wide'] || SIZES.wide;
    canvas.width = size.w;
    canvas.height = size.h;
    // Rebuild panels for the export aspect, then draw.
    ctx.state.panels = defaultPanels(ctx.state.layout, n).map((p, i) => ({ ...p, photo: i % n }));
    ctx.redraw();
    markReady();
    return;
  }
  if (shot === 'sizes') {
    document.body.classList.add('shot-sizes');
    canvas.width = 1280;
    canvas.height = 720;
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#14061f';
    c2d.fillRect(0, 0, 1280, 720);
    c2d.fillStyle = '#f5efe6';
    c2d.font = 'bold 26px system-ui, sans-serif';
    c2d.textAlign = 'left';
    c2d.fillText('One cover, every post size', 32, 48);
    const slots = [
      { key: 'square', x: 32, y: 76, w: 380, h: 380 },
      { key: 'portrait', x: 444, y: 76, w: 360, h: 450 },
      { key: 'wide', x: 836, y: 76, w: 412, h: 232 },
    ];
    for (const slot of slots) {
      const size = SIZES[slot.key];
      const off = document.createElement('canvas');
      off.width = size.w;
      off.height = size.h;
      drawCover(off, {
        layout: ctx.state.layout,
        grade: ctx.state.grade,
        title: ctx.state.title,
        subtitle: ctx.state.subtitle,
        badge: ctx.state.badge,
        photos: ctx.state.photos.map((p) => p.img),
        panels: ctx.state.panels,
      });
      c2d.drawImage(off, slot.x, slot.y, slot.w, slot.h);
      c2d.fillStyle = '#ffe9a8';
      c2d.font = 'bold 20px system-ui, sans-serif';
      c2d.fillText(`${size.label} PNG`, slot.x, slot.y + slot.h + 34);
      c2d.fillStyle = 'rgba(245,239,230,0.75)';
      c2d.font = '16px system-ui, sans-serif';
      c2d.fillText(slot.key === 'wide' ? 'story + feed wide' : slot.key === 'portrait' ? 'feed portrait' : 'feed square', slot.x, slot.y + slot.h + 58);
    }
    c2d.fillStyle = 'rgba(245,239,230,0.75)';
    c2d.font = '16px system-ui, sans-serif';
    c2d.fillText('Export all three in one click — Neon Coast', 32, 700);
    markReady();
    return;
  }
  // Default: the editor, with photos loaded.
  ctx.redraw();
  markReady();
}
