// ==========================================
// PROGRESS.JS — progress.html: XP today against the daily goal, the streak and its freezes,
// a 12-week calendar, how XP is earned. Loaded after shared.js and chat-common.js.
// ==========================================

let progress = null;
let goalSaving = false;

const pgIcon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const pgPlural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const GOAL_NAMES = { 10: ['Casual', 'About 5 minutes'], 30: ['Regular', 'About 15 minutes'], 50: ['Serious', 'About 25 minutes'], 80: ['Intense', 'About 40 minutes'] };
const RULE_HOW = {
  practice: '10 for a right answer to a daily question, 2 for trying',
  topic: '2 a question in topic practice',
  focus: '1 for every 5 minutes on the focus timer',
  card: '1 for every flashcard you review',
  quiz: '5 for finishing a quiz',
  mock: '20 for finishing a mock test',
  unit: '3 for marking a syllabus unit revised',
  contribute: '5 when you add a past-paper question or deck others use'
};

function initProgress() {
  const cached = cacheGet('progress');
  if (cached && cached.calendar) setProgress(cached);
  loadProgress();
  loadLeague();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadProgress(); loadLeague(); } });
  document.addEventListener('click', onProgressClick);
  bindCalendarTips();
}

async function loadProgress() {
  try {
    const data = await fetchPageData('/api/progress');
    setProgress(data);
    cacheSet('progress', data);
  } catch (err) {
    if (!progress) el('pgTop').innerHTML = `<div class="hm-card hm-problem">${pgIcon('cloud_off')}<p>Could not load your progress: ${escapeHtml(err.message)}</p><button class="hm-btn" type="button" data-pg-retry>Try again</button></div>`;
  }
}

function setProgress(data) {
  progress = data;
  renderTop();
  renderCalendar();
  renderToday();
  renderGoalPicker();
  renderFreezes();
  renderRules();
}

// ---------- numbers row ----------
function renderTop() {
  const p = progress;
  const left = Math.max(0, p.goal - p.xp_today);
  el('pgTop').innerHTML = `
    <div class="pg-tile pg-hero">
      ${goalRingHtml(p)}
      <div class="pg-goal-text">
        <strong>${p.goal_met ? 'Daily goal met' : `${left} XP to your goal`}</strong>
        <p>${p.goal_met ? 'Anything more today still counts for this week.' : 'Practice, focus time and flashcards all count.'}</p>
      </div>
    </div>
    <div class="pg-tile"><span>Streak</span><b>${p.streak}</b><small>${p.streak === 1 ? 'day' : 'days'} in a row</small></div>
    <div class="pg-tile"><span>Best streak</span><b>${p.best_streak}</b><small>${p.best_streak === 1 ? 'day' : 'days'}</small></div>
    <div class="pg-tile"><span>This week</span><b>${p.week_xp}</b><small>XP since Monday</small></div>`;
}

// ---------- calendar: 12 weeks, one column a week (Monday on top), one indigo scale for XP ----------
function levelOf(day) {
  if (day.frozen && !day.xp) return 'is-frozen';
  if (!day.xp) return '';
  const share = day.xp / Math.max(1, progress.goal);
  return share >= 2 ? 'l4' : share >= 1 ? 'l3' : share >= 0.5 ? 'l2' : 'l1';
}

function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderCalendar() {
  const days = progress.calendar;
  const [y, m, d] = days[0].day.split('-').map(Number);
  const pad = (new Date(y, m - 1, d).getDay() + 6) % 7;      // blanks before the first day so rows are weekdays
  const cells = Array.from({ length: pad }, () => '<span class="pg-cell is-empty"></span>');
  let metCount = 0;
  days.forEach((day) => {
    if (day.met) metCount += 1;
    const text = `${dayLabel(day.day)}: ${day.xp} XP${day.met ? ', goal met' : ''}${day.frozen ? ', streak freeze used' : ''}`;
    const classes = ['pg-cell', levelOf(day), day.met ? 'is-met' : '', day.day === progress.today ? 'is-today' : ''].filter(Boolean).join(' ');
    cells.push(`<button type="button" class="${classes}" data-tip="${escapeHtml(text)}" aria-label="${escapeHtml(text)}"></button>`);
  });
  const box = el('pgCalendar');
  box.hidden = false;
  box.innerHTML = `
    <div class="hm-head"><h2>Last 12 weeks</h2><span class="hm-note">${pgPlural(metCount, 'day', 'days')} with the goal met</span></div>
    <div class="pg-cal-wrap"><div class="pg-cal" role="group" aria-label="XP for each of the last 12 weeks, Monday at the top">${cells.join('')}</div></div>
    <div class="pg-legend">
      <span>Less <span class="pg-scale"><i class="pg-cell"></i><i class="pg-cell l1"></i><i class="pg-cell l2"></i><i class="pg-cell l3"></i><i class="pg-cell l4"></i></span> More</span>
      <span><i class="pg-cell l3 is-met"></i> Goal met</span>
      <span><i class="pg-cell is-frozen"></i> Freeze used</span>
    </div>`;
}

function bindCalendarTips() {
  const tip = document.createElement('div');
  tip.className = 'pg-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  const show = (cell) => {
    tip.textContent = cell.dataset.tip;
    tip.hidden = false;
    const box = cell.getBoundingClientRect(), width = tip.offsetWidth;
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.left + box.width / 2 - width / 2))}px`;
    tip.style.top = `${Math.max(8, box.top - tip.offsetHeight - 8)}px`;
  };
  const hide = () => { tip.hidden = true; };
  document.addEventListener('mouseover', (e) => { const cell = e.target.closest('[data-tip]'); if (cell) show(cell); else hide(); });
  document.addEventListener('focusin', (e) => { const cell = e.target.closest('[data-tip]'); if (cell) show(cell); else hide(); });
  document.addEventListener('click', (e) => { const cell = e.target.closest('[data-tip]'); if (cell) show(cell); });
  window.addEventListener('scroll', hide, { passive: true });
}

// ---------- today, by kind ----------
function renderToday() {
  const box = el('pgToday');
  const kinds = progress.by_kind.slice().sort((a, b) => b.xp - a.xp);
  box.hidden = false;
  box.innerHTML = `
    <div class="hm-head"><h2>Today</h2><span class="hm-note">${progress.xp_today} XP</span></div>
    ${kinds.length ? kinds.map((kind) => `
      <div class="pg-kind">
        <strong>${escapeHtml(kind.label)}</strong><em>${kind.xp} of ${kind.cap} a day</em>
        <div class="hm-bar" aria-hidden="true"><i style="width:${Math.min(100, Math.round(kind.xp * 100 / Math.max(1, kind.cap)))}%"></i></div>
      </div>`).join('') : `
      <div class="hm-clear">${pgIcon('bolt')}<div><strong>Nothing yet today</strong><small>Answer today's two practice questions or run a 25-minute focus session to get going.</small></div></div>
      <div class="hm-reach-actions"><a class="hm-btn" href="practice.html">Daily practice</a><a class="hm-btn is-quiet" href="study.html?tab=timer">Focus timer</a></div>`}`;
}

// ---------- daily goal ----------
function renderGoalPicker() {
  const box = el('pgGoal');
  box.hidden = false;
  box.innerHTML = `
    <div class="hm-head"><h2>Daily goal</h2></div>
    <div class="pg-goals">${progress.goals.map((goal) => {
      const [name, time] = GOAL_NAMES[goal] || [`${goal} XP`, ''];
      return `<button type="button" class="pg-goal-opt" data-goal="${goal}" aria-pressed="${goal === progress.goal}"${goalSaving ? ' disabled' : ''}><b>${name}</b><small>${goal} XP · ${time}</small></button>`;
    }).join('')}</div>`;
}

async function saveGoal(goal) {
  if (goalSaving || goal === progress.goal) return;
  goalSaving = true;
  renderGoalPicker();
  try {
    const data = await api('/api/progress/goal', { method: 'PUT', body: { goal } });
    data.rules = progress.rules;
    goalSaving = false;
    setProgress(data);
    cacheSet('progress', data);
    showToast(`Daily goal set to ${goal} XP`);
  } catch (err) {
    goalSaving = false;
    renderGoalPicker();
    showToast(err.message);
  }
}

// ---------- streak freezes ----------
function renderFreezes() {
  const f = progress.freezes, box = el('pgFreezes');
  box.hidden = false;
  if (f.used_now && f.used_now.length) showToast(`A streak freeze covered ${f.used_now.length === 1 ? 'the day you missed' : `${f.used_now.length} missed days`}. Your streak is safe.`);
  box.innerHTML = f.per_month ? `
    <div class="hm-head"><h2>Streak freezes</h2><span class="hm-note">${f.left} of ${f.per_month} left</span></div>
    <p class="hm-note">Miss a day and a freeze keeps your streak going by itself. You get ${f.per_month} every month.</p>` : `
    <div class="hm-head"><h2>Streak freezes</h2></div>
    <p class="hm-note">Busy day? With Student Pro, 2 freezes a month keep your streak going when you miss a day.</p>
    <div class="hm-reach-actions"><a class="hm-btn is-quiet" href="pricing.html">See Student Pro</a></div>`;
}

// ---------- how XP is earned ----------
function renderRules() {
  const box = el('pgRules');
  if (!progress.rules) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `
    <div class="hm-head"><h2>How to earn XP</h2></div>
    ${progress.rules.map((rule) => `<div class="pg-rule"><span>${escapeHtml(RULE_HOW[rule.kind] || rule.label)}</span><em>up to ${rule.cap} a day</em></div>`).join('')}`;
}

// ---------- the weekly league (section 36) ----------
let league = null;
let leagueTab = 'college';

async function loadLeague() {
  try { league = await api('/api/league'); renderLeague(); } catch (err) { /* the league is an extra; the rest of the page works */ }
}

function leagueRowHtml(row) {
  const medal = { 1: '🥇', 2: '🥈', 3: '🥉' }[row.rank] || '';
  return `<div class="pr-rank${row.me ? ' is-me' : ''}"><b>${medal || row.rank}</b><a href="profile.html?id=${row.id}">${escapeHtml(row.name)}${row.me ? ' (you)' : ''}</a><span>${row.xp} XP</span></div>`;
}

function renderLeague() {
  const box = el('pgLeague'), l = league;
  if (!l) return;
  const rows = leagueTab === 'college' ? l.college_table : l.following_table;
  const where = l.my_rank ? `You are <b>#${l.my_rank}</b> of ${l.players} at ${escapeHtml(l.college || 'your college')}${l.to_next ? ` · ${l.to_next} XP to pass the next person` : ''}.`
    : (l.college ? `Earn XP this week to join the league at ${escapeHtml(l.college)}.` : 'Add your college on your profile to join its league.');
  box.hidden = false;
  box.innerHTML = `
    <div class="hm-head"><h2>Weekly league</h2><span class="hm-note">${l.days_left <= 1 ? 'Ends tonight' : `${l.days_left} days left`}</span></div>
    <p class="hm-note" style="margin-bottom:12px">${where}${l.last_week ? ` Last week you came #${l.last_week.rank} of ${l.last_week.players}.` : ''}</p>
    <div class="st-chips"><button class="st-chip" type="button" data-league-tab="college" aria-pressed="${leagueTab === 'college'}">My college</button><button class="st-chip" type="button" data-league-tab="following" aria-pressed="${leagueTab === 'following'}">People I follow</button></div>
    ${rows.length ? rows.map(leagueRowHtml).join('') : '<p class="hm-note">Nobody has earned XP yet this week. Be the first.</p>'}
    ${l.badges.length ? `<p class="hm-note" style="margin-top:12px">🏆 Top three finishes: ${l.badges.length}. They show on your profile.</p>` : '<p class="hm-note" style="margin-top:12px">The top three each Monday get a badge on their profile.</p>'}`;
}

function onProgressClick(e) {
  const tab = e.target.closest('[data-league-tab]');
  if (tab) { leagueTab = tab.dataset.leagueTab; renderLeague(); return; }
  const goal = e.target.closest('[data-goal]');
  if (goal) saveGoal(Number(goal.dataset.goal));
  if (e.target.closest('[data-pg-retry]')) loadProgress();
}

initProgress();
