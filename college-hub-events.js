// ==========================================
// COLLEGE-HUB-EVENTS.JS — College Hub's link to the Events module (events.py):
//   * the Events tab for teachers: events and host requests from students of this college waiting for a decision
//   * published events of this college on the Calendar tab (they open the event page)
// Loaded after college-hub-calendar.js and before college-hub.js (hubActions, openHubModal, icon, escapeHtml).
// ==========================================

let hubPlatformEvents = [];          // calendar items made from published events of this college
let hubPlatformLoadedAt = 0;
let hubApprovals = null;

const HUB_TZ_PARTS = (iso) => {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).forEach(p => { parts[p.type] = p.value; });
  return parts;
};

// ---------- the calendar ----------
async function loadPlatformEvents() {
  if (Date.now() - hubPlatformLoadedAt < 60000) return;
  hubPlatformLoadedAt = Date.now();
  try {
    const data = await api('/api/events?tab=all&college=mine&size=60&sort=soonest');
    hubPlatformEvents = data.events.filter(ev => ev.start_at && ev.status !== 'cancelled').map(ev => {
      const start = HUB_TZ_PARTS(ev.start_at), end = ev.end_at ? HUB_TZ_PARTS(ev.end_at) : null;
      return { source: 'platform', key: `platform-${ev.id}`, kind: 'event', id: ev.id, title: ev.title, date: `${start.year}-${start.month}-${start.day}`,
        start_time: `${start.hour}:${start.minute}`, end_time: end ? `${end.hour}:${end.minute}` : '', location: ev.mode === 'online' ? 'Online' : ev.venue,
        department: ev.visibility === 'department' ? ev.department : '', division: '', details: ev.tagline || '' };
    });
    if (view.tab === 'calendar') renderCalendar();
  } catch (e) { /* the calendar still shows the hub's own dates */ }
}

// ---------- the Events tab (teachers) ----------
async function renderEventsTab() {
  el('eventsBar').innerHTML = `<h2 class="ch-bar-title">Events to approve<small>Student events of your college go live after a teacher approves them</small></h2>
    <a class="ch-btn line" href="events.html">${icon('event')}All events</a><a class="ch-btn solid" href="event-create.html">${icon('add')}Create an event</a>`;
  el('eventsBody').innerHTML = '<div class="ch-panel"><p>Loading...</p></div>';
  try { hubApprovals = await api('/api/events/approvals'); }
  catch (err) { el('eventsBody').innerHTML = `<div class="ch-panel"><p>${escapeHtml(err.message)}</p></div>`; return; }
  const events = hubApprovals.events, hosts = hubApprovals.hosts;
  const stepNames = { teacher: 'Teacher approval', college_admin: 'College admin approval', founder: 'Founder approval' };
  const when = (iso) => iso ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : 'No date yet';
  el('eventsBody').innerHTML = `
    ${!events.length && !hosts.length ? `<div class="ch-panel ch-empty"><span class="material-symbols-outlined">task_alt</span><h3>Nothing waiting</h3><p>When a student submits an event or asks to create a club, it shows up here.</p></div>` : ''}
    ${events.map(item => {
      const ev = item.card;
      const changes = Object.keys(item.pending_changes || {});
      return `<div class="ch-panel" style="margin-bottom:14px">
        <div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
          <div><span class="ch-chip indigo">${icon('pending')}${escapeHtml(stepNames[item.step] || item.step)}${item.kind === 'edit' ? ' · change to a live event' : ''}</span>
            <h3 style="margin:8px 0 4px">${escapeHtml(ev.title)}</h3>
            <p class="ch-muted" style="margin:0">${escapeHtml(when(ev.start_at))} · ${escapeHtml(ev.mode === 'online' ? 'Online' : ev.venue || 'No venue yet')} · ${escapeHtml({ public: 'Everyone', college: 'This college', department: 'One department', link: 'Invite link only' }[item.visibility] || item.visibility)}
              · by ${escapeHtml(item.organiser ? item.organiser.name : 'a student')}</p>
            ${changes.length ? `<p style="margin:6px 0 0"><b>Wants to change:</b> ${changes.map(escapeHtml).join(', ')}</p>` : ''}
            ${item.missing.length ? `<p style="margin:6px 0 0;color:#ba1a1a">Missing: ${item.missing.map(escapeHtml).join('; ')}</p>` : ''}</div>
          <a class="ch-btn line small" href="event.html?id=${ev.id}" target="_blank" rel="noopener">${icon('visibility')}Open</a></div>
        <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Description</summary><p class="ch-post-body" style="white-space:pre-line">${escapeHtml(item.description || '')}</p></details>
        <div class="ch-review-actions" style="margin-top:12px">
          <button class="ch-btn solid small" type="button" data-act="ev-decide" data-id="${ev.id}" data-decision="approve">${icon('check')}Approve</button>
          <button class="ch-btn line small" type="button" data-act="ev-decide" data-id="${ev.id}" data-decision="changes">${icon('edit_note')}Ask for changes</button>
          <button class="ch-btn line small danger" type="button" data-act="ev-decide" data-id="${ev.id}" data-decision="reject">${icon('block')}Reject</button></div></div>`;
    }).join('')}
    ${hosts.length ? `<div class="ch-panel"><h3>Requests to create a host</h3>${hosts.map(h => `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 0;border-top:1px solid #e2e8f0">
      <span><b>${escapeHtml(h.name)}</b> <span class="ch-muted">(${escapeHtml(h.kind)}) by ${escapeHtml(h.requested_by ? h.requested_by.name : 'a student')}</span><br><span class="ch-muted">${escapeHtml((h.description || '').slice(0, 200))}</span></span>
      <span class="ch-review-actions"><button class="ch-btn solid small" type="button" data-act="host-decide" data-id="${h.id}" data-decision="approve">Approve</button>
      <button class="ch-btn line small danger" type="button" data-act="host-decide" data-id="${h.id}" data-decision="reject">Reject</button></span></div>`).join('')}</div>` : ''}`;
}

hubActions['ev-decide'] = (button) => {
  const decision = button.dataset.decision;
  const titles = { approve: 'Approve this event?', changes: 'Ask for changes', reject: 'Reject this event?' };
  openHubModal({
    title: titles[decision],
    confirmText: { approve: 'Approve', changes: 'Send back', reject: 'Reject' }[decision],
    body: `<label>${decision === 'approve' ? 'A note for the organiser (optional)' : 'What should change, or why it is rejected (the organiser sees this)'}<textarea class="ch-input" id="evDecideNote" rows="3" maxlength="1000"></textarea></label>`,
    onConfirm: async () => {
      await api(`/api/events/${button.dataset.id}/approval`, { method: 'POST', body: { decision, comment: el('evDecideNote').value } });
      showToast(decision === 'approve' ? 'Approved. The organiser was told.' : 'Sent. The organiser was told.');
      renderEventsTab();
    }
  });
};

hubActions['host-decide'] = async (button) => {
  try {
    await api(`/api/hosts/${button.dataset.id}/decision`, { method: 'POST', body: { decision: button.dataset.decision } });
    showToast(button.dataset.decision === 'approve' ? 'Host approved.' : 'Host request rejected.');
    renderEventsTab();
  } catch (err) { showToast(err.message); }
};
