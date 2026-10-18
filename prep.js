// ==========================================
// PREP.JS — Exam Prep (prep.html), the core: loading, the page's views and their links, the overview.
//   prep.html                     my subjects, cards to review today, my decks
//   prep.html?subject=ID&tab=...  one subject: units (prep-syllabus.js), past-paper questions (prep-questions.js), flashcards (prep-cards.js)
//   prep.html?deck=ID             one deck (prep-cards.js)
//   prep.html?review=1[&deck=ID]  the review screen (prep-cards.js)
// Each tab file adds its renderers to prepViews and its button handlers to prepActions (data-pp="name").
// Loaded after shared.js, chat-common.js and formsheet.js.
// ==========================================

let prep = null;               // what /api/prep returned
let prepLoading = false;
let prepNoteAsked = false;      // the 'which subject is this paper for' question is asked once
const prepViews = {};          // name -> function(box) that draws a view or a tab
const prepActions = {};        // data-pp value -> function(button, event)
const prepCache = {};          // per-view data loaded on demand: questions:<syllabus>, deck:<id>, browse:<syllabus>

const ppIcon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const ppPlural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const PREP_TABS = [['units', 'Units', 'checklist'], ['questions', 'Past-paper questions', 'history_edu'], ['cards', 'Flashcards', 'style']];
const STATUS_LABELS = { todo: 'To do', learning: 'Learning', revised: 'Revised', confident: 'Confident' };

function prepRoute() {
  const q = new URLSearchParams(location.search);
  return { subject: Number(q.get('subject')) || 0, tab: q.get('tab') || 'units', deck: Number(q.get('deck')) || 0, review: q.get('review') === '1',
           note: Number(q.get('note')) || 0 };
}

function prepGo(params, replace) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value) q.set(key, value); });
  const url = `prep.html${q.toString() ? `?${q}` : ''}`;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  renderPrep();
  if (!replace) window.scrollTo(0, 0);
}

function initPrep() {
  const cached = cacheGet('prep');
  if (cached && cached.subjects) { prep = cached; renderPrep(); }
  loadPrep();
  window.addEventListener('popstate', renderPrep);
  document.addEventListener('click', onPrepClick);
  document.addEventListener('change', onPrepChange);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && el('prepReview').hidden) loadPrep(); });
}

async function loadPrep() {
  if (prepLoading) return;
  prepLoading = true;
  try {
    prep = await fetchPageData('/api/prep');
    cacheSet('prep', prep);
    renderPrep();
    if (!prepNoteAsked && prepRoute().note && !prepRoute().subject) { prepNoteAsked = true; prepViews.fromNote(); }
  } catch (err) {
    if (!prep) el('prepView').innerHTML = `<div class="hm-card hm-problem">${ppIcon('cloud_off')}<p>Could not load Exam Prep: ${escapeHtml(err.message)}</p><button class="hm-btn" type="button" data-pp="reload">Try again</button></div>`;
  } finally {
    prepLoading = false;
  }
}
prepActions.reload = () => loadPrep();

function renderPrep() {
  if (!prep) return;
  const route = prepRoute();
  if (route.review) prepViews.review(route);
  else if (!el('prepReview').hidden) prepViews.closeReview();
  const box = el('prepView');
  if (route.deck) return prepViews.deck(box, route);
  if (route.subject) {
    const subject = prep.subjects.find(s => s.id === route.subject);
    if (subject) return renderSubject(box, subject, route.tab);
  }
  renderOverview(box, route);
}

// ---------- small shared pieces ----------
function examChip(subject) {
  if (subject.days_left === null || subject.days_left === undefined) return '<span class="pp-chip is-quiet">No exam date</span>';
  if (subject.days_left < 0) return '<span class="pp-chip is-quiet">Exam over</span>';
  if (subject.days_left === 0) return '<span class="pp-chip is-soon">Exam today</span>';
  return `<span class="pp-chip${subject.days_left <= 14 ? ' is-soon' : ''}">Exam in ${ppPlural(subject.days_left, 'day', 'days')}</span>`;
}

function unitCounts(syllabus) {
  if (!syllabus) return { total: 0, done: 0, learning: 0 };
  const states = syllabus.units.map(unit => prep.progress[unit.id] || 'todo');
  return { total: states.length, done: states.filter(s => s === 'revised' || s === 'confident').length, learning: states.filter(s => s === 'learning').length };
}

function decksOf(syllabusId) {
  return prep.decks.filter(deck => deck.syllabus_id === syllabusId);
}

// "9 units left, 12 days: about 1 unit a day finishes 2 days early"
function paceLine(subject) {
  const counts = unitCounts(subject.syllabus);
  const left = counts.total - counts.done;
  if (!subject.syllabus || !counts.total) return '';
  if (!left) return 'Every unit is revised. Keep the flashcards going so it stays fresh.';
  if (subject.days_left === null || subject.days_left === undefined || subject.days_left < 0) return `${ppPlural(left, 'unit', 'units')} left to revise. Set the exam date to get a daily pace.`;
  const days = Math.max(1, subject.days_left - 2);              // aim to finish two days early, for a last look
  const perDay = left / days;
  return perDay > 1
    ? `${ppPlural(left, 'unit', 'units')} left and ${ppPlural(subject.days_left, 'day', 'days')} to go: about ${Math.ceil(perDay)} a day.`
    : `${ppPlural(left, 'unit', 'units')} left and ${ppPlural(subject.days_left, 'day', 'days')} to go: one unit every ${Math.floor(1 / perDay) === 1 ? 'day' : `${Math.floor(1 / perDay)} days`} finishes two days early.`;
}

function prepNeedsCollege() {
  return !(prep.me.college || '').trim();
}

// ---------- the overview ----------
function renderOverview(box) {
  const cards = prep.cards;
  const soonest = prep.subjects.filter(s => s.days_left !== null && s.days_left >= 0).sort((a, b) => a.days_left - b.days_left)[0];
  const minutes = Math.max(1, Math.round(cards.today_total * 12 / 60));
  box.innerHTML = `
    <section class="hm-hero">
      <div class="hm-hero-text">
        <p class="hm-date">Study</p>
        <h1 class="hm-title">Exam Prep</h1>
        <p class="hm-sub">Your syllabus, the questions your university asks again and again, and flashcards that come back just before you forget.</p>
      </div>
      <nav aria-label="Exam Prep" class="hm-quick">
        <a href="study.html">${ppIcon('auto_stories')}My Study</a>
        <a href="notes.html?kind=paper">${ppIcon('description')}Past papers</a>
      </nav>
    </section>
    <div class="pp-today">
      <div class="pp-today-box${cards.today_total ? ' is-main' : ''}">
        <span class="pp-big">${cards.today_total}</span>
        <span class="pp-today-text"><strong>${cards.today_total ? `${cards.today_total === 1 ? 'Card' : 'Cards'} to review today` : 'No cards waiting'}</strong>
          <small>${cards.today_total ? `About ${ppPlural(minutes, 'minute', 'minutes')}. ${cards.due ? `${cards.due} due again` : 'All new'}${cards.due && cards.today_total > cards.due ? `, ${cards.today_total - cards.due} new` : ''}.` : (prep.decks.length ? 'You are up to date. New cards come in tomorrow.' : 'Make a deck or follow one from your class to start.')}</small></span>
        ${cards.today_total ? '<button class="hm-btn" type="button" data-pp="startReview">Start</button>' : ''}
      </div>
      <div class="pp-today-box">
        <span class="hm-icon">${ppIcon('event')}</span>
        <span class="pp-today-text">${soonest ? `<strong>${escapeHtml(soonest.name)} ${soonest.days_left === 0 ? 'today' : `in ${ppPlural(soonest.days_left, 'day', 'days')}`}</strong><small>${escapeHtml(paceLine(soonest) || 'Link its syllabus to track the units.')}</small>`
          : '<strong>No exam dates yet</strong><small>Add the dates to see a countdown and a daily pace.</small>'}</span>
      </div>
    </div>
    ${soonest && soonest.days_left <= 30 && prep.paid === false ? `<div class="st-banner" style="margin-bottom:20px">${ppIcon('bolt')}<span><strong>${escapeHtml(soonest.name)} is in ${ppPlural(soonest.days_left, 'day', 'days')}. The ₹49 Exam Pass covers it.</strong>
      <small>30 days of 60 AI tutor questions a day, exam answers for any question, AI flashcards from your notes, unlimited mock tests with the full report.</small></span>
      <a class="hm-btn" href="pricing.html">See the pass</a></div>` : ''}
    <div class="hm-grid">
      <div class="hm-main">
        <section class="hm-card">
          <div class="hm-head"><h2>Your subjects</h2>${prep.subjects.length ? '<button class="pp-small" type="button" data-pp="findSyllabus">' + ppIcon('add') + 'Add a subject</button>' : ''}</div>
          ${prep.subjects.length ? `<div class="pp-subjects">${prep.subjects.map(subjectCardHtml).join('')}</div>` : `
            <div class="st-empty">${ppIcon('menu_book')}<strong>Add the subjects you are studying</strong>
              <p>Pick your class's syllabus if a classmate or teacher already added it, or type it in once for everyone.</p>
              <div class="st-empty-actions"><button class="hm-btn" type="button" data-pp="findSyllabus">Find your syllabus</button><a class="hm-btn is-quiet" href="study.html">Add in My Study</a></div></div>`}
          ${prepNeedsCollege() ? `<p class="st-hint">${ppIcon('info')}<span>Add your college on <a href="profile.html">your profile</a> to share syllabi and decks with your class.</span></p>` : ''}
        </section>
      </div>
      <aside class="hm-side">
        <section class="hm-card">
          <div class="hm-head"><h2>Your decks</h2><button class="pp-small" type="button" data-pp="newDeck">${ppIcon('add')}New deck</button></div>
          ${prep.decks.length ? `<div class="pp-decks">${prep.decks.map(deckRowHtml).join('')}</div>` : '<p class="hm-note">Flashcards you make or follow show here. Each review takes seconds, and the app brings a card back just before you would forget it.</p>'}
          <div class="st-row-actions"><button class="pp-small" type="button" data-pp="browseDecks">${ppIcon('travel_explore')}Decks from your class</button></div>
        </section>
      </aside>
    </div>`;
}

function subjectCardHtml(subject) {
  const counts = unitCounts(subject.syllabus);
  const due = decksOf(subject.syllabus_id).reduce((sum, deck) => sum + (deck.due || 0), 0);
  const share = counts.total ? Math.round(counts.done * 100 / counts.total) : 0;
  return `
    <a class="pp-subject" href="prep.html?subject=${subject.id}" data-pp-link="subject" data-id="${subject.id}">
      <div class="pp-subject-top"><strong>${escapeHtml(subject.name)}</strong>${examChip(subject)}</div>
      ${subject.syllabus ? `
        <div class="hm-bar" aria-hidden="true"><i style="width:${share}%"></i></div>
        <small>${counts.done} of ${ppPlural(counts.total, 'unit', 'units')} revised${counts.learning ? `, ${counts.learning} in progress` : ''}</small>`
        : '<small>No syllabus linked yet. Open it to pick or add one.</small>'}
      <div class="pp-subject-foot">${due ? `<span>${ppIcon('style')}${ppPlural(due, 'card', 'cards')} due</span>` : ''}${subject.code ? `<span>${escapeHtml(subject.code)}</span>` : ''}</div>
    </a>`;
}

function deckRowHtml(deck) {
  const today = (deck.due || 0) + Math.max(0, (deck.cards || 0) - (deck.seen || 0));
  return `
    <div class="pp-deck">
      <span class="hm-icon">${ppIcon(deck.made_by_ai ? 'auto_awesome' : 'style')}</span>
      <span class="pp-deck-text"><a href="prep.html?deck=${deck.id}" data-pp-link="deck" data-id="${deck.id}">${escapeHtml(deck.title)}</a>
        <small>${ppPlural(deck.cards || 0, 'card', 'cards')}${deck.due ? ` · ${deck.due} due` : ''}${deck.public ? ' · shared with your class' : ''}${deck.mine ? '' : ' · following'}</small></span>
      ${today ? `<button class="pp-small" type="button" data-pp="startReview" data-deck="${deck.id}">Review</button>` : ''}
    </div>`;
}

// ---------- one subject ----------
function renderSubject(box, subject, tab) {
  if (!PREP_TABS.some(([key]) => key === tab)) tab = 'units';
  const s = subject.syllabus;
  box.innerHTML = `
    <a class="pp-back" href="prep.html" data-pp-link="home">${ppIcon('arrow_back')}Exam Prep</a>
    <div class="pp-head">
      <div>
        <h1 class="hm-title">${escapeHtml(subject.name)}</h1>
        <div class="pp-head-meta">${examChip(subject)}
          ${s ? `<span class="pp-chip is-quiet">${escapeHtml([s.department, s.semester ? `Semester ${s.semester}` : ''].filter(Boolean).join(' · ') || 'Syllabus')}</span>` : ''}
          ${s && s.teacher_checked ? `<span class="pp-chip is-good">Checked by a teacher</span>` : ''}
          ${s && s.users > 1 ? `<span class="pp-chip is-quiet">${s.users} students use it</span>` : ''}</div>
      </div>
      <div class="pp-head-actions">
        <button class="pp-small" type="button" data-pp="examDate" data-id="${subject.id}">${ppIcon('event')}${subject.exam_date ? 'Change exam date' : 'Set exam date'}</button>
        ${s ? `<button class="pp-small" type="button" data-pp="syllabusMenu" data-id="${subject.id}">${ppIcon('more_horiz')}Syllabus</button>` : ''}
      </div>
    </div>
    ${s ? `
      <div class="st-tabs" role="tablist">${PREP_TABS.map(([key, label, icon]) =>
        `<button class="st-tab" type="button" role="tab" aria-selected="${key === tab}" data-pp="tab" data-tab="${key}">${ppIcon(icon)}${label}</button>`).join('')}</div>
      <section class="hm-card" id="prepTab"></section>` : `<section class="hm-card" id="prepTab"></section>`}`;
  const tabBox = el('prepTab');
  if (!s) return prepViews.noSyllabus(tabBox, subject);
  prepViews[tab](tabBox, subject);
}

prepActions.tab = (button) => {
  const route = prepRoute();
  prepGo({ subject: route.subject, tab: button.dataset.tab }, true);
};

prepActions.examDate = (button) => {
  const subject = prep.subjects.find(s => s.id === Number(button.dataset.id));
  openSheet({
    title: `Exam date: ${subject.name}`,
    fields: [{ name: 'exam_date', label: 'Date of the exam', type: 'date', value: subject.exam_date || '', required: true }],
    submitLabel: 'Save',
    onDelete: subject.exam_date ? async () => { await api(`/api/prep/subjects/${subject.id}`, { method: 'PUT', body: { clear_exam: true } }); await loadPrep(); } : null,
    deleteLabel: 'Remove date',
    onSubmit: async (values) => {
      await api(`/api/prep/subjects/${subject.id}`, { method: 'PUT', body: { exam_date: values.exam_date } });
      await loadPrep();
      showToast('Exam date saved');
    }
  });
};

// ---------- clicks ----------
function onPrepClick(e) {
  const link = e.target.closest('[data-pp-link]');
  if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    const kind = link.dataset.ppLink;
    if (kind === 'home') prepGo({});
    else if (kind === 'subject') prepGo({ subject: link.dataset.id, tab: link.dataset.tab || '' });
    else if (kind === 'deck') prepGo({ deck: link.dataset.id });
    return;
  }
  const button = e.target.closest('[data-pp]');
  if (button && prepActions[button.dataset.pp]) {
    e.preventDefault();
    prepActions[button.dataset.pp](button, e);
  }
}

function onPrepChange(e) {
  const input = e.target.closest('[data-pp-change]');
  if (input && prepActions[input.dataset.ppChange]) prepActions[input.dataset.ppChange](input, e);
}

// A sheet that shows a list instead of a form (formsheet.js styles, its own close handling)
function openPrepPanel(title, html, wide) {
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className = 'fs-overlay';
  overlay.innerHTML = `<div class="fs-sheet${wide ? ' pp-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="fs-head"><h3>${escapeHtml(title)}</h3><button type="button" class="fs-close" data-sheet-close aria-label="Close">&times;</button></div>
      <div class="pp-panel-body">${html}</div></div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-sheet-close]')) closeSheet(); });
  const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  sheetState = { overlay, onKey, opener: document.activeElement };
  document.body.appendChild(overlay);
  return overlay.querySelector('.pp-panel-body');
}
