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
  // A link (for example "Plan together" from a call) may name the workspace and the tool to open
  const params = new URLSearchParams(window.location.search);
  const linkedTeam = parseInt(params.get('team'), 10) || null;
  hubTab = params.get('tab') || cacheGet('hub-tab') || 'kanban';
  if (!hubTabExists(hubTab)) hubTab = 'kanban';
  switchHubTab(hubTab, true);
  el('task-form').addEventListener('submit', saveTask);
  el('settings-form').addEventListener('submit', saveHubSettings);
  el('link-form').addEventListener('submit', saveLink);
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
  const remembered = linkedTeam || cacheGet('hub-last-team');
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
  if (linkedTeam && hubTeamId !== linkedTeam && hubTeams.some(t => t.id === linkedTeam)) openHubTeam(linkedTeam);
  else if (!hubTeams.some(t => t.id === hubTeamId)) openHubTeam(hubTeams[0].id);
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
  normalizeHub();
  document.body.classList.toggle('is-admin', hubIsAdmin());
  renderHubHeader();
  renderBoard();
  renderActiveTool();
  paintTimerChip();
}

// Boards saved before the planning tools existed lack their parts
function normalizeHub() {
  hub.sprints = hub.sprints || [];
  hub.items = hub.items || [];
  hub.comment_counts = hub.comment_counts || {};
  hub.time = hub.time || [];
}

function switchHubTab(tab, quiet) {
  if (!HUB_TABS.includes(tab)) tab = 'kanban';
  hubTab = tab;
  HUB_TABS.forEach(name => {
    const view = document.getElementById(`view-${name}`);
    if (!view) return;
    view.classList.toggle('hidden', name !== tab);
    view.classList.toggle('flex', name === tab);
  });
  paintHubNav();
  if (!quiet) cacheSet('hub-tab', tab);
  sendHubView();
  renderActiveTool();
}

// Draws whichever tool is open. The board is always kept current, the others only while they are shown.
function renderActiveTool() {
  if (!hub) return;
  if (hubTab === 'kanban') return;      // renderBoard() runs on every change anyway
  if (hubTab === 'canvas') return renderCanvas();
  if (hubTab === 'integrations') return renderIntegrations();
  const tool = hubTools[hubTab];
  if (tool) {
    try { tool.render(); } catch (err) { console.error('Project Hub tool failed to draw:', hubTab, err); }
  }
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
  if (hub.tasks.length === 0 && hubIsAdmin()) {
    chips.push(`<button type="button" onclick="openTemplatePicker()" class="inline-flex items-center gap-1 text-primary font-semibold bg-primary-fixed/40 px-2 py-0.5 rounded border border-primary-fixed-dim/50 hover:bg-primary-fixed/60 transition-colors"><span class="material-symbols-outlined text-[14px]">auto_awesome</span>Start from a template</button>`);
  } else if (hubIsAdmin()) {
    chips.push(`<button type="button" onclick="openTemplatePicker()" class="inline-flex items-center gap-1 text-on-surface-variant font-medium px-2 py-0.5 rounded hover:bg-surface-container transition-colors"><span class="material-symbols-outlined text-[14px]">auto_awesome</span>Templates</button>`);
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
    <div class="task-card group bg-surface-container-lowest rounded-xl p-space-md border border-outline-variant/40 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col gap-2" draggable="true" data-task-id="${task.id}" onclick="openTaskDrawer(${task.id})" ondragstart="onTaskDragStart(event, ${task.id})" ondragend="onTaskDragEnd(event)">
      <div class="flex items-center justify-between gap-2 min-h-[20px]">
        ${task.tag ? `<span class="font-skill-pill text-skill-pill font-semibold px-2 py-0.5 rounded tracking-wider uppercase truncate ${tagStyle(task.tag)}">${escapeHtml(task.tag)}</span>` : '<span></span>'}
        <button type="button" class="material-symbols-outlined text-[18px] text-on-surface-variant opacity-60 group-hover:opacity-100 transition-opacity card-menu-btn" title="Task actions" onclick="event.stopPropagation(); openCardMenu(event, ${task.id})">more_horiz</button>
      </div>
      <h3 class="font-headline-sm text-headline-sm font-semibold text-on-surface leading-snug break-words">${escapeHtml(task.title)}</h3>
      ${task.description ? `<p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 break-words">${escapeHtml(task.description)}</p>` : ''}
      ${taskBadgesHtml(task)}
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
  renderActiveTool();
  hubTaskChanged(taskId, true);
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
  renderActiveTool();
  hubTaskChanged(task.id);
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
    sendHubView();
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
      return onCanvasUpdated(data);

    case 'canvas_patch':
      return onCanvasPatch(data);

    case 'canvas_cursor':
      return onCanvasCursor(data);

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

    case 'hub_presence':
      hubViewers = data.viewers || [];
      cvPeersPresence(hubViewers);
      return renderHubHere();

    case 'team_deleted':
      return dropHubTeam(teamId, 'This workspace was deleted.');

    case 'board_reload':
      return refreshHubBoard(teamId);

    default:
      return hubToolsEvent(data);       // sprints, plan entries, comments, time (hub-tools.js)

    case 'evicted':
      return dropHubTeam(teamId, data.reason === 'removed' ? 'You were removed from that workspace.' : '');
  }
}

// ==========================================
// 8. PLANNING CANVAS: in hub-canvas.js, hub-canvas-tools.js, hub-canvas-extras.js and hub-canvas-templates.js
// ==========================================

// ===== INIT =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHub);
} else {
  initHub();
}

// ==========================================
// 9. WHO IS HERE (teammates with Project Hub open, and on which tool)
// ==========================================
let hubViewers = [];

function hubTabExists(tab) {
  return HUB_TABS.includes(tab);
}

function hubTabLabel(tab) {
  const found = HUB_TAB_LIST.find(t => t.name === tab);
  return found ? found.label : tab;
}

function sendHubView() {
  if (hubSocket && hubSocket.readyState === WebSocket.OPEN) {
    try { hubSocket.send(JSON.stringify({ type: 'hub_view', tab: hubTab })); } catch (e) { /* reconnects by itself */ }
  }
}

function renderHubHere() {
  const box = el('hub-here');
  if (!box) return;
  const others = hubViewers.filter(v => v.user_id !== currentUserId);
  box.classList.toggle('hidden', others.length === 0);
  box.classList.toggle('flex', others.length > 0);
  box.innerHTML = others.length === 0 ? '' : `<span class="relative flex h-2 w-2"><span class="absolute inline-flex h-full w-full rounded-full bg-tertiary opacity-60 animate-ping"></span><span class="relative inline-flex h-2 w-2 rounded-full bg-tertiary"></span></span>
    <span class="hidden sm:inline">Here now</span>
    <span class="flex -space-x-2">${others.slice(0, 5).map(v => `<button type="button" class="rounded-full ring-2 ring-surface-container-lowest" onclick="switchHubTab('${escapeHtml(v.tab)}')" title="${escapeHtml(v.name)} · ${escapeHtml(hubTabLabel(v.tab))}">${memberAvatarHtml({ user_id: v.user_id, user_name: v.name, user_profile_pic: v.profile_pic }, 'h-7 w-7', 'text-[11px]')}</button>`).join('')}</span>`;
}
