// Neon Coast — the cover renderer.
// Draws a multi-panel GTA-poster-style cover on a 2D canvas: panel layouts,
// gradient-map sunset / neon grades, bold Anton lettering, grain + vignette.
// Every pixel is drawn by this file; no image leaves the machine.

// Gradient maps: luminance 0..1 -> colour. Each grade is five stops.
export const GRADES = {
  sunset: ['#160a2e', '#7b2d8b', '#e8446c', '#ff9e57', '#ffe9a8'],
  neon: ['#03101d', '#0b3d5c', '#00e5c0', '#ff2e88', '#fff3b0'],
  vice: ['#12082b', '#5b1a7a', '#c62b8a', '#ff7a3d', '#ffd166'],
  dusk: ['#0b1026', '#233a6b', '#4a6fa5', '#e08e79', '#f7d6a0'],
};

export const GRADE_NAMES = ['sunset', 'neon', 'vice', 'dusk'];
export const LAYOUTS = ['grid', 'hero', 'fullbleed', 'nine'];
export const LAYOUT_LABELS = {
  grid: 'Four-panel grid',
  hero: 'Hero + three',
  fullbleed: 'Full bleed',
  nine: 'Nine-panel grid',
};

// A panel: which photo it shows (index into state.photos) plus crop controls.
// zoom 1 = cover-fit; ox/oy shift the photo inside its panel (-1..1).
export function defaultPanels(layout, photoCount) {
  if (layout === 'fullbleed') return [{ photo: 0, zoom: 1, ox: 0, oy: 0 }];
  if (layout === 'nine') {
    return Array.from({ length: 9 }, (_, i) => ({
      photo: photoCount > 1 ? i % photoCount : 0,
      zoom: 1, ox: 0, oy: 0,
    }));
  }
  if (layout === 'hero') {
    return [
      { photo: 0, zoom: 1, ox: 0, oy: 0 },
      { photo: photoCount > 1 ? 1 : 0, zoom: 1, ox: 0, oy: 0 },
      { photo: photoCount > 1 ? 1 : 0, zoom: 1, ox: 0, oy: 0 },
      { photo: photoCount > 1 ? 1 : 0, zoom: 1, ox: 0, oy: 0 },
    ];
  }
  return [
    { photo: 0, zoom: 1, ox: 0, oy: 0 },
    { photo: photoCount > 1 ? 1 : 0, zoom: 1, ox: 0, oy: 0 },
    { photo: photoCount > 1 ? 1 : 0, zoom: 1, ox: 0, oy: 0 },
    { photo: photoCount > 1 ? 1 : 0, zoom: 1, ox: 0, oy: 0 },
  ];
}

// Panel rectangles for a layout, in cover pixels. Returns { panels, title } where
// title is the title-band rect (null for the nine layout, whose centre cell is
// the title block) and panels is an array of {x, y, w, h}.
export function layoutPanels(w, h, layout) {
  const frame = Math.max(6, Math.round(w * 0.014));
  const gap = Math.max(4, Math.round(w * 0.011));
  const bandH = layout === 'nine' ? 0 : Math.round(h * (w > h ? 0.24 : 0.2));
  const top = frame;
  const bottom = h - bandH - frame;
  const left = frame;
  const right = w - frame;
  const areaW = right - left;
  const areaH = bottom - top;
  const rect = (x, y, rw, rh) => ({ x, y, w: rw, h: rh });
  let panels;
  if (layout === 'fullbleed') {
    panels = [rect(left, top, areaW, areaH)];
  } else if (layout === 'hero') {
    const heroW = Math.round(areaW * 0.6);
    const colX = left + heroW + gap;
    const colW = right - colX;
    const cellH = Math.round((areaH - 2 * gap) / 3);
    panels = [
      rect(left, top, heroW, areaH),
      rect(colX, top, colW, cellH),
      rect(colX, top + cellH + gap, colW, cellH),
      rect(colX, top + 2 * (cellH + gap), colW, cellH),
    ];
  } else if (layout === 'nine') {
    const cw = Math.round((areaW - 2 * gap) / 3);
    const ch = Math.round((h - 2 * frame - 2 * gap) / 3);
    panels = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        panels.push(rect(left + c * (cw + gap), frame + r * (ch + gap), cw, ch));
      }
    }
  } else {
    const cw = Math.round((areaW - gap) / 2);
    const ch = Math.round((areaH - gap) / 2);
    panels = [
      rect(left, top, cw, ch),
      rect(left + cw + gap, top, cw, ch),
      rect(left, top + ch + gap, cw, ch),
      rect(left + cw + gap, top + ch + gap, cw, ch),
    ];
  }
  const title = layout === 'nine'
    ? null
    : { x: frame, y: h - bandH - frame, w: w - 2 * frame, h: bandH };
  return { panels, title, frame, gap };
}

function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// Build a 256-entry lookup table for one grade: luminance -> mapped colour.
function gradeTable(stops) {
  const rgb = stops.map(hexRgb);
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    const f = t * (stops.length - 1) - seg;
    for (let c = 0; c < 3; c++) {
      table[i * 3 + c] = Math.round(rgb[seg][c] + (rgb[seg + 1][c] - rgb[seg][c]) * f);
    }
  }
  return table;
}

const tables = {};
function tableFor(grade) {
  if (!tables[grade]) tables[grade] = gradeTable(GRADES[grade] || GRADES.sunset);
  return tables[grade];
}

// Draw one photo into a panel rect with cover-fit, zoom and pan, then grade it.
// A small offscreen canvas keeps the per-pixel grade cheap.
function drawPanel(ctx, photo, panel, grade) {
  const { x, y, w, h } = panel;
  const off = document.createElement('canvas');
  off.width = Math.max(2, Math.round(w));
  off.height = Math.max(2, Math.round(h));
  const octx = off.getContext('2d');
  if (!photo) {
    octx.fillStyle = '#241a33';
    octx.fillRect(0, 0, off.width, off.height);
    octx.fillStyle = 'rgba(255,255,255,0.16)';
    octx.font = `bold ${Math.round(off.height * 0.09)}px system-ui, sans-serif`;
    octx.textAlign = 'center';
    octx.fillText('ADD A PHOTO', off.width / 2, off.height / 2);
  } else {
    const base = Math.max(off.width / photo.naturalWidth, off.height / photo.naturalHeight);
    const scale = base * (panel.zoom || 1);
    const pw = photo.naturalWidth * scale;
    const ph = photo.naturalHeight * scale;
    const dx = (off.width - pw) / 2 + (panel.ox || 0) * off.width * 0.25;
    const dy = (off.height - ph) / 2 + (panel.oy || 0) * off.height * 0.25;
    octx.drawImage(photo, dx, dy, pw, ph);
  }
  const img = octx.getImageData(0, 0, off.width, off.height);
  const d = img.data;
  const table = tableFor(grade);
  for (let i = 0; i < d.length; i += 4) {
    const lum = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    const ti = lum * 3;
    // 70% grade map, 30% original photo keeps skin and texture alive.
    d[i] = Math.round(table[ti] * 0.7 + d[i] * 0.3);
    d[i + 1] = Math.round(table[ti + 1] * 0.7 + d[i + 1] * 0.3);
    d[i + 2] = Math.round(table[ti + 2] * 0.7 + d[i + 2] * 0.3);
  }
  octx.putImageData(img, 0, 0);
  ctx.drawImage(off, x, y, w, h);
}

// Seeded random so the grain looks the same on every export.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let grainPattern = null;
function grain(ctx, w, h) {
  if (!grainPattern) {
    const p = document.createElement('canvas');
    p.width = 140; p.height = 140;
    const pctx = p.getContext('2d');
    const img = pctx.createImageData(140, 140);
    const rnd = mulberry32(20261119);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rnd() * 255);
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
      img.data[i + 3] = 28;
    }
    pctx.putImageData(img, 0, 0);
    grainPattern = ctx.createPattern(p, 'repeat');
  }
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = grainPattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function vignette(ctx, w, h) {
  const g = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.42,
    w / 2, h / 2, Math.max(w, h) * 0.75,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,4,20,0.38)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Title band: sunset gradient, a low sun with rays, big Anton title + script subtitle.
function drawTitleBand(ctx, band, state) {
  const { x, y, w, h } = band;
  const stops = GRADES[state.grade] || GRADES.sunset;
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, stops[1]);
  g.addColorStop(0.55, stops[2]);
  g.addColorStop(1, stops[3]);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Sun disc + rays on the right of the band.
  const cx = x + w * 0.82;
  const cy = y + h * 0.52;
  const r = h * 0.34;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 244, 200, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 244, 200, 0.45)';
  ctx.lineWidth = Math.max(2, h * 0.02);
  for (let i = 0; i < 9; i++) {
    const a = (-Math.PI / 2) + (i - 4) * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25);
    ctx.lineTo(cx + Math.cos(a) * r * 1.9, cy + Math.sin(a) * r * 1.9);
    ctx.stroke();
  }
  ctx.restore();
  const title = (state.title || 'NEON COAST').trim().toUpperCase() || 'NEON COAST';
  const pad = w * 0.035;
  const titleMax = (state.badge ? w * 0.58 : w * 0.72);
  let size = h * 0.52;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px Anton, 'Arial Black', sans-serif`;
  while (ctx.measureText(title).width > titleMax && size > 10) {
    size -= 2;
    ctx.font = `${size}px Anton, 'Arial Black', sans-serif`;
  }
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.strokeStyle = '#14061f';
  ctx.strokeText(title, x + pad, y + h * 0.42);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, x + pad, y + h * 0.42);
  const sub = (state.subtitle || '').trim();
  if (sub) {
    ctx.font = `${Math.round(h * 0.3)}px Pacifico, cursive`;
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(sub, x + pad, y + h * 0.82);
  }
  if (state.badge) {
    const label = state.badge.trim().toUpperCase();
    ctx.font = `bold ${Math.round(h * 0.2)}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width;
    const bw = tw + h * 0.5;
    const bx = x + w - bw - pad;
    const by = y + h * 0.16;
    const bh = h * 0.3;
    ctx.fillStyle = 'rgba(20,6,31,0.85)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    ctx.textAlign = 'left';
  }
}

// Centre cell of the nine-panel layout becomes the title block.
function drawTitleCell(ctx, cell, state) {
  const stops = GRADES[state.grade] || GRADES.sunset;
  const g = ctx.createLinearGradient(cell.x, cell.y, cell.x + cell.w, cell.y + cell.h);
  g.addColorStop(0, stops[0]);
  g.addColorStop(1, stops[2]);
  ctx.fillStyle = g;
  ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
  const title = (state.title || 'NEON COAST').trim().toUpperCase() || 'NEON COAST';
  const words = title.split(/\s+/);
  let size = cell.w * 0.22;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px Anton, 'Arial Black', sans-serif`;
  const widest = Math.max(...words.map((wd) => ctx.measureText(wd).width));
  size = Math.min(size, (cell.w * 0.82) / Math.max(1, widest / size));
  ctx.font = `${size}px Anton, 'Arial Black', sans-serif`;
  const lineH = size * 1.05;
  const startY = cell.y + cell.h / 2 - ((words.length - 1) * lineH) / 2;
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.strokeStyle = '#14061f';
  ctx.fillStyle = '#ffffff';
  words.forEach((wd, i) => {
    const yy = startY + i * lineH;
    ctx.strokeText(wd, cell.x + cell.w / 2, yy);
    ctx.fillText(wd, cell.x + cell.w / 2, yy);
  });
  const sub = (state.subtitle || '').trim();
  if (sub) {
    ctx.font = `${Math.round(cell.w * 0.09)}px Pacifico, cursive`;
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(sub, cell.x + cell.w / 2, cell.y + cell.h - cell.h * 0.1);
  }
}

/** Draw the whole cover for `state` onto `canvas` (at the canvas's own size). */
export function drawCover(canvas, state) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const { panels, title, frame, gap } = layoutPanels(w, h, state.layout);
  ctx.fillStyle = '#f5efe6';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#14061f';
  ctx.fillRect(0, 0, w, h);
  panels.forEach((panel, i) => {
    if (state.layout === 'nine' && i === 4) {
      drawTitleCell(ctx, panel, state);
      return;
    }
    const spec = state.panels[i] || { photo: 0, zoom: 1, ox: 0, oy: 0 };
    const photo = state.photos[spec.photo] || null;
    drawPanel(ctx, photo, panel, state.grade);
    // Inked panel edge + thin white inner line, poster style.
    ctx.strokeStyle = '#14061f';
    ctx.lineWidth = Math.max(3, gap * 0.7);
    ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1, w * 0.0012);
    ctx.strokeRect(panel.x + 4, panel.y + 4, panel.w - 8, panel.h - 8);
  });
  if (title) drawTitleBand(ctx, title, state);
  grain(ctx, w, h);
  vignette(ctx, w, h);
  // Outer white frame.
  ctx.strokeStyle = '#f5efe6';
  ctx.lineWidth = frame;
  ctx.strokeRect(frame / 2, frame / 2, w - frame, h - frame);
  return { panels, title, frame, gap };
}
