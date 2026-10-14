// ==========================================
// HUB-TOOLS.JS — What the Project Hub planning tools share (loaded before project-hub.js).
// Each tool lives in its own hub-*.js file and registers itself with registerHubTool(name, { render }).
// project-hub.js keeps `hub` (the workspace's board, tasks, sprints, plan entries, comments and time) up to date;
// a tool only draws from it and saves through the server, whose live updates come back through hubToolsEvent().
// ==========================================

const HUB_TAB_GROUPS = [
  ['Plan', [['kanban', 'view_kanban', 'Board'], ['list', 'table_rows', 'List'], ['calendar', 'calendar_month', 'Calendar'],
            ['timeline', 'view_timeline', 'Timeline'], ['sprints', 'sprint', 'Sprints']]],
  ['Define', [['brief', 'description', 'Brief'], ['risks', 'warning', 'Risks & decisions'], ['roles', 'groups', 'Roles & workload']]],
  ['Track', [['dashboard', 'monitoring', 'Dashboard'], ['time', 'timer', 'Time']]],
  ['Together', [['docs', 'article', 'Docs & meetings'], ['ideas', 'lightbulb', 'Brainstorm'], ['canvas', 'gesture', 'Canvas'], ['integrations', 'extension', 'Integrations']]],
];
const HUB_TAB_LIST = HUB_TAB_GROUPS.flatMap(([group, tabs]) => tabs.map(([name, icon, label]) => ({ name, icon, label, group })));
const HUB_TABS = HUB_TAB_LIST.map(t => t.name);
const hubTools = {};
const hubTaskListeners = [];

function registerHubTool(name, tool) {
  hubTools[name] = tool;
}

const msIcon = (name, extra = '') => `<span class="material-symbols-outlined${extra ? ' ' + extra : ''}" aria-hidden="true">${name}</span>`;

// ==========================================
// 1. THE TOOL BAR
// ==========================================
function paintHubNav() {
  const nav = document.getElementById('hubNav');
  const select = document.getElementById('hubNavSelect');
  if (!nav || !select) return;
  if (!nav.dataset.built) {
    nav.dataset.built = '1';
    nav.innerHTML = HUB_TAB_GROUPS.map(([group, tabs]) => `
      <div class="ht-nav-group" role="group" aria-label="${escapeHtml(group)}">
        <span class="ht-nav-label">${escapeHtml(group)}</span>
        ${tabs.map(([name, icon, label]) => `<button type="button" class="ht-tab" data-hub-tab="${name}">${msIcon(icon)}<span>${escapeHtml(label)}</span></button>`).join('')}
      </div>`).join('');
    select.innerHTML = HUB_TAB_GROUPS.map(([group, tabs]) => `<optgroup label="${escapeHtml(group)}">${tabs.map(([name, , label]) =>
      `<option value="${name}">${escapeHtml(label)}</option>`).join('')}</optgroup>`).join('');
    nav.addEventListener('click', (e) => {
      const button = e.target.closest('[data-hub-tab]');
      if (button) switchHubTab(button.dataset.hubTab);
    });
    select.addEventListener('change', () => switchHubTab(select.value));
  }
  nav.querySelectorAll('[data-hub-tab]').forEach(button => {
    const on = button.dataset.hubTab === hubTab;
    button.classList.toggle('is-active', on);
    if (on) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  select.value = hubTab;
  const active = nav.querySelector('.ht-tab.is-active');
  if (active && nav.scrollWidth > nav.clientWidth) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ==========================================
// 2. LIVE UPDATES FOR THE PLAN (tasks are handled in project-hub.js)
// ==========================================
function upsertById(list, entry) {
  const index = list.findIndex(x => x.id === entry.id);
  if (index === -1) list.push(entry); else list[index] = entry;
}

function hubToolsEvent(data) {
  if (!hub) return;
  normalizeHub();
  switch (data.type) {
    case 'sprint_saved': upsertById(hub.sprints, data.sprint); break;
    case 'sprint_deleted': hub.sprints = hub.sprints.filter(s => s.id !== data.id); break;
    case 'item_saved': upsertById(hub.items, data.item); break;
    case 'item_deleted': hub.items = hub.items.filter(i => i.id !== data.id); break;
    case 'comment_added': {
      const key = String(data.comment.task_id);
      hub.comment_counts[key] = (hub.comment_counts[key] || 0) + 1;     // counted only here, from the live event (ours comes back too)
      renderBoard();
      break;
    }
    case 'comment_deleted': {
      const key = String(data.task_id);
      hub.comment_counts[key] = Math.max(0, (hub.comment_counts[key] || 1) - 1);
      renderBoard();
      break;
    }
    case 'time_changed': upsertById(hub.time, data.entry); break;
    case 'time_deleted': hub.time = hub.time.filter(t => t.id !== data.id); break;
    default: return;
  }
  saveHubCache();
  renderActiveTool();
  if (typeof hubDrawerEvent === 'function') hubDrawerEvent(data);
  if (typeof paintTimerChip === 'function') paintTimerChip();
}

function hubTaskChanged(taskId, deleted) {
  hubTaskListeners.forEach(listener => { try { listener(taskId, deleted); } catch (e) { /* a tool that is not open */ } });
}

// ==========================================
// 3. DATES (plain YYYY-MM-DD strings, read as local days)
// ==========================================
function dayDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function dayIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(iso, n) {
  const d = dayDate(iso);
  d.setDate(d.getDate() + n);
  return dayIso(d);
}

function daysBetween(a, b) {
  return Math.round((dayDate(b) - dayDate(a)) / 86400000);
}

function dayLabel(iso, withYear) {
  if (!iso) return '';
  return dayDate(iso).toLocaleDateString([], withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

function minutesLabel(minutes) {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

// ==========================================
// 4. TASKS AND MEMBERS
// ==========================================
function taskById(id) {
  return hub && hub.tasks.find(t => t.id === id);
}

function memberName(userId) {
  const member = hubMember(userId);
  return member ? member.user_name : 'Former member';
}

function avatarOf(userId, size = 'h-6 w-6', text = 'text-[10px]') {
  const member = hubMember(userId);
  return member ? memberAvatarHtml(member, size, text) : '';
}

function memberOptions(selected, emptyLabel = 'Nobody yet') {
  return [['', emptyLabel]].concat(hub.members.map(m => [String(m.user_id), m.user_id === currentUserId ? `${m.user_name} (You)` : m.user_name]))
    .map(([value, label]) => [value, label]);
}

// A task waits for others that are not done yet
function taskBlockedBy(task) {
  return (task.depends_on || []).map(taskById).filter(t => t && t.column !== 'done');
}

function taskBadgesHtml(task) {
  const badges = [];
  if (task.is_milestone) badges.push(`<span class="ht-badge is-milestone" title="Milestone">${msIcon('flag')}Milestone</span>`);
  const blocked = taskBlockedBy(task);
  if (blocked.length && task.column !== 'done') badges.push(`<span class="ht-badge is-blocked" title="Waiting for: ${escapeHtml(blocked.map(t => t.title).join(', '))}">${msIcon('block')}Waiting</span>`);
  const list = task.checklist || [];
  if (list.length) badges.push(`<span class="ht-badge${list.every(c => c.done) ? ' is-done' : ''}" title="Checklist">${msIcon('checklist')}${list.filter(c => c.done).length}/${list.length}</span>`);
  const comments = hub && hub.comment_counts ? hub.comment_counts[String(task.id)] || 0 : 0;
  if (comments) badges.push(`<span class="ht-badge" title="Comments">${msIcon('chat_bubble')}${comments}</span>`);
  if (task.estimate_hours) badges.push(`<span class="ht-badge" title="Estimate">${msIcon('hourglass_empty')}${task.estimate_hours} h</span>`);
  return badges.length ? `<div class="ht-badges">${badges.join('')}</div>` : '';
}

async function patchTask(taskId, body) {
  try {
    const saved = await api(`/api/tasks/${taskId}`, { method: 'PATCH', body });
    applyTask(saved);
    return saved;
  } catch (err) {
    showToast(err.message);
    return null;
  }
}

async function createTask(body) {
  try {
    const saved = await api(`/api/teams/${hubTeamId}/tasks`, { method: 'POST', body });
    applyTask(saved);
    return saved;
  } catch (err) {
    showToast(err.message);
    return null;
  }
}

function newTaskSheet(prefill = {}) {
  openSheet({
    title: prefill.is_milestone ? 'New milestone' : 'New task',
    fields: [
      { name: 'title', label: 'Title', required: true, maxlength: 160, value: prefill.title || '' },
      { name: 'start_date', label: 'Start', type: 'date', half: true, value: prefill.start_date || '' },
      { name: 'due_date', label: prefill.is_milestone ? 'Date' : 'Due', type: 'date', half: true, value: prefill.due_date || '' },
      { name: 'assignee_id', label: 'Assignee', type: 'select', half: true, options: memberOptions(null, 'Unassigned'), value: prefill.assignee_id || '' },
      { name: 'sprint_id', label: 'Sprint', type: 'select', half: true, options: [['', 'Backlog']].concat(hub.sprints.filter(s => s.status !== 'done').map(s => [String(s.id), s.name])), value: prefill.sprint_id || '' },
      { name: 'estimate_hours', label: 'Estimate (hours)', type: 'number', min: 0, max: 1000, step: 0.5, half: true },
      { name: 'is_milestone', label: 'Milestone', type: 'checkbox', half: true, value: !!prefill.is_milestone },
    ],
    submitLabel: 'Add',
    onSubmit: async (v) => {
      const body = { title: v.title, start_date: v.start_date, due_date: v.due_date, is_milestone: v.is_milestone };
      if (v.assignee_id) body.assignee_id = parseInt(v.assignee_id, 10);
      if (v.sprint_id) body.sprint_id = parseInt(v.sprint_id, 10);
      if (v.estimate_hours !== null) body.estimate_hours = v.estimate_hours;
      const saved = await api(`/api/teams/${hubTeamId}/tasks`, { method: 'POST', body });
      applyTask(saved);
    },
  });
}

// ==========================================
// 5. PLAN ENTRIES (brief, risks, decisions, docs, meetings, ideas, mind maps, roles)
// ==========================================
function itemsOf(kind) {
  return (hub ? hub.items : []).filter(i => i.kind === kind).sort((a, b) => (a.position - b.position) || (a.id - b.id));
}

// Saves an entry. When a teammate saved a newer version in between, asks whether to keep theirs or overwrite it.
async function saveHubItem({ id, kind, title, data, base }) {
  const body = { title, data };
  try {
    const saved = id
      ? await api(`/api/items/${id}`, { method: 'PATCH', body: base ? { ...body, base_updated_at: base } : body })
      : await api(`/api/teams/${hubTeamId}/items`, { method: 'POST', body: { ...body, kind } });
    upsertById(hub.items, saved);
    saveHubCache();
    return saved;
  } catch (err) {
    if (err.status === 409 && err.data && err.data.item) {
      const theirs = err.data.item;
      return new Promise((resolve) => {
        window.showSystemModal('Changed by a teammate', `${escapeHtml(err.message)} Keep your version and replace theirs, or cancel to see theirs?`, 'confirm', async () => {
          resolve(await saveHubItem({ id, kind, title, data }));
        }, 'Keep mine');
        document.getElementById('systemModalCancel').addEventListener('click', () => {
          upsertById(hub.items, theirs);
          saveHubCache();
          renderActiveTool();
          resolve(null);
        }, { once: true });
      });
    }
    throw err;
  }
}

function deleteHubItem(item, what) {
  hubConfirm(`Delete ${what}?`, `“${escapeHtml(item.title || what)}” will be removed for everyone in the workspace.`, 'Delete', async () => {
    try {
      await api(`/api/items/${item.id}`, { method: 'DELETE' });
      hub.items = hub.items.filter(i => i.id !== item.id);
      saveHubCache();
      renderActiveTool();
    } catch (err) {
      showToast(err.message);
    }
  });
}

// ==========================================
// 6. SMALL PIECES OF MARKUP
// ==========================================
function toolEmpty(icon, title, text, actionHtml = '') {
  return `<div class="ht-empty">${msIcon(icon)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${actionHtml}</div>`;
}

function toolHead(title, subtitle, actionsHtml = '') {
  return `<div class="ht-head"><div><h2>${escapeHtml(title)}</h2>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div><div class="ht-head-actions">${actionsHtml}</div></div>`;
}

function csvCell(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsvRows(rows, name) {
  downloadBlob(new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }), name);
}

// A small, safe Markdown: everything is escaped first, then headings, lists, checkboxes, bold, italic,
// inline code, code blocks, quotes, tables and http(s) links are formatted.
function renderMarkdown(source) {
  const lines = escapeHtml(source || '').split('\n');
  const out = [];
  let list = null, code = false, table = null;
  const inline = (text) => text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeTable = () => { if (table) { out.push(`<table>${table.join('')}</table>`); table = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('```')) { closeList(); closeTable(); out.push(code ? '</code></pre>' : '<pre><code>'); code = !code; continue; }
    if (code) { out.push(line + '\n'); continue; }
    const tableRow = /^\|(.+)\|$/.exec(line);
    if (tableRow) {
      closeList();
      if (/^\|?\s*:?-{2,}/.test(line.replace(/\|/g, '|'))) continue;     // the |---|---| line
      const cells = tableRow[1].split('|').map(c => inline(c.trim()));
      if (!table) { table = [`<tr>${cells.map(c => `<th>${c}</th>`).join('')}</tr>`]; } else { table.push(`<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`); }
      continue;
    }
    closeTable();
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { closeList(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); continue; }
    if ((m = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line))) {
      if (list !== 'ul') { closeList(); out.push('<ul class="is-check">'); list = 'ul'; }
      out.push(`<li class="${m[1] === ' ' ? '' : 'is-done'}">${msIcon(m[1] === ' ' ? 'check_box_outline_blank' : 'check_box')}<span>${inline(m[2])}</span></li>`);
      continue;
    }
    if ((m = /^[-*]\s+(.*)$/.exec(line))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^&gt;\s?(.*)$/.exec(line))) { closeList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    closeList();
    if (line.trim() === '') { out.push(''); continue; }
    if (/^-{3,}$/.test(line.trim())) { out.push('<hr>'); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeTable();
  if (code) out.push('</code></pre>');
  return out.join('\n');
}
