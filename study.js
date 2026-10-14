// ==========================================
// STUDY.JS — The My Study page: loading, the tab bar, shared helpers and the Today tab.
// Each other tab lives in its own file (study-timetable.js, study-attendance.js, study-planner.js,
// study-grades.js, study-timer.js) and adds itself to studyRender / studyActions / studyChanges.
// Loaded after shared.js, chat-common.js and formsheet.js. initStudy() is called at the end of study.html.
// ==========================================

const STUDY_TABS = [
  ['today', 'Today', 'today'], ['timetable', 'Timetable', 'calendar_view_week'], ['attendance', 'Attendance', 'how_to_reg'],
  ['planner', 'Planner', 'checklist'], ['grades', 'Grades', 'school'], ['timer', 'Timer', 'timer']
];
const STUDY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const STUDY_REFRESH_MS = 60000;
const STUDY_MIN_CLASSES = 4;      // below this many classes a percentage is shown but not judged
const MARK_LABELS = { present: 'Present', absent: 'Absent', cancelled: 'No class' };

let study = null;                 // what /api/study returned, or null before the first load
let studyLoading = false;
let studyLoadedAt = 0;
const studyView = { tab: 'today', day: 0, date: '', planFilter: 'all', showDone: false };

const studyRender = {};           // tab name -> function returning the tab's HTML
const studyActions = {};          // data-act value -> function(button, event)
const studyChanges = {};          // data-change value -> function(input, event)

const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// ==========================================
// 1. LOADING
// ==========================================
function initStudy() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (STUDY_TABS.some(([name]) => name === tab)) studyView.tab = tab;
  bindStudy();

  const cached = cacheGet('study');
  if (cached && cached.subjects) setStudy(cached);
  else el('studyPanel').innerHTML = `<div class="hm-card"><div class="hm-list">${'<div class="skeleton hm-skel"></div>'.repeat(3)}</div></div>`;
  renderStudyTabs();

  loadStudy();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - studyLoadedAt > STUDY_REFRESH_MS && !document.querySelector('.fs-overlay')) loadStudy();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadStudy(); });
}

async function loadStudy() {
  if (studyLoading) return;
  studyLoading = true;
  try {
    const data = await fetchPageData('/api/study');
    studyLoadedAt = Date.now();
    setStudy(data);
  } catch (err) {
    if (!study) {
      el('studyPanel').innerHTML = `<div class="hm-card hm-problem">${icon('cloud_off')}<p>${escapeHtml(err.message)}</p>
        <button class="hm-btn" type="button" data-act="retry">Try again</button></div>`;
    }
  } finally {
    studyLoading = false;
  }
}

function setStudy(data) {
  study = data;
  if (!studyView.date) studyView.date = data.today;
  if (!studyView.dayPicked) studyView.day = data.weekday;
  storeStudy();
  renderStudy();
}

function storeStudy() {
  cacheSet('study', study);
}

// ==========================================
// 2. SHARED HELPERS
// ==========================================
const subjectOf = (id) => study.subjects.find(subject => subject.id === id);
const liveSubjects = () => study.subjects.filter(subject => !subject.archived);
const subjectOptions = (withNone) => [...(withNone ? [['', withNone]] : []), ...liveSubjects().map(subject => [subject.id, subject.name])];

// "13:05" -> "1:05 PM"
function clock(time) {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

function minutesText(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

function dateShift(date, days) {
  const moved = new Date(`${date}T12:00:00`);
  moved.setDate(moved.getDate() + days);
  return `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}-${String(moved.getDate()).padStart(2, '0')}`;
}

const weekdayOf = (date) => (new Date(`${date}T12:00:00`).getDay() + 6) % 7;      // 0 = Monday, as the server counts
const daysUntil = (date) => Math.round((Date.parse(date) - Date.parse(study.today)) / 86400000);

function dayLabel(date) {
  const days = daysUntil(date);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';
  if (days === 1) return 'Tomorrow';
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function dueText(date) {
  const days = daysUntil(date);
  if (days < 0) return `${plural(-days, 'day', 'days')} late`;
  if (days <= 1) return dayLabel(date);
  if (days <= 14) return `In ${days} days`;
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

const slotsOn = (weekday) => study.slots.filter(slot => slot.weekday === weekday && subjectOf(slot.subject_id) && !subjectOf(slot.subject_id).archived)
  .sort((a, b) => a.start_time.localeCompare(b.start_time));

// Where a subject stands against its goal. The same sums as attendance_state() on the server.
function attendanceState(subject) {
  const present = subject.base_attended + subject.present;
  const total = subject.base_total + subject.present + subject.absent;
  const goal = subject.goal;
  const state = { present, total, percent: total ? Math.round(present * 100 / total) : null, canMiss: 0, need: 0, below: false };
  if (!total || goal <= 0) return state;
  if (present * 100 >= goal * total) state.canMiss = Math.floor((present * 100 - goal * total) / goal);
  else {
    state.below = true;
    state.need = goal < 100 ? Math.ceil((goal * total - present * 100) / (100 - goal)) : null;
  }
  return state;
}

function attendanceAdvice(subject) {
  const state = attendanceState(subject);
  if (!state.total) return 'No classes marked yet.';
  if (state.below) return state.need === null ? `${subject.goal}% can no longer be reached.` : `Attend the next ${plural(state.need, 'class', 'classes')} to reach ${subject.goal}%.`;
  if (state.canMiss === 0) return `Right on ${subject.goal}%. Do not miss the next class.`;
  return `You can miss ${plural(state.canMiss, 'more class', 'more classes')} and stay at ${subject.goal}%.`;
}

const markOf = (subjectId, date, slotId) => {
  const found = study.marks.find(mark => mark.subject_id === subjectId && mark.date === date && mark.slot_id === slotId);
  return found ? found.status : '';
};

// One tap on Present / Absent / No class. The page changes at once. The taps are sent to the server one after
// another, in the order they were made, so quick taps on the same class cannot overtake each other.
let markQueue = Promise.resolve();

function setMark(subjectId, date, slotId, status) {
  const subject = subjectOf(subjectId);
  if (!subject) return Promise.resolve();
  const before = markOf(subjectId, date, slotId);
  const next = before === status ? '' : status;      // tapping the chosen one again takes it back
  if (before) subject[before] = Math.max(0, subject[before] - 1);
  if (next) subject[next] += 1;
  study.marks = study.marks.filter(mark => !(mark.subject_id === subjectId && mark.date === date && mark.slot_id === slotId));
  if (next) study.marks.push({ subject_id: subjectId, date, slot_id: slotId, status: next });
  renderStudy();
  markQueue = markQueue.then(async () => {
    try {
      await api('/api/study/attendance', { method: 'POST', body: { subject_id: subjectId, date, slot_id: slotId, status: next } });
      storeStudy();
    } catch (err) {
      // What the page shows may no longer be what the server holds: read it again
      showToast(err.message);
      await loadStudy();
    }
  });
  return markQueue;
}

// The three buttons for one class on one day
function markButtonsHtml(subjectId, date, slotId) {
  const current = markOf(subjectId, date, slotId);
  return `<span class="st-marks" role="group" aria-label="Attendance">${['present', 'absent', 'cancelled'].map(status =>
    `<button type="button" class="st-mark is-${status}" data-act="mark" data-subject="${subjectId}" data-date="${date}" data-slot="${slotId}" data-status="${status}" aria-pressed="${current === status}">${MARK_LABELS[status]}</button>`).join('')}</span>`;
}

function emptyHtml(symbol, title, text, buttons) {
  return `<div class="st-empty">${icon(symbol)}<strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p>${buttons ? `<div class="st-empty-actions">${buttons}</div>` : ''}</div>`;
}

// ==========================================
// 3. RENDERING
// ==========================================
function renderStudyTabs() {
  el('studyTabs').innerHTML = STUDY_TABS.map(([name, label, symbol]) =>
    `<button type="button" role="tab" class="st-tab" data-tab="${name}" aria-selected="${studyView.tab === name}">${icon(symbol)}<span>${label}</span></button>`).join('');
  // On a phone the strip scrolls sideways: keep the chosen tab on screen
  const chosen = el('studyTabs').querySelector('[aria-selected="true"]');
  if (chosen) el('studyTabs').scrollLeft = Math.max(0, chosen.offsetLeft - el('studyTabs').offsetLeft - 16);
}

function renderStudy() {
  if (!study) return;
  renderStudyTabs();
  // Keep the keyboard where it was when a tap redraws the tab
  el('studyPanel').innerHTML = studyRender[studyView.tab]();
  if (studyView.tab === 'timer' && typeof paintTimer === 'function') paintTimer();
}

function openStudyTab(tab) {
  studyView.tab = tab;
  history.replaceState(null, '', tab === 'today' ? window.location.pathname : `?tab=${tab}`);
  renderStudy();
  window.scrollTo({ top: 0 });
}

// ---------- the Today tab ----------
function todayClassesHtml() {
  const slots = slotsOn(study.weekday);
  if (!slots.length) {
    return `<section class="hm-card"><div class="hm-head"><h2>Today's classes</h2><a href="?tab=timetable" data-tab="timetable">Timetable</a></div>
      <p class="hm-note">No classes on your timetable for ${STUDY_DAYS[study.weekday]}.</p></section>`;
  }
  const now = new Date();
  const nowText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = slots.find(slot => slot.start_time > nowText);
  const rows = slots.map(slot => {
    const subject = subjectOf(slot.subject_id);
    const on = slot.start_time <= nowText && nowText < slot.end_time;
    const badge = on ? '<span class="st-badge is-now">Now</span>' : (slot === next ? '<span class="st-badge">Next</span>' : '');
    return `
      <div class="st-class${on ? ' is-now' : ''}">
        <div class="st-class-time"><b>${clock(slot.start_time)}</b><small>${clock(slot.end_time)}</small></div>
        <div class="st-class-text"><strong>${escapeHtml(subject.name)} ${badge}</strong>
          <small>${[slot.kind !== 'lecture' ? slot.kind[0].toUpperCase() + slot.kind.slice(1) : '', slot.room ? `Room ${escapeHtml(slot.room)}` : ''].filter(Boolean).join(' · ') || 'Lecture'}</small></div>
        ${markButtonsHtml(subject.id, study.today, slot.id)}
      </div>`;
  }).join('');
  return `<section class="hm-card"><div class="hm-head"><h2>Today's classes</h2><a href="?tab=timetable" data-tab="timetable">Timetable</a></div><div class="st-classes">${rows}</div></section>`;
}

function dueSoonHtml() {
  const tasks = study.tasks.filter(task => !task.done && task.due_date && daysUntil(task.due_date) <= 7).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const hub = study.hub_deadlines.filter(item => item.due && daysUntil(item.due) <= 7);
  if (!tasks.length && !hub.length) {
    return `<section class="hm-card"><div class="hm-head"><h2>Due soon</h2><a href="?tab=planner" data-tab="planner">Planner</a></div>
      <p class="hm-note">Nothing is due in the next 7 days.</p>
      <div class="st-row-actions"><button class="hm-btn is-quiet" type="button" data-act="add-task">${icon('add')}Add work or an exam</button></div></section>`;
  }
  return `<section class="hm-card"><div class="hm-head"><h2>Due soon<span class="hm-count">${tasks.length + hub.length}</span></h2><a href="?tab=planner" data-tab="planner">Planner</a></div>
    <div class="hm-list">${tasks.map(taskRowHtml).join('')}${hub.map(hubRowHtml).join('')}</div></section>`;
}

function attendanceGlanceHtml() {
  const subjects = liveSubjects().map(subject => ({ subject, state: attendanceState(subject) })).filter(entry => entry.state.total > 0);
  if (!subjects.length) return '';
  const low = subjects.filter(entry => entry.state.below && entry.state.total >= STUDY_MIN_CLASSES);
  const body = low.length
    ? low.map(({ subject, state }) => `
        <a class="hm-row is-urgent" href="?tab=attendance" data-tab="attendance"><span class="hm-icon">${icon('warning')}</span>
          <span class="hm-row-text"><strong>${escapeHtml(subject.name)}: ${state.percent}%</strong><small>${escapeHtml(attendanceAdvice(subject))}</small></span></a>`).join('')
    : `<div class="hm-clear"><span class="hm-icon is-good">${icon('task_alt')}</span><span><strong>Every subject is above its goal</strong>
         <small>Lowest: ${escapeHtml(subjects.sort((a, b) => a.state.percent - b.state.percent)[0].subject.name)} at ${subjects[0].state.percent}%.</small></span></div>`;
  return `<section class="hm-card"><div class="hm-head"><h2>Attendance</h2><a href="?tab=attendance" data-tab="attendance">All subjects</a></div><div class="hm-list">${body}</div></section>`;
}

function focusGlanceHtml() {
  const timer = study.timer;
  return `<section class="hm-card"><div class="hm-head"><h2>Focus</h2></div>
    <div class="hm-stats">
      <div class="hm-stat"><b>${timer.streak}</b><span>${timer.streak === 1 ? 'day in a row' : 'days in a row'}</span></div>
      <div class="hm-stat"><b>${minutesText(timer.today)}</b><span>studied today</span></div>
    </div>
    <div class="st-row-actions"><button class="hm-btn" type="button" data-tab="timer">${icon('timer')}Start a focus session</button></div></section>
    ${practiceGlanceHtml()}`;
}

function practiceGlanceHtml() {
  const practice = study.practice;
  if (!practice || !practice.total_today) return '';
  const done = practice.done_today >= practice.total_today;
  return `<section class="hm-card"><div class="hm-head"><h2>Daily practice</h2></div>
    <a class="hm-row" href="practice.html"><span class="hm-icon${done ? ' is-good' : ''}">${icon(done ? 'task_alt' : 'quiz')}</span>
      <span class="hm-row-text"><strong>${done ? 'Done for today' : `${practice.done_today} of ${practice.total_today} done today`}</strong>
        <small>${practice.streak ? `${practice.streak} day streak` : 'One aptitude and one coding question'}</small></span>
      ${done ? '' : '<span class="hm-due">2 min</span>'}</a></section>`;
}

function remindersHtml() {
  const settings = study.settings;
  const row = (key, title, text) => `
    <div class="hm-reach"><div class="hm-reach-top"><strong>${title}</strong>
      <label class="hm-switch"><input type="checkbox" data-change="setting" data-key="${key}" aria-label="${title}" ${settings[key] ? 'checked' : ''}/><i></i></label></div>
      <p>${text}</p></div>`;
  return `<section class="hm-card"><div class="hm-head"><h2>Reminders</h2></div>
    ${row('remind_classes', 'Before each class', 'About 10 minutes before a class on your timetable.')}
    ${row('remind_tasks', 'Due tomorrow', 'In the evening, for work and exams due the next day.')}
    ${study.push_devices ? '' : `<p class="st-hint">${icon('info')}<span>Reminders reach your phone once notifications are on. <a href="home.html">Turn them on from Home</a>.</span></p>`}
  </section>`;
}

function welcomeHtml() {
  const canImport = study.class_timetable.slots > 0;
  return `<section class="hm-card">${emptyHtml('auto_stories', 'Set up your semester', 'Add your subjects and weekly classes once. After that, marking attendance and seeing your day takes one tap.',
    `${canImport ? `<button class="hm-btn" type="button" data-act="import-class">${icon('download')}Use my class timetable</button>` : ''}
     <button class="hm-btn${canImport ? ' is-quiet' : ''}" type="button" data-act="add-subject">${icon('add')}Add a subject</button>`)}</section>`;
}

studyRender.today = () => {
  const started = liveSubjects().length > 0;
  return `
    <div class="hm-grid">
      <div class="hm-main">${started ? todayClassesHtml() : welcomeHtml()}${dueSoonHtml()}</div>
      <aside class="hm-side">${attendanceGlanceHtml()}${focusGlanceHtml()}${remindersHtml()}</aside>
    </div>`;
};

// ==========================================
// 4. CONTROLS
// ==========================================
studyActions.retry = () => loadStudy();
studyActions.mark = (button) => setMark(Number(button.dataset.subject), button.dataset.date, Number(button.dataset.slot), button.dataset.status);

studyChanges.setting = async (input) => {
  const key = input.dataset.key;
  const wanted = input.checked;
  input.disabled = true;
  try {
    study.settings = await api('/api/study/settings', { method: 'PUT', body: { [key]: wanted } });
    storeStudy();
  } catch (err) {
    showToast(err.message);
  }
  renderStudy();
};

function bindStudy() {
  document.querySelector('.st-page').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { e.preventDefault(); return openStudyTab(tab.dataset.tab); }
    const button = e.target.closest('[data-act]');
    if (!button || button.disabled || !studyActions[button.dataset.act]) return;
    studyActions[button.dataset.act](button, e);
  });
  document.querySelector('.st-page').addEventListener('change', (e) => {
    const input = e.target.closest('[data-change]');
    if (input && studyChanges[input.dataset.change]) studyChanges[input.dataset.change](input, e);
  });
}
