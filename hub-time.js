// ==========================================
// HUB-TIME.JS — Time tracking. Start a timer on a task (one at a time per person; starting another stops it),
// or log hours by hand. The running timer shows in the hub header. The Time tab totals hours per person,
// per task and per day of the week, and exports them.
// ==========================================

const timeState = { week: null, person: '' };
let timerTick = null;

function myRunningTimer() {
  return (hub && hub.time ? hub.time : []).find(e => e.user_id === currentUserId && !e.ended_at) || null;
}

function timerElapsed(entry) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(entry.started_at).getTime()) / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

async function startTimer(taskId) {
  try {
    const result = await api(`/api/teams/${hubTeamId}/time/start`, { method: 'POST', body: { task_id: taskId || null } });
    if (result.stopped) upsertById(hub.time, result.stopped);
    upsertById(hub.time, result.running);
    saveHubCache();
    paintTimerChip();
    renderActiveTool();
    if (typeof paintDrawer === 'function') paintDrawer();
  } catch (err) { showToast(err.message); }
}

async function stopTimer() {
  try {
    const result = await api('/api/time/stop', { method: 'POST' });
    if (result.stopped) {
      upsertById(hub.time, result.stopped);
      showToast(`Logged ${minutesLabel(result.stopped.minutes)}.`);
    }
    saveHubCache();
    paintTimerChip();
    renderActiveTool();
    if (typeof paintDrawer === 'function') paintDrawer();
  } catch (err) { showToast(err.message); }
}

function logTimeSheet(taskId) {
  openSheet({
    title: 'Log time',
    fields: [
      { name: 'task_id', label: 'Task', type: 'select', options: [['', 'No particular task']].concat(hub.tasks.map(t => [String(t.id), t.title])), value: taskId ? String(taskId) : '' },
      { name: 'hours', label: 'Hours', type: 'number', min: 0, max: 24, step: 1, half: true, value: 1 },
      { name: 'minutes', label: 'Minutes', type: 'number', min: 0, max: 59, step: 5, half: true, value: 0 },
      { name: 'day', label: 'Day', type: 'date', value: todayIso() },
      { name: 'note', label: 'What you did', maxlength: 200 },
    ],
    submitLabel: 'Log',
    onSubmit: async (v) => {
      const minutes = Math.round((v.hours || 0) * 60 + (v.minutes || 0));
      if (minutes < 1) throw new Error('Enter some time.');
      const entry = await api(`/api/teams/${hubTeamId}/time`, { method: 'POST', body: { task_id: v.task_id ? parseInt(v.task_id, 10) : null, minutes, day: v.day, note: v.note } });
      upsertById(hub.time, entry);
      saveHubCache();
      renderActiveTool();
      if (typeof paintDrawer === 'function') paintDrawer();
    },
  });
}

// ---------- the chip in the header ----------
function paintTimerChip() {
  let chip = document.getElementById('htTimerChip');
  const here = document.getElementById('hub-here');
  if (!chip && here) {
    here.insertAdjacentHTML('beforebegin', '<button type="button" class="ht-timer-chip" id="htTimerChip" hidden></button>');
    chip = document.getElementById('htTimerChip');
    chip.addEventListener('click', (e) => {
      if (e.target.closest('[data-stop]')) return stopTimer();
      const running = myRunningTimer();
      if (running && running.task_id) openTaskDrawer(running.task_id); else switchHubTab('time');
    });
  }
  if (!chip) return;
  const running = myRunningTimer();
  chip.hidden = !running;
  clearInterval(timerTick);
  timerTick = null;
  if (!running) return;
  const task = running.task_id ? taskById(running.task_id) : null;
  const draw = () => {
    chip.innerHTML = `${msIcon('timer')}<span class="ht-timer-text">${escapeHtml(task ? task.title : 'Working')}</span><strong>${timerElapsed(running)}</strong><span class="ht-timer-stop" data-stop title="Stop the timer">${msIcon('stop_circle')}</span>`;
  };
  draw();
  timerTick = setInterval(() => {
    draw();
    const inDrawer = document.querySelector('#htDrawer [data-act="stop-timer"]');
    if (inDrawer) inDrawer.lastChild.textContent = `Stop · ${timerElapsed(running)}`;
  }, 1000);
}

// ---------- the Time tab ----------
function weekStart(iso) {
  const d = dayDate(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

function renderTime() {
  const view = el('view-time');
  const week = timeState.week || weekStart(todayIso());
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const entries = (hub.time || []).filter(e => e.ended_at && (!timeState.person || String(e.user_id) === timeState.person));
  const inWeek = entries.filter(e => e.day >= days[0] && e.day <= days[6]);
  const total = (list) => list.reduce((sum, e) => sum + (e.minutes || 0), 0);
  const people = hub.members.filter(m => !timeState.person || String(m.user_id) === timeState.person);
  const byTask = {};
  entries.forEach(e => { const k = e.task_id || 0; byTask[k] = (byTask[k] || 0) + (e.minutes || 0); });
  const topTasks = Object.entries(byTask).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const running = myRunningTimer();

  view.innerHTML = `
    ${toolHead('Time', 'Start a timer from any task, or log time by hand.', `
      <select data-timeperson aria-label="Person"><option value="">Everyone</option>${hub.members.map(m => `<option value="${m.user_id}" ${String(m.user_id) === timeState.person ? 'selected' : ''}>${escapeHtml(m.user_name)}</option>`).join('')}</select>
      <button type="button" class="ht-btn is-quiet" data-time="csv">${msIcon('download')}CSV</button>
      ${running ? `<button type="button" class="ht-btn is-danger" data-time="stop">${msIcon('stop_circle')}Stop timer</button>` : `<button type="button" class="ht-btn is-quiet" data-time="start">${msIcon('play_circle')}Start a timer</button>`}
      <button type="button" class="ht-btn" data-time="log">${msIcon('more_time')}Log time</button>`)}
    <div class="ht-tiles">
      <div class="ht-tile"><span class="ht-tile-label">This week</span><strong>${minutesLabel(total(inWeek))}</strong><small>${escapeHtml(dayLabel(days[0]))} – ${escapeHtml(dayLabel(days[6]))}</small></div>
      <div class="ht-tile"><span class="ht-tile-label">All time</span><strong>${minutesLabel(total(entries))}</strong><small>${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</small></div>
      <div class="ht-tile"><span class="ht-tile-label">Estimated, open tasks</span><strong>${hub.tasks.filter(t => t.column !== 'done').reduce((s, t) => s + (t.estimate_hours || 0), 0)} h</strong><small>still to do</small></div>
    </div>
    <section class="ht-card">
      <div class="ht-head"><h4>${msIcon('date_range')}Week by person</h4><div class="ht-head-actions">
        <button type="button" class="ht-icon-btn" data-week="-7" title="Previous week">${msIcon('chevron_left')}</button>
        <button type="button" class="ht-btn is-quiet is-small" data-week="0">This week</button>
        <button type="button" class="ht-icon-btn" data-week="7" title="Next week">${msIcon('chevron_right')}</button></div></div>
      <div class="ht-table-wrap"><table class="ht-table ht-week">
        <thead><tr><th>Person</th>${days.map(d => `<th class="${d === todayIso() ? 'is-today' : ''}">${escapeHtml(dayDate(d).toLocaleDateString([], { weekday: 'short', day: 'numeric' }))}</th>`).join('')}<th>Total</th></tr></thead>
        <tbody>${people.map(m => {
          const mine = inWeek.filter(e => e.user_id === m.user_id);
          return `<tr><td><span class="ht-person">${memberAvatarHtml(m, 'h-6 w-6', 'text-[9px]')}${escapeHtml(m.user_name)}</span></td>
            ${days.map(d => { const v = total(mine.filter(e => e.day === d)); return `<td class="${v ? 'has-time' : ''}">${v ? (v / 60).toFixed(1) : ''}</td>`; }).join('')}
            <th>${(total(mine) / 60).toFixed(1)}</th></tr>`; }).join('')}</tbody>
      </table></div>
      <p class="ht-muted">Hours, by the day they count for.</p>
    </section>
    <div class="ht-dash-grid">
      <section class="ht-card ht-dash-list"><h4>${msIcon('task')}Most time by task</h4>
        ${topTasks.length ? `<ul>${topTasks.map(([id, minutes]) => { const task = taskById(parseInt(id, 10)); const est = task && task.estimate_hours; return `<li>
          ${task ? `<button type="button" class="ht-link" data-open="${task.id}">${escapeHtml(task.title)}</button>` : '<span class="ht-muted">No particular task</span>'}
          <span class="ht-muted">${minutesLabel(minutes)}${est ? ` of ${est} h` : ''}</span>${est ? `<div class="ht-progress${minutes / 60 > est ? ' is-over' : ''}"><i style="width:${Math.min(100, Math.round(100 * minutes / 60 / est))}%"></i></div>` : ''}</li>`; }).join('')}</ul>` : '<p class="ht-muted">No time logged yet.</p>'}</section>
      <section class="ht-card ht-dash-list"><h4>${msIcon('history')}Latest entries</h4>
        ${entries.length ? `<ul>${entries.slice().sort((a, b) => (b.day + b.id).localeCompare(a.day + a.id)).slice(0, 15).map(e => `<li>
          <span>${avatarOf(e.user_id, 'h-5 w-5', 'text-[8px]')} <strong>${minutesLabel(e.minutes)}</strong> ${e.task_id && taskById(e.task_id) ? `on <button type="button" class="ht-link" data-open="${e.task_id}">${escapeHtml(taskById(e.task_id).title)}</button>` : ''}</span>
          <span class="ht-muted">${escapeHtml(dayLabel(e.day))}${e.note ? ` · ${escapeHtml(e.note)}` : ''}
          ${e.user_id === currentUserId ? `<button type="button" class="ht-icon-btn is-small" data-timedel="${e.id}" title="Delete">${msIcon('close')}</button>` : ''}</span></li>`).join('')}</ul>` : '<p class="ht-muted">No time logged yet.</p>'}</section>
    </div>`;
}

function initTimeEvents() {
  const view = el('view-time');
  view.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) return openTaskDrawer(parseInt(open.dataset.open, 10));
    const week = e.target.closest('[data-week]');
    if (week) { timeState.week = week.dataset.week === '0' ? null : addDays(timeState.week || weekStart(todayIso()), parseInt(week.dataset.week, 10)); return renderTime(); }
    const del = e.target.closest('[data-timedel]');
    if (del) {
      try {
        await api(`/api/time/${del.dataset.timedel}`, { method: 'DELETE' });
        hub.time = hub.time.filter(x => x.id !== parseInt(del.dataset.timedel, 10));
        saveHubCache();
        renderTime();
      } catch (err) { showToast(err.message); }
      return;
    }
    const act = e.target.closest('[data-time]');
    if (!act) return;
    if (act.dataset.time === 'log') return logTimeSheet(null);
    if (act.dataset.time === 'stop') return stopTimer();
    if (act.dataset.time === 'start') return openSheet({ title: 'Start a timer', fields: [{ name: 'task_id', label: 'Task', type: 'select', options: [['', 'No particular task']].concat(hub.tasks.filter(t => t.column !== 'done').map(t => [String(t.id), t.title])) }],
      submitLabel: 'Start', onSubmit: (v) => startTimer(v.task_id ? parseInt(v.task_id, 10) : null) });
    if (act.dataset.time === 'csv') {
      const rows = [['Day', 'Person', 'Task', 'Minutes', 'Hours', 'Note']];
      (hub.time || []).filter(x => x.ended_at).sort((a, b) => a.day.localeCompare(b.day)).forEach(x => rows.push([x.day, memberName(x.user_id), x.task_id && taskById(x.task_id) ? taskById(x.task_id).title : '', x.minutes, (x.minutes / 60).toFixed(2), x.note]));
      downloadCsvRows(rows, `${safeFileName(hub.board.name)}-time.csv`);
    }
  });
  view.addEventListener('change', (e) => {
    if (e.target.matches('[data-timeperson]')) { timeState.person = e.target.value; renderTime(); }
  });
}

registerHubTool('time', { render: renderTime });
document.addEventListener('DOMContentLoaded', initTimeEvents);
