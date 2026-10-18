// ==========================================
// PREP-SYLLABUS.JS — Exam Prep: the Units tab (progress per unit), finding the class's syllabus, typing one in.
// A syllabus is typed (or pasted from the university's PDF) as plain text: a line starting "Unit 1", "Module II",
// "3." starts a unit; the lines under it, or the part after a colon, are its topics.
// ==========================================

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
const UNIT_LINE = /^(?:(?:unit|module|chapter|part)\s*[-–:.]?\s*([0-9]{1,2}|[ivx]{1,4})\b|([0-9]{1,2}|[ivx]{1,4})[.)])\s*[-–:.)]?\s*(.*)$/i;

function splitTopics(text) {
  return text.split(/[,;•]|\s+[-–]\s+/).map(t => t.replace(/^[\s\-*•·]+/, '').replace(/[.\s]+$/, '').trim()).filter(t => t.length > 1);
}

// "Unit I: Introduction: data models, ER diagrams" -> [{ title: 'Introduction', topics: ['data models', 'ER diagrams'] }]
function parseUnits(text) {
  const lines = (text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const units = [];
  let current = null;
  for (const line of lines) {
    const match = line.match(UNIT_LINE);
    if (match && (match[1] || match[2])) {
      let rest = (match[3] || '').trim();
      let topics = [];
      const split = rest.match(/^(.+?)(?::|\s[-–]\s)\s*(.+)$/);       // "Title: topics" or "Title - topics"
      if (split) { topics = splitTopics(split[2]); rest = split[1].trim(); }
      current = { title: rest || `Unit ${units.length + 1}`, topics };
      units.push(current);
    } else if (current) {
      current.topics.push(...(line.length > 60 || /[,;]/.test(line) ? splitTopics(line) : [line.replace(/^[\s\-*•·]+/, '').trim()]));
    } else {
      units.push({ title: line.replace(/^[\s\-*•·]+/, '').slice(0, 160), topics: [] });
    }
  }
  // When nothing looked like "Unit 1", every line was a unit: fine for short lists
  return units.map(unit => ({ title: unit.title.slice(0, 160), topics: unit.topics.filter(Boolean).slice(0, 40).map(t => t.slice(0, 200)) }));
}

function unitsToText(units) {
  return units.map(unit => `Unit ${unit.number}: ${unit.title}${unit.topics.length ? `\n${unit.topics.join(', ')}` : ''}`).join('\n');
}

// ---------- Units tab ----------
prepViews.units = (box, subject) => {
  const s = subject.syllabus;
  const pace = paceLine(subject);
  box.innerHTML = `
    ${pace ? `<div class="pp-pace">${ppIcon('directions_run')}<span>${escapeHtml(pace)}</span></div>` : ''}
    ${s.units.map(unit => {
      const state = prep.progress[unit.id] || 'todo';
      const done = state === 'revised' || state === 'confident';
      return `
        <div class="pp-unit${done ? ' is-done' : ''}">
          <div class="pp-unit-top">
            <span class="pp-unit-num">${done ? ppIcon('check') : unit.number}</span>
            <span class="pp-unit-title">${escapeHtml(unit.title)}</span>
            <span class="pp-status" role="group" aria-label="How far you are with unit ${unit.number}">${prep.statuses.map(key =>
              `<button type="button" data-pp="unitStatus" data-unit="${unit.id}" data-status="${key}" aria-pressed="${key === state}"${key === 'revised' || key === 'confident' ? ' class="is-done"' : ''}>${STATUS_LABELS[key]}</button>`).join('')}</span>
          </div>
          ${unit.topics.length ? `<div class="pp-topics">${unit.topics.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>`;
    }).join('')}
    <p class="st-hint">${ppIcon('lightbulb')}<span>Mark a unit <b>Revised</b> once you could answer an exam question on it. Each one earns 3 XP.</span></p>`;
};

prepActions.unitStatus = async (button) => {
  const unitId = Number(button.dataset.unit), status = button.dataset.status;
  const before = prep.progress[unitId];
  prep.progress[unitId] = status;
  renderPrep();
  try {
    const result = await api('/api/prep/progress', { method: 'PUT', body: { unit_id: unitId, status } });
    cacheSet('prep', prep);
    showXpPop(result.xp);
  } catch (err) {
    if (before) prep.progress[unitId] = before; else delete prep.progress[unitId];
    renderPrep();
    showToast(err.message);
  }
};

// ---------- a subject with no syllabus yet ----------
prepViews.noSyllabus = (box, subject) => {
  box.innerHTML = `
    <div class="st-empty">${ppIcon('list_alt')}<strong>Link the syllabus for ${escapeHtml(subject.name)}</strong>
      <p>Then you can tick off units, collect the questions your university asks again and again, and make flashcards for each unit.</p>
      <div class="st-empty-actions"><button class="hm-btn" type="button" data-pp="findSyllabus" data-subject="${subject.id}">Find your class's syllabus</button>
      <button class="hm-btn is-quiet" type="button" data-pp="newSyllabus" data-subject="${subject.id}">Type it in</button></div></div>`;
};

// ---------- finding the class's syllabus ----------
// From the overview: pick one to add as a subject. From a subject: pick one to link to it.
prepActions.findSyllabus = (button) => {
  const subjectId = Number(button.dataset.subject) || 0;
  const subject = prep.subjects.find(s => s.id === subjectId);
  const semester = localStorage.getItem('c2m:prepSemester') || '';
  const body = openPrepPanel(subject ? `Syllabus for ${subject.name}` : 'Find your syllabus', `
    <div class="pp-filters">
      <input class="hm-email-input" id="ppSyllabusSearch" type="search" placeholder="Search subjects" value="${subject ? escapeHtml(subject.name) : ''}" style="flex:1;min-width:140px;padding:8px 10px;border-radius:9px;border:1px solid rgba(199,196,216,0.9);font-size:14px"/>
      <select id="ppSyllabusSemester" aria-label="Semester"><option value="">Any semester</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}"${String(i + 1) === semester ? ' selected' : ''}>Semester ${i + 1}</option>`).join('')}</select>
    </div>
    <div class="pp-pick" id="ppSyllabusList"><div class="skeleton hm-skel"></div></div>
    <div class="fs-actions"><span class="fs-gap"></span><button class="fs-btn fs-quiet" type="button" data-pp="newSyllabus" data-subject="${subjectId}">Not listed? Type it in</button></div>`, true);
  const search = body.querySelector('#ppSyllabusSearch'), select = body.querySelector('#ppSyllabusSemester');
  let timer = null;
  const run = async () => {
    const list = body.querySelector('#ppSyllabusList');
    try { localStorage.setItem('c2m:prepSemester', select.value); } catch (e) { /* only a convenience */ }
    try {
      const params = new URLSearchParams({ q: search.value.trim() });
      if (select.value) params.set('semester', select.value);
      const data = await api(`/api/prep/syllabi?${params}`);
      if (data.need_college) { list.innerHTML = '<p class="hm-note">Add your college on <a href="profile.html">your profile</a> first. Syllabi are shared within a college.</p>'; return; }
      if (!data.syllabi.length && search.value.trim() && subject) {        // the name may differ: show everything for the semester
        search.value = '';
        return run();
      }
      list.innerHTML = data.syllabi.length ? data.syllabi.map(s => `
        <div class="pp-pick-row">
          <div><strong>${escapeHtml(s.subject)}${s.code ? ` <small style="display:inline">(${escapeHtml(s.code)})</small>` : ''}</strong>
            <small>${escapeHtml([s.department, s.semester ? `Semester ${s.semester}` : '', ppPlural(s.units.length, 'unit', 'units'), s.users ? `${s.users} using it` : '', s.teacher_checked ? 'checked by a teacher' : ''].filter(Boolean).join(' · '))}</small></div>
          <button class="hm-btn" type="button" data-pp="pickSyllabus" data-id="${s.id}" data-subject="${subjectId}">${subject ? 'Link' : 'Add'}</button>
        </div>`).join('') : `<p class="hm-note">Nobody at ${escapeHtml(data.college || 'your college')} has added this syllabus yet. Type it in once and your whole class can use it.</p>`;
    } catch (err) {
      list.innerHTML = `<p class="hm-note">${escapeHtml(err.message)}</p>`;
    }
  };
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  select.addEventListener('change', run);
  run();
};

prepActions.pickSyllabus = async (button) => {
  const subjectId = Number(button.dataset.subject) || 0, syllabusId = Number(button.dataset.id);
  button.disabled = true;
  try {
    let id = subjectId;
    if (subjectId) await api(`/api/prep/subjects/${subjectId}`, { method: 'PUT', body: { syllabus_id: syllabusId } });
    else id = (await api('/api/prep/subjects', { method: 'POST', body: { syllabus_id: syllabusId } })).id;
    closeSheet();
    await loadPrep();
    prepGo({ subject: id });
  } catch (err) {
    button.disabled = false;
    showToast(err.message);
  }
};

// ---------- typing a syllabus in, or editing one ----------
function syllabusSheet({ title, syllabus, subject, onSaved }) {
  const semester = (syllabus && syllabus.semester) || Number(localStorage.getItem('c2m:prepSemester')) || '';
  openSheet({
    title,
    note: syllabus ? 'Units keep their place: everyone\'s progress stays with unit 1, unit 2 and so on.' : 'Your whole class can use what you type here. Paste it straight from the university syllabus if you have it.',
    fields: [
      { name: 'subject', label: 'Subject', value: syllabus ? syllabus.subject : (subject ? subject.name : ''), required: true, maxlength: 120 },
      { name: 'code', label: 'Subject code', value: syllabus ? syllabus.code : (subject ? subject.code : ''), half: true, maxlength: 30, placeholder: 'Optional' },
      { name: 'semester', label: 'Semester', type: 'select', value: semester, half: true, options: [['', 'Not sure'], ...Array.from({ length: 10 }, (_, i) => [i + 1, `Semester ${i + 1}`])] },
      { name: 'department', label: 'Department', value: syllabus ? syllabus.department : (prep.me.department || ''), maxlength: 120 },
      { name: 'units', label: 'Units and topics', type: 'textarea', maxlength: 8000, required: true, value: syllabus ? unitsToText(syllabus.units) : '',
        placeholder: 'Unit 1: Introduction\nData models, ER diagrams, keys\nUnit 2: SQL\nJoins, subqueries, views',
        hint: 'Start each unit on a new line with "Unit 1", "Module II" or "3.". Topics go on the lines under it, separated by commas.' }
    ],
    submitLabel: syllabus ? 'Save changes' : 'Save syllabus',
    onOpen: (form) => { form.elements.units.rows = 10; },
    onSubmit: async (values) => {
      const units = parseUnits(values.units);
      if (!units.length) throw new Error('Add at least one unit.');
      if (units.length > 12) throw new Error(`That reads as ${units.length} units. A syllabus has up to 12: start each unit on its own line with "Unit 1", "Unit 2"…`);
      const body = { subject: values.subject, code: values.code, department: values.department, semester: values.semester ? Number(values.semester) : null,
                     units: units.map((unit, i) => ({ ...unit, id: syllabus && syllabus.units[i] ? syllabus.units[i].id : null })) };
      if (values.semester) { try { localStorage.setItem('c2m:prepSemester', values.semester); } catch (e) { /* convenience only */ } }
      const saved = syllabus ? await api(`/api/prep/syllabi/${syllabus.id}`, { method: 'PUT', body })
                             : await api('/api/prep/syllabi', { method: 'POST', body });
      await onSaved(saved.id);
    }
  });
}

prepActions.newSyllabus = (button) => {
  const subjectId = Number(button.dataset.subject) || 0;
  const subject = prep.subjects.find(s => s.id === subjectId);
  if (prepNeedsCollege()) return showToast('Add your college on your profile first. A syllabus is shared with your college.');
  syllabusSheet({
    title: 'Type in the syllabus', subject,
    onSaved: async (syllabusId) => {
      let id = subjectId;
      if (subjectId) await api(`/api/prep/subjects/${subjectId}`, { method: 'PUT', body: { syllabus_id: syllabusId } });
      else id = (await api('/api/prep/subjects', { method: 'POST', body: { syllabus_id: syllabusId } })).id;
      await loadPrep();
      prepGo({ subject: id });
      showToast('Syllabus saved. Thanks for adding it for your class.');
    }
  });
};

prepActions.syllabusMenu = (button) => {
  const subject = prep.subjects.find(s => s.id === Number(button.dataset.id));
  const s = subject.syllabus;
  const body = openPrepPanel('Syllabus', `
    <p class="hm-note">${escapeHtml(s.subject)}${s.department ? ` · ${escapeHtml(s.department)}` : ''}${s.semester ? ` · Semester ${s.semester}` : ''}. ${s.users > 1 ? `${s.users} students use this syllabus.` : 'Only you use it so far.'}</p>
    <div class="pp-pick" style="margin-top:12px">
      ${s.can_edit ? `<button class="pp-small" type="button" data-pp="editSyllabus" data-id="${subject.id}">${ppIcon('edit')}Edit units and topics</button>` : ''}
      <button class="pp-small" type="button" data-pp="unlinkSyllabus" data-id="${subject.id}">${ppIcon('link_off')}Use a different syllabus</button>
      ${s.mine || s.can_edit ? '' : `<button class="pp-small" type="button" data-pp="report" data-kind="syllabus" data-id="${s.id}">${ppIcon('flag')}Report a problem</button>`}
      ${s.can_edit ? `<button class="pp-small st-danger" type="button" data-pp="removeSyllabus" data-id="${subject.id}">${ppIcon('delete')}Remove for everyone</button>` : ''}
    </div>`);
  body.querySelectorAll('.pp-small').forEach(b => { b.style.justifyContent = 'flex-start'; b.style.padding = '10px 12px'; });
};

prepActions.editSyllabus = (button) => {
  const subject = prep.subjects.find(s => s.id === Number(button.dataset.id));
  syllabusSheet({ title: 'Edit the syllabus', syllabus: subject.syllabus, subject, onSaved: async () => { await loadPrep(); showToast('Syllabus saved'); } });
};

prepActions.unlinkSyllabus = async (button) => {
  const subjectId = Number(button.dataset.id);
  closeSheet();
  try {
    await api(`/api/prep/subjects/${subjectId}`, { method: 'PUT', body: { syllabus_id: 0 } });
    await loadPrep();
    prepActions.findSyllabus({ dataset: { subject: subjectId } });
  } catch (err) { showToast(err.message); }
};

prepActions.removeSyllabus = async (button) => {
  const subject = prep.subjects.find(s => s.id === Number(button.dataset.id));
  closeSheet();
  if (!window.confirm(`Remove the ${subject.syllabus.subject} syllabus for everyone who uses it? Their unit progress goes too.`)) return;
  try {
    await api(`/api/prep/syllabi/${subject.syllabus.id}`, { method: 'DELETE' });
    await loadPrep();
    showToast('Syllabus removed');
  } catch (err) { showToast(err.message); }
};

// Reports go through the site's report form (chat-common.js)
prepActions.report = (button) => {
  closeSheet();
  openReportDialog({ kind: button.dataset.kind, id: Number(button.dataset.id), name: button.dataset.name || 'this' });
};
