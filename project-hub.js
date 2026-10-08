// ==========================================
// PROJECT-HUB.JS — Task board, planning canvas and linked tools for a Teams workspace
// Loaded after shared.js and chat-common.js (api, caches, toast, el, people search).
// Each workspace from the My Teams page has one board. Changes are saved on the server and
// arrive live for teammates over the same connection the Teams page uses.
// ==========================================

const HUB_COLUMNS = [
  { id: 'todo', name: 'To Do', dot: 'bg-outline' },
  { id: 'inprogress', name: 'In Progress', dot: 'bg-primary' },
  { id: 'review', name: 'Review', dot: 'bg-secondary' },
  { id: 'done', name: 'Done', dot: 'bg-tertiary' }
];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const SUGGESTED_TAGS = ['Frontend', 'Backend', 'AI / ML', 'DevOps', 'Design', 'Docs'];
const TAG_STYLES = [
  'bg-primary-fixed/40 text-on-primary-fixed-variant',
  'bg-tertiary-fixed/40 text-on-tertiary-fixed-variant',
  'bg-secondary-fixed/60 text-on-secondary-fixed-variant',
  'bg-error-container/60 text-on-error-container',
  'bg-surface-container-high text-on-surface-variant'
];
const HUB_AVATAR_COLORS = ['bg-primary-container text-on-primary', 'bg-tertiary text-on-tertiary', 'bg-secondary text-on-secondary', 'bg-error text-on-error', 'bg-inverse-surface text-inverse-on-surface'];

let hubTeams = [];
let hubTeamId = null;
let hub = null;                    // { team, role, members, board, tasks, canvas } for the open workspace
let hubTicket = 0;                 // increases on every workspace switch so slow answers for the old one are ignored
let hubTab = 'kanban';
let selectedTags = new Set();
let draggedTaskId = null;
let editingTaskId = null;
let linkKind = null;               // 'github' or 'figma' while the link dialog is open
let githubRepoData = null;
let githubRepoState = 'idle';      // idle | loading | ready | error
let githubRepoError = '';

let hubSocket = null;
let hubSocketTeamId = null;
let hubSocketRetry = 1000;
let hubSocketWasOpen = false;
const hubClientId = newTempId();   // lets this tab recognise its own canvas saves coming back

// ==========================================
// 1. HELPERS
// ==========================================
function hubIsAdmin() {
  return !!hub && hub.role === 'Admin';
}

function hubMember(userId) {
  return hub ? hub.members.find(m => m.user_id === userId) || null : null;
}

function openHubModal(id) { el(id).classList.remove('hidden'); }
function closeHubModal(id) { el(id).classList.add('hidden'); }

function hubFormError(id, message) {
  el(id).textContent = message || '';
  el(id).classList.toggle('hidden', !message);
}

function hubConfirm(title, message, confirmText, action) {
  window.showSystemModal(title, message, 'confirm', async () => {
    try { await action(); } catch (err) { showToast(err.message); }
  }, confirmText);
}

function memberAvatarHtml(member, sizeClass, textClass) {
  if (!member) return '';
  if (member.user_profile_pic) {
    return `<img src="${escapeHtml(member.user_profile_pic)}" alt="" title="${escapeHtml(member.user_name)}" class="${sizeClass} rounded-full object-cover ring-2 ring-surface-container-lowest">`;
  }
  const color = HUB_AVATAR_COLORS[member.user_id % HUB_AVATAR_COLORS.length];
  return `<div class="${sizeClass} rounded-full ${color} flex items-center justify-center font-bold ${textClass} ring-2 ring-surface-container-lowest" title="${escapeHtml(member.user_name)}">${escapeHtml(getInitials(member.user_name || '?'))}</div>`;
}

function tagStyle(tag) {
  let hash = 0;
  for (const ch of tag.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return TAG_STYLES[hash % TAG_STYLES.length];
}

function relativeTime(ts) {
  if (!ts) return '';
  const seconds = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDue(due) {
  const [year, month, day] = due.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

function safeFileName(text) {
  return String(text || 'board').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'board';
}

// ==========================================
// 2. LOADING
// ==========================================
async function initHub() {
  hubTab = cacheGet('hub-tab') || 'kanban';
  switchHubTab(hubTab, true);
  el('task-form').addEventListener('submit', saveTask);
  el('settings-form').addEventListener('submit', saveHubSettings);
  el('link-form').addEventListener('submit', saveLink);
  el('shape-text-form').addEventListener('submit', applyShapeText);
  initCanvas();

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#card-context-menu') && !e.target.closest('.card-menu-btn')) el('card-context-menu').classList.add('hidden');
    if (!e.target.closest('#file-menu-container')) el('file-dropdown').classList.add('hidden');
  });
  document.addEventListener('mousedown', (e) => {
    if (e.target.classList && e.target.classList.contains('hub-modal')) e.target.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.hub-modal').forEach(m => m.classList.add('hidden'));
  });

  // 1. What we knew last time, straight away
  hubTeams = cacheGet('teams') || [];
  renderTeamPicker();
  const remembered = cacheGet('hub-last-team');
  const first = hubTeams.find(t => t.id === remembered) || hubTeams[0];
  if (first) openHubTeam(first.id);

  // 2. The real list of workspaces (already requested from the page head)
  try {
    const prefetched = window.__hubTeamsPrefetch ? await window.__hubTeamsPrefetch : null;
    window.__hubTeamsPrefetch = null;
    if (prefetched && prefetched.status === 401) return handleLoggedOut();
    hubTeams = prefetched && prefetched.status === 200 ? prefetched.data : await api('/api/teams');
    cacheSet('teams', hubTeams);
  } catch (err) {
    if (hubTeams.length === 0) return showHubProblem('cloud_off', 'Could not load your workspaces', err.message, '<button type="button" class="hub-btn-primary" onclick="window.location.reload()">Try again</button>');
  }
  renderTeamPicker();
  if (hubTeams.length === 0) return showNoWorkspace();
  if (!hubTeams.some(t => t.id === hubTeamId)) openHubTeam(hubTeams[0].id);
}

function showHubProblem(icon, title, text, actionsHtml) {
  el('hub-content').classList.add('hidden');
  el('hub-actions').classList.add('hidden');
  el('hub-empty-icon').textContent = icon;
  el('hub-empty-title').textContent = title;
  el('hub-empty-text').textContent = text;
  el('hub-empty-actions').innerHTML = actionsHtml || '';
  el('hub-empty').classList.remove('hidden');
}

function hideHubProblem() {
  el('hub-empty').classList.add('hidden');
  el('hub-content').classList.remove('hidden');
  el('hub-actions').classList.remove('hidden');
}

function showNoWorkspace() {
  hubTeamId = null;
  hub = null;
  closeHubSocket();
  el('hub-team-select').classList.add('hidden');
  showHubProblem('workspaces', 'No workspace yet', 'Boards live inside your team workspaces. Create one on the My Teams page and it will show up here with its own board and planning canvas.',
    '<a href="team.html" class="hub-btn-primary inline-block">Go to My Teams</a>');
}

function renderTeamPicker() {
  const select = el('hub-team-select');
  select.classList.toggle('hidden', hubTeams.length === 0);
  select.innerHTML = hubTeams.map(t => `<option value="${t.id}" ${t.id === hubTeamId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
}

async function openHubTeam(teamId) {
  if (!teamId) return;
  if (hubTeamId && hubTeamId !== teamId) await flushCanvasSave();
  const ticket = ++hubTicket;
  hubTeamId = teamId;
  cacheSet('hub-last-team', teamId);
  renderTeamPicker();
  selectedTags = new Set();
  githubRepoData = null;
  githubRepoState = 'idle';
  hideHubProblem();

  // Last known copy of this board, so the page is usable before the server answers
  const cached = cacheGet(`hub-board:${teamId}`);
  if (cached) {
    hub = cached;
    loadCanvasShapes(hub.canvas || []);
    renderHub();
  } else {
    hub = null;
    el('hub-board-name').textContent = 'Loading...';
    el('hub-board-summary').textContent = '';
    el('kanban-columns').innerHTML = '';
  }
  connectHubSocket(teamId);

  let data;
  try {
    const prefetch = window.__hubBoardPrefetch;
    window.__hubBoardPrefetch = null;
    const prefetched = prefetch && prefetch.teamId === teamId ? await prefetch.promise : null;
    data = prefetched && prefetched.status === 200 ? prefetched.data : await api(`/api/teams/${teamId}/board`);
  } catch (err) {
    if (ticket !== hubTicket) return;
    if (err.status === 403 || err.status === 404) return dropHubTeam(teamId, 'You no longer have access to that workspace.');
    if (!hub) showHubProblem('cloud_off', 'Could not load this board', err.message, `<button type="button" class="hub-btn-primary" onclick="openHubTeam(${teamId})">Try again</button>`);
    else showToast(err.message);
    return;
  }
  if (ticket !== hubTicket) return;   // another workspace was opened while this one was loading
  hub = data;
  cacheSet(`hub-board:${teamId}`, hub);
  if (!canvasDirty) loadCanvasShapes(hub.canvas || []);
  renderHub();
}

function dropHubTeam(teamId, message) {
  hubTeams = hubTeams.filter(t => t.id !== teamId);
  cacheSet('teams', hubTeams);
  try { localStorage.removeItem(CACHE_PREFIX + `hub-board:${teamId}`); } catch (e) { /* ignore */ }
  if (message) showToast(message);
  if (hubTeamId !== teamId) return renderTeamPicker();
  hubTeamId = null;
  hub = null;
  closeHubSocket();
  renderTeamPicker();
  if (hubTeams.length) openHubTeam(hubTeams[0].id);
  else showNoWorkspace();
}

function saveHubCache() {
  if (hub && hubTeamId) cacheSet(`hub-board:${hubTeamId}`, hub);
}

function renderHub() {
  if (!hub) return;
  document.body.classList.toggle('is-admin', hubIsAdmin());
  renderHubHeader();
  renderBoard();
  renderCanvas();
  renderIntegrations();
}

function switchHubTab(tab, quiet) {
  hubTab = tab;
  ['kanban', 'canvas', 'integrations'].forEach(name => {
    el(`view-${name}`).classList.toggle('hidden', name !== tab);
    el(`view-${name}`).classList.toggle('flex', name === tab);
    el(`tab-${name}`).classList.toggle('is-active', name === tab);
  });
  if (!quiet) cacheSet('hub-tab', tab);
  if (tab === 'canvas') renderCanvas();
  if (tab === 'integrations') renderIntegrations();
}

// ==========================================
// 3. HEADER
// ==========================================
function renderHubHeader() {
  const tasks = hub.tasks;
  const done = tasks.filter(t => t.column === 'done').length;
  const overdue = tasks.filter(t => t.due_date && t.column !== 'done' && t.due_date < todayIso()).length;
  document.title = `${hub.board.name} | Project Hub`;
  el('hub-board-name').textContent = hub.board.name;
  el('canvas-title').textContent = hub.board.sprint_label || hub.board.name;
  el('hub-board-summary').textContent = tasks.length === 0
    ? 'No tasks yet. Add the first one to get the board going.'
    : `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${done} done${overdue ? ` · ${overdue} overdue` : ''}`;

  const sprint = el('hub-sprint-chip');
  sprint.textContent = hub.board.sprint_label || '';
  sprint.classList.toggle('hidden', !hub.board.sprint_label);
  sprint.classList.toggle('inline-flex', !!hub.board.sprint_label);

  const chips = [];
  if (hub.board.github_repo) {
    const count = githubRepoState === 'ready' && githubRepoData ? ` · ${githubRepoData.pulls.length} open PR${githubRepoData.pulls.length === 1 ? '' : 's'}` : '';
    chips.push(`<button type="button" onclick="switchHubTab('integrations')" class="inline-flex items-center gap-1 text-tertiary font-medium bg-tertiary-fixed/30 px-2 py-0.5 rounded border border-tertiary-fixed-dim/40 hover:bg-tertiary-fixed/50 transition-colors"><span class="material-symbols-outlined text-[14px]">code</span>${escapeHtml(hub.board.github_repo)}${count}</button>`);
  }
  if (hub.board.figma_url) {
    chips.push(`<button type="button" onclick="switchHubTab('integrations')" class="inline-flex items-center gap-1 text-primary font-medium bg-primary-fixed/30 px-2 py-0.5 rounded border border-primary-fixed-dim/40 hover:bg-primary-fixed/50 transition-colors"><span class="material-symbols-outlined text-[14px]">draw</span>Figma file linked</button>`);
  }
  if (hub.board.updated_at) {
    chips.push(`<span class="text-secondary font-body-sm text-body-sm flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">schedule</span>Updated ${escapeHtml(relativeTime(hub.board.updated_at))}</span>`);
  }
  el('hub-board-chips').innerHTML = chips.join('');

  const shown = hub.members.slice(0, 5);
  el('hub-member-avatars').innerHTML = shown.map(m => memberAvatarHtml(m, 'h-7 w-7', 'text-[11px]')).join('')
    + (hub.members.length > shown.length ? `<div class="h-7 w-7 rounded-full bg-surface-container-high text-on-surface-variant flex items-center justify-center font-bold text-[10px] ring-2 ring-surface-container-lowest" title="${hub.members.length - shown.length} more">+${hub.members.length - shown.length}</div>` : '');
}

function touchBoardUpdated() {
  hub.board.updated_at = new Date().toISOString();
  renderHubHeader();
  saveHubCache();
}

// ==========================================
// 4. KANBAN BOARD
// ==========================================
function boardIsManual() {
  return el('task-sort').value === 'manual' && !el('task-search').value.trim() && selectedTags.size === 0;
}

function sortedColumnTasks(columnId) {
  return hub.tasks.filter(t => t.column === columnId).sort((a, b) => a.position - b.position || a.id - b.id);
}

function visibleColumnTasks(columnId) {
  const query = el('task-search').value.trim().toLowerCase();
  const sort = el('task-sort').value;
  let tasks = sortedColumnTasks(columnId);
  if (query) {
    tasks = tasks.filter(t => {
      const assignee = hubMember(t.assignee_id);
      return `${t.title} ${t.description} ${t.tag} ${assignee ? assignee.user_name : ''}`.toLowerCase().includes(query);
    });
  }
  if (selectedTags.size) tasks = tasks.filter(t => selectedTags.has((t.tag || '').toLowerCase()));
  if (sort === 'priority') tasks.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  if (sort === 'due') tasks.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  if (sort === 'title') tasks.sort((a, b) => a.title.localeCompare(b.title));
  return tasks;
}

function taskCardHtml(task) {
  const assignee = hubMember(task.assignee_id);
  const overdue = task.due_date && task.column !== 'done' && task.due_date < todayIso();
  const priorityClass = { high: 'text-error', medium: 'text-secondary', low: 'text-on-surface-variant' }[task.priority];
  return `
    <div class="task-card group bg-surface-container-lowest rounded-xl p-space-md border border-outline-variant/40 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col gap-2" draggable="true" data-task-id="${task.id}" onclick="openTaskModal(${task.id})" ondragstart="onTaskDragStart(event, ${task.id})" ondragend="onTaskDragEnd(event)">
      <div class="flex items-center justify-between gap-2 min-h-[20px]">
        ${task.tag ? `<span class="font-skill-pill text-skill-pill font-semibold px-2 py-0.5 rounded tracking-wider uppercase truncate ${tagStyle(task.tag)}">${escapeHtml(task.tag)}</span>` : '<span></span>'}
        <button type="button" class="material-symbols-outlined text-[18px] text-on-surface-variant opacity-60 group-hover:opacity-100 transition-opacity card-menu-btn" title="Task actions" onclick="event.stopPropagation(); openCardMenu(event, ${task.id})">more_horiz</button>
      </div>
      <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface leading-snug break-words">${escapeHtml(task.title)}</h3>
      ${task.description ? `<p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 break-words">${escapeHtml(task.description)}</p>` : ''}
      <div class="pt-2 mt-1 border-t border-outline-variant/20 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 font-label-sm text-label-sm">
          <span class="flex items-center gap-0.5 ${priorityClass} font-medium" title="Priority: ${task.priority}"><span class="material-symbols-outlined text-[14px]">flag</span>${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}</span>
          ${task.due_date ? `<span class="flex items-center gap-0.5 ${overdue ? 'text-error font-semibold' : 'text-on-surface-variant'}" title="${overdue ? 'Overdue' : 'Due date'}"><span class="material-symbols-outlined text-[14px]">event</span>${escapeHtml(formatDue(task.due_date))}</span>` : ''}
        </div>
        ${assignee ? memberAvatarHtml(assignee, 'w-6 h-6', 'text-[10px]') : '<span class="w-6 h-6 rounded-full border border-dashed border-outline-variant flex items-center justify-center text-outline" title="Unassigned"><span class="material-symbols-outlined text-[14px]">person</span></span>'}
      </div>
    </div>`;
}

function renderTagFilters() {
  const present = [...new Set(hub.tasks.map(t => (t.tag || '').trim()).filter(Boolean).map(t => t.toLowerCase()))].sort();
  // A filter for a tag that no longer exists would hide everything with no way to turn it off
  selectedTags = new Set([...selectedTags].filter(t => present.includes(t)));
  const labels = {};
  hub.tasks.forEach(t => { if (t.tag) labels[t.tag.toLowerCase()] = t.tag; });
  el('tag-filters').innerHTML = present.length === 0
    ? '<span class="font-label-sm text-label-sm text-outline">none yet</span>'
    : present.map(tag => `<button type="button" onclick="toggleTagFilter(${escapeJsArg(tag)})" class="font-skill-pill text-skill-pill px-2.5 py-1 rounded-full font-medium transition-colors ${selectedTags.has(tag) ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'}">${escapeHtml(labels[tag])}</button>`).join('');
  el('task-tag-options').innerHTML = [...new Set(SUGGESTED_TAGS.concat(Object.values(labels)))].map(t => `<option value="${escapeHtml(t)}"></option>`).join('');
}

function toggleTagFilter(tag) {
  if (selectedTags.has(tag)) selectedTags.delete(tag); else selectedTags.add(tag);
  renderBoard();
}

function renderBoard() {
  if (!hub) return;
  renderTagFilters();
  const filtering = !boardIsManual();
  el('kanban-columns').innerHTML = HUB_COLUMNS.map(column => {
    const all = hub.tasks.filter(t => t.column === column.id).length;
    const visible = visibleColumnTasks(column.id);
    const count = filtering && visible.length !== all ? `${visible.length} / ${all}` : `${all}`;
    return `
      <div class="bg-surface-container-low/70 rounded-2xl p-space-sm border border-outline-variant/40 flex flex-col gap-space-sm" data-column-box="${column.id}">
        <div class="flex items-center justify-between px-space-xs py-1">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full ${column.dot}"></span>
            <h2 class="font-headline-sm text-headline-sm font-bold text-on-surface">${column.name}</h2>
          </div>
          <span class="font-label-sm text-label-sm font-semibold bg-surface-container-lowest text-on-surface-variant px-2.5 py-0.5 rounded-full border border-outline-variant/40" data-column-count="${column.id}">${count}</span>
        </div>
        <div class="kanban-list flex flex-col gap-space-sm" data-column="${column.id}" ondragover="onColumnDragOver(event)" ondragleave="onColumnDragLeave(event)" ondrop="onColumnDrop(event, '${column.id}')">
          ${visible.map(taskCardHtml).join('') || `<p class="text-center py-4 font-body-sm text-body-sm text-outline">${all && filtering ? 'No matching tasks' : 'Nothing here yet'}</p>`}
        </div>
        <button type="button" class="flex items-center justify-center gap-1 py-2 rounded-xl border border-dashed border-outline-variant/80 hover:border-primary hover:text-primary text-on-surface-variant font-label-md text-label-md transition-colors" onclick="openTaskModal(null, '${column.id}')">
          <span class="material-symbols-outlined text-[18px]">add</span>
          Add Task
        </button>
      </div>`;
  }).join('');
}

// ===== DRAG AND DROP =====
function onTaskDragStart(event, taskId) {
  draggedTaskId = taskId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(taskId));
  event.currentTarget.classList.add('dragging');
}

function onTaskDragEnd(event) {
  draggedTaskId = null;
  event.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.kanban-list.drag-over').forEach(l => l.classList.remove('drag-over'));
}

function onColumnDragOver(event) {
  if (draggedTaskId === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('drag-over');
}

function onColumnDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('drag-over');
}

// Where a dropped card lands: between the two cards around the pointer
function positionForDrop(columnId, list, clientY, taskId) {
  const others = sortedColumnTasks(columnId).filter(t => t.id !== taskId);
  if (others.length === 0) return 1;
  if (!boardIsManual()) return others[others.length - 1].position + 1;   // filtered or sorted view: add to the end
  const cards = [...list.querySelectorAll('.task-card')].filter(c => parseInt(c.dataset.taskId) !== taskId);
  let index = cards.findIndex(card => { const r = card.getBoundingClientRect(); return clientY < r.top + r.height / 2; });
  if (index === -1) index = cards.length;
  const before = others[index - 1];
  const after = others[index];
  if (before && after) return (before.position + after.position) / 2;
  if (before) return before.position + 1;
  return after.position - 1;
}

function onColumnDrop(event, columnId) {
  event.preventDefault();
  const list = event.currentTarget;
  list.classList.remove('drag-over');
  const taskId = draggedTaskId !== null ? draggedTaskId : parseInt(event.dataTransfer.getData('text/plain'));
  if (!taskId) return;
  moveTask(taskId, columnId, positionForDrop(columnId, list, event.clientY, taskId));
}

async function moveTask(taskId, columnId, position) {
  const task = hub.tasks.find(t => t.id === taskId);
  if (!task || (task.column === columnId && task.position === position)) return;
  const before = { column: task.column, position: task.position };
  task.column = columnId;
  task.position = position;
  renderBoard();
  renderHubHeader();
  try {
    Object.assign(task, await api(`/api/tasks/${taskId}`, { method: 'PATCH', body: { column: columnId, position } }));
    touchBoardUpdated();
  } catch (err) {
    Object.assign(task, before);   // put it back where it was
    renderBoard();
    renderHubHeader();
    showToast(err.message);
  }
}

// ===== CARD MENU =====
function canDeleteTask(task) {
  return hubIsAdmin() || task.created_by === currentUserId || task.assignee_id === currentUserId;
}

function openCardMenu(event, taskId) {
  const task = hub.tasks.find(t => t.id === taskId);
  if (!task) return;
  const menu = el('card-context-menu');
  const item = (icon, label, handler, danger) => `<button type="button" onclick="el('card-context-menu').classList.add('hidden'); ${handler}" class="w-full text-left px-3 py-2 hover:bg-surface-container-low transition-colors flex items-center gap-2 ${danger ? 'text-error' : 'text-on-surface'}"><span class="material-symbols-outlined text-[16px]">${icon}</span>${label}</button>`;
  menu.innerHTML = item('edit', 'Edit', `openTaskModal(${taskId})`)
    + HUB_COLUMNS.filter(c => c.id !== task.column).map(c => item('arrow_forward', `Move to ${c.name}`, `moveTaskToColumn(${taskId}, '${c.id}')`)).join('')
    + (canDeleteTask(task) ? '<div class="h-px bg-outline-variant/30 my-1"></div>' + item('delete', 'Delete', `confirmDeleteTask(${taskId})`, true) : '');
  menu.classList.remove('hidden');
  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
}

function moveTaskToColumn(taskId, columnId) {
  const others = sortedColumnTasks(columnId).filter(t => t.id !== taskId);
  moveTask(taskId, columnId, others.length ? others[others.length - 1].position + 1 : 1);
}

function confirmDeleteTask(taskId) {
  const task = hub.tasks.find(t => t.id === taskId);
  if (!task) return;
  hubConfirm('Delete Task', `Delete ${escapeHtml(task.title)}? This cannot be undone.`, 'Delete', async () => {
    await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
    removeTaskLocally(taskId);
    closeHubModal('task-modal');
    showToast('Task deleted.');
  });
}

function removeTaskLocally(taskId) {
  if (!hub.tasks.some(t => t.id === taskId)) return;
  hub.tasks = hub.tasks.filter(t => t.id !== taskId);
  renderBoard();
  touchBoardUpdated();
}

// ===== NEW / EDIT TASK =====
function openTaskModal(taskId, columnId) {
  if (!hub) return;
  const task = taskId ? hub.tasks.find(t => t.id === taskId) : null;
  if (taskId && !task) return;
  editingTaskId = task ? task.id : null;
  el('task-modal-title').textContent = task ? 'Edit Task' : 'New Task';
  el('task-save-btn').textContent = task ? 'Save' : 'Create Task';
  el('task-title').value = task ? task.title : '';
  el('task-desc').value = task ? task.description : '';
  el('task-column').value = task ? task.column : (columnId || 'todo');
  el('task-priority').value = task ? task.priority : 'medium';
  el('task-tag').value = task ? task.tag : '';
  el('task-due').value = task ? task.due_date : '';
  el('task-assignee').innerHTML = '<option value="">Unassigned</option>' + hub.members.map(m =>
    `<option value="${m.user_id}">${escapeHtml(m.user_name)}${m.user_id === currentUserId ? ' (You)' : ''}</option>`).join('');
  el('task-assignee').value = task && task.assignee_id && hubMember(task.assignee_id) ? String(task.assignee_id) : '';
  el('task-delete-btn').classList.toggle('hidden', !task || !canDeleteTask(task));
  hubFormError('task-error', '');
  openHubModal('task-modal');
  setTimeout(() => el('task-title').focus(), 50);
}

async function saveTask(e) {
  e.preventDefault();
  const button = el('task-save-btn');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving...';
  hubFormError('task-error', '');
  const assignee = el('task-assignee').value;
  const body = {
    title: el('task-title').value,
    description: el('task-desc').value,
    column: el('task-column').value,
    priority: el('task-priority').value,
    tag: el('task-tag').value,
    due_date: el('task-due').value
  };
  if (assignee) body.assignee_id = parseInt(assignee);
  try {
    if (editingTaskId) {
      const task = hub.tasks.find(t => t.id === editingTaskId);
      if (!assignee) body.clear_assignee = true;
      // Changing the column from the dialog puts the task at the bottom of the new column
      if (task && task.column !== body.column) {
        const others = sortedColumnTasks(body.column);
        body.position = others.length ? others[others.length - 1].position + 1 : 1;
      }
      applyTask(await api(`/api/tasks/${editingTaskId}`, { method: 'PATCH', body }));
    } else {
      applyTask(await api(`/api/teams/${hubTeamId}/tasks`, { method: 'POST', body }));
    }
    closeHubModal('task-modal');
  } catch (err) {
    hubFormError('task-error', err.message);
  }
  button.disabled = false;
  button.textContent = label;
}

// Put a task from the server into the board, whether it is new or changed
function applyTask(task) {
  const index = hub.tasks.findIndex(t => t.id === task.id);
  if (index === -1) hub.tasks.push(task); else hub.tasks[index] = task;
  renderBoard();
  touchBoardUpdated();
}

function deleteTaskFromModal() {
  if (editingTaskId) confirmDeleteTask(editingTaskId);
}

// ==========================================
// 5. SETTINGS, INVITE, EXPORT
// ==========================================
function openHubSettings() {
  if (!hub) return;
  const admin = hubIsAdmin();
  el('setting-project-name').value = hub.board.name;
  el('setting-sprint').value = hub.board.sprint_label;
  el('setting-project-name').disabled = !admin;
  el('setting-sprint').disabled = !admin;
  el('settings-save-btn').style.display = admin ? '' : 'none';
  el('settings-note').textContent = admin
    ? `This board belongs to the ${hub.team.name} workspace. Members are managed on the My Teams page or with Invite.`
    : 'Only workspace Admins can change these.';
  hubFormError('settings-error', '');
  openHubModal('settings-modal');
}

async function saveHubSettings(e) {
  e.preventDefault();
  const button = el('settings-save-btn');
  button.disabled = true;
  hubFormError('settings-error', '');
  try {
    hub.board = await api(`/api/teams/${hubTeamId}/board`, { method: 'PATCH', body: { name: el('setting-project-name').value, sprint_label: el('setting-sprint').value } });
    saveHubCache();
    renderHubHeader();
    closeHubModal('settings-modal');
    showToast('Board settings saved.');
  } catch (err) {
    hubFormError('settings-error', err.message);
  }
  button.disabled = false;
}

function openHubInvite() {
  if (!hub) return;
  el('hub-invite-search').value = '';
  el('hub-invite-list').innerHTML = '<p class="text-center text-on-surface-variant font-body-sm py-4">Type a name to search...</p>';
  openHubModal('invite-modal');
  setTimeout(() => el('hub-invite-search').focus(), 50);
}

function searchHubInvite() {
  const existing = new Set(hub.members.map(m => m.user_id));
  searchUsers(el('hub-invite-search').value, el('hub-invite-list'), (user) => existing.has(user.id)
    ? { label: 'Member', disabled: true }
    : { label: 'Add', handler: `inviteToHubTeam(${user.id})` });
}

async function inviteToHubTeam(userId) {
  const teamId = hubTeamId;
  try {
    await api(`/api/teams/${teamId}/members`, { method: 'POST', body: { user_id: userId, role: 'Member' } });
    const card = userSearchResults[userId];
    if (card && hubTeamId === teamId && !hub.members.some(m => m.user_id === userId)) {
      hub.members.push({ id: 0, team_id: teamId, user_id: userId, role: 'Member', joined_at: '', user_name: card.name, user_profile_pic: card.profile_pic });
      saveHubCache();
      renderHubHeader();
    }
    showToast('Added to the workspace.');
    if (!el('invite-modal').classList.contains('hidden')) searchHubInvite();
  } catch (err) {
    showToast(err.message);
  }
}

function taskExportRows() {
  const columnName = Object.fromEntries(HUB_COLUMNS.map(c => [c.id, c.name]));
  return HUB_COLUMNS.flatMap(c => sortedColumnTasks(c.id)).map(t => {
    const assignee = hubMember(t.assignee_id);
    return {
      id: t.id, title: t.title, description: t.description, column: columnName[t.column], tag: t.tag,
      priority: t.priority, assignee: assignee ? assignee.user_name : '', due_date: t.due_date,
      created_at: t.created_at, updated_at: t.updated_at
    };
  });
}

function exportTasks(format) {
  if (!hub) return;
  const rows = taskExportRows();
  const name = safeFileName(hub.board.name);
  closeHubModal('export-modal');

  if (format === 'json') {
    downloadBlob(new Blob([JSON.stringify({ board: hub.board.name, sprint: hub.board.sprint_label, exported_at: new Date().toISOString(), tasks: rows }, null, 2)], { type: 'application/json' }), `${name}-tasks.json`);
    return showToast(`Exported ${rows.length} task${rows.length === 1 ? '' : 's'} as JSON.`);
  }
  if (format === 'csv') {
    const header = ['id', 'title', 'description', 'column', 'tag', 'priority', 'assignee', 'due_date', 'created_at', 'updated_at'];
    // Quote every value, and neutralise leading = + - @ so a spreadsheet never runs a cell as a formula
    const cell = (value) => {
      let text = String(value === null || value === undefined ? '' : value);
      if (/^[=+\-@]/.test(text)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [header.join(',')].concat(rows.map(r => header.map(h => cell(r[h])).join(','))).join('\r\n');
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${name}-tasks.csv`);
    return showToast(`Exported ${rows.length} task${rows.length === 1 ? '' : 's'} as CSV.`);
  }

  // PDF: a plain print layout; the browser's print dialog can save it as a PDF
  el('printSheet').innerHTML = `
    <h1>${escapeHtml(hub.board.name)}</h1>
    <p class="muted">${escapeHtml([hub.team.name, hub.board.sprint_label, new Date().toLocaleDateString()].filter(Boolean).join(' · '))}</p>
    ${HUB_COLUMNS.map(c => {
      const tasks = rows.filter(r => r.column === c.name);
      return `<h2>${c.name} (${tasks.length})</h2>` + (tasks.map(t => `
        <div class="task">
          <strong>${escapeHtml(t.title)}</strong>
          <span class="muted"> ${escapeHtml([t.tag, t.priority + ' priority', t.assignee, t.due_date ? 'due ' + t.due_date : ''].filter(Boolean).join(' · '))}</span>
          ${t.description ? `<div>${escapeHtml(t.description)}</div>` : ''}
        </div>`).join('') || '<p class="muted">No tasks.</p>');
    }).join('')}`;
  window.print();
}

// ==========================================
// 6. INTEGRATIONS
// ==========================================
function integrationHeader(iconHtml, title, subtitle, linked) {
  return `
    <div class="flex items-start gap-space-md">
      <div class="w-12 h-12 rounded-xl bg-surface-container-low flex items-center justify-center shrink-0">${iconHtml}</div>
      <div class="flex flex-col min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-headline-md text-headline-md font-bold text-on-surface">${title}</h3>
          <span class="inline-flex items-center gap-1 font-label-sm text-label-sm px-2 py-0.5 rounded-full font-semibold ${linked ? 'text-tertiary bg-tertiary-fixed/30' : 'text-on-surface-variant bg-surface-container'}">
            <span class="w-1.5 h-1.5 rounded-full ${linked ? 'bg-tertiary' : 'bg-outline'}"></span>${linked ? 'Linked' : 'Not linked'}
          </span>
        </div>
        <span class="font-label-md text-label-md text-on-surface-variant font-medium">${subtitle}</span>
      </div>
    </div>`;
}

function renderIntegrations() {
  if (!hub) return;
  renderGithubCard();
  renderFigmaCard();
}

const GITHUB_ICON = '<svg class="w-7 h-7 text-on-surface" fill="currentColor" viewBox="0 0 24 24"><path clip-rule="evenodd" fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>';
const FIGMA_ICON = '<svg class="w-6 h-8" fill="none" viewBox="0 0 38 57"><path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/><path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/><path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/><path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/><path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/></svg>';

function linkButtons(kind, linked) {
  if (!hubIsAdmin()) return linked ? '' : '<p class="font-body-sm text-body-sm text-on-surface-variant">A workspace Admin can link one.</p>';
  return linked
    ? `<button type="button" onclick="unlinkIntegration('${kind}')" class="font-label-sm text-label-sm text-error hover:bg-error-container/20 px-3 py-1.5 rounded-lg transition-colors self-start">Unlink</button>`
    : `<button type="button" id="link-${kind}-btn" onclick="openLinkModal('${kind}')" class="hub-btn-primary self-start">Link ${kind === 'github' ? 'a repository' : 'a Figma file'}</button>`;
}

function githubListHtml(title, items, emptyText, render) {
  return `<div><h4 class="font-label-md text-label-md font-bold text-on-surface mb-1">${title}</h4>${items.length
    ? `<ul class="flex flex-col gap-1">${items.map(render).join('')}</ul>`
    : `<p class="font-body-sm text-body-sm text-on-surface-variant">${emptyText}</p>`}</div>`;
}

function renderGithubCard() {
  const repo = hub.board.github_repo;
  const card = el('github-card');
  if (!repo) {
    githubRepoState = 'idle';
    card.innerHTML = integrationHeader(GITHUB_ICON, 'GitHub', 'Repository activity', false)
      + '<p class="font-body-md text-body-md text-on-surface-variant leading-relaxed">Link a public GitHub repository to see its recent commits, open pull requests and open issues here.</p>'
      + linkButtons('github', false);
    return;
  }

  let body;
  if (githubRepoState === 'idle') {
    loadGithubRepo();
    body = '<p class="font-body-md text-body-md text-on-surface-variant py-4">Loading repository activity...</p>';
  } else if (githubRepoState === 'loading') {
    body = '<p class="font-body-md text-body-md text-on-surface-variant py-4">Loading repository activity...</p>';
  } else if (githubRepoState === 'error') {
    body = `<p class="font-body-md text-body-md text-on-surface-variant py-2">${escapeHtml(githubRepoError)}</p>
      <button type="button" onclick="loadGithubRepo()" class="hub-btn-plain self-start">Try again</button>`;
  } else {
    const g = githubRepoData;
    const row = (label, url, meta) => `<li class="flex items-baseline justify-between gap-3 font-body-sm text-body-sm"><a href="${escapeHtml(safeUrl(url))}" target="_blank" rel="noopener" class="text-primary hover:underline truncate">${escapeHtml(label)}</a><span class="text-on-surface-variant shrink-0">${escapeHtml(meta)}</span></li>`;
    body = `
      <div class="bg-surface-container-low rounded-xl p-space-sm flex items-center justify-between gap-3 font-label-sm text-label-sm flex-wrap">
        <span class="text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-[16px]">alt_route</span>Branch: <strong class="text-on-surface">${escapeHtml(g.default_branch || '')}</strong></span>
        <span class="text-on-surface-variant">★ ${g.stars} · ${g.forks} forks${g.pushed_at ? ' · pushed ' + escapeHtml(relativeTime(g.pushed_at)) : ''}</span>
      </div>
      ${g.description ? `<p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(g.description)}</p>` : ''}
      ${githubListHtml('Recent commits', g.commits, 'No commits yet.', c => row(c.message || c.sha, c.url, `${c.author} · ${relativeTime(c.date)}`))}
      ${githubListHtml('Open pull requests', g.pulls, 'No open pull requests.', p => row(`#${p.number} ${p.title}`, p.url, p.author))}
      ${githubListHtml('Open issues', g.issues, 'No open issues.', i => row(`#${i.number} ${i.title}`, i.url, i.author))}`;
  }
  card.innerHTML = integrationHeader(GITHUB_ICON, 'GitHub', `<a href="https://github.com/${escapeHtml(repo)}" target="_blank" rel="noopener" class="text-primary hover:underline">${escapeHtml(repo)}</a>`, true)
    + body + linkButtons('github', true);
}

async function loadGithubRepo() {
  const repo = hub.board.github_repo;
  if (!repo) return;
  githubRepoState = 'loading';
  renderGithubCard();
  try {
    githubRepoData = await api(`/api/github/repos/${repo}`, { timeout: 45000 });   // GitHub itself can be slow
    githubRepoState = 'ready';
  } catch (err) {
    githubRepoState = 'error';
    githubRepoError = err.message;
  }
  if (hub && hub.board.github_repo === repo) {
    renderGithubCard();
    renderHubHeader();
  }
}

function figmaEmbedUrl(url) {
  return `https://www.figma.com/embed?embed_host=connect2minds&url=${encodeURIComponent(url)}`;
}

function renderFigmaCard() {
  const url = hub.board.figma_url;
  const card = el('figma-card');
  if (!url) {
    card.innerHTML = integrationHeader(FIGMA_ICON, 'Figma', 'Design file', false)
      + '<p class="font-body-md text-body-md text-on-surface-variant leading-relaxed">Link a Figma file so the team always has the current designs next to the board. The file must be shared so that anyone with the link can view it.</p>'
      + linkButtons('figma', false);
    return;
  }
  // Rebuilding the frame reloads Figma, so only do it when the link actually changed
  const frame = card.querySelector('iframe');
  if (frame && frame.dataset.url === url) return;
  card.innerHTML = integrationHeader(FIGMA_ICON, 'Figma', `<a href="${escapeHtml(safeUrl(url))}" target="_blank" rel="noopener" class="text-primary hover:underline">Open in Figma</a>`, true)
    + `<iframe data-url="${escapeHtml(url)}" src="${escapeHtml(figmaEmbedUrl(url))}" class="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low" style="height: 420px;" allowfullscreen loading="lazy" title="Figma file"></iframe>`
    + linkButtons('figma', true);
}

function openLinkModal(kind) {
  linkKind = kind;
  el('link-modal-title').textContent = kind === 'github' ? 'Link a GitHub repository' : 'Link a Figma file';
  el('link-modal-help').textContent = kind === 'github'
    ? 'Enter a public repository as owner/name, or paste its GitHub address.'
    : 'Paste the link to a Figma file that is shared with "Anyone with the link can view".';
  el('link-input').placeholder = kind === 'github' ? 'e.g. fastapi/fastapi' : 'https://www.figma.com/design/...';
  el('link-input').value = '';
  hubFormError('link-error', '');
  openHubModal('link-modal');
  setTimeout(() => el('link-input').focus(), 50);
}

async function saveLink(e) {
  e.preventDefault();
  const button = el('link-save-btn');
  const value = el('link-input').value.trim();
  button.disabled = true;
  button.textContent = 'Checking...';
  hubFormError('link-error', '');
  try {
    if (linkKind === 'github') {
      const repo = value.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
      // Make sure the repository exists and is public before saving it to the board
      const data = await api(`/api/github/repos/${repo}`, { timeout: 45000 });
      hub.board = await api(`/api/teams/${hubTeamId}/board`, { method: 'PATCH', body: { github_repo: data.full_name || repo } });
      githubRepoData = data;
      githubRepoState = 'ready';
    } else {
      hub.board = await api(`/api/teams/${hubTeamId}/board`, { method: 'PATCH', body: { figma_url: value } });
    }
    saveHubCache();
    renderHubHeader();
    renderIntegrations();
    closeHubModal('link-modal');
    showToast(linkKind === 'github' ? 'Repository linked.' : 'Figma file linked.');
  } catch (err) {
    hubFormError('link-error', err.message);
  }
  button.disabled = false;
  button.textContent = 'Link';
}

function unlinkIntegration(kind) {
  const what = kind === 'github' ? 'the GitHub repository' : 'the Figma file';
  hubConfirm('Unlink', `Remove ${what} from this board? Nothing is deleted on ${kind === 'github' ? 'GitHub' : 'Figma'}.`, 'Unlink', async () => {
    hub.board = await api(`/api/teams/${hubTeamId}/board`, { method: 'PATCH', body: kind === 'github' ? { github_repo: '' } : { figma_url: '' } });
    if (kind === 'github') { githubRepoData = null; githubRepoState = 'idle'; }
    saveHubCache();
    renderHubHeader();
    renderIntegrations();
    showToast('Unlinked.');
  });
}

// ==========================================
// 7. LIVE UPDATES
// ==========================================
function closeHubSocket() {
  hubSocketTeamId = null;
  if (hubSocket) {
    const socket = hubSocket;
    hubSocket = null;
    socket.onclose = null;
    try { socket.close(); } catch (e) { /* already closed */ }
  }
}

function connectHubSocket(teamId) {
  if (hubSocket && hubSocketTeamId === teamId && hubSocket.readyState <= WebSocket.OPEN) return;
  closeHubSocket();
  hubSocketTeamId = teamId;
  hubSocketWasOpen = false;
  openHubSocket(teamId);
}

function openHubSocket(teamId) {
  const socket = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/api/ws/teams/${teamId}/${currentUserId}`);
  hubSocket = socket;
  socket.onopen = () => {
    hubSocketRetry = 1000;
    el('hub-connection').classList.add('hidden');
    // Changes may have been made while we were disconnected
    if (hubSocketWasOpen && hubTeamId === teamId) refreshHubBoard(teamId);
    hubSocketWasOpen = true;
  };
  socket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    if (hubTeamId === teamId && hub) handleHubEvent(teamId, data);
  };
  socket.onclose = () => {
    if (hubSocket !== socket) return;
    hubSocket = null;
    if (hubSocketTeamId !== teamId) return;
    el('hub-connection').classList.remove('hidden');
    setTimeout(() => { if (hubSocketTeamId === teamId && !hubSocket) openHubSocket(teamId); }, hubSocketRetry);
    hubSocketRetry = Math.min(hubSocketRetry * 2, 10000);
  };
  socket.onerror = () => { try { socket.close(); } catch (e) { /* already closed */ } };
}

async function refreshHubBoard(teamId) {
  try {
    const data = await api(`/api/teams/${teamId}/board`);
    if (hubTeamId !== teamId) return;
    hub = data;
    saveHubCache();
    if (!canvasDirty && !canvasDrag) loadCanvasShapes(hub.canvas || []);
    renderHub();
  } catch (err) {
    if (err.status === 403 || err.status === 404) dropHubTeam(teamId, 'You no longer have access to that workspace.');
  }
}

function handleHubEvent(teamId, data) {
  switch (data.type) {
    case 'task_created':
    case 'task_updated':
      if (data.by === currentUserId && hub.tasks.some(t => t.id === data.task.id && t.updated_at === data.task.updated_at)) return;
      return applyTask(data.task);

    case 'task_deleted':
      if (editingTaskId === data.id) closeHubModal('task-modal');
      return removeTaskLocally(data.id);

    case 'board_updated': {
      const repoChanged = hub.board.github_repo !== data.board.github_repo;
      hub.board = data.board;
      if (repoChanged) { githubRepoData = null; githubRepoState = 'idle'; }
      saveHubCache();
      renderHubHeader();
      if (hubTab === 'integrations') renderIntegrations();
      return;
    }

    case 'canvas_updated':
      // Our own save coming back, or a change while we have unsaved edits (ours will be saved next and win)
      if (data.client_id === hubClientId || canvasDirty || canvasDrag) return;
      hub.canvas = data.shapes;
      saveHubCache();
      loadCanvasShapes(data.shapes);
      renderCanvas();
      setCanvasStatus(`Updated by ${(hubMember(data.by) || { user_name: 'a teammate' }).user_name}`);
      return;

    case 'members': {
      hub.members = data.members;
      const me = data.members.find(m => m.user_id === currentUserId);
      if (me) hub.role = me.role;
      saveHubCache();
      return renderHub();
    }

    case 'team_updated': {
      hub.team.name = data.team.name;
      const listed = hubTeams.find(t => t.id === teamId);
      if (listed) listed.name = data.team.name;
      cacheSet('teams', hubTeams);
      return renderTeamPicker();
    }

    case 'team_deleted':
      return dropHubTeam(teamId, 'This workspace was deleted.');

    case 'evicted':
      return dropHubTeam(teamId, data.reason === 'removed' ? 'You were removed from that workspace.' : '');
  }
}

// ==========================================
// 8. PLANNING CANVAS
// ==========================================
const CANVAS_PALETTE = {
  indigo: { stroke: '#4f46e5', fill: '#eef2ff', note: '#c7d2fe' },
  green: { stroke: '#059669', fill: '#ecfdf5', note: '#a7f3d0' },
  amber: { stroke: '#d97706', fill: '#fffbeb', note: '#fde68a' },
  rose: { stroke: '#e11d48', fill: '#fff1f2', note: '#fecdd3' },
  slate: { stroke: '#475569', fill: '#f8fafc', note: '#e2e8f0' }
};
const BOX_TYPES = ['rectangle', 'circle', 'database', 'sticky', 'text'];
const DEFAULT_SIZES = { rectangle: [150, 80], circle: [120, 120], database: [120, 130], sticky: [160, 120], text: [180, 44] };

let canvasShapes = [];
let canvasSelectedId = null;
let canvasTool = 'select';
let canvasView = { x: 0, y: 0, scale: 1 };
let canvasDrag = null;
let canvasDirty = false;
let canvasVersion = 0;         // increases with every local change, so a save knows if newer edits happened meanwhile
let canvasSaveTimer = null;
let canvasSaving = false;
let editingShapeId = null;

function isLineShape(shape) {
  return shape.type === 'arrow' || shape.type === 'line';
}

function loadCanvasShapes(shapes) {
  canvasShapes = JSON.parse(JSON.stringify(shapes || []));
  canvasSelectedId = null;
  canvasDirty = false;
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

async function saveCanvas() {
  clearTimeout(canvasSaveTimer);
  if (!canvasDirty || !hubTeamId || !hub) return;
  if (canvasSaving) { canvasSaveTimer = setTimeout(saveCanvas, 600); return; }
  canvasSaving = true;
  const version = canvasVersion;
  const teamId = hubTeamId;
  setCanvasStatus('Saving...');
  try {
    await api(`/api/teams/${teamId}/canvas`, { method: 'PUT', body: { shapes: canvasShapes, client_id: hubClientId } });
    if (hubTeamId === teamId) {
      hub.canvas = JSON.parse(JSON.stringify(canvasShapes));
      saveHubCache();
      if (version === canvasVersion) {
        canvasDirty = false;
        setCanvasStatus('Saved');
      }
    }
  } catch (err) {
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

function selectCanvasTool(tool) {
  canvasTool = tool;
  document.querySelectorAll('#canvas-tools .canvas-tool').forEach(b => b.classList.toggle('is-active', b.dataset.tool === tool));
  el('canvas-area').style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

function canvasPoint(event) {
  const rect = el('canvas-svg').getBoundingClientRect();
  return { x: (event.clientX - rect.left - canvasView.x) / canvasView.scale, y: (event.clientY - rect.top - canvasView.y) / canvasView.scale };
}

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

function shapeLabelSvg(shape, fontSize, weight) {
  const lines = wrapShapeText(shape.text, shape.w, shape.h, fontSize);
  if (lines.length === 0) return '';
  const lineHeight = fontSize * 1.3;
  const startY = shape.y + shape.h / 2 - ((lines.length - 1) * lineHeight) / 2;
  return `<text x="${shape.x + shape.w / 2}" y="${startY}" text-anchor="middle" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="#0b1c30" style="pointer-events:none; user-select:none;">${lines.map((line, i) => `<tspan x="${shape.x + shape.w / 2}" dy="${i === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function shapeSvg(shape) {
  const palette = CANVAS_PALETTE[shape.color] || CANVAS_PALETTE.indigo;
  const { x, y, w, h } = shape;
  let body;
  if (shape.type === 'rectangle') {
    body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2"/>` + shapeLabelSvg(shape, 13, 600);
  } else if (shape.type === 'circle') {
    body = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2"/>` + shapeLabelSvg(shape, 13, 600);
  } else if (shape.type === 'database') {
    const r = Math.min(14, h / 5);
    body = `<path d="M${x},${y + r} v${h - 2 * r} a${w / 2},${r} 0 0 0 ${w},0 v${-(h - 2 * r)}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2"/>`
      + `<ellipse cx="${x + w / 2}" cy="${y + r}" rx="${w / 2}" ry="${r}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="2"/>`
      + shapeLabelSvg({ ...shape, y: y + r, h: h - r }, 13, 600);
  } else if (shape.type === 'sticky') {
    body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${palette.note}" stroke="${palette.stroke}" stroke-opacity="0.35" stroke-width="1"/>` + shapeLabelSvg(shape, 13, 500);
  } else if (shape.type === 'text') {
    body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" fill-opacity="0.001"/>`
      + (shape.text ? shapeLabelSvg(shape, 16, 700) : `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="central" font-family="Inter, Arial, sans-serif" font-size="13" fill="#777587" style="pointer-events:none;">Double-click to type</text>`);
  } else {
    const marker = shape.type === 'arrow' ? ` marker-end="url(#arrow-${shape.color in CANVAS_PALETTE ? shape.color : 'indigo'})"` : '';
    body = `<line x1="${x}" y1="${y}" x2="${shape.x2}" y2="${shape.y2}" stroke="#000" stroke-opacity="0.001" stroke-width="16"/>`
      + `<line x1="${x}" y1="${y}" x2="${shape.x2}" y2="${shape.y2}" stroke="${palette.stroke}" stroke-width="2.5" stroke-linecap="round"${marker}/>`;
  }
  return `<g class="shape" data-shape-id="${escapeHtml(shape.id)}">${body}</g>`;
}

function canvasDefsSvg() {
  return '<defs>' + Object.entries(CANVAS_PALETTE).map(([name, p]) =>
    `<marker id="arrow-${name}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L10,4 L0,8 z" fill="${p.stroke}"/></marker>`).join('') + '</defs>';
}

function selectionSvg(shape) {
  const size = 9 / canvasView.scale;
  if (isLineShape(shape)) {
    return `<circle class="handle end" data-handle="start" cx="${shape.x}" cy="${shape.y}" r="${size * 0.6}"/><circle class="handle end" data-handle="end" cx="${shape.x2}" cy="${shape.y2}" r="${size * 0.6}"/>`;
  }
  return `<rect x="${shape.x - 3}" y="${shape.y - 3}" width="${shape.w + 6}" height="${shape.h + 6}" fill="none" stroke="#3525cd" stroke-width="${1.2 / canvasView.scale}" stroke-dasharray="${4 / canvasView.scale}" style="pointer-events:none;"/>`
    + `<rect class="handle" data-handle="resize" x="${shape.x + shape.w - size / 2}" y="${shape.y + shape.h - size / 2}" width="${size}" height="${size}" rx="2"/>`;
}

function renderCanvas() {
  const layer = el('canvas-layer');
  if (!layer) return;
  const selected = canvasShapes.find(s => s.id === canvasSelectedId);
  layer.setAttribute('transform', `translate(${canvasView.x} ${canvasView.y}) scale(${canvasView.scale})`);
  layer.innerHTML = canvasShapes.map(shapeSvg).join('') + (selected ? selectionSvg(selected) : '');
  el('canvas-hint').classList.toggle('hidden', canvasShapes.length > 0 || !!canvasDrag);
  el('zoom-label').textContent = `${Math.round(canvasView.scale * 100)}%`;
  el('canvas-area').style.backgroundSize = `${24 * canvasView.scale}px ${24 * canvasView.scale}px`;
  el('canvas-area').style.backgroundPosition = `${canvasView.x}px ${canvasView.y}px`;
  el('canvas-colors').innerHTML = Object.entries(CANVAS_PALETTE).map(([name, p]) =>
    `<button type="button" onclick="setShapeColor('${name}')" title="${name}" class="w-5 h-5 rounded-full border-2 ${selected && selected.color === name ? 'border-on-surface' : 'border-white'} shadow-sm ${selected ? '' : 'opacity-40'}" style="background:${p.stroke}"></button>`).join('');
}

function initCanvas() {
  const svg = el('canvas-svg');
  svg.querySelector('defs').outerHTML = canvasDefsSvg();
  svg.style.touchAction = 'none';
  selectCanvasTool('select');

  svg.addEventListener('pointerdown', onCanvasPointerDown);
  window.addEventListener('pointermove', onCanvasPointerMove);
  window.addEventListener('pointerup', onCanvasPointerUp);
  svg.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.shape');
    if (node) openShapeText(node.dataset.shapeId);
  });
  svg.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;   // plain scrolling still scrolls the page
    e.preventDefault();
    zoomCanvas(e.deltaY < 0 ? 0.1 : -0.1, e);
  }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if (hubTab !== 'canvas' || !canvasSelectedId) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedShape(); }
  });
  document.addEventListener('fullscreenchange', onCanvasFullscreenChange);
  window.addEventListener('beforeunload', () => {
    // Last chance to keep unsaved drawing: a request the browser finishes even as the page closes
    if (canvasDirty && hubTeamId) {
      fetch(`${API_BASE}/api/teams/${hubTeamId}/canvas`, { method: 'PUT', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shapes: canvasShapes, client_id: hubClientId }) });
    }
  });
}

function onCanvasPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) return;
  if (!hub) return;
  const point = canvasPoint(event);
  const handle = event.target.closest('[data-handle]');
  const node = event.target.closest('.shape');

  if (handle && canvasSelectedId) {
    canvasDrag = { kind: handle.dataset.handle, id: canvasSelectedId, changed: false };
  } else if (node && canvasTool === 'select') {
    const shape = canvasShapes.find(s => s.id === node.dataset.shapeId);
    if (!shape) return;
    canvasSelectedId = shape.id;
    canvasDrag = { kind: 'move', id: shape.id, start: point, origin: { x: shape.x, y: shape.y, x2: shape.x2, y2: shape.y2 }, changed: false };
  } else if (canvasTool === 'select') {
    canvasSelectedId = null;
    canvasDrag = { kind: 'pan', startClient: { x: event.clientX, y: event.clientY }, origin: { x: canvasView.x, y: canvasView.y } };
  } else {
    const shape = { id: newTempId(), type: canvasTool, x: point.x, y: point.y, w: 0, h: 0, x2: point.x, y2: point.y, text: '', color: canvasTool === 'sticky' ? 'amber' : 'indigo' };
    canvasShapes.push(shape);
    canvasSelectedId = shape.id;
    canvasDrag = { kind: 'create', id: shape.id, start: point };
  }
  event.preventDefault();
  renderCanvas();
}

function onCanvasPointerMove(event) {
  if (!canvasDrag) return;
  if (canvasDrag.kind === 'pan') {
    canvasView.x = canvasDrag.origin.x + event.clientX - canvasDrag.startClient.x;
    canvasView.y = canvasDrag.origin.y + event.clientY - canvasDrag.startClient.y;
    return renderCanvas();
  }
  const shape = canvasShapes.find(s => s.id === canvasDrag.id);
  if (!shape) return;
  const point = canvasPoint(event);
  canvasDrag.changed = true;

  if (canvasDrag.kind === 'move') {
    const dx = point.x - canvasDrag.start.x;
    const dy = point.y - canvasDrag.start.y;
    shape.x = canvasDrag.origin.x + dx;
    shape.y = canvasDrag.origin.y + dy;
    if (isLineShape(shape)) { shape.x2 = canvasDrag.origin.x2 + dx; shape.y2 = canvasDrag.origin.y2 + dy; }
  } else if (canvasDrag.kind === 'resize') {
    shape.w = Math.max(30, point.x - shape.x);
    shape.h = Math.max(24, point.y - shape.y);
  } else if (canvasDrag.kind === 'start') {
    shape.x = point.x; shape.y = point.y;
  } else if (canvasDrag.kind === 'end') {
    shape.x2 = point.x; shape.y2 = point.y;
  } else if (canvasDrag.kind === 'create') {
    if (isLineShape(shape)) {
      shape.x2 = point.x; shape.y2 = point.y;
    } else {
      shape.x = Math.min(canvasDrag.start.x, point.x);
      shape.y = Math.min(canvasDrag.start.y, point.y);
      shape.w = Math.abs(point.x - canvasDrag.start.x);
      shape.h = Math.abs(point.y - canvasDrag.start.y);
    }
  }
  renderCanvas();
}

function onCanvasPointerUp() {
  if (!canvasDrag) return;
  const drag = canvasDrag;
  canvasDrag = null;
  if (drag.kind === 'pan') return renderCanvas();

  const shape = canvasShapes.find(s => s.id === drag.id);
  if (drag.kind === 'create' && shape) {
    if (isLineShape(shape)) {
      // A click without a drag is not a line
      if (Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y) < 8) {
        canvasShapes = canvasShapes.filter(s => s !== shape);
        canvasSelectedId = null;
        selectCanvasTool('select');
        return renderCanvas();
      }
    } else if (shape.w < 12 || shape.h < 12) {
      // A click without a drag drops a shape of a sensible size where you clicked
      const [w, h] = DEFAULT_SIZES[shape.type];
      shape.x = drag.start.x - w / 2;
      shape.y = drag.start.y - h / 2;
      shape.w = w;
      shape.h = h;
    }
    selectCanvasTool('select');
    markCanvasDirty();
    renderCanvas();
    if (shape.type === 'sticky' || shape.type === 'text') openShapeText(shape.id);
    return;
  }
  if (drag.changed) markCanvasDirty();
  renderCanvas();
}

function openShapeText(shapeId) {
  const shape = canvasShapes.find(s => s.id === shapeId);
  if (!shape || isLineShape(shape)) return;
  editingShapeId = shapeId;
  canvasSelectedId = shapeId;
  renderCanvas();
  el('shape-text-input').value = shape.text || '';
  openHubModal('shape-text-modal');
  setTimeout(() => el('shape-text-input').focus(), 50);
}

function applyShapeText(e) {
  e.preventDefault();
  const shape = canvasShapes.find(s => s.id === editingShapeId);
  if (shape) {
    shape.text = el('shape-text-input').value.slice(0, 500);
    markCanvasDirty();
    renderCanvas();
  }
  closeHubModal('shape-text-modal');
}

function setShapeColor(color) {
  const shape = canvasShapes.find(s => s.id === canvasSelectedId);
  if (!shape) return showToast('Select a shape first.');
  shape.color = color;
  markCanvasDirty();
  renderCanvas();
}

function deleteSelectedShape() {
  if (!canvasSelectedId) return showToast('Select a shape first.');
  canvasShapes = canvasShapes.filter(s => s.id !== canvasSelectedId);
  canvasSelectedId = null;
  markCanvasDirty();
  renderCanvas();
}

function clearCanvas() {
  if (canvasShapes.length === 0) return showToast('The canvas is already empty.');
  hubConfirm('Clear Canvas', `Remove all ${canvasShapes.length} shapes from this workspace's canvas? This affects everyone in the workspace.`, 'Clear', async () => {
    canvasShapes = [];
    canvasSelectedId = null;
    markCanvasDirty();
    renderCanvas();
  });
}

function canvasBounds() {
  if (canvasShapes.length === 0) return null;
  const xs = [];
  const ys = [];
  canvasShapes.forEach(s => {
    if (isLineShape(s)) { xs.push(s.x, s.x2); ys.push(s.y, s.y2); }
    else { xs.push(s.x, s.x + s.w); ys.push(s.y, s.y + s.h); }
  });
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function zoomCanvas(delta, aroundEvent) {
  const rect = el('canvas-svg').getBoundingClientRect();
  const cx = aroundEvent ? aroundEvent.clientX - rect.left : rect.width / 2;
  const cy = aroundEvent ? aroundEvent.clientY - rect.top : rect.height / 2;
  const next = Math.max(0.3, Math.min(2.5, Math.round((canvasView.scale + delta) * 10) / 10));
  // Keep the point under the pointer (or the centre) where it is
  canvasView.x = cx - (cx - canvasView.x) * (next / canvasView.scale);
  canvasView.y = cy - (cy - canvasView.y) * (next / canvasView.scale);
  canvasView.scale = next;
  renderCanvas();
}

function fitCanvas() {
  const bounds = canvasBounds();
  const rect = el('canvas-svg').getBoundingClientRect();
  if (!bounds) {
    canvasView = { x: 0, y: 0, scale: 1 };
    return renderCanvas();
  }
  const pad = 60;
  const scale = Math.max(0.3, Math.min(1.5, Math.min((rect.width - pad * 2) / Math.max(1, bounds.maxX - bounds.minX), (rect.height - pad * 2) / Math.max(1, bounds.maxY - bounds.minY))));
  canvasView.scale = scale;
  canvasView.x = (rect.width - (bounds.maxX - bounds.minX) * scale) / 2 - bounds.minX * scale;
  canvasView.y = (rect.height - (bounds.maxY - bounds.minY) * scale) / 2 - bounds.minY * scale;
  renderCanvas();
}

function toggleCanvasFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else el('canvas-wrapper').requestFullscreen().catch(() => showToast('Fullscreen is not available here.'));
}

function onCanvasFullscreenChange() {
  const full = document.fullscreenElement === el('canvas-wrapper');
  el('canvas-area').style.height = full ? 'calc(100vh - 58px)' : '';
  // Only what is inside the fullscreen element is visible, so the dialogs move in with it
  ['shape-text-modal', 'systemModal'].forEach(id => (full ? el('canvas-wrapper') : document.body).appendChild(el(id)));
  renderCanvas();
}

// ===== FILE MENU =====
function canvasFileAction(action) {
  el('file-dropdown').classList.add('hidden');
  if (action === 'save') {
    if (!canvasDirty) return showToast('Everything is already saved.');
    return saveCanvas();
  }
  if (action === 'png') return exportCanvasPng();
  if (action === 'backup') {
    if (canvasShapes.length === 0) return showToast('There is nothing on the canvas to copy.');
    downloadBlob(new Blob([JSON.stringify({ board: hub.board.name, saved_at: new Date().toISOString(), shapes: canvasShapes }, null, 2)], { type: 'application/json' }), `${safeFileName(hub.board.name)}-canvas.json`);
    return showToast('A copy of the canvas was downloaded.');
  }
  if (action === 'restore') el('canvas-restore-input').click();
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
      canvasShapes = shapes.filter(s => s && typeof s === 'object').map(s => Object.assign({ w: 0, h: 0, x2: 0, y2: 0, text: '', color: 'indigo' }, s, { id: newTempId() }));
      canvasSelectedId = null;
      markCanvasDirty();
      fitCanvas();
    };
    if (canvasShapes.length === 0) return apply();
    hubConfirm('Open a Copy', `Replace the ${canvasShapes.length} shapes on the canvas with the ${shapes.length} in this file? This affects everyone in the workspace.`, 'Replace', apply);
  };
  reader.readAsText(file);
}

function canvasExportSvg() {
  const bounds = canvasBounds();
  const pad = 40;
  const width = Math.ceil(bounds.maxX - bounds.minX + pad * 2);
  const height = Math.ceil(bounds.maxY - bounds.minY + pad * 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${canvasDefsSvg()}<rect width="100%" height="100%" fill="#ffffff"/><g transform="translate(${pad - bounds.minX} ${pad - bounds.minY})">${canvasShapes.map(shapeSvg).join('')}</g></svg>`;
  return { svg, width, height };
}

function exportCanvasPng() {
  if (canvasShapes.length === 0) return showToast('There is nothing on the canvas to export.');
  const { svg, width, height } = canvasExportSvg();
  const image = new Image();
  image.onload = () => {
    const scale = 2;   // sharper on high-density screens and when zoomed
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    context.drawImage(image, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return showToast('The image could not be created.');
      window.__lastCanvasPng = { width: canvas.width, height: canvas.height, bytes: blob.size };
      downloadBlob(blob, `${safeFileName(hub.board.name)}-canvas.png`);
      showToast('Canvas exported as PNG.');
    }, 'image/png');
  };
  image.onerror = () => showToast('The image could not be created.');
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// ===== INIT =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHub);
} else {
  initHub();
}
