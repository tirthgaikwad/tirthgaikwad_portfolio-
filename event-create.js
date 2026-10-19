// ==========================================
// EVENT-CREATE.JS — the create / edit wizard (event-create.html). Six steps; everything is saved as a draft as you go
// (every 30 seconds and when you change step), so nothing is lost. Loaded after chat-common.js and events-common.js.
//   event-create.html           choose a template, start blank or copy one of your events
//   event-create.html?id=ID     edit that event (drafts, events sent back with changes, and published ones)
// ==========================================

const WZ_STEPS = [['basics', 'Basics'], ['when', 'When and where'], ['audience', 'Audience and rules'], ['form', 'Registration form'], ['extras', 'Speakers, agenda, FAQs'], ['review', 'Review and submit']];
const wz = { id: Number(evParam('id')), ev: null, step: 0, meta: null, hosts: [], dirty: false, saving: false, savedAt: null, questions: [], lists: {} };
const QUESTION_LABELS = { short: 'Short answer', long: 'Paragraph', number: 'Number', dropdown: 'Dropdown', multi: 'Tick several', radio: 'Pick one', checkbox: 'Yes / tick box',
  date: 'Date', phone: 'Phone', email: 'Email', url: 'Web link', file: 'File upload' };
const LIST_FIELDS = {
  agenda: [['title', 'Session title', 'text', 150], ['start', 'Starts', 'datetime-local'], ['end', 'Ends', 'datetime-local'], ['speaker', 'Speaker', 'text', 120], ['room', 'Room', 'text', 80], ['details', 'Details', 'textarea', 500]],
  speakers: [['name', 'Name', 'text', 100], ['role', 'Designation', 'text', 120], ['org', 'Organisation', 'text', 120], ['kind', 'Role at the event', 'select', ['speaker', 'judge', 'mentor', 'chief guest']], ['link', 'LinkedIn or website', 'url', 500], ['bio', 'Short bio', 'textarea', 600]],
  faqs: [['q', 'Question', 'text', 200], ['a', 'Answer', 'textarea', 1000]],
  sponsors: [['name', 'Sponsor name', 'text', 100], ['tier', 'Tier (Gold, Silver...)', 'text', 40], ['link', 'Website', 'url', 500]]
};
const LIST_TITLES = { agenda: ['Agenda', 'Add a session'], speakers: ['Speakers, judges and guests', 'Add a person'], faqs: ['FAQs', 'Add a question'], sponsors: ['Sponsors and partners', 'Add a sponsor'] };

async function initWizard() {
  try {
    const [meta, hosts] = await Promise.all([api('/api/events/templates'), api('/api/hosts/mine')]);
    wz.meta = meta;
    wz.hosts = hosts.hosts.filter(h => h.my_role === 'admin' && h.status === 'active');
    if (!wz.id && !hosts.can_create) {
      el('wzRoot').innerHTML = evEmptyHtml('lock', 'You cannot create events yet', hosts.reason, '<a class="ev-btn" href="profile.html">Open my profile</a>');
      return;
    }
  } catch (err) {
    el('wzRoot').innerHTML = evEmptyHtml('cloud_off', 'Could not load the wizard', err.message, '<button class="ev-btn is-quiet" type="button" onclick="initWizard()">Try again</button>');
    return;
  }
  if (!wz.id) return renderStart();
  await loadDraft();
}

// ---------- starting ----------
async function renderStart() {
  const icons = { seminar: 'co_present', workshop: 'construction', hackathon: 'code', competition: 'emoji_events', fest: 'celebration', guest_lecture: 'record_voice_over', placement: 'work', recruitment: 'groups' };
  el('wzRoot').innerHTML = `<section class="ev-card-pad"><h2>Start from a template</h2><p class="ev-small" style="margin-bottom:14px">A template fills in sensible questions, sizes and a description outline. You can change all of it.</p>
    <div class="ev-templates">${wz.meta.templates.map(t => `<button type="button" class="ev-template" data-template="${t.key}">${evIcon(icons[t.key] || 'event')}<b>${escapeHtml(t.label)}</b><span>${t.hours >= 24 ? `${t.hours / 24} day` : `${t.hours} hours`}</span></button>`).join('')}
      <button type="button" class="ev-template" data-template="">${evIcon('edit_note')}<b>Start blank</b><span>An empty event</span></button></div></section>
    <section class="ev-card-pad" style="margin-top:16px" id="wzCopy"><h2>Or copy one of your events</h2><p class="ev-small">Loading...</p></section>`;
  el('wzRoot').querySelectorAll('[data-template]').forEach(b => b.addEventListener('click', () => startFrom(b.dataset.template, b)));
  try {
    const mine = await api('/api/me/events');
    const own = mine.organising.filter(e => e.my_role === 'owner' || e.my_role === 'manager');
    el('wzCopy').innerHTML = `<h2>Or copy one of your events</h2>${own.length ? `<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">${own.slice(0, 10).map(e => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <span><b>${escapeHtml(e.title)}</b> <span class="ev-small">${escapeHtml(evDay(e.start_at, { year: 'numeric' }) || 'No date')}</span></span><button type="button" class="ev-btn is-quiet is-small" data-copy="${e.id}">${evIcon('content_copy')}Copy</button></div>`).join('')}</div>`
      : '<p class="ev-small">Events you organise show up here, so you can run them again with one click.</p>'}`;
    el('wzCopy').querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const made = await api(`/api/events/${b.dataset.copy}/duplicate`, { method: 'POST' }); goToDraft(made.id); }
      catch (err) { evToast(err.message); b.disabled = false; }
    }));
  } catch (e) { el('wzCopy').hidden = true; }
}

function defaultTimes(hours) {
  const start = new Date(Date.now() + 7 * 86400000);
  const parts = evParts(start.toISOString());
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const startIso = `${day}T10:00:00+05:30`;
  const end = new Date(new Date(startIso).getTime() + hours * 3600000).toISOString();
  return { start_at: startIso, end_at: end };
}

async function startFrom(key, button) {
  button.disabled = true;
  const template = wz.meta.templates.find(t => t.key === key);
  const values = template ? Object.assign({}, template.values, defaultTimes(template.hours)) : {};
  values.title = template ? `New ${template.label.toLowerCase()}` : 'New event';
  try {
    const made = await api('/api/events', { method: 'POST', body: values });
    goToDraft(made.id);
  } catch (err) { evToast(err.message); button.disabled = false; }
}

function goToDraft(id) {
  wz.id = id;
  history.replaceState(null, '', `event-create.html?id=${id}`);
  loadDraft();
}

async function loadDraft() {
  try { wz.ev = await api(`/api/events/${wz.id}`); }
  catch (err) { el('wzRoot').innerHTML = evEmptyHtml('event_busy', 'Event not found', err.message, '<a class="ev-btn is-quiet" href="my-events.html?tab=organising">My events</a>'); return; }
  if (!wz.ev.my_role || !['owner', 'manager'].includes(wz.ev.my_role)) {
    el('wzRoot').innerHTML = evEmptyHtml('lock', 'Only organisers can edit this event', 'Ask the owner to make you a manager.', `<a class="ev-btn is-quiet" href="event.html?id=${wz.id}">Open the event</a>`);
    return;
  }
  wz.questions = wz.ev.form_fields.map(q => Object.assign({}, q));
  ['agenda', 'speakers', 'faqs', 'sponsors'].forEach(k => { wz.lists[k] = (wz.ev[k] || []).map(item => Object.assign({}, item, k === 'agenda' ? { start: evToInput(item.start), end: evToInput(item.end) } : {})); });
  el('wzTitle').textContent = wz.ev.status === 'draft' ? 'Create an event' : 'Edit event';
  el('wzSub').innerHTML = statusLine();
  renderWizard();
}

function statusLine() {
  const ev = wz.ev;
  return {
    draft: 'Saved as a draft as you go. Nobody else sees it until you submit it.',
    changes: `<b>Changes requested:</b> ${escapeHtml(ev.reviewer_note || '')} Make the changes, then submit again.`,
    pending: 'Waiting for approval. You can still edit it; the approver sees the newest version.',
    published: 'This event is live. Small edits apply at once. Changes to the date, place, audience or seats may need approval again, and registrants are told.',
  }[ev.status] || `Status: ${escapeHtml(ev.display_status)}`;
}

// ---------- the wizard ----------
function renderWizard() {
  el('wzRoot').innerHTML = `<div class="ev-wizard">
    <nav class="ev-wsteps" aria-label="Steps">${WZ_STEPS.map(([key, label], i) => `<button type="button" data-goto="${i}"><span class="ev-wnum">${i + 1}</span>${label}</button>`).join('')}</nav>
    <form class="ev-wpanel" id="wzForm" novalidate>
      <p class="ev-form-error" id="wzError" role="alert"></p>
      ${panelBasics()}${panelWhen()}${panelAudience()}${panelForm()}${panelExtras()}<section data-panel="5" hidden id="wzReview"></section>
      <div class="ev-wfoot"><button type="button" class="ev-btn is-quiet" id="wzBack">Back</button><span class="ev-saved" id="wzSaved" aria-live="polite"></span><button type="button" class="ev-btn" id="wzNext">Next</button></div>
    </form></div>`;
  bindWizard();
  showStep(0);
}

const fieldHtml = (id, label, input, help, required) => `<label class="ev-field" for="${id}"><span class="ev-label">${label}${required ? ' <span class="ev-req">*</span>' : ''}</span>${input}${help ? `<span class="ev-help">${help}</span>` : ''}</label>`;
const valueOf = (value) => escapeHtml(value == null ? '' : String(value));

function panelBasics() {
  const ev = wz.ev;
  const kinds = Object.entries(wz.meta.kinds).map(([key, label]) => `<option value="${key}" ${ev.kind === key ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
  const hosts = [`<option value="0">Myself (${escapeHtml(ev.host && ev.host.kind === 'individual' ? ev.host.name : 'me')})</option>`]
    .concat(wz.hosts.map(h => `<option value="${h.id}" ${ev.host_id === h.id ? 'selected' : ''}>${escapeHtml(h.name)}${h.verified ? ' (verified)' : ''}</option>`)).join('');
  return `<section data-panel="0"><h2>Basics</h2>
    ${fieldHtml('fTitle', 'Title', `<input id="fTitle" data-f="title" maxlength="100" value="${valueOf(ev.title)}" required>`, '5 to 100 characters. Say what it is: "Intro to Git workshop".', true)}
    ${fieldHtml('fTagline', 'Tagline', `<input id="fTagline" data-f="tagline" maxlength="140" value="${valueOf(ev.tagline)}">`, 'One line shown under the title (optional).')}
    <div class="ev-row2">${fieldHtml('fKind', 'Type', `<select id="fKind" data-f="kind">${kinds}</select>`, '', true)}
      ${fieldHtml('fHost', 'Host', `<select id="fHost" data-f="host_id">${hosts}</select>`, `Post as a department or club you manage. <a href="host.html?new=1" style="color:#3525cd">Create a host</a>`)}</div>
    <div class="ev-field"><span class="ev-label">Tags</span><div class="ev-tags" id="fTags">${(ev.tags || []).map(tagChip).join('')}<input id="fTagInput" placeholder="Add a tag and press Enter" maxlength="24" aria-label="Add a tag"></div><span class="ev-help">Up to 5, like AI, Python, Design.</span></div>
    <div class="ev-field"><span class="ev-label">Poster</span><div class="ev-poster-pick"><div id="fPosterView">${evPosterHtml(ev)}</div>
      <div class="ev-actions"><label class="ev-btn is-quiet is-small" style="cursor:pointer">${evIcon('image')}${ev.poster_url ? 'Change' : 'Upload'} poster<input type="file" id="fPoster" accept="image/jpeg,image/png,image/webp" hidden></label>
      ${ev.poster_url ? '<button type="button" class="ev-btn is-quiet is-small" id="fPosterRemove">Remove</button>' : ''}</div></div>
      <span class="ev-help">16:9 works best. JPG, PNG or WebP; we shrink it to 1600 px wide.</span><input type="hidden" data-f="poster_url" id="fPosterUrl" value="${valueOf(ev.poster_url)}"></div>
    <div class="ev-field"><span class="ev-label" id="fDescLabel">Description <span class="ev-req">*</span></span>
      <div class="ev-actions" role="group" aria-label="Description view"><button type="button" class="ev-btn is-quiet is-small" id="fDescEdit" aria-pressed="true">Write</button><button type="button" class="ev-btn is-quiet is-small" id="fDescPreview" aria-pressed="false">Preview</button></div>
      <textarea id="fDesc" data-f="description" maxlength="5000" style="min-height:220px" aria-labelledby="fDescLabel">${valueOf(ev.description)}</textarea><div class="ev-md ev-card-pad" id="fDescView" hidden></div>
      <span class="ev-help">## for a heading, - for a list, **bold**, [link text](https://...). 20 to 5,000 characters. <span id="fDescCount"></span></span></div>
  </section>`;
}
function tagChip(tag) { return `<span class="ev-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}<button type="button" aria-label="Remove ${escapeHtml(tag)}">${evIcon('close')}</button></span>`; }

function panelWhen() {
  const ev = wz.ev;
  const radio = (value, label) => `<label><input type="radio" name="fMode" value="${value}" ${ev.mode === value ? 'checked' : ''}>${label}</label>`;
  return `<section data-panel="1" hidden><h2>When and where</h2>
    <div class="ev-field"><span class="ev-label">Mode</span><div class="ev-chiprow" role="radiogroup">${radio('offline', 'In person')}${radio('online', 'Online')}${radio('hybrid', 'Both')}</div></div>
    <div class="ev-row2">${fieldHtml('fStart', 'Starts (India time)', `<input type="datetime-local" id="fStart" data-f="start_at" data-time value="${evToInput(ev.start_at)}">`, '', true)}
      ${fieldHtml('fEnd', 'Ends', `<input type="datetime-local" id="fEnd" data-f="end_at" data-time value="${evToInput(ev.end_at)}">`, '', true)}</div>
    <div data-when-offline><div class="ev-row2">${fieldHtml('fVenue', 'Venue', `<input id="fVenue" data-f="venue" maxlength="150" value="${valueOf(ev.venue)}" placeholder="Seminar Hall, Main building">`, '', true)}
      ${fieldHtml('fRoom', 'Room', `<input id="fRoom" data-f="room" maxlength="80" value="${valueOf(ev.room)}">`)}</div>
      ${fieldHtml('fAddress', 'Address', `<input id="fAddress" data-f="address" maxlength="300" value="${valueOf(ev.address)}">`)}
      <div class="ev-row2">${fieldHtml('fCity', 'City', `<input id="fCity" data-f="city" maxlength="80" value="${valueOf(ev.city)}">`)}
      ${fieldHtml('fMap', 'Map link', `<input id="fMap" type="url" data-f="map_link" maxlength="500" value="${valueOf(ev.map_link)}" placeholder="https://maps.google.com/...">`)}</div></div>
    <div data-when-online>${fieldHtml('fOnline', 'Online meeting link', `<input id="fOnline" type="url" data-f="online_link" maxlength="500" value="${valueOf(ev.online_link)}" placeholder="https://meet.google.com/...">`, 'Only people whose registration is confirmed see it.', true)}</div>
    <div class="ev-row2">${fieldHtml('fRegOpen', 'Registration opens', `<input type="datetime-local" id="fRegOpen" data-f="reg_open_at" data-time value="${evToInput(ev.reg_open_at)}">`, 'Empty: as soon as it is published.')}
      ${fieldHtml('fRegClose', 'Registration closes', `<input type="datetime-local" id="fRegClose" data-f="reg_close_at" data-time value="${evToInput(ev.reg_close_at)}">`, 'Empty: one hour before the start.')}</div>
    ${fieldHtml('fCutoff', 'People can cancel until (hours before the start)', `<input id="fCutoff" type="number" min="0" max="720" data-f="cancel_cutoff_hours" data-num value="${valueOf(ev.cancel_cutoff_hours)}">`)}
  </section>`;
}

function panelAudience() {
  const ev = wz.ev;
  const elig = ev.eligibility || {};
  const vis = (value, label, help) => `<label class="ev-choice"><input type="radio" name="fVis" value="${value}" ${ev.visibility === value ? 'checked' : ''}><span><b>${label}</b><br><span class="ev-small">${help}</span></span></label>`;
  const check = (field, label, help) => `<label class="ev-choice"><input type="checkbox" data-f="${field}" data-bool ${ev[field] ? 'checked' : ''}><span>${label}${help ? `<br><span class="ev-small">${help}</span>` : ''}</span></label>`;
  return `<section data-panel="2" hidden><h2>Audience and rules</h2>
    <div class="ev-field"><span class="ev-label">Who can see it</span><div class="ev-choices">
      ${vis('public', 'Everyone', 'Anyone, also people not logged in. Public student events also need your college admin or the founder.')}
      ${vis('college', 'My college', `Members of ${escapeHtml(ev.college_name || 'your college')} only.`)}
      ${vis('department', 'My department', 'Only one department of your college.')}
      ${vis('link', 'Invite link only', 'Not listed anywhere; people need the link.')}</div></div>
    <div data-vis-dept>${fieldHtml('fDept', 'Department', `<input id="fDept" data-f="department" maxlength="120" value="${valueOf(ev.department)}">`, '', true)}</div>
    <div class="ev-row2">${fieldHtml('fCap', 'Seats', `<input id="fCap" type="number" min="0" max="100000" data-f="capacity" data-num value="${valueOf(ev.capacity)}">`, '0 means no limit.')}
      ${fieldHtml('fEligDept', 'Only these departments', `<input id="fEligDept" data-elig="departments" value="${valueOf((elig.departments || []).join(', '))}" placeholder="e.g. CSE, IT">`, 'Comma separated. Empty: every department.')}</div>
    ${fieldHtml('fEligColleges', 'Only these colleges', `<input id="fEligColleges" data-elig="colleges" value="${valueOf((elig.colleges || []).join(', '))}" placeholder="Empty: any college">`, 'For public events that are only for some colleges.')}
    <div class="ev-choices">
      ${check('waitlist_on', 'Waitlist when full', 'People join in order and move up when someone cancels.')}
      ${check('manual_approval', 'Approve each registration myself', 'Good for selections and recruitments.')}
      ${check('walkins_on', 'Allow walk-ins at the door', 'Volunteers can register someone on the spot.')}
      <label class="ev-choice"><input type="checkbox" data-elig-bool="verified_only" ${elig.verified_only ? 'checked' : ''}><span>Verified students only</span></label>
      <label class="ev-choice"><input type="checkbox" data-elig-bool="minors_ok" ${elig.minors_ok === false ? '' : 'checked'}><span>Open to students under 18</span></label>
      ${check('is_team_event', 'Team event', 'People make or join teams; each team gets a workspace with chat and calls.')}
    </div>
    <div class="ev-row2" data-team-sizes>${fieldHtml('fTMin', 'Smallest team', `<input id="fTMin" type="number" min="1" max="20" data-f="team_min" data-num value="${valueOf(ev.team_min)}">`)}
      ${fieldHtml('fTMax', 'Largest team', `<input id="fTMax" type="number" min="1" max="20" data-f="team_max" data-num value="${valueOf(ev.team_max)}">`)}</div>
  </section>`;
}

function panelForm() {
  const ev = wz.ev;
  const fields = wz.meta.profile_fields;
  return `<section data-panel="3" hidden><h2>Registration form</h2>
    <div class="ev-field"><span class="ev-label">From their profile (pre-filled, they can edit)</span><div class="ev-chiprow">${Object.entries(fields).map(([key, label]) =>
      `<label><input type="checkbox" data-collect="${key}" ${ev.collect_fields.includes(key) || key === 'name' ? 'checked' : ''} ${key === 'name' ? 'disabled' : ''}>${escapeHtml(label)}</label>`).join('')}</div>
      <span class="ev-help">Ask only for what you need. People see exactly what is shared with you.</span></div>
    <div class="ev-field"><span class="ev-label">Your questions (up to ${wz.meta.max_questions})</span><div class="ev-qlist" id="wzQuestions"></div>
      <button type="button" class="ev-btn is-quiet is-small" id="wzAddQ" style="align-self:flex-start">${evIcon('add')}Add a question</button></div>
  </section>`;
}

function questionEditorHtml(q, i) {
  const types = Object.entries(QUESTION_LABELS).map(([key, label]) => `<option value="${key}" ${q.type === key ? 'selected' : ''}>${label}</option>`).join('');
  const needsOptions = ['dropdown', 'multi', 'radio'].includes(q.type);
  return `<div class="ev-q" data-qi="${i}">
    <div class="ev-q-head"><input type="text" class="ev-field-input" data-qf="label" value="${valueOf(q.label)}" placeholder="Question" maxlength="200" aria-label="Question ${i + 1}" style="flex:1;border:1px solid #c7c4d8;border-radius:10px;padding:8px 10px;font:400 14px Inter,sans-serif">
      <select data-qf="type" aria-label="Answer type" class="ev-select" style="height:38px">${types}</select></div>
    ${needsOptions ? `<label class="ev-field"><span class="ev-help">Choices, one per line</span><textarea data-qf="options" rows="3" style="min-height:70px">${valueOf((q.options || []).join('\n'))}</textarea></label>` : ''}
    <input type="text" data-qf="help" value="${valueOf(q.help)}" placeholder="Help text (optional)" maxlength="300" aria-label="Help text" style="border:1px solid #c7c4d8;border-radius:10px;padding:8px 10px;font:400 13px Inter,sans-serif">
    <div class="ev-actions" style="justify-content:space-between"><label class="ev-choice"><input type="checkbox" data-qf="required" ${q.required ? 'checked' : ''}>Required</label>
      <span class="ev-actions"><button type="button" class="ev-iconbtn" data-qmove="-1" aria-label="Move up">${evIcon('arrow_upward')}</button><button type="button" class="ev-iconbtn" data-qmove="1" aria-label="Move down">${evIcon('arrow_downward')}</button><button type="button" class="ev-iconbtn" data-qdel aria-label="Delete question">${evIcon('delete')}</button></span></div>
  </div>`;
}

function panelExtras() {
  const ev = wz.ev;
  return `<section data-panel="4" hidden><h2>Speakers, agenda, FAQs and contact</h2><p class="ev-small">All optional. Everything here shows on the event page.</p>
    ${Object.keys(LIST_FIELDS).map(key => `<div class="ev-field"><span class="ev-label">${LIST_TITLES[key][0]}</span><div class="ev-listedit" data-list="${key}"></div>
      <button type="button" class="ev-btn is-quiet is-small" data-list-add="${key}" style="align-self:flex-start">${evIcon('add')}${LIST_TITLES[key][1]}</button></div>`).join('')}
    <div class="ev-row2">${fieldHtml('fCName', 'Contact person', `<input id="fCName" data-f="contact_name" maxlength="80" value="${valueOf(ev.contact && ev.contact.name)}">`, 'Shown only to registered people.')}
      ${fieldHtml('fCPhone', 'Contact phone', `<input id="fCPhone" type="tel" data-f="contact_phone" maxlength="20" value="${valueOf(ev.contact && ev.contact.phone)}">`)}</div>
    ${fieldHtml('fCEmail', 'Contact email', `<input id="fCEmail" type="email" data-f="contact_email" maxlength="200" value="${valueOf(ev.contact && ev.contact.email)}">`)}
    ${fieldHtml('fGroup', 'WhatsApp or Discord group link', `<input id="fGroup" type="url" data-f="group_link" maxlength="500" value="${valueOf(ev.group_link)}" placeholder="https://chat.whatsapp.com/...">`, 'Shown only after someone registers.')}
    <div class="ev-choices">
      <label class="ev-choice"><input type="checkbox" data-f="takes_photos" data-bool ${ev.takes_photos ? 'checked' : ''}><span>Photos or videos will be taken (people are told before they register)</span></label>
      <label class="ev-choice"><input type="checkbox" data-f="certificates_on" data-bool ${ev.certificates_on ? 'checked' : ''}><span>Give participation certificates to everyone checked in</span></label>
    </div>
  </section>`;
}

function listRowHtml(key, item, i) {
  return `<div class="ev-listedit-row" data-row="${i}"><button type="button" class="ev-iconbtn ev-remove" data-list-del="${key}" aria-label="Remove">${evIcon('close')}</button>
    ${LIST_FIELDS[key].map(([field, label, type, extra]) => {
      const value = item[field] || '';
      const id = `l_${key}_${i}_${field}`;
      if (type === 'textarea') return fieldHtml(id, label, `<textarea id="${id}" data-lf="${field}" maxlength="${extra}" style="min-height:60px">${valueOf(value)}</textarea>`);
      if (type === 'select') return fieldHtml(id, label, `<select id="${id}" data-lf="${field}">${extra.map(o => `<option ${value === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`);
      return fieldHtml(id, label, `<input id="${id}" type="${type}" data-lf="${field}" ${extra ? `maxlength="${extra}"` : ''} value="${valueOf(value)}">`);
    }).join('')}</div>`;
}

function renderLists() {
  Object.keys(LIST_FIELDS).forEach(key => {
    const box = document.querySelector(`[data-list="${key}"]`);
    box.innerHTML = (wz.lists[key] || []).map((item, i) => listRowHtml(key, item, i)).join('');
  });
}
function readLists() {
  Object.keys(LIST_FIELDS).forEach(key => {
    wz.lists[key] = [...document.querySelectorAll(`[data-list="${key}"] [data-row]`)].map(row =>
      Object.fromEntries([...row.querySelectorAll('[data-lf]')].map(input => [input.dataset.lf, input.value.trim()])));
  });
}

function renderQuestions() {
  el('wzQuestions').innerHTML = wz.questions.length ? wz.questions.map(questionEditorHtml).join('') : '<p class="ev-small">No questions yet. Add one, or leave the form with just the profile fields.</p>';
  el('wzAddQ').disabled = wz.questions.length >= wz.meta.max_questions;
}
function readQuestions() {
  document.querySelectorAll('[data-qi]').forEach(node => {
    const q = wz.questions[Number(node.dataset.qi)];
    q.label = node.querySelector('[data-qf="label"]').value.trim();
    q.type = node.querySelector('[data-qf="type"]').value;
    const options = node.querySelector('[data-qf="options"]');
    q.options = options ? options.value.split('\n').map(o => o.trim()).filter(Boolean) : (q.options || []);
    q.help = node.querySelector('[data-qf="help"]').value.trim();
    q.required = node.querySelector('[data-qf="required"]').checked;
  });
}

// ---------- behaviour ----------
function bindWizard() {
  const form = el('wzForm');
  form.addEventListener('input', () => { wz.dirty = true; updateCounts(); });
  form.addEventListener('change', (e) => {
    wz.dirty = true;
    if (e.target.name === 'fMode' || e.target.name === 'fVis' || e.target.dataset.f === 'is_team_event') toggleSections();
    if (e.target.dataset.qf === 'type') { readQuestions(); renderQuestions(); }
  });
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => goTo(Number(b.dataset.goto))));
  el('wzBack').addEventListener('click', () => goTo(wz.step - 1));
  el('wzNext').addEventListener('click', () => wz.step < WZ_STEPS.length - 1 ? goTo(wz.step + 1) : null);
  // tags
  el('fTagInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const value = e.target.value.trim().replace(/,/g, '');
    if (!value) return;
    if (document.querySelectorAll('#fTags [data-tag]').length >= 5) return evToast('Up to 5 tags.');
    e.target.insertAdjacentHTML('beforebegin', tagChip(value));
    e.target.value = '';
    wz.dirty = true;
  });
  el('fTags').addEventListener('click', (e) => { const chip = e.target.closest('.ev-tag button'); if (chip) { chip.parentElement.remove(); wz.dirty = true; } });
  // poster
  el('fPoster').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    el('fPosterView').innerHTML = '<div class="ev-poster skeleton"></div>';
    try {
      el('fPosterUrl').value = await evUploadPicture(file, 1600);
      wz.dirty = true;
      el('fPosterView').innerHTML = evPosterHtml({ poster_url: el('fPosterUrl').value });
      save();
    } catch (err) { evToast(err.message); el('fPosterView').innerHTML = evPosterHtml(wz.ev); }
  });
  const remove = el('fPosterRemove');
  if (remove) remove.addEventListener('click', () => { el('fPosterUrl').value = ''; el('fPosterView').innerHTML = evPosterHtml({ kind: wz.ev.kind, kind_label: wz.ev.kind_label }); wz.dirty = true; });
  // description preview
  el('fDescEdit').addEventListener('click', () => toggleDesc(false));
  el('fDescPreview').addEventListener('click', () => toggleDesc(true));
  // questions
  el('wzAddQ').addEventListener('click', () => { readQuestions(); wz.questions.push({ key: '', label: '', type: 'short', options: [], required: false, help: '' }); renderQuestions(); wz.dirty = true;
    const last = el('wzQuestions').querySelector('.ev-q:last-child [data-qf="label"]'); if (last) last.focus(); });
  el('wzQuestions').addEventListener('click', (e) => {
    const node = e.target.closest('[data-qi]');
    if (!node) return;
    const i = Number(node.dataset.qi);
    if (e.target.closest('[data-qdel]')) { readQuestions(); wz.questions.splice(i, 1); renderQuestions(); wz.dirty = true; }
    const move = e.target.closest('[data-qmove]');
    if (move) {
      readQuestions();
      const j = i + Number(move.dataset.qmove);
      if (j < 0 || j >= wz.questions.length) return;
      [wz.questions[i], wz.questions[j]] = [wz.questions[j], wz.questions[i]];
      renderQuestions();
      wz.dirty = true;
    }
  });
  // lists
  document.querySelectorAll('[data-list-add]').forEach(b => b.addEventListener('click', () => { readLists(); (wz.lists[b.dataset.listAdd] = wz.lists[b.dataset.listAdd] || []).push({}); renderLists(); wz.dirty = true; }));
  form.addEventListener('click', (e) => {
    const del = e.target.closest('[data-list-del]');
    if (!del) return;
    readLists();
    wz.lists[del.dataset.listDel].splice(Number(del.closest('[data-row]').dataset.row), 1);
    renderLists();
    wz.dirty = true;
  });
  renderQuestions();
  renderLists();
  toggleSections();
  updateCounts();
  // autosave every 30 seconds, and a warning before leaving with unsaved changes
  setInterval(() => { if (wz.dirty && !wz.saving) save(); }, 30000);
  window.addEventListener('beforeunload', (e) => { if (wz.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

function toggleDesc(preview) {
  el('fDescEdit').setAttribute('aria-pressed', !preview);
  el('fDescPreview').setAttribute('aria-pressed', preview);
  el('fDesc').hidden = preview;
  el('fDescView').hidden = !preview;
  if (preview) el('fDescView').innerHTML = mdToHtml(el('fDesc').value, { links: true }) || '<p class="ev-small">Nothing written yet.</p>';
}

function updateCounts() { el('fDescCount').textContent = `${el('fDesc').value.length} / 5000`; }

function toggleSections() {
  const mode = (document.querySelector('[name="fMode"]:checked') || {}).value || 'offline';
  document.querySelector('[data-when-offline]').hidden = mode === 'online';
  document.querySelector('[data-when-online]').hidden = mode === 'offline';
  const vis = (document.querySelector('[name="fVis"]:checked') || {}).value;
  document.querySelector('[data-vis-dept]').hidden = vis !== 'department';
  document.querySelector('[data-team-sizes]').hidden = !document.querySelector('[data-f="is_team_event"]').checked;
}

function collect() {
  readQuestions();
  readLists();
  const body = { updated_at: wz.ev.updated_at };
  document.querySelectorAll('[data-f]').forEach(input => {
    const field = input.dataset.f;
    if (input.dataset.bool !== undefined) body[field] = input.checked;
    else if (input.dataset.num !== undefined) body[field] = input.value === '' ? 0 : Number(input.value);
    else if (input.dataset.time !== undefined) body[field] = evFromInput(input.value);
    else if (field === 'host_id') body[field] = Number(input.value);
    else body[field] = input.value;
  });
  body.mode = (document.querySelector('[name="fMode"]:checked') || {}).value || 'offline';
  body.visibility = (document.querySelector('[name="fVis"]:checked') || {}).value || 'college';
  body.tags = [...document.querySelectorAll('#fTags [data-tag]')].map(t => t.dataset.tag);
  body.eligibility = {
    departments: el('fEligDept').value.split(',').map(s => s.trim()).filter(Boolean),
    colleges: el('fEligColleges').value.split(',').map(s => s.trim()).filter(Boolean),
    verified_only: document.querySelector('[data-elig-bool="verified_only"]').checked,
    minors_ok: document.querySelector('[data-elig-bool="minors_ok"]').checked
  };
  body.collect_fields = [...document.querySelectorAll('[data-collect]:checked')].map(c => c.dataset.collect);
  body.form_fields = wz.questions.filter(q => q.label);
  body.agenda = (wz.lists.agenda || []).filter(i => i.title).map(i => Object.assign({}, i, { start: evFromInput(i.start), end: evFromInput(i.end) }));
  body.speakers = (wz.lists.speakers || []).filter(i => i.name);
  body.faqs = (wz.lists.faqs || []).filter(i => i.q);
  body.sponsors = (wz.lists.sponsors || []).filter(i => i.name);
  return body;
}

function clientProblem() {
  const title = el('fTitle').value.trim();
  if (title.length < 5) return [0, 'fTitle', 'Give the event a title of at least 5 characters.'];
  const start = el('fStart').value, end = el('fEnd').value;
  if (start && end && end <= start) return [1, 'fEnd', 'The event must end after it starts.'];
  return null;
}

async function save(quiet) {
  if (wz.saving) return false;
  const problem = clientProblem();
  if (problem && quiet !== 'force') return false;
  wz.saving = true;
  el('wzSaved').textContent = 'Saving...';
  const body = collect();
  try {
    const result = await api(`/api/events/${wz.id}`, { method: 'PATCH', body });
    wz.ev.updated_at = result.updated_at;
    wz.dirty = false;
    wz.savedAt = new Date();
    el('wzSaved').textContent = result.pending_changes ? 'Saved. Big changes wait for approval.' : `Saved ${evTime(wz.savedAt.toISOString())}`;
    showError('');
    wz.saving = false;
    return true;
  } catch (err) {
    wz.saving = false;
    el('wzSaved').textContent = 'Not saved';
    if (err.status === 409 && err.data && err.data.event) {
      showError(err.data.message);
      wz.ev = err.data.event;
      wz.dirty = false;
      setTimeout(loadDraft, 1500);
      return false;
    }
    showError(err.message);
    return false;
  }
}

function showError(text) {
  const node = el('wzError');
  node.textContent = text || '';
  node.classList.toggle('is-shown', !!text);
  if (text) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function goTo(step) {
  if (step < 0 || step >= WZ_STEPS.length || step === wz.step) return;
  if (wz.dirty) await save();
  showStep(step);
}

function showStep(step) {
  wz.step = step;
  document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = Number(p.dataset.panel) !== step; });
  document.querySelectorAll('[data-goto]').forEach((b, i) => {
    if (i === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    b.classList.toggle('is-done', i < step);
  });
  el('wzBack').style.visibility = step ? 'visible' : 'hidden';
  el('wzNext').hidden = step === WZ_STEPS.length - 1;
  if (step === WZ_STEPS.length - 1) renderReview();
  const heading = document.querySelector(`[data-panel="${step}"] h2`);
  if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function renderReview() {
  const box = el('wzReview');
  box.innerHTML = '<h2>Review and submit</h2><p class="ev-small">Checking...</p>';
  if (wz.dirty) await save();
  try { wz.ev = await api(`/api/events/${wz.id}`); } catch (e) { /* keep what we have */ }
  const ev = wz.ev;
  const problem = clientProblem();
  const missing = (ev.missing || []).concat(problem ? [problem[2]] : []);
  const good = [ev.poster_url ? 'Poster added' : null, ev.description && ev.description.length >= 20 ? 'Description written' : null, ev.start_at ? `On ${evRange(ev.start_at, ev.end_at)}` : null,
    ev.capacity ? `${ev.capacity} seats${ev.waitlist_on ? ', with a waitlist' : ''}` : 'No seat limit', `${ev.form_fields.length} question${ev.form_fields.length === 1 ? '' : 's'} on the form`].filter(Boolean);
  const canSubmit = ['draft', 'changes'].includes(ev.status);
  box.innerHTML = `<h2>Review and submit</h2>
    <div class="ev-checklist">${missing.map(m => `<div class="ev-check is-missing">${evIcon('error')}${escapeHtml(m)}</div>`).join('')}${good.map(g => `<div class="ev-check is-ok">${evIcon('check_circle')}${escapeHtml(g)}</div>`).join('')}
      ${!ev.poster_url ? `<div class="ev-check">${evIcon('lightbulb')}A poster gets more people to open the event (optional).</div>` : ''}</div>
    <div class="ev-note">${evIcon('info')}<span>${canSubmit ? 'Teachers, admins and approved organisers publish at once. Student events go to a teacher of your college first; public ones also to the college admin or the founder.' : statusLine()}</span></div>
    <div class="ev-actions">
      <a class="ev-btn is-quiet" href="event.html?id=${ev.id}" target="_blank" rel="noopener">${evIcon('visibility')}Preview as a participant</a>
      <button type="button" class="ev-btn is-quiet" id="wzSaveNow">${evIcon('save')}Save draft</button>
      ${canSubmit ? `<button type="button" class="ev-btn" id="wzSubmit" ${missing.length ? 'disabled' : ''}>${evIcon('send')}Submit</button>` : `<a class="ev-btn" href="event-manage.html?id=${ev.id}">${evIcon('dashboard')}Open the dashboard</a>`}
    </div>`;
  el('wzSaveNow').addEventListener('click', async () => { if (await save('force')) evToast('Draft saved.'); });
  const submit = el('wzSubmit');
  if (submit) submit.addEventListener('click', async () => {
    submit.disabled = true;
    if (wz.dirty && !(await save('force'))) { submit.disabled = false; return; }
    try {
      const result = await api(`/api/events/${wz.id}/submit`, { method: 'POST' });
      wz.dirty = false;
      const text = result.status === 'published' ? 'Published! People can see and register for it now.' : 'Sent for approval. You will be told when it is decided.';
      box.innerHTML = `<div class="ev-success">${evIcon(result.status === 'published' ? 'celebration' : 'pending')}<h3>${result.status === 'published' ? 'Your event is live' : 'Sent for approval'}</h3>
        <p class="ev-small" style="font-size:15px">${text}</p></div><div class="ev-actions" style="justify-content:center"><a class="ev-btn" href="event-manage.html?id=${wz.id}">${evIcon('dashboard')}Open the dashboard</a>
        <a class="ev-btn is-quiet" href="event.html?id=${wz.id}">${evIcon('visibility')}See the event page</a></div>`;
    } catch (err) { showError(err.message); submit.disabled = false; }
  });
}

initWizard();
