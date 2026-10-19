// ==========================================
// EVENT-MANAGE.JS — the organiser dashboard (event-manage.html?id=ID&tab=...). Tabs follow the role inside the event:
// owners and managers get everything, viewers the overview, volunteers are sent to the check-in page.
// Counters update live over the notification socket ("event_stats").
// ==========================================

const MG_TABS = [['overview', 'Overview'], ['registrations', 'Registrations'], ['checkin', 'Check-in'], ['teams', 'Teams'], ['communication', 'Announcements'],
  ['staff', 'Staff'], ['certificates', 'Certificates'], ['settings', 'Settings'], ['audit', 'Activity log']];
const mg = { id: Number(evParam('id')), tab: evParam('tab') || 'overview', ev: null, regs: null, selected: new Set(), filter: { status: '', q: '' } };

async function initManage() {
  if (!mg.id) { el('mgBody').innerHTML = evEmptyHtml('event_busy', 'No event chosen', 'Open an event from My events.', '<a class="ev-btn" href="my-events.html?tab=organising">My events</a>'); return; }
  try { mg.ev = await api(`/api/events/${mg.id}`); }
  catch (err) { el('mgBody').innerHTML = evEmptyHtml('event_busy', 'Event not found', err.message, '<a class="ev-btn is-quiet" href="my-events.html?tab=organising">My events</a>'); return; }
  const role = mg.ev.my_role;
  if (!role) { el('mgBody').innerHTML = evEmptyHtml('lock', 'Only organisers can open this', 'This dashboard is for the people running the event.', `<a class="ev-btn is-quiet" href="event.html?id=${mg.id}">Open the event page</a>`); return; }
  if (role === 'volunteer') { location.replace(`event-checkin.html?id=${mg.id}`); return; }
  document.title = `${mg.ev.title} · Dashboard | Connect2Minds`;
  renderHead();
  renderTabs();
  el('mgTabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) openTab(t.dataset.tab); });
  connectNotifications((data) => {
    if (data.type === 'event_stats' && data.event_id === mg.id) {
      document.querySelectorAll('[data-live="checked_in"]').forEach(n => { n.textContent = data.stats.checked_in; });
      document.querySelectorAll('[data-live="remaining"]').forEach(n => { n.textContent = data.stats.remaining; });
    }
  }, () => openTab(mg.tab));
  openTab(allowedTabs().some(([k]) => k === mg.tab) ? mg.tab : 'overview');
}

const isManager = () => ['owner', 'manager'].includes(mg.ev.my_role);
function allowedTabs() {
  if (!isManager()) return MG_TABS.filter(([k]) => k === 'overview');
  return MG_TABS.filter(([k]) => k !== 'teams' || mg.ev.is_team_event);
}

function renderHead() {
  const ev = mg.ev;
  el('mgTitle').textContent = ev.title;
  el('mgSub').innerHTML = `${evStatusChip(ev.display_status)} ${escapeHtml(evRange(ev.start_at, ev.end_at))}${ev.start_at && new Date(ev.start_at) > Date.now() ? ` · starts ${escapeHtml(evRelative(ev.start_at))}` : ''}`;
  el('mgQuick').innerHTML = `<a href="event.html?id=${ev.id}"><span class="material-symbols-outlined">visibility</span>Event page</a>
    ${isManager() && !['completed', 'archived', 'cancelled', 'removed'].includes(ev.status) ? `<a href="event-create.html?id=${ev.id}"><span class="material-symbols-outlined">edit</span>Edit</a>` : ''}
    <a href="event-checkin.html?id=${ev.id}"><span class="material-symbols-outlined">qr_code_scanner</span>Scanner</a>`;
}

function renderTabs() {
  el('mgTabs').innerHTML = allowedTabs().map(([key, label]) => `<button type="button" role="tab" data-tab="${key}" aria-selected="${mg.tab === key}">${label}</button>`).join('');
}

function openTab(tab) {
  mg.tab = tab;
  history.replaceState(null, '', `event-manage.html?id=${mg.id}&tab=${tab}`);
  renderTabs();
  el('mgBody').innerHTML = '<div class="skeleton" style="height:240px;border-radius:16px"></div>';
  ({ overview: tabOverview, registrations: tabRegistrations, checkin: tabCheckin, teams: tabTeams, communication: tabCommunication, staff: tabStaff,
    certificates: tabCertificates, settings: tabSettings, audit: tabAudit })[tab]().catch(err => {
    el('mgBody').innerHTML = evEmptyHtml('cloud_off', 'Could not load this', err.message, `<button class="ev-btn is-quiet" type="button" onclick="openTab('${tab}')">Try again</button>`);
  });
}

// ---------- overview ----------
async function tabOverview() {
  const ev = mg.ev;
  const o = await api(`/api/events/${mg.id}/overview`);
  const c = o.counts;
  const registered = (c.confirmed || 0) + (c.no_show || 0);
  const steps = { submitted: 'Submitted', teacher: 'Teacher', college_admin: 'College admin', founder: 'Founder' };
  const decisions = { submitted: ['send', 'Submitted'], approved: ['check_circle', 'Approved'], changes: ['edit_note', 'Changes requested'], rejected: ['cancel', 'Rejected'] };
  const sources = Object.entries(o.sources).sort((a, b) => b[1] - a[1]);
  el('mgBody').innerHTML = `
    ${ev.status === 'changes' ? `<div class="ev-note is-warn" style="margin-bottom:14px">${evIcon('edit_note')}<span><b>Changes requested:</b> ${escapeHtml(ev.reviewer_note)} <a href="event-create.html?id=${ev.id}" style="color:#3525cd;font-weight:700">Edit and resubmit</a></span></div>` : ''}
    ${ev.status === 'pending' ? `<div class="ev-note" style="margin-bottom:14px">${evIcon('pending')}<span>Waiting for approval (${escapeHtml((ev.approval_steps || []).map(s => steps[s] || s).join(' then '))}).</span></div>` : ''}
    ${ev.change_status === 'pending' ? `<div class="ev-note" style="margin-bottom:14px">${evIcon('pending')}<span>Your change to ${escapeHtml(Object.keys(ev.pending_changes).join(', '))} is waiting for approval. People still see the old details.</span></div>` : ''}
    <div class="ev-kpis">
      <div class="ev-kpi"><b>${o.views}</b><span>Page views</span></div>
      <div class="ev-kpi"><b>${registered}</b><span>Registered${ev.capacity ? ` of ${ev.capacity}` : ''}</span></div>
      <div class="ev-kpi"><b>${c.waitlisted || 0}</b><span>Waitlist</span></div>
      <div class="ev-kpi"><b>${c.pending || 0}</b><span>To approve</span></div>
      <div class="ev-kpi"><b data-live="checked_in">${o.checkin.checked_in}</b><span>Checked in</span></div>
      <div class="ev-kpi"><b>${c.cancelled || 0}</b><span>Cancelled</span></div>
    </div>
    <div class="ev-layout" style="margin-top:16px">
      <div class="ev-sections">
        <section class="ev-card-pad"><h2>Share it</h2>
          <div class="ev-share-box"><input readonly value="${escapeHtml(ev.share_url)}" aria-label="Share link" id="mgShare"><button type="button" class="ev-btn is-quiet is-small" id="mgCopy">${evIcon('content_copy')}Copy</button></div>
          ${ev.visibility === 'link' ? `<p class="ev-small" style="margin-top:8px">Invite-only: share this link instead: <code>${escapeHtml(`${location.origin}${location.pathname.replace('event-manage.html', 'event.html')}?id=${ev.id}&code=${ev.invite_code}`)}</code></p>` : ''}
          <div class="ev-actions" style="margin-top:10px"><a class="ev-btn is-quiet is-small" href="${escapeHtml(evWhatsApp(ev))}" target="_blank" rel="noopener">${evIcon('share')}WhatsApp</a>
            <a class="ev-btn is-quiet is-small" href="event-print.html?id=${ev.id}&type=poster">${evIcon('qr_code_2')}QR poster</a>
            <a class="ev-btn is-quiet is-small" href="event-print.html?id=${ev.id}&type=attendance">${evIcon('print')}Attendance sheet</a></div>
          <p class="ev-small" style="margin-top:8px">Tip: add <code>&amp;ref=YOURNAME</code> to a link to see how many people came through it.</p></section>
        <section class="ev-card-pad"><h2>Where registrations came from</h2>${sources.length ? `<ul class="ev-todo"><ul>${sources.map(([k, v]) => `<li>${evIcon('call_made')}<span>${escapeHtml(k)}: <b>${v}</b></span></li>`).join('')}</ul></ul>` : '<p class="ev-small">No registrations yet.</p>'}</section>
      </div>
      <aside class="ev-side" style="position:static">
        <section class="ev-card-pad"><h2>To do</h2><ul class="ev-todo"><ul>${o.todo.map(t => `<li>${evIcon(t.done ? 'check_circle' : 'radio_button_unchecked')}<span${t.done ? ' style="color:#464555;text-decoration:line-through"' : ''}>${escapeHtml(t.label)}</span></li>`).join('')}</ul></ul></section>
        <section class="ev-card-pad"><h2>Approvals</h2>${o.approvals.length ? `<ol class="ev-timeline">${o.approvals.map(a => {
          const [icon, label] = decisions[a.decision] || ['info', a.decision];
          return `<li>${evIcon(icon)}<span><b>${label}</b>${a.by ? ` by ${escapeHtml(a.by)}` : ''}${a.step && a.step !== 'submitted' ? ` (${escapeHtml(steps[a.step.replace('changes:', '')] || a.step)})` : ''}${a.comment ? `<br>${escapeHtml(a.comment)}` : ''}<small>${escapeHtml(evWhen(a.at))}</small></span></li>`; }).join('')}</ol>` : '<p class="ev-small">Not submitted yet.</p>'}</section>
      </aside>
    </div>`;
  const copy = el('mgCopy');
  if (copy) copy.addEventListener('click', () => evCopy(ev.share_url));
}

// ---------- registrations ----------
async function tabRegistrations() {
  const params = new URLSearchParams();
  if (mg.filter.status) params.set('status', mg.filter.status);
  if (mg.filter.q) params.set('q', mg.filter.q);
  mg.regs = await api(`/api/events/${mg.id}/registrations?${params}`);
  mg.selected.clear();
  renderRegistrations();
}

const REG_LABELS = { confirmed: 'Confirmed', pending: 'To approve', waitlisted: 'Waitlist', cancelled: 'Cancelled', rejected: 'Rejected', removed: 'Removed', no_show: 'No-show' };
function renderRegistrations() {
  const data = mg.regs;
  const counts = data.counts;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  el('mgBody').innerHTML = `
    <div class="ev-toolbar" style="margin-top:0">
      <label class="ev-search"><span class="material-symbols-outlined" aria-hidden="true">search</span><span class="ev-sr">Search</span><input type="search" id="rgQ" value="${escapeHtml(mg.filter.q)}" placeholder="Name, roll number or email"></label>
      <label><span class="ev-sr">Status</span><select class="ev-select${mg.filter.status ? ' is-set' : ''}" id="rgStatus"><option value="">All (${total})</option>${Object.entries(REG_LABELS).map(([k, l]) => `<option value="${k}" ${mg.filter.status === k ? 'selected' : ''}>${l} (${counts[k] || 0})</option>`).join('')}</select></label>
      <a class="ev-btn is-quiet" href="${API_BASE}/api/events/${mg.id}/registrations?format=csv${mg.filter.status ? `&status=${mg.filter.status}` : ''}" id="rgCsv">${evIcon('download')}Download CSV</a>
      <button type="button" class="ev-btn is-quiet" id="rgAdd">${evIcon('person_add')}Add someone</button>
    </div>
    <div class="ev-bulk" id="rgBulk" hidden><span id="rgCount"></span>
      <button type="button" class="ev-btn is-small" data-bulk="approve">Approve</button><button type="button" class="ev-btn is-quiet is-small" data-bulk="waitlist">Move to waitlist</button>
      <button type="button" class="ev-btn is-quiet is-small" data-bulk="reject">Reject</button><button type="button" class="ev-btn is-danger is-small" data-bulk="remove">Remove</button></div>
    ${data.registrations.length ? `<div class="ev-table-wrap"><table class="ev-table"><thead><tr><th><input type="checkbox" id="rgAll" aria-label="Select all"></th><th>Name</th><th>Status</th><th>Checked in</th>${mg.ev.is_team_event ? '<th>Team</th>' : ''}<th>Registered</th><th></th></tr></thead>
      <tbody>${data.registrations.map(r => `<tr data-rid="${r.id}"><td><input type="checkbox" data-pick="${r.id}" aria-label="Select ${escapeHtml(r.name)}"></td>
        <td><b>${escapeHtml(r.name)}</b><br><span class="ev-small">${escapeHtml([r.department, r.college].filter(Boolean).join(' · '))}</span></td>
        <td>${evMyChip(r.status)}</td><td>${r.checked_in_at ? escapeHtml(evTime(r.checked_in_at)) : '–'}</td>${mg.ev.is_team_event ? `<td>${escapeHtml(r.team || '–')}</td>` : ''}
        <td>${escapeHtml(evDay(r.created_at))}</td><td><button type="button" class="ev-btn is-quiet is-small" data-open="${r.id}">Details</button></td></tr>`).join('')}</tbody></table></div>`
      : evEmptyHtml('group_off', 'Nobody here yet', mg.filter.status || mg.filter.q ? 'No one matches these filters.' : 'Share the event to get registrations.', '')}`;
  let typing = null;
  el('rgQ').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { mg.filter.q = el('rgQ').value.trim(); tabRegistrations(); }, 350); });
  el('rgStatus').addEventListener('change', () => { mg.filter.status = el('rgStatus').value; tabRegistrations(); });
  el('rgAdd').addEventListener('click', addSomeone);
  const all = el('rgAll');
  if (all) all.addEventListener('change', () => { document.querySelectorAll('[data-pick]').forEach(b => { b.checked = all.checked; toggleRow(b); }); updateBulk(); });
  document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('change', () => { toggleRow(b); updateBulk(); }));
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openPerson(Number(b.dataset.open))));
  document.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => bulk(b.dataset.bulk)));
}
function toggleRow(box) { const id = Number(box.dataset.pick); if (box.checked) mg.selected.add(id); else mg.selected.delete(id); box.closest('tr').classList.toggle('is-selected', box.checked); }
function updateBulk() { el('rgBulk').hidden = !mg.selected.size; el('rgCount').textContent = `${mg.selected.size} selected`; }

function bulk(action) {
  const needsReason = action === 'reject' || action === 'remove';
  const labels = { approve: 'Approve', waitlist: 'Move to the waitlist', reject: 'Reject', remove: 'Remove' };
  const { box, close } = evDialog(`${labels[action]} ${mg.selected.size} ${mg.selected.size === 1 ? 'person' : 'people'}?`,
    `<p class="ev-small" style="font-size:15px">They are told by a notification.${action === 'approve' && mg.ev.capacity ? ' Approving past the seat limit needs a reason.' : ''}</p>
     <label class="ev-field"><span class="ev-label">Reason ${needsReason ? '(shown to them)' : '(optional)'}</span><textarea id="bkReason" maxlength="300" style="min-height:70px"></textarea></label><p class="ev-form-error" id="bkError"></p>`,
    `<button type="button" class="ev-btn is-quiet" data-ev-close>Cancel</button><button type="button" class="ev-btn${action === 'remove' || action === 'reject' ? ' is-danger' : ''}" id="bkGo">${labels[action]}</button>`);
  box.querySelector('#bkGo').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const result = await api(`/api/events/${mg.id}/registrations`, { method: 'PATCH', body: { ids: [...mg.selected], action, reason: box.querySelector('#bkReason').value } });
      close();
      evToast(`${result.changed} updated.`);
      tabRegistrations();
    } catch (err) { const n = box.querySelector('#bkError'); n.textContent = err.message; n.classList.add('is-shown'); e.target.disabled = false; }
  });
}

function openPerson(id) {
  const r = mg.regs.registrations.find(x => x.id === id);
  const questions = mg.regs.questions || [];
  const labels = { name: 'Name', email: 'Email', phone: 'Phone', college: 'College', department: 'Department', year: 'Year', roll_no: 'Roll number', skills: 'Skills' };
  const answer = (q) => {
    const value = r.answers[q.key];
    if (value === undefined || value === '') return '–';
    if (q.type === 'file') return (value || []).map(name => `<a href="${API_BASE}/api/events/${mg.id}/files/${encodeURIComponent(name)}" target="_blank" rel="noopener">Open file</a>`).join(', ');
    if (Array.isArray(value)) return escapeHtml(value.join(', '));
    if (value === true) return 'Yes';
    return escapeHtml(String(value));
  };
  const drawer = document.createElement('div');
  drawer.className = 'ev-overlay';
  drawer.style.justifyContent = 'flex-end';
  drawer.style.padding = '0';
  drawer.innerHTML = `<aside class="ev-drawer" role="dialog" aria-modal="true" aria-label="${escapeHtml(r.name)}"><div class="ev-dialog-head"><h2>${escapeHtml(r.name)}</h2><button type="button" class="ev-iconbtn" data-close aria-label="Close">${evIcon('close')}</button></div>
    <div class="ev-drawer-body">${evMyChip(r.status)}
      <dl class="ev-dl">${Object.entries(r.profile || {}).map(([k, v]) => `<dt>${labels[k] || escapeHtml(k)}</dt><dd>${escapeHtml(v || '–')}</dd>`).join('')}
        ${questions.map(q => `<dt>${escapeHtml(q.label)}</dt><dd>${answer(q)}</dd>`).join('')}
        <dt>Registered</dt><dd>${escapeHtml(evWhen(r.created_at))}</dd>${r.checked_in_at ? `<dt>Checked in</dt><dd>${escapeHtml(evWhen(r.checked_in_at))}</dd>` : ''}
        ${r.team ? `<dt>Team</dt><dd>${escapeHtml(r.team)}</dd>` : ''}${r.ref_code ? `<dt>Came through</dt><dd>${escapeHtml(r.ref_code)}</dd>` : ''}${r.note ? `<dt>Note</dt><dd>${escapeHtml(r.note)}</dd>` : ''}
        <dt>Sponsors may contact</dt><dd>${r.consents && r.consents.sponsors ? 'Yes' : 'No'}</dd></dl>
      <div class="ev-actions"><a class="ev-btn is-quiet is-small" href="profile.html?id=${r.user_id}">${evIcon('person')}Profile</a><a class="ev-btn is-quiet is-small" href="inbox.html?user=${r.user_id}">${evIcon('chat')}Message</a></div>
    </div></aside>`;
  const close = () => { drawer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  drawer.addEventListener('click', (e) => { if (e.target === drawer || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(drawer);
  drawer.querySelector('[data-close]').focus();
}

function addSomeone() {
  const { box, close } = evDialog('Add someone by hand', `<p class="ev-small">For a late registration or a guest. They must have an account. The reason goes to the activity log.</p>
    <label class="ev-field"><span class="ev-label">Find the person</span><input id="adQ" placeholder="Name, roll number or email" autocomplete="off"></label><div id="adPeople" style="display:flex;flex-direction:column;gap:6px"></div>
    <label class="ev-field"><span class="ev-label">Reason</span><input id="adReason" maxlength="300" placeholder="e.g. Registered on paper"></label><p class="ev-form-error" id="adError"></p>`, '');
  let typing = null, picked = null;
  box.querySelector('#adQ').addEventListener('input', (e) => {
    clearTimeout(typing);
    typing = setTimeout(async () => {
      const data = await api(`/api/events/${mg.id}/walkin-search?q=${encodeURIComponent(e.target.value)}`).catch(() => ({ people: [] }));
      box.querySelector('#adPeople').innerHTML = data.people.map(p => `<button type="button" class="ev-btn is-quiet" data-add="${p.id}" style="justify-content:flex-start">${evFaceHtml(p, 28)} ${escapeHtml(p.name)} <span class="ev-small">${escapeHtml(p.college)}</span></button>`).join('') || '<p class="ev-small">Nobody found who is not registered yet.</p>';
      box.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', async () => {
        picked = Number(b.dataset.add);
        try {
          await api(`/api/events/${mg.id}/registrations/add`, { method: 'POST', body: { user_id: picked, reason: box.querySelector('#adReason').value } });
          close();
          evToast('Added. They got their ticket.');
          tabRegistrations();
        } catch (err) { const n = box.querySelector('#adError'); n.textContent = err.message; n.classList.add('is-shown'); }
      }));
    }, 300);
  });
}

// ---------- check-in ----------
async function tabCheckin() {
  const stats = await api(`/api/events/${mg.id}/checkin/stats`);
  el('mgBody').innerHTML = `<div class="ev-kpis"><div class="ev-kpi"><b>${stats.registered}</b><span>Registered</span></div><div class="ev-kpi"><b data-live="checked_in">${stats.checked_in}</b><span>Checked in</span></div>
    <div class="ev-kpi"><b data-live="remaining">${stats.remaining}</b><span>Not yet</span></div></div>
    <section class="ev-card-pad" style="margin-top:16px"><h2>Running the door</h2>
      <ol style="margin:0 0 12px 18px;list-style:decimal;font:400 14px/22px Inter,sans-serif;color:#0b1c30"><li>Add volunteers on the Staff tab. They only see the scanner.</li><li>Open the scanner on a phone and allow the camera.</li>
      <li>No internet at the venue? Scans are kept on the phone and sent later. The printed sheet is the last resort.</li></ol>
      <div class="ev-actions"><a class="ev-btn" href="event-checkin.html?id=${mg.id}">${evIcon('qr_code_scanner')}Open the scanner</a><a class="ev-btn is-quiet" href="event-print.html?id=${mg.id}&type=attendance">${evIcon('print')}Attendance sheet</a></div>
      <p class="ev-small" style="margin-top:10px">Check-in opens an hour before the start. People who were confirmed but never checked in are marked as no-shows when the event ends.</p></section>`;
}

// ---------- teams ----------
async function tabTeams() {
  const data = await api(`/api/events/${mg.id}/teams`);
  const teams = data.teams || [];
  el('mgBody').innerHTML = `<p class="ev-small" style="margin-bottom:12px">Teams of ${data.team_min} to ${data.team_max}. Teams lock when registration closes; leaders of teams that are too small are told.</p>
    ${teams.length ? `<div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Team</th><th>Members</th><th>Size</th><th>Status</th></tr></thead><tbody>${teams.map(t => `<tr><td><b>${escapeHtml(t.name)}</b></td>
      <td>${t.members.map(m => escapeHtml(m.name) + (m.id === t.leader_id ? ' (leader)' : '')).join(', ')}</td><td>${t.size}${t.size < t.min ? ` <span class="ev-chip is-warn">Too small</span>` : ''}</td><td>${t.locked ? 'Locked' : 'Open'}</td></tr>`).join('')}</tbody></table></div>`
      : evEmptyHtml('groups', 'No teams yet', 'Registered people make or join teams on the event page.', '')}
    ${data.looking.length ? `<section class="ev-card-pad" style="margin-top:16px"><h2>Looking for a team (${data.looking.length})</h2><p class="ev-small">${data.looking.map(p => escapeHtml(p.name)).join(', ')}</p></section>` : ''}`;
}

// ---------- announcements ----------
async function tabCommunication() {
  const ev = await api(`/api/events/${mg.id}`);
  mg.ev = ev;
  const list = ev.announcements || [];
  el('mgBody').innerHTML = `<div class="ev-layout" style="margin-top:0"><div class="ev-sections">
    <section class="ev-card-pad"><h2>New announcement</h2><form id="anForm" style="display:flex;flex-direction:column;gap:12px" novalidate>
      <label class="ev-field"><span class="ev-label">Title <span class="ev-req">*</span></span><input id="anTitle" maxlength="120" required placeholder="e.g. Room changed to Seminar Hall 2"></label>
      <label class="ev-field"><span class="ev-label">Message</span><textarea id="anBody" maxlength="2000"></textarea></label>
      <div class="ev-row2"><label class="ev-field"><span class="ev-label">Send to</span><select id="anAudience"><option value="all">Everyone registered</option><option value="confirmed">Confirmed</option><option value="waitlisted">Waitlist</option><option value="pending">Waiting for approval</option><option value="checked_in">Checked in</option><option value="not_checked_in">Not checked in yet</option></select></label>
        <label class="ev-field"><span class="ev-label">Send at (optional)</span><input type="datetime-local" id="anWhen"></label></div>
      <div class="ev-chiprow"><label><input type="checkbox" id="anPush" checked>Push to phones</label><label><input type="checkbox" id="anEmail">Email</label><label><input type="checkbox" id="anPin">Pin on the event page</label></div>
      <p class="ev-form-error" id="anError" role="alert"></p><button type="submit" class="ev-btn" style="align-self:flex-start">${evIcon('campaign')}Send</button>
      <p class="ev-small">Every announcement also goes to the bell. Reminders 24 hours and 1 hour before the start are sent automatically.</p></form></section></div>
    <aside class="ev-side" style="position:static"><section class="ev-card-pad"><h2>Sent and scheduled</h2>${list.length ? list.map(a => `<div class="ev-announce"><b>${escapeHtml(a.title)}</b>${a.pinned ? ` <span class="ev-chip">${evIcon('push_pin')}Pinned</span>` : ''}
      ${a.body ? `<p>${escapeHtml(a.body)}</p>` : ''}<small>${a.sent_at ? `Sent ${escapeHtml(evWhen(a.sent_at))} to ${a.recipients}` : `Scheduled for ${escapeHtml(evWhen(a.send_at))}`}</small>
      <div class="ev-actions" style="margin-top:6px"><button type="button" class="ev-btn is-quiet is-small" data-pin="${a.id}" data-pinned="${a.pinned}">${a.pinned ? 'Unpin' : 'Pin'}</button><button type="button" class="ev-btn is-danger is-small" data-del-ann="${a.id}">Delete</button></div></div>`).join('') : '<p class="ev-small">Nothing sent yet.</p>'}</section></aside></div>`;
  el('anForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = el('anError');
    error.classList.remove('is-shown');
    const channels = [el('anPush').checked ? 'push' : '', el('anEmail').checked ? 'email' : ''].filter(Boolean);
    try {
      const result = await api(`/api/events/${mg.id}/announcements`, { method: 'POST', body: { title: el('anTitle').value, body: el('anBody').value, audience: el('anAudience').value,
        channels, pinned: el('anPin').checked, send_at: evFromInput(el('anWhen').value) } });
      evToast(result.scheduled_for ? `Scheduled for ${evWhen(result.scheduled_for)}.` : 'Sent.');
      tabCommunication();
    } catch (err) { error.textContent = err.message; error.classList.add('is-shown'); }
  });
  document.querySelectorAll('[data-pin]').forEach(b => b.addEventListener('click', async () => {
    try { await api(`/api/events/${mg.id}/announcements/${b.dataset.pin}?pinned=${b.dataset.pinned !== 'true'}`, { method: 'PATCH' }); tabCommunication(); } catch (err) { evToast(err.message); }
  }));
  document.querySelectorAll('[data-del-ann]').forEach(b => b.addEventListener('click', async () => {
    try { await api(`/api/events/${mg.id}/announcements/${b.dataset.delAnn}`, { method: 'DELETE' }); tabCommunication(); } catch (err) { evToast(err.message); }
  }));
}

// ---------- staff ----------
const ROLE_TEXT = { owner: 'Everything, including staff and deleting', manager: 'Edit, approve, announce, export, certificates', volunteer: 'Check-in only (names and status)', viewer: 'Sees the numbers' };
async function tabStaff() {
  const data = await api(`/api/events/${mg.id}/staff`);
  const owner = mg.ev.my_role === 'owner';
  el('mgBody').innerHTML = `<section class="ev-card-pad"><h2>People running this event</h2>
    <div style="display:flex;flex-direction:column;gap:10px">${data.staff.map(s => `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${evFaceHtml(s, 36)}
      <span style="flex:1;min-width:160px"><b>${escapeHtml(s.name)}</b><br><span class="ev-small">${escapeHtml(s.role)} · ${escapeHtml(ROLE_TEXT[s.role] || '')}</span></span>
      ${owner && s.role === 'manager' ? `<button type="button" class="ev-btn is-quiet is-small" data-transfer="${s.id}">Make owner</button>` : ''}
      ${owner && s.role !== 'owner' ? `<button type="button" class="ev-btn is-danger is-small" data-remove="${s.id}">Remove</button>` : ''}</div>`).join('')}</div></section>
    ${owner ? `<section class="ev-card-pad" style="margin-top:16px"><h2>Add someone</h2><form id="stForm" class="ev-row2" novalidate>
      <label class="ev-field"><span class="ev-label">Their account email</span><input type="email" id="stEmail" required placeholder="name@college.edu"></label>
      <label class="ev-field"><span class="ev-label">Role</span><select id="stRole"><option value="volunteer">Volunteer: check-in only</option><option value="manager">Manager: runs the event with you</option><option value="viewer">Viewer: sees the numbers</option></select></label>
      <div style="grid-column:1/-1"><p class="ev-form-error" id="stError" role="alert"></p><button class="ev-btn" type="submit">${evIcon('person_add')}Add</button></div></form></section>`
      : '<p class="ev-small" style="margin-top:12px">Only the owner adds or removes staff.</p>'}`;
  const form = el('stForm');
  if (form) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/events/${mg.id}/staff`, { method: 'POST', body: { email: el('stEmail').value.trim(), role: el('stRole').value } }); evToast('Added and told.'); tabStaff(); }
    catch (err) { el('stError').textContent = err.message; el('stError').classList.add('is-shown'); }
  });
  document.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => { try { await api(`/api/events/${mg.id}/staff/${b.dataset.remove}`, { method: 'DELETE' }); tabStaff(); } catch (err) { evToast(err.message); } }));
  document.querySelectorAll('[data-transfer]').forEach(b => b.addEventListener('click', () => {
    const { box, close } = evDialog('Make them the owner?', '<p class="ev-small" style="font-size:15px">You stay on as a manager. Only the owner can add staff or delete the event.</p>',
      '<button type="button" class="ev-btn is-quiet" data-ev-close>Cancel</button><button type="button" class="ev-btn" id="trYes">Transfer</button>');
    box.querySelector('#trYes').addEventListener('click', async () => { try { await api(`/api/events/${mg.id}/transfer`, { method: 'POST', body: { user_id: Number(b.dataset.transfer) } }); close(); location.reload(); } catch (err) { evToast(err.message); } });
  }));
}

// ---------- certificates ----------
async function tabCertificates() {
  const data = await api(`/api/events/${mg.id}/certificates`);
  const started = mg.ev.start_at && new Date(mg.ev.start_at) < Date.now();
  el('mgBody').innerHTML = `<section class="ev-card-pad"><h2>Participation certificates</h2>
    <p class="ev-small" style="margin-bottom:10px">Everyone who checked in gets one with a unique code anyone can check online. ${mg.ev.certificates_on ? 'They are also issued automatically when the event ends.' : 'Automatic certificates are off for this event.'}</p>
    <div class="ev-actions"><button type="button" class="ev-btn" id="ctGo" ${started ? '' : 'disabled'}>${evIcon('workspace_premium')}Issue to everyone checked in</button>
      ${data.certificates.length ? `<a class="ev-btn is-quiet" href="event-print.html?id=${mg.id}&type=certificates">${evIcon('print')}Print all</a>` : ''}</div>
    ${started ? '' : '<p class="ev-small" style="margin-top:8px">Available once the event has started.</p>'}</section>
    ${data.certificates.length ? `<div class="ev-table-wrap" style="margin-top:16px"><table class="ev-table"><thead><tr><th>Name</th><th>Code</th><th>Issued</th><th></th></tr></thead><tbody>${data.certificates.map(c => `<tr>
      <td>${escapeHtml(c.holder_name)}</td><td><code>${escapeHtml(c.code)}</code>${c.revoked ? ' <span class="ev-chip is-bad">Revoked</span>' : ''}</td><td>${escapeHtml(evDay(c.issued_at))}</td>
      <td>${c.revoked ? '' : `<button type="button" class="ev-btn is-danger is-small" data-revoke="${c.id}">Revoke</button>`}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
  el('ctGo').addEventListener('click', async () => { try { const r = await api(`/api/events/${mg.id}/certificates/generate`, { method: 'POST' }); evToast(`${r.issued} new certificate${r.issued === 1 ? '' : 's'} issued.`); tabCertificates(); } catch (err) { evToast(err.message); } });
  document.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', async () => { try { await api(`/api/events/${mg.id}/certificates/${b.dataset.revoke}/revoke`, { method: 'POST' }); tabCertificates(); } catch (err) { evToast(err.message); } }));
}

// ---------- settings ----------
async function tabSettings() {
  const ev = mg.ev;
  const live = ['published', 'pending', 'changes', 'draft'].includes(ev.status);
  el('mgBody').innerHTML = `<div class="ev-sections">
    <section class="ev-card-pad"><h2>Edit the event</h2><p class="ev-small" style="margin-bottom:10px">Change the details, the form, the agenda and more.</p>
      <div class="ev-actions">${live ? `<a class="ev-btn" href="event-create.html?id=${ev.id}">${evIcon('edit')}Edit details</a>` : ''}<button type="button" class="ev-btn is-quiet" id="stDup">${evIcon('content_copy')}Duplicate</button>
      ${ev.status === 'published' && ev.reg_close_at && new Date(ev.reg_close_at) > Date.now() ? `<button type="button" class="ev-btn is-quiet" id="stClose">${evIcon('block')}Close registration now</button>` : ''}</div></section>
    ${live ? `<section class="ev-card-pad"><h2>Cancel the event</h2><p class="ev-small" style="margin-bottom:10px">Everyone registered is told at once, by bell, push and email.</p>
      <button type="button" class="ev-btn is-danger" id="stCancel">${evIcon('event_busy')}Cancel event</button></section>` : ''}
    ${ev.my_role === 'owner' ? `<section class="ev-card-pad"><h2>Delete</h2><p class="ev-small" style="margin-bottom:10px">Removes it from the site. Registrations and the activity log are kept. A published event with people registered must be cancelled first.</p>
      <button type="button" class="ev-btn is-danger" id="stDelete">${evIcon('delete')}Delete event</button></section>` : ''}</div>`;
  el('stDup').addEventListener('click', async () => { try { const r = await api(`/api/events/${mg.id}/duplicate`, { method: 'POST' }); location.href = `event-create.html?id=${r.id}`; } catch (err) { evToast(err.message); } });
  const closeReg = el('stClose');
  if (closeReg) closeReg.addEventListener('click', async () => {
    try { await api(`/api/events/${mg.id}`, { method: 'PATCH', body: { updated_at: ev.updated_at, reg_close_at: new Date(Date.now() + 60000).toISOString() } }); evToast('Registration closes in a minute.'); location.reload(); }
    catch (err) { evToast(err.message); }
  });
  const cancel = el('stCancel');
  if (cancel) cancel.addEventListener('click', () => {
    const { box, close } = evDialog('Cancel this event?', `<label class="ev-field"><span class="ev-label">Reason (shown to everyone registered)</span><textarea id="cnReason" maxlength="500"></textarea></label><p class="ev-form-error" id="cnError"></p>`,
      '<button type="button" class="ev-btn is-quiet" data-ev-close>Keep it</button><button type="button" class="ev-btn is-danger" id="cnYes">Cancel event</button>');
    box.querySelector('#cnYes').addEventListener('click', async () => {
      try { const r = await api(`/api/events/${mg.id}/cancel`, { method: 'POST', body: { reason: box.querySelector('#cnReason').value } }); close(); evToast(`Cancelled. ${r.told} people were told.`); location.reload(); }
      catch (err) { const n = box.querySelector('#cnError'); n.textContent = err.message; n.classList.add('is-shown'); }
    });
  });
  const del = el('stDelete');
  if (del) del.addEventListener('click', () => {
    const { box, close } = evDialog('Delete this event?', '<p class="ev-small" style="font-size:15px">It disappears from the site. This cannot be undone here.</p>',
      '<button type="button" class="ev-btn is-quiet" data-ev-close>Keep it</button><button type="button" class="ev-btn is-danger" id="dlYes">Delete</button>');
    box.querySelector('#dlYes').addEventListener('click', async () => { try { await api(`/api/events/${mg.id}`, { method: 'DELETE' }); close(); location.href = 'my-events.html?tab=organising'; } catch (err) { evToast(err.message); close(); } });
  });
}

// ---------- activity log ----------
const AUDIT_TEXT = { created: 'created the event', edited: 'edited', submitted: 'sent it for approval', published: 'published it', cancelled: 'cancelled it', deleted: 'deleted it',
  registered: 'registered', cancelled_registration: 'cancelled their registration', exported_registrations: 'downloaded the registrations', opened_file: 'opened an uploaded file',
  announcement: 'sent an announcement', staff_added: 'added staff', staff_removed: 'removed staff', ownership_transferred: 'transferred ownership', walk_in: 'checked in a walk-in',
  check_in_undone: 'undid a check-in', certificates_issued: 'issued certificates', certificate_revoked: 'revoked a certificate', waitlist_promoted: 'moved people up from the waitlist',
  edit_held_for_approval: 'made a change that waits for approval', team_created: 'created a team', completed: 'the event ended', added_by_hand: 'added someone by hand',
  duplicated: 'duplicated an event', ticket_renewed: 'got a new ticket code', featured: 'featured it', unfeatured: 'stopped featuring it', unpublished: 'took it down' };
async function tabAudit() {
  const data = await api(`/api/events/${mg.id}/audit`);
  el('mgBody').innerHTML = `<section class="ev-card-pad"><h2>Activity log</h2><p class="ev-small" style="margin-bottom:12px">Who changed or downloaded what, and when. Kept even if the event is deleted.</p>
    ${data.log.length ? `<ol class="ev-timeline">${data.log.map(a => `<li>${evIcon(a.action.includes('export') || a.action === 'opened_file' ? 'download' : 'history')}<span><b>${escapeHtml(a.actor)}</b> ${escapeHtml(AUDIT_TEXT[a.action] || a.action.replace(/_/g, ' '))}
      ${a.details && a.details.fields ? `<span class="ev-small">(${escapeHtml(a.details.fields.join(', '))})</span>` : ''}${a.details && a.details.rows !== undefined ? `<span class="ev-small">(${a.details.rows} rows)</span>` : ''}<small>${escapeHtml(evWhen(a.at))}</small></span></li>`).join('')}</ol>` : '<p class="ev-small">Nothing yet.</p>'}</section>`;
}

initManage();
