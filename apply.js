// ==========================================
// APPLY.JS — The two application pages: apply-teacher.html and apply-admin.html (window.APPLY_KIND says which).
// A four-step form, then a status panel: waiting, a question from the founder, approved, declined.
// Loaded after shared.js, chat-common.js and pages-common.js.
// ==========================================

const KIND = window.APPLY_KIND === 'admin' ? 'admin' : 'teacher';
const API_PATH = KIND === 'admin' ? '/api/admin-applications' : '/api/teacher-applications';
const A = { data: null, step: 0, form: {}, editing: false };

const STEPS = KIND === 'admin'
  ? [['badge', 'About you'], ['domain', 'Departments'], ['upload_file', 'Proof'], ['handshake', 'Code of conduct']]
  : [['apartment', 'Institution'], ['work', 'Your role'], ['upload_file', 'Proof'], ['fact_check', 'Review']];

// ==========================================
// 1. LOADING AND THE OVERALL STATE
// ==========================================
async function loadApply() {
  try {
    A.data = await api(`${API_PATH}/me`);
    renderApply();
  } catch (err) {
    el('applyMain').innerHTML = stateBlock('cloud_off', 'Could not load your application', escapeHtml(err.message), '<button class="ch-btn solid" type="button" onclick="loadApply()">Try again</button>');
  }
}

function renderApply() {
  const { profile, application } = A.data;
  if (KIND === 'admin' && profile.is_founder) {
    el('applyMain').innerHTML = stateBlock('star', 'You are the founder', 'You decide admin applications yourself in the Founder console. Founder access is not an admin role and is never charged.', '<a class="ch-btn solid" href="founder.html?tab=admins">Open the Founder console</a>');
    return;
  }
  if (KIND === 'admin' && profile.is_admin) {
    el('applyMain').innerHTML = stateBlock('verified_user', 'You are an admin', `You verify accounts of <b>${escapeHtml(profile.college)}</b> for: ${escapeHtml((A.data.scopes || []).join(', ') || 'no departments yet')}.`, '<a class="ch-btn solid" href="verify.html">Open the Verification desk</a>');
    return;
  }
  if (KIND === 'teacher' && profile.is_teacher) {
    el('applyMain').innerHTML = stateBlock('school', 'You are a teacher', `You run College Hub for <b>${escapeHtml(profile.college)}</b>: groups, notices, attendance, marks and class chat.`, '<a class="ch-btn solid" href="college-hub.html">Open College Hub</a>');
    return;
  }
  if (!profile.college) {
    el('applyMain').innerHTML = stateBlock('apartment', 'Add your college first', 'Applications are for the college on your profile. Add it, then come back here.', '<a class="ch-btn solid" href="profile.html">Edit your profile</a>');
    return;
  }
  if (application && ['pending', 'needs_info'].includes(application.status) && !A.editing) return renderStatus(application);
  if (application && !A.editing) return renderStatus(application);
  renderForm();
}

// ==========================================
// 2. THE STATUS PANEL
// ==========================================
function renderStatus(app) {
  const steps = [
    ['send', 'Sent', formatTime(app.requested_at), true],
    ['manage_search', 'Being checked', app.status === 'needs_info' ? 'The founder asked a question' : '', app.status !== 'withdrawn'],
    [app.status === 'declined' ? 'cancel' : 'verified', app.status === 'declined' ? 'Declined' : 'Decision', app.decided_at ? formatTime(app.decided_at) : '', ['approved', 'declined'].includes(app.status)]
  ];
  const question = app.status === 'needs_info' ? `
    <div class="ap-question">
      <h4>${icon('help')}The founder asks</h4>
      <p>${linkify(app.info_question)}</p>
      <label class="ch-field-label" for="infoAnswer">Your answer</label>
      <textarea class="ch-textarea" id="infoAnswer" maxlength="2000"></textarea>
      <button class="ch-btn solid" type="button" data-act="answer">${icon('send')}Send answer</button>
    </div>` : '';
  const again = ['declined', 'withdrawn', 'revoked'].includes(app.status)
    ? `<button class="ch-btn solid" type="button" data-act="again">${icon('edit_note')}Apply again</button>` : '';
  el('applyMain').innerHTML = `
    <div class="ch-panel ap-status">
      <div class="ap-status-top">${statusChip(app.status)}<span class="ch-muted">Application #${app.id} · ${escapeHtml(app.college)}</span></div>
      <h2>${{ pending: 'Your application is being checked', needs_info: 'One question before a decision', approved: 'Approved', declined: 'Your application was declined', withdrawn: 'You withdrew this application', revoked: 'Your access was removed' }[app.status] || 'Your application'}</h2>
      <ol class="ap-track">${steps.map(([ico, label, sub, done]) => `<li class="${done ? 'done' : ''}">${icon(ico)}<b>${label}</b><small>${escapeHtml(sub || '')}</small></li>`).join('')}</ol>
      ${app.decision_note ? `<div class="ap-note">${icon('chat')}<div><b>Note from the founder</b><p>${linkify(app.decision_note)}</p></div></div>` : ''}
      ${app.info_answer && app.status === 'pending' ? `<div class="ap-note">${icon('reply')}<div><b>Your answer</b><p>${linkify(app.info_answer)}</p></div></div>` : ''}
      ${question}
      <dl class="ap-summary">${summaryRows(app).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="ap-actions">
        ${['pending', 'needs_info'].includes(app.status) ? `<button class="ch-btn line danger" type="button" data-act="withdraw">Withdraw</button>` : ''}
        ${again}
      </div>
    </div>`;
}

function summaryRows(app) {
  const link = (url, name) => url ? `<a class="msg-link" href="${escapeHtml(mediaUrl(url))}" target="_blank" rel="noopener">${escapeHtml(name)}</a>` : '—';
  if (KIND === 'admin') {
    return [['Role at college', escapeHtml(app.role_at_college)], ['Departments', escapeHtml(app.departments.join(', '))], ['Staff / student ID', escapeHtml(app.staff_id)],
      ['Official email', escapeHtml(app.official_email)], ['Hours per week', String(app.hours)], ['ID card', link(app.id_proof_url, 'View')], ['Authorisation letter', link(app.letter_url, 'View')]];
  }
  return [['Department', escapeHtml(app.department)], ['Designation', escapeHtml(app.designation)], ['Employee ID', escapeHtml(app.employee_id)],
    ['Official email', escapeHtml(app.official_email)], ['Subjects', escapeHtml(app.subjects.join(', ') || '—')], ['Years teaching', String(app.years)],
    ['Staff ID card', link(app.id_proof_url, 'View')], ['Letter', link(app.letter_url, 'View')]];
}

// ==========================================
// 3. THE FORM, STEP BY STEP
// ==========================================
function startForm() {
  const { profile, application } = A.data;
  const last = application || {};
  A.form = KIND === 'admin'
    ? { role_at_college: last.role_at_college || '', staff_id: last.staff_id || '', official_email: last.official_email || '', phone: last.phone || '',
        departments: last.departments || (profile.department ? [profile.department] : []), hours: last.hours || 4, languages: last.languages || '',
        id_proof: last.id_proof_url ? { url: last.id_proof_url, name: 'ID card (from last time)' } : null,
        letter: last.letter_url ? { url: last.letter_url, name: 'Letter (from last time)' } : null, motivation: last.motivation || '', agree: [false, false, false] }
    : { department: last.department || profile.department || '', designation: last.designation || '', employee_id: last.employee_id || '', official_email: last.official_email || '',
        phone: last.phone || '', subjects: last.subjects || [], years: last.years || 0, profile_link: last.profile_link || '', note: last.note || '',
        id_proof: last.id_proof_url ? { url: last.id_proof_url, name: 'Staff ID (from last time)' } : null,
        letter: last.letter_url ? { url: last.letter_url, name: 'Letter (from last time)' } : null, agree: [false, false] };
  A.step = 0;
}

function renderForm() {
  if (!A.form || !Object.keys(A.form).length) startForm();
  el('applyMain').innerHTML = `
    <div class="ch-panel ap-form">
      <ol class="ap-steps">${STEPS.map(([ico, label], n) => `<li class="${n < A.step ? 'done' : ''}${n === A.step ? ' current' : ''}">${icon(n < A.step ? 'check' : ico)}<span>${label}</span></li>`).join('')}</ol>
      <div class="ap-progress"><i style="width:${(A.step + 1) / STEPS.length * 100}%"></i></div>
      <div class="ch-form" id="stepBody">${stepHtml()}</div>
      <p class="ch-form-error ch-hidden" id="stepError" role="alert"></p>
      <div class="ap-actions">
        ${A.step ? `<button class="ch-btn line" type="button" data-act="back">${icon('arrow_back')}Back</button>` : (A.editing ? '<button class="ch-btn line" type="button" data-act="cancel-edit">Cancel</button>' : '')}
        <span class="ch-spacer"></span>
        ${A.step < STEPS.length - 1 ? `<button class="ch-btn solid" type="button" data-act="next">Continue${icon('arrow_forward')}</button>` : `<button class="ch-btn solid" type="button" data-act="submit">${icon('send')}Send application</button>`}
      </div>
    </div>`;
  bindStep();
}

const field = (id, label, input, hint) => `<label>${label}${input}${hint ? `<small class="ap-hint">${hint}</small>` : ''}</label>`;
const val = (key) => escapeHtml(A.form[key] === undefined || A.form[key] === null ? '' : String(A.form[key]));

function stepHtml() {
  const { profile } = A.data;
  const college = `<div class="ap-college">${icon('apartment')}<div><b>${escapeHtml(profile.college)}</b><small>From your profile. To apply for another college, <a class="msg-link" href="profile.html">change it there</a> first.</small></div></div>`;
  if (KIND === 'teacher') {
    if (A.step === 0) return `${college}
      ${field('department', 'Department', `<input class="ch-input" id="f_department" maxlength="120" value="${val('department')}" placeholder="For example: Computer Engineering">`)}
      <div class="ch-row2">
        ${field('email', 'Official college email', `<input class="ch-input" id="f_official_email" type="email" maxlength="160" value="${val('official_email')}" placeholder="name@college.edu.in">`, 'An address on the college domain is checked fastest.')}
        ${field('phone', 'Phone', `<input class="ch-input" id="f_phone" type="tel" maxlength="20" value="${val('phone')}" placeholder="+91 98765 43210">`)}
      </div>`;
    if (A.step === 1) return `
      <div class="ch-row2">
        ${field('designation', 'Designation', `<select class="ch-select" id="f_designation"><option value="">Pick one</option>${A.data.designations.map(d => `<option ${d === A.form.designation ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}</select>`)}
        ${field('employee', 'Employee / staff ID', `<input class="ch-input" id="f_employee_id" maxlength="60" value="${val('employee_id')}">`)}
      </div>
      ${field('years', 'Years of teaching', `<input class="ch-input" id="f_years" type="number" min="0" max="60" value="${val('years')}">`)}
      <div><span class="ch-field-label">Subjects you teach <small>(press Enter after each)</small></span>
        <div class="ap-tags" id="subjectTags"></div>
        <input class="ch-input" id="f_subject" maxlength="60" placeholder="For example: Data Structures"></div>`;
    if (A.step === 2) return `
      ${fileInputHtml('f_id_proof', 'Staff ID card photo', 'A clear photo of the front of your college staff ID.', true)}
      ${fileInputHtml('f_letter', 'Appointment letter or recent salary slip', 'Hide amounts if you like. It only proves you work there.', false)}
      ${field('link', 'LinkedIn, Google Scholar or college profile page <small>(optional)</small>', `<input class="ch-input" id="f_profile_link" type="url" maxlength="300" value="${val('profile_link')}" placeholder="https://">`)}`;
    return `
      <dl class="ap-summary">${[['College', profile.college], ['Department', A.form.department], ['Designation', A.form.designation], ['Employee ID', A.form.employee_id],
        ['Official email', A.form.official_email], ['Phone', A.form.phone], ['Subjects', A.form.subjects.join(', ') || '—'], ['Years teaching', A.form.years],
        ['Staff ID card', A.form.id_proof ? A.form.id_proof.name : '—'], ['Letter', A.form.letter ? A.form.letter.name : '—']].map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>
      ${field('note', 'Anything the founder should know <small>(optional)</small>', `<textarea class="ch-textarea" id="f_note" maxlength="1000">${val('note')}</textarea>`)}
      <label class="ch-check"><input type="checkbox" data-agree="0" ${A.form.agree[0] ? 'checked' : ''}>The information above is true and the documents are mine.</label>
      <label class="ch-check"><input type="checkbox" data-agree="1" ${A.form.agree[1] ? 'checked' : ''}>I understand teacher access is removed if it is misused.</label>`;
  }
  // ---- admin
  if (A.step === 0) return `${college}
    <div class="ch-row2">
      ${field('role', 'Your role at the college', `<select class="ch-select" id="f_role_at_college"><option value="">Pick one</option>${A.data.roles.map(r => `<option ${r === A.form.role_at_college ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}</select>`)}
      ${field('staff', 'Staff or student ID', `<input class="ch-input" id="f_staff_id" maxlength="60" value="${val('staff_id')}">`)}
    </div>
    <div class="ch-row2">
      ${field('email', 'Official college email', `<input class="ch-input" id="f_official_email" type="email" maxlength="160" value="${val('official_email')}" placeholder="name@college.edu.in">`)}
      ${field('phone', 'Phone', `<input class="ch-input" id="f_phone" type="tel" maxlength="20" value="${val('phone')}">`)}
    </div>`;
  if (A.step === 1) {
    const choices = [...new Set([...(A.data.college_departments || []), ...A.form.departments])].sort((a, b) => a.localeCompare(b));
    return `<p class="ch-muted">Pick the departments whose students you will verify. You will only see accounts from these departments; anything else you can pass on to the right department.</p>
      <div class="ap-checks" id="deptChecks">${choices.map(d => `<label class="ch-check"><input type="checkbox" value="${escapeHtml(d)}" ${A.form.departments.includes(d) ? 'checked' : ''}>${escapeHtml(d)}</label>`).join('') || '<p class="ch-muted">No departments are listed for your college yet. Add yours below.</p>'}</div>
      <div class="ap-inline"><input class="ch-input" id="f_new_dept" maxlength="120" placeholder="Another department"><button class="ch-btn line small" type="button" data-act="add-dept">${icon('add')}Add</button></div>
      <div class="ch-row2">
        ${field('hours', 'Hours a week you can give', `<input class="ch-input" id="f_hours" type="number" min="1" max="60" value="${val('hours')}">`)}
        ${field('languages', 'Languages <small>(optional)</small>', `<input class="ch-input" id="f_languages" maxlength="120" value="${val('languages')}" placeholder="English, Marathi, Hindi">`)}
      </div>`;
  }
  if (A.step === 2) return `
    ${fileInputHtml('f_id_proof', 'College ID card photo', 'Front side, with your name and photo readable.', true)}
    ${fileInputHtml('f_letter', 'Authorisation letter from your HOD or principal', 'Strongly suggested: applications with a letter are approved much faster.', false)}`;
  return `
    ${field('motivation', 'Why do you want to help verify students?', `<textarea class="ch-textarea" id="f_motivation" maxlength="2000" placeholder="Your connection to these departments, how you know the students, experience with records...">${val('motivation')}</textarea>`, 'At least 30 characters.')}
    <div class="ap-conduct">
      <h4>${icon('gavel')}Admin code of conduct</h4>
      <label class="ch-check"><input type="checkbox" data-agree="0" ${A.form.agree[0] ? 'checked' : ''}>I will use students' ID documents only to verify them, and never share or keep copies.</label>
      <label class="ch-check"><input type="checkbox" data-agree="1" ${A.form.agree[1] ? 'checked' : ''}>I will decide fairly, without favouring friends or rejecting anyone for personal reasons.</label>
      <label class="ch-check"><input type="checkbox" data-agree="2" ${A.form.agree[2] ? 'checked' : ''}>I understand every decision is logged, the founder reviews them, and access can be removed.</label>
    </div>
    <div class="ap-note">${icon('info')}<div><b>Admin access is a role, not a plan</b><p>It gives you the Verification desk only. Paid features (Pro, Premium, recruiter tools) are bought on the Plans page like any other account.</p></div></div>`;
}

function bindStep() {
  if (KIND === 'teacher' && A.step === 1) {
    const paintTags = () => {
      el('subjectTags').innerHTML = A.form.subjects.map((s, n) => `<span class="ch-chip indigo">${escapeHtml(s)}<button type="button" data-remove-tag="${n}" aria-label="Remove ${escapeHtml(s)}">×</button></span>`).join('');
    };
    paintTags();
    el('f_subject').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      const value = e.target.value.trim().replace(/,$/, '');
      if (value && !A.form.subjects.some(s => s.toLowerCase() === value.toLowerCase()) && A.form.subjects.length < 15) A.form.subjects.push(value);
      e.target.value = '';
      paintTags();
    });
    el('subjectTags').addEventListener('click', (e) => {
      const remove = e.target.closest('[data-remove-tag]');
      if (remove) { A.form.subjects.splice(Number(remove.dataset.removeTag), 1); paintTags(); }
    });
  }
  if (A.step === 2) {
    bindFileInput('f_id_proof', A.form.id_proof, (picked) => { A.form.id_proof = picked; });
    bindFileInput('f_letter', A.form.letter, (picked) => { A.form.letter = picked; });
  }
}

// Copy what is on screen into A.form, and say what is missing
function readStep() {
  const take = (key) => { const box = el(`f_${key}`); if (box) A.form[key] = box.value.trim(); };
  document.querySelectorAll('[data-agree]').forEach(box => { A.form.agree[Number(box.dataset.agree)] = box.checked; });
  const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
  const phoneOk = (v) => /^\+?[0-9][0-9 ()-]{7,15}$/.test(v);
  if (KIND === 'teacher') {
    if (A.step === 0) {
      ['department', 'official_email', 'phone'].forEach(take);
      if (!A.form.department) return 'Fill in your department.';
      if (!emailOk(A.form.official_email)) return 'Enter a valid official email address.';
      if (!phoneOk(A.form.phone)) return 'Enter a valid phone number.';
    }
    if (A.step === 1) {
      ['designation', 'employee_id', 'years'].forEach(take);
      const pending = el('f_subject').value.trim();
      if (pending && !A.form.subjects.includes(pending)) A.form.subjects.push(pending);
      if (!A.form.designation) return 'Pick your designation.';
      if (!A.form.employee_id) return 'Fill in your employee or staff ID.';
    }
    if (A.step === 2) {
      take('profile_link');
      if (el('f_id_proof').uploading || el('f_letter').uploading) return 'Wait for the upload to finish.';
      if (!A.form.id_proof) return 'Attach a photo of your staff ID card.';
      if (A.form.profile_link && !/^https?:\/\//i.test(A.form.profile_link)) return 'The profile link must start with https://';
    }
    if (A.step === 3) {
      take('note');
      if (!A.form.agree.every(Boolean)) return 'Tick both declarations to send the application.';
    }
    return '';
  }
  if (A.step === 0) {
    ['role_at_college', 'staff_id', 'official_email', 'phone'].forEach(take);
    if (!A.form.role_at_college) return 'Pick your role at the college.';
    if (!A.form.staff_id) return 'Fill in your staff or student ID.';
    if (!emailOk(A.form.official_email)) return 'Enter a valid official email address.';
    if (!phoneOk(A.form.phone)) return 'Enter a valid phone number.';
  }
  if (A.step === 1) {
    A.form.departments = [...el('deptChecks').querySelectorAll('input:checked')].map(box => box.value);
    ['hours', 'languages'].forEach(take);
    if (!A.form.departments.length) return 'Pick at least one department.';
    if (!(Number(A.form.hours) >= 1 && Number(A.form.hours) <= 60)) return 'Hours per week must be between 1 and 60.';
  }
  if (A.step === 2) {
    if (el('f_id_proof').uploading || el('f_letter').uploading) return 'Wait for the upload to finish.';
    if (!A.form.id_proof) return 'Attach a photo of your college ID card.';
  }
  if (A.step === 3) {
    take('motivation');
    if ((A.form.motivation || '').length < 30) return 'Tell the founder a little more about why you want to help (at least 30 characters).';
    if (!A.form.agree.every(Boolean)) return 'Accept all three points of the code of conduct.';
  }
  return '';
}

function stepError(message) {
  el('stepError').textContent = message;
  el('stepError').classList.toggle('ch-hidden', !message);
}

async function submitApplication(button) {
  const f = A.form;
  const body = KIND === 'admin'
    ? { role_at_college: f.role_at_college, staff_id: f.staff_id, official_email: f.official_email, phone: f.phone, departments: f.departments,
        hours: Number(f.hours) || 0, languages: f.languages, id_proof_url: f.id_proof.url, letter_url: f.letter ? f.letter.url : '', motivation: f.motivation, agree: true }
    : { department: f.department, designation: f.designation, employee_id: f.employee_id, official_email: f.official_email, phone: f.phone, subjects: f.subjects,
        years: Number(f.years) || 0, id_proof_url: f.id_proof.url, letter_url: f.letter ? f.letter.url : '', profile_link: f.profile_link, note: f.note, agree: true };
  button.disabled = true;
  try {
    await api(API_PATH, { method: 'POST', body });
    showToast('Application sent. You will get a notification when the founder decides.');
    A.editing = false;
    A.form = {};
    await loadApply();
  } catch (err) {
    stepError(err.message);
    button.disabled = false;
  }
}

el('applyMain').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-act]');
  if (!button) return;
  const act = button.dataset.act;
  if (act === 'next') {
    const problem = readStep();
    if (problem) return stepError(problem);
    A.step += 1;
    return renderForm();
  }
  if (act === 'back') { readStep(); A.step -= 1; return renderForm(); }
  if (act === 'submit') {
    const problem = readStep();
    if (problem) return stepError(problem);
    return submitApplication(button);
  }
  if (act === 'add-dept') {
    const value = el('f_new_dept').value.trim();
    if (!value) return;
    A.form.departments = [...new Set([...[...el('deptChecks').querySelectorAll('input:checked')].map(box => box.value), value])];
    A.data.college_departments = [...new Set([...(A.data.college_departments || []), value])];
    return renderForm();
  }
  if (act === 'again') { A.editing = true; A.form = {}; return renderForm(); }
  if (act === 'cancel-edit') { A.editing = false; return renderApply(); }
  if (act === 'withdraw') {
    return confirmThen('Withdraw your application?', 'The founder will no longer see it. You can apply again later.', 'Withdraw',
      () => attempt(async () => { await api(`${API_PATH}/me/withdraw`, { method: 'POST' }); await loadApply(); }, 'Application withdrawn.'));
  }
  if (act === 'answer') {
    const answer = el('infoAnswer').value.trim();
    if (!answer) return showToast('Write your answer first.');
    button.disabled = true;
    await attempt(async () => { await api(`${API_PATH}/me/answer`, { method: 'POST', body: { answer } }); await loadApply(); }, 'Answer sent.');
    button.disabled = false;
  }
});

bindModal();
loadApply();
