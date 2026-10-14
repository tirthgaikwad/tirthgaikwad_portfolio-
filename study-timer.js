// ==========================================
// STUDY-TIMER.JS — My Study, Timer tab: a focus timer (study, then a short break) that logs study time per subject.
// The running timer is kept in this browser, so leaving the page or reloading does not lose it.
// Loaded after study.js.
// ==========================================

const TIMER_KEY = 'studyTimer';
// mode: focus or break. endsAt: when a running timer finishes (ms). left: seconds left while paused.
// length: the whole stretch in seconds. subject: the subject the focus time is logged for ('' = none).
let timer = { mode: 'focus', running: false, endsAt: 0, left: 0, length: 0, subject: '' };
let timerTick = null;
const PAGE_TITLE = document.title;

const focusSeconds = () => (study ? study.settings.focus_minutes : 25) * 60;
const breakSeconds = () => (study ? study.settings.break_minutes : 5) * 60;
const timerLeft = () => timer.running ? Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000)) : timer.left;
const mmss = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

function storeTimer() {
  cacheSet(TIMER_KEY, timer);
}

function resetTimer(mode) {
  timer = { mode, running: false, endsAt: 0, left: mode === 'focus' ? focusSeconds() : breakSeconds(), length: mode === 'focus' ? focusSeconds() : breakSeconds(), subject: timer.subject };
  storeTimer();
}

function restoreTimer() {
  const saved = cacheGet(TIMER_KEY);
  if (saved && typeof saved.length === 'number' && saved.length > 0) timer = saved;
  else resetTimer('focus');
  if (timer.running) startTicking();
}

function startTicking() {
  clearInterval(timerTick);
  timerTick = setInterval(() => {
    if (!timer.running) return;
    if (timerLeft() <= 0) finishStretch();
    else paintTimer();
  }, 500);
}

// Only the clock, its ring and the tab title change every half second; the rest of the tab is left alone
function paintTimer() {
  const left = timerLeft();
  document.title = timer.running ? `${mmss(left)} ${timer.mode === 'focus' ? 'Focus' : 'Break'} · Connect2Minds` : PAGE_TITLE;
  const face = el('timerClock');
  if (!face) return;
  face.textContent = mmss(left);
  el('timerRing').style.setProperty('--done', timer.length ? 1 - left / timer.length : 0);
}

async function logFocus(minutes) {
  if (minutes < 1) return;
  try {
    await api('/api/study/sessions', { method: 'POST', body: { minutes: Math.min(180, minutes), subject_id: timer.subject ? Number(timer.subject) : null } });
    await loadStudy();
  } catch (err) {
    showToast(`Could not save that session: ${err.message}`);
  }
}

// A stretch ran out: a finished focus is logged and the break starts; a finished break waits for the next focus
function finishStretch() {
  const wasFocus = timer.mode === 'focus';
  const minutes = Math.round(timer.length / 60);
  try { playTone(880, 0.25, 0.2); setTimeout(() => playTone(1175, 0.35, 0.2), 280); } catch (e) { /* sound is optional */ }
  if (wasFocus) {
    resetTimer('break');
    timer.running = true;
    timer.endsAt = Date.now() + timer.length * 1000;
    storeTimer();
    showToast(`${minutes} minutes done. Take a break.`);
    logFocus(minutes);
  } else {
    resetTimer('focus');
    clearInterval(timerTick);
    showToast('Break is over. Ready for the next one?');
  }
  if (study && studyView.tab === 'timer') renderStudy(); else paintTimer();
}

studyActions['timer-start'] = () => {
  if (timer.left <= 0) resetTimer(timer.mode);
  timer.running = true;
  timer.endsAt = Date.now() + timer.left * 1000;
  storeTimer();
  startTicking();
  renderStudy();
};

studyActions['timer-pause'] = () => {
  timer.left = timerLeft();
  timer.running = false;
  storeTimer();
  renderStudy();
};

// Stop a focus early: the minutes already studied still count
studyActions['timer-finish'] = () => {
  const studied = Math.floor((timer.length - timerLeft()) / 60);
  const wasFocus = timer.mode === 'focus';
  clearInterval(timerTick);
  resetTimer('focus');
  renderStudy();
  if (wasFocus && studied >= 1) { showToast(`${plural(studied, 'minute', 'minutes')} logged.`); logFocus(studied); }
};

studyActions['timer-skip'] = () => { clearInterval(timerTick); resetTimer('focus'); renderStudy(); };

studyChanges['timer-subject'] = (input) => { timer.subject = input.value; storeTimer(); };

studyActions['timer-lengths'] = () => openSheet({
  title: 'Timer lengths', submitLabel: 'Save',
  fields: [
    { name: 'focus_minutes', label: 'Focus (minutes)', type: 'number', value: study.settings.focus_minutes, min: 5, max: 120, step: 5, required: true, half: true },
    { name: 'break_minutes', label: 'Break (minutes)', type: 'number', value: study.settings.break_minutes, min: 1, max: 60, step: 1, required: true, half: true }
  ],
  onSubmit: async (values) => {
    study.settings = await api('/api/study/settings', { method: 'PUT', body: values });
    storeStudy();
    if (!timer.running) resetTimer(timer.mode);
    renderStudy();
  }
});

function weekBarsHtml() {
  const days = Array.from({ length: 7 }, (_, index) => dateShift(study.today, index - 6));
  const most = Math.max(60, ...days.map(day => study.timer.by_day[day] || 0));
  return `<div class="st-bars" role="img" aria-label="Minutes studied on each of the last 7 days">${days.map(day => {
    const minutes = study.timer.by_day[day] || 0;
    return `<div class="st-bar${day === study.today ? ' is-today' : ''}" title="${minutesText(minutes)}"><i style="height:${Math.round(minutes * 100 / most)}%"></i>
      <span>${new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short' }).slice(0, 2)}</span></div>`;
  }).join('')}</div>`;
}

studyRender.timer = () => {
  // An untouched timer follows the lengths in the settings (they arrive after the page has started)
  const wanted = timer.mode === 'focus' ? focusSeconds() : breakSeconds();
  if (!timer.running && timer.left === timer.length && timer.length !== wanted) resetTimer(timer.mode);
  const paused = !timer.running && timer.left < timer.length;
  const focus = timer.mode === 'focus';
  const week = Object.entries(study.timer.week_by_subject).sort((a, b) => b[1] - a[1]);
  const weekTotal = week.reduce((sum, [, minutes]) => sum + minutes, 0);
  const controls = timer.running
    ? `<button class="hm-btn is-quiet" type="button" data-act="timer-pause">${icon('pause')}Pause</button>
       <button class="hm-btn is-quiet" type="button" data-act="${focus ? 'timer-finish' : 'timer-skip'}">${focus ? 'Finish now' : 'Skip break'}</button>`
    : `<button class="hm-btn st-big" type="button" data-act="timer-start">${icon('play_arrow')}${paused ? 'Resume' : (focus ? 'Start focus' : 'Start break')}</button>
       ${paused ? `<button class="hm-btn is-quiet" type="button" data-act="${focus ? 'timer-finish' : 'timer-skip'}">${focus ? 'Finish now' : 'Skip break'}</button>` : ''}`;
  return `
    <div class="hm-grid">
      <div class="hm-main">
        <section class="hm-card st-timer${focus ? '' : ' is-break'}">
          <div class="st-ring" id="timerRing"><div><small>${focus ? 'Focus' : 'Break'}</small><b id="timerClock">${mmss(timerLeft())}</b></div></div>
          <label class="st-timer-subject">Studying
            <select data-change="timer-subject" aria-label="Subject">${subjectOptions('No subject').map(([value, label]) => `<option value="${value}" ${String(value) === String(timer.subject) ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
          <div class="st-timer-actions">${controls}</div>
          <button type="button" class="st-fold" data-act="timer-lengths">${icon('tune')}${study.settings.focus_minutes} min focus, ${study.settings.break_minutes} min break</button>
        </section>
      </div>
      <aside class="hm-side">
        <section class="hm-card"><div class="hm-head"><h2>Your focus</h2></div>
          <div class="hm-stats">
            <div class="hm-stat"><b>${study.timer.streak}</b><span>${study.timer.streak === 1 ? 'day in a row' : 'days in a row'}</span></div>
            <div class="hm-stat"><b>${minutesText(study.timer.today)}</b><span>today</span></div>
          </div>
          ${weekBarsHtml()}
        </section>
        <section class="hm-card"><div class="hm-head"><h2>This week</h2><span class="hm-note">${minutesText(weekTotal)}</span></div>
          ${week.length ? week.map(([subjectId, minutes]) => {
            const subject = subjectOf(Number(subjectId));
            return `<div class="st-line"><span>${escapeHtml(subject ? subject.name : 'No subject')}</span><b>${minutesText(minutes)}</b></div>`;
          }).join('') : '<p class="hm-note">Finish a focus session and your hours show up here.</p>'}
        </section>
      </aside>
    </div>`;
};

restoreTimer();
