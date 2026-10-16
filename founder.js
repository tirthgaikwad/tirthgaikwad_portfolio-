// ==========================================
// FOUNDER.JS — The Founder console (founder.html). Only the founder: admin and teacher applications, admins and
// their departments, the verification log, plans and payments, business enquiries and sponsored challenges, and the
// Safety tab (section 31): reports with their legal dates, suspended accounts, under-18s waiting for a guardian,
// and a password reset link for people who cannot get email.
// The accounts table and the announcement stay on admin_dashboard.html (the "Accounts" tab links there).
// Loaded after shared.js, chat-common.js and pages-common.js.
// ==========================================

const TABS = ['overview', 'safety', 'admins', 'teachers', 'verification', 'plans', 'enquiries', 'sponsored'];
const F = { tab: 'overview', cache: {} };
const PERIOD_LABEL = { month: 'Monthly', year: 'Yearly', one_time: 'One-off', trial: 'Trial' };

function switchTab(tab) {
  F.tab = tab;
  el('fcBody').innerHTML = '<div class="skeleton" style="height:140px"></div><div class="skeleton" style="height:220px;margin-top:14px"></div>';
  ({ overview: renderOverview, safety: renderSafety, admins: renderAdmins, teachers: renderTeachers, verification: renderVerification, plans: renderPlans, enquiries: renderEnquiries, sponsored: renderSponsored })[tab]();
}

function guard(err) {
  if (err.status === 403) {
    el('fcTabs').classList.add('ch-hidden');
    el('fcBody').innerHTML = stateBlock('lock', 'Founder only', 'This console is for the founder of Connect2Minds. Admins work from the Verification desk.', '<a class="ch-btn solid" href="verify.html">Open the Verification desk</a>');
    return;
  }
  el('fcBody').innerHTML = stateBlock('cloud_off', 'Could not load this part', escapeHtml(err.message), '<button class="ch-btn solid" type="button" data-act="reload">Try again</button>');
}

// ==========================================
// 1. OVERVIEW
// ==========================================
async function renderOverview() {
  let o;
  try { o = await api('/api/founder/overview'); } catch (err) { return guard(err); }
  F.cache.overview = o;
  const openItems = [
    ['admins', o.open.admin_applications, 'admin applications waiting', 'shield_person'],
    ['teachers', o.open.teacher_applications, 'teacher applications waiting', 'school'],
    ['safety', o.open.reports || 0, 'reports to answer (24 h to acknowledge, 15 days to decide)', 'flag'],
    ['enquiries', o.open.enquiries, 'enquiries and requests open', 'mail'],
    ['verification', o.open.unassigned_verification, 'accounts waiting with no admin for their department', 'how_to_reg']
  ];
  const lines = { personal: 'Personal plans', recruiter: 'Recruiter', institution: 'Institution licences', sponsor: 'Sponsor packages' };
  el('fcBody').innerHTML = `
    ${o.payments_enabled ? '' : `<div class="ap-note warn">${icon('info')}<div><b>Online payments are off</b><p>Add <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> (test keys first) to the server's .env file and restart it. Until then you can switch plans on by hand under Plans &amp; payments.</p></div></div>`}
    <div class="in-kpis">
      ${[[o.users, 'members', 'group'], [`${o.users ? Math.round(o.verified / o.users * 100) : 0}%`, 'verified', 'verified'], [o.admins, 'admins', 'shield_person'], [o.teachers, 'teachers', 'school'],
        [inr(o.revenue_month_paise), `revenue this month (${o.payments_month} payments, incl. GST)`, 'payments'], [inr(o.mrr_paise), 'monthly recurring revenue (before GST)', 'trending_up']]
        .map(([v, l, i]) => `<div class="ch-panel in-kpi">${icon(i)}<b>${v}</b><span>${escapeHtml(l)}</span></div>`).join('')}
    </div>
    <div class="in-grid">
      <section class="ch-panel in-card"><h3>Waiting for you</h3>
        ${openItems.map(([tab, n, label, ico]) => `<button class="fc-open${n ? ' has' : ''}" type="button" data-tab-go="${tab}">${icon(ico)}<b>${n}</b><span>${escapeHtml(label)}</span>${icon('chevron_right')}</button>`).join('')}
      </section>
      <section class="ch-panel in-card"><h3>Helper bot</h3>
        <div class="in-row"><span>AI answers</span><b>${o.helpbot && o.helpbot.ai ? 'On' : 'Off (built-in guide)'}</b></div>
        <div class="in-row"><span>AI answers today</span><b>${o.helpbot ? o.helpbot.answers_today : 0}</b></div>
        <div class="in-row"><span>People who used it today</span><b>${o.helpbot ? o.helpbot.people_today : 0}</b></div>
        ${o.helpbot && o.helpbot.ai ? '' : '<p class="ch-muted">To switch AI on, add ANTHROPIC_API_KEY to the .env file on the server. Each member gets up to 40 AI answers a day; after that the free built-in guide answers.</p>'}
      </section>
      <section class="ch-panel in-card wide" id="fcVisits" aria-busy="true"><h3>Visitors</h3><div class="skeleton" style="height:120px"></div></section>
      <section class="ch-panel in-card"><h3>Active plans</h3>
        ${Object.keys(lines).map(line => `<div class="in-row"><span>${lines[line]}</span><b>${o.active_by_line[line] || 0}</b></div>`).join('')}
        <a class="msg-link" href="pricing.html">See the public pricing page</a>
      </section>
      <section class="ch-panel in-card wide"><h3>Recent payments</h3>
        ${o.recent_payments.length ? paymentsTable(o.recent_payments, false) : '<p class="ch-muted">No payments yet.</p>'}
      </section>
    </div>`;
  renderVisits();
}

// Visit counts (main.py section 29): only from people who allowed them in the cookie banner
async function renderVisits() {
  let v;
  try { v = await api('/api/founder/visits'); } catch (err) { v = null; }
  const box = el('fcVisits');
  if (!box) return;
  box.removeAttribute('aria-busy');
  if (!v) { box.innerHTML = '<h3>Visitors</h3><p class="ch-muted">Could not load the visit counts.</p>'; return; }
  const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const peak = Math.max(1, ...v.days.map(d => d.visitors));
  const topViews = Math.max(1, ...v.top_pages.map(p => p.views));
  const kpis = [[v.today, 'visitors today'], [v.week, 'in the last 7 days'], [v.month, 'in the last 30 days'], [v.views_month, 'pages opened (30 days)'], [v.members_month, 'of them logged in']];
  box.innerHTML = `<h3>Visitors</h3>
    <div class="fc-visit-kpis">${kpis.map(([n, label]) => `<div><b>${n}</b><span>${label}</span></div>`).join('')}</div>
    ${v.views_month ? `
      <div class="fc-visit-chart" role="img" aria-label="Visitors per day for the last 30 days; the busiest day had ${peak}.">
        ${v.days.map(d => `<div class="fc-vbar" title="${dayLabel(d.day)}: ${d.visitors} visitor${d.visitors === 1 ? '' : 's'}, ${d.views} page${d.views === 1 ? '' : 's'} opened"><i style="height:${d.visitors ? Math.max(4, Math.round(d.visitors / peak * 100)) : 0}%"></i></div>`).join('')}
      </div>
      <div class="fc-visit-axis"><span>${dayLabel(v.days[0].day)}</span><span>Today</span></div>
      <h4 class="fc-visit-sub">Most opened pages</h4>
      ${v.top_pages.map(p => `<div class="in-row"><span>${escapeHtml(p.page)}</span><div class="ch-meter"><i style="width:${Math.round(p.views / topViews * 100)}%"></i></div><b>${p.views}</b></div>`).join('')}`
    : '<p class="ch-muted">No visits counted yet.</p>'}
    <p class="ch-muted fc-visit-note">Only people who allow visit counts in the cookie banner are counted, with our own counter: no IP addresses, not linked to accounts, deleted after ${v.keep_days} days.</p>`;
}

// ==========================================
// 2. APPLICATIONS (admins and teachers share the card)
// ==========================================
function docLink(url, label) {
  return url ? `<a class="ch-btn line small" href="${escapeHtml(mediaUrl(url))}" target="_blank" rel="noopener">${icon('description')}${label}</a>` : '';
}

function applicationCard(app, kind) {
  const open = ['pending', 'needs_info'].includes(app.status);
  const facts = kind === 'admin'
    ? [['Role', app.role_at_college], ['Departments asked', app.departments.join(', ')], ['Own department', app.own_department], ['Staff / student ID', app.staff_id], ['Email', app.official_email], ['Phone', app.phone], ['Hours a week', app.hours], ['Languages', app.languages]]
    : [['Department', app.department], ['Designation', app.designation], ['Employee ID', app.employee_id], ['Email', app.official_email], ['Phone', app.phone], ['Subjects', app.subjects.join(', ')], ['Years teaching', app.years]];
  return `<article class="ch-panel fc-app" data-app="${app.id}">
    <div class="fc-app-top">${avatarOf({ name: app.name, profile_pic: app.profile_pic })}
      <div style="flex:1;min-width:0"><h3><a href="profile.html?id=${app.user_id}" target="_blank" rel="noopener">${escapeHtml(app.name)}</a> ${statusChip(app.status)} ${statusChip(app.account_status)}</h3>
      <p class="vd-meta">${icon('apartment')}${escapeHtml(app.college)} · sent ${escapeHtml(formatTime(app.requested_at))}${app.email ? ` · ${escapeHtml(app.email)}` : ''}</p></div></div>
    <dl class="ap-summary">${facts.filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>
    ${app.motivation ? `<div class="ap-note">${icon('format_quote')}<div><b>Why they want to help</b><p>${linkify(app.motivation)}</p></div></div>` : ''}
    ${app.note ? `<div class="ap-note">${icon('notes')}<div><b>Their note</b><p>${linkify(app.note)}</p></div></div>` : ''}
    ${app.info_question ? `<div class="ap-note">${icon('help')}<div><b>You asked</b><p>${linkify(app.info_question)}</p>${app.info_answer ? `<b>They answered</b><p>${linkify(app.info_answer)}</p>` : '<p class="ch-muted">No answer yet.</p>'}</div></div>` : ''}
    ${app.decision_note ? `<div class="ap-note">${icon('gavel')}<div><b>Your decision note</b><p>${linkify(app.decision_note)}</p></div></div>` : ''}
    <div class="ap-actions">
      ${docLink(app.id_proof_url, 'ID card')}${docLink(app.letter_url, 'Letter')}${app.profile_link ? `<a class="ch-btn line small" href="${escapeHtml(app.profile_link)}" target="_blank" rel="noopener">${icon('link')}Profile link</a>` : ''}
      <span class="ch-spacer"></span>
      ${open ? `<button class="ch-btn line small" type="button" data-decide="ask" data-kind="${kind}" data-id="${app.id}">${icon('help')}Ask a question</button>
      <button class="ch-btn line small danger" type="button" data-decide="decline" data-kind="${kind}" data-id="${app.id}">${icon('close')}Decline</button>
      <button class="ch-btn solid small" type="button" data-decide="approve" data-kind="${kind}" data-id="${app.id}">${icon('check')}Approve</button>` : ''}
    </div>
  </article>`;
}

function decide(kind, id, action) {
  const apps = F.cache[`${kind}Apps`] || [];
  const app = apps.find(a => a.id === id);
  if (!app) return;
  const path = kind === 'admin' ? `/api/founder/admin-applications/${id}` : `/api/founder/teacher-applications/${id}`;
  const scope = kind === 'admin' && action === 'approve'
    ? `<div><span class="ch-field-label">Departments this admin may verify</span><div class="ap-checks" id="scopeChecks">${app.departments.map(d => `<label class="ch-check"><input type="checkbox" value="${escapeHtml(d)}" checked>${escapeHtml(d)}</label>`).join('')}</div>
       <div class="ap-inline"><input class="ch-input" id="scopeExtra" maxlength="120" placeholder="Add another department"><button class="ch-btn line small" type="button" id="scopeAdd">${icon('add')}Add</button></div></div>` : '';
  const titles = { approve: `Approve ${app.name}?`, decline: `Decline ${app.name}?`, ask: `Ask ${app.name} a question` };
  const notes = { approve: 'Note to them <small>(optional)</small>', decline: 'Reason (they will see it)', ask: 'Your question' };
  openModal({
    title: titles[action], confirmText: { approve: 'Approve', decline: 'Decline', ask: 'Send question' }[action],
    body: `${action === 'approve' ? `<p class="ch-muted">${kind === 'admin' ? 'They become an admin for the departments below and get the Verification desk. Admin access does not include any paid plan.' : `They become a teacher of ${escapeHtml(app.college)} on College Hub. If it is the college's first teacher, its free institution trial starts.`}</p>` : ''}
      ${scope}<label>${notes[action]}<textarea class="ch-textarea" id="decNote" maxlength="1000"></textarea></label>`,
    onOpen: () => {
      if (!el('scopeAdd')) return;
      el('scopeAdd').addEventListener('click', () => {
        const value = el('scopeExtra').value.trim();
        if (!value) return;
        el('scopeChecks').insertAdjacentHTML('beforeend', `<label class="ch-check"><input type="checkbox" value="${escapeHtml(value)}" checked>${escapeHtml(value)}</label>`);
        el('scopeExtra').value = '';
      });
    },
    onConfirm: async () => {
      const body = { action, note: el('decNote').value };
      if (el('scopeChecks')) body.departments = [...el('scopeChecks').querySelectorAll('input:checked')].map(b => b.value);
      await api(path, { method: 'POST', body });
      showToast({ approve: 'Approved. They have been told.', decline: 'Declined. They have been told.', ask: 'Question sent.' }[action]);
      switchTab(F.tab);
    }
  });
}

async function renderAdmins() {
  let apps, admins;
  try { [apps, admins] = await Promise.all([api('/api/founder/admin-applications'), api('/api/founder/admins')]); } catch (err) { return guard(err); }
  F.cache.adminApps = apps.applications;
  F.cache.admins = admins.admins;
  const open = apps.applications.filter(a => ['pending', 'needs_info'].includes(a.status));
  const settled = apps.applications.filter(a => !['pending', 'needs_info'].includes(a.status));
  el('fcBody').innerHTML = `
    <div class="ch-bar"><h2 class="ch-bar-title">Admins<small>${admins.admins.length}</small></h2></div>
    ${admins.admins.length ? `<div class="ch-panel bl-table"><table class="ch-table"><thead><tr><th>Admin</th><th>College</th><th>Departments</th><th>Last 30 days</th><th></th></tr></thead><tbody>
      ${admins.admins.map(a => { const s = a.last_30_days; return `<tr><td><a class="msg-link" href="profile.html?id=${a.id}" target="_blank" rel="noopener">${escapeHtml(a.name)}</a> <span class="c2m-badge admin">Admin</span><br><small class="ch-muted">${escapeHtml(a.email)}</small></td>
        <td>${escapeHtml(a.college)}</td><td>${escapeHtml(a.departments.join(', ') || '—')}</td>
        <td><small>${s.approve} approved · ${s.reject} rejected · ${s.pass} passed on · ${s.needs_info} asked${s.reversed ? ` · <span class="ch-warn-text">${s.reversed} reversed</span>` : ''}</small></td>
        <td class="fc-row-actions"><button class="ch-btn line small" type="button" data-log="${a.id}">${icon('history')}Log</button><button class="ch-btn line small" type="button" data-scope="${a.id}">${icon('domain')}Departments</button><button class="ch-btn line small danger" type="button" data-revoke-admin="${a.id}">Remove</button></td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="ch-muted">No admins yet. Approve an application below.</p>'}
    <div class="ch-bar" style="margin-top:22px"><h2 class="ch-bar-title">Applications waiting<small>${open.length}</small></h2></div>
    <div class="fc-apps">${open.map(a => applicationCard(a, 'admin')).join('') || stateBlock('inbox', 'No applications waiting', 'New admin applications appear here, and you get a notification.')}</div>
    ${settled.length ? `<details class="fc-history"><summary>Settled applications (${settled.length})</summary><div class="fc-apps">${settled.map(a => applicationCard(a, 'admin')).join('')}</div></details>` : ''}`;
}

async function renderTeachers() {
  let apps, teachers;
  try { [apps, teachers] = await Promise.all([api('/api/founder/teacher-applications'), api('/api/founder/teachers')]); } catch (err) { return guard(err); }
  F.cache.teacherApps = apps.applications;
  const open = apps.applications.filter(a => ['pending', 'needs_info'].includes(a.status));
  const settled = apps.applications.filter(a => !['pending', 'needs_info'].includes(a.status));
  el('fcBody').innerHTML = `
    <div class="ch-bar"><h2 class="ch-bar-title">Applications waiting<small>${open.length}</small></h2></div>
    <div class="fc-apps">${open.map(a => applicationCard(a, 'teacher')).join('') || stateBlock('inbox', 'No applications waiting', 'Teacher applications from apply-teacher.html appear here. Only you can approve them.')}</div>
    <div class="ch-bar" style="margin-top:22px"><h2 class="ch-bar-title">Teachers<small>${teachers.teachers.length}</small></h2></div>
    ${teachers.teachers.length ? `<div class="ch-panel bl-table"><table class="ch-table"><thead><tr><th>Teacher</th><th>College</th><th>Department</th><th></th></tr></thead><tbody>
      ${teachers.teachers.map(t => `<tr><td><a class="msg-link" href="profile.html?id=${t.id}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a> <span class="c2m-badge teacher">Teacher</span><br><small class="ch-muted">${escapeHtml(t.email)}</small></td><td>${escapeHtml(t.college)}</td><td>${escapeHtml(t.department)}</td>
        <td class="fc-row-actions"><button class="ch-btn line small danger" type="button" data-revoke-teacher="${t.id}">Remove access</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="ch-muted">No teachers yet.</p>'}
    ${settled.length ? `<details class="fc-history"><summary>Settled applications (${settled.length})</summary><div class="fc-apps">${settled.map(a => applicationCard(a, 'teacher')).join('')}</div></details>` : ''}`;
}

function editScope(adminId) {
  const admin = (F.cache.admins || []).find(a => a.id === adminId);
  if (!admin) return;
  openModal({
    title: `Departments for ${admin.name}`, confirmText: 'Save',
    body: `<p class="ch-muted">${escapeHtml(admin.college)}. One department per line.</p><textarea class="ch-textarea" id="scopeLines">${escapeHtml(admin.departments.join('\n'))}</textarea>`,
    onConfirm: async () => {
      const departments = el('scopeLines').value.split('\n').map(s => s.trim()).filter(Boolean);
      await api(`/api/founder/admins/${adminId}/scope`, { method: 'PUT', body: { departments } });
      showToast('Departments saved.');
      renderAdmins();
    }
  });
}

function revoke(kind, userId) {
  openModal({
    title: kind === 'admin' ? 'Remove admin access?' : 'Remove teacher access?', confirmText: 'Remove',
    body: `<label>Reason <small>(they will see it; optional)</small><textarea class="ch-textarea" id="revReason" maxlength="500"></textarea></label>`,
    onConfirm: async () => {
      await api(`/api/founder/${kind === 'admin' ? 'admins' : 'teachers'}/${userId}/revoke`, { method: 'POST', body: { reason: el('revReason').value } });
      showToast('Access removed.');
      switchTab(F.tab);
    }
  });
}

// ==========================================
// 3. VERIFICATION LOG
// ==========================================
function logTable(rows) {
  return `<table class="ch-table"><thead><tr><th>When</th><th>Admin</th><th>Student</th><th>Decision</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr class="${r.reversed ? 'fc-reversed' : ''}"><td><small>${escapeHtml(formatTime(r.at))}</small></td><td>${escapeHtml(r.admin)}</td><td><a class="msg-link" href="profile.html?id=${r.student_id}" target="_blank" rel="noopener">${escapeHtml(r.student)}</a></td>
      <td>${escapeHtml({ approve: 'Approved', reject: 'Rejected', pass: `Passed ${r.from} → ${r.to}`, needs_info: 'Asked for a new photo', reverse: 'Reversed' }[r.action] || r.action)}${r.reason ? `<br><small class="ch-muted">${escapeHtml(r.reason)}</small>` : ''}${r.reversed ? ' <span class="ch-chip">reversed</span>' : ''}</td>
      <td>${!r.reversed && ['approve', 'reject', 'needs_info'].includes(r.action) ? `<button class="ch-btn line small" type="button" data-reverse="${r.id}">Undo</button>` : ''}</td></tr>`).join('')}
  </tbody></table>`;
}

async function showLog(adminId) {
  try {
    const data = await api(`/api/founder/verification-log?admin_id=${adminId}`);
    openModal({ title: 'Verification log', confirmText: 'Close', wide: true, body: `<div class="bl-table" style="max-height:60vh;overflow:auto">${data.log.length ? logTable(data.log) : '<p class="ch-muted">No decisions yet.</p>'}</div>`, onConfirm: async () => {} });
  } catch (err) { showToast(err.message); }
}

async function renderVerification() {
  let data, summary;
  try { [data, summary] = await Promise.all([api('/api/founder/verification-log'), api('/api/verify/summary')]); } catch (err) { return guard(err); }
  el('fcBody').innerHTML = `
    <div class="in-kpis">${[[summary.waiting, 'waiting in total'], [summary.unassigned, 'with no admin for their department'], [summary.needs_info, 'waiting for a new photo']]
      .map(([v, l]) => `<div class="ch-panel in-kpi">${icon('how_to_reg')}<b>${v}</b><span>${l}</span></div>`).join('')}</div>
    <div class="ap-actions"><a class="ch-btn solid" href="verify.html">${icon('fact_check')}Open the Verification desk</a><a class="ch-btn line" href="verify.html" onclick="sessionStorage.setItem('deskTab','unassigned')">Unassigned queue</a></div>
    <div class="ch-bar" style="margin-top:18px"><h2 class="ch-bar-title">Latest decisions<small>${data.log.length}</small></h2></div>
    <div class="ch-panel bl-table">${data.log.length ? logTable(data.log) : '<p class="ch-muted" style="padding:16px">No decisions yet.</p>'}</div>`;
}

// ==========================================
// 4. PLANS AND PAYMENTS
// ==========================================
function paymentsTable(payments, withActions) {
  return `<table class="ch-table"><thead><tr><th>Date</th><th>Who</th><th>Plan</th><th>Amount</th><th>Method</th><th>Status</th>${withActions ? '<th></th>' : ''}</tr></thead><tbody>
    ${payments.map(p => `<tr><td><small>${escapeHtml(formatDate(p.paid_at || p.created_at))}</small></td><td>${escapeHtml(p.name || `User #${p.user_id}`)}</td><td>${escapeHtml(p.plan_name)}</td><td>${inr(p.amount_paise, true)}<br><small class="ch-muted">GST ${inr(p.gst_paise, true)}</small></td>
      <td>${escapeHtml(p.method)}${p.reference ? `<br><small class="ch-muted">${escapeHtml(p.reference)}</small>` : ''}</td><td>${statusChip(p.status)}</td>
      ${withActions ? `<td>${p.status === 'paid' ? `<button class="ch-btn line small" type="button" data-refund="${p.id}">Mark refunded</button>` : ''}</td>` : ''}</tr>`).join('')}
  </tbody></table>`;
}

async function renderPlans(status) {
  let subs, payments;
  try { [subs, payments] = await Promise.all([api(`/api/founder/subscriptions?status=${status === undefined ? 'active' : status}`), api('/api/founder/payments')]); } catch (err) { return guard(err); }
  F.cache.planList = subs.plans;
  el('fcBody').innerHTML = `
    <div class="ch-bar"><h2 class="ch-bar-title">Plans<small>${subs.subscriptions.length}</small></h2>
      <select class="ch-select" id="subStatus" aria-label="Status">${[['active', 'Active'], ['expired', 'Ended'], ['cancelled', 'Cancelled'], ['', 'All']].map(([v, l]) => `<option value="${v}" ${(status === undefined ? 'active' : status) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="ch-btn solid" type="button" data-act="grant">${icon('add_card')}Switch a plan on</button></div>
    ${subs.subscriptions.length ? `<div class="ch-panel bl-table"><table class="ch-table"><thead><tr><th>Plan</th><th>For</th><th>Period</th><th>Dates</th><th>Paid</th><th>Status</th><th></th></tr></thead><tbody>
      ${subs.subscriptions.map(s => `<tr><td>${escapeHtml(s.plan_name)}${s.credits ? `<br><small class="ch-muted">${s.credits} challenge(s) left</small>` : ''}</td>
        <td>${escapeHtml(s.name || s.org_name || s.college_key || '—')}${s.email ? `<br><small class="ch-muted">${escapeHtml(s.email)}</small>` : ''}</td>
        <td>${escapeHtml(PERIOD_LABEL[s.period] || s.period)}${s.years > 1 ? ` × ${s.years}` : ''}<br><small class="ch-muted">${escapeHtml(s.source)}</small></td>
        <td><small>${escapeHtml(formatDate(s.starts_at))} → ${escapeHtml(formatDate(s.ends_at))}</small></td><td>${s.amount_paise ? inr(s.amount_paise) : '—'}</td><td>${statusChip(s.status)}</td>
        <td class="fc-row-actions">${s.status === 'active' ? `<button class="ch-btn line small" type="button" data-extend="${s.id}">Extend</button><button class="ch-btn line small danger" type="button" data-cancel-sub="${s.id}">Cancel</button>` : `<button class="ch-btn line small" type="button" data-extend="${s.id}">Restart</button>`}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="ch-muted">No plans in this list.</p>'}
    <div class="ch-bar" style="margin-top:22px"><h2 class="ch-bar-title">Payments<small>${payments.payments.length}</small></h2></div>
    <div class="ch-panel bl-table">${payments.payments.length ? paymentsTable(payments.payments, true) : '<p class="ch-muted" style="padding:16px">No payments yet.</p>'}</div>`;
}

function grantForm(prefill) {
  const pre = prefill || {};
  const plans = F.cache.planList || [];
  openModal({
    title: 'Switch a plan on', confirmText: 'Switch on', wide: true,
    body: `<p class="ch-muted">For a bank transfer or UPI payment, an agreed business deal, or a gift. Amounts are what was actually paid, before GST for business plans.</p>
      <label>Plan<select class="ch-select" id="gPlan">${plans.map(p => `<option value="${p.key}" data-line="${p.line}" ${p.key === pre.plan_key ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></label>
      <div class="ch-row2" id="gEmailWrap"><label>Account email<input class="ch-input" id="gEmail" type="email" value="${escapeHtml(pre.email || '')}" placeholder="the person's login email"></label>
        <label>or account id <small>(from their profile address, ?id=)</small><input class="ch-input" id="gUserId" type="number" min="1" value="${escapeHtml(pre.user_id || '')}"></label></div>
      <label id="gCollegeWrap" class="ch-hidden">College (exactly as students write it)<input class="ch-input" id="gCollege" value="${escapeHtml(pre.college || '')}"></label>
      <label>Organisation name <small>(optional)</small><input class="ch-input" id="gOrg" value="${escapeHtml(pre.org || '')}"></label>
      <div class="ch-row3"><label>Period<select class="ch-select" id="gPeriod"><option value="">Plan default</option><option value="month">Monthly</option><option value="year">Yearly</option><option value="one_time">One-off</option></select></label>
        <label>Years<select class="ch-select" id="gYears"><option>1</option><option>2</option><option>3</option></select></label>
        <label>Amount paid (₹)<input class="ch-input" id="gAmount" type="number" min="0" step="1" value="0"></label></div>
      <div class="ch-row3"><label>Starts <small>(optional)</small><input class="ch-input" id="gStart" type="date"></label><label>Ends <small>(optional)</small><input class="ch-input" id="gEnd" type="date"></label>
        <label>Payment reference <small>(optional)</small><input class="ch-input" id="gRef" maxlength="120" placeholder="UPI / UTR number"></label></div>
      <div class="ch-row2"><label>Challenges <small>(sponsor plans; empty = plan default)</small><input class="ch-input" id="gCredits" type="number" min="0"></label>
        <label>Seats <small>(recruiter plans; empty = plan default)</small><input class="ch-input" id="gSeats" type="number" min="0"></label></div>
      <label>Internal note <small>(optional)</small><input class="ch-input" id="gNote" maxlength="500"></label>`,
    onOpen: () => {
      const sync = () => {
        const line = el('gPlan').selectedOptions[0].dataset.line;
        el('gCollegeWrap').classList.toggle('ch-hidden', line !== 'institution');
        el('gEmailWrap').classList.toggle('ch-hidden', line === 'institution');
      };
      el('gPlan').addEventListener('change', sync);
      sync();
    },
    onConfirm: async () => {
      const num = (id) => (el(id).value === '' ? null : Number(el(id).value));
      await api('/api/founder/subscriptions', { method: 'POST', body: {
        plan_key: el('gPlan').value, email: el('gEmail').value, user_id: Number(el('gUserId').value) || null, college_name: el('gCollege').value, org_name: el('gOrg').value,
        period: el('gPeriod').value, years: Number(el('gYears').value), amount_rupees: Number(el('gAmount').value) || 0,
        starts_at: el('gStart').value, ends_at: el('gEnd').value, reference: el('gRef').value, note: el('gNote').value,
        credits: num('gCredits'), seats: num('gSeats'), enquiry_id: pre.enquiry_id || null
      } });
      showToast('Plan switched on. They have been told.');
      switchTab(pre.enquiry_id ? 'enquiries' : 'plans');
    }
  });
}

// ==========================================
// 5. ENQUIRIES AND SPONSORED CHALLENGES
// ==========================================
// DPDP Act requests (dpdp.html), grievances and appeals (support.html) and copyright takedowns (copyright.html) have a
// legal reply date; their statuses read as a request, not a sale
const RIGHTS_STATUS = { new: 'New', contacted: 'Replied', won: 'Done', lost: 'Closed' };
const LEGAL_KINDS = { data_rights: 'DPDP request', grievance: 'Grievance', takedown: 'Copyright takedown' };
const isLegal = (e) => e.kind in LEGAL_KINDS;
const isRequest = (e) => isLegal(e) || e.kind === 'support';
const enquiryKind = (e) => LEGAL_KINDS[e.kind] || e.kind;
function replyByHtml(e) {
  if (!isLegal(e) || !e.reply_by) return '';
  const days = Math.ceil((new Date(`${e.reply_by}T23:59:59`) - Date.now()) / 86400000);
  const open = e.status === 'new' || e.status === 'contacted';
  const left = !open ? '' : days < 0 ? ` <span class="ch-chip warn">${-days} days late</span>` : ` <span class="ch-chip ${days <= Math.min(14, e.kind === 'data_rights' ? 14 : 3) ? 'warn' : 'indigo'}">${days} ${days === 1 ? 'day' : 'days'} left</span>`;
  return `<dt>Reply by</dt><dd>${escapeHtml(new Date(`${e.reply_by}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }))}${left}</dd>`;
}

async function renderEnquiries() {
  let data;
  try { [data] = await Promise.all([api('/api/founder/enquiries'), F.cache.planList ? null : api('/api/founder/subscriptions?status=active').then(r => { F.cache.planList = r.plans; })]); } catch (err) { return guard(err); }
  F.cache.enquiries = data.enquiries;
  el('fcBody').innerHTML = `<div class="ch-bar"><h2 class="ch-bar-title">Enquiries and support<small>${data.enquiries.length}</small></h2></div>
    <div class="fc-apps">${data.enquiries.map(e => `<article class="ch-panel fc-app">
      <div class="fc-app-top"><span class="ch-chip ${isLegal(e) ? 'warn' : 'navy'}">${escapeHtml(enquiryKind(e))}</span><h3 style="flex:1">${escapeHtml(e.organisation)}</h3>${isLegal(e) ? `<span class="ch-chip ${(STATUS_CHIPS[e.status] || [''])[0]}">${escapeHtml(RIGHTS_STATUS[e.status] || e.status)}</span>` : statusChip(e.status)}</div>
      <dl class="ap-summary"><dt>Contact</dt><dd>${escapeHtml(e.contact_name)} · <a class="msg-link" href="mailto:${escapeHtml(e.email)}">${escapeHtml(e.email)}</a>${e.phone ? ` · ${escapeHtml(e.phone)}` : ''}</dd>
        ${isRequest(e) ? '' : `<dt>Plan</dt><dd>${escapeHtml(e.plan_name || 'Not sure yet')}</dd><dt>Size</dt><dd>${escapeHtml(e.size || '—')}</dd>`}<dt>Received</dt><dd>${escapeHtml(formatTime(e.created_at))}</dd>${replyByHtml(e)}</dl>
      ${e.message ? `<div class="ap-note">${icon('chat')}<div><p>${linkify(e.message)}</p></div></div>` : ''}
      <div class="ap-actions">
        <select class="ch-select" data-enq-status="${e.id}" aria-label="Status" style="width:auto">${['new', 'contacted', 'won', 'lost'].map(s => `<option value="${s}" ${s === e.status ? 'selected' : ''}>${isLegal(e) ? RIGHTS_STATUS[s] : STATUS_CHIPS[s][1]}</option>`).join('')}</select>
        <input class="ch-input" data-enq-note="${e.id}" value="${escapeHtml(e.founder_note)}" placeholder="Private note" maxlength="1000" style="flex:1;min-width:160px">
        ${e.status !== 'won' && !isRequest(e) ? `<button class="ch-btn solid small" type="button" data-convert="${e.id}">${icon('add_card')}Switch a plan on</button>` : ''}
      </div></article>`).join('') || stateBlock('mail', 'No enquiries yet', 'Colleges, recruiters and sponsors who press “Talk to us” on the Plans page, messages from the Support page and DPDP data-rights requests appear here.')}</div>`;
}

async function renderSponsored() {
  let data;
  try { data = await api('/api/founder/sponsored'); } catch (err) { return guard(err); }
  el('fcBody').innerHTML = `<div class="ch-bar"><h2 class="ch-bar-title">Sponsored challenges<small>${data.challenges.length}</small></h2>
      <a class="ch-btn solid" href="board.html?sponsor=1">${icon('add')}Post a sponsored challenge</a></div>
    ${data.challenges.length ? `<div class="ch-panel bl-table"><table class="ch-table"><thead><tr><th>Challenge</th><th>Sponsor</th><th>Package</th><th>Deadline</th><th>Entries</th><th></th></tr></thead><tbody>
      ${data.challenges.map(c => `<tr><td>${escapeHtml(c.title)}<br><small class="ch-muted">${escapeHtml(c.kind)}${c.prize ? ` · ${escapeHtml(c.prize)}` : ''}</small></td><td>${escapeHtml(c.sponsor)}<br><small class="ch-muted">posted by ${escapeHtml(c.author)}</small></td>
        <td>${escapeHtml(c.tier)}<br><small class="ch-muted">shown until ${escapeHtml(formatDate(c.sponsored_until))}</small></td><td>${escapeHtml(formatDate(c.deadline))}</td><td>${c.submissions}${c.winners_announced ? ' <span class="ch-chip green">Winners out</span>' : ''}</td>
        <td><a class="ch-btn line small" href="board.html?post=${c.id}">Open</a></td></tr>`).join('')}
    </tbody></table></div>` : stateBlock('emoji_events', 'No sponsored challenges yet', 'Post one yourself, or switch on a sponsor package for a company after an enquiry.')}`;
}

// ==========================================
// 5b. SAFETY: REPORTS, SUSPENSIONS, GUARDIANS, RESET LINKS (section 31)
// ==========================================
const REPORT_KIND = { user: 'Person', message: 'Message', team_message: 'Team chat', college_message: 'College chat', board_post: 'Board post', team: 'Team' };
const REPORT_STATUS = { open: ['warn', 'Open'], reviewing: ['indigo', 'Looking at it'], actioned: ['green', 'Action taken'], dismissed: ['', 'No breach'] };

function dueChip(iso, label) {
  const hours = Math.round((new Date(iso) - Date.now()) / 3600000);
  if (hours < 0) return `<span class="ch-chip warn">${escapeHtml(label)} ${Math.ceil(-hours / 24) > 1 ? `${Math.ceil(-hours / 24)} days` : `${-hours} h`} late</span>`;
  return `<span class="ch-chip ${hours <= 24 ? 'warn' : 'indigo'}">${escapeHtml(label)} in ${hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} h`}</span>`;
}

function reportCard(r) {
  const open = r.status === 'open' || r.status === 'reviewing';
  const chip = REPORT_STATUS[r.status] || ['', r.status];
  const removable = ['message', 'team_message', 'college_message', 'board_post'].includes(r.kind);
  return `<article class="ch-panel fc-app">
    <div class="fc-app-top"><span class="ch-chip navy">${escapeHtml(REPORT_KIND[r.kind] || r.kind)}</span><h3 style="flex:1">#${r.id} · ${escapeHtml(r.reason_label)}</h3>
      ${open && r.status === 'open' ? dueChip(r.ack_by, 'Acknowledge') : ''}${open ? dueChip(r.resolve_by, 'Decide') : ''}<span class="ch-chip ${chip[0]}">${escapeHtml(chip[1])}</span></div>
    <dl class="ap-summary">
      <dt>About</dt><dd>${r.target_user_id ? `<a class="msg-link" href="profile.html?id=${r.target_user_id}">${escapeHtml(r.target_name || `Account ${r.target_user_id}`)}</a>` : '—'}${r.earlier_reports ? ` <span class="ch-chip warn">${r.earlier_reports} other ${r.earlier_reports === 1 ? 'report' : 'reports'}</span>` : ''}</dd>
      <dt>Reported by</dt><dd><a class="msg-link" href="profile.html?id=${r.reporter_id}">${escapeHtml(r.reporter_name || `Account ${r.reporter_id}`)}</a></dd>
      <dt>Received</dt><dd>${escapeHtml(formatTime(r.created_at))}</dd>
      ${r.link ? `<dt>Where</dt><dd><a class="msg-link" href="${escapeHtml(r.link)}">Open</a></dd>` : ''}
      ${r.action_taken ? `<dt>Done</dt><dd>${escapeHtml(r.action_taken)} · ${escapeHtml(formatTime(r.resolved_at))}</dd>` : ''}
    </dl>
    ${r.snapshot ? `<div class="ap-note">${icon('format_quote')}<div><b>What was reported (copy kept when it was reported)</b><p>${escapeHtml(r.snapshot)}</p></div></div>` : ''}
    ${r.details ? `<div class="ap-note">${icon('chat')}<div><b>The reporter says</b><p>${escapeHtml(r.details)}</p></div></div>` : ''}
    ${r.founder_note ? `<p class="ch-muted">Your note: ${escapeHtml(r.founder_note)}</p>` : ''}
    ${open ? `<div class="ap-actions">
      ${r.status === 'open' ? `<button class="ch-btn line small" type="button" data-report="${r.id}" data-report-act="review">${icon('visibility')}Acknowledge</button>` : ''}
      <button class="ch-btn line small" type="button" data-report="${r.id}" data-report-act="dismiss">${icon('do_not_disturb_on')}No breach</button>
      <button class="ch-btn line small" type="button" data-report="${r.id}" data-report-act="warn">${icon('warning')}Warn</button>
      ${removable ? `<button class="ch-btn line small" type="button" data-report="${r.id}" data-report-act="remove">${icon('delete')}Remove it</button>` : ''}
      ${r.target_user_id ? `<button class="ch-btn line small danger" type="button" data-report="${r.id}" data-report-act="suspend">${icon('block')}Suspend account</button>` : ''}
    </div>` : ''}
  </article>`;
}

async function renderSafety() {
  let data;
  try { data = await api('/api/founder/safety'); } catch (err) { return guard(err); }
  F.cache.safety = data;
  const open = data.reports.filter(r => r.status === 'open' || r.status === 'reviewing');
  el('fcBody').innerHTML = `
    <div class="ap-note">${icon('gavel')}<div><b>IT Rules 2021, Rule 3(2)</b><p>Acknowledge every report within 24 hours and decide within 15 days. Nudity or impersonation of the person complaining: remove within 24 hours. The reporter is told your decision automatically.</p></div></div>
    <div class="ch-bar"><h2 class="ch-bar-title">Reports<small>${open.length} open · ${data.reports.length} in all</small></h2></div>
    <div class="fc-apps">${data.reports.map(reportCard).join('') || stateBlock('flag', 'No reports yet', 'When someone presses Report on a person, message, post or team, it shows here.')}</div>
    <div class="in-grid" style="margin-top:16px">
      <section class="ch-panel in-card"><h3>Suspended accounts</h3>
        ${data.suspended.map(u => `<div class="in-row"><span><a class="msg-link" href="profile.html?id=${u.id}">${escapeHtml(u.name)}</a><br><small class="ch-muted">${escapeHtml(u.reason)}</small></span><button class="ch-btn line small" type="button" data-unsuspend="${u.id}">Lift</button></div>`).join('') || '<p class="ch-muted">None.</p>'}
      </section>
      <section class="ch-panel in-card"><h3>Under 18, waiting for a guardian</h3>
        ${data.email_ready ? '' : '<p class="ch-muted">Email is not set up, so guardians get no link. Check with the guardian by phone or email yourself, then record their answer here.</p>'}
        ${data.guardian_waiting.map(u => `<div class="in-row"><span>${escapeHtml(u.name)} · ${escapeHtml(u.college)}<br><small class="ch-muted">born ${escapeHtml(u.birth_date)} · guardian ${escapeHtml(u.guardian_email)}</small></span>
          <span><button class="ch-btn line small" type="button" data-guardian="${u.id}" data-guardian-decision="approve">Agreed</button> <button class="ch-btn line small" type="button" data-guardian="${u.id}" data-guardian-decision="decline">Said no</button></span></div>`).join('') || '<p class="ch-muted">None.</p>'}
      </section>
      <section class="ch-panel in-card"><h3>Password reset link</h3>
        <p class="ch-muted">For someone who cannot get email. Check who they are first (for example a photo of their college ID), then send them the link yourself. It works once, for 24 hours.</p>
        <div class="ap-actions"><input class="ch-input" id="resetUserId" type="number" min="1" placeholder="Account number" style="flex:1"><button class="ch-btn solid small" type="button" data-act="reset-link">${icon('key')}Make link</button></div>
      </section>
    </div>`;
}

function decideReport(id, action) {
  const report = (F.cache.safety ? F.cache.safety.reports : []).find(r => r.id === id) || {};
  const words = {
    review: ['Acknowledge this report?', 'It shows as “Looking at it”. Decide within 15 days.', 'Acknowledge'],
    dismiss: ['No breach?', 'The report is closed and the reporter is told it does not break the rules.', 'Close report'],
    warn: ['Warn the person?', `${report.target_name || 'They'} get a notification naming the reason.`, 'Send warning'],
    remove: ['Remove it?', 'Messages are replaced by “removed for breaking the honour code”; a board post is deleted with its applications. The person is told.', 'Remove'],
    suspend: ['Suspend the account?', `${report.target_name || 'The person'} is logged out everywhere, hidden from everyone and cannot log in until you lift it.`, 'Suspend'],
  }[action];
  openModal({ title: words[0], confirmText: words[2],
    body: `<p>${escapeHtml(words[1])}</p><label>Note${action === 'suspend' || action === 'warn' ? ' (shown to them)' : ' (private)'}<input class="ch-input" id="reportNote" maxlength="500"></label>`,
    onConfirm: async () => {
      await api(`/api/founder/reports/${id}`, { method: 'POST', body: { action, note: el('reportNote').value } });
      showToast('Done.');
      renderSafety();
    } });
}

// ==========================================
// 6. EVENTS
// ==========================================
document.querySelector('main').addEventListener('click', (e) => {
  const go = e.target.closest('[data-tab-go]');
  if (go) { el('fcTabs').querySelector(`[data-tab="${go.dataset.tabGo}"]`).click(); return; }
  const b = e.target.closest('button, a');
  if (!b) return;
  const d = b.dataset;
  if (d.act === 'reload') return switchTab(F.tab);
  if (d.report) return decideReport(Number(d.report), d.reportAct);
  if (d.unsuspend) return confirmThen('Lift the suspension?', 'They can log in again and are shown to others.', 'Lift', () => attempt(async () => { await api(`/api/founder/users/${d.unsuspend}/suspend`, { method: 'POST', body: { action: 'unsuspend' } }); renderSafety(); }, 'Suspension lifted.'));
  if (d.guardian) {
    const yes = d.guardianDecision === 'approve';
    return confirmThen(yes ? 'Record that the guardian agreed?' : 'Record that the guardian said no?', yes ? 'Only after you checked with the guardian yourself. The account opens at once.' : 'The account and all its data are erased now. This cannot be undone.', yes ? 'They agreed' : 'Erase account',
      () => attempt(async () => { await api(`/api/founder/guardian/${d.guardian}`, { method: 'POST', body: { decision: d.guardianDecision } }); renderSafety(); }, 'Recorded.'));
  }
  if (d.act === 'reset-link') {
    const id = Number(el('resetUserId').value);
    if (!id) return showToast('Type the account number.');
    return attempt(async () => {
      const r = await api(`/api/founder/reset-link/${id}`, { method: 'POST' });
      openModal({ title: `Reset link for ${r.name}`, confirmText: 'Copy link',
        body: `<p>Send this to them yourself. It works once, for ${r.hours} hours.</p><input class="ch-input" id="resetLink" readonly value="${escapeHtml(r.link)}">`,
        onConfirm: async () => { await navigator.clipboard.writeText(r.link); showToast('Copied.'); } });
    });
  }
  if (d.decide) return decide(d.kind, Number(d.id), d.decide);
  if (d.scope) return editScope(Number(d.scope));
  if (d.log) return showLog(Number(d.log));
  if (d.revokeAdmin) return revoke('admin', Number(d.revokeAdmin));
  if (d.revokeTeacher) return revoke('teacher', Number(d.revokeTeacher));
  if (d.act === 'grant') return grantForm();
  if (d.cancelSub) return confirmThen('Cancel this plan?', 'It stops at once. Nothing is refunded automatically.', 'Cancel plan', () => attempt(async () => { await api(`/api/founder/subscriptions/${d.cancelSub}/cancel`, { method: 'POST' }); renderPlans(); }, 'Plan cancelled.'));
  if (d.extend) {
    return openModal({ title: 'Extend the plan', confirmText: 'Extend', body: '<label>Days to add<input class="ch-input" id="extDays" type="number" min="1" max="1100" value="30"></label>',
      onConfirm: async () => { await api(`/api/founder/subscriptions/${d.extend}/extend`, { method: 'POST', body: { days: Number(el('extDays').value) } }); showToast('Extended.'); renderPlans(); } });
  }
  if (d.refund) return confirmThen('Mark this payment refunded?', 'Do the refund itself in the Razorpay dashboard (or by bank). The plan it paid for is cancelled here.', 'Mark refunded', () => attempt(async () => { await api(`/api/founder/payments/${d.refund}/refund`, { method: 'POST' }); renderPlans(); }, 'Marked refunded.'));
  if (d.convert) {
    const enquiry = (F.cache.enquiries || []).find(x => x.id === Number(d.convert));
    if (enquiry) grantForm({ plan_key: enquiry.plan_key, org: enquiry.organisation, college: enquiry.kind === 'institution' ? enquiry.organisation : '', email: enquiry.kind !== 'institution' ? enquiry.email : '', enquiry_id: enquiry.id });
    return;
  }
  if (d.reverse) {
    return confirmThen('Undo this decision?', 'The account goes back to pending and is reviewed again.', 'Undo', () => attempt(async () => { await api(`/api/founder/verification-log/${d.reverse}/reverse`, { method: 'POST' }); closeModal(); switchTab(F.tab); }, 'Sent back for review.'));
  }
});
el('pgModalBody').addEventListener('click', (e) => {
  const undo = e.target.closest('[data-reverse]');
  if (!undo) return;
  confirmThen('Undo this decision?', 'The account goes back to pending and is reviewed again.', 'Undo', () => attempt(async () => { await api(`/api/founder/verification-log/${undo.dataset.reverse}/reverse`, { method: 'POST' }); closeModal(); switchTab(F.tab); }, 'Sent back for review.'));
});
document.querySelector('main').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'subStatus') return renderPlans(t.value);
  if (t.dataset.enqStatus || t.dataset.enqNote) {
    const id = Number(t.dataset.enqStatus || t.dataset.enqNote);
    const status = document.querySelector(`[data-enq-status="${id}"]`).value;
    const note = document.querySelector(`[data-enq-note="${id}"]`).value;
    attempt(() => api(`/api/founder/enquiries/${id}`, { method: 'PUT', body: { status, note } }), 'Saved.');
  }
});

bindModal();
bindTabs('fcTabs', TABS, switchTab, 'overview');
F.tab = TABS.includes(new URLSearchParams(location.search).get('tab')) ? new URLSearchParams(location.search).get('tab') : 'overview';
switchTab(F.tab);
