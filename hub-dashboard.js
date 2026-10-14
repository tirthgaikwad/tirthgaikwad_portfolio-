// ==========================================
// HUB-DASHBOARD.JS — How the project is going, at a glance:
// headline numbers, tasks by stage, a burndown for the running sprint, and the lists that need attention
// (late, waiting on other tasks, due this week, next milestones).
// Chart colours: the four stages use a validated categorical order (blue, orange, aqua, yellow), always with
// visible labels and counts beside them; the burndown is one series plus a neutral dashed "ideal" line.
// ==========================================

const STAGE_COLORS = { todo: '#2a78d6', inprogress: '#eb6834', review: '#1baf7a', done: '#eda100' };

function renderDashboard() {
  const view = el('view-dashboard');
  const tasks = hub.tasks;
  const today = todayIso();
  const open = tasks.filter(t => t.column !== 'done');
  const late = open.filter(t => t.due_date && t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const waiting = open.filter(t => taskBlockedBy(t).length);
  const soon = open.filter(t => t.due_date && t.due_date >= today && t.due_date <= addDays(today, 7)).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const milestones = tasks.filter(t => t.is_milestone && t.column !== 'done' && t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const weekAgo = addDays(today, -6);
  const minutesWeek = (hub.time || []).filter(e => (e.day || '') >= weekAgo).reduce((sum, e) => sum + (e.minutes || 0), 0);
  const pct = tasks.length ? Math.round(100 * (tasks.length - open.length) / tasks.length) : 0;
  const active = hub.sprints.find(s => s.status === 'active');
  const counts = Object.fromEntries(HUB_COLUMNS.map(c => [c.id, tasks.filter(t => t.column === c.id).length]));

  const listCard = (icon, title, list, empty, extra) => `<section class="ht-card ht-dash-list"><h4>${msIcon(icon)}${escapeHtml(title)} <small>${list.length}</small></h4>
    ${list.length ? `<ul>${list.slice(0, 8).map(t => `<li><button type="button" class="ht-link" data-open="${t.id}">${escapeHtml(t.title)}</button><span class="ht-muted">${extra(t)}</span></li>`).join('')}</ul>` : `<p class="ht-muted">${escapeHtml(empty)}</p>`}</section>`;

  view.innerHTML = `
    ${toolHead('Dashboard', active ? `Running sprint: ${active.name}` : 'No sprint is running.')}
    <div class="ht-tiles">
      <div class="ht-tile"><span class="ht-tile-label">Done</span><strong>${pct}%</strong><small>${tasks.length - open.length} of ${tasks.length} tasks</small></div>
      <div class="ht-tile"><span class="ht-tile-label">Open</span><strong>${open.length}</strong><small>${open.filter(t => !t.assignee_id).length} unassigned</small></div>
      <div class="ht-tile${late.length ? ' is-alert' : ''}"><span class="ht-tile-label">${late.length ? msIcon('error') : ''}Late</span><strong>${late.length}</strong><small>past their due date</small></div>
      <div class="ht-tile"><span class="ht-tile-label">Waiting</span><strong>${waiting.length}</strong><small>on unfinished tasks</small></div>
      <div class="ht-tile"><span class="ht-tile-label">Hours this week</span><strong>${(minutesWeek / 60).toFixed(minutesWeek % 60 ? 1 : 0)}</strong><small>logged by the team</small></div>
      <div class="ht-tile"><span class="ht-tile-label">Next milestone</span><strong class="ht-tile-text">${milestones[0] ? escapeHtml(milestones[0].title) : '—'}</strong><small>${milestones[0] ? `${escapeHtml(dayLabel(milestones[0].due_date, true))} · in ${daysBetween(today, milestones[0].due_date)} days` : 'none planned'}</small></div>
    </div>

    <section class="ht-card">
      <h4>${msIcon('stacked_bar_chart')}Tasks by stage</h4>
      ${tasks.length ? `<div class="ht-stagebar" role="img" aria-label="${HUB_COLUMNS.map(c => `${c.name} ${counts[c.id]}`).join(', ')}">
        ${HUB_COLUMNS.filter(c => counts[c.id]).map(c => `<span style="flex:${counts[c.id]};background:${STAGE_COLORS[c.id]}" data-tip="${escapeHtml(c.name)}: ${counts[c.id]} task${counts[c.id] === 1 ? '' : 's'} (${Math.round(100 * counts[c.id] / tasks.length)}%)"></span>`).join('')}
      </div>
      <div class="ht-legend">${HUB_COLUMNS.map(c => `<span><i style="background:${STAGE_COLORS[c.id]}"></i>${escapeHtml(c.name)} <strong>${counts[c.id]}</strong></span>`).join('')}</div>` : '<p class="ht-muted">No tasks yet.</p>'}
    </section>

    <section class="ht-card">
      <h4>${msIcon('trending_down')}Burndown${active ? ` · ${escapeHtml(active.name)}` : ''}</h4>
      ${burndownHtml(active)}
    </section>

    <div class="ht-dash-grid">
      ${listCard('error', 'Late', late, 'Nothing is late.', t => `${escapeHtml(dayLabel(t.due_date))}${t.assignee_id ? ` · ${escapeHtml(memberName(t.assignee_id))}` : ''}`)}
      ${listCard('block', 'Waiting on other tasks', waiting, 'Nothing is held up.', t => `waits for ${escapeHtml(taskBlockedBy(t).map(b => b.title).join(', '))}`)}
      ${listCard('event_upcoming', 'Due in the next 7 days', soon, 'Nothing is due this week.', t => escapeHtml(dayLabel(t.due_date)))}
      ${listCard('flag', 'Milestones ahead', milestones, 'No milestones planned.', t => escapeHtml(dayLabel(t.due_date, true)))}
    </div>
    <div class="ht-tooltip" id="dashTip" hidden></div>`;
}

// Remaining tasks of the running sprint per day, against a straight "ideal" line to zero on the last day
function burndownData(sprint) {
  const tasks = sprintTasks(sprint.id);
  const start = sprint.start_date, end = sprint.end_date;
  const days = daysBetween(start, end);
  const today = todayIso();
  const points = [];
  for (let i = 0; i <= days; i++) {
    const day = addDays(start, i);
    const doneBy = tasks.filter(t => t.column === 'done' && t.done_at && dayIso(new Date(t.done_at)) <= day).length;
    points.push({ day, ideal: tasks.length * (1 - i / Math.max(1, days)), remaining: day <= today ? tasks.length - doneBy : null });
  }
  return { tasks, points };
}

function burndownHtml(sprint) {
  if (!sprint) return '<p class="ht-muted">Start a sprint (Sprints tab) to see how fast its tasks get done.</p>';
  if (!sprint.start_date || !sprint.end_date) return '<p class="ht-muted">Give the running sprint a start and end date to draw its burndown.</p>';
  const { tasks, points } = burndownData(sprint);
  if (!tasks.length) return '<p class="ht-muted">The running sprint has no tasks yet.</p>';
  const W = 640, H = 220, L = 34, R = 74, T = 12, B = 28;
  const n = points.length - 1 || 1;
  const max = Math.max(1, tasks.length);
  const x = (i) => L + (W - L - R) * i / n;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const actual = points.filter(p => p.remaining !== null);
  const last = actual[actual.length - 1];
  const steps = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  return `
    <div class="ht-chart" id="burndown" data-points='${escapeHtml(JSON.stringify(points.map(p => [p.day, Math.round(p.ideal * 10) / 10, p.remaining])))}'>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Burndown: ${last ? last.remaining : tasks.length} of ${tasks.length} tasks remaining">
        ${steps.map(v => `<line class="ht-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ht-axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
        ${points.map((p, i) => (i % labelEvery === 0 && n - i >= labelEvery / 2) || i === n ? `<text class="ht-axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${escapeHtml(dayLabel(p.day))}</text>` : '').join('')}
        <polyline class="ht-ideal" points="${points.map((p, i) => `${x(i)},${y(p.ideal)}`).join(' ')}"/>
        <text class="ht-direct" x="${x(n) + 6}" y="${y(0) + 4}">Ideal</text>
        ${actual.length ? `<polyline class="ht-actual" points="${actual.map((p) => `${x(points.indexOf(p))},${y(p.remaining)}`).join(' ')}"/>
          <circle class="ht-dot" cx="${x(points.indexOf(last))}" cy="${y(last.remaining)}" r="5"/>
          <text class="ht-direct is-strong" x="${x(points.indexOf(last)) + 9}" y="${y(last.remaining) - 6}">${last.remaining} left</text>` : ''}
        <line class="ht-cross" id="burnCross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
        <rect class="ht-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" data-chart="burndown" data-n="${n}" data-l="${L}" data-r="${R}" data-w="${W}"/>
      </svg>
      <div class="ht-legend"><span><i style="background:#2a78d6"></i>Remaining tasks</span><span><i class="is-dashed"></i>Ideal pace</span></div>
      <details class="ht-table-toggle"><summary>Show as a table</summary>
        <div class="ht-table-wrap"><table class="ht-table"><thead><tr><th>Day</th><th>Remaining</th><th>Ideal</th></tr></thead>
        <tbody>${points.map(p => `<tr><td>${escapeHtml(dayLabel(p.day, true))}</td><td>${p.remaining ?? '—'}</td><td>${p.ideal.toFixed(1)}</td></tr>`).join('')}</tbody></table></div></details>
    </div>`;
}

function initDashboardEvents() {
  const view = el('view-dashboard');
  view.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) openTaskDrawer(parseInt(open.dataset.open, 10));
  });
  const tip = () => el('dashTip');
  const place = (e, html) => {
    const box = tip();
    if (!box) return;
    box.innerHTML = html;
    box.hidden = false;
    const r = view.getBoundingClientRect();
    box.style.left = `${Math.min(e.clientX - r.left + 14, r.width - box.offsetWidth - 4)}px`;
    box.style.top = `${e.clientY - r.top + 14}px`;
  };
  view.addEventListener('pointermove', (e) => {
    const seg = e.target.closest('.ht-stagebar [data-tip]');
    if (seg) return place(e, escapeHtml(seg.dataset.tip));
    const hit = e.target.closest('[data-chart="burndown"]');
    if (hit) {
      const svg = hit.ownerSVGElement;
      const box = svg.getBoundingClientRect();
      const scale = parseFloat(hit.dataset.w) / box.width;
      const L = parseFloat(hit.dataset.l), R = parseFloat(hit.dataset.r), W = parseFloat(hit.dataset.w), n = parseInt(hit.dataset.n, 10);
      const i = Math.max(0, Math.min(n, Math.round(((e.clientX - box.left) * scale - L) / ((W - L - R) / n))));
      const points = JSON.parse(el('burndown').dataset.points);
      const [day, ideal, remaining] = points[i];
      const cross = el('burnCross');
      const cx = L + (W - L - R) * i / n;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      return place(e, `<strong>${escapeHtml(dayLabel(day, true))}</strong><br>Remaining: ${remaining ?? '—'}<br>Ideal: ${ideal}`);
    }
    if (tip()) tip().hidden = true;
    const cross = el('burnCross');
    if (cross) cross.setAttribute('visibility', 'hidden');
  });
  view.addEventListener('pointerleave', () => { if (tip()) tip().hidden = true; });
}

registerHubTool('dashboard', { render: renderDashboard });
document.addEventListener('DOMContentLoaded', initDashboardEvents);
