// ==========================================
// MY-EVENTS.JS — my-events.html: tickets (upcoming), waitlists and pending ones, past events, the events I organise and my
// certificates. Loaded after chat-common.js and events-common.js.
//   my-events.html?tab=upcoming|waiting|past|organising|certificates
// ==========================================

const MY_TABS = [['upcoming', 'Upcoming'], ['waiting', 'Waitlist and pending'], ['past', 'Past'], ['organising', 'Organising'], ['certificates', 'Certificates']];
const my = { tab: MY_TABS.some(([k]) => k === evParam('tab')) ? evParam('tab') : 'upcoming', data: null };

async function initMyEvents() {
  renderMyTabs();
  el('myTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    my.tab = tab.dataset.tab;
    history.replaceState(null, '', `my-events.html?tab=${my.tab}`);
    renderMyTabs();
    renderMine();
  });
  try {
    my.data = await api('/api/me/events');
  } catch (err) {
    el('myBody').innerHTML = evEmptyHtml('cloud_off', 'Could not load your events', err.message, '<button class="ev-btn is-quiet" type="button" onclick="initMyEvents()">Try again</button>');
    return;
  }
  renderMyTabs();
  renderMine();
}

function groups() {
  const now = Date.now();
  const regs = (my.data && my.data.registrations) || [];
  const ended = (r) => r.event.end_at && new Date(r.event.end_at) < now || ['completed', 'archived', 'cancelled', 'removed'].includes(r.event.status);
  return {
    upcoming: regs.filter(r => r.status === 'confirmed' && !ended(r)).sort((a, b) => (a.event.start_at || '').localeCompare(b.event.start_at || '')),
    waiting: regs.filter(r => ['pending', 'waitlisted'].includes(r.status) && !ended(r)),
    past: regs.filter(r => ended(r) || ['cancelled', 'rejected', 'removed', 'no_show'].includes(r.status)),
    organising: (my.data && my.data.organising) || [],
    certificates: (my.data && my.data.certificates) || []
  };
}

function renderMyTabs() {
  const counts = my.data ? groups() : {};
  el('myTabs').innerHTML = MY_TABS.map(([key, label]) => `<button type="button" role="tab" data-tab="${key}" aria-selected="${my.tab === key}">${label}${counts[key] && counts[key].length ? ` <span class="ev-count">${counts[key].length}</span>` : ''}</button>`).join('');
}

function renderMine() {
  const g = groups();
  const body = el('myBody');
  if (my.tab === 'certificates') return renderCertificates(g.certificates);
  const list = g[my.tab];
  if (!list.length) {
    const empty = { upcoming: ['confirmation_number', 'No tickets yet', 'Events you register for appear here with their QR ticket.', '<a class="ev-btn" href="events.html">Find events</a>'],
      waiting: ['hourglass_empty', 'Nothing waiting', 'Registrations that need approval or are on a waitlist show here.', ''],
      past: ['history', 'No past events', 'Events you attended show here, with their certificates.', ''],
      organising: ['edit_calendar', 'You are not organising anything', 'Create an event for your department, club or team.', '<a class="ev-btn" href="event-create.html">Create an event</a>'] }[my.tab];
    body.innerHTML = evEmptyHtml(...empty);
    return;
  }
  if (my.tab === 'organising') {
    body.innerHTML = `<div class="ev-grid">${list.map(ev => evCardHtml(ev, { link: ev.status === 'draft' || ev.status === 'changes' ? `event-create.html?id=${ev.id}` : `event-manage.html?id=${ev.id}`, noSave: true,
      foot: `${evStatusChip(ev.display_status)}<span>${escapeHtml(ev.my_role)}</span>` })).join('')}</div>`;
    return;
  }
  body.innerHTML = `<div class="ev-grid">${list.map(r => {
    const action = r.status === 'confirmed' && my.tab === 'upcoming' ? `<a class="ev-btn is-small" href="ticket.html?reg=${r.id}" style="position:relative;z-index:2">${evIcon('qr_code_2')}Ticket</a>`
      : (r.checked_in ? `<span class="ev-chip is-good">${evIcon('check')}Attended</span>` : evMyChip(r.status));
    return evCardHtml(Object.assign({}, r.event, { my_status: r.status }), { foot: `<span>${escapeHtml(evRelative(r.event.start_at))}</span>${action}` });
  }).join('')}</div>`;
}

function renderCertificates(certs) {
  const body = el('myBody');
  if (!certs.length) {
    body.innerHTML = evEmptyHtml('workspace_premium', 'No certificates yet', 'When you attend an event that gives certificates, they appear here. Anyone can check them with the code.', '');
    return;
  }
  body.innerHTML = `<div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Event</th><th>Type</th><th>Code</th><th>Show on profile</th><th></th></tr></thead><tbody>
    ${certs.map(c => `<tr><td><b>${escapeHtml(c.event_title)}</b><br><span class="ev-small">${escapeHtml(evDay(c.event_date, { year: 'numeric' }))}</span></td>
      <td>${escapeHtml(c.kind)}${c.revoked ? ' <span class="ev-chip is-bad">Revoked</span>' : ''}</td><td><code>${escapeHtml(c.code)}</code></td>
      <td><label class="ev-choice"><input type="checkbox" data-cert-profile="${c.id}" ${c.on_profile ? 'checked' : ''} ${c.revoked ? 'disabled' : ''}><span class="ev-sr">Show on my profile</span></label></td>
      <td><span class="ev-actions"><a class="ev-btn is-quiet is-small" href="event-print.html?cert=${c.id}">${evIcon('print')}Print</a><button type="button" class="ev-btn is-quiet is-small" data-cert-copy="${escapeHtml(c.verify_url)}">${evIcon('link')}Link</button></span></td></tr>`).join('')}
    </tbody></table></div><p class="ev-small" style="margin-top:10px">Certificates you show on your profile are visible to people who open it. Anyone with the code can check it on the verification page.</p>`;
  body.querySelectorAll('[data-cert-profile]').forEach(box => box.addEventListener('change', async () => {
    try { await api(`/api/me/certificates/${box.dataset.certProfile}`, { method: 'PATCH', body: { on_profile: box.checked } }); evToast(box.checked ? 'Shown on your profile.' : 'Hidden from your profile.'); }
    catch (err) { evToast(err.message); box.checked = !box.checked; }
  }));
  body.querySelectorAll('[data-cert-copy]').forEach(b => b.addEventListener('click', () => evCopy(b.dataset.certCopy, 'Verification link copied.')));
}

initMyEvents();
