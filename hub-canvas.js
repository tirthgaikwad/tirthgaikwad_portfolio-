// ==========================================
// HUB-CANVAS.JS — The planning canvas of Project Hub: shapes, freehand drawing, connectors, frames and pictures on an SVG board.
// This file holds the state, how each shape is drawn, saving (only what changed, merged on the server), undo and the view.
// Pointer and keyboard handling, the style bar and menus are in hub-canvas-tools.js; pictures, task links, export, present
// mode, teammates' cursors, versions and the minimap in hub-canvas-extras.js; ready-made starters in hub-canvas-templates.js.
// Loaded after project-hub.js, which calls initCanvas(), renderCanvas(), loadCanvasShapes() and flushCanvasSave().
// ==========================================

const CANVAS_PALETTE = {
  indigo: { stroke: '#4f46e5', fill: '#eef2ff', solid: '#c7d2fe', name: 'Indigo' },
  violet: { stroke: '#7c3aed', fill: '#f5f3ff', solid: '#ddd6fe', name: 'Violet' },
  sky: { stroke: '#0284c7', fill: '#f0f9ff', solid: '#bae6fd', name: 'Sky' },
  teal: { stroke: '#0d9488', fill: '#f0fdfa', solid: '#99f6e4', name: 'Teal' },
  green: { stroke: '#059669', fill: '#ecfdf5', solid: '#a7f3d0', name: 'Green' },
  amber: { stroke: '#d97706', fill: '#fffbeb', solid: '#fde68a', name: 'Amber' },
  orange: { stroke: '#ea580c', fill: '#fff7ed', solid: '#fed7aa', name: 'Orange' },
  rose: { stroke: '#e11d48', fill: '#fff1f2', solid: '#fecdd3', name: 'Rose' },
  slate: { stroke: '#475569', fill: '#f8fafc', solid: '#e2e8f0', name: 'Slate' },
  black: { stroke: '#0b1c30', fill: '#ffffff', solid: '#cbd5e1', name: 'Black' }
};
const CV_SHAPE_TYPES = ['rectangle', 'circle', 'diamond', 'triangle', 'parallelogram', 'hexagon', 'star', 'callout', 'database'];
const DEFAULT_SIZES = {
  rectangle: [150, 80], circle: [120, 120], database: [120, 130], sticky: [160, 120], text: [180, 44], diamond: [140, 100],
  triangle: [120, 100], parallelogram: [160, 80], hexagon: [140, 90], star: [120, 120], callout: [180, 110], frame: [480, 320]
};
const CV_FONT = { S: 12, M: 14, L: 20, XL: 28 };
const CV_GRID = 24;
const CV_MAX_UNDO = 100;
const CV_MIN_SCALE = 0.1;
const CV_MAX_SCALE = 4;
const CV_TASK_STATUS = { todo: 'To do', inprogress: 'In progress', review: 'Review', done: 'Done' };

let canvasShapes = [];
let canvasSelection = new Set();
let canvasTool = 'select';
let canvasKeepTool = false;        // keep the drawing tool after drawing a shape, instead of going back to Select
let canvasView = { x: 0, y: 0, scale: 1 };
let canvasDrag = null;             // what the pointer is doing right now (move, resize, draw, pan, marquee...)
let canvasDirty = false;
let canvasVersion = 0;             // increases with every local change, so a save knows if newer edits happened meanwhile
let canvasSaveTimer = null;
let canvasSaving = false;
let canvasPending = cvEmptyPending();
let canvasUndo = [];
let canvasRedo = [];
let canvasTxn = null;              // the canvas as it was when the current change began (for undo and for saving)
let canvasEditingId = null;        // the shape whose text is open in the editor
let canvasSnapGrid = false;
let canvasRenderQueued = false;

function cvEmptyPending() {
  // What this person changed since the last save. replace: a reason when the whole canvas must be sent (clear, open a copy)
  return { upsert: new Set(), remove: new Set(), order: false, replace: '' };
}

// ==========================================
// 1. SHAPE HELPERS
// ==========================================
function isLineShape(shape) { return shape.type === 'arrow' || shape.type === 'line'; }
function isInkShape(shape) { return shape.type === 'pen' || shape.type === 'highlighter'; }
function cvShape(id) { return canvasShapes.find(s => s.id === id) || null; }
function cvIndex(id) { return canvasShapes.findIndex(s => s.id === id); }
function cvClone(value) { return JSON.parse(JSON.stringify(value)); }
function cvSelected() { return canvasShapes.filter(s => canvasSelection.has(s.id)); }
function cvRound(value) { return Math.round(value * 10) / 10; }
function cvPalette(shape) { return CANVAS_PALETTE[shape.color] || CANVAS_PALETTE.indigo; }
function cvHasText(shape) { return !isInkShape(shape) && shape.type !== 'image'; }

// The same checks the server makes, for shapes that have not been through it yet (a copy file opened from disk):
// numbers stay numbers and every choice is one the board knows, so nothing from the file can reach the page as markup.
const CV_TYPES = CV_SHAPE_TYPES.concat(['sticky', 'text', 'arrow', 'line', 'pen', 'highlighter', 'frame', 'image']);
const CV_CHOICES = {
  fill: ['none', 'light', 'solid'], stroke_width: [1, 2, 4, 8], dash: ['solid', 'dashed', 'dotted'], font: ['S', 'M', 'L', 'XL'],
  align: ['left', 'center', 'right'], route: ['straight', 'elbow', 'curved'], head_start: ['none', 'arrow', 'triangle', 'dot'],
  head_end: ['none', 'arrow', 'triangle', 'dot'], corners: ['sharp', 'round']
};
function cvSanitizeShape(raw) {
  if (!raw || typeof raw !== 'object' || !CV_TYPES.includes(raw.type)) return null;
  const number = (value, low = -20000, high = 20000) => { const n = Number(value); return Number.isFinite(n) ? Math.max(low, Math.min(high, Math.round(n * 10) / 10)) : 0; };
  const ref = (value) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : null);
  const shape = { id: ref(raw.id) || newTempId(), type: raw.type, text: String(raw.text || '').slice(0, 500), color: raw.color in CANVAS_PALETTE ? raw.color : 'indigo' };
  ['x', 'y', 'w', 'h', 'x2', 'y2'].forEach(key => { shape[key] = number(raw[key]); });
  Object.entries(CV_CHOICES).forEach(([key, allowed]) => { if (allowed.includes(raw[key])) shape[key] = raw[key]; });
  if (raw.opacity !== undefined) shape.opacity = number(raw.opacity, 0.1, 1);
  if (raw.rot) shape.rot = number(raw.rot, -360, 360);
  if (raw.locked === true) shape.locked = true;
  ['start_id', 'end_id', 'group_id'].forEach(key => { if (ref(raw[key])) shape[key] = raw[key]; });
  if (raw.label) shape.label = String(raw.label).slice(0, 100);
  if (Number.isInteger(raw.task_id) && raw.task_id > 0) shape.task_id = raw.task_id;
  if (isInkShape(shape)) {
    if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length % 2 || raw.points.length > 4000) return null;
    shape.points = raw.points.map(v => number(v));
  }
  if (shape.type === 'image') {
    if (typeof raw.src !== 'string' || !/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(raw.src)) return null;
    shape.src = raw.src;
  }
  return shape;
}

// Fill, stroke and text size: what the shape says, else the default for its type
function cvFillMode(shape) {
  if (shape.fill) return shape.fill;
  if (shape.type === 'sticky') return 'solid';
  if (shape.type === 'text' || shape.type === 'image') return 'none';
  return 'light';
}
function cvFillColor(shape, forExport) {
  const mode = cvFillMode(shape);
  const palette = cvPalette(shape);
  if (mode === 'solid') return { fill: palette.solid };
  if (mode === 'light') return { fill: shape.type === 'frame' ? '#ffffff' : palette.fill };
  // An empty inside can still be clicked on the board; it is left out of exports
  return forExport ? { fill: 'none' } : { fill: '#ffffff', opacity: 0.001 };
}
function cvStrokeWidth(shape) {
  const width = shape.stroke_width || (shape.type === 'frame' ? 1 : 2);
  return shape.type === 'highlighter' ? width * 4 : width;
}
function cvDashArray(shape, width) {
  if (shape.dash === 'dashed') return `${width * 4} ${width * 3}`;
  if (shape.dash === 'dotted') return `0.1 ${width * 2.5}`;
  return '';
}
function cvFontSize(shape) {
  if (shape.font) return CV_FONT[shape.font] * (shape.type === 'text' ? 1.15 : 1);
  return shape.type === 'text' ? 16 : 13;
}
function cvCorners(shape) {
  return shape.corners || (shape.type === 'rectangle' || shape.type === 'frame' ? 'round' : 'sharp');
}
function cvHeads(shape) {
  return {
    start: shape.head_start || 'none',
    end: shape.head_end || (shape.type === 'arrow' ? 'triangle' : 'none')
  };
}

// ==========================================
// 2. GEOMETRY
// ==========================================
function cvCenter(shape) { return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 }; }

function cvRotatePoint(point, center, degrees) {
  if (!degrees) return { x: point.x, y: point.y };
  const r = degrees * Math.PI / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * Math.cos(r) - dy * Math.sin(r), y: center.y + dx * Math.sin(r) + dy * Math.cos(r) };
}

// Where a connector meets the edge of a shape, on the way from its centre towards a point
function cvEdgePoint(shape, toward, gap = 6) {
  const c = cvCenter(shape);
  const local = cvRotatePoint(toward, c, -(shape.rot || 0));
  const dx = local.x - c.x;
  const dy = local.y - c.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return c;
  const rx = Math.max(1, shape.w / 2);
  const ry = Math.max(1, shape.h / 2);
  let t;
  if (shape.type === 'circle') t = 1 / Math.hypot(dx / rx, dy / ry);
  else if (shape.type === 'diamond') t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  else t = Math.min(Math.abs(dx) > 0.001 ? rx / Math.abs(dx) : Infinity, Math.abs(dy) > 0.001 ? ry / Math.abs(dy) : Infinity);
  t = Math.min(1, t + gap / length);
  return cvRotatePoint({ x: c.x + dx * t, y: c.y + dy * t }, c, shape.rot || 0);
}

// The two ends of a line; an end tied to a shape follows that shape
function cvLineEnds(shape) {
  const startShape = shape.start_id ? cvShape(shape.start_id) : null;
  const endShape = shape.end_id ? cvShape(shape.end_id) : null;
  let a = { x: shape.x, y: shape.y };
  let b = { x: shape.x2, y: shape.y2 };
  const aimFromStart = endShape ? cvCenter(endShape) : b;
  const aimFromEnd = startShape ? cvCenter(startShape) : a;
  if (startShape && !isLineShape(startShape)) a = cvEdgePoint(startShape, aimFromStart);
  if (endShape && !isLineShape(endShape)) b = cvEdgePoint(endShape, aimFromEnd);
  return { a, b };
}

function cvLineGeometry(shape) {
  const { a, b } = cvLineEnds(shape);
  const route = shape.route || 'straight';
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const across = Math.abs(dx) >= Math.abs(dy);
  const n = (v) => cvRound(v);
  if (route === 'elbow') {
    const corners = across
      ? [{ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }]
      : [{ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }];
    const points = [a, corners[0], corners[1], b];
    return { d: 'M' + points.map(p => `${n(p.x)},${n(p.y)}`).join(' L'), a, b, points,
      mid: { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 } };
  }
  if (route === 'curved') {
    const c1 = across ? { x: a.x + dx / 2, y: a.y } : { x: a.x, y: a.y + dy / 2 };
    const c2 = across ? { x: b.x - dx / 2, y: b.y } : { x: b.x, y: b.y - dy / 2 };
    const mid = { x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8, y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8 };
    return { d: `M${n(a.x)},${n(a.y)} C${n(c1.x)},${n(c1.y)} ${n(c2.x)},${n(c2.y)} ${n(b.x)},${n(b.y)}`, a, b, points: [a, c1, c2, b], mid };
  }
  return { d: `M${n(a.x)},${n(a.y)} L${n(b.x)},${n(b.y)}`, a, b, points: [a, b], mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

// A smooth path through the points of a freehand drawing (points are relative to the shape's top-left)
function cvInkPath(shape) {
  const p = shape.points || [];
  const count = p.length / 2;
  const X = (i) => cvRound(shape.x + p[i * 2]);
  const Y = (i) => cvRound(shape.y + p[i * 2 + 1]);
  if (count === 0) return '';
  if (count === 1) return `M${X(0)},${Y(0)} L${X(0)},${Y(0)}`;
  if (count === 2) return `M${X(0)},${Y(0)} L${X(1)},${Y(1)}`;
  let d = `M${X(0)},${Y(0)}`;
  for (let i = 1; i < count - 1; i++) {
    d += ` Q${X(i)},${Y(i)} ${cvRound((X(i) + X(i + 1)) / 2)},${cvRound((Y(i) + Y(i + 1)) / 2)}`;
  }
  return d + ` L${X(count - 1)},${Y(count - 1)}`;
}

// The box a shape covers on the board, after rotation
function shapeBounds(shape) {
  if (isLineShape(shape)) {
    const points = cvLineGeometry(shape).points;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  const c = cvCenter(shape);
  const corners = [[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]]
    .map(([x, y]) => cvRotatePoint({ x, y }, c, shape.rot || 0));
  const pad = isInkShape(shape) ? cvStrokeWidth(shape) / 2 : 0;
  return {
    minX: Math.min(...corners.map(p => p.x)) - pad, minY: Math.min(...corners.map(p => p.y)) - pad,
    maxX: Math.max(...corners.map(p => p.x)) + pad, maxY: Math.max(...corners.map(p => p.y)) + pad
  };
}

function cvBoundsOf(shapes) {
  if (!shapes.length) return null;
  const all = shapes.map(shapeBounds);
  return {
    minX: Math.min(...all.map(b => b.minX)), minY: Math.min(...all.map(b => b.minY)),
    maxX: Math.max(...all.map(b => b.maxX)), maxY: Math.max(...all.map(b => b.maxY))
  };
}

function canvasBounds() { return cvBoundsOf(canvasShapes); }

function cvInside(inner, outer) {
  return inner.minX >= outer.minX && inner.minY >= outer.minY && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;
}

// Shapes that sit fully inside a frame move with it
function cvFrameContents(frame) {
  const box = shapeBounds(frame);
  return canvasShapes.filter(s => s.id !== frame.id && s.type !== 'frame' && cvInside(shapeBounds(s), box));
}

// ==========================================
// 3. DRAWING SHAPES AS SVG
// ==========================================
function wrapShapeText(text, width, height, fontSize) {
  const perLine = Math.max(4, Math.floor((width - 12) / (fontSize * 0.56)));
  const maxLines = Math.max(1, Math.floor((height - 6) / (fontSize * 1.3)));
  const lines = [];
  String(text || '').split('\n').forEach(paragraph => {
    let line = '';
    paragraph.split(/\s+/).forEach(word => {
      while (word.length > perLine) {   // a single very long word is cut
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, perLine));
        word = word.slice(perLine);
      }
      if ((line + ' ' + word).trim().length > perLine) { lines.push(line); line = word; }
      else line = (line + ' ' + word).trim();
    });
    lines.push(line);
  });
  const kept = lines.filter((l, i) => l || i < lines.length - 1).slice(0, maxLines);
  if (lines.length > maxLines && kept.length) kept[kept.length - 1] = kept[kept.length - 1].slice(0, Math.max(1, perLine - 1)) + '…';
  return kept;
}

function shapeLabelSvg(shape, area, weight, color) {
  const fontSize = cvFontSize(shape);
  const lines = wrapShapeText(shape.text, area.w, area.h, fontSize);
  if (lines.length === 0) return '';
  const align = shape.align || 'center';
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const x = align === 'left' ? area.x + 8 : align === 'right' ? area.x + area.w - 8 : area.x + area.w / 2;
  const lineHeight = fontSize * 1.3;
  const startY = area.y + area.h / 2 - ((lines.length - 1) * lineHeight) / 2;
  return `<text x="${cvRound(x)}" y="${cvRound(startY)}" text-anchor="${anchor}" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${color || '#0b1c30'}" style="pointer-events:none; user-select:none;">${lines.map((line, i) => `<tspan x="${cvRound(x)}" dy="${i === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function cvPolygonPoints(shape) {
  const { x, y, w, h } = shape;
  if (shape.type === 'diamond') return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
  if (shape.type === 'triangle') return [[x + w / 2, y], [x + w, y + h], [x, y + h]];
  if (shape.type === 'parallelogram') {
    const skew = Math.min(w * 0.25, h * 0.6);
    return [[x + skew, y], [x + w, y], [x + w - skew, y + h], [x, y + h]];
  }
  if (shape.type === 'hexagon') {
    const inset = Math.min(w * 0.25, h * 0.5);
    return [[x + inset, y], [x + w - inset, y], [x + w, y + h / 2], [x + w - inset, y + h], [x + inset, y + h], [x, y + h / 2]];
  }
  if (shape.type === 'star') {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 5;
      const radius = i % 2 === 0 ? 1 : 0.45;
      points.push([x + w / 2 + Math.cos(angle) * radius * w / 2, y + h / 2 + Math.sin(angle) * radius * h / 2]);
    }
    return points;
  }
  return [];
}

// The part of a shape where its text goes
function cvTextArea(shape) {
  const { x, y, w, h } = shape;
  if (shape.type === 'database') { const r = Math.min(14, h / 5); return { x, y: y + r, w, h: h - r }; }
  if (shape.type === 'diamond') return { x: x + w / 4, y: y + h / 4, w: w / 2, h: h / 2 };
  if (shape.type === 'triangle') return { x: x + w / 4, y: y + h / 2, w: w / 2, h: h / 2 };
  if (shape.type === 'hexagon' || shape.type === 'parallelogram') return { x: x + Math.min(w * 0.2, h * 0.5), y, w: w - 2 * Math.min(w * 0.2, h * 0.5), h };
  if (shape.type === 'star') return { x: x + w / 4, y: y + h / 3, w: w / 2, h: h / 2.4 };
  if (shape.type === 'callout') return { x, y, w, h: h * 0.78 };
  return { x, y, w, h };
}

function cvTaskChipSvg(shape) {
  if (!shape.task_id || !hub) return '';
  const task = (hub.tasks || []).find(t => t.id === shape.task_id);
  const label = task ? (CV_TASK_STATUS[task.column] || 'To do') : 'Task removed';
  const colors = !task ? ['#ffdad6', '#93000a'] : task.column === 'done' ? ['#d1fae5', '#047857'] : task.column === 'inprogress' ? ['#e2dfff', '#3525cd'] : task.column === 'review' ? ['#dae2fd', '#3f465c'] : ['#e5eeff', '#464555'];
  const width = label.length * 6.2 + 22;
  const x = shape.x + shape.w - width - 6;
  const y = shape.y + 6;
  return `<g class="cv-task-chip" data-task-chip="${escapeHtml(shape.id)}"><title>${escapeHtml(task ? task.title : 'The linked task was deleted')}</title>`
    + `<rect x="${cvRound(x)}" y="${cvRound(y)}" width="${cvRound(width)}" height="18" rx="9" fill="${colors[0]}"/>`
    + `<circle cx="${cvRound(x + 9)}" cy="${cvRound(y + 9)}" r="3" fill="${colors[1]}"/>`
    + `<text x="${cvRound(x + 16)}" y="${cvRound(y + 9)}" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-size="10.5" font-weight="600" fill="${colors[1]}">${escapeHtml(label)}</text></g>`;
}

function cvMarker(kind, color, end) {
  return kind && kind !== 'none' ? ` marker-${end}="url(#cv-head-${kind}-${color in CANVAS_PALETTE ? color : 'indigo'})"` : '';
}

// opts: { forExport, fade: Set of ids drawn faint (being erased), imageUrl(src) for pictures }
function shapeSvg(shape, opts = {}) {
  const palette = cvPalette(shape);
  const { x, y, w, h } = shape;
  const width = cvStrokeWidth(shape);
  const dash = cvDashArray(shape, width);
  const dashAttr = dash ? ` stroke-dasharray="${dash}"${shape.dash === 'dotted' ? ' stroke-linecap="round"' : ''}` : '';
  const fillInfo = cvFillColor(shape, opts.forExport);
  const fillAttr = `fill="${fillInfo.fill}"${fillInfo.opacity !== undefined ? ` fill-opacity="${fillInfo.opacity}"` : ''}`;
  const strokeAttr = `stroke="${palette.stroke}" stroke-width="${width}"${dashAttr}`;
  const showText = shape.id !== canvasEditingId || opts.forExport;
  const label = (area, weight, color) => (showText ? shapeLabelSvg(shape, area, weight, color) : '');
  let body = '';

  if (shape.type === 'rectangle') {
    body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${cvCorners(shape) === 'round' ? 8 : 0}" ${fillAttr} ${strokeAttr}/>` + label(shape, 600);
  } else if (shape.type === 'circle') {
    body = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${fillAttr} ${strokeAttr}/>` + label(shape, 600);
  } else if (['diamond', 'triangle', 'parallelogram', 'hexagon', 'star'].includes(shape.type)) {
    body = `<polygon points="${cvPolygonPoints(shape).map(([px, py]) => `${cvRound(px)},${cvRound(py)}`).join(' ')}" stroke-linejoin="round" ${fillAttr} ${strokeAttr}/>` + label(cvTextArea(shape), 600);
  } else if (shape.type === 'callout') {
    const bodyH = h * 0.78;
    const r = Math.min(10, w / 6, bodyH / 3);
    const tailX = x + Math.min(w * 0.22, 40);
    const d = `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + bodyH - r} Q${x + w},${y + bodyH} ${x + w - r},${y + bodyH}`
      + ` H${tailX + 22} L${tailX},${y + h} L${tailX + 6},${y + bodyH} H${x + r} Q${x},${y + bodyH} ${x},${y + bodyH - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
    body = `<path d="${d}" stroke-linejoin="round" ${fillAttr} ${strokeAttr}/>` + label(cvTextArea(shape), 600);
  } else if (shape.type === 'database') {
    const r = Math.min(14, h / 5);
    body = `<path d="M${x},${y + r} v${h - 2 * r} a${w / 2},${r} 0 0 0 ${w},0 v${-(h - 2 * r)}" ${fillAttr} ${strokeAttr}/>`
      + `<ellipse cx="${x + w / 2}" cy="${y + r}" rx="${w / 2}" ry="${r}" ${fillAttr} ${strokeAttr}/>`
      + label(cvTextArea(shape), 600);
  } else if (shape.type === 'sticky') {
    body = `<rect x="${x + 2}" y="${y + 3}" width="${w}" height="${h}" rx="4" fill="#0b1c30" fill-opacity="0.06"/>`
      + `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" ${fillAttr} stroke="${palette.stroke}" stroke-opacity="0.35" stroke-width="1"/>` + label(shape, 500);
  } else if (shape.type === 'text') {
    body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${fillAttr}/>`
      + (shape.text ? label(shape, 700, palette.stroke)
        : (opts.forExport || !showText ? '' : `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-size="13" fill="#777587" style="pointer-events:none;">Double-click to type</text>`));
  } else if (shape.type === 'frame') {
    const title = shape.text || 'Frame';
    // Only the border and the title pick the frame, so dragging inside a frame selects what is in it
    body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${cvCorners(shape) === 'round' ? 12 : 0}" ${fillAttr} stroke="${palette.stroke}" stroke-opacity="0.55" stroke-width="${width}"${dashAttr} pointer-events="none"/>`
      + (opts.forExport ? '' : `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-opacity="0.001" stroke-width="${12 / canvasView.scale}" pointer-events="stroke"/>`)
      + (showText ? `<text x="${x + 2}" y="${y - 8}" font-family="Inter, Arial, sans-serif" font-size="${cvFontSize(shape)}" font-weight="600" fill="${palette.stroke}" data-frame-title="1" style="user-select:none;">${escapeHtml(title.slice(0, 80))}</text>` : '');
  } else if (shape.type === 'image') {
    const url = opts.imageUrl ? opts.imageUrl(shape.src) : '';
    body = url
      ? `<image href="${escapeHtml(url)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#eff4ff" stroke="#c7c4d8" stroke-dasharray="6 4"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-size="12" fill="#777587">${opts.imageFailed && opts.imageFailed(shape.src) ? 'Picture not available' : 'Loading picture…'}</text>`;
    if (shape.stroke_width || shape.dash) body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" ${strokeAttr}/>`;
  } else if (isInkShape(shape)) {
    const d = cvInkPath(shape);
    body = (opts.forExport ? '' : `<path d="${d}" fill="none" stroke="#000" stroke-opacity="0.001" stroke-width="${Math.max(width, 14 / canvasView.scale)}" stroke-linecap="round" stroke-linejoin="round"/>`)
      + `<path d="${d}" fill="none" stroke="${palette.stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${shape.type === 'highlighter' ? ' stroke-opacity="0.35"' : ''}${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  } else {
    const geometry = cvLineGeometry(shape);
    const heads = cvHeads(shape);
    const markers = cvMarker(heads.start, shape.color, 'start') + cvMarker(heads.end, shape.color, 'end');
    body = (opts.forExport ? '' : `<path d="${geometry.d}" fill="none" stroke="#000" stroke-opacity="0.001" stroke-width="${16 / canvasView.scale}"/>`)
      + `<path d="${geometry.d}" fill="none" stroke="${palette.stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}${markers}/>`;
    if (shape.label && showText) {
      const fontSize = cvFontSize(shape);
      const labelWidth = Math.min(240, shape.label.length * fontSize * 0.58 + 12);
      body += `<rect x="${cvRound(geometry.mid.x - labelWidth / 2)}" y="${cvRound(geometry.mid.y - fontSize * 0.85)}" width="${cvRound(labelWidth)}" height="${cvRound(fontSize * 1.7)}" rx="4" fill="#ffffff"/>`
        + `<text x="${cvRound(geometry.mid.x)}" y="${cvRound(geometry.mid.y)}" text-anchor="middle" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="500" fill="#0b1c30" style="pointer-events:none;">${escapeHtml(shape.label.slice(0, 40))}</text>`;
    }
  }
  if (cvHasText(shape) && shape.task_id && shape.type !== 'frame') body += cvTaskChipSvg(shape);

  const faded = opts.fade && opts.fade.has(shape.id);
  const opacity = (shape.opacity || 1) * (faded ? 0.25 : 1);
  const rotate = shape.rot && !isLineShape(shape) ? ` transform="rotate(${shape.rot} ${cvRound(x + w / 2)} ${cvRound(y + h / 2)})"` : '';
  return `<g class="shape${shape.locked ? ' is-locked' : ''}" data-shape-id="${escapeHtml(shape.id)}"${opacity < 1 ? ` opacity="${cvRound(opacity * 100) / 100}"` : ''}${rotate}>${body}</g>`;
}

// Frames at the back, then highlighter strokes, then everything else in its own order
function cvDrawOrder(shapes) {
  const rank = (s) => (s.type === 'frame' ? 0 : s.type === 'highlighter' ? 1 : 2);
  return shapes.slice().sort((a, b) => rank(a) - rank(b));
}

function canvasDefsSvg() {
  return '<defs>' + Object.entries(CANVAS_PALETTE).map(([name, p]) =>
    `<marker id="cv-head-triangle-${name}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0,0 L10,4 L0,8 z" fill="${p.stroke}"/></marker>`
    + `<marker id="cv-head-arrow-${name}" markerWidth="10" markerHeight="10" refX="8.5" refY="5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M1,1 L9,5 L1,9" fill="none" stroke="${p.stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>`
    + `<marker id="cv-head-dot-${name}" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto" markerUnits="strokeWidth"><circle cx="4" cy="4" r="3" fill="${p.stroke}"/></marker>`).join('') + '</defs>';
}

const CV_HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };

function cvHandlesSvg(box, rotatable) {
  const size = 9 / canvasView.scale;
  let out = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="#3525cd" stroke-width="${1.2 / canvasView.scale}" stroke-dasharray="${4 / canvasView.scale}" style="pointer-events:none;"/>`;
  Object.entries(CV_HANDLES).forEach(([name, [fx, fy]]) => {
    out += `<rect class="handle" data-handle="${name}" style="cursor:${name.length === 2 ? (name === 'nw' || name === 'se' ? 'nwse' : 'nesw') : (name === 'n' || name === 's' ? 'ns' : 'ew')}-resize" x="${box.x + box.w * fx - size / 2}" y="${box.y + box.h * fy - size / 2}" width="${size}" height="${size}" rx="${2 / canvasView.scale}"/>`;
  });
  if (rotatable) {
    const cx = box.x + box.w / 2;
    const top = box.y - 26 / canvasView.scale;
    out += `<line x1="${cx}" y1="${box.y}" x2="${cx}" y2="${top}" stroke="#3525cd" stroke-width="${1.2 / canvasView.scale}" style="pointer-events:none;"/>`
      + `<circle class="handle rotate" data-handle="rotate" cx="${cx}" cy="${top}" r="${size * 0.65}"/>`;
  }
  return out;
}

function selectionSvg() {
  const selected = cvSelected();
  if (!selected.length) return '';
  const thin = 1.2 / canvasView.scale;
  if (selected.length === 1) {
    const shape = selected[0];
    if (isLineShape(shape)) {
      const { a, b } = cvLineEnds(shape);
      const size = 9 / canvasView.scale;
      return shape.locked ? '' : `<circle class="handle end" data-handle="start" cx="${a.x}" cy="${a.y}" r="${size * 0.6}"/><circle class="handle end" data-handle="end" cx="${b.x}" cy="${b.y}" r="${size * 0.6}"/>`;
    }
    const box = { x: shape.x - 3, y: shape.y - 3, w: shape.w + 6, h: shape.h + 6 };
    const inner = shape.locked
      ? `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="none" stroke="#777587" stroke-width="${thin}" stroke-dasharray="${4 / canvasView.scale}" style="pointer-events:none;"/>`
      : cvHandlesSvg(box, true);
    const c = cvCenter(shape);
    return `<g${shape.rot ? ` transform="rotate(${shape.rot} ${cvRound(c.x)} ${cvRound(c.y)})"` : ''}>${inner}</g>`;
  }
  // Several: a thin outline round each one and one box with handles round all of them
  let out = selected.map(s => {
    const b = shapeBounds(s);
    return `<rect x="${b.minX}" y="${b.minY}" width="${b.maxX - b.minX}" height="${b.maxY - b.minY}" fill="none" stroke="#4f46e5" stroke-opacity="0.6" stroke-width="${thin}" style="pointer-events:none;"/>`;
  }).join('');
  const all = cvBoundsOf(selected);
  const box = { x: all.minX - 4, y: all.minY - 4, w: all.maxX - all.minX + 8, h: all.maxY - all.minY + 8 };
  out += selected.every(s => s.locked) ? '' : cvHandlesSvg(box, false);
  return out;
}

// Things drawn over the shapes while dragging: the selection rectangle, alignment guides and the shape a connector will join
function cvDragOverlaySvg() {
  const drag = canvasDrag;
  if (!drag) return '';
  const thin = 1 / canvasView.scale;
  let out = '';
  if (drag.kind === 'marquee' && drag.rect) {
    const r = drag.rect;
    out += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#4f46e5" fill-opacity="0.06" stroke="#4f46e5" stroke-width="${thin}" stroke-dasharray="${4 / canvasView.scale}" style="pointer-events:none;"/>`;
  }
  (drag.guides || []).forEach(g => {
    out += `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="#e11d48" stroke-width="${thin}" style="pointer-events:none;"/>`;
  });
  if (drag.bindTarget) {
    const target = cvShape(drag.bindTarget);
    if (target) {
      const b = shapeBounds(target);
      out += `<rect x="${b.minX - 5}" y="${b.minY - 5}" width="${b.maxX - b.minX + 10}" height="${b.maxY - b.minY + 10}" rx="${6 / canvasView.scale}" fill="none" stroke="#4f46e5" stroke-opacity="0.5" stroke-width="${3 / canvasView.scale}" style="pointer-events:none;"/>`;
    }
  }
  return out;
}

function renderCanvas() {
  canvasRenderQueued = false;
  const layer = el('canvas-layer');
  if (!layer) return;
  layer.setAttribute('transform', `translate(${canvasView.x} ${canvasView.y}) scale(${canvasView.scale})`);
  // On a big board, only what is near the screen is drawn
  let shapes = canvasShapes;
  if (shapes.length > 300) {
    const rect = el('canvas-svg').getBoundingClientRect();
    const margin = 200 / canvasView.scale;
    const view = {
      minX: -canvasView.x / canvasView.scale - margin, minY: -canvasView.y / canvasView.scale - margin,
      maxX: (rect.width - canvasView.x) / canvasView.scale + margin, maxY: (rect.height - canvasView.y) / canvasView.scale + margin
    };
    shapes = shapes.filter(s => {
      const b = shapeBounds(s);
      return canvasSelection.has(s.id) || (b.maxX >= view.minX && b.minX <= view.maxX && b.maxY >= view.minY && b.minY <= view.maxY);
    });
  }
  const opts = { fade: canvasDrag && canvasDrag.erasing, imageUrl: cvImageUrl, imageFailed: cvImageFailed };
  layer.innerHTML = cvDrawOrder(shapes).map(s => shapeSvg(s, opts)).join('') + cvPeerSelectionSvg() + selectionSvg() + cvDragOverlaySvg() + cvLaserSvg();
  el('canvas-hint').classList.toggle('hidden', canvasShapes.length > 0 || !!canvasDrag);
  el('zoom-label').textContent = `${Math.round(canvasView.scale * 100)}%`;
  const area = el('canvas-area');
  area.style.backgroundSize = `${CV_GRID * canvasView.scale}px ${CV_GRID * canvasView.scale}px`;
  area.style.backgroundPosition = `${canvasView.x}px ${canvasView.y}px`;
  cvAfterRender();
}

// For pointer moves: draw at most once per screen frame
function cvRequestRender() {
  if (canvasRenderQueued) return;
  canvasRenderQueued = true;
  requestAnimationFrame(() => { if (canvasRenderQueued) renderCanvas(); });
}

// ==========================================
// 4. CHANGES, UNDO AND SAVING
// ==========================================
function cvSnapshot() {
  return { map: new Map(canvasShapes.map(s => [s.id, JSON.stringify(s)])), order: canvasShapes.map(s => s.id) };
}

// Every change to the shapes runs between canvasBegin() and canvasCommit(): the difference becomes one undo step and is saved
function canvasBegin() {
  if (!canvasTxn) canvasTxn = cvSnapshot();
}

function canvasCommit() {
  const before = canvasTxn;
  canvasTxn = null;
  if (!before) return false;
  cvSyncBoundLines();
  const entry = cvDiff(before, cvSnapshot());
  if (!entry) { renderCanvas(); return false; }
  canvasUndo.push(entry);
  if (canvasUndo.length > CV_MAX_UNDO) canvasUndo.shift();
  canvasRedo = [];
  cvMarkEntry(entry, false);
  markCanvasDirty();
  renderCanvas();
  return true;
}

// Runs a change made in one go (a button, a key)
function canvasChange(action) {
  canvasBegin();
  try { action(); } finally { canvasCommit(); }
}

function cvDiff(before, after) {
  const changed = [];
  const ids = new Set([...before.map.keys(), ...after.map.keys()]);
  ids.forEach(id => {
    const was = before.map.get(id) || null;
    const now = after.map.get(id) || null;
    if (was !== now) changed.push({ id, before: was, after: now });
  });
  const keptBefore = before.order.filter(id => after.map.has(id)).join('\n');
  const keptAfter = after.order.filter(id => before.map.has(id)).join('\n');
  const orderChanged = keptBefore !== keptAfter;
  if (!changed.length && !orderChanged) return null;
  return { changed, beforeOrder: before.order, afterOrder: after.order, orderChanged };
}

function cvMarkEntry(entry, undoing) {
  entry.changed.forEach(c => {
    const now = undoing ? c.before : c.after;
    if (now) { canvasPending.upsert.add(c.id); canvasPending.remove.delete(c.id); }
    else { canvasPending.remove.add(c.id); canvasPending.upsert.delete(c.id); }
  });
  // A shape put back by undo must return to its place in the stacking order
  if (entry.orderChanged || entry.changed.some(c => !(undoing ? c.after : c.before))) canvasPending.order = true;
}

function cvSortByOrder(order) {
  const rank = new Map(order.map((id, i) => [id, i]));
  canvasShapes.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : order.length) - (rank.has(b.id) ? rank.get(b.id) : order.length));
}

function canvasUndoStep(redo) {
  const stack = redo ? canvasRedo : canvasUndo;
  const entry = stack.pop();
  if (!entry) return showToast(redo ? 'Nothing to redo.' : 'Nothing to undo.');
  cvCloseEditor(true);
  const selected = new Set();
  entry.changed.forEach(c => {
    const wanted = redo ? c.after : c.before;
    const index = cvIndex(c.id);
    if (wanted) {
      const shape = JSON.parse(wanted);
      if (index >= 0) canvasShapes[index] = shape; else canvasShapes.push(shape);
      selected.add(c.id);
    } else if (index >= 0) {
      canvasShapes.splice(index, 1);
    }
  });
  cvSortByOrder(redo ? entry.afterOrder : entry.beforeOrder);
  (redo ? canvasUndo : canvasRedo).push(entry);
  cvMarkEntry(entry, !redo);
  canvasSelection = selected;
  markCanvasDirty();
  renderCanvas();
}

function loadCanvasShapes(shapes) {
  canvasShapes = cvClone(shapes || []);
  canvasSelection = new Set();
  canvasDirty = false;
  canvasPending = cvEmptyPending();
  canvasUndo = [];
  canvasRedo = [];
  canvasTxn = null;
  cvCloseEditor(false);
  clearTimeout(canvasSaveTimer);
  setCanvasStatus('Saved');
}

function setCanvasStatus(text) {
  el('canvas-save-status').textContent = text;
}

function markCanvasDirty() {
  canvasDirty = true;
  canvasVersion++;
  setCanvasStatus('Unsaved changes');
  clearTimeout(canvasSaveTimer);
  canvasSaveTimer = setTimeout(saveCanvas, 1200);
}

// The whole canvas is sent instead of the changes (clear, open a copy, a template that replaces)
function cvReplaceAll(reason) {
  canvasPending.replace = reason || 'full';
}

function cvSaveBody(sent) {
  if (sent.replace) return { method: 'PUT', body: { shapes: canvasShapes, client_id: hubClientId, reason: sent.replace === 'full' ? '' : sent.replace } };
  const body = { upsert: [...sent.upsert].map(cvShape).filter(Boolean), delete: [...sent.remove], client_id: hubClientId };
  if (sent.order) body.order = canvasShapes.map(s => s.id);
  return { method: 'PATCH', body };
}

async function saveCanvas() {
  clearTimeout(canvasSaveTimer);
  if (!canvasDirty || !hubTeamId || !hub) return;
  if (canvasSaving || canvasDrag) { canvasSaveTimer = setTimeout(saveCanvas, 600); return; }
  canvasSaving = true;
  const version = canvasVersion;
  const teamId = hubTeamId;
  const sent = canvasPending;
  canvasPending = cvEmptyPending();
  setCanvasStatus('Saving...');
  try {
    const { method, body } = cvSaveBody(sent);
    await api(`/api/teams/${teamId}/canvas`, { method, body });
    if (hubTeamId === teamId) {
      hub.canvas = cvClone(canvasShapes);
      saveHubCache();
      if (version === canvasVersion) {
        canvasDirty = false;
        setCanvasStatus('Saved');
      }
    }
  } catch (err) {
    if (hubTeamId === teamId) {
      // Keep what was not saved, together with anything changed since
      sent.upsert.forEach(id => { if (!canvasPending.remove.has(id)) canvasPending.upsert.add(id); });
      sent.remove.forEach(id => { if (!canvasPending.upsert.has(id)) canvasPending.remove.add(id); });
      canvasPending.order = canvasPending.order || sent.order;
      canvasPending.replace = canvasPending.replace || sent.replace;
    }
    setCanvasStatus('Not saved');
    showToast(`The canvas could not be saved: ${err.message}`);
    if (err.status !== 400 && err.status !== 403) canvasSaveTimer = setTimeout(saveCanvas, 5000);
  }
  canvasSaving = false;
  if (canvasDirty && version !== canvasVersion) canvasSaveTimer = setTimeout(saveCanvas, 600);
}

// Save right now if there is anything unsaved (before switching workspace or leaving the page)
async function flushCanvasSave() {
  if (canvasDirty) await saveCanvas();
}

// A teammate replaced the whole canvas (clear, open a copy, restore a version)
function onCanvasUpdated(data) {
  if (data.client_id === hubClientId) return;
  hub.canvas = data.shapes;
  saveHubCache();
  if (canvasDirty || canvasDrag) {
    // Our unsaved shapes are kept on top of theirs and saved next
    const next = cvClone(data.shapes).filter(s => !canvasPending.remove.has(s.id));
    canvasPending.upsert.forEach(id => {
      const mine = cvShape(id);
      if (!mine) return;
      const index = next.findIndex(s => s.id === id);
      if (index >= 0) next[index] = mine; else next.push(mine);
    });
    canvasShapes = next;
    canvasUndo = [];
    canvasRedo = [];
    if (canvasTxn) canvasTxn = cvSnapshot();
    cvPruneSelection();
  } else {
    loadCanvasShapes(data.shapes);
  }
  renderCanvas();
  setCanvasStatus(`Updated by ${(hubMember(data.by) || { user_name: 'a teammate' }).user_name}`);
}

function cvApplyPatch(list, data, skip) {
  const next = list.slice();
  (data.upsert || []).forEach(shape => {
    if (skip && skip.has(shape.id)) return;
    const index = next.findIndex(s => s.id === shape.id);
    if (index >= 0) next[index] = cvClone(shape); else next.push(cvClone(shape));
  });
  const removed = new Set((data.delete || []).filter(id => !(skip && skip.has(id))));
  const kept = next.filter(s => !removed.has(s.id));
  if (data.order) {
    const rank = new Map(data.order.map((id, i) => [id, i]));
    kept.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : data.order.length) - (rank.has(b.id) ? rank.get(b.id) : data.order.length));
  }
  return kept;
}

// A teammate saved some changes: take them, except on shapes we have changed and not saved yet (ours are saved next)
function onCanvasPatch(data) {
  if (data.client_id === hubClientId) return;
  hub.canvas = cvApplyPatch(hub.canvas || [], data, null);
  saveHubCache();
  const skip = new Set([...canvasPending.upsert, ...canvasPending.remove, ...(canvasDrag && canvasDrag.ids ? canvasDrag.ids : [])]);
  const patch = canvasPending.order ? { ...data, order: null } : data;
  canvasShapes = cvApplyPatch(canvasShapes, patch, skip);
  if (canvasTxn) {
    // Their change is not part of the change this person is making right now
    (data.upsert || []).forEach(shape => {
      if (skip.has(shape.id)) return;
      if (!canvasTxn.map.has(shape.id)) canvasTxn.order.push(shape.id);
      canvasTxn.map.set(shape.id, JSON.stringify(cvShape(shape.id)));
    });
    (data.delete || []).forEach(id => { if (!skip.has(id)) canvasTxn.map.delete(id); });
    if (patch.order) canvasTxn.order = canvasShapes.map(s => s.id);
  }
  cvPruneSelection();
  if (canvasEditingId && !cvShape(canvasEditingId)) cvCloseEditor(false);
  cvRequestRender();
  const who = hubMember(data.by);
  if (!canvasDirty) setCanvasStatus(`Updated by ${who ? who.user_name : 'a teammate'}`);
}

function cvPruneSelection() {
  canvasSelection = new Set([...canvasSelection].filter(id => cvShape(id)));
}

// ==========================================
// 5. VIEW: ZOOM, PAN, FIT
// ==========================================
function canvasPoint(event) {
  const rect = el('canvas-svg').getBoundingClientRect();
  return { x: (event.clientX - rect.left - canvasView.x) / canvasView.scale, y: (event.clientY - rect.top - canvasView.y) / canvasView.scale };
}

function cvZoomTo(scale, cx, cy) {
  const next = Math.max(CV_MIN_SCALE, Math.min(CV_MAX_SCALE, scale));
  // Keep the point under the pointer (or the centre) where it is
  canvasView.x = cx - (cx - canvasView.x) * (next / canvasView.scale);
  canvasView.y = cy - (cy - canvasView.y) * (next / canvasView.scale);
  canvasView.scale = next;
  cvViewChanged();
  cvRequestRender();
}

function zoomCanvas(delta, aroundEvent) {
  const rect = el('canvas-svg').getBoundingClientRect();
  const cx = aroundEvent ? aroundEvent.clientX - rect.left : rect.width / 2;
  const cy = aroundEvent ? aroundEvent.clientY - rect.top : rect.height / 2;
  cvZoomTo(canvasView.scale * (delta > 0 ? 1.2 : 1 / 1.2), cx, cy);
}

function cvViewFor(bounds, maxScale = 1.5) {
  const rect = el('canvas-svg').getBoundingClientRect();
  const pad = Math.min(60, rect.width / 8);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.max(CV_MIN_SCALE, Math.min(maxScale, Math.min((rect.width - pad * 2) / width, (rect.height - pad * 2) / height)));
  return { scale, x: (rect.width - width * scale) / 2 - bounds.minX * scale, y: (rect.height - height * scale) / 2 - bounds.minY * scale };
}

function fitCanvas(selectionOnly) {
  const bounds = selectionOnly ? cvBoundsOf(cvSelected()) : canvasBounds();
  if (!bounds) {
    if (selectionOnly) return showToast('Select something first.');
    canvasView = { x: 0, y: 0, scale: 1 };
  } else {
    canvasView = cvViewFor(bounds);
  }
  cvViewChanged();
  renderCanvas();
}

// Glides the view to another place (present mode, following a presenter)
function cvAnimateView(target, done) {
  const from = { ...canvasView };
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / 320);
    const ease = 1 - Math.pow(1 - t, 3);
    canvasView = { x: from.x + (target.x - from.x) * ease, y: from.y + (target.y - from.y) * ease, scale: from.scale + (target.scale - from.scale) * ease };
    renderCanvas();
    if (t < 1) requestAnimationFrame(step); else if (done) done();
  };
  requestAnimationFrame(step);
}

function toggleCanvasFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else el('canvas-wrapper').requestFullscreen().catch(() => showToast('Fullscreen is not available here.'));
}

function onCanvasFullscreenChange() {
  const full = document.fullscreenElement === el('canvas-wrapper');
  el('canvas-wrapper').classList.toggle('is-full', full);
  // Only what is inside the fullscreen element is visible, so the dialogs move in with it
  ['systemModal'].forEach(id => { const node = el(id); if (node) (full ? el('canvas-wrapper') : document.body).appendChild(node); });
  if (!full) cvStopPresenting(true);
  renderCanvas();
}

function clearCanvas() {
  if (canvasShapes.length === 0) return showToast('The canvas is already empty.');
  hubConfirm('Clear Canvas', `Remove all ${canvasShapes.length} shapes from this workspace's canvas? This affects everyone in the workspace. The canvas as it was is kept under File → Version history.`, 'Clear', async () => {
    canvasChange(() => {
      canvasShapes = [];
      canvasSelection = new Set();
    });
    cvReplaceAll('clear');
  });
}

// ==========================================
// 6. START
// ==========================================
function initCanvas() {
  const svg = el('canvas-svg');
  svg.querySelector('defs').outerHTML = canvasDefsSvg();
  svg.style.touchAction = 'none';
  cvInitTools();
  cvInitExtras();
  selectCanvasTool('select');
  document.addEventListener('fullscreenchange', onCanvasFullscreenChange);
  window.addEventListener('beforeunload', () => {
    // Last chance to keep unsaved drawing: a request the browser finishes even as the page closes
    if (!canvasDirty || !hubTeamId) return;
    const { method, body } = cvSaveBody(canvasPending);
    const text = JSON.stringify(body);
    if (text.length > 60000) return;   // the browser refuses larger keep-alive requests
    fetch(`${API_BASE}/api/teams/${hubTeamId}/canvas`, { method, credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: text });
  });
}
