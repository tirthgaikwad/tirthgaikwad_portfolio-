// ==========================================
// STUDY-PLANNER.JS — My Study, Planner tab: assignments, practicals and exams with their dates.
// Deadlines from College Hub are listed too; those are changed on College Hub, not here.
// Loaded after study.js.
// ==========================================

const TASK_KINDS = [['assignment', 'Assignment'], ['practical', 'Practical'], ['exam', 'Exam'], ['other', 'Other']];
const TASK_ICONS = { assignment: 'assignment', practical: 'science', exam: 'quiz', other: 'push_pin' };
const HUB_ICONS = { work: 'upload_file', group: 'group_add', checkin: 'edit_note', ack: 'mark_email_read', poll: 'how_to_vote' };

function taskFields(task) {
  const t = task || { kind: 'assignment' };
  return [
    { name: 'title', label: 'What is it', value: t.title, required: true, maxlength: 140, placeholder: 'OS assignment 3' },
    { name: 'kind', label: 'Type', type: 'select', options: TASK_KINDS, value: t.kind, half: true },
    { name: 'subject_id', label: 'Subject', type: 'select', options: subjectOptions('No subject'), value: t.subject_id || '', half: true },
    { name: 'due_date', label: 'Date', type: 'date', value: t.due_date, half: true },
    { name: 'due_time', label: 'Time (optional)', type: 'time', value: t.due_time, half: true },
    { name: 'notes', label: 'Notes', type: 'textarea', value: t.notes, maxlength: 1000, placeholder: 'Chapters, page numbers, where to submit' }
  ];
}

const taskBody = (values, task) => ({ ...values, subject_id: values.subject_id ? Number(values.subject_id) : null, done: task ? task.done : false });

studyActions['add-task'] = () => openSheet({
  title: 'Add to planner', fields: taskFields(), submitLabel: 'Add',
  onSubmit: async (values) => {
    study.tasks.push(await api('/api/study/tasks', { method: 'POST', body: taskBody(values) }));
    storeStudy(); renderStudy();
  }
});

studyActions['edit-task'] = (button) => {
  const task = study.tasks.find(entry => entry.id === Number(button.dataset.id));
  if (!task) return;
  openSheet({
    title: 'Edit', fields: taskFields(task),
    onSubmit: async (values) => {
      Object.assign(task, await api(`/api/study/tasks/${task.id}`, { method: 'PUT', body: taskBody(values, task) }));
      storeStudy(); renderStudy();
    },
    onDelete: async () => {
      await api(`/api/study/tasks/${task.id}`, { method: 'DELETE' });
      study.tasks = study.tasks.filter(entry => entry.id !== task.id);
      storeStudy(); renderStudy();
    }
  });
};

// Ticking the box: shown at once, put back if the server refuses
studyChanges['task-done'] = async (input) => {
  const task = study.tasks.find(entry => entry.id === Number(input.dataset.id));
  if (!task) return;
  task.done = input.checked;
  renderStudy();
  try {
    Object.assign(task, await api(`/api/study/tasks/${task.id}`, { method: 'PUT', body: {
      title: task.title, kind: task.kind, subject_id: task.subject_id, due_date: task.due_date, due_time: task.due_time, notes: task.notes, done: task.done } }));
    storeStudy();
  } catch (err) {
    task.done = !task.done;
    showToast(err.message);
  }
  renderStudy();
};

studyActions['plan-filter'] = (button) => { studyView.planFilter = button.dataset.filter; renderStudy(); };
studyActions['toggle-done'] = () => { studyView.showDone = !studyView.showDone; renderStudy(); };

function taskRowHtml(task) {
  const subject = task.subject_id ? subjectOf(task.subject_id) : null;
  const late = !task.done && task.due_date && daysUntil(task.due_date) < 0;
  const soon = !task.done && task.due_date && daysUntil(task.due_date) <= 1;
  const facts = [TASK_KINDS.find(([kind]) => kind === task.kind)[1], subject ? subject.name : '', task.due_time ? clock(task.due_time) : ''].filter(Boolean).join(' · ');
  return `
    <div class="hm-row st-task${late || soon ? ' is-urgent' : ''}${task.done ? ' is-done' : ''}">
      <input type="checkbox" class="st-tick" data-change="task-done" data-id="${task.id}" ${task.done ? 'checked' : ''} aria-label="Done: ${escapeHtml(task.title)}"/>
      <button type="button" class="hm-row-text st-task-open" data-act="edit-task" data-id="${task.id}"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(facts)}</small></button>
      ${task.due_date && !task.done ? `<span class="hm-due">${escapeHtml(dueText(task.due_date))}</span>` : ''}
    </div>`;
}

function hubRowHtml(item) {
  return `
    <a class="hm-row${item.urgent ? ' is-urgent' : ''}" href="${escapeHtml(item.link)}">
      <span class="hm-icon">${icon(HUB_ICONS[item.kind] || 'school')}</span>
      <span class="hm-row-text"><strong>${escapeHtml(item.title)}</strong><small>College Hub${item.detail ? ` · ${escapeHtml(item.detail)}` : ''}</small></span>
      ${item.due ? `<span class="hm-due">${escapeHtml(dueText(item.due))}</span>` : ''}
    </a>`;
}

studyRender.planner = () => {
  const filter = studyView.planFilter;
  const wanted = (task) => filter === 'all' || task.kind === filter || (filter === 'assignment' && task.kind === 'practical');
  const open = study.tasks.filter(task => !task.done && wanted(task));
  const done = study.tasks.filter(task => task.done && wanted(task)).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
  const groups = [
    ['Overdue', open.filter(task => task.due_date && daysUntil(task.due_date) < 0)],
    ['Today', open.filter(task => task.due_date && daysUntil(task.due_date) === 0)],
    ['Tomorrow', open.filter(task => task.due_date && daysUntil(task.due_date) === 1)],
    ['This week', open.filter(task => task.due_date && daysUntil(task.due_date) > 1 && daysUntil(task.due_date) <= 7)],
    ['Later', open.filter(task => task.due_date && daysUntil(task.due_date) > 7)],
    ['No date', open.filter(task => !task.due_date)]
  ].filter(([, tasks]) => tasks.length);
  groups.forEach(([, tasks]) => tasks.sort((a, b) => (a.due_date + a.due_time).localeCompare(b.due_date + b.due_time)));
  const filters = [['all', 'Everything'], ['assignment', 'Assignments'], ['exam', 'Exams']].map(([value, label]) =>
    `<button type="button" class="st-chip" data-act="plan-filter" data-filter="${value}" aria-pressed="${filter === value}">${label}</button>`).join('');
  const hub = filter === 'exam' ? [] : study.hub_deadlines;

  const body = groups.length || hub.length
    ? groups.map(([title, tasks]) => `<h3 class="st-group">${title}<span>${tasks.length}</span></h3><div class="hm-list">${tasks.map(taskRowHtml).join('')}</div>`).join('')
      + (hub.length ? `<h3 class="st-group">From College Hub<span>${hub.length}</span></h3><div class="hm-list">${hub.map(hubRowHtml).join('')}</div>` : '')
    : emptyHtml('checklist', filter === 'all' ? 'Nothing to do' : 'Nothing here', 'Add assignments, practicals and exams with their dates. You get a reminder the evening before.',
        `<button class="hm-btn" type="button" data-act="add-task">${icon('add')}Add work or an exam</button>`);
  return `
    <section class="hm-card">
      <div class="hm-head"><h2>Planner${open.length ? `<span class="hm-count">${open.length}</span>` : ''}</h2><button class="hm-btn" type="button" data-act="add-task">${icon('add')}Add</button></div>
      <div class="st-chips">${filters}</div>
      ${body}
      ${done.length ? `<button type="button" class="st-fold" data-act="toggle-done" aria-expanded="${studyView.showDone}">${icon(studyView.showDone ? 'expand_less' : 'expand_more')}Done (${done.length})</button>
        ${studyView.showDone ? `<div class="hm-list">${done.slice(0, 50).map(taskRowHtml).join('')}</div>` : ''}` : ''}
    </section>`;
};
