// ==========================================
// INSTITUTION.JS — Institution analytics (institution.html) for a licensed college: students, verification,
// College Hub activity, handed-in work, attendance by class, questions and top skills.
// Teachers and admins see their own college; the founder picks any college.
// Loaded after shared.js, chat-common.js and pages-common.js.
// ==========================================

const I = { data: null, colleges: null, college: new URLSearchParams(location.search).get('college') || '' };

async function loadInstitution() {
  el('instBody').innerHTML = '<div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:260px;margin-top:16px"></div>';
  try {
    if (I.colleges === null) {
      I.colleges = await api('/api/institution/colleges').then(r => r.colleges).catch(() => false);   // false: not the founder
    }
    if (I.colleges && !I.college && I.colleges.length) I.college = I.colleges[0].name;
    renderPicker();
    I.data = await api(`/api/institution/analytics${I.college ? `?college=${encodeURIComponent(I.college)}` : ''}`);
    renderInstitution();
  } catch (err) {
    if (err.status === 402) {
      el('instBody').innerHTML = `<div class="ch-panel rc-pay"><div>${icon('insights')}<h2>Analytics come with the institution licence</h2>
        <p>See how your students use Connect2Minds: verification, College Hub activity, handed-in work and marks, attendance by class and the skills your students list.</p>
        <div class="ap-actions"><a class="ch-btn solid" href="pricing.html?tab=institution">${icon('sell')}See institution plans</a></div></div></div>`;
      return;
    }
    if (err.status === 403) {
      el('instBody').innerHTML = stateBlock('lock', 'For teachers and admins of a college', escapeHtml(err.message), '<a class="ch-btn solid" href="apply-teacher.html">Apply as teacher</a>');
      return;
    }
    el('instBody').innerHTML = stateBlock('cloud_off', 'Could not load analytics', escapeHtml(err.message));
  }
}

function renderPicker() {
  if (!I.colleges) { el('instPicker').innerHTML = ''; return; }
  el('instPicker').innerHTML = `<select class="ch-select" id="instCollege" aria-label="College">${I.colleges.map(c => `<option value="${escapeHtml(c.name)}" ${c.name === I.college ? 'selected' : ''}>${escapeHtml(c.name)} (${c.people})${c.licence ? ` · ${escapeHtml(c.licence.name)}` : ''}</option>`).join('')}</select>`;
}

function bars(rows, keys, colours) {
  const max = Math.max(1, ...rows.map(r => keys.reduce((sum, k) => sum + (r[k] || 0), 0)));
  return `<div class="in-bars">${rows.map(r => `<div class="in-bar" title="${escapeHtml(formatDate(r.week))}: ${keys.map(k => `${k} ${r[k] || 0}`).join(', ')}">
    <div class="in-stack">${keys.map((k, n) => `<i style="height:${(r[k] || 0) / max * 100}%;background:${colours[n]}"></i>`).join('')}</div>
    <small>${escapeHtml(new Date(`${r.week}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' }))}</small></div>`).join('')}</div>`;
}

function renderInstitution() {
  const d = I.data;
  const verified = d.verification.verified || 0;
  const verifiedShare = d.students ? Math.round(verified / d.students * 100) : 0;
  const lic = d.licence;
  el('instTitle').textContent = d.college;
  el('instLicence').innerHTML = lic
    ? `<span class="ch-chip ${lic.trial ? 'indigo' : 'green'}">${icon(lic.trial ? 'hourglass_top' : 'workspace_premium')}${escapeHtml(lic.name)}</span><span>until ${escapeHtml(formatDate(lic.ends_at))}</span>`
    : '<span class="ch-chip warn">No licence (founder view)</span>';
  const funnel = ['verified', 'active', 'pending', 'needs_info', 'appealed', 'rejected'].map(s => [s, d.verification[s] || 0]).filter(([, n]) => n);
  const maxFunnel = Math.max(1, ...funnel.map(([, n]) => n));
  el('instBody').innerHTML = `
    ${d.over_limit ? `<div class="ap-note warn">${icon('warning')}<div><b>Over the licence limit</b><p>${d.students} students against ${d.max_students} in ${escapeHtml(lic.name)}. Talk to us about moving up a tier.</p></div></div>` : ''}
    <div class="in-kpis">
      ${[[d.students + (d.max_students ? `<small> / ${d.max_students}</small>` : ''), 'students', 'school'], [`${verifiedShare}%`, 'verified', 'verified'], [d.groups, 'College Hub groups', 'groups'],
        [d.work.submissions, `pieces of work handed in${d.work.late ? ` (${d.work.late} late)` : ''}`, 'upload_file'],
        [d.work.average_marks_percent === null ? '—' : `${d.work.average_marks_percent}%`, 'average marks', 'grade'],
        [d.questions.total ? `${Math.round(d.questions.answered / d.questions.total * 100)}%` : '—', `of ${d.questions.total} questions answered`, 'live_help']]
        .map(([value, label, ico]) => `<div class="ch-panel in-kpi">${icon(ico)}<b>${value}</b><span>${escapeHtml(label)}</span></div>`).join('')}
    </div>
    <div class="in-grid">
      <section class="ch-panel in-card wide"><h3>College Hub activity, last 12 weeks</h3>
        ${d.activity.length ? bars(d.activity, ['chat', 'posts', 'work', 'questions'], ['#3525cd', '#0b1c30', '#10b981', '#94a3b8']) : '<p class="ch-muted">No activity in the last 12 weeks.</p>'}
        <div class="ch-cal-legend" style="border:0;padding:8px 0 0">${[['Chat', '#3525cd'], ['Notices and activities', '#0b1c30'], ['Handed-in work', '#10b981'], ['Questions', '#94a3b8']].map(([l, c]) => `<span><i style="background:${c};border-left:0"></i>${l}</span>`).join('')}</div>
      </section>
      <section class="ch-panel in-card"><h3>Verification</h3>
        ${funnel.map(([status, n]) => `<div class="in-row"><span>${statusChip(status)}</span><div class="ch-meter"><i style="width:${n / maxFunnel * 100}%"></i></div><b>${n}</b></div>`).join('') || '<p class="ch-muted">No students yet.</p>'}
      </section>
      <section class="ch-panel in-card"><h3>New students per week</h3>
        ${d.signups.length ? bars(d.signups.map(s => ({ week: s.week, count: s.count })), ['count'], ['#4f46e5']) : '<p class="ch-muted">No sign-ups in the last 12 weeks.</p>'}
      </section>
      <section class="ch-panel in-card"><h3>Attendance by class</h3>
        ${d.attendance.length ? `<table class="ch-table"><thead><tr><th>Class</th><th>Marks</th><th style="width:45%">Attended</th></tr></thead><tbody>
          ${d.attendance.map(a => `<tr class="${a.percent < 75 ? 'is-low' : ''}"><td>${escapeHtml(a.class)}</td><td>${a.marks}</td><td><span class="ch-cell-meter"><span class="ch-meter"><i style="width:${a.percent}%"></i></span><b>${a.percent}%</b></span></td></tr>`).join('')}
        </tbody></table>` : '<p class="ch-muted">No attendance taken yet.</p>'}
      </section>
      <section class="ch-panel in-card"><h3>Top skills of your students</h3>
        <div class="ch-group-tags">${d.top_skills.map(s => `<span class="ch-chip indigo">${escapeHtml(s.skill)} <b>${s.students}</b></span>`).join('') || '<p class="ch-muted">Students have not listed skills yet.</p>'}</div>
      </section>
    </div>
    <div class="ap-actions"><span class="ch-spacer"></span><button class="ch-btn line" type="button" data-act="csv">${icon('download')}Download summary (CSV)</button></div>`;
}

document.querySelector('main').addEventListener('change', (e) => {
  if (e.target.id === 'instCollege') { I.college = e.target.value; history.replaceState(null, '', `${location.pathname}?college=${encodeURIComponent(I.college)}`); loadInstitution(); }
});
document.querySelector('main').addEventListener('click', (e) => {
  if (!e.target.closest('[data-act="csv"]') || !I.data) return;
  const d = I.data;
  const rows = [['Measure', 'Value'], ['College', d.college], ['Students', d.students], ...Object.entries(d.verification).map(([k, v]) => [`Accounts ${k}`, v]),
    ['College Hub groups', d.groups], ['Work handed in', d.work.submissions], ['Handed in late', d.work.late], ['Average marks %', d.work.average_marks_percent ?? ''],
    ['Questions', d.questions.total], ['Questions answered', d.questions.answered], ['Questions solved', d.questions.solved],
    ...d.attendance.map(a => [`Attendance ${a.class} %`, a.percent]), ...d.top_skills.map(s => [`Skill: ${s.skill}`, s.students])];
  downloadCsv(rows, `${d.college.replace(/[^\w]+/g, '-')}-analytics.csv`);
});

bindModal();
loadInstitution();
