// ==========================================
// HUB-VIEWS.JS — Two more ways to see the same tasks: a sortable List (with bulk editing and CSV export)
// and a month Calendar of due dates (drag a task to another day; unscheduled tasks wait on the side).
// ==========================================

// ==========================================
// 1. LIST
// ==========================================
const listState = { sort: 'due_date', dir: 1, q: '', status: '', assignee: '', sprint: '', showDone: true, selected: new Set() };
const LIST_COLUMNS = [
  ['title', 'Task'], ['column', 'Status'], ['assignee', 'Assignee'], ['priority', 'Priority'], ['sprint', 'Sprint'],
  ['start_date', 'Start'], ['due_date', 'Due'], ['estimate_hours', 'Est.'], ['tag', 'Tag'],
];

function sprintName(id) {
  const sprint = hub.sprints.find(s => s.id === id);
  return sprint ? sprint.name : 'Backlog';
}

function listRows() {
  const q = listState.q.trim().toLowerCase();
  const rank = { todo: 0, inprogress: 1, review: 2, done: 3 };
  const key = {
    title: t => t.title.toLowerCase(), column: t => rank[t.column], assignee: t => (t.assignee_id ? memberName(t.assignee_id) : '~').toLowerCase(),
    priority: t => PRIORITY_RANK[t.priority], sprint: t => sprintName(t.sprint_id).toLowerCase(), start_date: t => t.start_date || '9999',
    due_date: t => t.due_date || '9999', estimate_hours: t => t.estimate_hours ?? 1e9, tag: t => (t.tag || '~').toLowerCase(),
  }[listState.sort];
  return hub.tasks
    .filter(t => listState.showDone || t.column !== 'done')
    .filter(t => !listState.status || t.column === listState.status)
    .filter(t => !listState.assignee || String(t.assignee_id || '') === listState.assignee)
    .filter(t => !listState.sprint || String(t.sprint_id || 'backlog') === listState.sprint)
    .filter(t => !q || [t.title, t.description, t.tag, t.assignee_id ? memberName(t.assignee_id) : ''].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id - b.id) * listState.dir);
}

function renderList() {
  const view = el('view-list');
  const rows = listRows();
  listState.selected = new Set([...listState.selected].filter(id => taskById(id)));
  const statusName = Object.fromEntries(HUB_COLUMNS.map(c => [c.id, c.name]));
  const option = (value, label, current) => `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  const focused = document.activeElement && document.activeElement.id === 'htListSearch';

  view.innerHTML = `
    ${toolHead('All tasks', `${rows.length} of ${hub.tasks.length} task${hub.tasks.length === 1 ? '' : 's'}`,
      `<button type="button" class="ht-btn is-quiet" data-list="csv">${msIcon('download')}CSV</button><button type="button" class="ht-btn" data-list="new">${msIcon('add')}New task</button>`)}
    <div class="ht-toolbar">
      <label class="ht-search">${msIcon('search')}<input id="htListSearch" type="search" placeholder="Search tasks" value="${escapeHtml(listState.q)}"></label>
      <select data-filter="status" aria-label="Status">${option('', 'Any status', listState.status)}${HUB_COLUMNS.map(c => option(c.id, c.name, listState.status)).join('')}</select>
      <select data-filter="assignee" aria-label="Assignee">${option('', 'Anyone', listState.assignee)}${hub.members.map(m => option(String(m.user_id), m.user_name, listState.assignee)).join('')}</select>
      <select data-filter="sprint" aria-label="Sprint">${option('', 'Any sprint', listState.sprint)}${option('backlog', 'Backlog', listState.sprint)}${hub.sprints.map(s => option(String(s.id), s.name, listState.sprint)).join('')}</select>
      <label class="ht-check"><input type="checkbox" data-filter="showDone" ${listState.showDone ? 'checked' : ''}> Show done</label>
    </div>
    ${listState.selected.size ? `<div class="ht-bulk" role="region" aria-label="Change the selected tasks">
      <strong>${listState.selected.size} selected</strong>
      <select data-bulk="column" aria-label="Move to"><option value="">Move to…</option>${HUB_COLUMNS.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
      <select data-bulk="assignee_id" aria-label="Assign to"><option value="">Assign to…</option><option value="none">Unassigned</option>${hub.members.map(m => `<option value="${m.user_id}">${escapeHtml(m.user_name)}</option>`).join('')}</select>
      <select data-bulk="sprint_id" aria-label="Sprint"><option value="">Sprint…</option><option value="backlog">Backlog</option>${hub.sprints.filter(s => s.status !== 'done').map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select>
      <select data-bulk="priority" aria-label="Priority"><option value="">Priority…</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      <button type="button" class="ht-btn is-quiet" data-list="clear">Clear</button>
    </div>` : ''}
    <div class="ht-table-wrap">
      <table class="ht-table">
        <thead><tr><th class="ht-col-check"><input type="checkbox" data-selectall aria-label="Select all" ${rows.length && rows.every(t => listState.selected.has(t.id)) ? 'checked' : ''}></th>
          ${LIST_COLUMNS.map(([key, label]) => `<th><button type="button" data-sort="${key}" class="${listState.sort === key ? 'is-sorted' : ''}">${escapeHtml(label)}${listState.sort === key ? msIcon(listState.dir > 0 ? 'arrow_upward' : 'arrow_downward') : ''}</button></th>`).join('')}</tr></thead>
        <tbody>${rows.map(t => `
          <tr data-row="${t.id}" class="${t.column === 'done' ? 'is-done' : ''}">
            <td class="ht-col-check"><input type="checkbox" data-select="${t.id}" ${listState.selected.has(t.id) ? 'checked' : ''} aria-label="Select ${escapeHtml(t.title)}"></td>
            <td class="ht-col-title"><button type="button" class="ht-link" data-open="${t.id}">${t.is_milestone ? msIcon('flag', 'ht-ico-milestone') : ''}${escapeHtml(t.title)}</button>${taskBadgesHtml({ ...t, is_milestone: false })}</td>
            <td><span class="ht-chip is-${t.column}">${escapeHtml(statusName[t.column])}</span></td>
            <td>${t.assignee_id ? `<span class="ht-person">${avatarOf(t.assignee_id)}${escapeHtml(memberName(t.assignee_id))}</span>` : '<span class="ht-muted">—</span>'}</td>
            <td><span class="ht-prio is-${t.priority}">${escapeHtml(t.priority)}</span></td>
            <td>${escapeHtml(sprintName(t.sprint_id))}</td>
            <td>${escapeHtml(dayLabel(t.start_date))}</td>
            <td class="${t.due_date && t.column !== 'done' && t.due_date < todayIso() ? 'is-late' : ''}">${escapeHtml(dayLabel(t.due_date))}</td>
            <td>${t.estimate_hours ?? ''}</td>
            <td>${escapeHtml(t.tag || '')}</td>
          </tr>`).join('') || `<tr><td colspan="${LIST_COLUMNS.length + 1}" class="ht-muted ht-center">No tasks match.</td></tr>`}</tbody>
      </table>
    </div>`;
  if (focused) { const box = el('htListSearch'); box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
}

function initListEvents() {
  const view = el('view-list');
  view.addEventListener('input', (e) => {
    if (e.target.id === 'htListSearch') { listState.q = e.target.value; renderList(); }
  });
  view.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.filter) {
      listState[t.dataset.filter] = t.type === 'checkbox' ? t.checked : t.value;
      return renderList();
    }
    if (t.dataset.select) {
      const id = parseInt(t.dataset.select, 10);
      if (t.checked) listState.selected.add(id); else listState.selected.delete(id);
      return renderList();
    }
    if (t.dataset.selectall !== undefined) {
      listRows().forEach(task => { if (t.checked) listState.selected.add(task.id); else listState.selected.delete(task.id); });
      return renderList();
    }
    if (t.dataset.bulk && t.value) {
      const field = t.dataset.bulk, value = t.value;
      const ids = [...listState.selected];
      const body = field === 'assignee_id' ? (value === 'none' ? { clear_assignee: true } : { assignee_id: parseInt(value, 10) })
        : field === 'sprint_id' ? (value === 'backlog' ? { to_backlog: true } : { sprint_id: parseInt(value, 10) })
        : { [field]: value };
      t.disabled = true;
      for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(id => patchTask(id, body)));
      showToast(`Updated ${ids.length} task${ids.length === 1 ? '' : 's'}.`);
      renderList();
    }
  });
  view.addEventListener('click', (e) => {
    const t = e.target;
    const sort = t.closest('[data-sort]');
    if (sort) {
      if (listState.sort === sort.dataset.sort) listState.dir *= -1; else { listState.sort = sort.dataset.sort; listState.dir = 1; }
      return renderList();
    }
    const open = t.closest('[data-open]');
    if (open) return openTaskDrawer(parseInt(open.dataset.open, 10));
    const action = t.closest('[data-list]');
    if (action) {
      if (action.dataset.list === 'new') return newTaskSheet();
      if (action.dataset.list === 'clear') { listState.selected.clear(); return renderList(); }
      if (action.dataset.list === 'csv') return exportListCsv();
    }
    const row = t.closest('tr[data-row]');
    if (row && !t.closest('input, button, a')) openTaskDrawer(parseInt(row.dataset.row, 10));
  });
}

function exportListCsv() {
  const statusName = Object.fromEntries(HUB_COLUMNS.map(c => [c.id, c.name]));
  const rows = [['Task', 'Status', 'Assignee', 'Priority', 'Sprint', 'Start', 'Due', 'Estimate (h)', 'Tag', 'Milestone', 'Waits for', 'Checklist']];
  listRows().forEach(t => rows.push([t.title, statusName[t.column], t.assignee_id ? memberName(t.assignee_id) : '', t.priority, sprintName(t.sprint_id),
    t.start_date, t.due_date, t.estimate_hours ?? '', t.tag, t.is_milestone ? 'yes' : '', (t.depends_on || []).map(id => taskById(id)?.title || '').join('; '),
    (t.checklist || []).length ? `${t.checklist.filter(c => c.done).length}/${t.checklist.length}` : '']));
  downloadCsvRows(rows, `${safeFileName(hub.board.name)}-tasks.csv`);
}

registerHubTool('list', { render: renderList });

// ==========================================
// 2. CALENDAR
// ==========================================
const calState = { month: todayIso().slice(0, 7) };
let calDragId = null;

function renderCalendar() {
  const view = el('view-calendar');
  const [year, month] = calState.month.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;                // weeks start on Monday
  const gridStart = dayIso(new Date(year, month - 1, 1 - startOffset));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = todayIso();
  const byDay = {};
  hub.tasks.filter(t => t.due_date).forEach(t => { (byDay[t.due_date] = byDay[t.due_date] || []).push(t); });
  const sprintStarts = {};
  hub.sprints.forEach(s => { if (s.start_date) (sprintStarts[s.start_date] = sprintStarts[s.start_date] || []).push(s); });
  const unscheduled = hub.tasks.filter(t => !t.due_date && t.column !== 'done');
  const monthName = first.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const chip = (t) => `<button type="button" class="ht-cal-task is-${t.column}${t.is_milestone ? ' is-milestone' : ''}" draggable="true" data-open="${t.id}" data-drag="${t.id}" title="${escapeHtml(t.title)}">${t.is_milestone ? msIcon('flag') : ''}<span>${escapeHtml(t.title)}</span></button>`;

  view.innerHTML = `
    ${toolHead(monthName, 'Tasks by due date. Drag a task to another day to move it.',
      `<button type="button" class="ht-icon-btn" data-cal="-1" title="Previous month">${msIcon('chevron_left')}</button>
       <button type="button" class="ht-btn is-quiet" data-cal="today">Today</button>
       <button type="button" class="ht-icon-btn" data-cal="1" title="Next month">${msIcon('chevron_right')}</button>`)}
    <div class="ht-cal-layout">
      <div class="ht-cal">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="ht-cal-dow">${d}</div>`).join('')}
        ${days.map(day => `
          <div class="ht-cal-day${day.slice(0, 7) !== calState.month ? ' is-other' : ''}${day === today ? ' is-today' : ''}" data-day="${day}">
            <div class="ht-cal-date"><span>${dayDate(day).getDate()}</span><button type="button" class="ht-icon-btn is-small" data-add="${day}" title="Add a task due this day">${msIcon('add')}</button></div>
            ${(sprintStarts[day] || []).map(s => `<span class="ht-cal-sprint">${msIcon('sprint')}${escapeHtml(s.name)}</span>`).join('')}
            ${(byDay[day] || []).map(chip).join('')}
          </div>`).join('')}
      </div>
      <aside class="ht-cal-side" data-day="">
        <h4>${msIcon('event_busy')}No due date <small>${unscheduled.length}</small></h4>
        <p class="ht-muted">Drag onto a day to schedule.</p>
        ${unscheduled.map(chip).join('') || '<p class="ht-muted">Everything has a date.</p>'}
      </aside>
    </div>
    <div class="ht-agenda">${agendaHtml(byDay, today)}</div>`;
}

// Phones get a list of the coming weeks instead of a grid
function agendaHtml(byDay, today) {
  const days = Object.keys(byDay).filter(d => d.slice(0, 7) === calState.month).sort();
  if (!days.length) return '<p class="ht-muted">Nothing is due this month.</p>';
  return days.map(day => `<div class="ht-agenda-day${day < today ? ' is-past' : ''}"><h4>${escapeHtml(dayDate(day).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}</h4>
    ${byDay[day].map(t => `<button type="button" class="ht-cal-task is-${t.column}" data-open="${t.id}">${t.is_milestone ? msIcon('flag') : ''}<span>${escapeHtml(t.title)}</span></button>`).join('')}</div>`).join('');
}

function initCalendarEvents() {
  const view = el('view-calendar');
  view.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-cal]');
    if (nav) {
      if (nav.dataset.cal === 'today') calState.month = todayIso().slice(0, 7);
      else { const d = dayDate(`${calState.month}-01`); d.setMonth(d.getMonth() + parseInt(nav.dataset.cal, 10)); calState.month = dayIso(d).slice(0, 7); }
      return renderCalendar();
    }
    const add = e.target.closest('[data-add]');
    if (add) return newTaskSheet({ due_date: add.dataset.add });
    const open = e.target.closest('[data-open]');
    if (open) return openTaskDrawer(parseInt(open.dataset.open, 10));
  });
  view.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('[data-drag]');
    if (!chip) return;
    calDragId = parseInt(chip.dataset.drag, 10);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(calDragId));
  });
  view.addEventListener('dragover', (e) => {
    const day = e.target.closest('[data-day]');
    if (!day || calDragId === null) return;
    e.preventDefault();
    view.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop'));
    day.classList.add('is-drop');
  });
  view.addEventListener('dragend', () => { calDragId = null; view.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop')); });
  view.addEventListener('drop', async (e) => {
    const day = e.target.closest('[data-day]');
    if (!day || calDragId === null) return;
    e.preventDefault();
    const task = taskById(calDragId);
    calDragId = null;
    if (!task) return;
    const due = day.dataset.day;
    if (due === (task.due_date || '')) return renderCalendar();
    const body = { due_date: due };
    // Moving a task keeps its length: the start moves by the same number of days
    if (task.start_date && task.due_date && due) body.start_date = addDays(task.start_date, daysBetween(task.due_date, due));
    else if (task.start_date && due && task.start_date > due) body.start_date = due;
    if (!due) body.start_date = '';
    await patchTask(task.id, body);
  });
}

registerHubTool('calendar', { render: renderCalendar });

document.addEventListener('DOMContentLoaded', () => { initListEvents(); initCalendarEvents(); });
