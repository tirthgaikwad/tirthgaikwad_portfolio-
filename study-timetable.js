// ==========================================
// STUDY-TIMETABLE.JS — My Study, Timetable tab: subjects, the weekly classes, a class timetable from a teacher.
// Loaded after study.js.
// ==========================================

const SLOT_KINDS = [['lecture', 'Lecture'], ['lab', 'Lab'], ['tutorial', 'Tutorial']];

// ---------- subjects ----------
function subjectFields(subject) {
  const s = subject || {};
  return [
    { name: 'name', label: 'Subject name', value: s.name, required: true, maxlength: 80, placeholder: 'Database Management Systems' },
    { name: 'code', label: 'Short name or code', value: s.code, maxlength: 20, placeholder: 'DBMS', half: true },
    { name: 'credits', label: 'Credits', type: 'number', value: s.credits, min: 0, max: 40, step: 0.5, half: true },
    { name: 'goal', label: 'Attendance goal (%)', type: 'number', value: s.goal === undefined ? 75 : s.goal, min: 0, max: 100, step: 1, required: true },
    { name: 'base_attended', label: 'Attended so far', type: 'number', value: s.base_attended || 0, min: 0, step: 1, half: true },
    { name: 'base_total', label: 'Classes held so far', type: 'number', value: s.base_total || 0, min: 0, step: 1, half: true,
      hint: 'Classes before you started marking here. Leave at 0 at the start of a semester.' }
  ];
}

function subjectBody(values, subject) {
  return { name: values.name, code: values.code, credits: values.credits, goal: values.goal === null ? 75 : values.goal,
           base_attended: values.base_attended || 0, base_total: values.base_total || 0, archived: subject ? subject.archived : false };
}

studyActions['add-subject'] = () => openSheet({
  title: 'Add a subject', fields: subjectFields(), submitLabel: 'Add subject',
  onSubmit: async (values) => {
    const created = await api('/api/study/subjects', { method: 'POST', body: subjectBody(values) });
    study.subjects.push(created);
    study.subjects.sort((a, b) => a.name.localeCompare(b.name));
    storeStudy(); renderStudy();
    showToast(`${created.name} added. Now add its classes to the timetable.`);
  }
});

studyActions['edit-subject'] = (button) => {
  const subject = subjectOf(Number(button.dataset.id));
  if (!subject) return;
  openSheet({
    title: 'Edit subject', fields: subjectFields(subject), deleteLabel: 'Delete subject',
    onSubmit: async (values) => {
      Object.assign(subject, await api(`/api/study/subjects/${subject.id}`, { method: 'PUT', body: subjectBody(values, subject) }));
      storeStudy(); renderStudy();
    },
    onDelete: async () => {
      if (!window.confirm(`Delete ${subject.name}, with its classes and attendance? This cannot be undone.`)) return false;
      await api(`/api/study/subjects/${subject.id}`, { method: 'DELETE' });
      study.subjects = study.subjects.filter(entry => entry.id !== subject.id);
      study.slots = study.slots.filter(slot => slot.subject_id !== subject.id);
      study.marks = study.marks.filter(mark => mark.subject_id !== subject.id);
      study.tasks.forEach(task => { if (task.subject_id === subject.id) task.subject_id = null; });
      storeStudy(); renderStudy();
    }
  });
};

// ---------- classes ----------
function slotFields(slot) {
  const s = slot || { weekday: studyView.day, start_time: '09:00', end_time: '10:00', kind: 'lecture' };
  return [
    { name: 'subject_id', label: 'Subject', type: 'select', options: subjectOptions(), value: s.subject_id, required: true },
    { name: 'weekday', label: 'Day', type: 'select', options: STUDY_DAYS.map((day, index) => [index, day]), value: s.weekday },
    { name: 'start_time', label: 'Starts', type: 'time', value: s.start_time, required: true, half: true },
    { name: 'end_time', label: 'Ends', type: 'time', value: s.end_time, required: true, half: true },
    { name: 'room', label: 'Room', value: s.room, maxlength: 40, placeholder: '204', half: true },
    { name: 'kind', label: 'Type', type: 'select', options: SLOT_KINDS, value: s.kind, half: true }
  ];
}

const slotBody = (values) => ({ ...values, subject_id: Number(values.subject_id), weekday: Number(values.weekday) });

studyActions['add-slot'] = (button) => {
  if (!liveSubjects().length) return studyActions['add-subject']();
  if (button && button.dataset.day !== undefined) studyView.day = Number(button.dataset.day);
  openSheet({
    title: 'Add a class', fields: slotFields(), submitLabel: 'Add class',
    onSubmit: async (values) => {
      study.slots.push(await api('/api/study/slots', { method: 'POST', body: slotBody(values) }));
      studyView.day = Number(values.weekday); studyView.dayPicked = true;
      storeStudy(); renderStudy();
    }
  });
};

studyActions['edit-slot'] = (button) => {
  const slot = study.slots.find(entry => entry.id === Number(button.dataset.id));
  if (!slot) return;
  openSheet({
    title: 'Edit class', fields: slotFields(slot), deleteLabel: 'Remove class',
    onSubmit: async (values) => {
      Object.assign(slot, await api(`/api/study/slots/${slot.id}`, { method: 'PUT', body: slotBody(values) }));
      storeStudy(); renderStudy();
    },
    onDelete: async () => {
      await api(`/api/study/slots/${slot.id}`, { method: 'DELETE' });
      study.slots = study.slots.filter(entry => entry.id !== slot.id);
      storeStudy(); renderStudy();
    }
  });
};

studyActions['pick-day'] = (button) => { studyView.day = Number(button.dataset.day); studyView.dayPicked = true; renderStudy(); };

// ---------- a teacher's class timetable ----------
studyActions['import-class'] = async (button) => {
  if (button) button.disabled = true;
  try {
    const result = await api('/api/study/class-timetable/import', { method: 'POST' });
    showToast(result.classes_added ? `Added ${plural(result.classes_added, 'class', 'classes')} and ${plural(result.subjects_added, 'subject', 'subjects')}.` : 'Your timetable already has all of it.');
    await loadStudy();
  } catch (err) {
    showToast(err.message);
    if (button) button.disabled = false;
  }
};

studyActions['publish-class'] = () => {
  const classes = study.teacher.classes;
  if (!study.slots.length) return showToast('Add your own classes to the timetable first.');
  if (!classes.length) return showToast('No students of your college have a department on their profile yet.');
  openSheet({
    title: 'Publish to a class', submitLabel: 'Publish',
    note: 'Students of this class can copy your classes into their own timetable in one tap. Publishing again replaces what you published before.',
    fields: [{ name: 'target', label: 'Class', type: 'select', options: classes.map(([department, division], index) => [index, division ? `${department} · ${division}` : department]) }],
    onSubmit: async (values) => {
      const [department, division] = classes[Number(values.target)];
      const result = await api('/api/study/class-timetable/publish', { method: 'POST', body: { department, division } });
      showToast(`Published ${plural(result.slots, 'class', 'classes')}.`);
      await loadStudy();
    }
  });
};

studyActions['unpublish-class'] = async (button) => {
  try {
    await api('/api/study/class-timetable/unpublish', { method: 'POST', body: { department: button.dataset.department, division: button.dataset.division } });
    showToast('Taken down.');
    await loadStudy();
  } catch (err) { showToast(err.message); }
};

// ---------- rendering ----------
function slotCardHtml(slot) {
  const subject = subjectOf(slot.subject_id);
  return `
    <button type="button" class="st-slot is-${slot.kind}" data-act="edit-slot" data-id="${slot.id}" title="Edit this class">
      <b>${clock(slot.start_time)} – ${clock(slot.end_time)}</b>
      <strong>${escapeHtml(subject.code || subject.name)}</strong>
      <small>${[slot.kind !== 'lecture' ? slot.kind[0].toUpperCase() + slot.kind.slice(1) : '', slot.room ? `Room ${escapeHtml(slot.room)}` : ''].filter(Boolean).join(' · ') || escapeHtml(subject.code ? subject.name : 'Lecture')}</small>
    </button>`;
}

function teacherPanelHtml() {
  if (!study.teacher) return '';
  const published = study.teacher.published.map(entry => `
    <div class="st-line"><span><strong>${escapeHtml(entry.department)}${entry.division ? ` · ${escapeHtml(entry.division)}` : ''}</strong> <small>${plural(entry.slots, 'class', 'classes')}</small></span>
      <button class="hm-btn is-quiet" type="button" data-act="unpublish-class" data-department="${escapeHtml(entry.department)}" data-division="${escapeHtml(entry.division)}">Take down</button></div>`).join('');
  return `<section class="hm-card"><div class="hm-head"><h2>For your students</h2></div>
    <p class="hm-note">Publish your classes to a class once. Each student copies them into their own timetable.</p>
    ${published}
    <div class="st-row-actions"><button class="hm-btn" type="button" data-act="publish-class">${icon('campaign')}Publish to a class</button></div></section>`;
}

studyRender.timetable = () => {
  const subjects = liveSubjects();
  const canImport = study.class_timetable.slots > 0;
  const importBanner = canImport ? `
    <div class="st-banner">${icon('school')}<span><strong>Your class has a timetable</strong>
      <small>${plural(study.class_timetable.slots, 'class', 'classes')} published by ${plural(study.class_timetable.teachers, 'teacher', 'teachers')}.</small></span>
      <button class="hm-btn" type="button" data-act="import-class">Copy to mine</button></div>` : '';
  if (!subjects.length) {
    return `${importBanner}<section class="hm-card">${emptyHtml('calendar_view_week', 'No subjects yet', 'Add a subject, then put its classes on the days they happen.',
      `<button class="hm-btn" type="button" data-act="add-subject">${icon('add')}Add a subject</button>`)}</section>${teacherPanelHtml()}`;
  }
  // Sunday only gets a column when something happens on it
  const days = STUDY_DAYS.map((_, index) => index).filter(index => index < 6 || slotsOn(6).length || studyView.day === 6);
  const chips = STUDY_DAYS.map((day, index) => `<button type="button" class="st-chip" data-act="pick-day" data-day="${index}" aria-pressed="${studyView.day === index}">${day.slice(0, 3)}${index === study.weekday ? ' ·' : ''}</button>`).join('');
  const columns = days.map(index => {
    const slots = slotsOn(index);
    return `
      <div class="st-day${index === studyView.day ? ' is-picked' : ''}${index === study.weekday ? ' is-today' : ''}">
        <h3>${STUDY_DAYS[index]}${index === study.weekday ? '<span class="st-badge is-now">Today</span>' : ''}</h3>
        ${slots.map(slotCardHtml).join('') || '<p class="st-free">No classes</p>'}
        <button type="button" class="st-add" data-act="add-slot" data-day="${index}">${icon('add')}Add class</button>
      </div>`;
  }).join('');
  const subjectChips = subjects.map(subject => `
    <button type="button" class="st-subject" data-act="edit-subject" data-id="${subject.id}" title="Edit ${escapeHtml(subject.name)}">
      <strong>${escapeHtml(subject.name)}</strong><small>${[subject.code, subject.credits ? `${subject.credits} credits` : '', plural(study.slots.filter(slot => slot.subject_id === subject.id).length, 'class', 'classes') + ' a week'].filter(Boolean).map(escapeHtml).join(' · ')}</small></button>`).join('');
  return `
    ${importBanner}
    <section class="hm-card">
      <div class="hm-head"><h2>Your week</h2><button class="hm-btn" type="button" data-act="add-slot">${icon('add')}Add class</button></div>
      <div class="st-chips st-daychips">${chips}</div>
      <div class="st-week" style="--days:${days.length}">${columns}</div>
    </section>
    <section class="hm-card">
      <div class="hm-head"><h2>Subjects<span class="hm-count">${subjects.length}</span></h2><button class="hm-btn is-quiet" type="button" data-act="add-subject">${icon('add')}Add subject</button></div>
      <div class="st-subjects">${subjectChips}</div>
    </section>
    ${teacherPanelHtml()}`;
};
