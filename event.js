// ==========================================
// EVENT.JS — one event (event.html?id=, also reached from the share link /e/{slug}). Opens for visitors too when the event
// is public; they see everything except links and contacts, and "Register" sends them to log in first.
//   event.html?id=ID&code=INVITE   an invite-link-only event
//   event.html?id=ID&ref=CODE      where the visitor came from (an ambassador's link); kept for the registration
// Registration is a short sheet: profile fields the organiser asked for (pre-filled), their questions, consent.
// ==========================================

const ep = { id: Number(evParam('id')), code: evParam('code'), ev: null, me: !!localStorage.getItem('currentUserId'), team: null };
if (evParam('ref')) { try { sessionStorage.setItem(`c2m:evref:${ep.id}`, evParam('ref')); } catch (e) { /* storage off */ } }

function guestBar() {
  if (ep.me) return;
  const header = document.getElementById('appHeader');
  if (header) header.innerHTML = `<div class="lg-guest-bar"><a class="lg-brand" href="index.html">Connect2Minds</a>
    <nav><a class="hm-btn is-quiet" href="${loginLink()}">Log in</a><a class="hm-btn" href="register.html?next=${encodeURIComponent(selfPage())}">Sign up</a></nav></div>`;
  document.body.classList.add('tabbar-off');
}
const selfPage = () => `event.html?id=${ep.id}${ep.code ? `&code=${encodeURIComponent(ep.code)}` : ''}`;
const loginLink = () => `login.html?next=${encodeURIComponent(selfPage())}`;

async function initEvent() {
  guestBar();
  if (!ep.id) return showProblem('event_busy', 'No event chosen', 'Open an event from the Events page.');
  await loadEvent();
}

async function loadEvent() {
  try {
    ep.ev = await evApi(`/api/events/${ep.id}${ep.code ? `?code=${encodeURIComponent(ep.code)}` : ''}`);
  } catch (err) {
    if (err.status === 401) return showProblem('lock', 'Log in to see this event', 'This event is only for members of a college on Connect2Minds.', `<a class="ev-btn" href="${loginLink()}">Log in</a>`);
    if (err.status === 404) return showProblem('event_busy', 'Event not found', 'It may have been removed, or it is only for another college or department.', '<a class="ev-btn is-quiet" href="events.html">See other events</a>');
    return showProblem('cloud_off', 'Could not load this event', err.message, '<button type="button" class="ev-btn is-quiet" onclick="loadEvent()">Try again</button>');
  }
  document.title = `${ep.ev.title} | Connect2Minds`;
  render();
  if (ep.ev.is_team_event && ep.ev.registration && ['confirmed', 'pending', 'waitlisted'].includes(ep.ev.registration.status)) loadTeam();
}

function showProblem(icon, title, text, action) {
  el('evPage').innerHTML = '';
  el('evPage').removeAttribute('aria-busy');
  el('evProblem').hidden = false;
  el('evProblem').innerHTML = evEmptyHtml(icon, title, text, action || '');
}

// ---------- the page ----------
function render() {
  const ev = ep.ev;
  const host = ev.host || {};
  const hostLink = host.id ? `host.html?id=${host.id}` : (host.user_id ? `profile.html?id=${host.user_id}` : '');
  const staff = !!ev.my_role;
  el('evPage').removeAttribute('aria-busy');
  el('evPage').innerHTML = `
    ${staff ? `<div class="ev-note" style="margin-bottom:14px">${evIcon('admin_panel_settings')}<span>You organise this event (${escapeHtml(ev.my_role)}). <a href="event-manage.html?id=${ev.id}" style="color:#3525cd;font-weight:700">Open the dashboard</a>${ev.status !== 'published' ? ` · Status: <b>${escapeHtml(ev.display_status)}</b>` : ''}</span></div>` : ''}
    ${ev.status === 'cancelled' ? `<div class="ev-note is-warn" style="margin-bottom:14px">${evIcon('event_busy')}<span><b>This event was cancelled.</b> ${escapeHtml(ev.cancelled_reason || '')}</span></div>` : ''}
    <article class="ev-hero">
      ${evPosterHtml(ev, true)}
      <div class="ev-hero-body">
        <div class="ev-actions" style="justify-content:space-between;align-items:center">
          <span style="display:flex;gap:6px;flex-wrap:wrap">${evStatusChip(ev.display_status)}<span class="ev-chip is-grey">${evIcon(EV_KIND_ICONS[ev.kind] || 'event')}${escapeHtml(ev.kind_label)}</span>${ev.featured ? `<span class="ev-chip">${evIcon('star')}Featured</span>` : ''}</span>
        </div>
        <h1>${escapeHtml(ev.title)}</h1>
        ${ev.tagline ? `<p class="ev-tagline">${escapeHtml(ev.tagline)}</p>` : ''}
        <div class="ev-hostline">
          ${host.logo_url ? `<img class="ev-host-logo" src="${escapeHtml(safeUrl(host.logo_url))}" alt="">` : `<span class="ev-host-logo">${escapeHtml((host.name || '?').slice(0, 1))}</span>`}
          <span>by ${hostLink ? `<a href="${hostLink}">${evHostName(host)}</a>` : evHostName(host)}${ev.college_name ? ` · ${escapeHtml(ev.college_name)}` : ''}</span>
        </div>
      </div>
      <div class="ev-facts">
        <div class="ev-fact">${evIcon('calendar_month')}<div><b>${escapeHtml(evRange(ev.start_at, ev.end_at))}</b><span>${escapeHtml(evDuration(ev.start_at, ev.end_at))}${ev.start_at ? ' · India time' : ''}</span></div></div>
        <div class="ev-fact">${evIcon(ev.mode === 'online' ? 'videocam' : 'location_on')}<div><b>${escapeHtml(ev.mode === 'online' ? 'Online' : (ev.venue || 'Venue to be announced'))}</b>
          <span>${escapeHtml([ev.room, ev.address, ev.city].filter(Boolean).join(', '))}${ev.mode === 'hybrid' ? ' · also online' : ''}${ev.map_link ? ` · <a href="${escapeHtml(safeUrl(ev.map_link))}" target="_blank" rel="noopener">Map</a>` : ''}</span></div></div>
        <div class="ev-fact">${evIcon('event_seat')}<div><b>${ev.capacity ? `${ev.seats_left} of ${ev.capacity} seats left` : 'Open seats'}</b><span>${ev.waitlisted ? `${ev.waitlisted} on the waitlist` : (ev.waitlist_on && ev.capacity ? 'Waitlist when full' : 'Free entry')}</span></div></div>
        <div class="ev-fact">${evIcon('timer')}<div><b>${ev.reg_close_at ? `Registration closes ${escapeHtml(evWhen(ev.reg_close_at))}` : 'Registration open'}</b><span>${escapeHtml(ev.reg_close_at && new Date(ev.reg_close_at) > Date.now() ? evRelative(ev.reg_close_at) : '')}</span></div></div>
      </div>
    </article>
    <div class="ev-layout">
      <div class="ev-sections">${sectionsHtml()}</div>
      <aside class="ev-side">${registerCardHtml()}${shareCardHtml()}${goingCardHtml()}</aside>
    </div>`;
  renderMobileBar();
  bindPage();
}

function sectionsHtml() {
  const ev = ep.ev;
  const out = [];
  if (ev.announcements && ev.announcements.length) {
    out.push(`<section class="ev-card-pad" aria-labelledby="evAnn"><h2 id="evAnn">Announcements</h2>${ev.announcements.map(a =>
      `<div class="ev-announce">${a.pinned ? `<span class="ev-chip" style="margin-bottom:4px">${evIcon('push_pin')}Pinned</span><br>` : ''}<b>${escapeHtml(a.title)}</b>${a.body ? `<p>${escapeHtml(a.body)}</p>` : ''}<small>${a.sent_at ? escapeHtml(evWhen(a.sent_at)) : `Scheduled for ${escapeHtml(evWhen(a.send_at))}`}</small></div>`).join('')}</section>`);
  }
  out.push(`<section class="ev-card-pad" aria-labelledby="evAbout"><h2 id="evAbout">About this event</h2><div class="ev-md">${mdToHtml(ev.description || '', { links: true }) || '<p class="ev-small">No description yet.</p>'}</div>
    ${ev.tags.length ? `<div class="ev-chiprow" style="margin-top:12px">${ev.tags.map(t => `<a class="ev-chip is-grey" href="events.html?q=${encodeURIComponent(t)}" style="text-decoration:none">#${escapeHtml(t)}</a>`).join('')}</div>` : ''}</section>`);
  if (ev.agenda.length) {
    out.push(`<section class="ev-card-pad" aria-labelledby="evAgenda"><h2 id="evAgenda">Agenda</h2><div class="ev-agenda">${ev.agenda.map(s =>
      `<div class="ev-agenda-row"><time>${escapeHtml(s.start ? evTime(s.start) : '')}${s.end ? ` – ${escapeHtml(evTime(s.end))}` : ''}</time><div><b>${escapeHtml(s.title)}</b>
        <span class="ev-small">${escapeHtml([s.speaker, s.room].filter(Boolean).join(' · '))}</span>${s.details ? `<p class="ev-small" style="margin-top:4px">${escapeHtml(s.details)}</p>` : ''}</div></div>`).join('')}</div></section>`);
  }
  const speakers = ev.speakers.filter(s => s.kind !== 'judge' && s.kind !== 'mentor');
  const judges = ev.speakers.filter(s => s.kind === 'judge' || s.kind === 'mentor');
  [[speakers, 'Speakers and guests'], [judges, 'Judges and mentors']].forEach(([people, title]) => {
    if (!people.length) return;
    out.push(`<section class="ev-card-pad"><h2>${title}</h2><div class="ev-people">${people.map(p => `<div class="ev-person">${evFaceHtml({ name: p.name, profile_pic: p.photo })}
      <div><b>${p.link ? `<a href="${escapeHtml(safeUrl(p.link))}" target="_blank" rel="noopener" style="color:inherit">${escapeHtml(p.name)}</a>` : escapeHtml(p.name)}</b><span>${escapeHtml([p.role, p.org].filter(Boolean).join(', '))}</span>
      ${p.bio ? `<p class="ev-small" style="margin-top:4px">${escapeHtml(p.bio)}</p>` : ''}</div></div>`).join('')}</div></section>`);
  });
  if (ev.is_team_event) out.push(`<section class="ev-card-pad" id="evTeam" aria-labelledby="evTeamTitle"><h2 id="evTeamTitle">Teams</h2><p class="ev-small">Teams of ${ev.team_min} to ${ev.team_max}. ${ev.registration ? '' : 'Register first, then make or join a team here.'}</p><div id="evTeamBody"></div></section>`);
  if (ev.faqs.length) {
    out.push(`<section class="ev-card-pad ev-faq"><h2>Questions people ask</h2>${ev.faqs.map(f => `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join('')}</section>`);
  }
  if (ev.sponsors.length) {
    out.push(`<section class="ev-card-pad"><h2>Sponsors and partners</h2><div class="ev-sponsors">${ev.sponsors.map(s => {
      const inner = `${s.logo ? `<img src="${escapeHtml(safeUrl(s.logo))}" alt="">` : ''}<span>${escapeHtml(s.name)}${s.tier ? ` · ${escapeHtml(s.tier)}` : ''}</span>`;
      return s.link ? `<a class="ev-sponsor" href="${escapeHtml(safeUrl(s.link))}" target="_blank" rel="noopener">${inner}</a>` : `<span class="ev-sponsor">${inner}</span>`;
    }).join('')}</div></section>`);
  }
  if (ev.contact) {
    const c = ev.contact;
    if (c.name || c.phone || c.email) {
      out.push(`<section class="ev-card-pad"><h2>Organiser contact</h2><p class="ev-small" style="margin-bottom:8px">Shown only to people who registered.</p>
        <dl class="ev-dl">${c.name ? `<dt>Name</dt><dd>${escapeHtml(c.name)}</dd>` : ''}${c.phone ? `<dt>Phone</dt><dd><a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a></dd>` : ''}${c.email ? `<dt>Email</dt><dd><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></dd>` : ''}</dl></section>`);
    }
  }
  return out.join('');
}

function registerState() {
  const ev = ep.ev;
  const reg = ev.registration;
  const now = Date.now();
  if (reg && reg.status === 'confirmed') return { kind: 'registered' };
  if (reg && reg.status === 'pending') return { kind: 'pending' };
  if (reg && reg.status === 'waitlisted') return { kind: 'waitlisted' };
  if (reg && ['rejected', 'removed'].includes(reg.status)) return { kind: 'closed', text: 'The organisers did not accept your registration.' };
  if (ev.status !== 'published') return { kind: 'closed', text: ev.status === 'completed' || ev.status === 'archived' ? 'This event is over.' : (ev.status === 'cancelled' ? 'This event was cancelled.' : 'Registration opens once the event is published.') };
  if (ev.end_at && new Date(ev.end_at) < now) return { kind: 'closed', text: 'This event is over.' };
  if (ev.reg_open_at && new Date(ev.reg_open_at) > now) return { kind: 'closed', text: `Registration opens ${evWhen(ev.reg_open_at)}.` };
  if (ev.reg_close_at && new Date(ev.reg_close_at) < now) return { kind: 'closed', text: 'Registration has closed.' };
  if (!ep.me) return { kind: 'login' };
  if (ev.eligible) return { kind: 'ineligible', text: ev.eligible };
  if (ev.capacity && ev.seats_left <= 0) return ev.waitlist_on ? { kind: 'waitlist' } : { kind: 'closed', text: 'This event is full.' };
  return { kind: 'open' };
}

function registerCardHtml() {
  const ev = ep.ev;
  const state = registerState();
  const share = ev.capacity ? Math.min(100, Math.round((ev.confirmed / ev.capacity) * 100)) : 0;
  const bar = ev.capacity ? `<div class="ev-reg-meta"><span>${ev.confirmed} registered</span><span>${ev.capacity} seats</span></div><div class="ev-bar${share >= 100 ? ' is-full' : ''}"><span style="width:${share}%"></span></div>` : '';
  const button = {
    open: `<button type="button" class="ev-btn is-wide" data-ev-register>${evIcon('how_to_reg')}Register${ev.manual_approval ? ' (needs approval)' : ''}</button>`,
    waitlist: `<button type="button" class="ev-btn is-wide" data-ev-register>${evIcon('hourglass_top')}Join the waitlist</button>`,
    login: `<a class="ev-btn is-wide" href="${loginLink()}">${evIcon('login')}Log in to register</a>`,
    registered: `<a class="ev-btn is-wide" href="ticket.html?reg=${ev.registration && ev.registration.id}">${evIcon('confirmation_number')}View your ticket</a>`,
    pending: `<div class="ev-note">${evIcon('pending')}<span>Your registration is waiting for the organisers to approve it. You will be told.</span></div>`,
    waitlisted: `<div class="ev-note is-warn">${evIcon('hourglass_top')}<span>You are on the waitlist. If a seat opens you move up automatically and get a message.</span></div>`,
    ineligible: `<button type="button" class="ev-btn is-wide" disabled>Not eligible</button><p class="ev-small">${escapeHtml(state.text || '')}</p>`,
    closed: `<button type="button" class="ev-btn is-wide" disabled>${escapeHtml(state.kind === 'closed' && /full/i.test(state.text || '') ? 'Full' : 'Registration closed')}</button><p class="ev-small">${escapeHtml(state.text || '')}</p>`
  }[state.kind];
  const registered = ['registered', 'pending', 'waitlisted'].includes(state.kind);
  const links = registered && ev.registration.status === 'confirmed' && (ev.online_link || ev.group_link)
    ? `<div class="ev-actions">${ev.online_link ? `<a class="ev-btn is-line is-small" href="${escapeHtml(safeUrl(ev.online_link))}" target="_blank" rel="noopener">${evIcon('videocam')}Join online</a>` : ''}${ev.group_link ? `<a class="ev-btn is-line is-small" href="${escapeHtml(safeUrl(ev.group_link))}" target="_blank" rel="noopener">${evIcon('forum')}Event group</a>` : ''}</div>`
    : (ev.has_online_link && !registered ? `<p class="ev-small">${evIcon('lock', 'ev-icon')} The online link is shared after you register.</p>` : '');
  return `<section class="ev-card-pad" aria-labelledby="evRegTitle"><div class="ev-reg-state">
    <h2 id="evRegTitle" class="ev-sr">Registration</h2>
    <div class="ev-reg-price">Free</div>${bar}${button}${links}
    ${registered ? `<button type="button" class="ev-btn is-quiet is-small" data-ev-cancel>${evIcon('event_busy')}Cancel registration</button>
      <label class="ev-choice"><input type="checkbox" data-ev-show ${ev.registration.show_publicly ? 'checked' : ''}>Show me in "who is going"</label>` : ''}
    ${ev.scam_warning ? `<div class="ev-note is-warn">${evIcon('shield')}<span>${escapeHtml(ev.scam_warning)}</span></div>` : ''}
    ${ev.takes_photos ? `<p class="ev-small">${evIcon('photo_camera', 'ev-icon')} Photos and videos will be taken at this event.</p>` : ''}
  </div></section>`;
}

function shareCardHtml() {
  const ev = ep.ev;
  const calendar = ev.start_at ? `<a class="ev-btn is-quiet is-small" href="${API_BASE}/api/events/${ev.id}/calendar.ics${ep.code ? `?code=${encodeURIComponent(ep.code)}` : ''}" download>${evIcon('event')}Calendar file</a>
      <a class="ev-btn is-quiet is-small" href="${escapeHtml(evGoogleCalendar(ev))}" target="_blank" rel="noopener">${evIcon('calendar_add_on')}Google Calendar</a>` : '';
  return `<section class="ev-card-pad" aria-labelledby="evShareTitle"><h2 id="evShareTitle" style="font-size:16px">Save and share</h2><div class="ev-actions">
    ${calendar}
    <button type="button" class="ev-btn is-quiet is-small" data-ev-copy>${evIcon('link')}Copy link</button>
    <a class="ev-btn is-quiet is-small" href="${escapeHtml(evWhatsApp(ev))}" target="_blank" rel="noopener">${evIcon('share')}WhatsApp</a>
    ${ep.me ? `<button type="button" class="ev-btn is-quiet is-small" data-ev-save="${ev.id}" aria-pressed="${ev.saved ? 'true' : 'false'}">${evIcon(ev.saved ? 'bookmark_added' : 'bookmark_add')}</button>` : ''}
    ${ep.me && !ev.my_role ? `<button type="button" class="ev-btn is-quiet is-small" data-report-kind="event" data-report-id="${ev.id}" data-report-name="${escapeHtml(ev.title)}">${evIcon('flag')}Report</button>` : ''}
  </div></section>`;
}

function goingCardHtml() {
  const going = ep.ev.going || { count: 0, people: [] };
  if (!going.count) return '';
  const extra = [going.following ? `${going.following} you follow` : '', going.same_college ? `${going.same_college} from your college` : ''].filter(Boolean).join(' · ');
  return `<section class="ev-card-pad" aria-labelledby="evGoingTitle"><h2 id="evGoingTitle" style="font-size:16px">Who is going</h2>
    <div style="display:flex;align-items:center;gap:10px">${going.people.length ? `<div class="ev-faces">${going.people.slice(0, 6).map(p => evFaceHtml(p)).join('')}</div>` : ''}
    <div><b>${going.count} going</b>${extra ? `<p class="ev-small">${escapeHtml(extra)}</p>` : ''}</div></div>
    ${going.people.length ? `<p class="ev-small" style="margin-top:8px">${going.people.slice(0, 4).map(p => `<a href="profile.html?id=${p.id}" style="color:#3525cd">${escapeHtml(p.name)}</a>`).join(', ')}${going.people.length > 4 ? ' and others' : ''}</p>` : ''}
    <p class="ev-small" style="margin-top:6px">Only people who chose to be shown are named.</p></section>`;
}

function renderMobileBar() {
  const bar = el('evMobileBar');
  const state = registerState();
  const ev = ep.ev;
  const action = { open: `<button type="button" class="ev-btn" data-ev-register>Register</button>`, waitlist: `<button type="button" class="ev-btn" data-ev-register>Join waitlist</button>`,
    login: `<a class="ev-btn" href="${loginLink()}">Log in to register</a>`, registered: `<a class="ev-btn" href="ticket.html?reg=${ev.registration && ev.registration.id}">View ticket</a>` }[state.kind];
  bar.hidden = !action;
  document.body.classList.toggle('ev-has-bar', !!action);
  if (action) bar.innerHTML = `<div class="ev-mobile-text">${escapeHtml(evDay(ev.start_at))}<br><span class="ev-small">${ev.capacity ? `${ev.seats_left} seats left` : 'Free'}</span></div>${action}`;
}

function bindPage() {
  document.querySelectorAll('[data-ev-register]').forEach(b => b.addEventListener('click', openRegistration));
  const copy = document.querySelector('[data-ev-copy]');
  if (copy) copy.addEventListener('click', () => evCopy(ep.ev.share_url, 'Link copied. It shows a preview on WhatsApp and LinkedIn.'));
  const cancel = document.querySelector('[data-ev-cancel]');
  if (cancel) cancel.addEventListener('click', cancelRegistration);
  const show = document.querySelector('[data-ev-show]');
  if (show) show.addEventListener('change', async () => {
    try { await evApi(`/api/events/${ep.id}/register`, { method: 'PATCH', body: { show_publicly: show.checked } }); evToast(show.checked ? 'You are shown in who is going.' : 'You are no longer shown.'); }
    catch (err) { evToast(err.message); show.checked = !show.checked; }
  });
}

function cancelRegistration() {
  const ev = ep.ev;
  const { close, box } = evDialog('Cancel your registration?', `<p class="ev-small" style="font-size:15px;line-height:22px">Your seat goes to the next person on the waitlist. You can register again later if there is still room.</p>`,
    `<button type="button" class="ev-btn is-quiet" data-ev-close>Keep my seat</button><button type="button" class="ev-btn is-danger" id="evCancelYes">Cancel registration</button>`);
  box.querySelector('#evCancelYes').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await evApi(`/api/events/${ev.id}/register`, { method: 'DELETE' });
      close();
      evToast('Your registration is cancelled.');
      loadEvent();
    } catch (err) { evToast(err.message); e.target.disabled = false; }
  });
}

// ---------- registering ----------
async function openRegistration() {
  const ev = ep.ev;
  let me = window.currentUserProfile || {};
  let email = '';
  try {
    const [profile, safety] = await Promise.all([evApi('/api/me'), evApi('/api/me/safety').catch(() => ({}))]);
    me = profile;
    email = safety.email || '';
  } catch (e) { /* pre-filling is a convenience */ }
  const prefill = { name: me.name || '', email, phone: '', college: me.college_name || '', department: me.department || '', year: '', roll_no: me.roll_no || '', skills: me.skills || '' };
  const labels = { name: 'Full name', email: 'Email', phone: 'Phone', college: 'College', department: 'Department', year: 'Year of study', roll_no: 'Roll number', skills: 'Skills' };
  const types = { email: 'email', phone: 'tel' };
  const steps = [];
  steps.push(`<div data-step="0"><p class="ev-small" style="margin-bottom:10px">The organisers asked for these. We filled in what your profile has; change anything that is wrong.</p>
    ${ev.collect_fields.map(f => `<label class="ev-field"><span class="ev-label">${labels[f] || f}${['name', 'email'].includes(f) ? ' <span class="ev-req">*</span>' : ''}</span>
      <input data-profile="${f}" type="${types[f] || 'text'}" value="${escapeHtml(prefill[f] || '')}" maxlength="200" ${['name', 'email'].includes(f) ? 'required' : ''} autocomplete="${{ name: 'name', email: 'email', phone: 'tel' }[f] || 'off'}"></label>`).join('')}</div>`);
  if (ev.form_fields.length) steps.push(`<div data-step="1" hidden>${ev.form_fields.map(questionHtml).join('')}</div>`);
  steps.push(`<div data-step="${steps.length}" hidden>
    <div class="ev-note">${evIcon('privacy_tip')}<span>Your answers and the details above go to the organisers of this event, so they can run it and contact you about it. They are deleted 2 years after the event. <a href="dpdp.html" target="_blank" style="color:#3525cd">Your rights</a></span></div>
    <label class="ev-choice"><input type="checkbox" id="rgShare">I agree to share these details with the organisers. <span class="ev-req">*</span></label>
    ${ev.sponsors.length ? '<label class="ev-choice"><input type="checkbox" id="rgSponsors">The sponsors may contact me too (optional)</label>' : ''}
    ${ev.takes_photos ? '<label class="ev-choice"><input type="checkbox" id="rgPhotos" checked>I am fine appearing in event photos</label>' : ''}
    <label class="ev-choice"><input type="checkbox" id="rgShow">Show my name in "who is going" (optional)</label>
    ${ev.is_team_event ? '<label class="ev-choice"><input type="checkbox" id="rgLooking">I need a team: show me to others looking for teammates</label>' : ''}
    ${ev.manual_approval ? `<div class="ev-note">${evIcon('pending')}<span>The organisers approve each registration. You will be told.</span></div>` : ''}
    ${ev.capacity && ev.seats_left <= 0 ? `<div class="ev-note is-warn">${evIcon('hourglass_top')}<span>The event is full: you join the waitlist and move up when a seat opens.</span></div>` : ''}
  </div>`);
  const total = steps.length;
  const { box, close } = evDialog(`Register: ${ev.title}`, `<p class="ev-form-error" id="rgError" role="alert"></p>${steps.join('')}`,
    `<button type="button" class="ev-btn is-quiet" id="rgBack">Back</button><button type="button" class="ev-btn" id="rgNext">Next</button>`, { steps: total });
  let step = 0;
  const show = () => {
    box.querySelectorAll('[data-step]').forEach(node => { node.hidden = Number(node.dataset.step) !== step; });
    box.querySelectorAll('.ev-steps span').forEach((bar, i) => bar.classList.toggle('is-done', i <= step));
    box.querySelector('#rgBack').style.visibility = step ? 'visible' : 'hidden';
    box.querySelector('#rgNext').textContent = step === total - 1 ? (ev.capacity && ev.seats_left <= 0 ? 'Join the waitlist' : 'Confirm registration') : 'Next';
    const first = box.querySelector(`[data-step="${step}"] input, [data-step="${step}"] select, [data-step="${step}"] textarea`);
    if (first) first.focus();
  };
  const error = (text) => { const node = box.querySelector('#rgError'); node.textContent = text || ''; node.classList.toggle('is-shown', !!text); };
  box.querySelector('#rgBack').addEventListener('click', () => { error(''); step = Math.max(0, step - 1); show(); });
  box.querySelector('#rgNext').addEventListener('click', async (e) => {
    error('');
    const problem = checkStep(box, step);
    if (problem) return error(problem);
    if (step < total - 1) { step += 1; return show(); }
    if (!box.querySelector('#rgShare').checked) return error('Tick the box to share your details with the organisers.');
    e.target.disabled = true;
    e.target.textContent = 'Registering...';
    try {
      const answers = await collectAnswers(box);
      const result = await evApi(`/api/events/${ev.id}/register`, { method: 'POST', body: {
        profile: Object.fromEntries([...box.querySelectorAll('[data-profile]')].map(i => [i.dataset.profile, i.value.trim()])), answers,
        consents: { share: true, sponsors: !!(box.querySelector('#rgSponsors') || {}).checked, photos: !!(box.querySelector('#rgPhotos') || {}).checked },
        show_publicly: box.querySelector('#rgShow').checked, looking_for_team: !!(box.querySelector('#rgLooking') || {}).checked,
        ref: (() => { try { return sessionStorage.getItem(`c2m:evref:${ev.id}`) || ''; } catch (err) { return ''; } })(), code: ep.code } });
      showRegistered(box, close, result);
    } catch (err) {
      error(err.message);
      e.target.disabled = false;
      e.target.textContent = 'Confirm registration';
    }
  });
  show();
}

function questionHtml(q) {
  const req = q.required ? ' <span class="ev-req">*</span>' : '';
  const help = q.help ? `<span class="ev-help">${escapeHtml(q.help)}</span>` : '';
  const name = `q_${q.key}`;
  let input;
  if (q.type === 'long') input = `<textarea data-q="${q.key}" maxlength="2000"></textarea>`;
  else if (q.type === 'dropdown') input = `<select data-q="${q.key}"><option value="">Choose...</option>${q.options.map(o => `<option>${escapeHtml(o)}</option>`).join('')}</select>`;
  else if (q.type === 'radio') input = `<div class="ev-choices" data-q="${q.key}" data-kind="radio">${q.options.map(o => `<label class="ev-choice"><input type="radio" name="${name}" value="${escapeHtml(o)}">${escapeHtml(o)}</label>`).join('')}</div>`;
  else if (q.type === 'multi') input = `<div class="ev-choices" data-q="${q.key}" data-kind="multi">${q.options.map(o => `<label class="ev-choice"><input type="checkbox" value="${escapeHtml(o)}">${escapeHtml(o)}</label>`).join('')}</div>`;
  else if (q.type === 'checkbox') return `<div class="ev-field"><label class="ev-choice"><input type="checkbox" data-q="${q.key}" data-kind="check">${escapeHtml(q.label)}${req}</label>${help}</div>`;
  else if (q.type === 'file') input = `<input type="file" data-q="${q.key}" data-kind="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" multiple><span class="ev-help">PDF, JPG or PNG, up to 5 MB each, at most 3 files. Only the organisers can open them.</span>`;
  else input = `<input data-q="${q.key}" type="${{ number: 'number', date: 'date', phone: 'tel', email: 'email', url: 'url' }[q.type] || 'text'}" maxlength="300" ${q.type === 'url' ? 'placeholder="https://"' : ''}>`;
  return `<div class="ev-field" data-qfield="${q.key}"><label class="ev-label">${escapeHtml(q.label)}${req}</label>${help}${input}</div>`;
}

function checkStep(box, step) {
  const panel = box.querySelector(`[data-step="${step}"]`);
  for (const input of panel.querySelectorAll('[data-profile][required]')) {
    if (!input.value.trim()) return `Fill in your ${input.previousElementSibling.textContent.replace('*', '').trim().toLowerCase()}.`;
    if (input.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.value.trim())) return 'That email address does not look right.';
  }
  for (const q of ep.ev.form_fields) {
    const node = panel.querySelector(`[data-q="${q.key}"]`);
    if (!node || !q.required) continue;
    const value = readQuestion(node);
    if (value === '' || value === false || (Array.isArray(value) && !value.length) || (node.dataset.kind === 'file' && !node.files.length)) return `Answer "${q.label}".`;
  }
  return '';
}

function readQuestion(node) {
  if (node.dataset.kind === 'radio') { const picked = node.querySelector('input:checked'); return picked ? picked.value : ''; }
  if (node.dataset.kind === 'multi') return [...node.querySelectorAll('input:checked')].map(i => i.value);
  if (node.dataset.kind === 'check') return node.checked;
  return (node.value || '').trim();
}

async function collectAnswers(box) {
  const answers = {};
  for (const node of box.querySelectorAll('[data-q]')) {
    if (node.dataset.kind === 'file') {
      if (!node.files.length) continue;
      const names = [];
      for (const file of [...node.files].slice(0, 3)) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${API_BASE}/api/events/${ep.id}/upload/answer`, { method: 'POST', body: form, credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'A file could not be uploaded.');
        names.push(data.name);
      }
      answers[node.dataset.q] = names;
    } else {
      answers[node.dataset.q] = readQuestion(node);
    }
  }
  return answers;
}

function showRegistered(box, close, result) {
  const ev = ep.ev;
  const titles = { confirmed: "You're in!", pending: 'Registration sent', waitlisted: 'You are on the waitlist' };
  const texts = { confirmed: 'Your ticket is ready. Show its QR code at the entrance.', pending: 'The organisers will approve it soon. We will tell you.',
    waitlisted: 'If a seat opens you move up automatically and get a message.' };
  box.querySelector('.ev-dialog-body').innerHTML = `<div class="ev-success">${evIcon(result.status === 'confirmed' ? 'check' : 'hourglass_top')}
      <h3>${titles[result.status]}</h3><p class="ev-small" style="font-size:15px">${texts[result.status]}</p></div>
    ${result.clash ? `<div class="ev-note is-warn">${evIcon('event_busy')}<span>${escapeHtml(result.clash)}</span></div>` : ''}
    <div class="ev-actions" style="justify-content:center">
      ${result.status === 'confirmed' ? `<a class="ev-btn" href="ticket.html?reg=${result.id}">${evIcon('confirmation_number')}Open ticket</a>` : ''}
      <a class="ev-btn is-quiet" href="${escapeHtml(evGoogleCalendar(ev))}" target="_blank" rel="noopener">${evIcon('calendar_add_on')}Add to calendar</a>
      ${result.group_link ? `<a class="ev-btn is-quiet" href="${escapeHtml(safeUrl(result.group_link))}" target="_blank" rel="noopener">${evIcon('forum')}Join the group</a>` : ''}
    </div>`;
  box.querySelector('.ev-dialog-foot').innerHTML = `<span></span><button type="button" class="ev-btn is-quiet" data-ev-close>Done</button>`;
  box.querySelector('.ev-steps').remove();
  loadEvent();
}

// ---------- teams ----------
async function loadTeam() {
  const body = el('evTeamBody');
  if (!body) return;
  try { ep.team = await evApi(`/api/events/${ep.id}/teams`); }
  catch (err) { body.innerHTML = `<p class="ev-small">${escapeHtml(err.message)}</p>`; return; }
  const t = ep.team;
  const looking = t.looking.length ? `<h3 style="font:700 15px Inter,sans-serif;margin:16px 0 8px">Looking for a team (${t.looking.length})</h3>
    <div class="ev-people">${t.looking.slice(0, 12).map(p => `<div class="ev-person">${evFaceHtml(p)}<div><b><a href="profile.html?id=${p.id}" style="color:inherit">${escapeHtml(p.name)}</a></b>
      <span>${escapeHtml(p.shared.length ? `Shares ${p.shared.join(', ')}` : p.skills.slice(0, 3).join(', '))}</span><br><a class="ev-small" href="inbox.html?user=${p.id}" style="color:#3525cd">Message</a></div></div>`).join('')}</div>` : '';
  if (t.mine) {
    const m = t.mine;
    body.innerHTML = `<div class="ev-note is-good">${evIcon('groups')}<span>Your team: <b>${escapeHtml(m.name)}</b> · ${m.size} of ${m.max}${m.locked ? ' · locked' : ''}</span></div>
      <div class="ev-people" style="margin-top:12px">${m.members.map(p => `<div class="ev-person">${evFaceHtml(p)}<div><b>${escapeHtml(p.name)}</b><span>${p.id === m.leader_id ? 'Leader' : 'Member'}</span></div></div>`).join('')}</div>
      <div class="ev-actions" style="margin-top:12px">
        ${m.invite_code && !m.locked ? `<button type="button" class="ev-btn is-quiet is-small" id="tmCopy">${evIcon('content_copy')}Invite code ${escapeHtml(m.invite_code)}</button>` : ''}
        ${m.workspace_id ? `<a class="ev-btn is-line is-small" href="team.html?team=${m.workspace_id}">${evIcon('forum')}Team workspace</a>` : ''}
        ${!m.locked ? `<button type="button" class="ev-btn is-danger is-small" id="tmLeave">Leave team</button>` : ''}
      </div>${m.size < m.min ? `<p class="ev-small" style="margin-top:8px">Your team needs at least ${m.min} people before registration closes.</p>` : ''}${looking}`;
    const copy = el('tmCopy');
    if (copy) copy.addEventListener('click', () => evCopy(m.invite_code, 'Invite code copied. Teammates enter it on this page after they register.'));
    const leave = el('tmLeave');
    if (leave) leave.addEventListener('click', async () => { try { await evApi(`/api/events/${ep.id}/teams/leave`, { method: 'POST' }); loadTeam(); } catch (err) { evToast(err.message); } });
    return;
  }
  body.innerHTML = `<div class="ev-row2">
      <form id="tmCreate" class="ev-field"><span class="ev-label">Start a team</span><input id="tmName" maxlength="60" placeholder="Team name"><button class="ev-btn is-small" type="submit">Create team</button></form>
      <form id="tmJoin" class="ev-field"><span class="ev-label">Join with a code</span><input id="tmCode" maxlength="12" placeholder="e.g. 4F9A2C1B" style="text-transform:uppercase"><button class="ev-btn is-quiet is-small" type="submit">Join team</button></form>
    </div>${looking}`;
  el('tmCreate').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await evApi(`/api/events/${ep.id}/teams`, { method: 'POST', body: { name: el('tmName').value } }); evToast('Team created. A workspace with chat and calls is ready.'); loadTeam(); }
    catch (err) { evToast(err.message); }
  });
  el('tmJoin').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await evApi(`/api/events/${ep.id}/teams/join`, { method: 'POST', body: { code: el('tmCode').value } }); evToast('You joined the team.'); loadTeam(); }
    catch (err) { evToast(err.message); }
  });
}

initEvent();
