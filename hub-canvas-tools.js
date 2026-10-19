// ==========================================
// HUB-CANVAS-TOOLS.JS — How the canvas is drawn on: every tool's pointer handling, snapping and guides,
// the text editor on the board, the style bar, the right-click menu, arranging, copy/paste and keyboard shortcuts.
// Uses the state and drawing in hub-canvas.js.
// ==========================================

const CV_TOOL_KEYS = { v: 'select', h: 'hand', p: 'pen', m: 'highlighter', e: 'eraser', r: 'rectangle', o: 'circle', d: 'diamond', l: 'line', a: 'arrow', t: 'text', n: 'sticky', f: 'frame', k: 'laser' };
const CV_LINE_TOOLS = { arrow: { type: 'arrow' }, line: { type: 'line' }, elbow: { type: 'arrow', route: 'elbow' }, curve: { type: 'arrow', route: 'curved' } };
const CV_STYLE_DEFAULTS = {
  pen: { color: 'black', stroke_width: 2 },
  highlighter: { color: 'amber', stroke_width: 4 },
  shape: { color: 'indigo', fill: 'light', stroke_width: 2, dash: 'solid' },
  line: { color: 'slate', stroke_width: 2, dash: 'solid' },
  text: { color: 'black', font: 'M' },
  sticky: { color: 'amber' },
  frame: { color: 'slate' },
  image: {}
};
const CV_CLIPBOARD_KEY = 'c2m:canvas-clipboard';
const CV_STYLE_KEY = 'c2m:canvas-style';

let cvToolStyle = cvLoadToolStyle();
let cvPointers = new Map();        // touch points on the board, for pinch zoom
let cvPinch = null;
let cvSpaceDown = false;
let cvPointerWorld = null;         // where the pointer last was on the board
let cvPointerInside = false;
let cvLastShapeTool = 'rectangle';
let cvLastLineTool = 'arrow';
let cvLongPress = null;
let cvStyleSignature = '';
let cvClipboardMarker = '';        // what was put on the system clipboard with the last copy

function cvLoadToolStyle() {
  const style = cvClone(CV_STYLE_DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(CV_STYLE_KEY) || '{}');
    Object.keys(style).forEach(group => Object.assign(style[group], saved[group] || {}));
  } catch (e) { /* storage blocked: the defaults are fine */ }
  return style;
}

function cvSaveToolStyle() {
  try { localStorage.setItem(CV_STYLE_KEY, JSON.stringify(cvToolStyle)); } catch (e) { /* not kept, that is fine */ }
}

function cvStyleGroup(kind) {
  if (kind === 'pen' || kind === 'highlighter' || kind === 'text' || kind === 'sticky' || kind === 'frame' || kind === 'image') return kind;
  if (kind === 'arrow' || kind === 'line' || CV_LINE_TOOLS[kind]) return 'line';
  return 'shape';
}

// Which style fields make sense for a shape
function cvStyleApplies(shape, key) {
  const type = shape.type;
  const line = isLineShape(shape);
  const ink = isInkShape(shape);
  if (key === 'color' || key === 'opacity') return true;
  if (key === 'fill') return !line && !ink && !['text', 'image'].includes(type);
  if (key === 'stroke_width' || key === 'dash') return !['text', 'sticky'].includes(type);
  if (key === 'font') return !ink && type !== 'image';
  if (key === 'align') return !line && !ink && !['image', 'frame'].includes(type);
  if (key === 'corners') return type === 'rectangle' || type === 'frame';
  if (key === 'route' || key === 'head_start' || key === 'head_end') return line;
  return false;
}

function cvToolDefaults(type) {
  const style = cvToolStyle[cvStyleGroup(type)] || {};
  const probe = { type };
  const out = {};
  Object.entries(style).forEach(([key, value]) => { if (cvStyleApplies(probe, key)) out[key] = value; });
  if (!out.color) out.color = type === 'sticky' ? 'amber' : 'indigo';
  return out;
}

// ==========================================
// 1. TOOLS
// ==========================================
function selectCanvasTool(tool) {
  if (tool === 'image') return cvPickImage();
  canvasTool = tool;
  if (CV_SHAPE_TYPES.includes(tool)) cvLastShapeTool = tool;
  if (CV_LINE_TOOLS[tool]) cvLastLineTool = tool;
  cvCloseFlyouts();
  document.querySelectorAll('#canvas-tools [data-tool]').forEach(button => {
    const group = button.dataset.group;
    const active = group === 'shapes' ? CV_SHAPE_TYPES.includes(tool) : group === 'lines' ? !!CV_LINE_TOOLS[tool] : button.dataset.tool === tool;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  document.querySelectorAll('#canvas-tools [data-flyout-item]').forEach(b => b.classList.toggle('is-active', b.dataset.flyoutItem === tool));
  // The group buttons show the shape or line last picked
  const shapeButton = document.querySelector('#canvas-tools [data-group="shapes"]');
  const lineButton = document.querySelector('#canvas-tools [data-group="lines"]');
  if (shapeButton) { shapeButton.dataset.tool = cvLastShapeTool; shapeButton.querySelector('.cv-tool-icon').innerHTML = cvToolIcon(cvLastShapeTool); }
  if (lineButton) { lineButton.dataset.tool = cvLastLineTool; lineButton.querySelector('.cv-tool-icon').innerHTML = cvToolIcon(cvLastLineTool); }
  el('canvas-area').dataset.tool = tool;
  if (tool !== 'select') canvasSelection = new Set();
  if (tool !== 'laser') cvStopLaser();
  renderCanvas();
}

function cvToggleKeepTool() {
  canvasKeepTool = !canvasKeepTool;
  const button = el('cv-keep-tool');
  button.classList.toggle('is-active', canvasKeepTool);
  button.setAttribute('aria-pressed', canvasKeepTool ? 'true' : 'false');
  button.querySelector('.material-symbols-outlined').textContent = canvasKeepTool ? 'lock' : 'lock_open';
  showToast(canvasKeepTool ? 'The drawing tool stays picked after each shape.' : 'Back to Select after each shape.');
}

function cvToggleFlyout(name, event) {
  if (event) event.stopPropagation();
  const flyout = el(`cv-flyout-${name}`);
  const open = flyout.hidden;
  cvCloseFlyouts();
  flyout.hidden = !open;
  if (!open) return;
  // Next to the tool bar, or above it when the bar runs along the bottom (phones)
  const group = flyout.parentElement.getBoundingClientRect();
  const bar = el('canvas-tools').getBoundingClientRect();
  const across = bar.width > bar.height;
  const left = across ? Math.min(window.innerWidth - flyout.offsetWidth - 8, Math.max(8, group.left)) : bar.right + 8;
  const top = across ? bar.top - flyout.offsetHeight - 8 : Math.min(window.innerHeight - flyout.offsetHeight - 8, group.top);
  flyout.style.left = `${left}px`;
  flyout.style.top = `${Math.max(8, top)}px`;
}

function cvCloseFlyouts() {
  document.querySelectorAll('.cv-flyout').forEach(f => { f.hidden = true; });
}

// Small drawings of each tool, used in the tool bar
function cvToolIcon(tool) {
  const svg = (inner) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${inner}</svg>`;
  const icons = {
    rectangle: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
    circle: '<ellipse cx="12" cy="12" rx="8" ry="7"/>',
    diamond: '<path d="M12 3 21 12 12 21 3 12Z"/>',
    triangle: '<path d="M12 4 21 20H3Z"/>',
    parallelogram: '<path d="M8 6H21L16 18H3Z"/>',
    hexagon: '<path d="M7.5 4h9L21 12l-4.5 8h-9L3 12Z"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6-4.5-4.2 6.1-.8Z"/>',
    callout: '<path d="M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
    database: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/>',
    arrow: '<path d="M4 20 20 4M11 4h9v9"/>',
    line: '<path d="M4 20 20 4"/>',
    elbow: '<path d="M4 18h8V6h8M16 2l4 4-4 4"/>',
    curve: '<path d="M4 19C4 9 20 15 20 5M16 4l4 1-1 4"/>'
  };
  return svg(icons[tool] || icons.rectangle);
}

// ==========================================
// 2. POINTER
// ==========================================
function cvShapeNodeAt(clientX, clientY, exclude) {
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const group = node.closest && node.closest('#canvas-layer .shape');
    if (group && !(exclude && exclude.has(group.dataset.shapeId))) return group;
  }
  return null;
}

// A shape a connector can be tied to
function cvBindableAt(clientX, clientY, exclude) {
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const group = node.closest && node.closest('#canvas-layer .shape');
    if (!group || (exclude && exclude.has(group.dataset.shapeId))) continue;
    const shape = cvShape(group.dataset.shapeId);
    if (shape && !isLineShape(shape) && !isInkShape(shape) && shape.type !== 'frame') return shape;
  }
  return null;
}

function cvExpandGroups(ids) {
  const out = new Set(ids);
  const groups = new Set(ids.map(cvShape).filter(s => s && s.group_id).map(s => s.group_id));
  if (groups.size) canvasShapes.forEach(s => { if (s.group_id && groups.has(s.group_id)) out.add(s.id); });
  return [...out];
}

function cvSnapValue(value) {
  return canvasSnapGrid ? Math.round(value / CV_GRID) * CV_GRID : value;
}

function onCanvasPointerDown(event) {
  if (!hub) return;
  cvHidePopups();
  if (canvasEditingId) cvCloseEditor(true);
  if (event.pointerType === 'touch') {
    cvPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (cvPointers.size === 2) return cvStartPinch();
    if (cvPointers.size > 2) return;
  }
  if (event.button === 2) return;   // the right-click menu
  if (event.button !== undefined && event.button > 1) return;
  try { el('canvas-svg').setPointerCapture(event.pointerId); } catch (e) { /* not needed for mouse */ }
  const point = canvasPoint(event);
  cvPointerWorld = point;
  const handle = event.target.closest('[data-handle]');
  const chip = event.target.closest('[data-task-chip]');
  const node = event.target.closest('.shape');
  event.preventDefault();
  el('canvas-area').focus({ preventScroll: true });

  const touchOnEmpty = event.pointerType === 'touch' && canvasTool === 'select' && !node && !handle;
  if (event.button === 1 || cvSpaceDown || canvasTool === 'hand' || touchOnEmpty) return cvStartPan(event);
  if (event.pointerType === 'touch') cvStartLongPress(event);
  if (canvasTool === 'laser') { canvasDrag = { kind: 'laser' }; return cvLaserPoint(point); }
  if (canvasTool === 'eraser') {
    canvasBegin();
    canvasDrag = { kind: 'erase', erasing: new Set(), last: { x: event.clientX, y: event.clientY } };
    cvEraseAlong(event.clientX, event.clientY);
    return renderCanvas();
  }
  if (canvasTool === 'pen' || canvasTool === 'highlighter') return cvStartInk(point);
  if (CV_LINE_TOOLS[canvasTool]) return cvStartLine(point, event);
  if (canvasTool !== 'select') return cvStartShape(point);

  if (chip) {
    const shape = cvShape(chip.dataset.taskChip);
    if (shape && shape.task_id) return cvOpenLinkedTask(shape);
  }
  if (handle && canvasSelection.size) return cvStartHandle(handle.dataset.handle, point, event);
  if (node) return cvStartMove(node.dataset.shapeId, point, event);
  if (!event.shiftKey) canvasSelection = new Set();
  canvasDrag = { kind: 'marquee', start: point, rect: null, base: new Set(canvasSelection) };
  renderCanvas();
}

function cvStartPan(event) {
  canvasDrag = { kind: 'pan', startClient: { x: event.clientX, y: event.clientY }, origin: { x: canvasView.x, y: canvasView.y } };
  el('canvas-area').classList.add('is-panning');
}

function cvStartPinch() {
  cvCancelDrag();
  const [a, b] = [...cvPointers.values()];
  const rect = el('canvas-svg').getBoundingClientRect();
  cvPinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top }, view: { ...canvasView } };
}

function cvStartLongPress(event) {
  clearTimeout(cvLongPress && cvLongPress.timer);
  const at = { x: event.clientX, y: event.clientY };
  cvLongPress = {
    at,
    timer: setTimeout(() => {
      cvLongPress = null;
      cvCancelDrag();
      cvOpenContextMenu(at.x, at.y, cvShapeNodeAt(at.x, at.y));
    }, 550)
  };
}

// Stops what the pointer was doing and puts the shapes back as they were
function cvCancelDrag() {
  clearTimeout(cvLongPress && cvLongPress.timer);
  cvLongPress = null;
  if (canvasTxn) {
    const before = canvasTxn;
    canvasTxn = null;
    canvasShapes = before.order.map(id => JSON.parse(before.map.get(id)));
    cvPruneSelection();
  }
  canvasDrag = null;
  el('canvas-area').classList.remove('is-panning');
  renderCanvas();
}

function cvStartMove(id, point, event) {
  const ids = cvExpandGroups([id]);
  if (event.shiftKey) {
    const adding = !canvasSelection.has(id);
    ids.forEach(i => (adding ? canvasSelection.add(i) : canvasSelection.delete(i)));
    if (!adding) return renderCanvas();
  } else if (!canvasSelection.has(id)) {
    canvasSelection = new Set(ids);
  }
  const moving = cvSelected().filter(s => !s.locked);
  if (!moving.length) return renderCanvas();
  // A frame carries what is inside it
  const carried = new Set(moving.map(s => s.id));
  moving.filter(s => s.type === 'frame').forEach(frame => cvFrameContents(frame).forEach(s => { if (!s.locked) carried.add(s.id); }));
  canvasBegin();
  const origin = new Map([...carried].map(sid => { const s = cvShape(sid); return [sid, { x: s.x, y: s.y, x2: s.x2, y2: s.y2 }]; }));
  canvasDrag = { kind: 'move', ids: [...carried], start: point, origin, bounds: cvBoundsOf([...carried].map(cvShape)), changed: false };
  renderCanvas();
}

function cvStartHandle(name, point, event) {
  const selected = cvSelected().filter(s => !s.locked);
  if (!selected.length) return;
  canvasBegin();
  if (name === 'start' || name === 'end') {
    const shape = selected[0];
    canvasDrag = { kind: 'end', which: name, id: shape.id, ids: [shape.id] };
  } else if (name === 'rotate') {
    const shape = selected[0];
    canvasDrag = { kind: 'rotate', id: shape.id, ids: [shape.id], center: cvCenter(shape) };
  } else if (selected.length === 1 && !isLineShape(selected[0])) {
    // The edge keeps the distance it had from the pointer when the handle was grabbed
    const o = selected[0];
    const [fx, fy] = CV_HANDLES[name];
    const local = cvRotatePoint(point, cvCenter(o), -(o.rot || 0));
    const grab = { x: local.x - (o.x + o.w * fx), y: local.y - (o.y + o.h * fy) };
    canvasDrag = { kind: 'resize', handle: name, id: o.id, ids: [o.id], origin: cvClone(o), grab };
  } else {
    const box = cvBoundsOf(selected);
    const [fx, fy] = CV_HANDLES[name];
    const grab = { x: point.x - (box.minX + (box.maxX - box.minX) * fx), y: point.y - (box.minY + (box.maxY - box.minY) * fy) };
    canvasDrag = { kind: 'scale', handle: name, ids: selected.map(s => s.id), origin: new Map(selected.map(s => [s.id, cvClone(s)])), box, grab };
  }
  renderCanvas();
}

function cvStartShape(point) {
  const type = canvasTool;
  canvasBegin();
  const start = { x: cvSnapValue(point.x), y: cvSnapValue(point.y) };
  const shape = { id: newTempId(), type, x: start.x, y: start.y, w: 0, h: 0, x2: 0, y2: 0, text: type === 'frame' ? cvNextFrameName() : '', ...cvToolDefaults(type) };
  canvasShapes.push(shape);
  canvasSelection = new Set([shape.id]);
  canvasDrag = { kind: 'create', id: shape.id, ids: [shape.id], start };
  renderCanvas();
}

function cvNextFrameName() {
  return `Frame ${canvasShapes.filter(s => s.type === 'frame').length + 1}`;
}

function cvStartInk(point) {
  canvasBegin();
  const shape = { id: newTempId(), type: canvasTool, x: 0, y: 0, w: 0, h: 0, x2: 0, y2: 0, text: '', points: [point.x, point.y], ...cvToolDefaults(canvasTool) };
  canvasShapes.push(shape);
  canvasDrag = { kind: 'ink', id: shape.id, ids: [shape.id], raw: [point] };
  renderCanvas();
}

function cvStartLine(point, event) {
  const spec = CV_LINE_TOOLS[canvasTool];
  canvasBegin();
  const startTarget = cvBindableAt(event.clientX, event.clientY);
  const start = startTarget ? point : { x: cvSnapValue(point.x), y: cvSnapValue(point.y) };
  const shape = { id: newTempId(), type: spec.type, x: start.x, y: start.y, x2: start.x, y2: start.y, w: 0, h: 0, text: '', ...cvToolDefaults(spec.type) };
  if (spec.route) shape.route = spec.route;
  if (startTarget) shape.start_id = startTarget.id;
  canvasShapes.push(shape);
  canvasSelection = new Set([shape.id]);
  canvasDrag = { kind: 'line', id: shape.id, ids: [shape.id], start, startTarget: startTarget ? startTarget.id : null };
  renderCanvas();
}

function onCanvasPointerMove(event) {
  const svgRect = el('canvas-svg').getBoundingClientRect();
  cvPointerInside = event.clientX >= svgRect.left && event.clientX <= svgRect.right && event.clientY >= svgRect.top && event.clientY <= svgRect.bottom;
  if (cvPointerInside && hubTab === 'canvas') {
    cvPointerWorld = canvasPoint(event);
    cvShareCursor(cvPointerWorld);
  }
  if (cvLongPress && Math.hypot(event.clientX - cvLongPress.at.x, event.clientY - cvLongPress.at.y) > 8) {
    clearTimeout(cvLongPress.timer);
    cvLongPress = null;
  }
  if (event.pointerType === 'touch' && cvPointers.has(event.pointerId)) {
    cvPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (cvPinch && cvPointers.size === 2) return cvMovePinch();
  }
  const drag = canvasDrag;
  if (!drag) return;
  if (drag.kind === 'pan') {
    canvasView.x = drag.origin.x + event.clientX - drag.startClient.x;
    canvasView.y = drag.origin.y + event.clientY - drag.startClient.y;
    cvViewChanged();
    return cvRequestRender();
  }
  const point = canvasPoint(event);
  if (drag.kind === 'laser') return cvLaserPoint(point);
  if (drag.kind === 'erase') {
    cvEraseAlong(event.clientX, event.clientY);
    return cvRequestRender();
  }
  if (drag.kind === 'marquee') {
    drag.rect = { x: Math.min(drag.start.x, point.x), y: Math.min(drag.start.y, point.y), w: Math.abs(point.x - drag.start.x), h: Math.abs(point.y - drag.start.y) };
    const box = { minX: drag.rect.x, minY: drag.rect.y, maxX: drag.rect.x + drag.rect.w, maxY: drag.rect.y + drag.rect.h };
    const inside = canvasShapes.filter(s => !s.locked && cvInside(shapeBounds(s), box)).map(s => s.id);
    canvasSelection = new Set([...drag.base, ...cvExpandGroups(inside)]);
    return cvRequestRender();
  }
  const shape = drag.id ? cvShape(drag.id) : null;
  if (drag.kind === 'move') return cvMoveDrag(drag, point, event);
  if (drag.kind === 'scale') return cvScaleDrag(drag, point, event);
  if (!shape) return;

  if (drag.kind === 'ink') {
    const events = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    events.forEach(e => {
      const p = canvasPoint(e);
      const last = drag.raw[drag.raw.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) * canvasView.scale >= 1.5) drag.raw.push(p);
    });
    shape.points = drag.raw.flatMap(p => [p.x, p.y]);
  } else if (drag.kind === 'create') {
    let x2 = cvSnapValue(point.x);
    let y2 = cvSnapValue(point.y);
    if (event.shiftKey) {
      const side = Math.max(Math.abs(x2 - drag.start.x), Math.abs(y2 - drag.start.y));
      x2 = drag.start.x + Math.sign(x2 - drag.start.x || 1) * side;
      y2 = drag.start.y + Math.sign(y2 - drag.start.y || 1) * side;
    }
    shape.x = Math.min(drag.start.x, x2);
    shape.y = Math.min(drag.start.y, y2);
    shape.w = Math.abs(x2 - drag.start.x);
    shape.h = Math.abs(y2 - drag.start.y);
  } else if (drag.kind === 'line' || drag.kind === 'end') {
    const fixed = drag.kind === 'line' ? drag.start : (drag.which === 'start' ? cvLineEnds(shape).b : cvLineEnds(shape).a);
    const exclude = new Set([shape.id]);
    if (drag.kind === 'line' && drag.startTarget) exclude.add(drag.startTarget);
    const target = event.altKey ? null : cvBindableAt(event.clientX, event.clientY, exclude);
    drag.bindTarget = target ? target.id : null;
    let end = target ? cvCenter(target) : { x: cvSnapValue(point.x), y: cvSnapValue(point.y) };
    if (!target && event.shiftKey) end = cvSnapAngle(fixed, point);
    if (drag.kind === 'line' || drag.which === 'end') { shape.x2 = end.x; shape.y2 = end.y; }
    else { shape.x = end.x; shape.y = end.y; }
    if (drag.kind === 'end') delete shape[drag.which === 'start' ? 'start_id' : 'end_id'];
  } else if (drag.kind === 'resize') {
    cvResizeShape(shape, drag.origin, drag.handle, point, event.shiftKey !== (shape.type === 'image'), drag.grab);
  } else if (drag.kind === 'rotate') {
    let angle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x) * 180 / Math.PI + 90;
    if (event.shiftKey) angle = Math.round(angle / 15) * 15;
    angle = ((angle + 540) % 360) - 180;
    shape.rot = Math.round(angle * 10) / 10;
    if (!shape.rot) delete shape.rot;
  }
  cvRequestRender();
}

function cvSnapAngle(from, to) {
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

function cvMovePinch() {
  const [a, b] = [...cvPointers.values()];
  const rect = el('canvas-svg').getBoundingClientRect();
  const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
  const start = cvPinch.view;
  const scale = Math.max(CV_MIN_SCALE, Math.min(CV_MAX_SCALE, start.scale * distance / cvPinch.distance));
  // The board point under the first midpoint follows the fingers
  const worldX = (cvPinch.mid.x - start.x) / start.scale;
  const worldY = (cvPinch.mid.y - start.y) / start.scale;
  canvasView = { scale, x: mid.x - worldX * scale, y: mid.y - worldY * scale };
  cvViewChanged();
  cvRequestRender();
}

function cvMoveDrag(drag, point, event) {
  let dx = point.x - drag.start.x;
  let dy = point.y - drag.start.y;
  if (!drag.changed && Math.hypot(dx, dy) * canvasView.scale < 3) return;
  drag.changed = true;
  const snapped = cvSnapMove(drag.bounds, dx, dy, new Set(drag.ids), event.altKey);
  dx = snapped.dx;
  dy = snapped.dy;
  drag.guides = snapped.guides;
  const moving = new Set(drag.ids);
  drag.ids.forEach(id => {
    const shape = cvShape(id);
    const o = drag.origin.get(id);
    if (!shape || !o) return;
    shape.x = o.x + dx;
    shape.y = o.y + dy;
    if (isLineShape(shape)) {
      shape.x2 = o.x2 + dx;
      shape.y2 = o.y2 + dy;
      // Dragging a connector away from shapes that stay unties it
      if (shape.start_id && !moving.has(shape.start_id)) { const { a } = cvLineEnds(shape); delete shape.start_id; shape.x = a.x; shape.y = a.y; drag.origin.set(id, { ...o, x: a.x - dx, y: a.y - dy }); }
      if (shape.end_id && !moving.has(shape.end_id)) { const { b } = cvLineEnds(shape); delete shape.end_id; shape.x2 = b.x; shape.y2 = b.y; drag.origin.set(id, { ...drag.origin.get(id), x2: b.x - dx, y2: b.y - dy }); }
    }
  });
  cvRequestRender();
}

// Lines up the moving shapes with the grid, or with the edges and centres of shapes nearby
function cvSnapMove(bounds, dx, dy, moving, off) {
  if (off || !bounds) return { dx, dy, guides: [] };
  if (canvasSnapGrid) {
    return { dx: Math.round((bounds.minX + dx) / CV_GRID) * CV_GRID - bounds.minX, dy: Math.round((bounds.minY + dy) / CV_GRID) * CV_GRID - bounds.minY, guides: [] };
  }
  const rect = el('canvas-svg').getBoundingClientRect();
  const view = { minX: -canvasView.x / canvasView.scale, minY: -canvasView.y / canvasView.scale, maxX: (rect.width - canvasView.x) / canvasView.scale, maxY: (rect.height - canvasView.y) / canvasView.scale };
  const others = canvasShapes.filter(s => !moving.has(s.id) && !isInkShape(s)).map(shapeBounds)
    .filter(b => b.maxX >= view.minX && b.minX <= view.maxX && b.maxY >= view.minY && b.minY <= view.maxY).slice(0, 400);
  const tolerance = 6 / canvasView.scale;
  const moved = { minX: bounds.minX + dx, maxX: bounds.maxX + dx, minY: bounds.minY + dy, maxY: bounds.maxY + dy };
  const xs = [moved.minX, (moved.minX + moved.maxX) / 2, moved.maxX];
  const ys = [moved.minY, (moved.minY + moved.maxY) / 2, moved.maxY];
  let bestX = null;
  let bestY = null;
  others.forEach(b => {
    [b.minX, (b.minX + b.maxX) / 2, b.maxX].forEach(cx => xs.forEach(mx => {
      const gap = cx - mx;
      if (Math.abs(gap) <= tolerance && (!bestX || Math.abs(gap) < Math.abs(bestX.gap))) bestX = { gap, at: cx, b };
    }));
    [b.minY, (b.minY + b.maxY) / 2, b.maxY].forEach(cy => ys.forEach(my => {
      const gap = cy - my;
      if (Math.abs(gap) <= tolerance && (!bestY || Math.abs(gap) < Math.abs(bestY.gap))) bestY = { gap, at: cy, b };
    }));
  });
  const guides = [];
  if (bestX) {
    dx += bestX.gap;
    guides.push({ x1: bestX.at, x2: bestX.at, y1: Math.min(moved.minY, bestX.b.minY) - 10, y2: Math.max(moved.maxY, bestX.b.maxY) + 10 });
  }
  if (bestY) {
    dy += bestY.gap;
    guides.push({ y1: bestY.at, y2: bestY.at, x1: Math.min(moved.minX + (bestX ? bestX.gap : 0), bestY.b.minX) - 10, x2: Math.max(moved.maxX + (bestX ? bestX.gap : 0), bestY.b.maxX) + 10 });
  }
  return { dx, dy, guides };
}

// Resizing one shape from a handle; a turned shape is resized in its own direction
function cvResizeShape(shape, o, handle, point, keepRatio, grab) {
  const [fx, fy] = CV_HANDLES[handle];
  const c = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
  const local = cvRotatePoint(point, c, -(o.rot || 0));
  if (grab) { local.x -= grab.x; local.y -= grab.y; }
  if (!o.rot) { local.x = cvSnapValue(local.x); local.y = cvSnapValue(local.y); }
  let left = o.x;
  let right = o.x + o.w;
  let top = o.y;
  let bottom = o.y + o.h;
  const min = 8;
  if (fx === 0) left = Math.min(local.x, right - min);
  if (fx === 1) right = Math.max(local.x, left + min);
  if (fy === 0) top = Math.min(local.y, bottom - min);
  if (fy === 1) bottom = Math.max(local.y, top + min);
  let w = right - left;
  let h = bottom - top;
  if (keepRatio && o.w > 0 && o.h > 0) {
    const ratio = o.w / o.h;
    if (fx === 0.5) w = h * ratio;
    else if (fy === 0.5) h = w / ratio;
    else if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    if (fx === 0) left = right - w; else if (fx === 1) right = left + w; else left = c.x - w / 2;
    if (fy === 0) top = bottom - h; else if (fy === 1) bottom = top + h; else top = c.y - h / 2;
  }
  const center = cvRotatePoint({ x: left + w / 2, y: top + h / 2 }, c, o.rot || 0);
  shape.x = center.x - w / 2;
  shape.y = center.y - h / 2;
  shape.w = w;
  shape.h = h;
  if (isInkShape(shape)) {
    const sx = o.w > 1 ? w / o.w : 1;
    const sy = o.h > 1 ? h / o.h : 1;
    shape.points = o.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy));
  }
}

// Resizing several shapes together from the handles of the box round all of them
function cvScaleDrag(drag, point, event) {
  const [fx, fy] = CV_HANDLES[drag.handle];
  if (drag.grab) point = { x: point.x - drag.grab.x, y: point.y - drag.grab.y };
  const box = drag.box;
  const ax = fx === 0 ? box.maxX : box.minX;
  const ay = fy === 0 ? box.maxY : box.minY;
  const oldW = Math.max(1, box.maxX - box.minX);
  const oldH = Math.max(1, box.maxY - box.minY);
  let sx = fx === 0.5 ? 1 : Math.max(0.05, (fx === 0 ? ax - point.x : point.x - ax) / oldW);
  let sy = fy === 0.5 ? 1 : Math.max(0.05, (fy === 0 ? ay - point.y : point.y - ay) / oldH);
  if (event.shiftKey && fx !== 0.5 && fy !== 0.5) sx = sy = Math.max(sx, sy);
  drag.ids.forEach(id => {
    const shape = cvShape(id);
    const o = drag.origin.get(id);
    if (!shape || !o) return;
    shape.x = ax + (o.x - ax) * sx;
    shape.y = ay + (o.y - ay) * sy;
    if (isLineShape(shape)) {
      shape.x2 = ax + (o.x2 - ax) * sx;
      shape.y2 = ay + (o.y2 - ay) * sy;
    } else {
      shape.w = Math.max(4, o.w * sx);
      shape.h = Math.max(4, o.h * sy);
      if (isInkShape(shape)) shape.points = o.points.map((v, i) => (i % 2 === 0 ? v * sx : v * sy));
    }
  });
  cvRequestRender();
}

// The eraser picks up whatever is under its path, checked every few pixels so a fast stroke misses nothing
function cvEraseAlong(clientX, clientY) {
  const drag = canvasDrag;
  const from = drag.last;
  const steps = Math.max(1, Math.ceil(Math.hypot(clientX - from.x, clientY - from.y) / 5));
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (clientX - from.x) * (i / steps);
    const y = from.y + (clientY - from.y) * (i / steps);
    document.elementsFromPoint(x, y).forEach(node => {
      const group = node.closest && node.closest('#canvas-layer .shape');
      if (!group) return;
      const shape = cvShape(group.dataset.shapeId);
      if (shape && !shape.locked) drag.erasing.add(shape.id);
    });
  }
  drag.last = { x: clientX, y: clientY };
}

// Fewer points for a freehand stroke, with the same look (Ramer-Douglas-Peucker)
function cvSimplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const a = points[first];
    const b = points[last];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let farthest = -1;
    let distance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length;
      if (d > distance) { distance = d; farthest = i; }
    }
    if (farthest > 0) {
      keep[farthest] = true;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((p, i) => keep[i]);
}

function cvFinishInk(shape, raw) {
  let tolerance = (shape.type === 'highlighter' ? 1.5 : 0.7) / canvasView.scale;
  let points = cvSimplify(raw, tolerance);
  while (points.length > 1990) { tolerance *= 1.6; points = cvSimplify(raw, tolerance); }
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  shape.x = cvRound(minX);
  shape.y = cvRound(minY);
  shape.w = cvRound(Math.max(...xs) - minX);
  shape.h = cvRound(Math.max(...ys) - minY);
  shape.points = points.flatMap(p => [cvRound(p.x - shape.x), cvRound(p.y - shape.y)]);
}

function onCanvasPointerUp(event) {
  if (event && event.pointerType === 'touch') {
    cvPointers.delete(event.pointerId);
    if (cvPinch) { if (cvPointers.size < 2) cvPinch = null; return; }
  }
  clearTimeout(cvLongPress && cvLongPress.timer);
  cvLongPress = null;
  if (!canvasDrag) return;
  const drag = canvasDrag;
  canvasDrag = null;
  el('canvas-area').classList.remove('is-panning');
  if (event && event.type === 'pointercancel' && drag.kind !== 'pan') { canvasDrag = drag; return cvCancelDrag(); }
  if (drag.kind === 'pan') { cvViewChanged(); return renderCanvas(); }
  if (drag.kind === 'laser') return;
  if (drag.kind === 'marquee') return renderCanvas();
  if (drag.kind === 'erase') {
    if (drag.erasing.size) {
      canvasShapes = canvasShapes.filter(s => !drag.erasing.has(s.id));
      cvPruneSelection();
    }
    return canvasCommit();
  }
  const shape = drag.id ? cvShape(drag.id) : null;
  if (drag.kind === 'ink' && shape) {
    cvFinishInk(shape, drag.raw);
    return canvasCommit();
  }
  if (drag.kind === 'create' && shape) {
    if (shape.w < 12 || shape.h < 12) {
      // A click without a drag drops a shape of a sensible size where you clicked
      const [w, h] = DEFAULT_SIZES[shape.type] || [150, 80];
      shape.x = cvSnapValue(drag.start.x - w / 2);
      shape.y = cvSnapValue(drag.start.y - h / 2);
      shape.w = w;
      shape.h = h;
    }
    cvAfterDrawing([shape.id]);
    canvasCommit();
    if (shape.type === 'sticky' || shape.type === 'text') openShapeText(shape.id);
    return;
  }
  if (drag.kind === 'line' && shape) {
    if (drag.bindTarget) shape.end_id = drag.bindTarget;
    const { a, b } = cvLineEnds(shape);
    // A click without a drag is not a line
    if (Math.hypot(b.x - a.x, b.y - a.y) < 8 && !shape.end_id) {
      canvasShapes = canvasShapes.filter(s => s !== shape);
      canvasSelection = new Set();
      canvasTxn = null;
      if (!canvasKeepTool) selectCanvasTool('select');
      return renderCanvas();
    }
    cvAfterDrawing([shape.id]);
    return canvasCommit();
  }
  if (drag.kind === 'end' && shape && drag.bindTarget) shape[drag.which === 'start' ? 'start_id' : 'end_id'] = drag.bindTarget;
  canvasCommit();
}

function cvAfterDrawing(ids) {
  if (!canvasKeepTool) {
    selectCanvasTool('select');
    canvasSelection = new Set(ids);
  }
}

// Connector ends tied to shapes are stored where they are drawn, so exports and older pages show them right
function cvSyncBoundLines() {
  canvasShapes.forEach(shape => {
    if (!isLineShape(shape) || (!shape.start_id && !shape.end_id)) return;
    const { a, b } = cvLineEnds(shape);
    if (shape.start_id && cvShape(shape.start_id)) { shape.x = cvRound(a.x); shape.y = cvRound(a.y); }
    if (shape.end_id && cvShape(shape.end_id)) { shape.x2 = cvRound(b.x); shape.y2 = cvRound(b.y); }
  });
}

// ==========================================
// 3. TEXT ON THE BOARD
// ==========================================
function openShapeText(shapeId) {
  const shape = cvShape(shapeId);
  if (!shape || isInkShape(shape) || shape.type === 'image') return;
  if (shape.locked) return showToast('This shape is locked. Unlock it to edit its text.');
  canvasEditingId = shapeId;
  canvasSelection = new Set([shapeId]);
  const editor = el('cv-editor');
  editor.value = isLineShape(shape) ? (shape.label || '') : (shape.text || '');
  editor.maxLength = isLineShape(shape) ? 100 : 500;
  editor.placeholder = isLineShape(shape) ? 'Label' : shape.type === 'frame' ? 'Frame name' : 'Type here';
  editor.hidden = false;
  renderCanvas();
  editor.focus();
  editor.select();
}

function cvPositionEditor() {
  const editor = el('cv-editor');
  const shape = canvasEditingId ? cvShape(canvasEditingId) : null;
  if (!shape) { if (!editor.hidden) editor.hidden = true; return; }
  const s = canvasView.scale;
  const fontSize = cvFontSize(shape);
  let area;
  if (isLineShape(shape)) {
    const mid = cvLineGeometry(shape).mid;
    area = { x: mid.x - 90, y: mid.y - fontSize, w: 180, h: fontSize * 2 };
  } else if (shape.type === 'frame') {
    area = { x: shape.x, y: shape.y - fontSize - 16, w: Math.max(160, Math.min(shape.w, 360)), h: fontSize + 12 };
  } else {
    area = cvTextArea(shape);
  }
  const left = canvasView.x + area.x * s;
  const top = canvasView.y + area.y * s;
  Object.assign(editor.style, {
    left: `${left}px`, top: `${top}px`, width: `${Math.max(40, area.w * s)}px`, height: `${Math.max(22, area.h * s)}px`,
    fontSize: `${fontSize * s}px`, lineHeight: '1.3',
    fontWeight: shape.type === 'text' ? '700' : shape.type === 'sticky' ? '500' : '600',
    textAlign: isLineShape(shape) || shape.type === 'frame' ? (shape.type === 'frame' ? 'left' : 'center') : (shape.align || 'center'),
    color: shape.type === 'text' ? cvPalette(shape).stroke : '#0b1c30',
    transform: shape.rot && !isLineShape(shape) ? `rotate(${shape.rot}deg)` : '',
    transformOrigin: `${(shape.x + shape.w / 2 - area.x) * s}px ${(shape.y + shape.h / 2 - area.y) * s}px`
  });
}

function cvCloseEditor(save) {
  if (!canvasEditingId) return;
  const id = canvasEditingId;
  const editor = el('cv-editor');
  canvasEditingId = null;
  editor.hidden = true;
  const shape = cvShape(id);
  if (!save || !shape) return renderCanvas();
  const key = isLineShape(shape) ? 'label' : 'text';
  const value = editor.value.slice(0, key === 'label' ? 100 : 500);
  canvasChange(() => {
    if (shape.type === 'text' && !value.trim()) {
      // An empty text box is not kept
      canvasShapes = canvasShapes.filter(s => s.id !== id);
      canvasSelection.delete(id);
    } else if (key === 'label' && !value) {
      delete shape.label;
    } else {
      shape[key] = value;
    }
  });
}

// ==========================================
// 4. STYLE BAR
// ==========================================
function cvStyleTargets() {
  const selected = cvSelected();
  if (selected.length) return { shapes: selected, group: null };
  if (!['select', 'hand', 'eraser', 'laser'].includes(canvasTool)) return { shapes: [], group: cvStyleGroup(canvasTool), probe: { type: CV_LINE_TOOLS[canvasTool] ? CV_LINE_TOOLS[canvasTool].type : canvasTool } };
  return null;
}

function cvStyleValue(targets, key) {
  if (targets.shapes.length) {
    const shape = targets.shapes.find(s => cvStyleApplies(s, key));
    if (!shape) return undefined;
    if (key === 'fill') return cvFillMode(shape);
    if (key === 'stroke_width') return shape.stroke_width || (shape.type === 'frame' ? 1 : 2);
    if (key === 'corners') return cvCorners(shape);
    if (key === 'head_start') return cvHeads(shape).start;
    if (key === 'head_end') return cvHeads(shape).end;
    if (key === 'route') return shape.route || 'straight';
    if (key === 'font') return shape.font || 'M';
    if (key === 'align') return shape.align || 'center';
    if (key === 'dash') return shape.dash || 'solid';
    if (key === 'opacity') return shape.opacity || 1;
    return shape[key];
  }
  const style = cvToolStyle[targets.group] || {};
  const defaults = { fill: 'light', stroke_width: 2, dash: 'solid', font: 'M', align: 'center', opacity: 1, corners: 'round', route: 'straight', head_start: 'none', head_end: 'triangle' };
  return style[key] !== undefined ? style[key] : defaults[key];
}

function cvApplies(targets, key) {
  const shapes = targets.shapes.length ? targets.shapes : [targets.probe];
  return shapes.some(s => cvStyleApplies(s, key));
}

function cvRenderStyleBar() {
  const bar = el('cv-stylebar');
  const targets = canvasDrag || canvasEditingId || cvPresenting() ? null : cvStyleTargets();
  if (!targets) { bar.hidden = true; cvStyleSignature = ''; return; }
  const shapes = targets.shapes;
  const signature = JSON.stringify([canvasTool, shapes.map(s => [s.id, s.color, s.fill, s.stroke_width, s.dash, s.font, s.align, s.opacity, s.corners, s.route, s.head_start, s.head_end, s.locked, s.group_id, s.task_id]),
    targets.group ? cvToolStyle[targets.group] : null]);
  if (signature !== cvStyleSignature || bar.hidden) {
    cvStyleSignature = signature;
    bar.innerHTML = cvStyleBarHtml(targets);
    bar.hidden = false;
  }
  cvPlaceStyleBar(targets);
}

function cvBarButton(action, icon, title, extra = '') {
  return `<button type="button" class="cv-bar-btn" data-bar="${action}" title="${title}" aria-label="${title}"${extra}><span class="material-symbols-outlined">${icon}</span></button>`;
}

function cvStyleBarHtml(targets) {
  const shapes = targets.shapes;
  const color = cvStyleValue(targets, 'color') || 'indigo';
  let html = `<button type="button" class="cv-bar-btn" data-pop="color" title="Colour" aria-label="Colour"><span class="cv-swatch" style="background:${CANVAS_PALETTE[color] ? CANVAS_PALETTE[color].stroke : '#4f46e5'}"></span></button>`;
  if (cvApplies(targets, 'fill')) html += cvBarButton('pop:fill', 'format_color_fill', 'Fill');
  if (cvApplies(targets, 'stroke_width')) html += cvBarButton('pop:stroke', 'line_weight', 'Stroke and opacity');
  else if (cvApplies(targets, 'opacity')) html += cvBarButton('pop:stroke', 'opacity', 'Opacity');
  if (cvApplies(targets, 'font')) html += cvBarButton('pop:text', 'format_size', 'Text size and alignment');
  if (cvApplies(targets, 'route')) html += cvBarButton('pop:line', 'conversion_path', 'Line shape and arrowheads');
  if (!shapes.length) return html;

  html += '<span class="cv-bar-sep"></span>';
  html += cvBarButton('front', 'flip_to_front', 'Bring to front') + cvBarButton('back', 'flip_to_back', 'Send to back');
  if (shapes.length > 1) html += cvBarButton('pop:align', 'align_horizontal_center', 'Align and spread');
  const grouped = shapes.some(s => s.group_id);
  if (shapes.length > 1 || grouped) html += grouped && new Set(shapes.map(s => s.group_id)).size === 1 && shapes.every(s => s.group_id)
    ? cvBarButton('ungroup', 'call_split', 'Ungroup (Ctrl+Shift+G)') : cvBarButton('group', 'join', 'Group (Ctrl+G)');
  const locked = shapes.every(s => s.locked);
  html += cvBarButton('lock', locked ? 'lock' : 'lock_open', locked ? 'Unlock (Ctrl+Shift+L)' : 'Lock (Ctrl+Shift+L)', locked ? ' data-on="1"' : '');
  if (shapes.length === 1 && cvHasText(shapes[0]) && !isLineShape(shapes[0]) && shapes[0].type !== 'frame') {
    html += cvBarButton('pop:task', shapes[0].task_id ? 'task_alt' : 'add_task', shapes[0].task_id ? 'Linked task' : 'Turn into a task or link one', shapes[0].task_id ? ' data-on="1"' : '');
  }
  html += cvBarButton('duplicate', 'content_copy', 'Duplicate (Ctrl+D)') + cvBarButton('delete', 'delete', 'Delete (Delete key)') + cvBarButton('more', 'more_horiz', 'More');
  return html;
}

function cvPlaceStyleBar(targets) {
  const bar = el('cv-stylebar');
  const area = el('canvas-area');
  const narrow = area.clientWidth < 640;
  bar.classList.toggle('is-docked', narrow);
  if (narrow) { bar.style.left = ''; bar.style.top = ''; return; }
  const width = bar.offsetWidth;
  const height = bar.offsetHeight;
  let left;
  let top;
  const bounds = targets.shapes.length ? cvBoundsOf(targets.shapes) : null;
  if (bounds) {
    left = canvasView.x + ((bounds.minX + bounds.maxX) / 2) * canvasView.scale - width / 2;
    top = canvasView.y + bounds.minY * canvasView.scale - height - 40;
    if (top < 8) top = canvasView.y + bounds.maxY * canvasView.scale + 16;
  } else {
    left = (area.clientWidth - width) / 2;
    top = 12;
  }
  left = Math.max(72, Math.min(area.clientWidth - width - 8, left));
  top = Math.max(8, Math.min(area.clientHeight - height - 60, top));
  bar.style.left = `${left}px`;
  bar.style.top = `${top}px`;
}

function cvOnStyleBarClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  event.stopPropagation();
  if (button.dataset.pop) return cvOpenPopover(button.dataset.pop, button);
  const action = button.dataset.bar || '';
  if (action.startsWith('pop:')) return cvOpenPopover(action.slice(4), button);
  cvHidePopups();
  if (action === 'front') cvArrange('front');
  else if (action === 'back') cvArrange('back');
  else if (action === 'group') cvGroup();
  else if (action === 'ungroup') cvUngroup();
  else if (action === 'lock') cvToggleLock();
  else if (action === 'duplicate') cvDuplicate();
  else if (action === 'delete') deleteSelectedShape();
  else if (action === 'more') {
    const rect = button.getBoundingClientRect();
    cvOpenContextMenu(rect.left, rect.bottom + 4, null, true);
  }
}

function cvChoiceRow(key, options, current) {
  return `<div class="cv-choice">${options.map(([value, label, icon]) =>
    `<button type="button" data-style="${key}" data-value="${value}" class="${String(current) === String(value) ? 'is-on' : ''}" title="${label}" aria-label="${label}">${icon ? `<span class="material-symbols-outlined">${icon}</span>` : escapeHtml(label)}</button>`).join('')}</div>`;
}

function cvOpenPopover(kind, anchor) {
  const pop = el('cv-popover');
  if (!pop.hidden && pop.dataset.kind === kind) return cvHidePopups();
  const targets = cvStyleTargets();
  if (!targets && kind !== 'task') return;
  let html = '';
  if (kind === 'color') {
    const current = cvStyleValue(targets, 'color');
    html = `<p class="cv-pop-title">Colour</p><div class="cv-swatches">${Object.entries(CANVAS_PALETTE).map(([name, p]) =>
      `<button type="button" data-style="color" data-value="${name}" class="${current === name ? 'is-on' : ''}" title="${p.name}" aria-label="${p.name}"><span class="cv-swatch" style="background:${p.stroke}"></span></button>`).join('')}</div>`;
  } else if (kind === 'fill') {
    html = `<p class="cv-pop-title">Fill</p>` + cvChoiceRow('fill', [['none', 'No fill', 'check_box_outline_blank'], ['light', 'Light', 'gradient'], ['solid', 'Solid', 'square']], cvStyleValue(targets, 'fill'));
  } else if (kind === 'stroke') {
    if (cvApplies(targets, 'stroke_width')) {
      html += `<p class="cv-pop-title">Stroke width</p>` + cvChoiceRow('stroke_width', [[1, 'S'], [2, 'M'], [4, 'L'], [8, 'XL']], cvStyleValue(targets, 'stroke_width'));
      html += `<p class="cv-pop-title">Stroke style</p>` + cvChoiceRow('dash', [['solid', 'Solid', 'horizontal_rule'], ['dashed', 'Dashed', 'more_horiz'], ['dotted', 'Dotted', 'more_vert']], cvStyleValue(targets, 'dash'));
    }
    if (cvApplies(targets, 'corners')) html += `<p class="cv-pop-title">Corners</p>` + cvChoiceRow('corners', [['sharp', 'Sharp', 'crop_square'], ['round', 'Rounded', 'rounded_corner']], cvStyleValue(targets, 'corners'));
    const opacity = Math.round((cvStyleValue(targets, 'opacity') || 1) * 100);
    html += `<p class="cv-pop-title">Opacity <span data-opacity-label>${opacity}%</span></p><input type="range" min="10" max="100" step="5" value="${opacity}" data-style-range="opacity" aria-label="Opacity">`;
  } else if (kind === 'text') {
    html = `<p class="cv-pop-title">Text size</p>` + cvChoiceRow('font', [['S', 'S'], ['M', 'M'], ['L', 'L'], ['XL', 'XL']], cvStyleValue(targets, 'font'));
    if (cvApplies(targets, 'align')) html += `<p class="cv-pop-title">Alignment</p>` + cvChoiceRow('align', [['left', 'Left', 'format_align_left'], ['center', 'Centre', 'format_align_center'], ['right', 'Right', 'format_align_right']], cvStyleValue(targets, 'align'));
  } else if (kind === 'line') {
    const heads = [['none', 'None'], ['arrow', 'Arrow'], ['triangle', 'Triangle'], ['dot', 'Dot']];
    html = `<p class="cv-pop-title">Line shape</p>` + cvChoiceRow('route', [['straight', 'Straight', 'trending_flat'], ['elbow', 'Elbow', 'turn_right'], ['curved', 'Curved', 'gesture']], cvStyleValue(targets, 'route'))
      + `<p class="cv-pop-title">Start</p>` + cvChoiceRow('head_start', heads, cvStyleValue(targets, 'head_start'))
      + `<p class="cv-pop-title">End</p>` + cvChoiceRow('head_end', heads, cvStyleValue(targets, 'head_end'));
  } else if (kind === 'align') {
    const alignButton = (how, icon, label) => `<button type="button" data-align="${how}" title="${label}" aria-label="${label}"><span class="material-symbols-outlined">${icon}</span></button>`;
    html = `<p class="cv-pop-title">Align</p><div class="cv-choice">${alignButton('left', 'align_horizontal_left', 'Left edges')}${alignButton('center', 'align_horizontal_center', 'Centres')}${alignButton('right', 'align_horizontal_right', 'Right edges')}</div>`
      + `<div class="cv-choice">${alignButton('top', 'align_vertical_top', 'Top edges')}${alignButton('middle', 'align_vertical_center', 'Middles')}${alignButton('bottom', 'align_vertical_bottom', 'Bottom edges')}</div>`
      + `<p class="cv-pop-title">Spread evenly</p><div class="cv-choice">${alignButton('spread-x', 'horizontal_distribute', 'Across')}${alignButton('spread-y', 'vertical_distribute', 'Down')}</div>`;
  } else if (kind === 'task') {
    html = cvTaskPopoverHtml();
  }
  pop.innerHTML = html;
  pop.dataset.kind = kind;
  pop.hidden = false;
  const area = el('canvas-area').getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(area.width - pop.offsetWidth - 8, rect.left - area.left));
  let top = rect.bottom - area.top + 6;
  if (top + pop.offsetHeight > area.height - 8) top = Math.max(8, rect.top - area.top - pop.offsetHeight - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  const search = pop.querySelector('input[type="search"]');
  if (search) search.focus();
}

function cvApplyStyle(key, value) {
  const targets = cvStyleTargets();
  if (!targets) return;
  if (key === 'stroke_width') value = Number(value);
  if (key === 'opacity') value = Number(value);
  if (targets.shapes.length) {
    canvasChange(() => targets.shapes.forEach(shape => {
      if (!cvStyleApplies(shape, key)) return;
      if (key === 'opacity' && value >= 1) delete shape.opacity; else shape[key] = value;
    }));
    // The next shape of the same kind is drawn the same way
    new Set(targets.shapes.map(s => cvStyleGroup(s.type))).forEach(group => { if (cvToolStyle[group]) cvToolStyle[group][key] = value; });
  } else {
    cvToolStyle[targets.group][key] = value;
    renderCanvas();
  }
  cvSaveToolStyle();
}

function cvOnPopoverClick(event) {
  event.stopPropagation();
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.style) {
    cvApplyStyle(button.dataset.style, button.dataset.value);
    const kind = el('cv-popover').dataset.kind;
    const anchor = document.querySelector(`#cv-stylebar [data-pop="${kind}"], #cv-stylebar [data-bar="pop:${kind}"]`);
    el('cv-popover').hidden = true;
    if (anchor && kind !== 'color') cvOpenPopover(kind, anchor);   // stays open to show the new choice
    return;
  }
  if (button.dataset.align) { cvAlign(button.dataset.align); return; }
  if (button.dataset.task) cvTaskAction(button.dataset.task, button.dataset.taskId);
}

function cvHidePopups() {
  el('cv-popover').hidden = true;
  el('cv-context').hidden = true;
  cvCloseFlyouts();
  const file = el('file-dropdown');
  if (file) file.classList.add('hidden');
}

// ==========================================
// 5. ARRANGING
// ==========================================
function cvMoveShape(shape, dx, dy) {
  shape.x += dx;
  shape.y += dy;
  if (isLineShape(shape)) { shape.x2 += dx; shape.y2 += dy; }
}

function cvAlign(how) {
  const shapes = cvSelected().filter(s => !s.locked);
  if (shapes.length < 2) return showToast('Select two or more shapes to line them up.');
  const all = cvBoundsOf(shapes);
  if (how === 'spread-x' || how === 'spread-y') {
    if (shapes.length < 3) return showToast('Select three or more shapes to spread them evenly.');
    const across = how === 'spread-x';
    const sorted = shapes.map(s => ({ s, b: shapeBounds(s) })).sort((a, b) => (across ? a.b.minX - b.b.minX : a.b.minY - b.b.minY));
    const total = sorted.reduce((sum, item) => sum + (across ? item.b.maxX - item.b.minX : item.b.maxY - item.b.minY), 0);
    const gap = ((across ? all.maxX - all.minX : all.maxY - all.minY) - total) / (sorted.length - 1);
    let at = across ? all.minX : all.minY;
    return canvasChange(() => sorted.forEach(({ s, b }) => {
      cvMoveShape(s, across ? at - b.minX : 0, across ? 0 : at - b.minY);
      at += (across ? b.maxX - b.minX : b.maxY - b.minY) + gap;
    }));
  }
  canvasChange(() => shapes.forEach(s => {
    const b = shapeBounds(s);
    const dx = how === 'left' ? all.minX - b.minX : how === 'right' ? all.maxX - b.maxX : how === 'center' ? (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2 : 0;
    const dy = how === 'top' ? all.minY - b.minY : how === 'bottom' ? all.maxY - b.maxY : how === 'middle' ? (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2 : 0;
    cvMoveShape(s, dx, dy);
  }));
}

function cvArrange(where) {
  if (!canvasSelection.size) return showToast('Select a shape first.');
  canvasChange(() => {
    const picked = canvasShapes.filter(s => canvasSelection.has(s.id));
    const others = canvasShapes.filter(s => !canvasSelection.has(s.id));
    if (where === 'front') canvasShapes = others.concat(picked);
    else if (where === 'back') canvasShapes = picked.concat(others);
    else if (where === 'forward') {
      for (let i = canvasShapes.length - 2; i >= 0; i--) {
        if (canvasSelection.has(canvasShapes[i].id) && !canvasSelection.has(canvasShapes[i + 1].id)) [canvasShapes[i], canvasShapes[i + 1]] = [canvasShapes[i + 1], canvasShapes[i]];
      }
    } else if (where === 'backward') {
      for (let i = 1; i < canvasShapes.length; i++) {
        if (canvasSelection.has(canvasShapes[i].id) && !canvasSelection.has(canvasShapes[i - 1].id)) [canvasShapes[i], canvasShapes[i - 1]] = [canvasShapes[i - 1], canvasShapes[i]];
      }
    }
  });
}

function cvGroup() {
  const shapes = cvSelected();
  if (shapes.length < 2) return showToast('Select two or more shapes to group them.');
  const groupId = newTempId();
  canvasChange(() => shapes.forEach(s => { s.group_id = groupId; }));
  showToast('Grouped. They now move together.');
}

function cvUngroup() {
  const shapes = cvSelected().filter(s => s.group_id);
  if (!shapes.length) return;
  canvasChange(() => shapes.forEach(s => { delete s.group_id; }));
}

function cvToggleLock() {
  const shapes = cvSelected();
  if (!shapes.length) return showToast('Select a shape first.');
  const lock = !shapes.every(s => s.locked);
  canvasChange(() => shapes.forEach(s => { if (lock) s.locked = true; else delete s.locked; }));
  showToast(lock ? 'Locked. It cannot be moved, changed or erased until it is unlocked.' : 'Unlocked.');
}

function deleteSelectedShape() {
  const shapes = cvSelected();
  if (!shapes.length) return showToast('Select a shape first.');
  const removable = new Set(shapes.filter(s => !s.locked).map(s => s.id));
  if (!removable.size) return showToast('Locked shapes cannot be deleted. Unlock them first.');
  canvasChange(() => {
    cvSyncBoundLines();
    canvasShapes = canvasShapes.filter(s => !removable.has(s.id));
    canvasSelection = new Set([...canvasSelection].filter(id => !removable.has(id)));
  });
  if (removable.size < shapes.length) showToast('Locked shapes were kept.');
}

function cvSelectAll() {
  canvasSelection = new Set(canvasShapes.filter(s => !s.locked).map(s => s.id));
  if (canvasTool !== 'select') selectCanvasTool('select');
  renderCanvas();
}

// Copies of shapes with new ids; connectors keep their ties only to shapes copied with them
function cvCopies(shapes, dx, dy) {
  const ids = new Map(shapes.map(s => [s.id, newTempId()]));
  const groups = new Map();
  return shapes.map(original => {
    const copy = cvClone(original);
    copy.id = ids.get(original.id);
    cvMoveShape(copy, dx, dy);
    if (copy.group_id) {
      if (!groups.has(copy.group_id)) groups.set(copy.group_id, newTempId());
      copy.group_id = groups.get(copy.group_id);
    }
    ['start_id', 'end_id'].forEach(key => {
      if (!copy[key]) return;
      if (ids.has(copy[key])) copy[key] = ids.get(copy[key]);
      else delete copy[key];
    });
    delete copy.locked;
    return copy;
  });
}

function cvInsertShapes(copies) {
  canvasChange(() => {
    canvasShapes = canvasShapes.concat(copies);
    canvasSelection = new Set(copies.map(s => s.id));
  });
  if (canvasTool !== 'select') { selectCanvasTool('select'); canvasSelection = new Set(copies.map(s => s.id)); renderCanvas(); }
}

function cvDuplicate() {
  const shapes = cvSelected();
  if (!shapes.length) return showToast('Select a shape first.');
  cvSyncBoundLines();
  cvInsertShapes(cvCopies(shapes, 24, 24));
}

function cvCopy(cut) {
  const shapes = cvSelected();
  if (!shapes.length) return showToast('Select a shape first.');
  cvSyncBoundLines();
  const marker = `c2m-canvas:${Date.now().toString(36)}`;
  try {
    localStorage.setItem(CV_CLIPBOARD_KEY, JSON.stringify({ marker, team: hubTeamId, shapes: cvClone(shapes) }));
  } catch (e) {
    return showToast('Copying is not available here (browser storage is blocked).');
  }
  cvClipboardMarker = '';
  // The system clipboard gets a marker, so pasting later knows these shapes are still what was copied last
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(marker).then(() => { cvClipboardMarker = marker; }).catch(() => {});
  if (cut) deleteSelectedShape();
  else showToast(`Copied ${shapes.length === 1 ? 'one shape' : `${shapes.length} shapes`}.`);
}

function cvPasteShapes() {
  let clip = null;
  try { clip = JSON.parse(localStorage.getItem(CV_CLIPBOARD_KEY) || 'null'); } catch (e) { clip = null; }
  if (!clip || !Array.isArray(clip.shapes) || !clip.shapes.length) return showToast('Nothing to paste yet. Copy shapes with Ctrl+C first.');
  clip.shapes = clip.shapes.map(cvSanitizeShape).filter(Boolean);
  if (!clip.shapes.length) return showToast('Nothing to paste yet. Copy shapes with Ctrl+C first.');
  const bounds = cvBoundsOf(clip.shapes);
  let dx = 24;
  let dy = 24;
  if (cvPointerInside && cvPointerWorld && bounds) {
    dx = cvPointerWorld.x - (bounds.minX + bounds.maxX) / 2;
    dy = cvPointerWorld.y - (bounds.minY + bounds.maxY) / 2;
  }
  const copies = cvCopies(clip.shapes, dx, dy);
  const pictures = copies.filter(s => s.type === 'image');
  const others = clip.team === hubTeamId ? copies : copies.filter(s => s.type !== 'image');
  if (others.length) cvInsertShapes(others);
  // A picture from another workspace is added again here, since each workspace keeps its own pictures
  if (clip.team !== hubTeamId && pictures.length) cvCopyPicturesAcross(pictures, clip.team);
}

// ==========================================
// 6. RIGHT-CLICK MENU
// ==========================================
function cvOpenContextMenu(clientX, clientY, node, fromBar) {
  const menu = el('cv-context');
  if (node && !fromBar) {
    const id = node.dataset.shapeId;
    if (!canvasSelection.has(id)) canvasSelection = new Set(cvExpandGroups([id]));
    renderCanvas();
  } else if (!fromBar && !node) {
    canvasSelection = new Set();
    renderCanvas();
  }
  const shapes = cvSelected();
  const item = (action, icon, label, keys) => `<button type="button" data-menu="${action}"><span class="material-symbols-outlined">${icon}</span><span>${label}</span>${keys ? `<kbd>${keys}</kbd>` : ''}</button>`;
  const sep = '<span class="cv-menu-sep"></span>';
  let html = '';
  if (shapes.length) {
    const single = shapes.length === 1 ? shapes[0] : null;
    if (single && cvHasText(single) && !single.locked) html += item('edit', 'edit', isLineShape(single) ? 'Edit label' : single.type === 'frame' ? 'Rename frame' : 'Edit text', 'Enter');
    html += item('cut', 'content_cut', 'Cut', 'Ctrl+X') + item('copy', 'content_copy', 'Copy', 'Ctrl+C') + item('paste', 'content_paste', 'Paste', 'Ctrl+V') + item('duplicate', 'library_add', 'Duplicate', 'Ctrl+D') + sep;
    html += item('front', 'flip_to_front', 'Bring to front', 'Ctrl+Shift+]') + item('forward', 'arrow_upward', 'Bring forward', 'Ctrl+]') + item('backward', 'arrow_downward', 'Send backward', 'Ctrl+[') + item('back', 'flip_to_back', 'Send to back', 'Ctrl+Shift+[') + sep;
    if (shapes.length > 1) html += item('group', 'join', 'Group', 'Ctrl+G');
    if (shapes.some(s => s.group_id)) html += item('ungroup', 'call_split', 'Ungroup', 'Ctrl+Shift+G');
    html += item('lock', shapes.every(s => s.locked) ? 'lock_open' : 'lock', shapes.every(s => s.locked) ? 'Unlock' : 'Lock', 'Ctrl+Shift+L');
    if (single && cvHasText(single) && !isLineShape(single) && single.type !== 'frame') {
      html += single.task_id ? item('task-open', 'task_alt', 'Open linked task') : item('task-make', 'add_task', 'Turn into a task');
    }
    html += item('zoom-selection', 'zoom_in_map', 'Zoom to selection', '2') + item('copy-image', 'image', 'Copy as image') + sep + item('delete', 'delete', 'Delete', 'Del');
  } else {
    html += item('paste', 'content_paste', 'Paste', 'Ctrl+V') + item('select-all', 'select_all', 'Select all', 'Ctrl+A') + sep
      + item('fit', 'fit_screen', 'Fit everything', '1') + item('grid', canvasSnapGrid ? 'grid_off' : 'grid_4x4', canvasSnapGrid ? 'Stop snapping to the grid' : 'Snap to the grid', '')
      + item('templates', 'dashboard_customize', 'Insert a template…') + item('image', 'add_photo_alternate', 'Add a picture…');
  }
  menu.innerHTML = html;
  menu.hidden = false;
  const area = el('canvas-area').getBoundingClientRect();
  const left = Math.max(4, Math.min(area.width - menu.offsetWidth - 4, clientX - area.left));
  const top = Math.max(4, Math.min(area.height - menu.offsetHeight - 4, clientY - area.top));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function cvOnContextClick(event) {
  const button = event.target.closest('[data-menu]');
  if (!button) return;
  event.stopPropagation();
  el('cv-context').hidden = true;
  const single = cvSelected()[0];
  ({
    edit: () => single && openShapeText(single.id),
    cut: () => cvCopy(true),
    copy: () => cvCopy(false),
    paste: cvPasteShapes,
    duplicate: cvDuplicate,
    front: () => cvArrange('front'),
    forward: () => cvArrange('forward'),
    backward: () => cvArrange('backward'),
    back: () => cvArrange('back'),
    group: cvGroup,
    ungroup: cvUngroup,
    lock: cvToggleLock,
    'task-open': () => single && cvOpenLinkedTask(single),
    'task-make': () => cvTaskAction('make'),
    'zoom-selection': () => fitCanvas(true),
    'copy-image': () => cvCopyAsImage(true),
    delete: deleteSelectedShape,
    'select-all': cvSelectAll,
    fit: () => fitCanvas(false),
    grid: cvToggleGrid,
    templates: cvOpenTemplates,
    image: cvPickImage
  }[button.dataset.menu] || (() => {}))();
}

function cvToggleGrid() {
  canvasSnapGrid = !canvasSnapGrid;
  const button = el('cv-grid-btn');
  if (button) { button.classList.toggle('is-active', canvasSnapGrid); button.setAttribute('aria-pressed', canvasSnapGrid ? 'true' : 'false'); }
  showToast(canvasSnapGrid ? 'Shapes snap to the dot grid. Hold Alt while dragging to place freely.' : 'Grid snapping is off. Shapes still line up with their neighbours.');
}

// ==========================================
// 7. KEYBOARD
// ==========================================
function cvTyping() {
  const active = document.activeElement;
  return !!active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable);
}

function cvKeyDown(e) {
  if (hubTab !== 'canvas' || !hub) return;
  if (document.querySelector('.hub-modal:not(.hidden)') || document.getElementById('htDrawer')?.classList.contains('is-open')) return;
  if (!el('cv-modal').hidden) { if (e.key === 'Escape') cvCloseModal(); return; }
  if (cvPresenting()) return cvPresentKey(e);
  if (cvTyping()) return;
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;

  if (e.key === ' ' && !cvSpaceDown) { cvSpaceDown = true; el('canvas-area').classList.add('is-space'); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (canvasDrag) return cvCancelDrag();
    cvHidePopups();
    if (canvasSelection.size) { canvasSelection = new Set(); return renderCanvas(); }
    if (canvasTool !== 'select') return selectCanvasTool('select');
    return;
  }
  if (mod && key === 'z') { e.preventDefault(); return canvasUndoStep(e.shiftKey); }
  if (mod && key === 'y') { e.preventDefault(); return canvasUndoStep(true); }
  if (mod && key === 'a') { e.preventDefault(); return cvSelectAll(); }
  if (mod && key === 'c') { if (canvasSelection.size) { e.preventDefault(); cvCopy(false); } return; }
  if (mod && key === 'x') { if (canvasSelection.size) { e.preventDefault(); cvCopy(true); } return; }
  if (mod && key === 'd') { e.preventDefault(); return cvDuplicate(); }
  if (mod && key === 'g') { e.preventDefault(); return e.shiftKey ? cvUngroup() : cvGroup(); }
  if (mod && e.shiftKey && key === 'l') { e.preventDefault(); return cvToggleLock(); }
  if (mod && (e.key === ']' || e.key === '}')) { e.preventDefault(); return cvArrange(e.shiftKey ? 'front' : 'forward'); }
  if (mod && (e.key === '[' || e.key === '{')) { e.preventDefault(); return cvArrange(e.shiftKey ? 'back' : 'backward'); }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); return zoomCanvas(1); }
  if (mod && e.key === '-') { e.preventDefault(); return zoomCanvas(-1); }
  if (mod || e.altKey) return;

  if ((e.key === 'Delete' || e.key === 'Backspace') && canvasSelection.size) { e.preventDefault(); return deleteSelectedShape(); }
  if (e.key === 'Enter' && canvasSelection.size === 1) { e.preventDefault(); return openShapeText([...canvasSelection][0]); }
  if (e.key.startsWith('Arrow') && canvasSelection.size) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    return canvasChange(() => cvSelected().filter(s => !s.locked).forEach(s => cvMoveShape(s, dx, dy)));
  }
  if (e.key === '0') { const rect = el('canvas-svg').getBoundingClientRect(); return cvZoomTo(1, rect.width / 2, rect.height / 2); }
  if (e.key === '1') return fitCanvas(false);
  if (e.key === '2') return fitCanvas(true);
  if (e.key === '?' || (e.shiftKey && e.key === '/')) return cvOpenShortcuts();
  if (key === 'i') return cvPickImage();
  if (key === 'q') return cvToggleKeepTool();
  if (key === 'g' && e.shiftKey) return cvToggleGrid();
  if (CV_TOOL_KEYS[key] && !e.shiftKey) return selectCanvasTool(CV_TOOL_KEYS[key]);
}

function cvKeyUp(e) {
  if (e.key === ' ' && cvSpaceDown) {
    cvSpaceDown = false;
    el('canvas-area').classList.remove('is-space');
  }
}

// Pasting: pictures from the clipboard, shapes copied on this board, or plain text as a text box
function cvOnPaste(e) {
  if (hubTab !== 'canvas' || !hub || cvTyping() || !el('cv-modal').hidden) return;
  const data = e.clipboardData;
  if (!data) return;
  const files = [...(data.files || [])].filter(f => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); return cvAddImageFiles(files, cvPointerInside ? cvPointerWorld : null); }
  const text = (data.getData('text/plain') || '').trim();
  let clip = null;
  try { clip = JSON.parse(localStorage.getItem(CV_CLIPBOARD_KEY) || 'null'); } catch (err) { clip = null; }
  if (clip && (text === clip.marker || (!text) || (!cvClipboardMarker && text.startsWith('c2m-canvas:')))) { e.preventDefault(); return cvPasteShapes(); }
  if (text && !text.startsWith('c2m-canvas:')) {
    e.preventDefault();
    const at = cvPointerInside && cvPointerWorld ? cvPointerWorld : cvViewCenter();
    const lines = text.slice(0, 500);
    const w = Math.min(420, Math.max(120, Math.max(...lines.split('\n').map(l => l.length)) * 9 + 24));
    const h = Math.min(400, Math.max(44, lines.split('\n').length * 22 + 20));
    const shape = { id: newTempId(), type: 'text', x: at.x - w / 2, y: at.y - h / 2, w, h, x2: 0, y2: 0, text: lines, ...cvToolDefaults('text') };
    cvInsertShapes([shape]);
  }
}

function cvViewCenter() {
  const rect = el('canvas-svg').getBoundingClientRect();
  return { x: (rect.width / 2 - canvasView.x) / canvasView.scale, y: (rect.height / 2 - canvasView.y) / canvasView.scale };
}

// ==========================================
// 8. START
// ==========================================
function cvInitTools() {
  const svg = el('canvas-svg');
  const area = el('canvas-area');
  area.tabIndex = -1;
  svg.addEventListener('pointerdown', onCanvasPointerDown);
  window.addEventListener('pointermove', onCanvasPointerMove);
  window.addEventListener('pointerup', onCanvasPointerUp);
  window.addEventListener('pointercancel', onCanvasPointerUp);
  svg.addEventListener('dblclick', (e) => {
    if (canvasTool !== 'select') return;
    const node = e.target.closest('.shape');
    if (node) return openShapeText(node.dataset.shapeId);
    // Double-clicking empty space starts a text box there
    const point = canvasPoint(e);
    const [w, h] = DEFAULT_SIZES.text;
    const shape = { id: newTempId(), type: 'text', x: point.x - w / 2, y: point.y - h / 2, w, h, x2: 0, y2: 0, text: '', ...cvToolDefaults('text') };
    cvInsertShapes([shape]);
    openShapeText(shape.id);
  });
  svg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (canvasDrag) cvCancelDrag();
    cvOpenContextMenu(e.clientX, e.clientY, e.target.closest('.shape'));
  });
  svg.addEventListener('wheel', (e) => {
    const full = !!document.fullscreenElement;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = el('canvas-svg').getBoundingClientRect();
      return cvZoomTo(canvasView.scale * Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left, e.clientY - rect.top);
    }
    if (!full) return;   // on the page, plain scrolling still scrolls the page
    e.preventDefault();
    canvasView.x -= e.deltaX;
    canvasView.y -= e.deltaY;
    cvViewChanged();
    cvRequestRender();
  }, { passive: false });
  svg.addEventListener('pointerleave', () => { cvPointerInside = false; cvShareCursor(null); });
  document.addEventListener('keydown', cvKeyDown);
  document.addEventListener('keyup', cvKeyUp);
  window.addEventListener('blur', () => { cvSpaceDown = false; area.classList.remove('is-space'); });
  document.addEventListener('paste', cvOnPaste);
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#cv-popover, #cv-stylebar, #cv-context, .cv-flyout, [data-flyout-toggle]')) {
      el('cv-popover').hidden = true;
      el('cv-context').hidden = true;
      if (!e.target.closest('#canvas-tools')) cvCloseFlyouts();
    }
  }, true);

  el('cv-stylebar').addEventListener('click', cvOnStyleBarClick);
  el('cv-popover').addEventListener('click', cvOnPopoverClick);
  el('cv-popover').addEventListener('input', (e) => {
    const range = e.target.closest('[data-style-range]');
    if (!range) return;
    const label = el('cv-popover').querySelector('[data-opacity-label]');
    if (label) label.textContent = `${range.value}%`;
  });
  el('cv-popover').addEventListener('change', (e) => {
    const range = e.target.closest('[data-style-range]');
    if (range) cvApplyStyle(range.dataset.styleRange, Number(range.value) / 100);
  });
  el('cv-context').addEventListener('click', cvOnContextClick);

  const editor = el('cv-editor');
  editor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const shape = cvShape(canvasEditingId);
    const single = shape && (isLineShape(shape) || shape.type === 'frame');
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter') || (single && e.key === 'Enter')) {
      e.preventDefault();
      cvCloseEditor(true);
      el('canvas-area').focus({ preventScroll: true });
    }
  });
  editor.addEventListener('blur', () => cvCloseEditor(true));

  // Tool bar: flyouts for the shapes and lines
  document.querySelectorAll('#canvas-tools [data-flyout-item]').forEach(button => {
    button.innerHTML = cvToolIcon(button.dataset.flyoutItem) + `<span>${escapeHtml(button.title)}</span>`;
  });
}
