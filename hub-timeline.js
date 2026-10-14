// ==========================================
// HUB-TIMELINE.JS — The timeline (Gantt chart): each task is a bar from its start to its due date,
// milestones are diamonds, arrows show what waits for what, and a line marks today.
// Drag a bar to move it, drag either end to change its dates. A task that starts before something it
// waits for is finished is marked, so the plan's conflicts are visible.
// ==========================================

const tlState = { zoom: 'day', group: 'sprint', scroll: null };
const TL_DAY_WIDTH = { day: 36, week: 14, month: 5 };
const TL_ROW = 40;
let tlDrag = null;

function tlDates(task) {
  // A task with only one date is one day long; a milestone is a point on its due date
  const end = task.due_date || task.start_date;
  const start = task.is_milestone ? end : (task.start_date || end);
  return { start, end };
}

function tlGroups(tasks) {
  if (tlState.group === 'none') return [[null, tasks]];
  if (tlState.group === 'assignee') {
    const groups = hub.members.map(m => [m.user_name, tasks.filter(t => t.assignee_id === m.user_id)]);
    groups.push(['Unassigned', tasks.filter(t => !t.assignee_id || !hubMember(t.assignee_id))]);
    return groups.filter(([, list]) => list.length);
  }
  const groups = hub.sprints.slice().sort((a, b) => (a.start_date || '').localeCompare(b.start_date || '') || a.id - b.id)
    .map(s => [`${s.name}${s.start_date ? ` · ${dayLabel(s.start_date)} – ${dayLabel(s.end_date)}` : ''}`, tasks.filter(t => t.sprint_id === s.id)]);
  groups.push(['Backlog', tasks.filter(t => !t.sprint_id || !hub.sprints.some(s => s.id === t.sprint_id))]);
  return groups.filter(([, list]) => list.length);
}

function renderTimeline() {
  const view = el('view-timeline');
  const old = view.querySelector('.ht-tl-scroll');
  if (old) tlState.scroll = old.scrollLeft;
  const dated = hub.tasks.filter(t => t.due_date || t.start_date).sort((a, b) => (tlDates(a).start || '').localeCompare(tlDates(b).start || '') || a.id - b.id);
  const undated = hub.tasks.filter(t => !t.due_date && !t.start_date && t.column !== 'done');
  const today = todayIso();
  const dayWidth = TL_DAY_WIDTH[tlState.zoom];

  const head = toolHead('Timeline', 'Drag a bar to move it; drag its ends to change the dates.', `
    <div class="ht-seg" role="group" aria-label="Zoom">${['day', 'week', 'month'].map(z => `<button type="button" data-zoom="${z}" class="${tlState.zoom === z ? 'is-on' : ''}">${z[0].toUpperCase() + z.slice(1)}</button>`).join('')}</div>
    <select data-group aria-label="Group by"><option value="sprint" ${tlState.group === 'sprint' ? 'selected' : ''}>By sprint</option><option value="assignee" ${tlState.group === 'assignee' ? 'selected' : ''}>By person</option><option value="none" ${tlState.group === 'none' ? 'selected' : ''}>No groups</option></select>
    <button type="button" class="ht-btn is-quiet" data-tl="today">${msIcon('today')}Today</button>
    <button type="button" class="ht-btn is-quiet" data-tl="milestone">${msIcon('flag')}Milestone</button>
    <button type="button" class="ht-btn" data-tl="new">${msIcon('add')}Task</button>`);

  if (!dated.length) {
    view.innerHTML = head + toolEmpty('view_timeline', 'Nothing on the timeline yet', 'Give tasks a start or due date and they appear here as bars.', undatedHtml(undated));
    return;
  }

  // The range: a little before the first date (and today) to a little after the last
  const starts = dated.map(t => tlDates(t).start).concat(today, ...hub.sprints.map(s => s.start_date).filter(Boolean));
  const ends = dated.map(t => tlDates(t).end).concat(today, ...hub.sprints.map(s => s.end_date).filter(Boolean));
  let from = addDays(starts.sort()[0], -7);
  if (tlState.zoom !== 'day') from = `${from.slice(0, 7)}-01`;
  const to = addDays(ends.sort().slice(-1)[0], tlState.zoom === 'month' ? 60 : 21);
  const totalDays = daysBetween(from, to) + 1;
  const width = totalDays * dayWidth;
  const x = (iso) => daysBetween(from, iso) * dayWidth;

  // Rows: group headers and tasks
  const rows = [];
  tlGroups(dated).forEach(([label, list]) => {
    if (label !== null) rows.push({ group: label });
    list.forEach(task => rows.push({ task }));
  });
  const rowOf = {};
  rows.forEach((row, i) => { if (row.task) rowOf[row.task.id] = i; });

  // Scale: months on top, then days or week numbers
  const months = [];
  for (let d = dayDate(from); dayIso(d) <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const startIso = dayIso(d) < from ? from : dayIso(d);
    const next = dayIso(new Date(d.getFullYear(), d.getMonth() + 1, 1));
    const endIso = next > to ? addDays(to, 1) : next;
    months.push(`<div class="ht-tl-month" style="left:${x(startIso)}px;width:${daysBetween(startIso, endIso) * dayWidth}px">${escapeHtml(d.toLocaleDateString([], { month: tlState.zoom === 'month' ? 'short' : 'long', year: 'numeric' }))}</div>`);
  }
  const ticks = [], shades = [];
  for (let i = 0; i < totalDays; i++) {
    const iso = addDays(from, i);
    const day = dayDate(iso);
    if (tlState.zoom === 'day') {
      ticks.push(`<div class="ht-tl-tick" style="left:${i * dayWidth}px;width:${dayWidth}px">${day.getDate()}</div>`);
      if (day.getDay() === 0 || day.getDay() === 6) shades.push(`<div class="ht-tl-weekend" style="left:${i * dayWidth}px;width:${dayWidth}px"></div>`);
    } else if (tlState.zoom === 'week' && day.getDay() === 1) {
      ticks.push(`<div class="ht-tl-tick is-week" style="left:${i * dayWidth}px;width:${7 * dayWidth}px">${day.getDate()} ${escapeHtml(day.toLocaleDateString([], { month: 'short' }))}</div>`);
    }
  }
  const sprintBands = hub.sprints.filter(s => s.start_date && s.end_date).map(s =>
    `<div class="ht-tl-band is-${s.status}" style="left:${x(s.start_date)}px;width:${(daysBetween(s.start_date, s.end_date) + 1) * dayWidth}px" title="${escapeHtml(s.name)}"></div>`).join('');

  const bars = rows.map((row, i) => {
    if (row.group !== undefined) return `<div class="ht-tl-grouprow" style="top:${i * TL_ROW}px;width:${width}px"></div>`;
    const t = row.task;
    const { start, end } = tlDates(t);
    const late = taskBlockedBy(t).some(b => b.due_date && start && start < b.due_date);
    const assignee = t.assignee_id && hubMember(t.assignee_id);
    if (t.is_milestone) {
      return `<button type="button" class="ht-tl-milestone${t.column === 'done' ? ' is-done' : ''}" data-bar="${t.id}" data-mode="move" style="top:${i * TL_ROW + 8}px;left:${x(end) + dayWidth / 2 - 11}px" title="${escapeHtml(t.title)} · ${escapeHtml(dayLabel(end, true))}"></button>
        <span class="ht-tl-mslabel" style="top:${i * TL_ROW + 10}px;left:${x(end) + dayWidth / 2 + 16}px">${escapeHtml(t.title)}</span>`;
    }
    const left = x(start), barWidth = Math.max(dayWidth, (daysBetween(start, end) + 1) * dayWidth);
    const done = (t.checklist || []).length ? (t.checklist.filter(c => c.done).length / t.checklist.length) : (t.column === 'done' ? 1 : 0);
    return `<div class="ht-tl-bar is-${t.column}${late ? ' is-conflict' : ''}" data-bar="${t.id}" data-mode="move" style="top:${i * TL_ROW + 7}px;left:${left}px;width:${barWidth}px"
        title="${escapeHtml(t.title)} · ${escapeHtml(dayLabel(start, true))} – ${escapeHtml(dayLabel(end, true))}${late ? ' · starts before something it waits for is due' : ''}">
        <span class="ht-tl-fill" style="width:${Math.round(done * 100)}%"></span>
        <span class="ht-tl-handle is-start" data-bar="${t.id}" data-mode="start"></span>
        <span class="ht-tl-text">${late ? msIcon('warning') : ''}${escapeHtml(t.title)}</span>
        ${assignee ? `<span class="ht-tl-who">${memberAvatarHtml(assignee, 'h-5 w-5', 'text-[8px]')}</span>` : ''}
        <span class="ht-tl-handle is-end" data-bar="${t.id}" data-mode="end"></span>
      </div>`;
  }).join('');

  // Arrows from the end of a task to the start of each task that waits for it
  const arrows = [];
  dated.forEach(t => (t.depends_on || []).forEach(id => {
    const from_ = taskById(id);
    if (!from_ || rowOf[id] === undefined || rowOf[t.id] === undefined) return;
    const a = tlDates(from_), b = tlDates(t);
    const x1 = x(a.end) + dayWidth, y1 = rowOf[id] * TL_ROW + TL_ROW / 2;
    const x2 = x(b.start), y2 = rowOf[t.id] * TL_ROW + TL_ROW / 2;
    const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12));
    const bad = b.start && a.end && b.start < a.end;
    arrows.push(`<path class="${bad ? 'is-conflict' : ''}" d="M${x1},${y1} H${mid} V${y2} H${x2 - 2}" marker-end="url(#tlArrow${bad ? 'Bad' : ''})"/>`);
  }));
  const height = rows.length * TL_ROW;

  view.innerHTML = `${head}
    <div class="ht-tl">
      <div class="ht-tl-names" style="height:${height + 52}px">
        <div class="ht-tl-corner">Task</div>
        ${rows.map(row => row.group !== undefined
          ? `<div class="ht-tl-name is-group">${escapeHtml(row.group)}</div>`
          : `<button type="button" class="ht-tl-name${row.task.column === 'done' ? ' is-done' : ''}" data-open="${row.task.id}" title="${escapeHtml(row.task.title)}">${row.task.is_milestone ? msIcon('flag', 'ht-ico-milestone') : ''}${escapeHtml(row.task.title)}</button>`).join('')}
      </div>
      <div class="ht-tl-scroll">
        <div class="ht-tl-canvas" style="width:${width}px;height:${height + 52}px">
          <div class="ht-tl-scale">${months.join('')}<div class="ht-tl-ticks">${ticks.join('')}</div></div>
          <div class="ht-tl-body" style="height:${height}px">
            ${shades.join('')}${sprintBands}
            ${today >= from && today <= to ? `<div class="ht-tl-today" style="left:${x(today) + dayWidth / 2}px" title="Today"></div>` : ''}
            <svg class="ht-tl-arrows" width="${width}" height="${height}" aria-hidden="true">
              <defs><marker id="tlArrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker>
                <marker id="tlArrowBad" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"/></marker></defs>
              ${arrows.join('')}
            </svg>
            ${bars}
          </div>
        </div>
      </div>
    </div>
    <p class="ht-tl-tip" id="tlTip" hidden></p>
    ${undatedHtml(undated)}`;

  const scroller = view.querySelector('.ht-tl-scroll');
  scroller.scrollLeft = tlState.scroll !== null ? tlState.scroll : Math.max(0, x(today) - 120);
  view.dataset.from = from;
}

function undatedHtml(undated) {
  if (!undated.length) return '';
  return `<div class="ht-card"><h4>${msIcon('event_busy')}Not on the timeline <small>${undated.length}</small></h4>
    <div class="ht-chips">${undated.map(t => `<span class="ht-undated"><button type="button" class="ht-link" data-open="${t.id}">${escapeHtml(t.title)}</button>
      <button type="button" class="ht-btn is-quiet is-small" data-schedule="${t.id}">${msIcon('event')}Schedule</button></span>`).join('')}</div></div>`;
}

// ---------- dragging bars ----------
function initTimelineEvents() {
  const view = el('view-timeline');
  view.addEventListener('click', (e) => {
    const zoom = e.target.closest('[data-zoom]');
    if (zoom) { tlState.zoom = zoom.dataset.zoom; tlState.scroll = null; return renderTimeline(); }
    const act = e.target.closest('[data-tl]');
    if (act) {
      if (act.dataset.tl === 'today') { tlState.scroll = null; return renderTimeline(); }
      if (act.dataset.tl === 'new') return newTaskSheet({ start_date: todayIso(), due_date: addDays(todayIso(), 2) });
      if (act.dataset.tl === 'milestone') return newTaskSheet({ is_milestone: true, due_date: addDays(todayIso(), 7) });
    }
    const schedule = e.target.closest('[data-schedule]');
    if (schedule) return patchTask(parseInt(schedule.dataset.schedule, 10), { start_date: todayIso(), due_date: addDays(todayIso(), 2) });
    const open = e.target.closest('[data-open]');
    if (open) return openTaskDrawer(parseInt(open.dataset.open, 10));
  });
  view.addEventListener('change', (e) => {
    if (e.target.matches('[data-group]')) { tlState.group = e.target.value; renderTimeline(); }
  });
  view.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-mode]');
    if (!handle || e.button !== 0) return;
    const task = taskById(parseInt(handle.dataset.bar, 10));
    if (!task) return;
    const bar = view.querySelector(`.ht-tl-bar[data-bar="${task.id}"], .ht-tl-milestone[data-bar="${task.id}"]`);
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const { start, end } = tlDates(task);
    tlDrag = { task, bar, mode: handle.dataset.mode, x0: e.clientX, start, end, shift: 0, moved: false, left: bar.offsetLeft, width: bar.offsetWidth };
    bar.classList.add('is-dragging');
  });
  view.addEventListener('pointermove', (e) => {
    if (!tlDrag) return;
    const dayWidth = TL_DAY_WIDTH[tlState.zoom];
    const shift = Math.round((e.clientX - tlDrag.x0) / dayWidth);
    if (Math.abs(e.clientX - tlDrag.x0) > 3) tlDrag.moved = true;
    if (shift === tlDrag.shift) return;
    tlDrag.shift = shift;
    const { start, end } = tlNewDates();
    const from = view.dataset.from;
    if (tlDrag.mode === 'move' && tlDrag.task.is_milestone) {
      tlDrag.bar.style.left = `${daysBetween(from, end) * dayWidth + dayWidth / 2 - 11}px`;
    } else {
      tlDrag.bar.style.left = `${daysBetween(from, start) * dayWidth}px`;
      tlDrag.bar.style.width = `${Math.max(dayWidth, (daysBetween(start, end) + 1) * dayWidth)}px`;
    }
    const tip = el('tlTip');
    tip.hidden = false;
    tip.textContent = tlDrag.task.is_milestone ? dayLabel(end, true) : `${dayLabel(start, true)} → ${dayLabel(end, true)} (${daysBetween(start, end) + 1} days)`;
  });
  const finish = async () => {
    if (!tlDrag) return;
    const drag = tlDrag;
    tlDrag = null;
    el('tlTip').hidden = true;
    drag.bar.classList.remove('is-dragging');
    if (!drag.moved || drag.shift === 0) {
      if (!drag.moved) openTaskDrawer(drag.task.id);
      return renderTimeline();
    }
    tlDrag = drag;
    const { start, end } = tlNewDates();
    tlDrag = null;
    const body = drag.task.is_milestone ? { due_date: end } : { start_date: start, due_date: end };
    if (!(await patchTask(drag.task.id, body))) renderTimeline();
  };
  view.addEventListener('pointerup', finish);
  view.addEventListener('pointercancel', finish);
}

function tlNewDates() {
  let start = tlDrag.start, end = tlDrag.end;
  if (tlDrag.mode === 'move') { start = addDays(start, tlDrag.shift); end = addDays(end, tlDrag.shift); }
  if (tlDrag.mode === 'start') start = addDays(start, tlDrag.shift) > end ? end : addDays(start, tlDrag.shift);
  if (tlDrag.mode === 'end') end = addDays(end, tlDrag.shift) < start ? start : addDays(end, tlDrag.shift);
  return { start, end };
}

registerHubTool('timeline', { render: () => { if (!tlDrag) renderTimeline(); } });
document.addEventListener('DOMContentLoaded', initTimelineEvents);
