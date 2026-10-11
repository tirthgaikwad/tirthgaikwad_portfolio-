// ==========================================
// COLLEGE-HUB-CALENDAR.JS — The Calendar tab (teachers' events plus every activity date) and the Attendance tab.
// Loaded before college-hub.js, after college-hub-work.js (hubActions, hubChangeHandlers, downloadCsv, today).
// ==========================================

const EVENT_KINDS = {
  exam: { label: 'Exam', icon: 'quiz' },
  lecture: { label: 'Lecture', icon: 'co_present' },
  event: { label: 'Event', icon: 'celebration' },
  holiday: { label: 'Holiday', icon: 'beach_access' },
  other: { label: 'Other', icon: 'event' },
  groups: { label: 'Form groups by', icon: 'group_add' },
  due: { label: 'Hand in by', icon: 'upload_file' }
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ATTENDANCE_LOW = 75;   // per cent, as on the server

const cal = { month: '', dept: '', division: '' };   // month is YYYY-MM

// ==========================================
// 1. WHAT IS ON THE CALENDAR
// ==========================================
// Teachers' events and the dates activities set, as one list sorted by date and time
function calendarItems() {
  const items = (hub.events || []).map(event => ({ ...event, source: 'event', key: `event-${event.id}` }));
  activities().forEach(post => {
    const common = { department: post.department, division: post.division, location: '', start_time: '', end_time: '', post_id: post.id, source: 'activity' };
    if (post.deadline) items.push({ ...common, key: `groups-${post.id}`, kind: 'groups', date: post.deadline, title: post.title, details: 'Last day to form groups.' });
    if (post.accepts_work && post.submit_by) items.push({ ...common, key: `due-${post.id}`, kind: 'due', date: post.submit_by, title: post.title, details: 'Last day to hand in work.' });
  });
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''));
}

// A teacher can narrow the calendar to one class; items for the whole college always stay
function calendarFiltered() {
  return calendarItems().filter(item => {
    if (!isTeacher() || !cal.dept || !item.department) return true;
    if (norm(item.department) !== cal.dept) return false;
    return !cal.division || !item.division || norm(item.division) === cal.division;
  });
}

const addDays = (isoDate, days) => { const day = new Date(`${isoDate}T00:00:00`); day.setDate(day.getDate() + days); return day.toLocaleDateString('en-CA'); };
const itemTime = (item) => item.start_time ? `${item.start_time}${item.end_time ? `–${item.end_time}` : ''}` : '';
const itemAudience = (item) => item.department ? `${item.department}${item.division ? ` · Div ${item.division}` : ''}` : 'Whole college';
const dayLabel = (isoDate) => new Date(`${isoDate}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

function upcomingItems(days) {
  const from = today(), to = addDays(today(), days);
  return calendarFiltered().filter(item => item.date >= from && item.date <= to);
}

function itemRowHtml(item, withDate) {
  const kind = EVENT_KINDS[item.kind] || EVENT_KINDS.other;
  return `<button type="button" class="ch-agenda-item k-${item.kind}" data-act="cal-item" data-key="${item.key}">
    <span class="ch-agenda-ico">${icon(kind.icon)}</span>
    <span class="ch-agenda-text"><b>${escapeHtml(item.source === 'activity' ? `${kind.label}: ${item.title}` : item.title)}</b>
    <small>${[withDate ? dayLabel(item.date) : '', itemTime(item), item.location, isTeacher() ? itemAudience(item) : ''].filter(Boolean).map(escapeHtml).join(' · ')}</small></span>
  </button>`;
}

// The "This week" box beside the notice board
function thisWeekPanelHtml() {
  const items = upcomingItems(7);
  return `<div class="ch-panel">
    <h3>Coming up this week</h3>
    ${items.length ? `<div class="ch-agenda compact">${items.slice(0, 5).map(item => itemRowHtml(item, true)).join('')}</div>` : '<p>Nothing on the calendar for the next seven days.</p>'}
    <button class="ch-btn line small" type="button" data-tab="calendar" style="margin-top:12px;width:100%">${icon('calendar_month')}Open the calendar</button>
  </div>`;
}

// ==========================================
// 2. THE CALENDAR TAB
// ==========================================
function renderCalendar() {
  if (!cal.month) cal.month = today().slice(0, 7);
  const teacher = isTeacher();
  const [year, month] = cal.month.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const title = first.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const items = calendarFiltered();
  const inMonth = items.filter(item => item.date.startsWith(cal.month));

  el('calendarBar').innerHTML = `
    <h2 class="ch-bar-title">${escapeHtml(title)}<small>${plural(inMonth.length, 'item', 'items')}</small></h2>
    <div class="ch-cal-nav">
      <button class="ch-icon-btn" type="button" data-act="cal-move" data-step="-1" title="Previous month" aria-label="Previous month"><span class="material-symbols-outlined">chevron_left</span></button>
      <button class="ch-btn line small" type="button" data-act="cal-today">Today</button>
      <button class="ch-icon-btn" type="button" data-act="cal-move" data-step="1" title="Next month" aria-label="Next month"><span class="material-symbols-outlined">chevron_right</span></button>
    </div>
    ${teacher ? `<select class="ch-select" id="calDept" aria-label="Department"><option value="">All classes</option>${optionsOf('department', cal.dept)}</select>
      <select class="ch-select" id="calDivision" aria-label="Division"><option value="">All divisions</option>${cal.dept ? optionsOf('division', cal.division, students().filter(person => norm(person.department) === cal.dept)) : ''}</select>` : ''}
    <button class="ch-btn line" type="button" data-act="cal-ics">${icon('download')}Add month to my calendar</button>
    ${teacher ? `<button class="ch-btn solid" type="button" data-act="new-event">${icon('add')}Add event</button>` : ''}`;

  // Month grid, Monday first
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const byDate = new Map();
  inMonth.forEach(item => { if (!byDate.has(item.date)) byDate.set(item.date, []); byDate.get(item.date).push(item); });
  let cells = '';
  for (let n = 0; n < startOffset; n++) cells += '<div class="ch-cal-cell is-blank"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${cal.month}-${String(day).padStart(2, '0')}`;
    const list = byDate.get(iso) || [];
    cells += `<div class="ch-cal-cell${iso === today() ? ' is-today' : ''}${iso < today() ? ' is-past' : ''}" ${teacher ? `data-act="new-event" data-date="${iso}" title="Add an event on this day"` : ''}>
      <span class="ch-cal-day">${day}</span>
      ${list.slice(0, 3).map(item => `<button type="button" class="ch-cal-chip k-${item.kind}" data-act="cal-item" data-key="${item.key}" title="${escapeHtml(item.title)}">${itemTime(item) ? `<i>${escapeHtml(item.start_time)}</i>` : ''}${escapeHtml(item.title)}</button>`).join('')}
      ${list.length > 3 ? `<button type="button" class="ch-cal-more" data-act="cal-day" data-date="${iso}">+${list.length - 3} more</button>` : ''}
    </div>`;
  }
  const upcoming = upcomingItems(30);
  el('calendarBody').innerHTML = `
    <div class="ch-cal-layout">
      <div class="ch-panel ch-cal">
        <div class="ch-cal-head">${WEEKDAYS.map(day => `<span>${day}</span>`).join('')}</div>
        <div class="ch-cal-grid">${cells}</div>
        <div class="ch-cal-list">${inMonth.length ? `<div class="ch-agenda">${inMonth.map(item => itemRowHtml(item, true)).join('')}</div>` : `<p class="ch-muted" style="padding:16px">Nothing in ${escapeHtml(title)}.</p>`}</div>
        <div class="ch-cal-legend">${['exam', 'lecture', 'event', 'holiday', 'groups', 'due'].map(kind => `<span class="k-${kind}"><i></i>${EVENT_KINDS[kind].label}</span>`).join('')}</div>
      </div>
      <aside class="ch-side">
        <div class="ch-panel">
          <h3>Next 30 days</h3>
          ${upcoming.length ? `<div class="ch-agenda compact">${upcoming.slice(0, 12).map(item => itemRowHtml(item, true)).join('')}</div>` : '<p>Nothing coming up.</p>'}
        </div>
        ${teacher ? '' : '<div class="ch-panel"><h3>Where dates come from</h3><p>Your teachers add exams, lectures and events. Group and hand-in dates of activities show up here by themselves.</p></div>'}
      </aside>
    </div>`;
}

hubActions['cal-move'] = (button) => {
  const [year, month] = cal.month.split('-').map(Number);
  const next = new Date(year, month - 1 + Number(button.dataset.step), 1);
  cal.month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar();
};
hubActions['cal-today'] = () => { cal.month = today().slice(0, 7); renderCalendar(); };
hubActions['cal-ics'] = () => {
  const [year, month] = cal.month.split('-').map(Number);
  const title = new Date(year, month - 1, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const items = calendarFiltered().filter(item => item.date.startsWith(cal.month));
  if (!items.length) return showToast(`Nothing in ${title} to add.`);
  downloadIcs(items, `${fileSafe(hub.me.college)}-${cal.month}.ics`);
};
hubActions['cal-day'] = (button) => {
  const items = calendarFiltered().filter(item => item.date === button.dataset.date);
  openHubModal({ title: dayLabel(button.dataset.date), confirmText: 'Close', body: `<div class="ch-agenda">${items.map(item => itemRowHtml(item, false)).join('')}</div>`, onConfirm: async () => {} });
};

hubActions['cal-item'] = (button) => {
  const item = calendarItems().find(entry => entry.key === button.dataset.key);
  if (!item) return;
  const kind = EVENT_KINDS[item.kind] || EVENT_KINDS.other;
  const event = item.source === 'event' ? item : null;
  openHubModal({
    title: item.source === 'activity' ? `${kind.label}: ${item.title}` : item.title,
    confirmText: 'Close',
    body: `<div class="ch-rules" style="margin:0">
        <span class="ch-chip indigo">${icon(kind.icon)}${kind.label}</span>
        <span class="ch-chip">${icon('event')}${escapeHtml(formatDate(item.date))}${itemTime(item) ? ` · ${escapeHtml(itemTime(item))}` : ''}</span>
        ${item.location ? `<span class="ch-chip">${icon('location_on')}${escapeHtml(item.location)}</span>` : ''}
        <span class="ch-chip">${icon('groups')}${escapeHtml(itemAudience(item))}</span></div>
      ${item.details ? `<p class="ch-post-body" style="margin:0">${linkify(item.details)}</p>` : ''}
      <div class="ch-review-actions">
        <button class="ch-btn line small" type="button" data-cal="ics">${icon('download')}Add to my calendar</button>
        ${item.source === 'activity' ? `<button class="ch-btn line small" type="button" data-cal="open-activity">${icon('assignment')}Open the activity</button>` : ''}
        ${event && isTeacher() ? `<span class="ch-spacer"></span><button class="ch-btn line small" type="button" data-cal="edit">${icon('edit')}Edit</button>
        <button class="ch-btn line small danger" type="button" data-cal="delete">${icon('delete')}Delete</button>` : ''}
      </div>`,
    onOpen: () => {
      el('hubModalBody').onclick = (e) => {
        const action = e.target.closest('[data-cal]');
        if (!action) return;
        const what = action.dataset.cal;
        if (what === 'ics') return downloadIcs([item], `${fileSafe(item.title)}.ics`);
        closeHubModal();
        if (what === 'open-activity') { view.activity = String(item.post_id); return setTab('groups'); }
        if (what === 'edit') return openEventForm(event, '');
        if (what === 'delete') {
          confirmThen('Delete this event?', `${item.title} is removed from the calendar.`, 'Delete',
            () => run(() => api(`/api/college-hub/events/${event.id}`, { method: 'DELETE' }), 'Event deleted.'));
        }
      };
    },
    onConfirm: async () => {}
  });
};

hubActions['new-event'] = (button) => openEventForm(null, button.dataset.date || '');

function openEventForm(event, date) {
  const editing = Boolean(event);
  const value = (field, fallback) => escapeHtml(editing ? (event[field] || '') : fallback);
  const divisionOptions = (dept) => optionsOf('division', editing ? norm(event.division) : '', students().filter(person => norm(person.department) === dept));
  openHubModal({
    title: editing ? 'Edit event' : 'Add to the calendar',
    confirmText: editing ? 'Save changes' : 'Add event',
    body: `
      <label>Title<input class="ch-input" id="evTitle" maxlength="120" value="${value('title', '')}" placeholder="For example: Mid-semester exam, Data Structures"></label>
      <div class="ch-row2">
        <label>Kind<select class="ch-select" id="evKind">${['exam', 'lecture', 'event', 'holiday', 'other'].map(kind => `<option value="${kind}" ${(editing ? event.kind : 'event') === kind ? 'selected' : ''}>${EVENT_KINDS[kind].label}</option>`).join('')}</select></label>
        <label>Date<input class="ch-input" id="evDate" type="date" value="${value('date', date || today())}"></label>
      </div>
      <div class="ch-row3">
        <label>Starts <small>(optional)</small><input class="ch-input" id="evStart" type="time" value="${value('start_time', '')}"></label>
        <label>Ends <small>(optional)</small><input class="ch-input" id="evEnd" type="time" value="${value('end_time', '')}"></label>
        <label>Place <small>(optional)</small><input class="ch-input" id="evPlace" maxlength="120" value="${value('location', '')}" placeholder="Room 204"></label>
      </div>
      <div class="ch-row2">
        <label>For<select class="ch-select" id="evDept"><option value="">Whole college</option>${optionsOf('department', editing ? norm(event.department) : '')}</select></label>
        <label>Division<select class="ch-select" id="evDivision"><option value="">All divisions</option>${editing && event.department ? divisionOptions(norm(event.department)) : ''}</select></label>
      </div>
      <label>Details <small>(optional)</small><textarea class="ch-textarea" id="evDetails" maxlength="2000" placeholder="Syllabus, what to bring, links">${value('details', '')}</textarea></label>
      ${editing ? '' : '<p class="ch-muted">Students it is for get a notification when the date is today or later.</p>'}`,
    onOpen: () => {
      el('evDept').addEventListener('change', (e) => {
        el('evDivision').innerHTML = '<option value="">All divisions</option>' + (e.target.value ? divisionOptions(e.target.value) : '');
      });
    },
    onConfirm: async () => {
      const labelOf = (select) => (select.value ? select.options[select.selectedIndex].textContent : '');
      const body = {
        title: el('evTitle').value, kind: el('evKind').value, date: el('evDate').value, start_time: el('evStart').value, end_time: el('evEnd').value,
        location: el('evPlace').value, details: el('evDetails').value, department: labelOf(el('evDept')), division: labelOf(el('evDivision'))
      };
      if (!body.title.trim()) throw new Error('Give the event a title.');
      if (!body.date) throw new Error('Pick a date for the event.');
      if (editing) await api(`/api/college-hub/events/${event.id}`, { method: 'PUT', body });
      else await api('/api/college-hub/events', { method: 'POST', body });
      cal.month = body.date.slice(0, 7);
      showToast(editing ? 'Event updated.' : 'Added to the calendar.');
    }
  });
}

// An .ics file that any calendar app opens. Times are local ("floating"), as the college writes them.
function downloadIcs(items, filename) {
  const esc = (text) => String(text || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const compact = (isoDate) => isoDate.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Connect2Minds//College Hub//EN', 'CALSCALE:GREGORIAN'];
  items.forEach(item => {
    const kind = EVENT_KINDS[item.kind] || EVENT_KINDS.other;
    lines.push('BEGIN:VEVENT', `UID:${item.key}@connect2minds`, `DTSTAMP:${stamp}`);
    if (item.start_time) {
      lines.push(`DTSTART:${compact(item.date)}T${item.start_time.replace(':', '')}00`);
      lines.push(`DTEND:${compact(item.date)}T${(item.end_time || item.start_time).replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(item.date)}`, `DTEND;VALUE=DATE:${compact(addDays(item.date, 1))}`);
    }
    lines.push(`SUMMARY:${esc(item.source === 'activity' ? `${kind.label}: ${item.title}` : item.title)}`);
    if (item.location) lines.push(`LOCATION:${esc(item.location)}`);
    lines.push(`DESCRIPTION:${esc([item.details, `${hub.me.college} · ${itemAudience(item)}`].filter(Boolean).join('\n'))}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const text = lines.join('\r\n');
  downloadBlob(new Blob([text], { type: 'text/calendar;charset=utf-8' }), filename);
  window.__lastIcs = text;
}

hubChangeHandlers.push((target) => {
  if (target.id === 'calDept') { cal.dept = target.value; cal.division = ''; renderCalendar(); return true; }
  if (target.id === 'calDivision') { cal.division = target.value; renderCalendar(); return true; }
  return false;
});

// ==========================================
// 3. ATTENDANCE
// ==========================================
// Teachers: one class at a time (classKey is "department|division", lower-cased). Students: their own marks.
const att = { classKey: '', sessions: null, loadedFor: null, loading: false, error: '' };

// The classes there are, from the students' profiles
function classList() {
  const seen = new Map();
  students().forEach(person => {
    if (!person.department) return;
    const key = `${norm(person.department)}|${norm(person.division)}`;
    if (!seen.has(key)) seen.set(key, { key, department: person.department, division: person.division || '', label: classLabel(person) });
  });
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const classStudents = (klass) => students().filter(person => norm(person.department) === norm(klass.department) && norm(person.division) === norm(klass.division));
const percent = (attended, total) => (total ? Math.round(attended / total * 100) : 0);

async function loadAttendance(force) {
  const forKey = isTeacher() ? att.classKey : 'me';
  if (!forKey || att.loading || (!force && att.loadedFor === forKey)) return;
  att.loading = true;
  att.error = '';
  try {
    let query = '';
    if (isTeacher()) {
      const klass = classList().find(item => item.key === att.classKey);
      query = `?department=${encodeURIComponent(klass.department)}&division=${encodeURIComponent(klass.division)}`;
    }
    const data = await api(`/api/college-hub/attendance${query}`);
    att.sessions = data.sessions;
    att.loadedFor = forKey;
  } catch (err) {
    att.error = err.message;
  } finally {
    att.loading = false;
    if (view.tab === 'attendance') renderAttendance();
  }
}

function renderAttendance() {
  if (isTeacher()) return renderTeacherAttendance();
  const sessions = att.loadedFor === 'me' ? att.sessions : null;
  el('attendanceBar').innerHTML = `<h2 class="ch-bar-title">My attendance<small>${sessions ? plural(sessions.length, 'class', 'classes') : ''}</small></h2>`;
  if (!sessions) {
    el('attendanceBody').innerHTML = att.error ? `<div class="ch-empty">${icon('cloud_off')}<h3>Could not load attendance</h3><p>${escapeHtml(att.error)}</p></div>` : '<div class="skeleton" style="height:160px"></div>';
    return loadAttendance();
  }
  if (!sessions.length) {
    el('attendanceBody').innerHTML = `<div class="ch-empty">${icon('fact_check')}<h3>No attendance yet</h3><p>When a teacher takes attendance in your class, your record shows up here.</p></div>`;
    return;
  }
  const statusOf = (session) => session.marks[String(hub.me.id)];
  const attended = sessions.filter(session => statusOf(session) !== 'absent').length;
  const overall = percent(attended, sessions.length);
  const subjects = new Map();
  sessions.forEach(session => {
    const name = session.subject || 'No subject';
    if (!subjects.has(name)) subjects.set(name, { total: 0, attended: 0 });
    const entry = subjects.get(name);
    entry.total += 1;
    if (statusOf(session) !== 'absent') entry.attended += 1;
  });
  const low = overall < ATTENDANCE_LOW;
  el('attendanceBody').innerHTML = `
    <div class="ch-att-top">
      <div class="ch-panel ch-att-big${low ? ' is-low' : ''}"><b>${overall}%</b><span>overall · ${attended} of ${plural(sessions.length, 'class', 'classes')} attended</span>
        <div class="ch-meter"><i style="width:${overall}%"></i></div>
        ${low ? `<p class="ch-warn-text">${icon('warning')} Under ${ATTENDANCE_LOW}%. Talk to your teachers if something is keeping you away.</p>` : ''}</div>
      ${[...subjects.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, entry]) => {
        const share = percent(entry.attended, entry.total);
        return `<div class="ch-panel ch-att-subject${share < ATTENDANCE_LOW ? ' is-low' : ''}"><span>${escapeHtml(name)}</span><b>${share}%</b><small>${entry.attended} of ${entry.total}</small><div class="ch-meter"><i style="width:${share}%"></i></div></div>`;
      }).join('')}
    </div>
    <div class="ch-panel ch-att-table-wrap">
      <table class="ch-table"><thead><tr><th>Date</th><th>Subject</th><th>Status</th></tr></thead>
      <tbody>${sessions.map(session => `<tr><td>${escapeHtml(formatDate(session.date))}</td><td>${escapeHtml(session.subject || '—')}</td><td>${statusChip(statusOf(session))}</td></tr>`).join('')}</tbody></table>
    </div>`;
}

const statusChip = (status) => status === 'present' ? '<span class="ch-chip green">Present</span>' : status === 'late' ? '<span class="ch-chip indigo">Late</span>' : '<span class="ch-chip warn">Absent</span>';

// Attendance needs the institution licence (or the free trial)
function licenceWall(what) {
  return `<div class="ch-empty">${icon('workspace_premium')}<h3>${escapeHtml(what)} comes with the institution licence</h3>
    <p>Your college's free trial has ended or has not started. The notice board, groups, chat, calendar, resources and Q&amp;A stay free.</p>
    <a class="ch-btn solid" href="pricing.html?tab=institution">${icon('sell')}See institution plans</a></div>`;
}

function renderTeacherAttendance() {
  if (!hub.licence) {
    el('attendanceBar').innerHTML = '<h2 class="ch-bar-title">Attendance</h2>';
    el('attendanceBody').innerHTML = licenceWall('Attendance');
    return;
  }
  const classes = classList();
  if (att.classKey && !classes.some(item => item.key === att.classKey)) att.classKey = '';
  if (!att.classKey && classes.length) att.classKey = classes.some(item => item.key === `${norm(hub.me.department)}|${norm(hub.me.division)}`) ? `${norm(hub.me.department)}|${norm(hub.me.division)}` : classes[0].key;
  const klass = classes.find(item => item.key === att.classKey);
  const sessions = klass && att.loadedFor === att.classKey ? att.sessions : null;

  el('attendanceBar').innerHTML = `
    <h2 class="ch-bar-title">Attendance<small>${sessions ? plural(sessions.length, 'session', 'sessions') : ''}</small></h2>
    ${classes.length ? `<select class="ch-select" id="attClass" aria-label="Class">${classes.map(item => `<option value="${escapeHtml(item.key)}" ${item.key === att.classKey ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select>` : ''}
    ${sessions && sessions.length ? `<button class="ch-btn line" type="button" data-act="att-csv">${icon('download')}Download CSV</button>` : ''}
    ${klass ? `<button class="ch-btn solid" type="button" data-act="att-take">${icon('fact_check')}Take attendance</button>` : ''}`;

  if (!klass) {
    el('attendanceBody').innerHTML = `<div class="ch-empty">${icon('fact_check')}<h3>No classes yet</h3><p>Classes come from the department and division on students' profiles.</p></div>`;
    return;
  }
  if (!sessions) {
    el('attendanceBody').innerHTML = att.error ? `<div class="ch-empty">${icon('cloud_off')}<h3>Could not load attendance</h3><p>${escapeHtml(att.error)}</p></div>` : '<div class="skeleton" style="height:160px"></div>';
    return loadAttendance();
  }
  const people = classStudents(klass);
  if (!sessions.length) {
    el('attendanceBody').innerHTML = `<div class="ch-empty">${icon('fact_check')}<h3>No attendance taken for ${escapeHtml(klass.label)} yet</h3><p>${plural(people.length, 'student', 'students')} in this class. Everyone starts as present; tap a name to mark it absent or late.</p><button class="ch-btn solid" type="button" data-act="att-take">${icon('fact_check')}Take attendance</button></div>`;
    return;
  }
  const stats = people.map(person => {
    const marked = sessions.filter(session => session.marks[String(person.id)]);
    const attended = marked.filter(session => session.marks[String(person.id)] !== 'absent').length;
    const late = marked.filter(session => session.marks[String(person.id)] === 'late').length;
    return { person, total: marked.length, attended, late, share: percent(attended, marked.length) };
  }).sort((a, b) => a.share - b.share || a.person.name.localeCompare(b.person.name));
  const lowCount = stats.filter(row => row.total && row.share < ATTENDANCE_LOW).length;
  const average = stats.length ? Math.round(stats.reduce((sum, row) => sum + row.share, 0) / stats.length) : 0;

  el('attendanceBody').innerHTML = `
    <div class="ch-att-top">
      <div class="ch-panel ch-att-big"><b>${average}%</b><span>class average over ${plural(sessions.length, 'session', 'sessions')}</span><div class="ch-meter"><i style="width:${average}%"></i></div></div>
      <div class="ch-panel ch-att-big${lowCount ? ' is-low' : ''}"><b>${lowCount}</b><span>${lowCount === 1 ? 'student is' : 'students are'} under ${ATTENDANCE_LOW}%</span></div>
    </div>
    <div class="ch-att-layout">
      <div class="ch-panel ch-att-table-wrap">
        <table class="ch-table"><thead><tr><th>Student</th><th>Attended</th><th>Late</th><th style="width:34%">Share</th></tr></thead>
        <tbody>${stats.map(row => `<tr class="${row.total && row.share < ATTENDANCE_LOW ? 'is-low' : ''}">
          <td><span class="ch-cell-person">${avatarOf(row.person)}${escapeHtml(row.person.name)}</span></td>
          <td>${row.attended} / ${row.total}</td><td>${row.late}</td>
          <td><span class="ch-cell-meter"><span class="ch-meter"><i style="width:${row.share}%"></i></span><b>${row.total ? `${row.share}%` : '—'}</b></span></td></tr>`).join('')}</tbody></table>
      </div>
      <div class="ch-panel ch-att-sessions">
        <h3>Sessions</h3>
        ${sessions.map(session => {
          const values = Object.values(session.marks);
          const count = (status) => values.filter(value => value === status).length;
          return `<div class="ch-att-session">
            <div><b>${escapeHtml(formatDate(session.date))}</b><small>${escapeHtml(session.subject || 'No subject')} · ${count('present')} present · ${count('absent')} absent${count('late') ? ` · ${count('late')} late` : ''}</small></div>
            <button class="ch-icon-btn" type="button" data-act="att-edit" data-session="${session.id}" title="Edit" aria-label="Edit session"><span class="material-symbols-outlined">edit</span></button>
            <button class="ch-icon-btn danger" type="button" data-act="att-delete" data-session="${session.id}" title="Delete" aria-label="Delete session"><span class="material-symbols-outlined">delete</span></button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

hubChangeHandlers.push((target) => {
  if (target.id !== 'attClass') return false;
  att.classKey = target.value;
  att.sessions = null;
  att.loadedFor = null;
  renderAttendance();
  return true;
});

function openAttendanceForm(session) {
  const klass = classList().find(item => item.key === att.classKey);
  if (!klass) return;
  const people = classStudents(klass);
  const marks = new Map(people.map(person => [person.id, session ? (session.marks[String(person.id)] || 'absent') : 'present']));
  const subjects = [...new Set((att.sessions || []).map(item => item.subject).filter(Boolean))];
  const cycle = { present: 'absent', absent: 'late', late: 'present' };
  const draw = () => {
    el('attList').innerHTML = people.map(person => `<button type="button" class="ch-att-pick s-${marks.get(person.id)}" data-pick="${person.id}">
      ${avatarOf(person)}<span>${escapeHtml(person.name)}</span><em>${marks.get(person.id)}</em></button>`).join('');
    const values = [...marks.values()];
    el('attCount').textContent = `${values.filter(v => v === 'present').length} present · ${values.filter(v => v === 'absent').length} absent · ${values.filter(v => v === 'late').length} late`;
  };
  openHubModal({
    title: session ? `Edit attendance: ${klass.label}` : `Take attendance: ${klass.label}`,
    confirmText: 'Save attendance',
    wide: true,
    body: `
      <div class="ch-row2">
        <label>Subject <small>(optional)</small><input class="ch-input" id="attSubject" maxlength="80" list="attSubjects" value="${escapeHtml(session ? session.subject : '')}" placeholder="For example: Operating Systems"><datalist id="attSubjects">${subjects.map(name => `<option value="${escapeHtml(name)}">`).join('')}</datalist></label>
        <label>Date<input class="ch-input" id="attDate" type="date" value="${escapeHtml(session ? session.date : today())}"></label>
      </div>
      <div class="ch-review-tools"><span class="ch-muted">Tap a name to switch present → absent → late.</span>
        <span><button class="ch-btn line small" type="button" data-all="present">All present</button> <button class="ch-btn line small" type="button" data-all="absent">All absent</button></span></div>
      <div class="ch-att-picks" id="attList"></div>
      <p class="ch-muted" id="attCount"></p>`,
    onOpen: () => {
      draw();
      el('hubModalBody').onclick = (e) => {
        const pick = e.target.closest('[data-pick]');
        if (pick) { const id = Number(pick.dataset.pick); marks.set(id, cycle[marks.get(id)]); return draw(); }
        const all = e.target.closest('[data-all]');
        if (all) { people.forEach(person => marks.set(person.id, all.dataset.all)); draw(); }
      };
    },
    onConfirm: async () => {
      if (!people.length) throw new Error('There is no one in this class.');
      const body = { department: klass.department, division: klass.division, subject: el('attSubject').value, date: el('attDate').value, marks: Object.fromEntries(marks) };
      if (!body.date) throw new Error('Pick the date of the class.');
      if (session) await api(`/api/college-hub/attendance/${session.id}`, { method: 'PUT', body });
      else await api('/api/college-hub/attendance', { method: 'POST', body });
      showToast('Attendance saved.');
      await loadAttendance(true);
    }
  });
}

hubActions['att-take'] = () => openAttendanceForm(null);
hubActions['att-edit'] = (button) => {
  const session = (att.sessions || []).find(item => item.id === Number(button.dataset.session));
  if (session) openAttendanceForm(session);
};
hubActions['att-delete'] = (button) => {
  const session = (att.sessions || []).find(item => item.id === Number(button.dataset.session));
  if (!session) return;
  confirmThen('Delete this session?', `The attendance of ${formatDate(session.date)}${session.subject ? ` (${session.subject})` : ''} is removed for every student.`, 'Delete',
    () => run(async () => { await api(`/api/college-hub/attendance/${session.id}`, { method: 'DELETE' }); await loadAttendance(true); }, 'Session deleted.'));
};
hubActions['att-csv'] = () => {
  const klass = classList().find(item => item.key === att.classKey);
  const sessions = [...(att.sessions || [])].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const letter = { present: 'P', absent: 'A', late: 'L' };
  const rows = [['Student', ...sessions.map(session => `${session.date}${session.subject ? ` ${session.subject}` : ''}`), 'Attended', 'Total', 'Share']];
  classStudents(klass).forEach(person => {
    const values = sessions.map(session => session.marks[String(person.id)] || '');
    const total = values.filter(Boolean).length;
    const attended = values.filter(value => value && value !== 'absent').length;
    rows.push([person.name, ...values.map(value => letter[value] || ''), attended, total, total ? `${percent(attended, total)}%` : '']);
  });
  downloadCsv(rows, `${fileSafe(klass.label)}-attendance.csv`);
};
