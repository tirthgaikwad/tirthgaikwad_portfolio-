// ==========================================
// PREP-QUESTIONS.JS — Exam Prep: the Past-paper questions tab. Students add questions from previous papers and the
// years they were asked; the list puts the most-asked first. Opened from a past paper in Notes with ?note=ID.
// ==========================================

const questionFilter = { unit: '', marks: '' };

async function loadQuestions(syllabusId, force) {
  const key = `questions:${syllabusId}`;
  if (!prepCache[key] || force) prepCache[key] = await api(`/api/prep/syllabi/${syllabusId}/questions`);
  return prepCache[key];
}

prepViews.questions = async (box, subject) => {
  const s = subject.syllabus;
  const key = `questions:${s.id}`;
  if (!prepCache[key]) box.innerHTML = '<div class="hm-list"><div class="skeleton hm-skel"></div><div class="skeleton hm-skel"></div></div>';
  let data;
  try { data = await loadQuestions(s.id); } catch (err) { box.innerHTML = `<p class="hm-note">${escapeHtml(err.message)}</p>`; return; }
  if (prepRoute().subject !== subject.id || prepRoute().tab !== 'questions') return;      // moved on while loading
  const units = Object.fromEntries(s.units.map(unit => [unit.id, unit]));
  const shown = data.questions.filter(q => (!questionFilter.unit || String(q.unit_id) === questionFilter.unit) && (!questionFilter.marks || String(q.marks) === questionFilter.marks));
  const marks = [...new Set(data.questions.map(q => q.marks).filter(Boolean))].sort((a, b) => a - b);
  const papers = data.papers.length;
  box.innerHTML = `
    <div class="hm-head"><h2>Past-paper questions ${data.questions.length ? `<span class="hm-count">${data.questions.length}</span>` : ''}</h2>
      <button class="hm-btn" type="button" data-pp="addQuestion" data-id="${subject.id}">${ppIcon('add')}Add a question</button></div>
    ${data.questions.length ? `
      <div class="pp-filters">
        <select data-pp-change="questionUnit" aria-label="Unit"><option value="">All units</option>${s.units.map(unit => `<option value="${unit.id}"${String(unit.id) === questionFilter.unit ? ' selected' : ''}>Unit ${unit.number}: ${escapeHtml(unit.title)}</option>`).join('')}</select>
        ${marks.length ? `<select data-pp-change="questionMarks" aria-label="Marks"><option value="">Any marks</option>${marks.map(m => `<option value="${m}"${String(m) === questionFilter.marks ? ' selected' : ''}>${m} marks</option>`).join('')}</select>` : ''}
        ${papers ? `<span class="hm-note">From ${ppPlural(papers, 'paper', 'papers')}: ${data.papers.slice(0, 6).join(', ')}${papers > 6 ? '…' : ''}</span>` : ''}
      </div>
      ${shown.length ? shown.map(q => questionHtml(q, units, subject, papers)).join('') : '<p class="hm-note">No questions match these filters.</p>'}` : `
      <div class="st-empty">${ppIcon('history_edu')}<strong>Collect the questions your university asks</strong>
        <p>Open a previous-year paper and add its questions here with the year. When a question comes up in several papers it rises to the top, so the whole class knows what to prepare first.</p>
        <div class="st-empty-actions"><a class="hm-btn is-quiet" href="notes.html?kind=paper">Find past papers</a></div></div>`}`;
};

function questionHtml(q, units, subject, papers) {
  const unit = units[q.unit_id];
  const hot = q.years.length >= 2 && (papers <= 2 || q.years.length >= Math.ceil(papers / 2));
  return `
    <div class="pp-q">
      <div class="pp-q-text">${escapeHtml(q.text)}</div>
      <div class="pp-q-meta">
        ${hot ? `<span class="pp-hot">${ppIcon('local_fire_department')}Asked ${q.years.length} times</span>` : ''}
        ${q.marks ? `<span class="pp-chip">${q.marks} marks</span>` : ''}
        ${unit ? `<span class="pp-chip is-quiet">Unit ${unit.number}</span>` : ''}
        ${q.years.map(y => `<span class="pp-year">${y}</span>`).join('')}
      </div>
      <div class="pp-q-actions">
        <button class="pp-small" type="button" data-pp="voteQuestion" data-id="${q.id}" aria-pressed="${q.voted}" title="Worth preparing">${ppIcon('star')}Important${q.votes ? ` · ${q.votes}` : ''}</button>
        <button class="pp-small" type="button" data-pp="questionYear" data-id="${q.id}">${ppIcon('add')}Also asked in…</button>
        <a class="pp-small" href="tutor.html?question=${q.id}&subject=${subject.id}">${ppIcon('auto_awesome')}Write the answer with the tutor</a>
        ${q.mine || q.can_remove ? `<button class="pp-small" type="button" data-pp="editQuestion" data-id="${q.id}" data-subject="${subject.id}">${ppIcon('edit')}Edit</button>` : `<button class="pp-small" type="button" data-pp="report" data-kind="exam_question" data-id="${q.id}">${ppIcon('flag')}Report</button>`}
      </div>
    </div>`;
}

prepActions.questionUnit = (input) => { questionFilter.unit = input.value; renderPrep(); };
prepActions.questionMarks = (input) => { questionFilter.marks = input.value; renderPrep(); };

function findQuestion(id) {
  for (const [key, data] of Object.entries(prepCache)) {
    if (key.startsWith('questions:')) { const q = data.questions.find(x => x.id === id); if (q) return [q, Number(key.split(':')[1])]; }
  }
  return [null, 0];
}

const yearOptions = () => { const now = new Date().getFullYear(); return [['', 'Not sure'], ...Array.from({ length: 16 }, (_, i) => [now - i, String(now - i)])]; };

function questionSheet(subject, fromNote) {
  const s = subject.syllabus;
  openSheet({
    title: `Add a question: ${subject.name}`,
    note: fromNote ? 'From the past paper you opened. Add each question you want your class to see; the same question asked again only gets the year added.' : 'Type it as it was asked. If it is already listed, the year is added to it instead.',
    fields: [
      { name: 'text', label: 'Question', type: 'textarea', required: true, maxlength: 2000, placeholder: 'Explain normalisation up to 3NF with an example.' },
      { name: 'unit_id', label: 'Unit', type: 'select', half: true, options: [['', 'Not sure'], ...s.units.map(unit => [unit.id, `Unit ${unit.number}: ${unit.title}`])] },
      { name: 'marks', label: 'Marks', type: 'select', half: true, options: [['', 'Not sure'], ...prep.marks.map(m => [m, `${m} marks`])] },
      { name: 'year', label: 'Exam year', type: 'select', options: yearOptions(), value: localStorage.getItem('c2m:prepPaperYear') || '' },
      { name: 'more', label: 'Add another after this one', type: 'checkbox', value: true }
    ],
    submitLabel: 'Add question',
    onSubmit: async (values) => {
      const result = await api('/api/prep/questions', { method: 'POST', body: {
        syllabus_id: s.id, unit_id: values.unit_id ? Number(values.unit_id) : null, text: values.text,
        marks: values.marks ? Number(values.marks) : null, year: values.year ? Number(values.year) : null, source_note_id: prepRoute().note || null } });
      try { localStorage.setItem('c2m:prepPaperYear', values.year); } catch (e) { /* convenience only */ }
      showXpPop(result.xp);
      showToast(result.merged ? 'Already listed: the year was added to it' : 'Question added');
      await loadQuestions(s.id, true);
      renderPrep();
      if (values.more) { setTimeout(() => questionSheet(subject, fromNote), 50); }
    }
  });
}

prepActions.addQuestion = (button) => {
  const subject = prep.subjects.find(s => s.id === Number(button.dataset.id));
  questionSheet(subject, false);
};

prepActions.voteQuestion = async (button) => {
  const [q, syllabusId] = findQuestion(Number(button.dataset.id));
  if (!q) return;
  q.voted = !q.voted; q.votes += q.voted ? 1 : -1;
  renderPrep();
  try { await api(`/api/prep/questions/${q.id}/vote`, { method: 'POST' }); }
  catch (err) { showToast(err.message); await loadQuestions(syllabusId, true); renderPrep(); }
};

prepActions.questionYear = (button) => {
  const [q, syllabusId] = findQuestion(Number(button.dataset.id));
  openSheet({
    title: 'Also asked in',
    note: q.years.length ? `Already listed for ${q.years.join(', ')}.` : '',
    fields: [{ name: 'year', label: 'Exam year', type: 'select', required: true, options: yearOptions().slice(1).filter(([y]) => !q.years.includes(y)) }],
    submitLabel: 'Add year',
    onSubmit: async (values) => {
      const result = await api(`/api/prep/questions/${q.id}/years`, { method: 'POST', body: { year: Number(values.year) } });
      showXpPop(result.xp);
      await loadQuestions(syllabusId, true);
      renderPrep();
    }
  });
};

prepActions.editQuestion = (button) => {
  const [q, syllabusId] = findQuestion(Number(button.dataset.id));
  const subject = prep.subjects.find(s => s.id === Number(button.dataset.subject));
  openSheet({
    title: 'Edit question',
    fields: [
      { name: 'text', label: 'Question', type: 'textarea', required: true, maxlength: 2000, value: q.text },
      { name: 'unit_id', label: 'Unit', type: 'select', half: true, value: q.unit_id || '', options: [['', 'Not sure'], ...subject.syllabus.units.map(unit => [unit.id, `Unit ${unit.number}: ${unit.title}`])] },
      { name: 'marks', label: 'Marks', type: 'select', half: true, value: q.marks || '', options: [['', 'Not sure'], ...prep.marks.map(m => [m, `${m} marks`])] }
    ],
    onSubmit: async (values) => {
      await api(`/api/prep/questions/${q.id}`, { method: 'PUT', body: { text: values.text, unit_id: values.unit_id ? Number(values.unit_id) : 0, marks: values.marks ? Number(values.marks) : 0 } });
      await loadQuestions(syllabusId, true);
      renderPrep();
    },
    onDelete: async () => {
      if (!window.confirm('Remove this question for everyone?')) return false;
      await api(`/api/prep/questions/${q.id}`, { method: 'DELETE' });
      await loadQuestions(syllabusId, true);
      renderPrep();
    },
    deleteLabel: 'Remove'
  });
};

// Opened from a past paper in Notes (prep.html?note=ID): pick the subject, then add questions
prepViews.fromNote = () => {
  const route = prepRoute();
  if (!route.note) return;
  const linked = prep.subjects.filter(s => s.syllabus);
  if (!linked.length) { showToast('First add the subject and its syllabus, then come back to the paper.'); return; }
  const body = openPrepPanel('Which subject is this paper for?', `<div class="pp-pick">${linked.map(s => `
    <div class="pp-pick-row"><div><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.syllabus.subject)}</small></div>
      <button class="hm-btn" type="button" data-pp="noteSubject" data-id="${s.id}">Choose</button></div>`).join('')}</div>`);
  body.dataset.note = route.note;
};

prepActions.noteSubject = (button) => {
  const subject = prep.subjects.find(s => s.id === Number(button.dataset.id));
  closeSheet();
  prepGo({ subject: subject.id, tab: 'questions', note: prepRoute().note }, true);
  questionSheet(subject, true);
};
