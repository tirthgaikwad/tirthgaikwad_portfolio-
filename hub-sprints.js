// ==========================================
// HUB-SPRINTS.JS — Sprints and the backlog. A sprint is a short stretch (often one or two weeks) with a goal;
// the backlog holds everything not planned yet. Drag tasks between them. Finishing a sprint moves what is
// not done to the next sprint or back to the backlog. Finished sprints stay listed with their numbers.
// ==========================================

let sprintDragId = null;

function sprintTasks(sprintId) {
  return hub.tasks.filter(t => (sprintId === null ? !t.sprint_id || !hub.sprints.some(s => s.id === t.sprint_id) : t.sprint_id === sprintId));
}

function sprintStats(sprint) {
  const tasks = sprintTasks(sprint.id);
  const done = tasks.filter(t => t.column === 'done');
  const hours = tasks.reduce((sum, t) => sum + (t.estimate_hours || 0), 0);
  const doneHours = done.reduce((sum, t) => sum + (t.estimate_hours || 0), 0);
  return { tasks, done, hours, doneHours };
}

function sprintTaskRow(t) {
  return `<li class="ht-sprint-task${t.column === 'done' ? ' is-done' : ''}" draggable="true" data-drag-task="${t.id}">
    ${msIcon('drag_indicator', 'ht-grip')}
    <span class="ht-chip is-${t.column}">${escapeHtml(HUB_COLUMNS.find(c => c.id === t.column)?.name || '')}</span>
    <button type="button" class="ht-link" data-open="${t.id}">${t.is_milestone ? msIcon('flag', 'ht-ico-milestone') : ''}${escapeHtml(t.title)}</button>
    <span class="ht-grow"></span>
    ${t.estimate_hours ? `<span class="ht-muted">${t.estimate_hours} h</span>` : ''}
    ${t.due_date ? `<span class="ht-muted${t.column !== 'done' && t.due_date < todayIso() ? ' is-late' : ''}">${escapeHtml(dayLabel(t.due_date))}</span>` : ''}
    ${t.assignee_id ? avatarOf(t.assignee_id) : ''}
  </li>`;
}

function sprintCardHtml(sprint) {
  const { tasks, done, hours, doneHours } = sprintStats(sprint);
  const today = todayIso();
  const daysLeft = sprint.end_date ? daysBetween(today, sprint.end_date) : null;
  const pct = tasks.length ? Math.round(100 * done.length / tasks.length) : 0;
  const status = sprint.status === 'active' ? `<span class="ht-chip is-inprogress">Running${daysLeft !== null ? ` · ${daysLeft >= 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : `${-daysLeft} day${daysLeft === -1 ? '' : 's'} over`}` : ''}</span>`
    : sprint.status === 'done' ? '<span class="ht-chip is-done">Finished</span>' : '<span class="ht-chip">Planned</span>';
  return `<section class="ht-card ht-sprint${sprint.status === 'active' ? ' is-active' : ''}" data-sprint-drop="${sprint.id}">
    <div class="ht-sprint-head">
      <div><h3>${escapeHtml(sprint.name)} ${status}</h3>
        <p class="ht-muted">${sprint.start_date ? `${escapeHtml(dayLabel(sprint.start_date, true))} – ${escapeHtml(dayLabel(sprint.end_date, true))}` : 'No dates yet'}</p>
        ${sprint.goal ? `<p class="ht-sprint-goal">${msIcon('target')}${escapeHtml(sprint.goal)}</p>` : ''}</div>
      <div class="ht-head-actions">
        ${sprint.status === 'planned' ? `<button type="button" class="ht-btn" data-sprint="start" data-id="${sprint.id}">${msIcon('play_arrow')}Start</button>` : ''}
        ${sprint.status === 'active' ? `<button type="button" class="ht-btn" data-sprint="complete" data-id="${sprint.id}">${msIcon('flag_circle')}Finish sprint</button>` : ''}
        ${sprint.status !== 'done' ? `<button type="button" class="ht-icon-btn" data-sprint="edit" data-id="${sprint.id}" title="Edit sprint">${msIcon('edit')}</button>` : ''}
        ${hubIsAdmin() ? `<button type="button" class="ht-icon-btn" data-sprint="delete" data-id="${sprint.id}" title="Delete sprint">${msIcon('delete')}</button>` : ''}
      </div>
    </div>
    <div class="ht-sprint-stats">
      <span><strong>${done.length}/${tasks.length}</strong> tasks done</span>
      ${hours ? `<span><strong>${doneHours}/${hours} h</strong> of estimates</span>` : ''}
      <div class="ht-progress"><i style="width:${pct}%"></i></div>
    </div>
    <ul class="ht-sprint-list">${tasks.map(sprintTaskRow).join('') || `<li class="ht-drop-hint">Drag tasks here from the backlog.</li>`}</ul>
  </section>`;
}

function renderSprints() {
  const view = el('view-sprints');
  const sprints = hub.sprints.slice().sort((a, b) => (a.start_date || '9').localeCompare(b.start_date || '9') || a.id - b.id);
  const open = sprints.filter(s => s.status !== 'done');
  const finished = sprints.filter(s => s.status === 'done').reverse();
  const backlog = sprintTasks(null).filter(t => t.column !== 'done');
  const backlogHours = backlog.reduce((sum, t) => sum + (t.estimate_hours || 0), 0);

  view.innerHTML = `
    ${toolHead('Sprints & backlog', 'Plan in short stretches. Drag tasks from the backlog into a sprint.',
      `<button type="button" class="ht-btn" data-sprint="new">${msIcon('add')}New sprint</button>`)}
    <div class="ht-sprints-layout">
      <div class="ht-sprints-col">
        ${open.map(sprintCardHtml).join('') || toolEmpty('sprint', 'No sprints yet', 'A sprint is a short stretch of work with a goal, like two weeks to finish the login screens.',
          `<button type="button" class="ht-btn" data-sprint="new">${msIcon('add')}Plan the first sprint</button>`)}
        ${finished.length ? `<details class="ht-card ht-finished"><summary>${msIcon('history')}Finished sprints <small>${finished.length}</small></summary>
          ${finished.map(s => { const st = sprintStats(s); return `<div class="ht-finished-row"><strong>${escapeHtml(s.name)}</strong>
            <span class="ht-muted">${escapeHtml(dayLabel(s.start_date, true))} – ${escapeHtml(dayLabel(s.end_date, true))}</span><span>${st.done.length}/${st.tasks.length} done</span>
            ${s.goal ? `<span class="ht-muted">${escapeHtml(s.goal)}</span>` : ''}</div>`; }).join('')}</details>` : ''}
      </div>
      <section class="ht-card ht-backlog" data-sprint-drop="backlog">
        <div class="ht-sprint-head"><div><h3>${msIcon('inventory_2')}Backlog</h3><p class="ht-muted">${backlog.length} task${backlog.length === 1 ? '' : 's'}${backlogHours ? ` · ${backlogHours} h estimated` : ''}</p></div>
          <button type="button" class="ht-btn is-quiet" data-sprint="newtask">${msIcon('add')}Task</button></div>
        <ul class="ht-sprint-list">${backlog.map(sprintTaskRow).join('') || '<li class="ht-drop-hint">The backlog is empty.</li>'}</ul>
      </section>
    </div>`;
}

function sprintSheet(sprint) {
  const last = hub.sprints.filter(s => s.end_date).map(s => s.end_date).sort().slice(-1)[0];
  const start = sprint ? sprint.start_date : (last && last >= todayIso() ? addDays(last, 1) : todayIso());
  openSheet({
    title: sprint ? 'Edit sprint' : 'New sprint',
    fields: [
      { name: 'name', label: 'Name', required: true, maxlength: 60, value: sprint ? sprint.name : `Sprint ${hub.sprints.length + 1}` },
      { name: 'goal', label: 'Goal', type: 'textarea', maxlength: 300, value: sprint ? sprint.goal : '', placeholder: 'What should be true at the end of it?' },
      { name: 'start_date', label: 'Starts', type: 'date', half: true, value: start },
      { name: 'end_date', label: 'Ends', type: 'date', half: true, value: sprint ? sprint.end_date : addDays(start, 13) },
    ],
    submitLabel: sprint ? 'Save' : 'Create',
    onSubmit: async (v) => {
      const saved = sprint ? await api(`/api/sprints/${sprint.id}`, { method: 'PATCH', body: v }) : await api(`/api/teams/${hubTeamId}/sprints`, { method: 'POST', body: v });
      upsertById(hub.sprints, saved);
      saveHubCache();
      renderActiveTool();
    },
  });
}

function completeSprintSheet(sprint) {
  const left = sprintTasks(sprint.id).filter(t => t.column !== 'done');
  const next = hub.sprints.filter(s => s.status === 'planned').sort((a, b) => (a.start_date || '9').localeCompare(b.start_date || '9'));
  openSheet({
    title: `Finish ${sprint.name}`,
    note: left.length ? `${left.length} task${left.length === 1 ? ' is' : 's are'} not done. Where should ${left.length === 1 ? 'it' : 'they'} go?` : 'Everything in this sprint is done. Well done!',
    fields: left.length ? [{ name: 'move_to', label: 'Move unfinished tasks to', type: 'select',
      options: next.map(s => [String(s.id), s.name]).concat([['', 'The backlog']]), value: next[0] ? String(next[0].id) : '' }] : [],
    submitLabel: 'Finish sprint',
    onSubmit: async (v) => {
      const result = await api(`/api/sprints/${sprint.id}/complete`, { method: 'POST', body: { move_to: v.move_to ? parseInt(v.move_to, 10) : null } });
      upsertById(hub.sprints, result.sprint);
      await refreshHubBoard(hubTeamId);
      showToast(result.moved ? `${result.moved} unfinished task${result.moved === 1 ? '' : 's'} moved.` : 'Sprint finished.');
    },
  });
}

function initSprintEvents() {
  const view = el('view-sprints');
  view.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return openTaskDrawer(parseInt(open.dataset.open, 10));
    const act = e.target.closest('[data-sprint]');
    if (!act) return;
    const sprint = hub.sprints.find(s => s.id === parseInt(act.dataset.id, 10));
    switch (act.dataset.sprint) {
      case 'new': return sprintSheet(null);
      case 'newtask': return newTaskSheet();
      case 'edit': return sprintSheet(sprint);
      case 'complete': return completeSprintSheet(sprint);
      case 'start':
        try {
          const saved = await api(`/api/sprints/${sprint.id}`, { method: 'PATCH', body: { status: 'active' } });
          upsertById(hub.sprints, saved);
          saveHubCache();
          renderSprints();
        } catch (err) { showToast(err.message); }
        return;
      case 'delete':
        return hubConfirm('Delete sprint?', `“${escapeHtml(sprint.name)}” will be deleted. Its tasks go back to the backlog.`, 'Delete', async () => {
          try {
            await api(`/api/sprints/${sprint.id}`, { method: 'DELETE' });
            hub.sprints = hub.sprints.filter(s => s.id !== sprint.id);
            await refreshHubBoard(hubTeamId);
          } catch (err) { showToast(err.message); }
        });
    }
  });
  view.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-drag-task]');
    if (!row) return;
    sprintDragId = parseInt(row.dataset.dragTask, 10);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(sprintDragId));
    row.classList.add('is-dragging');
  });
  view.addEventListener('dragend', () => {
    sprintDragId = null;
    view.querySelectorAll('.is-dragging, .is-drop').forEach(n => n.classList.remove('is-dragging', 'is-drop'));
  });
  view.addEventListener('dragover', (e) => {
    const target = e.target.closest('[data-sprint-drop]');
    if (!target || sprintDragId === null) return;
    e.preventDefault();
    view.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop'));
    target.classList.add('is-drop');
  });
  view.addEventListener('drop', async (e) => {
    const target = e.target.closest('[data-sprint-drop]');
    if (!target || sprintDragId === null) return;
    e.preventDefault();
    const task = taskById(sprintDragId);
    sprintDragId = null;
    if (!task) return;
    const where = target.dataset.sprintDrop;
    if (where === 'backlog' ? !task.sprint_id : task.sprint_id === parseInt(where, 10)) return renderSprints();
    await patchTask(task.id, where === 'backlog' ? { to_backlog: true } : { sprint_id: parseInt(where, 10) });
  });
}

registerHubTool('sprints', { render: renderSprints });
document.addEventListener('DOMContentLoaded', initSprintEvents);
