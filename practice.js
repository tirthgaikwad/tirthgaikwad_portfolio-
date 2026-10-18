// ==========================================
// PRACTICE.JS — Daily practice: one aptitude and one coding question a day, a streak, points and a college leaderboard.
// The right answer only reaches the browser after the student has answered.
// Loaded after shared.js, chat-common.js and formsheet.js.
// ==========================================

const PRACTICE_REFRESH_MS = 60000;
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

let practice = null;              // what /api/practice returned, or null before the first load
let practiceLoading = false;
let practiceLoadedAt = 0;
const practiceView = { board: 'week', open: '' };      // open: "day|question id" of the earlier question on screen
const practicePending = new Set();

const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// ==========================================
// 1. LOADING
// ==========================================
function initPractice() {
  bindPractice();
  const cached = cacheGet('practice');
  if (cached && cached.daily) { practice = cached; renderPractice(); }
  else el('practiceToday').innerHTML = '<div class="hm-card"><div class="skeleton hm-skel"></div><div class="skeleton hm-skel" style="margin-top:8px"></div></div>';
  loadPractice();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - practiceLoadedAt > PRACTICE_REFRESH_MS && !document.querySelector('.fs-overlay')) loadPractice();
  });
}

async function loadPractice() {
  if (practiceLoading) return;
  practiceLoading = true;
  try {
    practice = await fetchPageData('/api/practice');
    practiceLoadedAt = Date.now();
    cacheSet('practice', practice);
    renderPractice();
  } catch (err) {
    if (!practice) {
      el('practiceToday').innerHTML = `<div class="hm-card hm-problem">${icon('cloud_off')}<p>${escapeHtml(err.message)}</p><button class="hm-btn" type="button" data-act="retry">Try again</button></div>`;
    }
  } finally {
    practiceLoading = false;
  }
}

// ==========================================
// 2. RENDERING
// ==========================================
function questionHtml(question, isDaily) {
  const mine = question.mine;
  const busy = practicePending.has(question.id);
  const options = question.options.map((option, index) => {
    const state = !mine ? '' : (index === mine.answer ? ' is-right' : (index === mine.chosen ? ' is-wrong' : ''));
    return `<button type="button" class="pr-option${state}" data-act="answer" data-choice="${index}" ${mine || busy ? 'disabled' : ''}>
      <b>${LETTERS[index]}</b><span>${escapeHtml(option)}</span>${mine && index === mine.answer ? icon('check_circle') : (mine && index === mine.chosen ? icon('cancel') : '')}</button>`;
  }).join('');
  const verdict = !mine ? '' : `
    <div class="pr-why ${mine.correct ? 'is-right' : 'is-wrong'}" role="status">
      <strong>${mine.correct ? 'Correct' : `Not this time. The answer is ${LETTERS[mine.answer]}`}${mine.points ? ` · +${mine.points} points` : ''}</strong>
      ${mine.explanation ? `<p>${escapeHtml(mine.explanation)}</p>` : ''}</div>`;
  return `
    <section class="hm-card pr-q" data-id="${question.id}" data-daily="${isDaily ? 1 : 0}">
      <div class="hm-head"><h2><span class="st-badge pr-track">${escapeHtml(question.track_label)}</span>${escapeHtml(question.topic)}</h2>
        <span class="hm-note">${mine ? '' : (isDaily ? 'Worth 10 points' : 'Practice, no points')}</span></div>
      <p class="pr-text">${escapeHtml(question.question)}</p>
      ${question.code ? `<pre class="pr-code"><code>${escapeHtml(question.code)}</code></pre>` : ''}
      <div class="pr-options">${options}</div>
      ${verdict}
    </section>`;
}

function archiveHtml() {
  if (!practice.archive.length) return '';
  const dayName = (day) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const rows = practice.archive.map(question => {
    const key = `${question.day}|${question.id}`;
    const mine = question.mine;
    const open = practiceView.open === key;
    const state = !mine ? `<span class="hm-due">Try it</span>` : `<span class="pr-mark ${mine.correct ? 'is-right' : 'is-wrong'}">${icon(mine.correct ? 'check_circle' : 'cancel')}</span>`;
    return `
      <div class="pr-past${open ? ' is-open' : ''}">
        <button type="button" class="pr-past-row" data-act="open" data-key="${key}" aria-expanded="${open}">
          <span class="pr-past-day">${escapeHtml(dayName(question.day))}</span>
          <span class="pr-past-text"><strong>${escapeHtml(question.topic)}</strong><small>${escapeHtml(question.track_label)}</small></span>
          ${state}${icon(open ? 'expand_less' : 'expand_more')}
        </button>
        ${open ? questionHtml(question, false) : ''}
      </div>`;
  }).join('');
  const missed = practice.archive.filter(question => !question.mine).length;
  return `<section class="hm-card"><div class="hm-head"><h2>Earlier days</h2><span class="hm-note">${missed ? `${missed} not tried` : 'All done'}</span></div>
    <p class="hm-note pr-note">Catch up on the last two weeks. Earlier questions are for practice and do not add points.</p>${rows}</section>`;
}

function boardHtml() {
  const rows = practice.leaderboard[practiceView.board];
  const tabs = [['week', 'This week'], ['all', 'All time']].map(([value, label]) =>
    `<button type="button" class="st-chip" data-act="board" data-value="${value}" aria-pressed="${practiceView.board === value}">${label}</button>`).join('');
  const list = rows.length ? rows.map((row, index) => `
      <div class="pr-rank${row.me ? ' is-me' : ''}">
        <b>${index + 1}</b>
        <a href="profile.html?id=${row.id}">${escapeHtml(row.me ? `${row.name} (you)` : row.name)}</a>
        <span>${row.points}</span>
      </div>`).join('')
    : `<p class="hm-note">Nobody has points ${practiceView.board === 'week' ? 'this week' : ''} yet. Answer today's questions and take the first place.</p>`;
  return `<section class="hm-card"><div class="hm-head"><h2>Leaderboard</h2></div>
    <p class="hm-note pr-note">${practice.college ? escapeHtml(practice.college) : 'Add your college to your profile to compete with your classmates.'}</p>
    <div class="st-chips">${tabs}</div>${list}</section>`;
}

function renderPractice() {
  const stats = practice.stats;
  const done = practice.daily.filter(question => question.mine).length;
  el('practiceSub').textContent = !practice.daily.length ? 'No questions are loaded yet.'
    : done === practice.daily.length ? `Both done for today. Come back tomorrow to keep your streak.`
    : `${plural(practice.daily.length - done, 'question', 'questions')} waiting today. It takes about two minutes.`;
  el('practiceToday').innerHTML = practice.daily.length
    ? practice.daily.map(question => questionHtml(question, true)).join('')
    : `<div class="hm-card"><div class="st-empty">${icon('quiz')}<strong>No questions yet</strong><p>The question bank is empty. Questions appear here once it is loaded.</p></div></div>`;
  el('practiceArchive').innerHTML = archiveHtml();
  const accuracy = stats.answered ? Math.round(stats.correct * 100 / stats.answered) : null;
  el('practiceSide').innerHTML = `
    <section class="hm-card"><div class="hm-head"><h2>Your numbers</h2></div>
      <div class="hm-stats">
        <div class="hm-stat"><b>${stats.streak}</b><span>${stats.streak === 1 ? 'day in a row' : 'days in a row'}</span></div>
        <div class="hm-stat"><b>${stats.points}</b><span>points in all</span></div>
        <div class="hm-stat"><b>${stats.week_points}</b><span>points this week</span></div>
        <div class="hm-stat"><b>${accuracy === null ? '–' : `${accuracy}%`}</b><span>${stats.answered ? `right, of ${stats.answered} answered` : 'nothing answered yet'}</span></div>
      </div></section>
    ${boardHtml()}
    ${practice.founder ? `<section class="hm-card"><div class="hm-head"><h2>Question bank</h2></div>
      <p class="hm-note">${practice.bank.aptitude} aptitude and ${practice.bank.coding} coding questions. Each list starts again when it ends.</p>
      <div class="st-row-actions"><button class="hm-btn" type="button" data-act="add-question">${icon('add')}Add a question</button></div></section>` : ''}`;
}

// ==========================================
// 3. ANSWERING
// ==========================================
function findQuestion(card) {
  const id = Number(card.dataset.id);
  if (card.dataset.daily === '1') return practice.daily.find(question => question.id === id);
  const [day] = practiceView.open.split('|');
  return practice.archive.find(question => question.id === id && question.day === day);
}

async function answerQuestion(card, choice) {
  const question = findQuestion(card);
  if (!question || question.mine || practicePending.has(question.id)) return;
  practicePending.add(question.id);
  renderPractice();
  try {
    const result = await api('/api/practice/answer', { method: 'POST', body: { question_id: question.id, chosen: choice } });
    const mine = { chosen: choice, correct: result.correct, points: result.points, answer: result.answer, explanation: result.explanation };
    // The same question can be on screen twice (today and in the earlier days): both show the answer now
    [...practice.daily, ...practice.archive].forEach(entry => { if (entry.id === question.id && !entry.mine) entry.mine = { ...mine, points: entry === question ? mine.points : 0 }; });
    practice.stats.streak = result.streak;
    practice.stats.points += result.points;
    if (result.daily) practice.stats.week_points += result.points;
    practice.stats.answered += 1;
    if (result.correct) practice.stats.correct += 1;
    cacheSet('practice', practice);
    practicePending.delete(question.id);
    renderPractice();
    showXpPop(result.xp);
    if (result.points) loadPractice();      // the leaderboard moved
  } catch (err) {
    practicePending.delete(question.id);
    showToast(err.message);
    if (err.status === 409) await loadPractice(); else renderPractice();
  }
}

function openQuestionForm() {
  const choice = (number) => ({ name: `option${number}`, label: `Choice ${LETTERS[number - 1]}`, required: number <= 2, maxlength: 300, half: true });
  openSheet({
    title: 'Add a practice question', submitLabel: 'Add',
    note: 'It joins the end of its list and comes up as a daily question in turn.',
    fields: [
      { name: 'track', label: 'List', type: 'select', options: [['aptitude', 'Aptitude'], ['coding', 'Coding and CS']], half: true },
      { name: 'topic', label: 'Topic', maxlength: 60, placeholder: 'Percentages', half: true },
      { name: 'question', label: 'Question', type: 'textarea', required: true, maxlength: 1200 },
      { name: 'code', label: 'Code shown under it (optional)', type: 'textarea', maxlength: 3000 },
      choice(1), choice(2), choice(3), choice(4),
      { name: 'answer', label: 'The right choice', type: 'select', options: LETTERS.slice(0, 4).map((letter, index) => [index, letter]), half: true },
      { name: 'explanation', label: 'Why (shown after answering)', type: 'textarea', maxlength: 1500 }
    ],
    onSubmit: async (values) => {
      const options = [values.option1, values.option2, values.option3, values.option4].filter(Boolean);
      if (Number(values.answer) >= options.length) throw new Error('The right choice points at an empty choice.');
      await api('/api/founder/practice-questions', { method: 'POST', body: {
        track: values.track, topic: values.topic, question: values.question, code: values.code, options, answer: Number(values.answer), explanation: values.explanation } });
      showToast('Added to the list.');
      await loadPractice();
    }
  });
}

// ==========================================
// 4. CONTROLS
// ==========================================
function bindPractice() {
  document.querySelector('.st-page').addEventListener('click', (e) => {
    const button = e.target.closest('[data-act]');
    if (!button || button.disabled) return;
    const act = button.dataset.act;
    if (act === 'retry') return loadPractice();
    if (act === 'answer') return answerQuestion(button.closest('.pr-q'), Number(button.dataset.choice));
    if (act === 'open') { practiceView.open = practiceView.open === button.dataset.key ? '' : button.dataset.key; return renderPractice(); }
    if (act === 'board') { practiceView.board = button.dataset.value; return renderPractice(); }
    if (act === 'add-question') return openQuestionForm();
  });
}

initPractice();
