// ==========================================
// HUB-IDEAS.JS — Brainstorming together.
//   Brainstorm: sticky notes in columns; everyone votes; the best ones become tasks with one click.
//   Mind map: a tree of ideas grown from one centre. Select a node: Tab adds a child, Enter a sibling,
//   F2 or double-click renames, Delete removes. It saves by itself.
// ==========================================

const ideaState = { mode: 'board', sortByVotes: false, mapId: null, selected: null, saveTimer: null };
const IDEA_COLUMNS = ['Ideas', 'Questions', 'Maybe later'];
const IDEA_COLORS = ['yellow', 'blue', 'green', 'pink', 'purple'];
let ideaDragId = null;

function renderIdeas() {
  const view = el('view-ideas');
  if (view.querySelector('.ht-map-rename')) return;      // a node is being renamed
  const switcher = `<div class="ht-seg" role="group" aria-label="Mode">
    <button type="button" data-ideamode="board" class="${ideaState.mode === 'board' ? 'is-on' : ''}">${msIcon('sticky_note_2')}Brainstorm</button>
    <button type="button" data-ideamode="map" class="${ideaState.mode === 'map' ? 'is-on' : ''}">${msIcon('account_tree')}Mind map</button></div>`;
  if (ideaState.mode === 'map') return renderMindMap(view, switcher);

  const ideas = itemsOf('idea');
  const columns = [...new Set(IDEA_COLUMNS.concat(ideas.map(i => i.data.column || 'Ideas')))];
  const sort = (list) => ideaState.sortByVotes ? list.slice().sort((a, b) => (b.data.votes || []).length - (a.data.votes || []).length || a.position - b.position) : list;
  view.innerHTML = `
    ${toolHead('Brainstorm', 'Add every idea, then vote. No idea is too small at this stage.', `${switcher}
      <label class="ht-check"><input type="checkbox" data-ideasort ${ideaState.sortByVotes ? 'checked' : ''}> Most votes first</label>
      <button type="button" class="ht-btn is-quiet" data-idea="column">${msIcon('view_column')}Column</button>`)}
    <div class="ht-ideas">${columns.map(col => {
      const notes = sort(ideas.filter(i => (i.data.column || 'Ideas') === col));
      return `<section class="ht-idea-col" data-ideacol="${escapeHtml(col)}">
        <h4>${escapeHtml(col)} <small>${notes.length}</small></h4>
        ${notes.map(ideaNoteHtml).join('')}
        <form class="ht-idea-add" data-ideaadd="${escapeHtml(col)}"><textarea rows="2" maxlength="160" placeholder="+ Add an idea" aria-label="New idea in ${escapeHtml(col)}"></textarea></form>
      </section>`; }).join('')}</div>`;
}

function ideaNoteHtml(i) {
  const votes = i.data.votes || [];
  const mine = votes.includes(currentUserId);
  const task = i.data.task_id ? taskById(i.data.task_id) : null;
  return `<article class="ht-note is-${i.data.color || 'yellow'}" draggable="true" data-idea="${i.id}">
    <p class="ht-note-text">${escapeHtml(i.title)}</p>
    ${i.data.details ? `<p class="ht-note-details">${escapeHtml(i.data.details)}</p>` : ''}
    <div class="ht-note-foot">
      <button type="button" class="ht-vote${mine ? ' is-mine' : ''}" data-vote="${i.id}" title="${mine ? 'Take back your vote' : 'Vote for this'}" aria-pressed="${mine}">${msIcon('thumb_up')}${votes.length}</button>
      ${avatarOf(i.created_by, 'h-5 w-5', 'text-[8px]')}
      <span class="ht-grow"></span>
      ${task ? `<button type="button" class="ht-link" data-open="${task.id}">${msIcon('task_alt')}Task</button>` : `<button type="button" class="ht-icon-btn is-small" data-ideatask="${i.id}" title="Make it a task">${msIcon('add_task')}</button>`}
      <button type="button" class="ht-icon-btn is-small" data-ideaedit="${i.id}" title="Edit">${msIcon('edit')}</button>
    </div></article>`;
}

function ideaSheet(idea) {
  const columns = [...new Set(IDEA_COLUMNS.concat(itemsOf('idea').map(i => i.data.column || 'Ideas')))];
  openSheet({
    title: 'Edit idea',
    fields: [
      { name: 'title', label: 'Idea', required: true, maxlength: 160, value: idea.title },
      { name: 'details', label: 'Details', type: 'textarea', maxlength: 1500, value: idea.data.details || '' },
      { name: 'column', label: 'Column', type: 'select', half: true, options: columns.map(c => [c, c]), value: idea.data.column || 'Ideas' },
      { name: 'color', label: 'Colour', type: 'select', half: true, options: IDEA_COLORS.map(c => [c, c[0].toUpperCase() + c.slice(1)]), value: idea.data.color || 'yellow' },
    ],
    onDelete: () => { deleteHubItem(idea, 'idea'); },
    onSubmit: async (v) => {
      await saveHubItem({ id: idea.id, kind: 'idea', title: v.title, data: { details: v.details, column: v.column, color: v.color } });
      renderIdeas();
    },
  });
}

// ==========================================
// MIND MAP
// ==========================================
function newNodeId() {
  return Math.random().toString(36).slice(2, 10);
}

function mapLayout(nodes) {
  const children = {};
  nodes.forEach(n => { if (n.parent) (children[n.parent] = children[n.parent] || []).push(n); });
  const root = nodes.find(n => !n.parent) || nodes[0];
  const pos = {};
  const width = (n) => Math.min(200, Math.max(90, 18 + n.text.length * 7.2));
  let row = 0;
  const place = (node, depth, x) => {
    const kids = node.collapsed ? [] : (children[node.id] || []);
    const w = width(node);
    if (!kids.length) { pos[node.id] = { x, y: row * 52, w, depth }; row += 1; return; }
    kids.forEach(k => place(k, depth + 1, x + w + 56));
    const ys = kids.map(k => pos[k.id].y);
    pos[node.id] = { x, y: (Math.min(...ys) + Math.max(...ys)) / 2, w, depth };
  };
  if (root) place(root, 0, 0);
  return { pos, children, root };
}

function renderMindMap(view, switcher) {
  const maps = itemsOf('mindmap');
  let map = maps.find(m => m.id === ideaState.mapId) || maps[0];
  ideaState.mapId = map ? map.id : null;
  const head = toolHead('Mind map', 'Click a node. Tab: add a child · Enter: add a sibling · F2: rename · Delete: remove.', `${switcher}
    ${maps.length > 1 ? `<select data-mappick aria-label="Mind map">${maps.map(m => `<option value="${m.id}" ${m.id === ideaState.mapId ? 'selected' : ''}>${escapeHtml(m.title)}</option>`).join('')}</select>` : ''}
    <button type="button" class="ht-btn is-quiet" data-map="new">${msIcon('add')}New map</button>
    ${map ? `<button type="button" class="ht-icon-btn" data-map="delete-map" title="Delete this map">${msIcon('delete')}</button>` : ''}`);
  if (!map) {
    view.innerHTML = head + toolEmpty('account_tree', 'No mind map yet', 'Put the project in the middle and branch out: features, people, risks, questions.',
      `<button type="button" class="ht-btn" data-map="new">${msIcon('add')}Start a mind map</button>`);
    return;
  }
  const nodes = map.data.nodes || [];
  const { pos, children } = mapLayout(nodes);
  const shown = nodes.filter(n => pos[n.id]);
  const maxX = Math.max(400, ...shown.map(n => pos[n.id].x + pos[n.id].w)) + 40;
  const maxY = Math.max(200, ...shown.map(n => pos[n.id].y)) + 80;
  const selected = nodes.find(n => n.id === ideaState.selected);
  const links = shown.filter(n => n.parent && pos[n.parent]).map(n => {
    const a = pos[n.parent], b = pos[n.id];
    const x1 = a.x + a.w, y1 = a.y + 20, x2 = b.x, y2 = b.y + 20, mid = (x1 + x2) / 2;
    return `<path d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}"/>`;
  }).join('');
  view.innerHTML = `${head}
    <div class="ht-card ht-map-card">
      <div class="ht-map-tools">
        <button type="button" class="ht-btn is-quiet is-small" data-map="child" ${selected ? '' : 'disabled'}>${msIcon('subdirectory_arrow_right')}Child</button>
        <button type="button" class="ht-btn is-quiet is-small" data-map="sibling" ${selected && selected.parent ? '' : 'disabled'}>${msIcon('add')}Sibling</button>
        <button type="button" class="ht-btn is-quiet is-small" data-map="rename" ${selected ? '' : 'disabled'}>${msIcon('edit')}Rename</button>
        <span class="ht-map-colors">${['indigo', 'emerald', 'amber', 'rose', 'slate'].map(c => `<button type="button" class="ht-swatch is-${c}" data-mapcolor="${c}" title="${c}" ${selected ? '' : 'disabled'}></button>`).join('')}</span>
        <button type="button" class="ht-btn is-quiet is-small" data-map="task" ${selected ? '' : 'disabled'}>${msIcon('add_task')}Make a task</button>
        <button type="button" class="ht-btn is-quiet is-small" data-map="remove" ${selected && selected.parent ? '' : 'disabled'}>${msIcon('delete')}Remove</button>
        <span class="ht-grow"></span><span class="ht-muted" id="mapStatus"></span>
      </div>
      <div class="ht-map-scroll" tabindex="0" aria-label="Mind map">
        <svg class="ht-map" width="${maxX}" height="${maxY}" style="min-width:${maxX}px">
          <g transform="translate(20,20)"><g class="ht-map-links">${links}</g>
          ${shown.map(n => { const p = pos[n.id]; const kids = (children[n.id] || []).length; return `
            <g class="ht-map-node is-${n.color || 'indigo'}${n.id === ideaState.selected ? ' is-selected' : ''}${!n.parent ? ' is-root' : ''}" data-node="${escapeHtml(n.id)}" transform="translate(${p.x},${p.y})">
              <rect width="${p.w}" height="40" rx="10"/>
              <text x="${p.w / 2}" y="25" text-anchor="middle">${escapeHtml(n.text.length > 26 ? n.text.slice(0, 25) + '…' : n.text || '…')}</text>
              ${kids ? `<g class="ht-map-fold" data-fold="${escapeHtml(n.id)}" transform="translate(${p.w + 4},12)"><circle cx="8" cy="8" r="8"/><text x="8" y="12" text-anchor="middle">${n.collapsed ? kids : '−'}</text></g>` : ''}
              <title>${escapeHtml(n.text)}</title>
            </g>`; }).join('')}</g>
        </svg>
      </div>
    </div>`;
}

function currentMap() {
  return hub.items.find(i => i.id === ideaState.mapId);
}

// Changes show at once; the save waits a moment so a burst of edits is one save
function updateMap(change) {
  const map = currentMap();
  if (!map) return;
  map.data = { ...map.data, nodes: change((map.data.nodes || []).map(n => ({ ...n }))) };
  renderIdeas();
  clearTimeout(ideaState.saveTimer);
  const status = el('mapStatus');
  if (status) status.textContent = 'Saving…';
  ideaState.saveTimer = setTimeout(async () => {
    try {
      const saved = await saveHubItem({ id: map.id, kind: 'mindmap', title: map.title, data: { nodes: map.data.nodes }, base: map.updated_at });
      if (saved && el('mapStatus')) el('mapStatus').textContent = 'Saved';
    } catch (err) { showToast(err.message); }
  }, 700);
}

function addNode(asChild) {
  const map = currentMap();
  const node = (map.data.nodes || []).find(n => n.id === ideaState.selected);
  if (!node) return;
  const parent = asChild ? node.id : node.parent;
  if (!parent) return;
  const id = newNodeId();
  updateMap(nodes => nodes.map(n => (n.id === parent ? { ...n, collapsed: false } : n)).concat({ id, text: 'New idea', parent, color: node.color || 'indigo', collapsed: false }));
  ideaState.selected = id;
  renameNode(id);
}

function renameNode(id) {
  const g = el('view-ideas').querySelector(`[data-node="${CSS.escape(id)}"]`);
  const map = currentMap();
  const node = (map.data.nodes || []).find(n => n.id === id);
  if (!g || !node) return;
  const box = g.getBoundingClientRect();
  const wrap = el('view-ideas').querySelector('.ht-map-card').getBoundingClientRect();
  const input = document.createElement('input');
  input.className = 'ht-map-rename';
  input.maxLength = 120;
  input.value = node.text;
  input.style.left = `${box.left - wrap.left}px`;
  input.style.top = `${box.top - wrap.top}px`;
  input.style.width = `${Math.max(140, box.width)}px`;
  el('view-ideas').querySelector('.ht-map-card').appendChild(input);
  input.focus();
  input.select();
  let finished = false;
  const done = (keep) => {
    if (finished) return;
    finished = true;
    const text = input.value.trim();
    input.remove();
    if (keep && text && text !== node.text) updateMap(nodes => nodes.map(n => (n.id === id ? { ...n, text } : n)));
    else renderIdeas();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') done(false); e.stopPropagation(); });
  input.addEventListener('blur', () => done(true));
}

function removeNode(id) {
  const remove = new Set([id]);
  let grew = true;
  const nodes = currentMap().data.nodes || [];
  while (grew) { grew = false; nodes.forEach(n => { if (n.parent && remove.has(n.parent) && !remove.has(n.id)) { remove.add(n.id); grew = true; } }); }
  const parent = nodes.find(n => n.id === id)?.parent;
  updateMap(list => list.filter(n => !remove.has(n.id)));
  ideaState.selected = parent || null;
}

// ==========================================
// EVENTS
// ==========================================
function initIdeaEvents() {
  const view = el('view-ideas');
  view.addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-ideamode]');
    if (mode) { ideaState.mode = mode.dataset.ideamode; return renderIdeas(); }
    const open = e.target.closest('[data-open]');
    if (open) return openTaskDrawer(parseInt(open.dataset.open, 10));
    const vote = e.target.closest('[data-vote]');
    if (vote) {
      try {
        const result = await api(`/api/items/${vote.dataset.vote}/vote`, { method: 'POST' });
        upsertById(hub.items, result.item);
        renderIdeas();
      } catch (err) { showToast(err.message); }
      return;
    }
    const edit = e.target.closest('[data-ideaedit]');
    if (edit) return ideaSheet(hub.items.find(i => i.id === parseInt(edit.dataset.ideaedit, 10)));
    const makeTask = e.target.closest('[data-ideatask]');
    if (makeTask) {
      const idea = hub.items.find(i => i.id === parseInt(makeTask.dataset.ideatask, 10));
      const task = await createTask({ title: idea.title.slice(0, 160), description: idea.data.details || '', tag: 'Idea' });
      if (task) { await saveHubItem({ id: idea.id, kind: 'idea', title: idea.title, data: { task_id: task.id } }); renderIdeas(); showToast('Added to the board as a task.'); }
      return;
    }
    if (e.target.closest('[data-idea="column"]')) {
      // A column exists through its notes, so a new one starts with its first idea
      return openSheet({ title: 'New column', fields: [{ name: 'name', label: 'Column name', required: true, maxlength: 40, placeholder: 'Features' },
                                                     { name: 'idea', label: 'First idea in it', required: true, maxlength: 160 }],
        onSubmit: async (v) => { await saveHubItem({ kind: 'idea', title: v.idea, data: { column: v.name, color: 'blue' } }); renderIdeas(); } });
    }
    // ---- mind map ----
    const mapAct = e.target.closest('[data-map]');
    if (mapAct) {
      const map = currentMap();
      switch (mapAct.dataset.map) {
        case 'new':
          return openSheet({ title: 'New mind map', fields: [{ name: 'title', label: 'In the middle', required: true, maxlength: 120, value: hub.board.name }],
            onSubmit: async (v) => {
              const saved = await saveHubItem({ kind: 'mindmap', title: v.title, data: { nodes: [{ id: 'root', text: v.title, parent: null, color: 'indigo' }] } });
              ideaState.mapId = saved.id; ideaState.selected = 'root'; renderIdeas();
            } });
        case 'delete-map': return deleteHubItem(map, 'mind map');
        case 'child': return addNode(true);
        case 'sibling': return addNode(false);
        case 'rename': return ideaState.selected && renameNode(ideaState.selected);
        case 'remove': return ideaState.selected && removeNode(ideaState.selected);
        case 'task': {
          const node = (map.data.nodes || []).find(n => n.id === ideaState.selected);
          if (node && await createTask({ title: node.text.slice(0, 160), tag: 'Idea' })) showToast('Added to the board as a task.');
          return;
        }
      }
    }
    const color = e.target.closest('[data-mapcolor]');
    if (color && ideaState.selected) return updateMap(nodes => nodes.map(n => (n.id === ideaState.selected ? { ...n, color: color.dataset.mapcolor } : n)));
    const fold = e.target.closest('[data-fold]');
    if (fold) return updateMap(nodes => nodes.map(n => (n.id === fold.dataset.fold ? { ...n, collapsed: !n.collapsed } : n)));
    const node = e.target.closest('[data-node]');
    if (node) { ideaState.selected = node.dataset.node; renderIdeas(); view.querySelector('.ht-map-scroll')?.focus({ preventScroll: true }); return; }
  });
  view.addEventListener('dblclick', (e) => {
    const node = e.target.closest('[data-node]');
    if (node) renameNode(node.dataset.node);
  });
  view.addEventListener('keydown', (e) => {
    if (ideaState.mode !== 'map' || !ideaState.selected || !e.target.closest('.ht-map-scroll')) return;
    if (e.key === 'Tab') { e.preventDefault(); addNode(true); }
    else if (e.key === 'Enter') { e.preventDefault(); addNode(false); }
    else if (e.key === 'F2') { e.preventDefault(); renameNode(ideaState.selected); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const n = currentMap().data.nodes.find(x => x.id === ideaState.selected); if (n && n.parent) removeNode(ideaState.selected); }
  });
  view.addEventListener('change', (e) => {
    if (e.target.matches('[data-ideasort]')) { ideaState.sortByVotes = e.target.checked; renderIdeas(); }
    if (e.target.matches('[data-mappick]')) { ideaState.mapId = parseInt(e.target.value, 10); ideaState.selected = null; renderIdeas(); }
  });
  // New sticky notes: Enter adds, Shift+Enter is a new line
  view.addEventListener('keydown', async (e) => {
    const form = e.target.closest('[data-ideaadd]');
    if (!form || e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const text = e.target.value.trim();
    if (!text) return;
    e.target.value = '';
    try {
      await saveHubItem({ kind: 'idea', title: text.slice(0, 160), data: { column: form.dataset.ideaadd, color: IDEA_COLORS[itemsOf('idea').length % IDEA_COLORS.length] } });
      renderIdeas();
      view.querySelector(`[data-ideaadd="${CSS.escape(form.dataset.ideaadd)}"] textarea`)?.focus();
    } catch (err) { showToast(err.message); }
  });
  view.addEventListener('dragstart', (e) => { const note = e.target.closest('[data-idea]'); if (note && note.dataset.idea !== 'column') { ideaDragId = parseInt(note.dataset.idea, 10); e.dataTransfer.setData('text/plain', String(ideaDragId)); } });
  view.addEventListener('dragover', (e) => { if (ideaDragId !== null && e.target.closest('[data-ideacol]')) e.preventDefault(); });
  view.addEventListener('drop', async (e) => {
    const col = e.target.closest('[data-ideacol]');
    if (!col || ideaDragId === null) return;
    e.preventDefault();
    const idea = hub.items.find(i => i.id === ideaDragId);
    ideaDragId = null;
    if (idea && (idea.data.column || 'Ideas') !== col.dataset.ideacol) {
      try { await saveHubItem({ id: idea.id, kind: 'idea', title: idea.title, data: { column: col.dataset.ideacol } }); renderIdeas(); } catch (err) { showToast(err.message); }
    }
  });
}

registerHubTool('ideas', { render: renderIdeas });
document.addEventListener('DOMContentLoaded', initIdeaEvents);
