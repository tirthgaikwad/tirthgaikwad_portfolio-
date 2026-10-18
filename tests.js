// ==========================================
// TESTS.JS — Mock tests (tests.html). Views by the address:
//   tests.html                         the tests, my results, insights, topic practice
//   tests.html?run=KEY                 a timed test (starts it, or goes back to the one running)
//   tests.html?result=ID               a finished test, question by question
//   tests.html?section=S&topic=T       untimed topic practice
// The server keeps the clock; the page saves every answer as it is picked. Loaded after shared.js and chat-common.js.
// ==========================================

let tests = null;                  // /api/tests
let run = null;                    // the running test: the start answer plus { index, flags, openedAt, offset, timer }
let practiceSet = null;            // topic practice: { questions, index, picked, results, section, topic }
const ttIcon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const ttPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const LETTERS = 'ABCDE';

function ttRoute() {
  const q = new URLSearchParams(location.search);
  return { run: q.get('run') || '', result: Number(q.get('result')) || 0, section: q.get('section') || '', topic: q.get('topic') || '' };
}

function ttGo(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
  history.pushState({}, '', `tests.html${q.toString() ? `?${q}` : ''}`);
  renderTests();
  window.scrollTo(0, 0);
}

function initTests() {
  document.addEventListener('click', onTestsClick);
  window.addEventListener('popstate', renderTests);
  window.addEventListener('beforeunload', (e) => { if (run && !run.done) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', onTestsKey);
  renderTests();
}

async function loadTests() {
  tests = await fetchPageData('/api/tests');
  return tests;
}

async function renderTests() {
  const route = ttRoute();
  stopClock();
  try {
    if (route.run) return await startRun(route.run);
    if (route.result) return await showResult(route.result);
    if (route.section || route.topic) return await startPractice(route.section, route.topic);
    await loadTests();
    renderOverview();
    if (tests.founder) loadDrafts();
  } catch (err) {
    el('testsView').innerHTML = `<a class="pp-back" href="tests.html" data-tt-link>${ttIcon('arrow_back')}Mock tests</a><div class="hm-card hm-problem">${ttIcon('error')}<p>${escapeHtml(err.message)}</p>
      <a class="hm-btn" href="tests.html" data-tt-link>Back to the tests</a></div>`;
  }
}

// ---------- overview ----------
function renderOverview() {
  const t = tests;
  const week = t.week.limit === null || t.week.limit === undefined ? 'Unlimited tests' : `${Math.max(0, t.week.limit - t.week.used)} of ${t.week.limit} free test${t.week.limit === 1 ? '' : 's'} left this week`;
  const best = t.attempts.reduce((m, a) => Math.max(m, a.percent || 0), 0);
  const groups = [['topic', 'Topic tests'], ['pattern', 'Placement rounds']];
  el('testsView').innerHTML = `
    <section class="hm-hero">
      <div class="hm-hero-text"><p class="hm-date">Study</p><h1 class="hm-title">Mock tests</h1>
        <p class="hm-sub">Timed tests for aptitude and CS fundamentals, with every answer explained. Untimed topic practice is free and unlimited.</p></div>
      <nav class="hm-quick" aria-label="Study"><a href="practice.html">${ttIcon('quiz')}Daily practice</a><a href="tutor.html">${ttIcon('auto_awesome')}AI Tutor</a></nav>
    </section>
    ${t.running ? `<div class="tt-running">${ttIcon('timer')}<div><strong>${escapeHtml(t.running.title)} is running</strong><small>Your answers are saved. The clock keeps going.</small></div>
      <a class="hm-btn" href="tests.html?run=${t.running.test_key}" data-tt-link>Go back to it</a></div>` : ''}
    <div class="tt-strip">
      <div class="pg-tile"><span>This week</span><b>${t.week.used}</b><small>${escapeHtml(week)}</small></div>
      <div class="pg-tile"><span>Tests taken</span><b>${t.attempts.length}</b><small>in the last 30</small></div>
      <div class="pg-tile"><span>Best score</span><b>${t.attempts.length ? `${best}%` : '–'}</b><small>${t.attempts.length ? 'your highest so far' : 'take your first test'}</small></div>
    </div>
    <div class="hm-grid">
      <div class="hm-main">
        ${groups.map(([kind, label]) => `
          <section class="hm-card">
            <div class="hm-head"><h2>${label}</h2></div>
            ${kind === 'pattern' ? `<p class="hm-note" style="margin-bottom:12px">${escapeHtml(t.pattern_note)}</p>` : ''}
            <div class="tt-grid">${t.tests.filter(x => x.kind === kind).map(testCardHtml).join('')}</div>
          </section>`).join('')}
        ${t.founder ? `<section class="hm-card" id="ttDrafts"><div class="hm-head"><h2>Question bank (founder)</h2><button class="pp-small" type="button" data-tt="draft">${ttIcon('auto_awesome')}AI draft questions</button></div>
          <p class="hm-note">Drafts stay hidden until you approve each one. Check every answer before approving.</p><div id="ttDraftList"></div></section>` : ''}
        <section class="hm-card">
          <div class="hm-head"><h2>Practise a topic</h2><span class="hm-note">Free, untimed, 2 XP a question</span></div>
          ${topicChipsHtml()}
        </section>
      </div>
      <aside class="hm-side">
        ${insightsHtml()}
        <section class="hm-card">
          <div class="hm-head"><h2>Your results</h2></div>
          ${t.attempts.length ? `<div class="hm-list">${t.attempts.slice(0, 8).map(a => `
            <a class="hm-row" href="tests.html?result=${a.id}" data-tt-link>
              <span class="hm-icon${a.percent >= 70 ? ' is-good' : ''}">${ttIcon('assignment_turned_in')}</span>
              <span class="hm-row-text"><strong>${escapeHtml(a.title)}</strong><small>${a.score} of ${a.total} · ${escapeHtml(new Date(a.submitted_at).toLocaleDateString([], { day: 'numeric', month: 'short' }))}</small></span>
              <span class="hm-due">${a.percent}%</span></a>`).join('')}</div>` : '<p class="hm-note">Finished tests show here with every answer explained.</p>'}
        </section>
      </aside>
    </div>`;
}

// ---------- the founder's question drafts ----------
async function loadDrafts() {
  const box = el('ttDraftList');
  if (!box) return;
  try {
    const data = await api('/api/founder/practice-drafts');
    box.innerHTML = data.drafts.length ? data.drafts.map(d => `
      <div class="tt-review-q"><div class="tt-qhead"><span>${escapeHtml(d.section)} · ${escapeHtml(d.topic)} · level ${d.difficulty || '?'}</span></div>
        <p class="pr-text">${escapeHtml(d.question)}</p>
        <div class="pr-options">${d.options.map((o, i) => `<div class="pr-option${i === d.answer ? ' is-right' : ''}"><b>${LETTERS[i]}</b><span>${escapeHtml(o)}</span></div>`).join('')}</div>
        <div class="pr-why is-right"><p>${escapeHtml(d.why)}</p></div>
        <div class="st-row-actions"><button class="hm-btn" type="button" data-tt="decide" data-id="${d.id}" data-action="approve">Approve</button>
          <button class="pp-small st-danger" type="button" data-tt="decide" data-id="${d.id}" data-action="reject">Reject</button></div></div>`).join('')
      : '<p class="hm-note">No drafts waiting.</p>';
  } catch (err) { box.innerHTML = `<p class="hm-note">${escapeHtml(err.message)}</p>`; }
}

function draftSheet() {
  openSheet({
    title: 'AI draft questions',
    note: 'The AI writes them; nothing is shown to students until you approve it.',
    fields: [
      { name: 'section', label: 'Section', type: 'select', half: true, options: [['quant', 'Quantitative'], ['logical', 'Logical reasoning'], ['verbal', 'Verbal ability'], ['technical', 'Computer science']] },
      { name: 'count', label: 'How many', type: 'number', half: true, value: 10, min: 3, max: 20 },
      { name: 'topic', label: 'Topic', required: true, maxlength: 60, placeholder: 'Time and work' }
    ],
    submitLabel: 'Write drafts',
    onSubmit: async (values) => {
      const result = await api('/api/founder/practice-drafts', { method: 'POST', timeout: 150000, body: values });
      showToast(`${result.added} drafts written`);
      loadDrafts();
    }
  });
}

function testCardHtml(test) {
  const blocked = tests.week.limit !== null && tests.week.limit !== undefined && tests.week.used >= tests.week.limit && !tests.running;
  return `
    <div class="tt-test${test.kind === 'pattern' ? ' is-pattern' : ''}">
      <strong>${escapeHtml(test.title)}</strong>
      <div class="tt-test-meta"><span class="pp-chip is-quiet">${test.questions} questions</span><span class="pp-chip is-quiet">${test.minutes} min</span></div>
      <p>${escapeHtml(test.blurb)}</p>
      <button class="hm-btn${blocked ? ' is-quiet' : ''}" type="button" data-tt="start" data-key="${test.key}" ${test.ready ? '' : 'disabled'}>${blocked ? `${ttIcon('lock')}Next week, or upgrade` : 'Start'}</button>
    </div>`;
}

function topicChipsHtml() {
  const labels = { quant: 'Quantitative', logical: 'Logical reasoning', verbal: 'Verbal ability', technical: 'Computer science' };
  const bySection = {};
  tests.topics.forEach(([section, topic]) => { (bySection[section] = bySection[section] || []).push(topic); });
  return Object.entries(labels).filter(([s]) => bySection[s]).map(([section, label]) => `
    <div class="st-group">${label} <button class="pp-small" type="button" data-tt="practice" data-section="${section}" style="margin-left:auto">Mixed</button></div>
    <div class="tt-topics">${bySection[section].map(topic => `<button class="st-chip" type="button" data-tt="practice" data-section="${section}" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`).join('')}</div>`).join('');
}

function insightsHtml() {
  const t = tests;
  const sections = t.sections.length ? t.sections.map(s => `
    <div class="tt-section-row"><span>${escapeHtml(s.label)}</span><div class="hm-bar" aria-hidden="true"><i style="width:${s.accuracy || 0}%"></i></div><b>${s.accuracy === null ? '–' : `${s.accuracy}%`}</b></div>`).join('')
    : '<p class="hm-note">Answer a few questions to see where you stand.</p>';
  if (t.insights.locked) {
    return `
      <section class="hm-card">
        <div class="hm-head"><h2>Where you stand</h2></div>
        ${sections}
        <div class="tt-locked" style="margin-top:14px">
          <div class="tt-locked-blur" aria-hidden="true"><div class="tt-weak"><div>Weak topic<small>45% right in 9 answers</small></div></div><div class="tt-weak"><div>Slowest topic<small>2 min a question</small></div></div></div>
          <div class="tt-locked-cover">${ttIcon('lock')}<strong>${t.insights.weak_count ? `${ttPlural(t.insights.weak_count, 'weak topic', 'weak topics')} found` : 'Your weak topics and timing'}</strong>
            <span class="hm-note">See them, your time per question and your progress over tests with Student Pro or the Exam Pass.</span>
            <a class="hm-btn" href="pricing.html">See plans</a></div>
        </div>
      </section>`;
  }
  const ins = t.insights;
  return `
    <section class="hm-card">
      <div class="hm-head"><h2>Where you stand</h2></div>
      ${sections}
      ${ins.weak.length ? `<div class="st-group">Work on these</div>${ins.weak.map(w => `
        <div class="tt-weak"><div><strong>${escapeHtml(w.topic)}</strong><small>${w.accuracy}% right in ${w.answered} answers${w.avg_seconds ? ` · ${w.avg_seconds} s each` : ''}</small></div>
          <button class="pp-small" type="button" data-tt="practice" data-section="${w.section}" data-topic="${escapeHtml(w.topic)}">Practise</button>
          <a class="pp-small" href="tutor.html?ask=${encodeURIComponent(`Explain the key ideas of ${w.topic} for placement tests, with 2 solved examples.`)}">Tutor</a></div>`).join('')}` : ''}
      ${ins.trend.length >= 2 ? `<div class="st-group">Your last tests</div>
        <div class="tt-trend" role="img" aria-label="Scores of your last ${ins.trend.length} tests: ${ins.trend.map(x => `${x.percent}%`).join(', ')}">${ins.trend.map(x => `<div class="tt-bar" style="height:${Math.max(4, x.percent)}%" title="${escapeHtml(x.title)}: ${x.percent}%"><span>${x.percent}</span></div>`).join('')}</div>` : ''}
    </section>`;
}

// ---------- the timed test ----------
async function startRun(key) {
  el('testsView').innerHTML = '<div class="hm-card"><div class="skeleton hm-skel"></div></div>';
  const data = await api(`/api/tests/${key}/start`, { method: 'POST', timeout: 60000 });
  run = { ...data, index: firstOpen(data.answers), flags: new Set(), openedAt: Date.now(), offset: new Date(data.server_now).getTime() - Date.now(), done: false, saving: Promise.resolve() };
  drawRun();
  startClock();
}

function firstOpen(answers) {
  const i = answers.findIndex(a => a === null);
  return i < 0 ? 0 : i;
}

function msLeft() { return new Date(run.ends_at).getTime() - (Date.now() + run.offset); }

function startClock() {
  stopClock();
  run.timer = setInterval(() => {
    const left = msLeft();
    const clock = el('ttClock');
    if (clock) {
      const s = Math.max(0, Math.round(left / 1000));
      clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      clock.parentElement.classList.toggle('is-low', s <= 120);
    }
    if (left <= 0) submitRun(true);
  }, 500);
}

function stopClock() { if (run && run.timer) { clearInterval(run.timer); run.timer = null; } }

function drawRun() {
  const q = run.questions[run.index];
  const chosen = run.answers[run.index];
  const answered = run.answers.filter(a => a !== null).length;
  el('testsView').innerHTML = `
    <div class="tt-run-head"><h1>${escapeHtml(run.title)}</h1><span class="tt-clock">${ttIcon('timer')}<span id="ttClock">--:--</span></span>
      <button class="hm-btn" type="button" data-tt="submit">Submit</button></div>
    <div class="tt-run">
      <section class="hm-card">
        <div class="tt-qhead"><span>Question ${run.index + 1} of ${run.questions.length} · ${escapeHtml(q.topic)}</span>
          <button class="pp-small" type="button" data-tt="flag" aria-pressed="${run.flags.has(run.index)}">${ttIcon('flag')}${run.flags.has(run.index) ? 'Marked' : 'Mark for review'}</button></div>
        <p class="pr-text">${escapeHtml(q.question)}</p>
        ${q.code ? `<pre class="pr-code"><code>${escapeHtml(q.code)}</code></pre>` : ''}
        <div class="pr-options">${q.options.map((o, i) => `<button class="pr-option" type="button" data-tt="choose" data-i="${i}" aria-pressed="${chosen === i}"><b>${LETTERS[i]}</b><span>${escapeHtml(o)}</span></button>`).join('')}</div>
        <div class="tt-run-foot">
          <button class="pp-small" type="button" data-tt="prev" ${run.index ? '' : 'disabled'}>${ttIcon('arrow_back')}Previous</button>
          ${chosen !== null ? `<button class="pp-small" type="button" data-tt="clear">Clear answer</button>` : ''}
          <span class="fs-gap"></span>
          <button class="hm-btn" type="button" data-tt="next">${run.index + 1 < run.questions.length ? `Next${ttIcon('arrow_forward')}` : 'Review and submit'}</button>
        </div>
        <p class="pp-keys" style="text-align:left;margin-top:12px">Keys: A to D pick, ← → move, F marks for review</p>
      </section>
      <aside class="tt-side hm-card">
        <div class="hm-head"><h2>${answered} of ${run.questions.length} answered</h2></div>
        ${run.parts.map(part => `<div class="tt-part">${escapeHtml(part.label)}</div>
          <div class="tt-nav">${run.questions.slice(part.start, part.start + part.count).map((_, j) => {
            const i = part.start + j;
            return `<button class="tt-dot${run.answers[i] !== null ? ' is-done' : ''}${run.flags.has(i) ? ' is-flag' : ''}" type="button" data-tt="goto" data-i="${i}" aria-current="${i === run.index}" aria-label="Question ${i + 1}${run.answers[i] !== null ? ', answered' : ''}">${i + 1}</button>`;
          }).join('')}</div>`).join('')}
        <div class="tt-legend"><span><i style="background:#e2dfff"></i>Answered</span><span><i></i>Not yet</span><span><i style="background:#ba1a1a;border-color:#ba1a1a;border-radius:999px;width:8px;height:8px"></i>Marked</span></div>
      </aside>
    </div>`;
  startClock();
}

// Time on the open question goes with the next save
function takeSeconds() {
  const seconds = Math.round((Date.now() - run.openedAt) / 1000);
  run.openedAt = Date.now();
  return seconds;
}

function saveAnswer(index, chosen, seconds) {
  // One save after another, so a quick change of mind reaches the server in order
  run.saving = run.saving.then(() => api(`/api/tests/attempts/${run.id}/answer`, { method: 'PUT', body: { index, chosen, seconds } })
    .catch(err => { if (!run.done) showToast(`Not saved: ${err.message}`); }));
}

function moveTo(index) {
  if (!run || index < 0 || index >= run.questions.length || index === run.index) return;
  const seconds = takeSeconds();
  if (seconds >= 2) saveAnswer(run.index, run.answers[run.index], seconds);
  run.index = index;
  drawRun();
}

async function submitRun(timeUp) {
  if (!run || run.done) return;
  const open = run.answers.filter(a => a === null).length;
  if (!timeUp && !window.confirm(open ? `${ttPlural(open, 'question is', 'questions are')} not answered. Submit anyway?` : 'Submit your test?')) return;
  run.done = true;
  stopClock();
  el('testsView').innerHTML = `<div class="hm-card st-empty">${ttIcon('hourglass_top')}<strong>${timeUp ? 'Time is up' : 'Marking your test'}…</strong><p>Your saved answers are being marked.</p></div>`;
  try {
    await run.saving;
    const result = await api(`/api/tests/attempts/${run.id}/submit`, { method: 'POST', timeout: 60000, body: { index: run.index, seconds: takeSeconds() } });
    showXpPop(result.xp);
    const id = run.id;
    run = null;
    history.replaceState({}, '', `tests.html?result=${id}`);
    drawResult(result);
  } catch (err) {
    run.done = false;
    showToast(err.message);
    drawRun();
  }
}

// ---------- results ----------
async function showResult(id) {
  el('testsView').innerHTML = '<div class="hm-card"><div class="skeleton hm-skel"></div></div>';
  drawResult(await api(`/api/tests/attempts/${id}`));
}

function drawResult(r) {
  const filter = drawResult.filter || 'all';
  const shown = r.review.filter(q => filter === 'all' || (filter === 'wrong' && q.chosen !== null && !q.correct) || (filter === 'open' && q.chosen === null));
  const mins = Math.floor(r.time_used / 60), secs = r.time_used % 60;
  el('testsView').innerHTML = `
    <a class="pp-back" href="tests.html" data-tt-link>${ttIcon('arrow_back')}Mock tests</a>
    <div class="hm-grid">
      <div class="hm-main">
        <section class="hm-card">
          <div class="tt-score"><div><b>${r.percent}%</b><small>${r.score} of ${r.total} right${r.unanswered ? ` · ${r.unanswered} left blank` : ''}</small></div>
            <div><strong>${escapeHtml(r.title)}</strong><small class="hm-note">${mins} min ${secs} s of ${r.minutes} min</small></div></div>
          <div style="margin-top:14px">${r.parts.map(p => `<div class="tt-section-row"><span>${escapeHtml(p.label)}</span><div class="hm-bar" aria-hidden="true"><i style="width:${Math.round(p.right * 100 / Math.max(1, p.count))}%"></i></div><b>${p.right}/${p.count}</b></div>`).join('')}</div>
        </section>
        <section class="hm-card">
          <div class="hm-head"><h2>Every question</h2>
            <span class="st-chips" style="margin:0">${[['all', 'All'], ['wrong', 'Wrong'], ['open', 'Blank']].map(([k, l]) => `<button class="st-chip" type="button" data-tt="filter" data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join('')}</span></div>
          ${shown.length ? shown.map(q => `
            <div class="tt-review-q">
              <div class="tt-qhead"><span>Question ${q.index + 1} · ${escapeHtml(q.topic)}${q.seconds !== undefined ? ` · ${q.seconds} s` : ''}</span>
                <span class="pr-mark ${q.correct ? 'is-right' : 'is-wrong'}">${ttIcon(q.correct ? 'check_circle' : q.chosen === null ? 'remove_circle' : 'cancel')}</span></div>
              <p class="pr-text">${escapeHtml(q.question)}</p>
              ${q.code ? `<pre class="pr-code"><code>${escapeHtml(q.code)}</code></pre>` : ''}
              <div class="pr-options">${q.options.map((o, i) => `<div class="pr-option${i === q.answer ? ' is-right' : i === q.chosen ? ' is-wrong' : ''}"><b>${LETTERS[i]}</b><span>${escapeHtml(o)}</span></div>`).join('')}</div>
              <div class="pr-why ${q.correct ? 'is-right' : 'is-wrong'}"><strong>${q.correct ? 'Right' : q.chosen === null ? `Not answered. The answer is ${LETTERS[q.answer]}.` : `The answer is ${LETTERS[q.answer]}`}</strong><p>${escapeHtml(q.why)}</p></div>
              ${q.correct ? '' : `<div class="st-row-actions"><a class="pp-small" href="tutor.html?ask=${encodeURIComponent(`Explain this placement question step by step: ${q.question}${q.code ? `\n\n${q.code}` : ''}\nOptions: ${q.options.map((o, i) => `${LETTERS[i]}) ${o}`).join('  ')}`)}">${ttIcon('auto_awesome')}Ask the tutor</a></div>`}
            </div>`).join('') : '<p class="hm-note">Nothing here.</p>'}
        </section>
      </div>
      <aside class="hm-side">
        ${r.full_report ? `<section class="hm-card"><div class="hm-head"><h2>By topic</h2></div>
          ${r.topics.map(t => `<div class="tt-section-row"><span>${escapeHtml(t.topic)}</span><div class="hm-bar" aria-hidden="true"><i style="width:${Math.round(t.right * 100 / t.count)}%"></i></div><b>${t.right}/${t.count}</b></div>`).join('')}</section>`
          : `<section class="hm-card"><div class="hm-head"><h2>By topic and time</h2></div><p class="hm-note">See which topics cost you marks and how long each question took, with Student Pro or the Exam Pass.</p>
            <div class="st-row-actions"><a class="hm-btn is-quiet" href="pricing.html">See plans</a></div></section>`}
        <section class="hm-card"><div class="hm-head"><h2>Next</h2></div>
          <div class="hm-list"><a class="hm-row" href="tests.html" data-tt-link><span class="hm-icon">${ttIcon('assignment')}</span><span class="hm-row-text"><strong>Another test</strong><small>Or practise a topic, untimed</small></span></a>
          <a class="hm-row" href="progress.html"><span class="hm-icon">${ttIcon('local_fire_department')}</span><span class="hm-row-text"><strong>Your progress</strong><small>XP, streak and goal</small></span></a></div></section>
      </aside>
    </div>`;
  drawResult.last = r;
}

// ---------- topic practice ----------
async function startPractice(section, topic) {
  el('testsView').innerHTML = '<div class="hm-card"><div class="skeleton hm-skel"></div></div>';
  const data = await api(`/api/tests/practice?section=${encodeURIComponent(section)}&topic=${encodeURIComponent(topic)}`);
  practiceSet = { ...data, index: 0, picked: null, result: null, right: 0, xp: 0 };
  drawPractice();
}

function drawPractice() {
  const p = practiceSet;
  const title = p.topic || { quant: 'Quantitative', logical: 'Logical reasoning', verbal: 'Verbal ability', technical: 'Computer science' }[p.section] || 'Practice';
  if (p.index >= p.questions.length) {
    el('testsView').innerHTML = `<a class="pp-back" href="tests.html" data-tt-link>${ttIcon('arrow_back')}Mock tests</a>
      <div class="hm-card st-empty">${ttIcon('emoji_events')}<strong>${p.right} of ${p.questions.length} right</strong><p>${escapeHtml(title)}${p.xp ? ` · +${p.xp} XP` : ''}${p.left_new ? ` · ${p.left_new} more new questions here` : ''}</p>
      <div class="st-empty-actions"><button class="hm-btn" type="button" data-tt="practice" data-section="${p.section}" data-topic="${escapeHtml(p.topic)}">Ten more</button><a class="hm-btn is-quiet" href="tests.html" data-tt-link>Back to the tests</a></div></div>`;
    return;
  }
  const q = p.questions[p.index], r = p.result;
  el('testsView').innerHTML = `
    <a class="pp-back" href="tests.html" data-tt-link>${ttIcon('arrow_back')}Mock tests</a>
    <section class="hm-card" style="max-width:820px">
      <div class="tt-qhead"><span>${escapeHtml(title)} · ${p.index + 1} of ${p.questions.length}</span><span>${p.right} right</span></div>
      <div class="hm-bar" aria-hidden="true" style="margin-bottom:16px"><i style="width:${Math.round(p.index * 100 / p.questions.length)}%"></i></div>
      <p class="pr-text">${escapeHtml(q.question)}</p>
      ${q.code ? `<pre class="pr-code"><code>${escapeHtml(q.code)}</code></pre>` : ''}
      <div class="pr-options">${q.options.map((o, i) => `<button class="pr-option${r ? (i === r.answer ? ' is-right' : i === p.picked ? ' is-wrong' : '') : ''}" type="button" data-tt="pick" data-i="${i}" ${r ? 'disabled' : ''}><b>${LETTERS[i]}</b><span>${escapeHtml(o)}</span></button>`).join('')}</div>
      ${r ? `<div class="pr-why ${r.correct ? 'is-right' : 'is-wrong'}"><strong>${r.correct ? 'Right' : `The answer is ${LETTERS[r.answer]}`}</strong><p>${escapeHtml(r.why)}</p></div>
        <div class="tt-run-foot"><span class="fs-gap"></span><button class="hm-btn" type="button" data-tt="practiceNext">${p.index + 1 < p.questions.length ? 'Next question' : 'See how you did'}</button></div>` : ''}
    </section>`;
}

async function pickPractice(i) {
  const p = practiceSet;
  if (!p || p.result) return;
  p.picked = i;
  try {
    p.result = await api('/api/tests/practice/answer', { method: 'POST', body: { question_id: p.questions[p.index].id, chosen: i } });
    if (p.result.correct) p.right += 1;
    p.xp += (p.result.xp && p.result.xp.xp) || 0;
    if (p.result.xp && p.result.xp.goal_reached) showXpPop(p.result.xp);
  } catch (err) { p.picked = null; showToast(err.message); }
  drawPractice();
}

// ---------- events ----------
function onTestsClick(e) {
  const link = e.target.closest('[data-tt-link]');
  if (link && !e.metaKey && !e.ctrlKey && e.button === 0) {
    if (run && !run.done && !window.confirm('Leave the test? Your answers are saved and the clock keeps running.')) { e.preventDefault(); return; }
    e.preventDefault();
    const url = new URL(link.href, location.href);
    history.pushState({}, '', url.pathname.split('/').pop() + url.search);
    run = null;
    renderTests();
    window.scrollTo(0, 0);
    return;
  }
  const b = e.target.closest('[data-tt]');
  if (!b) return;
  const act = b.dataset.tt;
  if (act === 'start') {
    if (tests.week.limit !== null && tests.week.limit !== undefined && tests.week.used >= tests.week.limit && !tests.running) {
      if (typeof window.upgradePrompt === 'function') window.upgradePrompt(`You have used your free mock test for this week. Student Pro and the Exam Pass give unlimited tests with the full report.`);
      return;
    }
    if (!window.confirm(`Start ${tests.tests.find(t => t.key === b.dataset.key).title}? The clock starts now and keeps running even if you leave the page.`)) return;
    ttGo({ run: b.dataset.key });
  } else if (act === 'practice') ttGo({ section: b.dataset.section, topic: b.dataset.topic || '' });
  else if (act === 'choose' && run) {
    const i = Number(b.dataset.i);
    run.answers[run.index] = i;
    saveAnswer(run.index, i, takeSeconds());
    drawRun();
  } else if (act === 'clear' && run) { run.answers[run.index] = null; saveAnswer(run.index, null, takeSeconds()); drawRun(); }
  else if (act === 'flag' && run) { run.flags.has(run.index) ? run.flags.delete(run.index) : run.flags.add(run.index); drawRun(); }
  else if (act === 'prev' && run) moveTo(run.index - 1);
  else if (act === 'next' && run) { if (run.index + 1 < run.questions.length) moveTo(run.index + 1); else submitRun(false); }
  else if (act === 'goto' && run) moveTo(Number(b.dataset.i));
  else if (act === 'submit') submitRun(false);
  else if (act === 'filter') { drawResult.filter = b.dataset.f; drawResult(drawResult.last); }
  else if (act === 'pick') pickPractice(Number(b.dataset.i));
  else if (act === 'draft') draftSheet();
  else if (act === 'decide') api(`/api/founder/practice-drafts/${b.dataset.id}`, { method: 'POST', body: { action: b.dataset.action } }).then(loadDrafts, err => showToast(err.message));
  else if (act === 'practiceNext') { practiceSet.index += 1; practiceSet.result = null; practiceSet.picked = null; drawPractice(); }
}

function onTestsKey(e) {
  if (!run || run.done || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const letter = 'abcde'.indexOf(e.key.toLowerCase());
  const q = run.questions[run.index];
  if (letter >= 0 && letter < q.options.length) { e.preventDefault(); run.answers[run.index] = letter; saveAnswer(run.index, letter, takeSeconds()); drawRun(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); moveTo(run.index + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); moveTo(run.index - 1); }
  else if (e.key.toLowerCase() === 'f') { e.preventDefault(); run.flags.has(run.index) ? run.flags.delete(run.index) : run.flags.add(run.index); drawRun(); }
}

initTests();
