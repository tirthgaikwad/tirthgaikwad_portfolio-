// ==========================================
// STUDY-GRADES.JS — My Study, Grades tab: subjects, credits and grade points per semester; SGPA, CGPA
// and what the next semester needs for a target CGPA. 10-point scale.
// Loaded after study.js.
// ==========================================

// The common 10-point letters. Picking one fills the points; the points can still be typed by hand.
const GRADE_LETTERS = [['', 'Grade'], ['O', 'O (10)'], ['A+', 'A+ (9)'], ['A', 'A (8)'], ['B+', 'B+ (7)'], ['B', 'B (6)'], ['C', 'C (5)'], ['P', 'P (4)'], ['F', 'F (0)']];
const GRADE_POINTS = { 'O': 10, 'A+': 9, 'A': 8, 'B+': 7, 'B': 6, 'C': 5, 'P': 4, 'F': 0 };
const MAX_SEMESTERS = 14;

let gradeDraft = null;            // { semester, rows: [{ subject, credits, points, grade }] } while a semester is being edited
let nextCredits = null;           // credits planned for the next semester, for the target sum (not saved)

const two = (number) => (Math.round(number * 100) / 100).toFixed(2);

// SGPA or CGPA of a list of rows: grade points weighted by credits
function gradeAverage(rows) {
  const credits = rows.reduce((sum, row) => sum + Number(row.credits || 0), 0);
  const earned = rows.reduce((sum, row) => sum + Number(row.credits || 0) * Number(row.points || 0), 0);
  return { credits, earned, average: credits ? earned / credits : null };
}

function semestersOf() {
  const map = new Map();
  for (const row of study.grades) {
    if (!map.has(row.semester)) map.set(row.semester, []);
    map.get(row.semester).push(row);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

studyActions['add-semester'] = () => {
  const used = new Set(study.grades.map(row => row.semester));
  let semester = 1;
  while (used.has(semester) && semester < MAX_SEMESTERS) semester++;
  if (used.has(semester)) return showToast('Every semester is already filled in.');
  // Start from this semester's subjects on the timetable, so there is less to type
  const rows = liveSubjects().filter(subject => subject.credits).map(subject => ({ subject: subject.name, credits: subject.credits, points: '', grade: '' }));
  gradeDraft = { semester, rows: rows.length ? rows : [{ subject: '', credits: '', points: '', grade: '' }] };
  renderStudy();
};

studyActions['edit-semester'] = (button) => {
  const semester = Number(button.dataset.semester);
  gradeDraft = { semester, rows: study.grades.filter(row => row.semester === semester).map(row => ({ subject: row.subject, credits: row.credits, points: row.points, grade: row.grade })) };
  renderStudy();
};

studyActions['grade-row-add'] = () => {
  if (gradeDraft.rows.length >= 20) return showToast('A semester holds up to 20 subjects.');
  gradeDraft.rows.push({ subject: '', credits: '', points: '', grade: '' });
  renderStudy();
  const inputs = document.querySelectorAll('.st-grade-row input[data-key="subject"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
};

studyActions['grade-row-remove'] = (button) => { gradeDraft.rows.splice(Number(button.dataset.row), 1); renderStudy(); };
studyActions['grade-cancel'] = () => { gradeDraft = null; renderStudy(); };

studyChanges['grade-field'] = (input) => {
  const row = gradeDraft.rows[Number(input.dataset.row)];
  const key = input.dataset.key;
  row[key] = input.value.trim();
  // Only the fields that follow from this one are touched: redrawing the editor would drop the keyboard's place
  const line = input.closest('.st-grade-row');
  if (key === 'grade' && row.grade in GRADE_POINTS) {
    row.points = GRADE_POINTS[row.grade];
    line.querySelector('[data-key="points"]').value = row.points;
  }
  if (key === 'points' && GRADE_POINTS[row.grade] !== Number(row.points)) {
    row.grade = '';
    line.querySelector('[data-key="grade"]').value = '';
  }
  const live = gradeAverage(gradeDraft.rows.filter(entry => Number(entry.credits) > 0 && entry.points !== ''));
  el('gradeLiveSgpa').textContent = `SGPA ${live.average === null ? '–' : two(live.average)}`;
};

studyChanges['draft-semester'] = (input) => { gradeDraft.semester = Number(input.value); };

async function saveSemester(semester, rows) {
  const saved = await api(`/api/study/grades/${semester}`, { method: 'PUT', body: { rows } });
  study.grades = study.grades.filter(row => row.semester !== semester).concat(saved.rows.map(row => ({ ...row, semester })));
  storeStudy();
}

studyActions['grade-save'] = async (button) => {
  const rows = gradeDraft.rows.filter(row => row.subject || row.credits !== '' || row.points !== '');
  const bad = rows.find(row => !row.subject || !(Number(row.credits) > 0) || row.points === '' || !(Number(row.points) >= 0 && Number(row.points) <= 10));
  if (!rows.length) return showToast('Add at least one subject.');
  if (bad) return showToast('Every subject needs a name, its credits and grade points from 0 to 10.');
  button.disabled = true;
  try {
    await saveSemester(gradeDraft.semester, rows.map(row => ({ subject: row.subject, credits: Number(row.credits), points: Number(row.points), grade: row.grade || '' })));
    gradeDraft = null;
    showToast('Saved.');
  } catch (err) {
    showToast(err.message);
  }
  renderStudy();
};

studyActions['grade-delete'] = async (button) => {
  const semester = Number(button.dataset.semester);
  if (!window.confirm(`Remove semester ${semester} and its grades?`)) return;
  try {
    await saveSemester(semester, []);
    gradeDraft = null;
  } catch (err) {
    showToast(err.message);
  }
  renderStudy();
};

studyChanges['target-cgpa'] = async (input) => {
  const value = input.value.trim();
  try {
    study.settings = await api('/api/study/settings', { method: 'PUT', body: value === '' ? { clear_target: true } : { target_cgpa: Number(value) } });
    storeStudy();
  } catch (err) {
    showToast(err.message);
  }
  renderStudy();
};

studyChanges['next-credits'] = (input) => { nextCredits = Number(input.value) > 0 ? Number(input.value) : null; renderStudy(); };

function gradeEditorHtml() {
  const draft = gradeDraft;
  const isNew = !study.grades.some(row => row.semester === draft.semester);
  const used = new Set(study.grades.map(row => row.semester));
  const live = gradeAverage(draft.rows.filter(row => Number(row.credits) > 0 && row.points !== ''));
  const rows = draft.rows.map((row, index) => `
    <div class="st-grade-row">
      <input type="text" data-change="grade-field" data-row="${index}" data-key="subject" value="${escapeHtml(row.subject)}" maxlength="80" placeholder="Subject" aria-label="Subject"/>
      <input type="number" data-change="grade-field" data-row="${index}" data-key="credits" value="${escapeHtml(row.credits)}" min="0.5" max="40" step="0.5" placeholder="Credits" aria-label="Credits"/>
      <select data-change="grade-field" data-row="${index}" data-key="grade" aria-label="Grade">${GRADE_LETTERS.map(([value, label]) => `<option value="${value}" ${row.grade === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <input type="number" data-change="grade-field" data-row="${index}" data-key="points" value="${escapeHtml(row.points)}" min="0" max="10" step="0.01" placeholder="Points" aria-label="Grade points"/>
      <button type="button" class="st-iconbtn" data-act="grade-row-remove" data-row="${index}" aria-label="Remove this subject">${icon('close')}</button>
    </div>`).join('');
  return `
    <section class="hm-card st-editor">
      <div class="hm-head"><h2>${isNew
        ? `Semester <select data-change="draft-semester" aria-label="Semester">${Array.from({ length: MAX_SEMESTERS }, (_, i) => i + 1).filter(n => !used.has(n)).map(n => `<option ${n === draft.semester ? 'selected' : ''}>${n}</option>`).join('')}</select>`
        : `Semester ${draft.semester}`}</h2>
        <span class="hm-note" id="gradeLiveSgpa">SGPA ${live.average === null ? '–' : two(live.average)}</span></div>
      <div class="st-grade-head"><span>Subject</span><span>Credits</span><span>Grade</span><span>Points</span><span></span></div>
      ${rows}
      <div class="st-row-actions">
        <button class="hm-btn is-quiet" type="button" data-act="grade-row-add">${icon('add')}Add subject</button>
        <span class="fs-gap" style="flex:1"></span>
        ${isNew ? '' : `<button class="hm-btn is-quiet st-danger" type="button" data-act="grade-delete" data-semester="${draft.semester}">Remove semester</button>`}
        <button class="hm-btn is-quiet" type="button" data-act="grade-cancel">Cancel</button>
        <button class="hm-btn" type="button" data-act="grade-save">Save</button>
      </div>
    </section>`;
}

function semesterCardHtml([semester, rows]) {
  const result = gradeAverage(rows);
  return `
    <section class="hm-card">
      <div class="hm-head"><h2>Semester ${semester}</h2><button class="hm-btn is-quiet" type="button" data-act="edit-semester" data-semester="${semester}">${icon('edit')}Edit</button></div>
      <div class="st-sgpa"><b>${two(result.average)}</b><span>SGPA · ${result.credits} credits</span></div>
      <div class="st-table-wrap"><table class="st-table"><thead><tr><th>Subject</th><th>Credits</th><th>Grade</th><th>Points</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${escapeHtml(row.subject)}</td><td>${row.credits}</td><td>${escapeHtml(row.grade || '–')}</td><td>${row.points}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
}

function targetHtml(total, semesters) {
  const target = study.settings.target_cgpa;
  const usual = semesters.length ? Math.round(total.credits / semesters.length) : 20;
  const planned = nextCredits || usual;
  let verdict = 'Set a target to see what your next semester needs.';
  if (target && total.credits) {
    const needed = (target * (total.credits + planned) - total.earned) / planned;
    if (needed > 10) verdict = `Not reachable in one semester: it would need an SGPA of ${two(needed)}. Aim for it over two semesters.`;
    else if (needed <= 0) verdict = `You are already above ${two(target)}, whatever happens next semester.`;
    else verdict = `You need an SGPA of ${two(needed)} next semester (${planned} credits) to reach ${two(target)}.`;
  } else if (target) {
    verdict = 'Add a finished semester first.';
  }
  return `
    <section class="hm-card"><div class="hm-head"><h2>Target</h2></div>
      <div class="st-target">
        <label>Target CGPA<input type="number" data-change="target-cgpa" value="${target || ''}" min="0.1" max="10" step="0.01" placeholder="8.5"/></label>
        <label>Credits next semester<input type="number" data-change="next-credits" value="${planned}" min="1" max="60" step="1"/></label>
      </div>
      <p class="st-verdict">${escapeHtml(verdict)}</p>
    </section>`;
}

studyRender.grades = () => {
  const semesters = semestersOf();
  const total = gradeAverage(study.grades);
  if (!semesters.length && !gradeDraft) {
    return `<section class="hm-card">${emptyHtml('school', 'Work out your SGPA and CGPA', 'Enter each subject with its credits and grade points (10-point scale). Your CGPA updates by itself after every result.',
      `<button class="hm-btn" type="button" data-act="add-semester">${icon('add')}Add a semester</button>`)}</section>`;
  }
  const summary = `
    <section class="hm-card"><div class="hm-head"><h2>Overall</h2></div>
      <div class="hm-stats">
        <div class="hm-stat"><b>${total.average === null ? '–' : two(total.average)}</b><span>CGPA</span></div>
        <div class="hm-stat"><b>${total.credits}</b><span>credits over ${plural(semesters.length, 'semester', 'semesters')}</span></div>
      </div></section>`;
  const cards = semesters.filter(([semester]) => !gradeDraft || gradeDraft.semester !== semester).map(semesterCardHtml).join('');
  return `
    <div class="hm-grid">
      <div class="hm-main">
        ${gradeDraft ? gradeEditorHtml() : `<div class="st-row-actions st-top-actions"><button class="hm-btn" type="button" data-act="add-semester">${icon('add')}Add a semester</button></div>`}
        ${cards}
      </div>
      <aside class="hm-side">${summary}${targetHtml(total, semesters)}</aside>
    </div>`;
};
