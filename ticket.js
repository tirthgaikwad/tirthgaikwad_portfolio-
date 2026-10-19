// ==========================================
// TICKET.JS — ticket.html?reg=ID: the QR code shown at the entrance. The last ticket opened is kept on this device, so it
// still shows when the venue has no internet. "Get a new code" makes old screenshots stop working.
// ==========================================

const tk = { reg: Number(evParam('reg')), data: null };
const TICKET_CACHE = () => `c2m:${localStorage.getItem('currentUserId')}:ticket:${tk.reg}`;

async function initTicket() {
  if (!tk.reg) { el('tkRoot').innerHTML = evEmptyHtml('confirmation_number', 'No ticket chosen', 'Open a ticket from My events.', '<a class="ev-btn" href="my-events.html">My events</a>'); return; }
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(TICKET_CACHE()) || 'null'); } catch (e) { /* storage off */ }
  if (cached) { tk.data = cached; render(true); }
  try {
    tk.data = await api(`/api/me/events/${tk.reg}/ticket`);
    // Kept as a convenience of this browser (works offline); cookies.js may refuse preference storage, which is fine
    try { localStorage.setItem(TICKET_CACHE(), JSON.stringify(tk.data)); } catch (e) { /* storage off */ }
    render(false);
  } catch (err) {
    if (!cached) el('tkRoot').innerHTML = evEmptyHtml(err.status === 0 ? 'wifi_off' : 'confirmation_number', err.status === 0 ? 'You are offline' : 'Ticket not found', err.message,
      '<a class="ev-btn is-quiet" href="my-events.html">My events</a>');
    else evToast('Showing the ticket saved on this device.');
  }
}

function render(fromCache) {
  const t = tk.data;
  const ev = t.event;
  const confirmed = t.status === 'confirmed';
  const statusText = { pending: 'Waiting for the organisers to approve your registration.', waitlisted: 'You are on the waitlist. The ticket appears when you get a seat.',
    cancelled: 'You cancelled this registration.', rejected: 'The organisers did not accept this registration.', removed: 'You were removed from this event.', no_show: 'You did not check in at this event.' }[t.status];
  el('tkRoot').innerHTML = `<article class="ev-ticket" aria-label="Ticket for ${escapeHtml(ev.title)}">
    <div class="ev-ticket-top"><span class="ev-chip" style="background:rgba(255,255,255,.18);color:#fff">${evIcon('confirmation_number')}Ticket</span>
      <h1>${escapeHtml(ev.title)}</h1><p>${escapeHtml(evRange(ev.start_at, ev.end_at))}</p></div>
    <div class="ev-ticket-qr">
      ${confirmed && t.token ? `<div id="qrBox" aria-label="Ticket QR code"></div><p class="ev-small" style="margin-top:8px">Show this at the entrance. Turn your screen brightness up.</p>`
        : `<div class="ev-note ${t.status === 'no_show' || t.status === 'cancelled' ? '' : 'is-warn'}">${evIcon('info')}<span>${escapeHtml(statusText || '')}</span></div>`}
      ${t.checked_in_at ? `<span class="ev-chip is-good" style="margin-top:10px">${evIcon('check')}Checked in ${escapeHtml(evTime(t.checked_in_at))}</span>` : ''}
    </div>
    <div class="ev-ticket-info">
      <p class="ev-ticket-name">${escapeHtml(t.name)}</p><p class="ev-small">${escapeHtml(t.college || '')}${t.team ? ` · Team ${escapeHtml(t.team)}` : ''}</p>
      <dl class="ev-dl" style="margin-top:14px">
        <dt>Where</dt><dd>${escapeHtml(ev.mode === 'online' ? 'Online' : [ev.venue, ev.room, ev.address, ev.city].filter(Boolean).join(', ') || 'To be announced')}</dd>
        <dt>Host</dt><dd>${evHostName(ev.host)}</dd>
        <dt>Registration</dt><dd>#${t.registration_id}</dd>
      </dl>
      ${t.takes_photos ? `<p class="ev-small" style="margin-top:10px">${evIcon('photo_camera', 'ev-icon')} Photos will be taken at this event.</p>` : ''}
      <div class="ev-actions no-print" style="margin-top:16px">
        ${ev.online_link ? `<a class="ev-btn is-small" href="${escapeHtml(safeUrl(ev.online_link))}" target="_blank" rel="noopener">${evIcon('videocam')}Join online</a>` : ''}
        ${ev.group_link ? `<a class="ev-btn is-line is-small" href="${escapeHtml(safeUrl(ev.group_link))}" target="_blank" rel="noopener">${evIcon('forum')}Group</a>` : ''}
        <a class="ev-btn is-quiet is-small" href="event.html?id=${ev.id}">${evIcon('info')}Event page</a>
        <a class="ev-btn is-quiet is-small" href="${escapeHtml(evGoogleCalendar(ev))}" target="_blank" rel="noopener">${evIcon('calendar_add_on')}Calendar</a>
        ${confirmed && !t.checked_in_at ? `<button type="button" class="ev-btn is-quiet is-small" id="tkRenew" title="Old screenshots of this ticket stop working">${evIcon('autorenew')}New code</button>` : ''}
      </div>
      ${fromCache ? '<p class="ev-small" style="margin-top:8px">Saved on this device.</p>' : ''}
    </div></article>`;
  if (confirmed && t.token) evDrawQr(el('qrBox'), t.token, 216).catch(err => { el('qrBox').innerHTML = `<p class="ev-small">${escapeHtml(err.message)}</p>`; });
  const renew = el('tkRenew');
  if (renew) renew.addEventListener('click', () => {
    const { box, close } = evDialog('Get a new QR code?', '<p class="ev-small" style="font-size:15px;line-height:22px">Use this if someone else got a screenshot of your ticket. The old code stops working at once.</p>',
      '<button type="button" class="ev-btn is-quiet" data-ev-close>Keep this one</button><button type="button" class="ev-btn" id="tkRenewYes">New code</button>');
    box.querySelector('#tkRenewYes').addEventListener('click', async () => {
      try {
        const result = await api(`/api/me/events/${tk.reg}/ticket/renew`, { method: 'POST' });
        tk.data.token = result.token;
        try { localStorage.setItem(TICKET_CACHE(), JSON.stringify(tk.data)); } catch (e) { /* storage off */ }
        close();
        render(false);
        evToast('New code ready. The old one no longer works.');
      } catch (err) { evToast(err.message); }
    });
  });
}

initTicket();
