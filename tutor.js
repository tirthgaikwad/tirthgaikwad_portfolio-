// ==========================================
// TUTOR.JS — the AI Tutor (tutor.html): doubts and exam answers streamed from /api/tutor/ask, AI-made flashcards
// (checked, then saved as a deck) and quizzes from /api/tutor/generate. Loaded after shared.js and chat-common.js.
//   tutor.html?question=ID&subject=ID   a past-paper question from Exam Prep, ready for an exam answer
//   tutor.html?note=ID                  make flashcards from a shared note's file
//   tutor.html?thread=ID                open an earlier conversation
// ==========================================

let tutor = null;              // /api/tutor
const tv = { draft: '', mode: 'doubt', subjectId: 0, unitId: 0, marks: 5, threadId: 0, messages: [], busy: false, question: null,
             noteId: 0, topic: '', count: 12, cards: null, cardsTitle: '', quiz: null };
const tuIcon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const TUTOR_MODES = [['doubt', 'Ask a doubt', 'help'], ['answer', 'Exam answer', 'edit_note'], ['cards', 'Make flashcards', 'style'], ['quiz', 'Quiz me', 'quiz']];
const STARTERS = ['Explain normalisation with a simple example', 'What is the difference between a process and a thread?', 'How do I solve recurrence relations?'];

// mdToHtml (the safe Markdown renderer) is in markdown.js, shared with the event pages

// ---------- loading ----------
function initTutor() {
  const q = new URLSearchParams(location.search);
  tv.threadId = Number(q.get('thread')) || 0;
  tv.subjectId = Number(q.get('subject')) || Number(localStorage.getItem('c2m:tutorSubject')) || 0;
  tv.noteId = Number(q.get('note')) || 0;
  if (tv.noteId) tv.mode = 'cards';
  const questionId = Number(q.get('question')) || 0;
  if (q.get('ask')) tv.draft = q.get('ask').slice(0, 3000);     // a question handed over from another page (mock test review, weak topics)
  if (questionId) tv.mode = 'answer';
  document.addEventListener('click', onTutorClick);
  document.addEventListener('change', onTutorChange);
  loadTutor().then(async () => {
    if (questionId) await loadQuestion(questionId);
    if (tv.threadId) await openThread(tv.threadId);
  });
}

async function loadTutor() {
  try {
    tutor = await fetchPageData('/api/tutor');
    if (tv.subjectId && !tutor.subjects.some(s => s.id === tv.subjectId)) tv.subjectId = 0;
    render();
  } catch (err) {
    el('tutorMain').innerHTML = `<div class="hm-card hm-problem">${tuIcon('cloud_off')}<p>Could not load the tutor: ${escapeHtml(err.message)}</p></div>`;
  }
}

async function loadQuestion(questionId) {
  const subject = tutor.subjects.find(s => s.id === tv.subjectId);
  if (!subject || !subject.syllabus_id) return;
  try {
    const data = await api(`/api/prep/syllabi/${subject.syllabus_id}/questions`);
    const question = data.questions.find(x => x.id === questionId);
    if (question) {
      tv.question = question;
      if (question.marks && tutor.marks.includes(question.marks)) tv.marks = question.marks;
      if (question.unit_id) tv.unitId = question.unit_id;
      render();
    }
  } catch (err) { showToast(err.message); }
}

async function openThread(threadId) {
  try {
    const thread = await api(`/api/tutor/threads/${threadId}`);
    Object.assign(tv, { threadId: thread.id, messages: thread.messages, mode: ['doubt', 'answer', 'explain'].includes(thread.mode) ? (thread.mode === 'explain' ? 'answer' : thread.mode) : 'doubt',
                        subjectId: thread.subject_id || tv.subjectId, question: null, cards: null, quiz: null });
    history.replaceState({}, '', `tutor.html?thread=${thread.id}`);
    render();
    scrollToEnd();
  } catch (err) { showToast(err.message); }
}

// ---------- drawing ----------
function render() {
  if (!tutor) return;
  const typing = document.querySelector('.tu-composer textarea');
  if (typing) tv.draft = typing.value;          // a redraw keeps what was being typed
  renderSide();
  const box = el('tutorMain');
  if (!tutor.ai_on || tutor.paused) {
    box.innerHTML = `<div class="hm-card st-empty">${tuIcon(tutor.paused ? 'bedtime' : 'auto_awesome')}
      <strong>${tutor.paused ? 'The AI tutor is resting until the 1st' : 'The AI tutor is coming soon'}</strong>
      <p>${tutor.paused ? 'It has answered a lot of questions this month.' : 'It is being set up.'} Meanwhile your flashcards, syllabus units, past-paper questions and daily practice all work as usual.</p>
      <div class="st-empty-actions"><a class="hm-btn" href="prep.html">Open Exam Prep</a><a class="hm-btn is-quiet" href="practice.html">Daily practice</a></div></div>`;
    return;
  }
  const tabs = `<div class="st-tabs" role="tablist">${TUTOR_MODES.map(([key, label, ico]) =>
    `<button class="st-tab" type="button" role="tab" aria-selected="${tv.mode === key}" data-tu="mode" data-mode="${key}">${tuIcon(ico)}${label}</button>`).join('')}</div>`;
  const body = tv.mode === 'cards' ? cardsHtml() : tv.mode === 'quiz' ? quizHtml() : chatHtml();
  box.innerHTML = `${tabs}${body}`;
  const area = box.querySelector('textarea');
  if (area) { area.value = tv.draft || ''; autosize(area); }
}

function quotaRow(label, q) {
  if (q.limit === null || q.limit === undefined) return `<div class="tu-quota-row">${label}: <b>${q.used}</b> today</div>`;
  const share = Math.min(100, Math.round(q.used * 100 / Math.max(1, q.limit)));
  return `<div class="tu-quota-row">${label}: <b>${q.used} of ${q.limit}</b> today<div class="hm-bar" aria-hidden="true"><i style="width:${share}%"></i></div></div>`;
}

function renderSide() {
  const q = tutor.quota;
  el('tutorSide').innerHTML = `
    <section class="hm-card">
      <button class="hm-btn" type="button" data-tu="newChat" style="width:100%">${tuIcon('add')}New question</button>
      <div class="tu-quota" style="margin-top:14px">
        ${quotaRow('Questions', q.questions)}
        ${quotaRow('Cards and quizzes', q.generations)}
        ${q.paid ? '' : '<p class="hm-note" style="font-size:12.5px">Student Pro gives 60 questions and 10 decks or quizzes a day, and reads your note files. <a href="pricing.html" style="color:#3525cd;font-weight:600">See plans</a></p>'}
      </div>
    </section>
    <section class="hm-card">
      <div class="hm-head"><h2>Earlier</h2></div>
      ${tutor.threads.length ? `<div class="tu-threads">${tutor.threads.map(t => `
        <button class="tu-thread" type="button" data-tu="thread" data-id="${t.id}" aria-current="${t.id === tv.threadId}"><span>${escapeHtml(t.title)}</span><small>${escapeHtml(typeof timeAgo === 'function' && t.updated_at ? timeAgo(t.updated_at) : '')}</small></button>`).join('')}</div>`
        : '<p class="hm-note">Your questions and answers stay here for 90 days.</p>'}
    </section>`;
}

function subjectPicker(withUnit) {
  const subject = tutor.subjects.find(s => s.id === tv.subjectId);
  return `
    <select data-tu-change="subject" aria-label="Subject"><option value="">${tutor.subjects.length ? 'Any subject' : 'No subjects yet'}</option>${tutor.subjects.map(s => `<option value="${s.id}"${s.id === tv.subjectId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
    ${withUnit && subject && subject.units.length ? `<select data-tu-change="unit" aria-label="Unit"><option value="">${withUnit === 'need' ? 'Pick a unit' : 'Any unit'}</option>${subject.units.map(u => `<option value="${u.id}"${u.id === tv.unitId ? ' selected' : ''}>Unit ${u.number}: ${escapeHtml(u.title)}</option>`).join('')}</select>` : ''}`;
}

function chatHtml() {
  const isAnswer = tv.mode === 'answer';
  const log = tv.messages.map((m, i) => m.role === 'user'
    ? `<div class="tu-msg is-user">${escapeHtml(m.text)}</div>`
    : `<div class="tu-msg is-bot">${m.text ? mdToHtml(m.text) : '<span class="tu-thinking" aria-label="Thinking"><i></i><i></i><i></i></span>'}${m.streaming && m.text ? '<span class="tu-caret"></span>' : ''}
        ${!m.streaming && m.text && i === tv.messages.length - 1 ? `<div class="tu-msg-actions">
          <button class="pp-small" type="button" data-tu="copy" data-i="${i}">${tuIcon('content_copy')}Copy</button>
          <button class="pp-small" type="button" data-tu="followUp" data-text="Explain that more simply, with an everyday example.">Simpler</button>
          <button class="pp-small" type="button" data-tu="followUp" data-text="Give me 3 short practice questions on this, with answers at the end.">Practice questions</button>
          ${tv.subjectId ? `<button class="pp-small" type="button" data-tu="mode" data-mode="cards">${tuIcon('style')}Make flashcards</button>` : ''}</div>` : ''}</div>`).join('');
  const marks = isAnswer ? `<div class="tu-marks" role="group" aria-label="Marks">${tutor.marks.map(m => `<button class="st-chip" type="button" data-tu="marks" data-marks="${m}" aria-pressed="${m === tv.marks}">${m} marks</button>`).join('')}</div>` : '';
  const starters = !tv.messages.length && !isAnswer ? `<div class="tu-starters">${STARTERS.map(s => `<button class="st-chip" type="button" data-tu="starter" data-text="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>` : '';
  const question = tv.question && !tv.messages.length ? `<div class="tu-question-box"><b>From your past papers${tv.question.years.length ? ` (${tv.question.years.join(', ')})` : ''}:</b>\n${escapeHtml(tv.question.text)}</div>` : '';
  return `
    <section class="hm-card">
      <div class="tu-pickers">${subjectPicker(true)}</div>
      ${marks ? `<div style="margin-top:12px">${marks}</div>` : ''}
    </section>
    ${question}
    ${log ? `<div class="tu-log">${log}</div>` : (isAnswer ? '' : `<div class="hm-card"><p class="hm-note">Ask anything from your syllabus. Pick the subject so the answer fits your course.</p><div style="margin-top:12px">${starters}</div></div>`)}
    <form class="tu-composer" data-tu-form="ask">
      <textarea rows="1" maxlength="3000" placeholder="${isAnswer ? (tv.question ? 'Anything to add? (optional)' : 'Paste the exam question') : (tv.messages.length ? 'Ask a follow-up' : 'Type your doubt')}" aria-label="Your question" ${tv.busy ? 'disabled' : ''}></textarea>
      <button class="hm-btn" type="submit" ${tv.busy ? 'disabled' : ''}>${tuIcon(isAnswer && !tv.messages.length ? 'edit_note' : 'send')}${isAnswer && !tv.messages.length ? `Write ${tv.marks}-mark answer` : 'Ask'}</button>
    </form>`;
}

function cardsHtml() {
  const subject = tutor.subjects.find(s => s.id === tv.subjectId);
  if (tv.cards) {
    const kept = tv.cards.filter(c => c.keep).length;
    return `
      <section class="hm-card">
        <div class="hm-head"><h2>${escapeHtml(tv.cardsTitle)}</h2><span class="hm-note">${kept} of ${tv.cards.length} kept</span></div>
        <p class="hm-note">Check each card. Click a side to fix it, untick the ones you don't want.</p>
        <div style="margin-top:10px">${tv.cards.map((c, i) => `
          <div class="tu-gen-card${c.keep ? '' : ' is-off'}"><input type="checkbox" data-tu-change="keepCard" data-i="${i}" ${c.keep ? 'checked' : ''} aria-label="Keep card ${i + 1}"/>
            <div contenteditable="true" data-card="${i}" data-side="front">${escapeHtml(c.front)}</div><div contenteditable="true" data-card="${i}" data-side="back">${escapeHtml(c.back)}</div></div>`).join('')}</div>
        <label class="fs-check" style="margin-top:14px"><input type="checkbox" id="tuShare" checked/><span>Share the deck with my class</span></label>
        <div class="st-row-actions"><button class="hm-btn" type="button" data-tu="saveCards" ${kept ? '' : 'disabled'}>${tuIcon('save')}Save ${kept} ${kept === 1 ? 'card' : 'cards'} as a deck</button>
          <button class="pp-small" type="button" data-tu="discard">Start again</button></div>
      </section>`;
  }
  return `
    <section class="hm-card">
      <div class="hm-head"><h2>Make flashcards</h2></div>
      <p class="hm-note">${tv.noteId ? 'From the note you opened in Notes and papers.' : 'Pick a unit of your syllabus, or type a topic. You check every card before it is saved.'}</p>
      <div class="tu-pickers" style="margin-top:12px">${subjectPicker('any')}
        <input type="text" maxlength="200" placeholder="Or a topic, like 'deadlocks'" value="${escapeHtml(tv.topic)}" data-tu-change="topic" aria-label="Topic"/>
        <select data-tu-change="count" aria-label="How many cards">${[8, 12, 20].map(n => `<option value="${n}"${n === tv.count ? ' selected' : ''}>${n} cards</option>`).join('')}</select></div>
      ${tv.noteId && !tutor.quota.note_files ? '<p class="st-hint">' + tuIcon('lock') + '<span>Reading a note\'s file is part of Student Pro and the Exam Pass. You can make cards from a unit or topic instead. <a href="pricing.html">See plans</a></span></p>' : ''}
      <div class="st-row-actions"><button class="hm-btn" type="button" data-tu="generate" data-kind="cards" ${tv.busy ? 'disabled' : ''}>${tuIcon('auto_awesome')}${tv.busy ? 'Making cards…' : 'Make cards'}</button>
        ${subject && !subject.units.length ? `<a class="pp-small" href="prep.html">Link this subject's syllabus to pick units</a>` : ''}</div>
    </section>`;
}

function quizHtml() {
  const quiz = tv.quiz;
  if (quiz && quiz.index < quiz.questions.length) {
    const q = quiz.questions[quiz.index];
    const picked = quiz.picked;
    return `
      <section class="hm-card">
        <div class="hm-head"><h2>${escapeHtml(quiz.title)}</h2><span class="hm-note">${quiz.index + 1} of ${quiz.questions.length} · ${quiz.score} right</span></div>
        <div class="hm-bar" aria-hidden="true" style="margin-bottom:16px"><i style="width:${Math.round(quiz.index * 100 / quiz.questions.length)}%"></i></div>
        <div class="tu-quiz-q">${escapeHtml(q.q)}</div>
        <div class="tu-options">${q.options.map((o, i) => {
          const cls = picked === null ? '' : i === q.answer ? ' is-right' : i === picked ? ' is-wrong' : '';
          return `<button class="tu-option${cls}" type="button" data-tu="pick" data-i="${i}" ${picked === null ? '' : 'disabled'}><b>${'ABCDE'[i]}</b><span>${escapeHtml(o)}</span></button>`;
        }).join('')}</div>
        ${picked !== null ? `<div class="tu-why"><b>${picked === q.answer ? 'Right.' : `The answer is ${'ABCDE'[q.answer]}.`}</b> ${escapeHtml(q.why)}</div>
          <div class="st-row-actions"><button class="hm-btn" type="button" data-tu="nextQ">${quiz.index + 1 < quiz.questions.length ? 'Next question' : 'See my score'}</button></div>` : ''}
      </section>`;
  }
  if (quiz) {
    return `
      <section class="hm-card st-empty">${tuIcon('emoji_events')}<strong>${quiz.score} of ${quiz.questions.length} right</strong>
        <p>${quiz.score === quiz.questions.length ? 'Full marks. Try a harder unit next.' : quiz.score >= quiz.questions.length * 0.7 ? 'Good going. Ask the tutor about the ones you missed.' : 'Worth another round: go over the explanations, then take a new quiz.'}</p>
        <div class="st-empty-actions"><button class="hm-btn" type="button" data-tu="generate" data-kind="quiz">New quiz</button><button class="hm-btn is-quiet" type="button" data-tu="mode" data-mode="doubt">Ask about a question</button></div></section>`;
  }
  return `
    <section class="hm-card">
      <div class="hm-head"><h2>Quiz me</h2></div>
      <p class="hm-note">Ten multiple-choice questions on a unit or topic, each with an explanation. Finishing one earns 5 XP.</p>
      <div class="tu-pickers" style="margin-top:12px">${subjectPicker('any')}
        <input type="text" maxlength="200" placeholder="Or a topic, like 'sorting algorithms'" value="${escapeHtml(tv.topic)}" data-tu-change="topic" aria-label="Topic"/></div>
      <div class="st-row-actions"><button class="hm-btn" type="button" data-tu="generate" data-kind="quiz" ${tv.busy ? 'disabled' : ''}>${tuIcon('auto_awesome')}${tv.busy ? 'Making your quiz…' : 'Start a quiz'}</button></div>
    </section>`;
}

function autosize(area) {
  const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(220, area.scrollHeight + 2)}px`; };
  area.addEventListener('input', grow);
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); area.form.requestSubmit(); } });
  grow();
}

function scrollToEnd() {
  const form = document.querySelector('.tu-composer');
  if (form) form.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

// ---------- asking (streamed) ----------
const STREAM_ERRORS = { busy: 'The tutor is busy right now. Try again in a minute.', ai_off: 'The AI tutor is switched off.', offline: 'Could not reach the AI service.',
                        error: 'Something went wrong. Try again.', empty: 'No answer came back. Try asking again.' };

async function ask(text) {
  if (tv.busy) return;
  const mode = tv.mode === 'answer' ? (tv.question && !tv.messages.length ? 'answer' : (tv.messages.length ? 'doubt' : 'answer')) : 'doubt';
  if (!text && !(mode === 'answer' && tv.question)) return showToast(tv.mode === 'answer' ? 'Paste the exam question first.' : 'Type your question first.');
  const body = { text, mode, thread_id: tv.threadId || null, subject_id: tv.subjectId || null, unit_id: tv.unitId || null,
                 marks: mode === 'answer' ? tv.marks : null, question_id: mode === 'answer' && tv.question && !tv.messages.length ? tv.question.id : null };
  const shown = mode === 'answer' ? `${tv.marks}-mark answer: ${tv.question && !tv.messages.length ? tv.question.text : text}` : text;
  tv.messages.push({ role: 'user', text: shown }, { role: 'assistant', text: '', streaming: true });
  const reply = tv.messages[tv.messages.length - 1];
  const draft = document.querySelector('.tu-composer textarea');
  if (draft) draft.value = '';
  tv.draft = '';
  tv.busy = true;
  render();
  scrollToEnd();
  let failed = '';
  try {
    const res = await fetch(`${API_BASE}/api/tutor/ask`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).detail; } catch (e) { /* no body */ }
      if (res.status === 402 && typeof window.upgradePrompt === 'function') window.upgradePrompt(detail || '');
      if (res.status === 401) handleLoggedOut();
      throw new Error(typeof detail === 'string' && detail ? detail : 'Something went wrong. Try again.');
    }
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = '', last = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 2);
        if (!chunk.startsWith('data:')) continue;
        const event = JSON.parse(chunk.slice(5));
        if (event.type === 'text') reply.text += event.text;
        else if (event.type === 'done') { tv.threadId = event.thread_id; history.replaceState({}, '', `tutor.html?thread=${event.thread_id}`); }
        else if (event.type === 'error') failed = STREAM_ERRORS[event.code] || STREAM_ERRORS.error;
      }
      if (Date.now() - last > 80) { last = Date.now(); paintReply(reply); }
    }
  } catch (err) {
    failed = err.message;
  }
  reply.streaming = false;
  tv.busy = false;
  if (failed && !reply.text) { tv.messages.splice(-2, 2); showToast(failed); }
  else if (failed) showToast(failed);
  else { tutor.quota.questions.used += 1; tv.question = null; refreshThreads(); }
  render();
}

// Only the reply bubble is redrawn while text streams in, so the page does not jump
function paintReply(reply) {
  const bubbles = document.querySelectorAll('.tu-msg.is-bot');
  const bubble = bubbles[bubbles.length - 1];
  if (bubble) bubble.innerHTML = `${mdToHtml(reply.text)}<span class="tu-caret"></span>`;
}

async function refreshThreads() {
  try { const fresh = await api('/api/tutor'); tutor.threads = fresh.threads; tutor.quota = fresh.quota; renderSide(); } catch (e) { /* the list refreshes next time */ }
}

// ---------- making cards and quizzes ----------
async function generate(kind) {
  if (tv.busy) return;
  if (kind === 'cards' && !tv.unitId && !tv.topic && !tv.noteId && !tv.subjectId) return showToast('Pick a subject and unit, or type a topic.');
  if (kind === 'quiz' && !tv.unitId && !tv.topic && !tv.subjectId) return showToast('Pick a subject and unit, or type a topic.');
  tv.busy = true;
  render();
  try {
    const result = await api('/api/tutor/generate', { method: 'POST', timeout: 150000, body: {
      kind, subject_id: tv.subjectId || null, unit_id: tv.unitId || null, note_id: kind === 'cards' && tv.noteId && tutor.quota.note_files ? tv.noteId : null,
      topic: tv.topic, count: kind === 'cards' ? tv.count : 10 } });
    tutor.quota.generations.used += 1;
    if (kind === 'cards') { tv.cards = result.cards.map(c => ({ ...c, keep: true })); tv.cardsTitle = result.title; }
    else tv.quiz = { id: result.id, title: result.title, questions: result.questions, index: 0, picked: null, score: 0 };
  } catch (err) {
    showToast(err.message);
  }
  tv.busy = false;
  render();
}

async function saveCards() {
  const cards = tv.cards.filter(c => c.keep && c.front.trim() && c.back.trim()).map(({ front, back }) => ({ front: front.trim(), back: back.trim() }));
  if (!cards.length) return;
  const share = el('tuShare') && el('tuShare').checked;
  try {
    const saved = await api('/api/tutor/save-deck', { method: 'POST', timeout: 60000, body: { title: tv.cardsTitle, subject_id: tv.subjectId || null, unit_id: tv.unitId || null, public: share, cards } });
    try { localStorage.removeItem(CACHE_PREFIX + 'prep'); } catch (e) { /* Exam Prep refetches anyway */ }
    tv.cards = null;
    showToast(`${cards.length} cards saved. They are in today's review.`);
    location.href = `prep.html?deck=${saved.id}`;
  } catch (err) { showToast(err.message); }
}

async function finishQuiz() {
  const quiz = tv.quiz;
  try {
    const result = await api(`/api/tutor/quizzes/${quiz.id}/done`, { method: 'POST', body: { score: quiz.score } });
    showXpPop(result.xp);
  } catch (err) { /* the score still shows */ }
}

// ---------- events ----------
function onTutorClick(e) {
  const b = e.target.closest('[data-tu]');
  if (!b) return;
  const act = b.dataset.tu;
  if (act === 'mode') { tv.mode = b.dataset.mode; render(); }
  else if (act === 'newChat') { Object.assign(tv, { threadId: 0, messages: [], question: null, cards: null, quiz: null, mode: tv.mode === 'quiz' || tv.mode === 'cards' ? tv.mode : 'doubt' }); history.replaceState({}, '', 'tutor.html'); render(); }
  else if (act === 'thread') openThread(Number(b.dataset.id));
  else if (act === 'marks') { tv.marks = Number(b.dataset.marks); render(); }
  else if (act === 'starter' || act === 'followUp') ask(b.dataset.text);
  else if (act === 'copy') { navigator.clipboard.writeText(tv.messages[Number(b.dataset.i)].text).then(() => showToast('Copied'), () => showToast('Could not copy')); }
  else if (act === 'generate') { if (b.dataset.kind === 'quiz') tv.quiz = null; generate(b.dataset.kind); }
  else if (act === 'discard') { tv.cards = null; render(); }
  else if (act === 'saveCards') saveCards();
  else if (act === 'pick' && tv.quiz && tv.quiz.picked === null) {
    tv.quiz.picked = Number(b.dataset.i);
    if (tv.quiz.picked === tv.quiz.questions[tv.quiz.index].answer) tv.quiz.score += 1;
    render();
  } else if (act === 'nextQ') {
    tv.quiz.index += 1; tv.quiz.picked = null;
    if (tv.quiz.index >= tv.quiz.questions.length) finishQuiz();
    render();
  }
}

function onTutorChange(e) {
  const input = e.target.closest('[data-tu-change]');
  if (!input) return;
  const what = input.dataset.tuChange;
  if (what === 'subject') { tv.subjectId = Number(input.value) || 0; tv.unitId = 0; try { localStorage.setItem('c2m:tutorSubject', tv.subjectId); } catch (err) { /* convenience */ } render(); }
  else if (what === 'unit') { tv.unitId = Number(input.value) || 0; }
  else if (what === 'topic') { tv.topic = input.value.trim(); }
  else if (what === 'count') { tv.count = Number(input.value) || 12; }
  else if (what === 'keepCard') { tv.cards[Number(input.dataset.i)].keep = input.checked; render(); }
}

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-tu-form="ask"]');
  if (!form) return;
  e.preventDefault();
  ask(form.querySelector('textarea').value.trim());
});
// Edits typed into a generated card
document.addEventListener('input', (e) => {
  const side = e.target.closest('[data-card]');
  if (side && tv.cards) tv.cards[Number(side.dataset.card)][side.dataset.side] = side.textContent;
});

initTutor();
