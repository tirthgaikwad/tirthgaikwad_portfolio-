// ==========================================
// STUDY-ATTENDANCE.JS — My Study, Attendance tab: mark a day's classes, see every subject against its goal.
// Loaded after study.js. The marks themselves are saved by setMark() in study.js.
// ==========================================

studyActions['att-day'] = (button) => {
  const next = dateShift(studyView.date, Number(button.dataset.step));
  if (next > study.today) return;
  studyView.date = next;
  renderStudy();
};

studyChanges['att-date'] = (input) => {
  if (input.value && input.value <= study.today) studyView.date = input.value;
  renderStudy();
};

// A class that is not on the timetable (a make-up lecture): one per subject per day
studyActions['extra-class'] = () => {
  if (!liveSubjects().length) return studyActions['add-subject']();
  openSheet({
    title: 'Extra class', submitLabel: 'Save', note: `A class on ${dayLabel(studyView.date).toLowerCase()} that is not on your timetable.`,
    fields: [
      { name: 'subject_id', label: 'Subject', type: 'select', options: subjectOptions(), required: true },
      { name: 'status', label: 'You were', type: 'select', options: [['present', 'Present'], ['absent', 'Absent']] }
    ],
    onSubmit: async (values) => {
      const subjectId = Number(values.subject_id);
      if (markOf(subjectId, studyView.date, 0) !== values.status) await setMark(subjectId, studyView.date, 0, values.status);
    }
  });
};

function dayMarksHtml() {
  const date = studyView.date;
  const slots = slotsOn(weekdayOf(date));
  const extras = study.marks.filter(mark => mark.date === date && mark.slot_id === 0 && subjectOf(mark.subject_id));
  const rows = slots.map(slot => {
    const subject = subjectOf(slot.subject_id);
    return `<div class="st-class"><div class="st-class-time"><b>${clock(slot.start_time)}</b><small>${clock(slot.end_time)}</small></div>
      <div class="st-class-text"><strong>${escapeHtml(subject.name)}</strong><small>${slot.kind !== 'lecture' ? slot.kind[0].toUpperCase() + slot.kind.slice(1) : 'Lecture'}${slot.room ? ` · Room ${escapeHtml(slot.room)}` : ''}</small></div>
      ${markButtonsHtml(subject.id, date, slot.id)}</div>`;
  }).join('') + extras.map(mark => {
    const subject = subjectOf(mark.subject_id);
    return `<div class="st-class"><div class="st-class-time"><b>Extra</b></div>
      <div class="st-class-text"><strong>${escapeHtml(subject.name)}</strong><small>Not on the timetable</small></div>${markButtonsHtml(subject.id, date, 0)}</div>`;
  }).join('');
  const marked = slots.filter(slot => markOf(slot.subject_id, date, slot.id)).length;
  return `
    <section class="hm-card">
      <div class="hm-head"><h2>${escapeHtml(dayLabel(date))}${slots.length ? `<span class="st-progress">${marked} of ${slots.length} marked</span>` : ''}</h2>
        <div class="st-datenav">
          <button type="button" class="st-iconbtn" data-act="att-day" data-step="-1" aria-label="Previous day">${icon('chevron_left')}</button>
          <input type="date" data-change="att-date" value="${date}" max="${study.today}" aria-label="Day"/>
          <button type="button" class="st-iconbtn" data-act="att-day" data-step="1" aria-label="Next day" ${date >= study.today ? 'disabled' : ''}>${icon('chevron_right')}</button>
        </div></div>
      <div class="st-classes">${rows || `<p class="hm-note">No classes on your timetable for this day.</p>`}</div>
      <div class="st-row-actions"><button class="hm-btn is-quiet" type="button" data-act="extra-class">${icon('add')}Extra class</button></div>
    </section>`;
}

function subjectMeterHtml(subject) {
  const state = attendanceState(subject);
  const judged = state.total >= STUDY_MIN_CLASSES;
  const tone = !state.total ? 'is-empty' : (state.below && judged ? 'is-low' : (state.canMiss === 0 && judged ? 'is-edge' : 'is-good'));
  return `
    <div class="st-meter ${tone}">
      <div class="st-meter-top">
        <button type="button" class="st-meter-name" data-act="edit-subject" data-id="${subject.id}" title="Edit subject and goal">${escapeHtml(subject.name)}</button>
        <b>${state.percent === null ? '–' : `${state.percent}%`}</b>
      </div>
      <div class="st-track" role="img" aria-label="${state.percent === null ? 'No classes yet' : `${state.percent} per cent, goal ${subject.goal}`}">
        <i style="width:${state.percent || 0}%"></i><u style="left:${subject.goal}%" title="Goal ${subject.goal}%"></u></div>
      <p>${state.total ? `${state.present} of ${plural(state.total, 'class', 'classes')}. ` : ''}${escapeHtml(attendanceAdvice(subject))}</p>
    </div>`;
}

studyRender.attendance = () => {
  const subjects = liveSubjects();
  if (!subjects.length) {
    return `<section class="hm-card">${emptyHtml('how_to_reg', 'Track your attendance', 'Add your subjects first. Then one tap a class tells you how many you can still miss.',
      `<button class="hm-btn" type="button" data-act="add-subject">${icon('add')}Add a subject</button>`)}</section>`;
  }
  const present = subjects.reduce((sum, subject) => sum + attendanceState(subject).present, 0);
  const total = subjects.reduce((sum, subject) => sum + attendanceState(subject).total, 0);
  const official = study.official_attendance;
  const overall = `
    <section class="hm-card"><div class="hm-head"><h2>Overall</h2></div>
      <div class="hm-stats">
        <div class="hm-stat"><b>${total ? `${Math.round(present * 100 / total)}%` : '–'}</b><span>${total ? `${present} of ${plural(total, 'class', 'classes')}` : 'no classes marked yet'}</span></div>
        ${official ? `<div class="hm-stat"><b>${Math.round(official.attended * 100 / official.total)}%</b><span>marked by your teachers (${official.attended} of ${official.total})</span></div>` : ''}
      </div>
      ${official ? '<p class="st-hint">' + icon('info') + '<span>Your own count and your teachers\' count can differ. The college goes by the teachers\' one.</span></p>' : ''}
    </section>`;
  return `
    <div class="hm-grid">
      <div class="hm-main">${dayMarksHtml()}
        <section class="hm-card"><div class="hm-head"><h2>By subject</h2></div><div class="st-meters">${subjects.map(subjectMeterHtml).join('')}</div></section>
      </div>
      <aside class="hm-side">${overall}</aside>
    </div>`;
};
