// ==========================================
// FOUNDER-EVENTS.JS — the founder console's Events tab: events waiting for the founder (professionals' first public events,
// public student events, escalations), every event with its open reports, featuring and taking an event down.
// Loaded after pages-common.js and before founder.js, which calls renderFounderEvents() from its tab switch.
// ==========================================

const FE = { status: '', q: '' };
const FE_STEP = { teacher: 'Teacher', college_admin: 'College admin', founder: 'Founder' };
const feWhen = (iso) => iso ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '–';

async function renderFounderEvents() {
  let queue, all;
  try {
    [queue, all] = await Promise.all([api('/api/events/approvals'), api(`/api/founder/events?status=${encodeURIComponent(FE.status)}&q=${encodeURIComponent(FE.q)}`)]);
  } catch (err) { return guard(err); }
  const totals = all.totals || {};
  el('fcBody').innerHTML = `
    <div class="ch-bar"><h2 class="ch-bar-title">Waiting for a decision<small>${queue.events.length}</small></h2></div>
    ${queue.events.length ? queue.events.map(item => `<article class="ch-panel fc-app" style="margin-bottom:12px">
      <div class="fc-app-top"><span class="ch-chip navy">${escapeHtml(FE_STEP[item.step] || item.step)} step</span><h3 style="flex:1">${escapeHtml(item.card.title)}</h3>
        ${item.kind === 'edit' ? '<span class="ch-chip warn">Change to a live event</span>' : ''}<a class="ch-btn line small" href="event.html?id=${item.card.id}" target="_blank" rel="noopener">Open</a></div>
      <p class="ch-muted" style="margin:6px 0">${escapeHtml(feWhen(item.card.start_at))} · ${escapeHtml(item.visibility)} · by ${escapeHtml(item.organiser ? item.organiser.name : '?')}${item.card.college_name ? ` (${escapeHtml(item.card.college_name)})` : ''}</p>
      <details><summary style="cursor:pointer;font-weight:600">Description</summary><p class="ch-post-body" style="white-space:pre-line">${escapeHtml(item.description || '')}</p></details>
      <div class="ch-review-actions" style="margin-top:10px"><button class="ch-btn solid small" type="button" data-fe="decide" data-id="${item.card.id}" data-decision="approve">Approve</button>
        <button class="ch-btn line small" type="button" data-fe="decide" data-id="${item.card.id}" data-decision="changes">Ask for changes</button>
        <button class="ch-btn line small danger" type="button" data-fe="decide" data-id="${item.card.id}" data-decision="reject">Reject</button></div></article>`).join('')
      : stateBlock('task_alt', 'Nothing waiting', 'Teachers approve their own students\' college events. You only see public events, professionals\' first events and escalations.')}
    <div class="ch-bar" style="margin-top:22px"><h2 class="ch-bar-title">All events<small>${Object.entries(totals).map(([k, v]) => `${v} ${k}`).join(' · ')}</small></h2>
      <input class="ch-input" id="feQ" placeholder="Search title or college" value="${escapeHtml(FE.q)}" style="max-width:240px">
      <select class="ch-select" id="feStatus"><option value="">Every status</option>${['published', 'pending', 'changes', 'draft', 'completed', 'cancelled', 'rejected', 'removed'].map(s => `<option ${FE.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    ${all.events.length ? `<div class="ch-panel bl-table"><table class="ch-table"><thead><tr><th>Event</th><th>When</th><th>Status</th><th>Registered</th><th>Reports</th><th></th></tr></thead><tbody>
      ${all.events.map(e => `<tr><td><a href="event.html?id=${e.id}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a><br><small class="ch-muted">${escapeHtml(e.host.name)}${e.college_name ? ` · ${escapeHtml(e.college_name)}` : ''} · ${escapeHtml(e.visibility)}</small></td>
        <td>${escapeHtml(feWhen(e.start_at))}</td><td>${escapeHtml(e.display_status)}${e.featured ? ' <span class="ch-chip indigo">Featured</span>' : ''}</td><td>${e.confirmed}${e.capacity ? ` / ${e.capacity}` : ''}</td>
        <td>${e.open_reports ? `<span class="ch-chip ${e.hidden ? 'warn' : ''}">${e.open_reports}${e.hidden ? ' · hidden' : ''}</span>` : '–'}</td>
        <td><span class="ch-review-actions">${e.status === 'published' ? `<button class="ch-btn line small" type="button" data-fe="feature" data-id="${e.id}" data-on="${e.featured ? 0 : 1}">${e.featured ? 'Unfeature' : 'Feature'}</button>
          <button class="ch-btn line small danger" type="button" data-fe="unpublish" data-id="${e.id}">Take down</button>` : ''}</span></td></tr>`).join('')}</tbody></table></div>`
      : stateBlock('event', 'No events', 'Nothing matches.')}`;
  let typing = null;
  el('feQ').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { FE.q = el('feQ').value.trim(); renderFounderEvents(); }, 400); });
  el('feStatus').addEventListener('change', () => { FE.status = el('feStatus').value; renderFounderEvents(); });
}

document.querySelector('main').addEventListener('click', (e) => {
  const button = e.target.closest('[data-fe]');
  if (!button) return;
  const id = Number(button.dataset.id);
  if (button.dataset.fe === 'feature') {
    attempt(() => api(`/api/founder/events/${id}/feature`, { method: 'POST', body: { featured: button.dataset.on === '1' } }), button.dataset.on === '1' ? 'Featured.' : 'No longer featured.').then(renderFounderEvents);
  }
  if (button.dataset.fe === 'decide') {
    const decision = button.dataset.decision;
    openModal({ title: decision === 'approve' ? 'Approve this event?' : decision === 'changes' ? 'Ask for changes' : 'Reject this event?',
      body: `<label class="ap-label">${decision === 'approve' ? 'Note for the organiser (optional)' : 'What should change, or why (the organiser sees this)'}<textarea class="ch-input" id="feNote" rows="3" maxlength="1000"></textarea></label>`,
      confirmText: decision === 'approve' ? 'Approve' : decision === 'changes' ? 'Send back' : 'Reject',
      onConfirm: async () => { await api(`/api/events/${id}/approval`, { method: 'POST', body: { decision, comment: el('feNote').value } }); renderFounderEvents(); } });
  }
  if (button.dataset.fe === 'unpublish') {
    openModal({ title: 'Take this event down?', confirmText: 'Take down',
      body: '<p>It goes back to the organiser as "changes requested". Registrations stay; the organiser can fix it and submit it again.</p><label class="ap-label">Reason (the organiser sees it)<textarea class="ch-input" id="feNote" rows="3" maxlength="500"></textarea></label>',
      onConfirm: async () => { await api(`/api/founder/events/${id}/unpublish`, { method: 'POST', body: { reason: el('feNote').value } }); renderFounderEvents(); } });
  }
});
