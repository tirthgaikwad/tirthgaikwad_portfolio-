// ==========================================
// HUB-CANVAS-EXTRAS.JS — Everything on the canvas beyond drawing: pictures, linking shapes to tasks, export (PNG, SVG, PDF,
// clipboard), present mode, teammates' cursors and laser pointer, earlier versions, templates, the shortcuts sheet and the minimap.
// Uses the state and drawing in hub-canvas.js and the tools in hub-canvas-tools.js.
// ==========================================

const CV_PEER_COLORS = ['#e11d48', '#0284c7', '#059669', '#d97706', '#7c3aed', '#0d9488', '#ea580c'];
const CV_MINIMAP_KEY = 'c2m:canvas-minimap';
const CV_MAX_PICTURES_AT_ONCE = 10;

let cvImages = new Map();          // "team:src" -> { state: loading | ready | failed, url, dataUrl }
let cvPeers = new Map();           // user id -> { name, color, x, y, seen, sel, laser: [{x, y, t}], view, viewAt }
let cvFollowing = null;            // user id of the presenter whose view this page follows
let cvApplyingFollow = false;
let cvLaserTrail = [];
let cvLaserLoop = false;
let cvCursorLast = 0;
let cvCursorTimer = null;
let cvCursorQueued = null;
let cvSharedSel = '';
let cvPresent = null;              // { ids, index, enteredFullscreen, heartbeat }
let cvMinimapQueued = false;
let cvMinimapLast = 0;

// ==========================================
// 1. PICTURES
// ==========================================
function cvImageKey(src) { return `${hubTeamId}:${src}`; }

function cvImageUrl(src) {
  if (!src || !hubTeamId) return '';
  const entry = cvImages.get(cvImageKey(src));
  if (!entry) { cvLoadImage(src); return ''; }
  return entry.state === 'ready' ? entry.url : '';
}

function cvImageFailed(src) {
  const entry = cvImages.get(cvImageKey(src));
  return !!entry && entry.state === 'failed';
}

async function cvLoadImage(src) {
  const key = cvImageKey(src);
  const teamId = hubTeamId;
  cvImages.set(key, { state: 'loading' });
  try {
    const res = await fetch(`${API_BASE}/api/teams/${teamId}/canvas/images/${encodeURIComponent(src)}`, { credentials: 'include' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    cvImages.set(key, { state: 'ready', url: URL.createObjectURL(blob), blob });
  } catch (e) {
    cvImages.set(key, { state: 'failed' });
  }
  if (hubTeamId === teamId) cvRequestRender();
}

// A picture as a data: address, for exports (they cannot load from the server)
async function cvImageDataUrl(src) {
  const key = cvImageKey(src);
  let entry = cvImages.get(key);
  if (!entry || entry.state === 'loading') { await cvLoadImage(src); entry = cvImages.get(key); }
  if (!entry || entry.state !== 'ready') return '';
  if (!entry.dataUrl) {
    entry.dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(entry.blob);
    });
  }
  return entry.dataUrl;
}

function cvPickImage() {
  if (!hub) return;
  el('cv-image-input').click();
}

async function cvUploadPicture(blob, teamId) {
  const form = new FormData();
  form.append('file', blob, blob.type === 'image/png' ? 'picture.png' : blob.type === 'image/gif' ? 'picture.gif' : 'picture.jpg');
  const res = await fetch(`${API_BASE}/api/teams/${teamId}/canvas/images`, { method: 'POST', body: form, credentials: 'include' });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error(data && typeof data.detail === 'string' ? data.detail : 'The picture could not be uploaded.');
  return data.src;
}

// Adds pictures to the board: shrunk in the browser, uploaded, then placed where they were dropped (or in the middle)
async function cvAddImageFiles(files, at) {
  const pictures = [...files].filter(f => /^image\/(png|jpeg|webp|gif)$/.test(f.type)).slice(0, CV_MAX_PICTURES_AT_ONCE);
  if (!pictures.length) return showToast('Choose a JPG, PNG, WebP or GIF picture.');
  const teamId = hubTeamId;
  const place = at || cvViewCenter();
  setCanvasStatus(pictures.length === 1 ? 'Adding the picture...' : `Adding ${pictures.length} pictures...`);
  const added = [];
  for (const [i, file] of pictures.entries()) {
    try {
      const { blob, width, height } = await shrinkImageFile(file, 1600);
      const src = await cvUploadPicture(blob, teamId);
      if (hubTeamId !== teamId) return;
      cvImages.set(cvImageKey(src), { state: 'ready', url: URL.createObjectURL(blob), blob });
      const fit = Math.min(1, 480 / Math.max(width, height));
      const w = Math.round(width * fit);
      const h = Math.round(height * fit);
      added.push({ id: newTempId(), type: 'image', src, x: place.x - w / 2 + i * 24, y: place.y - h / 2 + i * 24, w, h, x2: 0, y2: 0, text: '', color: 'slate' });
    } catch (err) {
      showToast(err.message);
    }
  }
  if (added.length) cvInsertShapes(added);
  else setCanvasStatus(canvasDirty ? 'Unsaved changes' : 'Saved');
}

// Pictures pasted from another workspace's canvas are uploaded again here
async function cvCopyPicturesAcross(pictures, fromTeam) {
  const teamId = hubTeamId;
  const added = [];
  for (const picture of pictures) {
    try {
      const res = await fetch(`${API_BASE}/api/teams/${fromTeam}/canvas/images/${encodeURIComponent(picture.src)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('gone');
      const blob = await res.blob();
      const src = await cvUploadPicture(blob, teamId);
      cvImages.set(cvImageKey(src), { state: 'ready', url: URL.createObjectURL(blob), blob });
      added.push({ ...picture, src });
    } catch (e) { /* counted below */ }
  }
  if (hubTeamId !== teamId) return;
  if (added.length) cvInsertShapes(added);
  if (added.length < pictures.length) showToast('Some pictures could not be copied from the other workspace.');
}

// ==========================================
// 2. TASK LINKS
// ==========================================
function cvTaskPopoverHtml(filter) {
  const shape = cvSelected()[0];
  if (!shape) return '';
  const tasks = hub ? hub.tasks || [] : [];
  if (shape.task_id) {
    const task = tasks.find(t => t.id === shape.task_id);
    return `<p class="cv-pop-title">Linked task</p>`
      + (task ? `<p class="cv-task-title">${escapeHtml(task.title)}</p><p class="cv-muted">${escapeHtml(CV_TASK_STATUS[task.column] || 'To do')}${task.due_date ? ` · due ${escapeHtml(formatDue(task.due_date))}` : ''}</p>`
        : '<p class="cv-muted">The task was deleted.</p>')
      + `<div class="cv-pop-actions">${task ? '<button type="button" class="ht-btn is-small" data-task="open">Open task</button>' : ''}<button type="button" class="ht-btn is-small is-quiet" data-task="unlink">Unlink</button></div>`;
  }
  const query = String(filter || '').trim().toLowerCase();
  const matches = tasks.filter(t => !query || t.title.toLowerCase().includes(query)).slice(0, 8);
  return `<p class="cv-pop-title">Make it a task</p><p class="cv-muted">The shape's text becomes the task title, and the shape shows the task's progress.</p>`
    + `<div class="cv-pop-actions"><button type="button" class="ht-btn is-small" data-task="make"><span class="material-symbols-outlined">add_task</span>Turn into a task</button></div>`
    + `<p class="cv-pop-title">Or link a task</p><input type="search" class="cv-pop-search" placeholder="Search tasks" value="${escapeHtml(filter || '')}" aria-label="Search tasks">`
    + `<div class="cv-task-list">${matches.length ? matches.map(t => `<button type="button" data-task="link" data-task-id="${t.id}"><span class="cv-dot is-${escapeHtml(t.column)}"></span><span>${escapeHtml(t.title)}</span></button>`).join('') : '<p class="cv-muted">No tasks match.</p>'}</div>`;
}

async function cvTaskAction(action, taskId) {
  const shape = cvSelected()[0];
  el('cv-popover').hidden = true;
  if (!shape) return;
  if (action === 'open') return cvOpenLinkedTask(shape);
  if (action === 'unlink') return canvasChange(() => { delete shape.task_id; });
  if (action === 'link') {
    const id = parseInt(taskId, 10);
    canvasChange(() => { shape.task_id = id; });
    return showToast('Linked. The shape now shows the task’s progress.');
  }
  if (action === 'make') {
    const title = String(shape.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!title) {
      showToast('Type the task title on the shape first.');
      return openShapeText(shape.id);
    }
    const saved = await createTask({ title });
    if (!saved || !cvShape(shape.id)) return;
    canvasChange(() => { cvShape(shape.id).task_id = saved.id; });
    showToast(`Task added to To Do: “${saved.title}”.`);
  }
}

function cvOpenLinkedTask(shape) {
  const task = (hub.tasks || []).find(t => t.id === shape.task_id);
  if (!task) return showToast('That task was deleted. Unlink it from the shape’s task button.');
  // The task panel is not inside the full-screen canvas
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  openTaskDrawer(task.id);
}

// ==========================================
// 3. EXPORT
// ==========================================
function cvExportShapes(selectionOnly) {
  return selectionOnly && canvasSelection.size ? cvSelected() : canvasShapes;
}

function cvExportSelectionOnly() {
  const box = el('cv-export-selection');
  return !!box && box.checked && canvasSelection.size > 0;
}

async function cvExportSvg(shapes, bounds) {
  const pictures = new Map();
  await Promise.all(shapes.filter(s => s.type === 'image').map(async s => pictures.set(s.src, await cvImageDataUrl(s.src))));
  const box = bounds || cvBoundsOf(shapes);
  const titled = shapes.some(s => s.type === 'frame');
  const pad = 40;
  const minY = box.minY - (titled && !bounds ? 28 : 0);
  const width = Math.ceil(box.maxX - box.minX + pad * 2);
  const height = Math.ceil(box.maxY - minY + pad * 2);
  const body = cvDrawOrder(shapes).map(s => shapeSvg(s, { forExport: true, imageUrl: src => pictures.get(src) || '' })).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${canvasDefsSvg()}<rect width="100%" height="100%" fill="#ffffff"/><g transform="translate(${pad - box.minX} ${pad - minY})">${body}</g></svg>`;
  return { svg, width, height };
}

// Kept for older callers and tests: the whole board as SVG text
function canvasExportSvg() {
  const bounds = canvasBounds();
  const pad = 40;
  const width = Math.ceil(bounds.maxX - bounds.minX + pad * 2);
  const height = Math.ceil(bounds.maxY - bounds.minY + pad * 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${canvasDefsSvg()}<rect width="100%" height="100%" fill="#ffffff"/><g transform="translate(${pad - bounds.minX} ${pad - bounds.minY})">${cvDrawOrder(canvasShapes).map(s => shapeSvg(s, { forExport: true, imageUrl: cvImageUrl })).join('')}</g></svg>`;
  return { svg, width, height };
}

function cvSvgToPng(svg, width, height) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      // Sharper on high-density screens, within what browsers can draw
      const scale = Math.max(0.25, Math.min(2, 8000 / Math.max(width, height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d');
      context.scale(scale, scale);
      context.drawImage(image, 0, 0);
      canvas.toBlob(blob => (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error('The image could not be created.'))), 'image/png');
    };
    image.onerror = () => reject(new Error('The image could not be created.'));
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

async function exportCanvasPng() {
  const shapes = cvExportShapes(cvExportSelectionOnly());
  if (shapes.length === 0) return showToast('There is nothing on the canvas to export.');
  try {
    const { svg, width, height } = await cvExportSvg(shapes);
    const png = await cvSvgToPng(svg, width, height);
    window.__lastCanvasPng = { width: png.width, height: png.height, bytes: png.blob.size };
    downloadBlob(png.blob, `${safeFileName(hub.board.name)}-canvas.png`);
    showToast('Canvas exported as PNG.');
  } catch (err) {
    showToast(err.message);
  }
}

async function exportCanvasSvgFile() {
  const shapes = cvExportShapes(cvExportSelectionOnly());
  if (shapes.length === 0) return showToast('There is nothing on the canvas to export.');
  const { svg, width, height } = await cvExportSvg(shapes);
  window.__lastCanvasSvg = { width, height, bytes: svg.length };
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${safeFileName(hub.board.name)}-canvas.svg`);
  showToast('Canvas exported as SVG.');
}

async function cvCopyAsImage(selectionOnly) {
  const shapes = cvExportShapes(selectionOnly);
  if (!shapes.length) return showToast('There is nothing to copy.');
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return showToast('This browser cannot copy pictures. Use File → Export as PNG instead.');
  try {
    const { svg, width, height } = await cvExportSvg(shapes);
    const png = await cvSvgToPng(svg, width, height);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png.blob })]);
    showToast('Copied as a picture. Paste it into a chat, document or slide.');
  } catch (err) {
    showToast('The picture could not be copied here. Use File → Export as PNG instead.');
  }
}

// PDF: a print-ready page per frame (or the whole board), printed or saved as PDF by the browser
async function exportCanvasPdf() {
  const selectionOnly = cvExportSelectionOnly();
  const shapes = cvExportShapes(selectionOnly);
  if (!shapes.length) return showToast('There is nothing on the canvas to export.');
  const popup = window.open('', '_blank');
  if (!popup) return showToast('Allow pop-ups for this site to save the canvas as PDF.');
  popup.document.write('<p style="font:14px Arial,sans-serif;padding:24px">Preparing the pages…</p>');
  const frames = selectionOnly ? [] : cvFramesInOrder().map(cvShape).filter(Boolean);
  const pages = [];
  if (frames.length) {
    for (const frame of frames) {
      const box = shapeBounds(frame);
      const { svg } = await cvExportSvg(canvasShapes.filter(s => s.id !== frame.id), box);
      pages.push({ title: frame.text || 'Frame', svg });
    }
  } else {
    pages.push({ title: hub.board.name, svg: (await cvExportSvg(shapes)).svg });
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(hub.board.name)} - canvas</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    html, body { margin: 0; background: #fff; }
    .page { height: 186mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    h1 { font: 600 12pt Inter, Arial, sans-serif; color: #0b1c30; margin: 0 0 4mm; }
    .art { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .art svg { max-width: 100%; max-height: 100%; width: auto; height: auto; }
    @media screen { body { background: #eff4ff; padding: 16px; } .page { background: #fff; margin: 0 auto 16px; max-width: 277mm; padding: 10mm; box-shadow: 0 2px 8px rgba(11,28,48,.12); } }
  </style></head><body>${pages.map(p => `<section class="page"><h1>${escapeHtml(p.title)}</h1><div class="art">${p.svg.replace(/^<svg ([^>]*?)width="\d+" height="\d+"/, '<svg $1')}</div></section>`).join('')}
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });<\/script></body></html>`;
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  window.__lastCanvasPdf = { pages: pages.length };
}

// ===== FILE MENU =====
function canvasFileAction(action) {
  el('file-dropdown').classList.add('hidden');
  if (action === 'save') {
    if (!canvasDirty) return showToast('Everything is already saved.');
    return saveCanvas();
  }
  if (action === 'png') return exportCanvasPng();
  if (action === 'svg') return exportCanvasSvgFile();
  if (action === 'pdf') return exportCanvasPdf();
  if (action === 'clipboard') return cvCopyAsImage(cvExportSelectionOnly());
  if (action === 'versions') return cvOpenVersions();
  if (action === 'backup') {
    if (canvasShapes.length === 0) return showToast('There is nothing on the canvas to copy.');
    downloadBlob(new Blob([JSON.stringify({ board: hub.board.name, saved_at: new Date().toISOString(), shapes: canvasShapes }, null, 2)], { type: 'application/json' }), `${safeFileName(hub.board.name)}-canvas.json`);
    return showToast('A copy of the canvas was downloaded.');
  }
  if (action === 'restore') el('canvas-restore-input').click();
}

function toggleCanvasFileMenu(event) {
  event.stopPropagation();
  const menu = el('file-dropdown');
  const opening = menu.classList.contains('hidden');
  cvHidePopups();
  menu.classList.toggle('hidden', !opening);
  const row = el('cv-export-selection-row');
  if (row) row.classList.toggle('hidden', canvasSelection.size === 0);
}

function restoreCanvasCopy(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let shapes;
    try {
      const parsed = JSON.parse(reader.result);
      shapes = Array.isArray(parsed) ? parsed : parsed.shapes;
      if (!Array.isArray(shapes)) throw new Error('no shapes');
    } catch (e) {
      return showToast('That file is not a canvas copy from this page.');
    }
    const apply = async () => {
      const copies = cvCopies(shapes.map(cvSanitizeShape).filter(Boolean), 0, 0)
        .filter(s => s.type !== 'image');   // pictures belong to the workspace they were added in
      canvasChange(() => {
        canvasShapes = copies;
        canvasSelection = new Set();
      });
      cvReplaceAll('open_copy');
      fitCanvas();
      if (copies.length < shapes.length) showToast('Pictures, and anything this board does not support, were left out of the copy.');
    };
    if (canvasShapes.length === 0) return apply();
    hubConfirm('Open a Copy', `Replace the ${canvasShapes.length} shapes on the canvas with the ${shapes.length} in this file? This affects everyone in the workspace. The canvas as it is now is kept under File → Version history.`, 'Replace', apply);
  };
  reader.readAsText(file);
}

// ==========================================
// 4. PRESENT MODE
// ==========================================
function cvPresenting() { return !!cvPresent; }

// Frames numbered in their name ("1 Problem", "2. Idea") come first in that order, the rest as they are read: by rows, left to right
function cvFramesInOrder() {
  const frames = canvasShapes.filter(s => s.type === 'frame');
  const number = (f) => { const m = /^\s*(\d+)/.exec(f.text || ''); return m ? parseInt(m[1], 10) : null; };
  const numbered = frames.filter(f => number(f) !== null).sort((a, b) => number(a) - number(b));
  const rest = frames.filter(f => number(f) === null).sort((a, b) => (Math.round(a.y / 200) - Math.round(b.y / 200)) || (a.x - b.x));
  return numbered.concat(rest).map(f => f.id);
}

function cvStartPresenting() {
  const ids = cvFramesInOrder();
  if (!ids.length) return showToast('Add a frame (F) round each part you want to show, then present. Frames are shown one after another.');
  cvHidePopups();
  if (canvasEditingId) cvCloseEditor(true);
  canvasSelection = new Set();
  selectCanvasTool('select');
  cvPresent = { ids, index: 0, enteredFullscreen: false, before: { ...canvasView } };
  el('canvas-wrapper').classList.add('is-presenting');
  el('cv-present-bar').hidden = false;
  if (!document.fullscreenElement && el('canvas-wrapper').requestFullscreen) {
    el('canvas-wrapper').requestFullscreen().then(() => { if (cvPresent) cvPresent.enteredFullscreen = true; cvShowFrame(cvPresent ? cvPresent.index : 0); }).catch(() => {});
  }
  cvShowFrame(0);
  cvPresent.heartbeat = setInterval(() => cvSharePresentView(), 3000);
}

function cvShowFrame(index) {
  if (!cvPresent) return;
  cvPresent.ids = cvPresent.ids.filter(id => cvShape(id));
  if (!cvPresent.ids.length) return cvStopPresenting(false);
  cvPresent.index = Math.max(0, Math.min(cvPresent.ids.length - 1, index));
  const frame = cvShape(cvPresent.ids[cvPresent.index]);
  const box = shapeBounds(frame);
  cvAnimateView(cvViewFor({ minX: box.minX, minY: box.minY - 28, maxX: box.maxX, maxY: box.maxY }, CV_MAX_SCALE));
  el('cv-present-label').textContent = `${cvPresent.index + 1} / ${cvPresent.ids.length} · ${frame.text || 'Frame'}`;
  el('cv-present-prev').disabled = cvPresent.index === 0;
  el('cv-present-next').disabled = cvPresent.index === cvPresent.ids.length - 1;
  cvSharePresentView();
}

function cvSharePresentView() {
  if (!cvPresent) return;
  const frame = cvShape(cvPresent.ids[cvPresent.index]);
  if (!frame) return;
  const box = shapeBounds(frame);
  cvSendCursor({ view: { x: box.minX, y: box.minY - 28, w: box.maxX - box.minX, h: box.maxY - box.minY + 28 } });
}

function cvStopPresenting(fromFullscreenExit) {
  if (!cvPresent) return;
  const present = cvPresent;
  cvPresent = null;
  clearInterval(present.heartbeat);
  el('canvas-wrapper').classList.remove('is-presenting');
  el('cv-present-bar').hidden = true;
  if (present.enteredFullscreen && !fromFullscreenExit && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  canvasView = present.before;
  renderCanvas();
}

function cvPresentKey(e) {
  const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key);
  const previous = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key);
  if (e.key === 'Escape') { e.preventDefault(); return cvStopPresenting(false); }
  if (e.key === 'Home') { e.preventDefault(); return cvShowFrame(0); }
  if (e.key === 'End') { e.preventDefault(); return cvShowFrame(cvPresent.ids.length - 1); }
  if (next || previous) { e.preventDefault(); cvShowFrame(cvPresent.index + (next ? 1 : -1)); }
}

// In present mode a tap or swipe moves between frames instead of drawing
function cvPresentPointer(event) {
  if (!cvPresent || event.target.closest('#cv-present-bar')) return;
  event.stopPropagation();
  event.preventDefault();
  if (event.type === 'pointerdown') { cvPresent.downAt = { x: event.clientX, y: event.clientY }; return; }
  const start = cvPresent.downAt;
  cvPresent.downAt = null;
  if (!start) return;
  const dx = event.clientX - start.x;
  const rect = el('canvas-area').getBoundingClientRect();
  if (Math.abs(dx) > 50) return cvShowFrame(cvPresent.index + (dx < 0 ? 1 : -1));
  cvShowFrame(cvPresent.index + (event.clientX - rect.left > rect.width / 3 ? 1 : -1));
}

// ==========================================
// 5. TEAMMATES ON THE CANVAS: CURSORS, SELECTIONS, LASER, FOLLOWING A PRESENTER
// ==========================================
function cvSendCursor(payload) {
  if (!hubSocket || hubSocket.readyState !== WebSocket.OPEN || hubTab !== 'canvas') return;
  try { hubSocket.send(JSON.stringify({ type: 'canvas_cursor', ...payload })); } catch (e) { /* reconnects by itself */ }
}

// Where this person's pointer is, at most 15 times a second (the last position is always sent)
function cvShareCursor(point, laser) {
  cvCursorQueued = { point: point || cvCursorQueued && cvCursorQueued.point || null, laser: !!laser };
  const wait = 66 - (Date.now() - cvCursorLast);
  if (wait > 0) {
    if (!cvCursorTimer) cvCursorTimer = setTimeout(() => { cvCursorTimer = null; if (cvCursorQueued) cvShareCursor(cvCursorQueued.point, cvCursorQueued.laser); }, wait);
    return;
  }
  cvCursorLast = Date.now();
  const queued = cvCursorQueued;
  cvCursorQueued = null;
  const payload = { sel: [...canvasSelection].slice(0, 50) };
  if (queued.point) { payload.x = cvRound(queued.point.x); payload.y = cvRound(queued.point.y); }
  if (queued.laser) payload.laser = true;
  cvSendCursor(payload);
}

function cvPeerColor(userId) { return CV_PEER_COLORS[Math.abs(userId) % CV_PEER_COLORS.length]; }

function onCanvasCursor(data) {
  if (data.from === currentUserId) return;
  if (data.gone) { cvPeers.delete(data.from); cvRenderPeers(); return cvRequestRender(); }
  const peer = cvPeers.get(data.from) || { name: data.name || 'Teammate', color: cvPeerColor(data.from), laser: [], sel: [] };
  peer.name = data.name || peer.name;
  peer.seen = Date.now();
  if (typeof data.x === 'number') { peer.x = data.x; peer.y = data.y; }
  const selChanged = JSON.stringify(peer.sel) !== JSON.stringify(data.sel || []);
  peer.sel = data.sel || [];
  if (data.laser && typeof data.x === 'number') { peer.laser.push({ x: data.x, y: data.y, t: Date.now() }); cvRunLaser(); }
  if (data.view) {
    peer.view = data.view;
    peer.viewAt = Date.now();
    if (cvFollowing === data.from) cvFollowView(peer.view);
  }
  const isNew = !cvPeers.has(data.from);
  cvPeers.set(data.from, peer);
  if (isNew || data.view) cvRenderPeers();
  cvPositionCursors();
  if (selChanged) cvRequestRender();
}

// Teammates who leave the canvas disappear from it
function cvPeersPresence(viewers) {
  const onCanvas = new Set((viewers || []).filter(v => v.tab === 'canvas').map(v => v.user_id));
  let changed = false;
  [...cvPeers.keys()].forEach(id => { if (!onCanvas.has(id)) { cvPeers.delete(id); changed = true; } });
  if (cvFollowing && !onCanvas.has(cvFollowing)) cvFollowing = null;
  if (changed) { cvRenderPeers(); cvRequestRender(); }
  cvRenderPeers();
}

function cvPositionCursors() {
  const box = el('canvas-cursors');
  if (!box) return;
  const now = Date.now();
  const html = [];
  cvPeers.forEach((peer, id) => {
    if (typeof peer.x !== 'number') return;
    const idle = now - (peer.seen || 0) > 5000;
    const left = canvasView.x + peer.x * canvasView.scale;
    const top = canvasView.y + peer.y * canvasView.scale;
    html.push(`<div class="cv-cursor${idle ? ' is-idle' : ''}" data-peer="${id}" style="transform:translate(${Math.round(left)}px, ${Math.round(top)}px)"><svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M1 1 L14 9 L8 10 L5 16 Z" fill="${peer.color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg><span style="background:${peer.color}">${escapeHtml(peer.name)}</span></div>`);
  });
  box.innerHTML = html.join('');
}

function cvPeerSelectionSvg() {
  let out = '';
  cvPeers.forEach(peer => {
    (peer.sel || []).forEach(id => {
      const shape = cvShape(id);
      if (!shape) return;
      const b = shapeBounds(shape);
      const pad = 5 / canvasView.scale;
      out += `<rect x="${b.minX - pad}" y="${b.minY - pad}" width="${b.maxX - b.minX + pad * 2}" height="${b.maxY - b.minY + pad * 2}" rx="${4 / canvasView.scale}" fill="none" stroke="${peer.color}" stroke-width="${2 / canvasView.scale}" style="pointer-events:none;"/>`;
    });
  });
  return out;
}

function cvRenderPeers() {
  const box = el('canvas-peers');
  if (!box) return;
  const now = Date.now();
  const presenter = [...cvPeers.entries()].find(([, p]) => p.viewAt && now - p.viewAt < 8000);
  const faces = [...cvPeers.entries()].slice(0, 5).map(([id, p]) =>
    `<span class="cv-peer" style="background:${p.color}" title="${escapeHtml(p.name)} is on the canvas">${escapeHtml(getInitials(p.name || '?'))}</span>`).join('');
  let follow = '';
  if (presenter) {
    const [id, p] = presenter;
    follow = cvFollowing === id
      ? `<button type="button" class="cv-follow is-on" data-follow="stop" title="Stop following">Following ${escapeHtml(p.name.split(' ')[0])} · Stop</button>`
      : `<button type="button" class="cv-follow" data-follow="${id}" title="Your view follows ${escapeHtml(p.name)}'s slides">${escapeHtml(p.name.split(' ')[0])} is presenting · Follow</button>`;
  } else if (cvFollowing) {
    cvFollowing = null;
  }
  box.innerHTML = faces + follow;
}

function cvFollowView(view) {
  const target = cvViewFor({ minX: view.x, minY: view.y, maxX: view.x + view.w, maxY: view.y + view.h }, CV_MAX_SCALE);
  cvApplyingFollow = true;
  cvAnimateView(target, () => { cvApplyingFollow = false; });
}

// Called when this person moves or zooms the view: following a presenter stops
function cvViewChanged() {
  if (cvFollowing && !cvApplyingFollow) {
    cvFollowing = null;
    cvRenderPeers();
  }
}

function cvLaserPoint(point) {
  cvLaserTrail.push({ x: point.x, y: point.y, t: Date.now() });
  cvShareCursor(point, true);
  cvRunLaser();
}

function cvStopLaser() { cvLaserTrail = []; }

function cvRunLaser() {
  if (cvLaserLoop) return;
  cvLaserLoop = true;
  const tick = () => {
    const cutoff = Date.now() - 1000;
    cvLaserTrail = cvLaserTrail.filter(p => p.t > cutoff);
    let any = cvLaserTrail.length > 0;
    cvPeers.forEach(peer => { peer.laser = peer.laser.filter(p => p.t > cutoff); if (peer.laser.length) any = true; });
    renderCanvas();
    if (any) requestAnimationFrame(tick); else cvLaserLoop = false;
  };
  requestAnimationFrame(tick);
}

function cvLaserSvg() {
  const now = Date.now();
  const trail = (points, color) => {
    if (!points.length) return '';
    let out = '';
    for (let i = 1; i < points.length; i++) {
      const age = (now - points[i].t) / 1000;
      out += `<line x1="${points[i - 1].x}" y1="${points[i - 1].y}" x2="${points[i].x}" y2="${points[i].y}" stroke="${color}" stroke-opacity="${Math.max(0, 0.85 - age).toFixed(2)}" stroke-width="${4 / canvasView.scale}" stroke-linecap="round" style="pointer-events:none;"/>`;
    }
    const last = points[points.length - 1];
    return out + `<circle cx="${last.x}" cy="${last.y}" r="${5 / canvasView.scale}" fill="${color}" style="pointer-events:none;"/>`;
  };
  let out = trail(cvLaserTrail, '#e11d48');
  cvPeers.forEach(peer => { out += trail(peer.laser || [], peer.color); });
  return out;
}

// ==========================================
// 6. DIALOGS: VERSIONS, TEMPLATES, SHORTCUTS
// ==========================================
function cvOpenModal(title, bodyHtml, wide) {
  const modal = el('cv-modal');
  modal.innerHTML = `<div class="cv-dialog${wide ? ' is-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="cvModalTitle">
    <div class="cv-dialog-head"><h3 id="cvModalTitle">${escapeHtml(title)}</h3><button type="button" class="ht-icon-btn" data-modal-close aria-label="Close"><span class="material-symbols-outlined">close</span></button></div>
    <div class="cv-dialog-body">${bodyHtml}</div></div>`;
  modal.hidden = false;
  cvHidePopups();
  const close = modal.querySelector('[data-modal-close]');
  close.focus();
  return modal;
}

function cvCloseModal() {
  const modal = el('cv-modal');
  modal.hidden = true;
  modal.innerHTML = '';
  el('canvas-area').focus({ preventScroll: true });
}

// A small picture of some shapes, for previews (connector ends are looked up among these shapes, not the board's)
function cvMiniSvg(shapes, width, height) {
  if (!shapes.length) return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="100%"><text x="50%" y="50%" text-anchor="middle" font-family="Inter, Arial" font-size="12" fill="#777587">Empty</text></svg>`;
  const saved = canvasShapes;
  canvasShapes = shapes;
  try {
    const box = cvBoundsOf(shapes);
    const pad = 20;
    return `<svg viewBox="${box.minX - pad} ${box.minY - pad - 24} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2 + 24}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${canvasDefsSvg()}${cvDrawOrder(shapes).map(s => shapeSvg(s, { forExport: true, imageUrl: cvImageUrl })).join('')}</svg>`;
  } finally {
    canvasShapes = saved;
  }
}

const CV_VERSION_REASONS = { clear: 'Before the canvas was cleared', open_copy: 'Before a copy was opened', restore: 'Before an earlier version was restored', template: 'Before a template replaced it' };

async function cvOpenVersions() {
  if (!hub) return;
  const modal = cvOpenModal('Version history', '<p class="cv-muted">Loading earlier versions…</p>', true);
  let versions;
  try {
    versions = await api(`/api/teams/${hubTeamId}/canvas/versions`);
  } catch (err) {
    modal.querySelector('.cv-dialog-body').innerHTML = `<p class="cv-muted">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (el('cv-modal').hidden) return;
  const body = modal.querySelector('.cv-dialog-body');
  if (!versions.length) {
    body.innerHTML = '<p class="cv-muted">No earlier versions yet. While people draw, the canvas is kept every 10 minutes, and always before it is cleared or replaced. The last 30 are kept.</p>';
    return;
  }
  body.innerHTML = `<p class="cv-muted">The canvas is kept every 10 minutes while people draw, and always before it is cleared or replaced. The last 30 are kept.</p>
    <div class="cv-versions"><div class="cv-version-list">${versions.map(v => {
      const who = hubMember(v.created_by);
      return `<button type="button" class="cv-version" data-version="${v.id}"><strong>${escapeHtml(new Date(v.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</strong>
        <span>${escapeHtml(CV_VERSION_REASONS[v.reason] || 'While drawing')}${who ? ` · by ${escapeHtml(who.user_name)}` : ''}</span><span>${v.shape_count} shape${v.shape_count === 1 ? '' : 's'}</span></button>`;
    }).join('')}</div>
    <div class="cv-version-preview"><div class="cv-version-art" id="cvVersionArt"><p class="cv-muted">Pick a version to see it.</p></div>
    <div class="cv-pop-actions"><button type="button" class="ht-btn" id="cvVersionRestore" disabled>Restore this version</button></div></div></div>`;
  let picked = null;
  body.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-version]');
    if (row) {
      body.querySelectorAll('.cv-version').forEach(r => r.classList.toggle('is-on', r === row));
      picked = parseInt(row.dataset.version, 10);
      el('cvVersionArt').innerHTML = '<p class="cv-muted">Loading…</p>';
      el('cvVersionRestore').disabled = true;
      try {
        const version = await api(`/api/teams/${hubTeamId}/canvas/versions/${picked}`);
        if (picked !== version.id) return;
        el('cvVersionArt').innerHTML = cvMiniSvg(version.shapes, 400, 260);
        el('cvVersionRestore').disabled = false;
      } catch (err) {
        el('cvVersionArt').innerHTML = `<p class="cv-muted">${escapeHtml(err.message)}</p>`;
      }
      return;
    }
    if (e.target.closest('#cvVersionRestore') && picked) {
      const id = picked;
      hubConfirm('Restore Version', 'Put this version back on the canvas for everyone in the workspace? The canvas as it is now is kept as a version too, so this can be undone.', 'Restore', async () => {
        await flushCanvasSave();
        const result = await api(`/api/teams/${hubTeamId}/canvas/versions/${id}/restore`, { method: 'POST', body: { client_id: hubClientId } });
        hub.canvas = result.shapes;
        saveHubCache();
        loadCanvasShapes(result.shapes);
        cvCloseModal();
        fitCanvas();
        showToast('The earlier version is back.');
      });
    }
  });
}

function cvOpenTemplates() {
  if (!hub) return;
  const modal = cvOpenModal('Templates', `<p class="cv-muted">A starter is added in the middle of your view, inside a frame you can move, rename and present.</p>
    <div class="cv-templates">${CANVAS_TEMPLATES.map(t => `<button type="button" class="cv-template" data-template="${t.id}"><span class="cv-template-art">${cvMiniSvg(t.build(), 220, 140)}</span><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.description)}</span></button>`).join('')}</div>`, true);
  modal.querySelector('.cv-templates').addEventListener('click', (e) => {
    const card = e.target.closest('[data-template]');
    if (!card) return;
    cvInsertTemplate(card.dataset.template);
    cvCloseModal();
  });
}

function cvInsertTemplate(id) {
  const template = CANVAS_TEMPLATES.find(t => t.id === id);
  if (!template) return;
  const shapes = template.build();
  const box = cvBoundsOf(shapes);
  const center = cvViewCenter();
  const copies = cvCopies(shapes, center.x - (box.minX + box.maxX) / 2, center.y - (box.minY + box.maxY) / 2);
  cvInsertShapes(copies);
  canvasView = cvViewFor(cvBoundsOf(copies), 1.2);
  renderCanvas();
  showToast(`${template.name} added. Double-click any shape to change its text.`);
}

function cvOpenShortcuts() {
  const rows = [
    ['Tools', [['V', 'Select'], ['H or Space + drag', 'Move around'], ['P', 'Pen'], ['M', 'Highlighter'], ['E', 'Eraser'], ['R / O / D', 'Rectangle, ellipse, diamond'], ['A / L', 'Arrow, line'], ['T', 'Text'], ['N', 'Sticky note'], ['F', 'Frame'], ['I', 'Picture'], ['K', 'Laser pointer'], ['Q', 'Keep the tool after drawing']]],
    ['Editing', [['Double-click', 'Edit text (on empty space: new text)'], ['Enter', 'Edit the selected shape’s text'], ['Shift + click', 'Add to the selection'], ['Ctrl + A', 'Select all'], ['Ctrl + C / X / V', 'Copy, cut, paste'], ['Ctrl + D', 'Duplicate'], ['Delete', 'Delete'], ['Arrow keys', 'Nudge (Shift: 10 px)'], ['Ctrl + Z', 'Undo'], ['Ctrl + Shift + Z or Ctrl + Y', 'Redo']]],
    ['Arranging', [['Ctrl + G / Ctrl + Shift + G', 'Group, ungroup'], ['Ctrl + ] / [', 'Forward, backward'], ['Ctrl + Shift + ] / [', 'To front, to back'], ['Ctrl + Shift + L', 'Lock or unlock'], ['Shift + G', 'Snap to the grid'], ['Alt while dragging', 'No snapping'], ['Shift while drawing', 'Square, circle, 45° lines'], ['Shift while resizing', 'Keep the proportions']]],
    ['View', [['Ctrl + scroll or pinch', 'Zoom'], ['0', 'Zoom to 100%'], ['1', 'Fit everything'], ['2', 'Fit the selection'], ['?', 'This list'], ['Present: arrows, Space', 'Next and previous frame']]]
  ];
  cvOpenModal('Keyboard shortcuts', `<div class="cv-keys">${rows.map(([title, keys]) => `<section><h4>${title}</h4>${keys.map(([k, what]) => `<div><kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(what)}</span></div>`).join('')}</section>`).join('')}</div>`, true);
}

// ==========================================
// 7. MINIMAP
// ==========================================
function cvMinimapOn() {
  try { return localStorage.getItem(CV_MINIMAP_KEY) !== '0'; } catch (e) { return true; }
}

function cvToggleMinimap() {
  const on = !cvMinimapOn();
  try { localStorage.setItem(CV_MINIMAP_KEY, on ? '1' : '0'); } catch (e) { /* kept for this visit only */ }
  el('cv-minimap').classList.toggle('is-off', !on);
  el('cv-minimap-btn').classList.toggle('is-active', on);
  if (on) cvDrawMinimap();
}

function cvMinimapGeometry() {
  const map = el('cv-minimap');
  const rect = el('canvas-svg').getBoundingClientRect();
  const view = { minX: -canvasView.x / canvasView.scale, minY: -canvasView.y / canvasView.scale, maxX: (rect.width - canvasView.x) / canvasView.scale, maxY: (rect.height - canvasView.y) / canvasView.scale };
  const content = canvasBounds() || view;
  const all = { minX: Math.min(content.minX, view.minX), minY: Math.min(content.minY, view.minY), maxX: Math.max(content.maxX, view.maxX), maxY: Math.max(content.maxY, view.maxY) };
  const width = map.clientWidth || 168;
  const height = map.clientHeight || 112;
  const scale = Math.min((width - 8) / Math.max(1, all.maxX - all.minX), (height - 8) / Math.max(1, all.maxY - all.minY));
  const ox = (width - (all.maxX - all.minX) * scale) / 2 - all.minX * scale;
  const oy = (height - (all.maxY - all.minY) * scale) / 2 - all.minY * scale;
  return { map, view, width, height, scale, ox, oy };
}

function cvDrawMinimap() {
  cvMinimapQueued = false;
  cvMinimapLast = Date.now();
  const map = el('cv-minimap');
  if (!map || map.classList.contains('is-off') || map.offsetParent === null) return;
  const g = cvMinimapGeometry();
  const ratio = window.devicePixelRatio || 1;
  if (map.width !== Math.round(g.width * ratio)) { map.width = Math.round(g.width * ratio); map.height = Math.round(g.height * ratio); }
  const ctx = map.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, g.width, g.height);
  canvasShapes.forEach(s => {
    const b = shapeBounds(s);
    const p = cvPalette(s);
    ctx.fillStyle = s.type === 'frame' ? 'rgba(255,255,255,0)' : (isLineShape(s) || isInkShape(s) ? p.stroke : p.solid);
    ctx.strokeStyle = p.stroke;
    const x = g.ox + b.minX * g.scale;
    const y = g.oy + b.minY * g.scale;
    const w = Math.max(1, (b.maxX - b.minX) * g.scale);
    const h = Math.max(1, (b.maxY - b.minY) * g.scale);
    if (s.type === 'frame') { ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h); } else ctx.fillRect(x, y, w, h);
  });
  ctx.strokeStyle = '#3525cd';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(g.ox + g.view.minX * g.scale, g.oy + g.view.minY * g.scale, (g.view.maxX - g.view.minX) * g.scale, (g.view.maxY - g.view.minY) * g.scale);
}

function cvQueueMinimap() {
  if (cvMinimapQueued) return;
  cvMinimapQueued = true;
  setTimeout(() => requestAnimationFrame(cvDrawMinimap), Math.max(0, 120 - (Date.now() - cvMinimapLast)));
}

function cvMinimapJump(event) {
  const g = cvMinimapGeometry();
  const rect = g.map.getBoundingClientRect();
  const worldX = (event.clientX - rect.left - g.ox) / g.scale;
  const worldY = (event.clientY - rect.top - g.oy) / g.scale;
  const svg = el('canvas-svg').getBoundingClientRect();
  canvasView.x = svg.width / 2 - worldX * canvasView.scale;
  canvasView.y = svg.height / 2 - worldY * canvasView.scale;
  cvViewChanged();
  renderCanvas();
}

// ==========================================
// 8. AFTER EVERY DRAW, AND START
// ==========================================
function cvAfterRender() {
  cvRenderStyleBar();
  cvPositionEditor();
  cvPositionCursors();
  cvQueueMinimap();
  const undo = el('cv-undo-btn');
  const redo = el('cv-redo-btn');
  if (undo) undo.disabled = !canvasUndo.length;
  if (redo) redo.disabled = !canvasRedo.length;
  const selection = [...canvasSelection].join(',');
  if (selection !== cvSharedSel) {
    cvSharedSel = selection;
    cvShareCursor(null);
  }
}

function cvInitExtras() {
  el('cv-image-input').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) cvAddImageFiles(files, null);
  });
  const area = el('canvas-area');
  area.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); area.classList.add('is-dropping'); }
  });
  area.addEventListener('dragleave', (e) => { if (!area.contains(e.relatedTarget)) area.classList.remove('is-dropping'); });
  area.addEventListener('drop', (e) => {
    area.classList.remove('is-dropping');
    const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
    if (!files.length) return;
    e.preventDefault();
    cvAddImageFiles(files, canvasPoint(e));
  });
  // Every dialog (shortcuts, templates, versions) closes with its × button or a click on the dark backdrop
  el('cv-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-modal-close]')) cvCloseModal();
  });
  area.addEventListener('pointerdown', cvPresentPointer, true);
  area.addEventListener('pointerup', cvPresentPointer, true);
  el('canvas-peers').addEventListener('click', (e) => {
    const button = e.target.closest('[data-follow]');
    if (!button) return;
    if (button.dataset.follow === 'stop') cvFollowing = null;
    else {
      cvFollowing = parseInt(button.dataset.follow, 10);
      const peer = cvPeers.get(cvFollowing);
      if (peer && peer.view) cvFollowView(peer.view);
    }
    cvRenderPeers();
  });
  el('cv-popover').addEventListener('input', (e) => {
    const search = e.target.closest('.cv-pop-search');
    if (!search) return;
    const list = el('cv-popover').querySelector('.cv-task-list');
    const holder = document.createElement('div');
    holder.innerHTML = cvTaskPopoverHtml(search.value);
    const fresh = holder.querySelector('.cv-task-list');
    if (list && fresh) list.replaceWith(fresh);
  });
  const map = el('cv-minimap');
  map.classList.toggle('is-off', !cvMinimapOn());
  el('cv-minimap-btn').classList.toggle('is-active', cvMinimapOn());
  let mapDrag = false;
  map.addEventListener('pointerdown', (e) => { mapDrag = true; try { map.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } cvMinimapJump(e); });
  map.addEventListener('pointermove', (e) => { if (mapDrag) cvMinimapJump(e); });
  map.addEventListener('pointerup', () => { mapDrag = false; });
  // Idle cursors fade after 5 seconds; presenters who stopped lose their Follow button
  setInterval(() => {
    if (hubTab !== 'canvas' || !cvPeers.size) return;
    cvPositionCursors();
    cvRenderPeers();
  }, 2000);
  window.addEventListener('resize', () => { if (hubTab === 'canvas') cvRequestRender(); });
}
