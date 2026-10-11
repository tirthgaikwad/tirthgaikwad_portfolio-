// ==========================================
// COLLEGE-HUB-LEARN.JS — The Resources tab (study material teachers share) and the Q&A tab (questions and answers).
// Both are read when their tab is first opened, not with the rest of the hub.
// Loaded before college-hub.js, after college-hub-work.js (hubActions, hubChangeHandlers, file upload helpers).
// ==========================================

const learn = {
  resources: null, resLoading: false, resError: '', resQuery: '', resSubject: '', resSaved: false,
  questions: null, qaLoading: false, qaError: '', qaFilter: 'all', qaSubject: '', qaQuery: '', qaOpen: null, thread: null,
};
let qaReloadTimer = null;

const subjectsOf = (list) => [...new Set((list || []).map(item => item.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const subjectOptions = (list, chosen) => subjectsOf(list).map(name => `<option value="${escapeHtml(name)}" ${name === chosen ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
const audienceText = (item) => item.department ? `${item.department}${item.division ? ` · Div ${item.division}` : ''}` : 'Whole college';

// Typing in a search box redraws the bar; this keeps the cursor in the box
function keepFocus(id) {
  const box = el(id);
  if (!box) return;
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
}

// ==========================================
// 1. RESOURCES
// ==========================================
async function loadResources() {
  if (learn.resLoading) return;
  learn.resLoading = true;
  try {
    learn.resources = (await api('/api/college-hub/resources')).resources;
    learn.resError = '';
  } catch (err) {
    learn.resError = err.message;
  } finally {
    learn.resLoading = false;
    if (view.tab === 'resources') renderResources();
  }
}

function renderResources() {
  const teacher = isTeacher();
  const all = learn.resources;
  if (!all) {
    el('resourceBar').innerHTML = '<h2 class="ch-bar-title">Resources</h2>';
    el('resourceList').innerHTML = learn.resError ? `<div class="ch-empty">${icon('cloud_off')}<h3>Could not load resources</h3><p>${escapeHtml(learn.resError)}</p></div>` : '<div class="skeleton" style="height:150px"></div>';
    if (!learn.resError) loadResources();
    return;
  }
  const query = norm(learn.resQuery);
  const list = all.filter(item =>
    (!learn.resSubject || item.subject === learn.resSubject) && (!learn.resSaved || item.saved) &&
    (!query || norm(`${item.title} ${item.description} ${item.subject}`).includes(query)));

  el('resourceBar').innerHTML = `
    <h2 class="ch-bar-title">Resources<small>${list.length}</small></h2>
    <input class="ch-input" id="resSearch" type="search" placeholder="Search notes and links" aria-label="Search resources" value="${escapeHtml(learn.resQuery)}">
    <select class="ch-select" id="resSubject" aria-label="Subject"><option value="">All subjects</option>${subjectOptions(all, learn.resSubject)}</select>
    <button class="ch-btn line" type="button" data-act="res-saved" aria-pressed="${learn.resSaved}">${icon('bookmark')}Saved</button>
    ${teacher ? `<button class="ch-btn solid" type="button" data-act="res-new">${icon('add')}Add resource</button>` : ''}`;

  if (!list.length) {
    el('resourceList').innerHTML = `<div class="ch-empty">${icon('menu_book')}<h3>${all.length ? 'Nothing matches' : 'No resources yet'}</h3><p>${all.length ? 'Try another search or subject.' : (teacher ? 'Share notes, slides, reading lists or useful links with the whole college or one class.' : 'Notes, slides and links your teachers share show up here.')}</p>${!all.length && teacher ? `<button class="ch-btn solid" type="button" data-act="res-new">${icon('add')}Add resource</button>` : ''}</div>`;
    return;
  }
  el('resourceList').innerHTML = list.map(item => {
    const href = item.file_url ? mediaUrl(item.file_url) : item.url;
    return `<article class="ch-panel ch-resource">
      <div class="ch-resource-top">
        <span class="ch-resource-ico">${icon(item.file_url ? 'description' : 'link')}</span>
        <div style="flex:1;min-width:0"><h3>${escapeHtml(item.title)}</h3>
        <p class="ch-group-sub">${escapeHtml(item.author_name || 'Teacher')} · ${escapeHtml(formatTime(item.created_at))}</p></div>
        <button class="ch-icon-btn${item.saved ? ' is-on' : ''}" type="button" data-act="res-save" data-res="${item.id}" title="${item.saved ? 'Remove from saved' : 'Save for later'}" aria-label="${item.saved ? 'Remove from saved' : 'Save for later'}" aria-pressed="${item.saved}"><span class="material-symbols-outlined">${item.saved ? 'bookmark_added' : 'bookmark_add'}</span></button>
      </div>
      <div class="ch-group-tags">${item.subject ? `<span class="ch-chip indigo">${icon('category')}${escapeHtml(item.subject)}</span>` : ''}<span class="ch-chip">${icon('groups')}${escapeHtml(audienceText(item))}</span></div>
      ${item.description ? `<p class="ch-resource-text">${linkify(item.description)}</p>` : ''}
      <div class="ch-group-foot">
        <a class="ch-btn solid small" href="${escapeHtml(href)}" target="_blank" rel="noopener">${icon(item.file_url ? 'download' : 'open_in_new')}${item.file_url ? 'Open file' : 'Open link'}</a>
        ${item.file_url && item.url ? `<a class="ch-btn line small" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${icon('open_in_new')}Link</a>` : ''}
        <span class="ch-spacer"></span>
        ${teacher ? `<button class="ch-icon-btn" type="button" data-act="res-edit" data-res="${item.id}" title="Edit" aria-label="Edit"><span class="material-symbols-outlined">edit</span></button>
        <button class="ch-icon-btn danger" type="button" data-act="res-delete" data-res="${item.id}" title="Delete" aria-label="Delete"><span class="material-symbols-outlined">delete</span></button>` : ''}
      </div>
    </article>`;
  }).join('');
}

const resourceById = (button) => (learn.resources || []).find(item => item.id === Number(button.dataset.res));

hubActions['res-saved'] = () => { learn.resSaved = !learn.resSaved; renderResources(); };
hubActions['res-save'] = (button) => {
  const item = resourceById(button);
  if (!item) return;
  const next = !item.saved;
  item.saved = next;   // shown at once; put back if the server says no
  renderResources();
  api(`/api/college-hub/resources/${item.id}/save`, { method: next ? 'POST' : 'DELETE' })
    .then(() => showToast(next ? 'Saved. Find it under Saved.' : 'Removed from saved.'))
    .catch(err => { item.saved = !next; renderResources(); showToast(err.message); });
};
hubActions['res-new'] = () => openResourceForm(null);
hubActions['res-edit'] = (button) => { const item = resourceById(button); if (item) openResourceForm(item); };
hubActions['res-delete'] = (button) => {
  const item = resourceById(button);
  if (!item) return;
  confirmThen('Delete this resource?', `${item.title} is removed for everyone.`, 'Delete',
    () => run(async () => { await api(`/api/college-hub/resources/${item.id}`, { method: 'DELETE' }); await loadResources(); }, 'Resource deleted.'));
};

function openResourceForm(item) {
  const editing = Boolean(item);
  const value = (field) => escapeHtml(editing ? (item[field] || '') : '');
  const divisionOptions = (dept) => optionsOf('division', editing ? norm(item.division) : '', students().filter(person => norm(person.department) === dept));
  const file = editing && item.file_url ? { url: item.file_url, name: item.file_name } : null;
  openHubModal({
    title: editing ? 'Edit resource' : 'Share a resource',
    confirmText: editing ? 'Save changes' : 'Share',
    body: `
      <label>Title<input class="ch-input" id="resTitle" maxlength="160" value="${value('title')}" placeholder="For example: Unit 3 notes, Computer Networks"></label>
      <label>Link <small>(optional if you attach a file)</small><input class="ch-input" id="resUrl" type="url" maxlength="1000" placeholder="https://" value="${value('url')}"></label>
      ${fileFieldHtml('resFile', file)}
      <label>Subject <small>(optional)</small><input class="ch-input" id="resSubjectField" maxlength="80" list="resSubjects" value="${value('subject')}"><datalist id="resSubjects">${subjectOptions(learn.resources)}</datalist></label>
      <label>Description <small>(optional)</small><textarea class="ch-textarea" id="resText" maxlength="2000" placeholder="What it covers and how to use it">${value('description')}</textarea></label>
      <div class="ch-row2">
        <label>For<select class="ch-select" id="resDept"><option value="">Whole college</option>${optionsOf('department', editing ? norm(item.department) : '')}</select></label>
        <label>Division<select class="ch-select" id="resDivision"><option value="">All divisions</option>${editing && item.department ? divisionOptions(norm(item.department)) : ''}</select></label>
      </div>`,
    onOpen: () => {
      bindFileField('resFile', file);
      el('resDept').addEventListener('change', (e) => {
        el('resDivision').innerHTML = '<option value="">All divisions</option>' + (e.target.value ? divisionOptions(e.target.value) : '');
      });
    },
    onConfirm: async () => {
      const labelOf = (select) => (select.value ? select.options[select.selectedIndex].textContent : '');
      const input = el('resFile');
      if (input.hubUploading) throw new Error('Wait for the file to finish uploading.');
      const body = {
        title: el('resTitle').value, url: el('resUrl').value.trim(), file_url: input.hubFile ? input.hubFile.url : '', file_name: input.hubFile ? input.hubFile.name : '',
        subject: el('resSubjectField').value, description: el('resText').value, department: labelOf(el('resDept')), division: labelOf(el('resDivision'))
      };
      if (!body.title.trim()) throw new Error('Give the resource a title.');
      if (!body.url && !body.file_url) throw new Error('Add a link or a file.');
      if (editing) await api(`/api/college-hub/resources/${item.id}`, { method: 'PUT', body });
      else await api('/api/college-hub/resources', { method: 'POST', body });
      await loadResources();
      showToast(editing ? 'Resource updated.' : 'Shared.');
    }
  });
}

// ==========================================
// 2. QUESTIONS AND ANSWERS
// ==========================================
async function loadQuestions() {
  if (learn.qaLoading) return;
  learn.qaLoading = true;
  try {
    learn.questions = (await api('/api/college-hub/questions')).questions;
    learn.qaError = '';
  } catch (err) {
    learn.qaError = err.message;
  } finally {
    learn.qaLoading = false;
    if (view.tab === 'qa' && !learn.qaOpen) renderQa();
  }
}

async function openThread(id) {
  learn.qaOpen = id;
  learn.thread = null;
  renderQa();
  try {
    learn.thread = await api(`/api/college-hub/questions/${id}`);
  } catch (err) {
    learn.qaOpen = null;
    showToast(err.message);
  }
  if (view.tab === 'qa') renderQa();
}

// Someone asked, answered or voted: refresh what is on screen, once for several changes close together
function applyQaEvent() {
  if (!learn.questions) return;
  clearTimeout(qaReloadTimer);
  qaReloadTimer = setTimeout(async () => {
    await loadQuestions();
    if (learn.qaOpen) {
      try { learn.thread = await api(`/api/college-hub/questions/${learn.qaOpen}`); } catch (err) { learn.qaOpen = null; }
      if (view.tab === 'qa') renderQa();
    }
  }, 400);
}

function renderQa() {
  if (learn.qaOpen) return renderThread();
  const all = learn.questions;
  if (!all) {
    el('qaBar').innerHTML = '<h2 class="ch-bar-title">Questions</h2>';
    el('qaList').innerHTML = learn.qaError ? `<div class="ch-empty">${icon('cloud_off')}<h3>Could not load questions</h3><p>${escapeHtml(learn.qaError)}</p></div>` : '<div class="skeleton" style="height:120px"></div>';
    if (!learn.qaError) loadQuestions();
    return;
  }
  const query = norm(learn.qaQuery);
  const list = all.filter(item =>
    (learn.qaFilter !== 'open' || !item.accepted_answer_id) && (learn.qaFilter !== 'unanswered' || !item.answers) && (learn.qaFilter !== 'mine' || item.mine) &&
    (!learn.qaSubject || item.subject === learn.qaSubject) && (!query || norm(`${item.title} ${item.body} ${item.subject}`).includes(query)));
  const filters = [['all', 'All'], ['unanswered', 'No answer yet'], ['open', 'Not solved'], ['mine', 'Mine']];

  el('qaBar').innerHTML = `
    <h2 class="ch-bar-title">Questions<small>${list.length}</small></h2>
    <div class="ch-seg ch-seg-inline" role="group" aria-label="Show">${filters.map(([key, label]) => `<button type="button" data-act="qa-filter" data-filter="${key}" aria-pressed="${learn.qaFilter === key}">${label}</button>`).join('')}</div>
    <input class="ch-input" id="qaSearch" type="search" placeholder="Search questions" aria-label="Search questions" value="${escapeHtml(learn.qaQuery)}">
    <select class="ch-select" id="qaSubject" aria-label="Subject"><option value="">All subjects</option>${subjectOptions(all, learn.qaSubject)}</select>
    <button class="ch-btn solid" type="button" data-act="qa-ask">${icon('add_comment')}Ask a question</button>`;

  el('qaList').innerHTML = list.length ? list.map(item => `
    <article class="ch-panel ch-question" data-act="qa-open" data-q="${item.id}" tabindex="0" role="button" aria-label="Open question: ${escapeHtml(item.title)}">
      <button class="ch-vote${item.voted ? ' is-on' : ''}" type="button" data-act="qa-vote" data-q="${item.id}" aria-pressed="${item.voted}" title="${item.voted ? 'You have this question too' : 'I have this question too'}">
        <span class="material-symbols-outlined">arrow_upward</span><b>${item.votes}</b><small>me too</small></button>
      <div class="ch-question-main">
        <h3>${escapeHtml(item.title)}</h3>
        ${item.body ? `<p class="ch-question-text">${escapeHtml(item.body.slice(0, 220))}${item.body.length > 220 ? '…' : ''}</p>` : ''}
        <div class="ch-group-tags">
          ${item.accepted_answer_id ? `<span class="ch-chip green">${icon('check_circle')}Solved</span>` : ''}
          <span class="ch-chip ${item.answers ? 'indigo' : ''}">${icon('forum')}${plural(item.answers, 'answer', 'answers')}</span>
          ${item.subject ? `<span class="ch-chip">${icon('category')}${escapeHtml(item.subject)}</span>` : ''}
          ${item.department ? `<span class="ch-chip">${icon('meeting_room')}${escapeHtml(audienceText(item))}</span>` : ''}
          <span class="ch-question-by">${escapeHtml(item.author_name)}${item.anonymous && item.author_id ? ' (anonymous to students)' : ''} · ${escapeHtml(formatTime(item.created_at))}</span>
        </div>
      </div>
    </article>`).join('')
    : `<div class="ch-empty">${icon('live_help')}<h3>${all.length ? 'No questions match' : 'No questions yet'}</h3><p>${all.length ? 'Try another filter.' : 'Stuck on something? Ask the college. Anyone can answer, and teachers can see every question.'}</p>${all.length ? '' : `<button class="ch-btn solid" type="button" data-act="qa-ask">${icon('add_comment')}Ask a question</button>`}</div>`;
}

function renderThread() {
  el('qaBar').innerHTML = `<button class="ch-btn line" type="button" data-act="qa-back">${icon('arrow_back')}All questions</button>`;
  const item = learn.thread;
  if (!item) { el('qaList').innerHTML = '<div class="skeleton" style="height:180px"></div>'; return; }
  const mayAccept = isTeacher() || item.mine;
  const mayDelete = isTeacher() || item.mine;
  const summary = (learn.questions || []).find(entry => entry.id === item.id);
  const answers = [...item.answers].sort((a, b) => (b.id === item.accepted_answer_id) - (a.id === item.accepted_answer_id) || a.id - b.id);
  el('qaList').innerHTML = `
    <article class="ch-panel ch-thread">
      <div class="ch-post-top">
        ${item.subject ? `<span class="ch-chip indigo">${icon('category')}${escapeHtml(item.subject)}</span>` : ''}
        <span class="ch-chip">${icon('groups')}${escapeHtml(audienceText(item))}</span>
        ${item.accepted_answer_id ? `<span class="ch-chip green">${icon('check_circle')}Solved</span>` : ''}
        <time>${escapeHtml(formatTime(item.created_at))}</time>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      ${item.body ? `<div class="ch-post-body">${linkify(item.body)}</div>` : ''}
      <div class="ch-post-actions">
        <span class="ch-thread-by">${avatarOf({ name: item.author_name, profile_pic: item.author_pic })}${escapeHtml(item.author_name)}${item.anonymous && item.author_id ? ' <span class="ch-chip">Anonymous to students</span>' : ''}</span>
        <span class="ch-spacer"></span>
        ${summary ? `<button class="ch-btn line small${summary.voted ? ' is-on' : ''}" type="button" data-act="qa-vote" data-q="${item.id}" aria-pressed="${summary.voted}">${icon('arrow_upward')}Me too · ${summary.votes}</button>` : ''}
        ${mayDelete ? `<button class="ch-icon-btn danger" type="button" data-act="qa-delete" data-q="${item.id}" title="Delete question" aria-label="Delete question"><span class="material-symbols-outlined">delete</span></button>` : ''}
      </div>
    </article>
    <h3 class="ch-answers-title">${plural(item.answers.length, 'answer', 'answers')}</h3>
    ${answers.map(answer => {
      const accepted = answer.id === item.accepted_answer_id;
      return `<article class="ch-panel ch-answer${accepted ? ' is-accepted' : ''}">
        <div class="ch-msg-head">${avatarOf({ name: answer.author_name, profile_pic: answer.author_pic })}<b>${escapeHtml(answer.author_name)}${answer.author_id === hub.me.id ? ' (you)' : ''}</b>
          ${answer.is_teacher ? '<span class="ch-chip navy">Teacher</span>' : ''}${accepted ? `<span class="ch-chip green">${icon('check_circle')}Best answer</span>` : ''}<time>${escapeHtml(formatTime(answer.created_at))}</time></div>
        <div class="ch-post-body">${linkify(answer.body)}</div>
        ${mayAccept || isTeacher() || answer.author_id === hub.me.id ? `<div class="ch-review-actions">
          ${mayAccept ? `<button class="ch-btn line small" type="button" data-act="qa-accept" data-answer="${accepted ? '' : answer.id}">${icon(accepted ? 'remove_done' : 'check_circle')}${accepted ? 'Unmark best answer' : 'Mark as best answer'}</button>` : ''}
          ${isTeacher() || answer.author_id === hub.me.id ? `<button class="ch-btn line small danger" type="button" data-act="qa-delete-answer" data-answer="${answer.id}">Delete</button>` : ''}
        </div>` : ''}
      </article>`;
    }).join('')}
    <form class="ch-panel ch-answer-form" id="answerForm">
      <label class="ch-field-label" for="answerText">Your answer</label>
      <textarea class="ch-textarea" id="answerText" maxlength="4000" placeholder="Explain it the way you would to a classmate"></textarea>
      <div class="ch-review-actions"><p class="ch-form-error ch-hidden" id="answerError" role="alert"></p><span class="ch-spacer"></span><button class="ch-btn solid" type="submit">${icon('send')}Post answer</button></div>
    </form>`;
  el('answerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = el('answerText').value.trim();
    const error = el('answerError');
    if (!text) { error.textContent = 'Write your answer.'; error.classList.remove('ch-hidden'); return; }
    e.submitter && (e.submitter.disabled = true);
    try {
      await api(`/api/college-hub/questions/${item.id}/answers`, { method: 'POST', body: { body: text } });
      learn.thread = await api(`/api/college-hub/questions/${item.id}`);
      showToast('Answer posted.');
      renderQa();
      loadQuestions();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('ch-hidden');
      e.submitter && (e.submitter.disabled = false);
    }
  });
}

hubActions['qa-filter'] = (button) => { learn.qaFilter = button.dataset.filter; renderQa(); };
hubActions['qa-open'] = (button) => openThread(Number(button.dataset.q));
hubActions['qa-back'] = () => { learn.qaOpen = null; learn.thread = null; renderQa(); };
hubActions['qa-vote'] = (button) => {
  const item = (learn.questions || []).find(entry => entry.id === Number(button.dataset.q));
  if (!item) return;
  const next = !item.voted;
  item.voted = next;
  item.votes += next ? 1 : -1;
  renderQa();
  api(`/api/college-hub/questions/${item.id}/vote`, { method: next ? 'POST' : 'DELETE' })
    .catch(err => { item.voted = !next; item.votes += next ? -1 : 1; renderQa(); showToast(err.message); });
};
hubActions['qa-delete'] = (button) => {
  const id = Number(button.dataset.q);
  confirmThen('Delete this question?', 'The question and all its answers are removed for everyone.', 'Delete', async () => {
    try {
      await api(`/api/college-hub/questions/${id}`, { method: 'DELETE' });
      learn.qaOpen = null;
      learn.thread = null;
      showToast('Question deleted.');
      await loadQuestions();
      renderQa();
    } catch (err) { showToast(err.message); }
  });
};
hubActions['qa-accept'] = async (button) => {
  const answerId = button.dataset.answer ? Number(button.dataset.answer) : null;
  try {
    await api(`/api/college-hub/questions/${learn.qaOpen}/accept`, { method: 'POST', body: { answer_id: answerId } });
    learn.thread = await api(`/api/college-hub/questions/${learn.qaOpen}`);
    showToast(answerId ? 'Marked as the best answer.' : 'Unmarked.');
    renderQa();
    loadQuestions();
  } catch (err) { showToast(err.message); }
};
hubActions['qa-delete-answer'] = (button) => {
  const id = Number(button.dataset.answer);
  confirmThen('Delete this answer?', 'The answer is removed for everyone.', 'Delete', async () => {
    try {
      await api(`/api/college-hub/answers/${id}`, { method: 'DELETE' });
      learn.thread = await api(`/api/college-hub/questions/${learn.qaOpen}`);
      showToast('Answer deleted.');
      renderQa();
      loadQuestions();
    } catch (err) { showToast(err.message); }
  });
};

hubActions['qa-ask'] = () => {
  const student = hub.me.role === 'student';
  openHubModal({
    title: 'Ask a question',
    confirmText: 'Ask',
    body: `
      <label>Your question<input class="ch-input" id="askTitle" maxlength="200" placeholder="For example: How do we cite a dataset in the report?"></label>
      <label>Details <small>(optional)</small><textarea class="ch-textarea" id="askBody" maxlength="4000" placeholder="What you tried, where you are stuck"></textarea></label>
      <label>Subject <small>(optional)</small><input class="ch-input" id="askSubject" maxlength="80" list="askSubjects"><datalist id="askSubjects">${subjectOptions(learn.questions)}</datalist></label>
      ${student && hub.me.department ? `<label class="ch-check"><input type="checkbox" id="askClass">Ask only my class (${escapeHtml(classLabel(hub.me))})</label>` : ''}
      ${student ? `<label class="ch-check"><input type="checkbox" id="askAnon">Ask anonymously</label>
      <p class="ch-muted" style="margin-top:-8px">Classmates will not see your name. Teachers can, so the space stays respectful.</p>` : ''}`,
    onConfirm: async () => {
      const title = el('askTitle').value.trim();
      if (!title) throw new Error('Write your question.');
      const result = await api('/api/college-hub/questions', { method: 'POST', body: {
        title, body: el('askBody').value, subject: el('askSubject').value,
        to_class: Boolean(el('askClass') && el('askClass').checked), anonymous: Boolean(el('askAnon') && el('askAnon').checked)
      } });
      showToast('Question posted.');
      await loadQuestions();
      openThread(result.id);
    }
  });
};

// Search boxes and subject lists in both tabs
function bindLearn() {
  el('resourceBar').addEventListener('input', (e) => {
    if (e.target.id !== 'resSearch') return;
    learn.resQuery = e.target.value;
    renderResources();
    keepFocus('resSearch');
  });
  el('qaBar').addEventListener('input', (e) => {
    if (e.target.id !== 'qaSearch') return;
    learn.qaQuery = e.target.value;
    renderQa();
    keepFocus('qaSearch');
  });
  el('qaList').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ch-question')) { e.preventDefault(); openThread(Number(e.target.dataset.q)); }
  });
}

hubChangeHandlers.push((target) => {
  if (target.id === 'resSubject') { learn.resSubject = target.value; renderResources(); return true; }
  if (target.id === 'qaSubject') { learn.qaSubject = target.value; renderQa(); return true; }
  return false;
});
