// ==========================================
// NOTES.JS — Notes and past papers: students share study files; everyone can search, upvote, save and download.
// Loaded after shared.js, chat-common.js and formsheet.js. Searching, filtering and sorting happen here in the browser.
// ==========================================

const NOTE_KINDS = [['notes', 'Notes'], ['paper', 'Past papers'], ['lab', 'Lab manuals'], ['book', 'Books']];
const NOTE_KIND_ONE = { notes: 'Notes', paper: 'Past paper', lab: 'Lab manual', book: 'Book' };
const NOTE_KIND_ICON = { notes: 'description', paper: 'quiz', lab: 'science', book: 'menu_book' };
const NOTES_STEP = 20;
const NOTE_MAX_BYTES = 25 * 1024 * 1024;
const NOTES_REFRESH_MS = 60000;

let notes = [];                   // every note the server sent, newest first
let notesMe = { college: '', department: '', has_college: false };
let notesLoaded = false;
let notesLoading = false;
let notesLoadedAt = 0;
let notesSearchTimer = null;
const notesView = { q: '', scope: 'all', kind: '', department: '', semester: '', sort: 'useful', only: '', shown: NOTES_STEP };
const notesPending = new Set();

const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const noteOf = (id) => notes.find(note => note.id === id);

// ==========================================
// 1. LOADING
// ==========================================
function initNotes() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('show') === 'reported') notesView.only = 'reported';
  if (params.get('q')) notesView.q = params.get('q').trim();
  if (NOTE_KINDS.some(([value]) => value === params.get('kind'))) notesView.kind = params.get('kind');
  el('notesSearch').value = notesView.q;
  bindNotes();

  const cached = cacheGet('notes');
  if (cached && Array.isArray(cached.notes)) setNotes(cached, true);
  else el('notesList').innerHTML = '<div class="skeleton hm-skel"></div>'.repeat(4);

  loadNotes();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - notesLoadedAt > NOTES_REFRESH_MS && !document.querySelector('.fs-overlay')) loadNotes();
  });
}

async function loadNotes() {
  if (notesLoading) return;
  notesLoading = true;
  try {
    const data = await fetchPageData('/api/notes');
    notesLoadedAt = Date.now();
    setNotes(data, false);
    cacheSet('notes', data);
  } catch (err) {
    if (!notesLoaded) {
      el('notesList').innerHTML = `<div class="hm-card hm-problem">${icon('cloud_off')}<p>${escapeHtml(err.message)}</p><button class="hm-btn" type="button" data-act="retry">Try again</button></div>`;
    }
  } finally {
    notesLoading = false;
  }
}

function setNotes(data, fromCache) {
  const first = !notesLoaded;
  notes = data.notes.map(note => ({ ...note, text: [note.title, note.subject, note.department, note.description, note.college, note.uploader, note.year || ''].join(' ').toLowerCase() }));
  notesMe = data.me;
  notesLoaded = true;
  // The first look opens on the student's own college when it has something to show
  if (first && notesView.only !== 'reported' && notes.some(note => note.same_college)) notesView.scope = 'college';
  renderNotes();
}

// ==========================================
// 2. FILTERING AND RENDERING
// ==========================================
function filteredNotes() {
  const view = notesView;
  const tokens = view.q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = notes.filter(note => {
    if (view.only === 'reported') return note.reports > 0 || note.hidden;
    if (view.only === 'saved' && !note.saved) return false;
    if (view.only === 'mine' && !note.mine) return false;
    if (view.scope === 'college' && !note.same_college && !view.only) return false;
    if (view.kind && note.kind !== view.kind) return false;
    if (view.department && note.department.toLowerCase() !== view.department) return false;
    if (view.semester && String(note.semester || '') !== view.semester) return false;
    return tokens.every(token => note.text.includes(token));
  });
  if (view.sort === 'useful') list.sort((a, b) => (b.votes - a.votes) || (b.downloads - a.downloads) || (b.id - a.id));
  else if (view.sort === 'downloads') list.sort((a, b) => (b.downloads - a.downloads) || (b.id - a.id));
  else list.sort((a, b) => b.id - a.id);
  return list;
}

function noteCardHtml(note) {
  const facts = [note.subject, note.semester ? `Sem ${note.semester}` : '', note.year || '', note.department].filter(Boolean).map(escapeHtml).join(' · ');
  const by = [note.college || 'No college listed', `by ${note.mine ? 'you' : note.uploader}`, formatBytes(note.file_size), plural(note.downloads, 'download', 'downloads'), timeAgo(note.created_at)].filter(Boolean).map(escapeHtml).join(' · ');
  const flag = note.hidden ? `<span class="nt-flag">Hidden: ${plural(note.reports || 3, 'report', 'reports')}</span>` : (note.reports ? `<span class="nt-flag">${plural(note.reports, 'report', 'reports')}</span>` : '');
  const manage = [
    note.mine ? `<button type="button" class="nt-link" data-act="edit">Edit</button>` : '',
    note.can_remove ? `<button type="button" class="nt-link is-danger" data-act="delete">${note.mine ? 'Delete' : 'Take down'}</button>` : '',
    !note.mine && (note.reports || note.hidden) && note.can_remove ? `<button type="button" class="nt-link" data-act="keep">Nothing wrong</button>` : '',
    !note.mine && !note.can_remove ? `<button type="button" class="nt-link" data-act="report" ${note.reported ? 'disabled' : ''}>${note.reported ? 'Reported' : 'Report'}</button>` : ''
  ].join('');
  return `
    <article class="nt-card" data-id="${note.id}">
      <div class="nt-vote">
        <button type="button" data-act="vote" aria-pressed="${note.voted}" aria-label="${note.voted ? 'Take back your upvote' : 'Upvote: this was useful'}" title="This was useful">${icon('arrow_upward')}</button>
        <b>${note.votes}</b>
      </div>
      <div class="nt-body">
        <h3><span class="nt-kind">${icon(NOTE_KIND_ICON[note.kind])}${NOTE_KIND_ONE[note.kind]}</span>${escapeHtml(note.title)}${flag}</h3>
        <p class="nt-meta">${facts}</p>
        ${note.description ? `<p class="nt-desc">${escapeHtml(note.description)}</p>` : ''}
        <p class="nt-by">${by}</p>
        <div class="nt-manage">${manage}${note.kind === 'paper' ? `<a class="nt-link" href="prep.html?note=${note.id}">Add its questions to Exam Prep</a>` : ''}${/\.(pdf|png|jpe?g|webp)$/i.test(note.file_url || '') ? `<a class="nt-link" href="tutor.html?note=${note.id}">Make flashcards with the AI tutor</a>` : ''}</div>
      </div>
      <div class="nt-actions">
        <a class="hm-btn" href="${escapeHtml(safeUrl(note.file_url))}" target="_blank" rel="noopener" data-act="download">${icon('download')}Open</a>
        <button type="button" class="st-iconbtn" data-act="save" aria-pressed="${note.saved}" title="${note.saved ? 'Remove from saved' : 'Save for later'}" aria-label="${note.saved ? 'Remove from saved' : 'Save for later'}">${icon(note.saved ? 'bookmark_added' : 'bookmark_add')}</button>
      </div>
    </article>`;
}

function renderNotesFilters() {
  const chip = (act, value, label, pressed) => `<button type="button" class="st-chip" data-act="${act}" data-value="${value}" aria-pressed="${pressed}">${label}</button>`;
  const view = notesView;
  const pool = notes.filter(note => view.scope !== 'college' || note.same_college);
  const departments = [...new Map(pool.filter(note => note.department).map(note => [note.department.toLowerCase(), note.department])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const semesters = [...new Set(pool.filter(note => note.semester).map(note => note.semester))].sort((a, b) => a - b);
  const reported = notes.filter(note => note.reports > 0 || (note.hidden && note.can_remove && !note.mine)).length;
  el('notesFilters').innerHTML = `
    <div class="st-chips">
      ${notesMe.has_college ? chip('scope', 'college', 'My college', view.scope === 'college' && !view.only) : ''}
      ${chip('scope', 'all', 'All colleges', view.scope === 'all' && !view.only)}
      <span class="nt-sep"></span>
      ${chip('kind', '', 'Everything', !view.kind)}${NOTE_KINDS.map(([value, label]) => chip('kind', value, label, view.kind === value)).join('')}
      <span class="nt-sep"></span>
      ${chip('only', 'saved', 'Saved', view.only === 'saved')}${chip('only', 'mine', 'Shared by me', view.only === 'mine')}
      ${reported ? chip('only', 'reported', `Reported (${reported})`, view.only === 'reported') : ''}
    </div>
    <div class="nt-selects">
      <select data-change="department" aria-label="Branch"><option value="">All branches</option>${departments.map(([value, label]) => `<option value="${escapeHtml(value)}" ${view.department === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
      <select data-change="semester" aria-label="Semester"><option value="">All semesters</option>${semesters.map(value => `<option value="${value}" ${view.semester === String(value) ? 'selected' : ''}>Semester ${value}</option>`).join('')}</select>
      <select data-change="sort" aria-label="Sort by">
        ${[['useful', 'Most useful'], ['newest', 'Newest'], ['downloads', 'Most downloaded']].map(([value, label]) => `<option value="${value}" ${view.sort === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    </div>`;
}

function renderNotes() {
  renderNotesFilters();
  const list = filteredNotes();
  const view = notesView;
  el('notesCount').textContent = list.length === notes.length ? plural(notes.length, 'file', 'files') : `${list.length} of ${plural(notes.length, 'file', 'files')}`;
  if (!list.length) {
    const filtered = view.q || view.kind || view.department || view.semester || view.only;
    const [title, text] = !notes.length ? ['Nothing shared yet', 'Be the first: share your notes or a past paper and help your whole class.']
      : view.only === 'saved' ? ['Nothing saved', 'Use the bookmark on a file to keep it here for exam time.']
      : view.only === 'mine' ? ['You have not shared anything yet', 'Notes and past papers you share show up here.']
      : filtered ? ['No file matches that', 'Try a different word, or clear the filters.']
      : ['Nothing from your college yet', 'Share the first file for your college, or look at what other colleges have shared.'];
    el('notesList').innerHTML = `<div class="hm-card"><div class="st-empty">${icon('folder_open')}<strong>${title}</strong><p>${text}</p>
      <div class="st-empty-actions"><button class="hm-btn" type="button" data-act="upload">${icon('upload')}Share a file</button>
        ${filtered ? '<button class="hm-btn is-quiet" type="button" data-act="clear">Clear filters</button>' : (view.scope === 'college' && notes.length ? '<button class="hm-btn is-quiet" type="button" data-act="scope" data-value="all">See all colleges</button>' : '')}</div></div></div>`;
    return;
  }
  const visible = list.slice(0, view.shown);
  el('notesList').innerHTML = visible.map(noteCardHtml).join('')
    + (list.length > visible.length ? `<button type="button" class="hm-btn is-quiet nt-more" data-act="more">Show ${Math.min(NOTES_STEP, list.length - visible.length)} more</button>` : '');
}

function redrawNote(note) {
  const card = el('notesList').querySelector(`[data-id="${note.id}"]`);
  if (card) card.outerHTML = noteCardHtml(note);
}

// ==========================================
// 3. SHARING A FILE
// ==========================================
async function uploadNoteFile(file) {
  const form = new FormData();
  form.append('file', file, file.name);
  let res;
  try {
    res = await fetch(`${API_BASE}/api/upload/note-file`, { method: 'POST', credentials: 'include', body: form });
  } catch (e) {
    throw new Error('The upload did not go through. Check your connection.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 401) { handleLoggedOut(); throw new Error('Please log in again.'); }
  if (!res.ok || !data) throw new Error(data && typeof data.detail === 'string' ? data.detail : 'Upload failed. Try again.');
  return data;
}

function noteFields(note) {
  const n = note || { kind: 'notes', department: notesMe.department };
  return [
    ...(note ? [] : [{ name: 'file', label: 'File', type: 'file', required: true, accept: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.zip',
                       hint: 'PDF, Word, slides, pictures or zip. Up to 25 MB.' }]),
    { name: 'title', label: 'Title', value: n.title, required: true, maxlength: 140, placeholder: 'Unit 3 notes: Normalisation' },
    { name: 'kind', label: 'Type', type: 'select', options: NOTE_KINDS.map(([value]) => [value, NOTE_KIND_ONE[value]]), value: n.kind, half: true },
    { name: 'subject', label: 'Subject', value: n.subject, required: true, maxlength: 80, placeholder: 'DBMS', half: true },
    { name: 'department', label: 'Branch', value: n.department, maxlength: 120, placeholder: 'Computer Engineering' },
    { name: 'semester', label: 'Semester', type: 'number', value: n.semester, min: 1, max: 14, step: 1, half: true },
    { name: 'year', label: 'Exam year (past papers)', type: 'number', value: n.year, min: 1990, max: new Date().getFullYear() + 1, step: 1, half: true },
    { name: 'description', label: 'What is in it (optional)', type: 'textarea', value: n.description, maxlength: 600 },
    ...(note ? [] : [{ name: 'may_share', label: 'This is my own work, or I am allowed to share it', type: 'checkbox' }])
  ];
}

function openUpload() {
  openSheet({
    title: 'Share notes or a past paper', fields: noteFields(), submitLabel: 'Share',
    onSubmit: async (values) => {
      if (!values.may_share) throw new Error('Tick the box to confirm you are allowed to share this file.');
      if (values.file.size > NOTE_MAX_BYTES) throw new Error('That file is over 25 MB. Compress it or split it.');
      const uploaded = await uploadNoteFile(values.file);
      const { file, ...details } = values;
      await api('/api/notes', { method: 'POST', body: { ...details, file_url: uploaded.url, file_name: file.name } });
      notesView.only = 'mine';
      notesView.sort = 'newest';
      showToast('Shared. Thank you.');
      await loadNotes();
    }
  });
}

// ==========================================
// 4. CONTROLS
// ==========================================
async function toggleNote(note, kind) {
  const key = `${kind}:${note.id}`;
  if (notesPending.has(key)) return;
  notesPending.add(key);
  const field = kind === 'vote' ? 'voted' : 'saved';
  const before = { on: note[field], votes: note.votes };
  note[field] = !before.on;
  if (kind === 'vote') note.votes += note.voted ? 1 : -1;
  redrawNote(note);
  try {
    const result = await api(`/api/notes/${note.id}/${kind}`, { method: 'POST' });
    note[field] = result[field];
    if (kind === 'vote') note.votes = result.votes;
    if (kind === 'save') showToast(note.saved ? 'Saved. Find it under Saved.' : 'Removed from saved.');
  } catch (err) {
    note[field] = before.on;
    note.votes = before.votes;
    showToast(err.message);
  }
  notesPending.delete(key);
  redrawNote(note);
}

const noteActions = {
  retry: () => loadNotes(),
  upload: () => openUpload(),
  more: () => { notesView.shown += NOTES_STEP; renderNotes(); },
  clear: () => { Object.assign(notesView, { q: '', kind: '', department: '', semester: '', only: '', shown: NOTES_STEP }); el('notesSearch').value = ''; renderNotes(); },
  scope: (button) => { notesView.scope = button.dataset.value; notesView.only = ''; notesView.department = ''; notesView.semester = ''; notesView.shown = NOTES_STEP; renderNotes(); },
  kind: (button) => { notesView.kind = button.dataset.value; notesView.shown = NOTES_STEP; renderNotes(); },
  only: (button) => { notesView.only = notesView.only === button.dataset.value ? '' : button.dataset.value; notesView.shown = NOTES_STEP; renderNotes(); },
  vote: (button, note) => toggleNote(note, 'vote'),
  save: (button, note) => toggleNote(note, 'save'),
  // The link opens the file by itself; this only adds one to the count
  download: (button, note) => { note.downloads += 1; api(`/api/notes/${note.id}/download`, { method: 'POST' }).catch(() => {}); },
  edit: (button, note) => openSheet({
    title: 'Edit details', fields: noteFields(note),
    onSubmit: async (values) => {
      await api(`/api/notes/${note.id}`, { method: 'PUT', body: values });
      await loadNotes();
    }
  }),
  delete: async (button, note) => {
    if (!window.confirm(note.mine ? `Delete "${note.title}" and its file? This cannot be undone.` : `Take down "${note.title}"? The person who shared it is told.`)) return;
    try {
      await api(`/api/notes/${note.id}`, { method: 'DELETE' });
      notes = notes.filter(entry => entry.id !== note.id);
      renderNotes();
      showToast(note.mine ? 'Deleted.' : 'Taken down.');
    } catch (err) { showToast(err.message); }
  },
  keep: async (button, note) => {
    try {
      await api(`/api/notes/${note.id}/keep`, { method: 'POST' });
      note.reports = 0; note.hidden = false;
      renderNotes();
      showToast('Reports cleared. The file stays.');
    } catch (err) { showToast(err.message); }
  },
  report: (button, note) => openSheet({
    title: 'Report this file', submitLabel: 'Report', note: 'A teacher of that college or the Connect2Minds team will look at it.',
    fields: [{ name: 'reason', label: 'What is wrong with it', type: 'select', options: [
      ['Wrong subject or mislabelled', 'Wrong subject or mislabelled'], ['Not theirs to share (copyright)', 'Not theirs to share (copyright)'],
      ['Spam or not study material', 'Spam or not study material'], ['The file is broken or empty', 'The file is broken or empty'], ['Something else', 'Something else']] }],
    onSubmit: async (values) => {
      await api(`/api/notes/${note.id}/report`, { method: 'POST', body: values });
      note.reported = true;
      redrawNote(note);
      showToast('Reported. Thank you.');
    }
  })
};

function bindNotes() {
  document.querySelector('.st-page').addEventListener('click', (e) => {
    const button = e.target.closest('[data-act]');
    if (!button || button.disabled || !noteActions[button.dataset.act]) return;
    const card = button.closest('[data-id]');
    const note = card ? noteOf(Number(card.dataset.id)) : null;
    if (card && !note) return;
    noteActions[button.dataset.act](button, note);
  });
  el('notesFilters').addEventListener('change', (e) => {
    const key = e.target.dataset.change;
    if (!key) return;
    notesView[key] = e.target.value;
    notesView.shown = NOTES_STEP;
    renderNotes();
  });
  el('notesSearch').addEventListener('input', (e) => {
    clearTimeout(notesSearchTimer);
    notesSearchTimer = setTimeout(() => { notesView.q = e.target.value.trim(); notesView.shown = NOTES_STEP; renderNotes(); }, 150);
  });
}

// The top bar's search field (Ctrl K) lands in this page's own search box
window.focusHeaderSearch = () => { el('notesSearch').focus(); el('notesSearch').select(); };

initNotes();
