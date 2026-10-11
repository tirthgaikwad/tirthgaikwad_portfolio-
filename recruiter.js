// ==========================================
// RECRUITER.JS — Recruiter search (recruiter.html): verified talent, GitHub-backed filters, contact unlocks,
// a shortlist with stages, and seats for colleagues. Needs a Recruiter plan (or the founder).
// Loaded after shared.js, chat-common.js and pages-common.js.
// ==========================================

const R = { me: null, people: [], shortlist: [], stages: [], tab: 'search', loading: false,
            filters: { q: '', skills: '', college: '', department: '', city: '', open_to: '', contactable: true, has_github: false, min_repos: 0 } };
const STAGE_LABELS = { shortlisted: 'Shortlisted', contacted: 'Contacted', interviewing: 'Interviewing', offer: 'Offer made', hired: 'Hired', rejected: 'Not a fit' };

async function loadRecruiter() {
  try {
    R.me = await api('/api/recruiter/me');
  } catch (err) {
    el('recBody').innerHTML = stateBlock('cloud_off', 'Could not load Recruiter search', escapeHtml(err.message));
    return;
  }
  if (!R.me.access) return renderPaywall();
  renderHead();
  if (R.tab === 'search') search(); else if (R.tab === 'shortlist') loadShortlist(); else renderSeats();
}

function renderPaywall() {
  el('recTabs').classList.add('ch-hidden');
  el('recHead').innerHTML = '';
  el('recBody').innerHTML = `<div class="ch-panel rc-pay">
    <div>${icon('person_search')}<h2>Hire verified students and professionals</h2>
    <p>Recruiter access lets you search people whose college has verified them, filter by real GitHub activity, and contact those who are open to opportunities.</p>
    <ul class="pr-features">${['Only verified accounts, so every result is a real student or professional', 'Filter by skills, college, department, city and GitHub repositories',
      'Contact people who said recruiters may reach them', 'Shortlists with stages and notes, CSV export and seats for your team'].map(t => `<li>${icon('check')}<span>${escapeHtml(t)}</span></li>`).join('')}</ul>
    <div class="ap-actions"><a class="ch-btn solid" href="pricing.html?tab=recruiter">${icon('sell')}See recruiter plans</a></div></div>
  </div>`;
}

function renderHead() {
  const a = R.me.access;
  el('recTabs').classList.remove('ch-hidden');
  el('tabSeats').classList.toggle('ch-hidden', !(a.owner && a.sub_id));
  el('recTabs').querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === R.tab)));
  el('recHead').innerHTML = `
    <div class="ch-stat"><b>${escapeHtml(a.name)}</b><span>${a.sub_id ? (a.owner ? 'your plan' : 'seat on a colleague\'s plan') : 'founder access'}</span></div>
    <div class="ch-stat"><b>${R.me.unlocks_used}${a.unlocks === null ? '' : ` / ${a.unlocks}`}</b><span>contacts this month</span></div>
    ${a.ends_at ? `<div class="ch-stat"><b>${escapeHtml(formatDate(a.ends_at))}</b><span>plan ends</span></div>` : ''}`;
}

// ---------- search ----------
async function search() {
  renderFilters();
  el('recResults').innerHTML = '<div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:120px"></div>';
  const params = new URLSearchParams();
  Object.entries(R.filters).forEach(([key, value]) => { if (value !== '' && value !== false && value !== 0) params.set(key, value); });
  try {
    const data = await api(`/api/recruiter/search?${params}`);
    R.people = data.people;
    renderResults();
  } catch (err) {
    el('recResults').innerHTML = stateBlock('cloud_off', 'Search failed', escapeHtml(err.message));
  }
}

function renderFilters() {
  const f = R.filters;
  const git = R.me.access.git_filters;
  el('recBody').innerHTML = `<div class="rc-layout">
    <aside class="ch-panel rc-filters">
      <h3>Filters</h3>
      <label>Keywords<input class="ch-input" data-filter="q" value="${escapeHtml(f.q)}" placeholder="Name, bio or skill"></label>
      <label>Must have all these skills<input class="ch-input" data-filter="skills" value="${escapeHtml(f.skills)}" placeholder="React, Node.js"></label>
      <label>College<input class="ch-input" data-filter="college" value="${escapeHtml(f.college)}"></label>
      <label>Department<input class="ch-input" data-filter="department" value="${escapeHtml(f.department)}"></label>
      <label>City<input class="ch-input" data-filter="city" value="${escapeHtml(f.city)}"></label>
      <label>Open to<select class="ch-select" data-filter="open_to"><option value="">Anything</option>${['hiring', 'internships', 'collaboration', 'mentoring', 'consulting'].map(o => `<option value="${o}" ${f.open_to === o ? 'selected' : ''}>${o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select></label>
      <label class="ch-check"><input type="checkbox" data-filter="contactable" ${f.contactable ? 'checked' : ''}>Only people open to recruiters</label>
      <div class="rc-git${git ? '' : ' is-locked'}">
        <h4>${icon('code')}GitHub ${git ? '' : '<span class="ch-chip">Growth plan</span>'}</h4>
        <label class="ch-check"><input type="checkbox" data-filter="has_github" ${f.has_github ? 'checked' : ''} ${git ? '' : 'disabled'}>Has a GitHub account</label>
        <label>At least this many public repos<input class="ch-input" type="number" min="0" max="500" data-filter="min_repos" value="${f.min_repos || ''}" ${git ? '' : 'disabled'}></label>
      </div>
      <button class="ch-btn solid" type="button" data-act="search" style="width:100%">${icon('search')}Search</button>
    </aside>
    <div id="recResults" class="rc-results"></div>
  </div>`;
}

function readFilters() {
  document.querySelectorAll('[data-filter]').forEach(box => {
    const key = box.dataset.filter;
    R.filters[key] = box.type === 'checkbox' ? box.checked : (key === 'min_repos' ? Number(box.value) || 0 : box.value.trim());
  });
}

function renderResults() {
  if (!R.people.length) {
    el('recResults').innerHTML = stateBlock('person_search', 'No one matches yet', 'Only verified accounts are shown. Try fewer skills or untick “Only people open to recruiters”.');
    return;
  }
  el('recResults').innerHTML = `<p class="ch-muted">${plural(R.people.length, 'verified person', 'verified people')}</p>` + R.people.map(personHtml).join('');
}

function personHtml(p) {
  const skills = (p.skills || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
  const gh = p.github;
  return `<article class="ch-panel rc-person" data-person="${p.id}">
    <div class="rc-person-top">${avatarOf(p)}
      <div style="flex:1;min-width:0"><h3><a href="profile.html?id=${p.id}" target="_blank" rel="noopener">${escapeHtml(p.name)}</a> <span class="material-symbols-outlined ch-ico" style="color:#3525cd" title="Verified">verified</span></h3>
      <p class="vd-meta">${escapeHtml([p.profession && p.profession !== 'Student' ? p.profession : '', p.college, p.department, p.city].filter(Boolean).join(' · '))}</p></div>
      <select class="ch-select rc-stage" data-stage="${p.id}" aria-label="Shortlist stage"><option value="">${p.stage ? 'Remove from shortlist' : 'Add to shortlist'}</option>${R.stages.length ? '' : ''}${Object.entries(STAGE_LABELS).map(([k, v]) => `<option value="${k}" ${p.stage === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    ${p.bio ? `<p class="rc-bio">${escapeHtml(p.bio)}</p>` : ''}
    <div class="ch-group-tags">${skills.map(s => `<span class="ch-chip">${escapeHtml(s)}</span>`).join('')}</div>
    ${p.github_username ? `<div class="rc-gh">${icon('code')}<a class="msg-link" href="https://github.com/${encodeURIComponent(p.github_username)}" target="_blank" rel="noopener">@${escapeHtml(p.github_username)}</a>
      ${gh ? `<span>${gh.repos} repos</span><span>${gh.followers} followers</span><span>${gh.stars} stars</span>${gh.languages.length ? `<span>${escapeHtml(gh.languages.slice(0, 4).join(', '))}</span>` : ''}` : '<span class="ch-muted">stats loading on the next search</span>'}</div>` : ''}
    <div class="rc-person-foot">
      ${p.open_to ? `<span class="ch-muted">Open to ${escapeHtml(p.open_to.split(',').join(', '))}</span>` : ''}
      <span class="ch-spacer"></span>
      ${p.unlocked ? `<a class="ch-btn solid small" href="inbox.html?user=${p.id}">${icon('chat')}Message</a>`
        : p.contact_ok ? `<button class="ch-btn solid small" type="button" data-unlock="${p.id}">${icon('lock_open')}Unlock contact</button>`
        : '<span class="ch-chip">Not open to recruiters</span>'}
    </div>
  </article>`;
}

async function unlock(id, button) {
  button.disabled = true;
  const result = await attempt(() => api(`/api/recruiter/unlock/${id}`, { method: 'POST' }));
  if (!result) { button.disabled = false; return; }
  const person = R.people.find(p => p.id === id);
  if (person) person.unlocked = true;
  R.me.unlocks_used += 1;
  renderHead();
  renderResults();
  window.showSystemModal('Contact unlocked', `You can now message ${escapeHtml(person ? person.name : 'them')}.${result.email ? ` Their email: <b>${escapeHtml(result.email)}</b>` : ''}`, 'confirm', () => { window.location.href = result.message_url; }, 'Message now');
}

// ---------- shortlist ----------
async function loadShortlist() {
  el('recBody').innerHTML = '<div class="skeleton" style="height:160px"></div>';
  try {
    const data = await api('/api/recruiter/shortlist');
    R.shortlist = data.shortlist;
    renderShortlist();
  } catch (err) {
    el('recBody').innerHTML = stateBlock('cloud_off', 'Could not load the shortlist', escapeHtml(err.message));
  }
}

function renderShortlist() {
  const csv = R.me.access.csv;
  const counts = Object.keys(STAGE_LABELS).map(stage => [stage, R.shortlist.filter(s => s.stage === stage).length]);
  el('recBody').innerHTML = `
    <div class="ch-bar"><h2 class="ch-bar-title">Shortlist<small>${R.shortlist.length}</small></h2>
      ${counts.map(([stage, n]) => `<span class="ch-chip">${STAGE_LABELS[stage]} ${n}</span>`).join('')}
      <button class="ch-btn line" type="button" data-act="csv" ${csv ? '' : 'disabled title="CSV export is in the Growth plan"'}>${icon('download')}Download CSV</button></div>
    ${R.shortlist.length ? `<div class="ch-panel bl-table"><table class="ch-table"><thead><tr><th>Person</th><th>Stage</th><th>Note</th><th></th></tr></thead><tbody>
      ${R.shortlist.map(s => `<tr><td><a class="msg-link" href="profile.html?id=${s.user_id}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a><br><small class="ch-muted">${escapeHtml([s.college, s.department].filter(Boolean).join(' · '))}</small></td>
        <td><select class="ch-select" data-stage="${s.user_id}" aria-label="Stage">${Object.entries(STAGE_LABELS).map(([k, v]) => `<option value="${k}" ${s.stage === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td><input class="ch-input" data-note="${s.user_id}" value="${escapeHtml(s.note)}" maxlength="1000" placeholder="Add a note"></td>
        <td><button class="ch-icon-btn danger" type="button" data-remove="${s.user_id}" title="Remove" aria-label="Remove ${escapeHtml(s.name)}"><span class="material-symbols-outlined">delete</span></button></td></tr>`).join('')}
    </tbody></table></div>` : stateBlock('bookmarks', 'Your shortlist is empty', 'Add people from Search with the stage menu on each card.')}`;
}

async function saveStage(userId, stage, note) {
  if (!stage) {
    await attempt(() => api(`/api/recruiter/shortlist/${userId}`, { method: 'DELETE' }), 'Removed from the shortlist.');
  } else {
    await attempt(() => api('/api/recruiter/shortlist', { method: 'POST', body: { user_id: userId, stage, note: note || '' } }), 'Saved.');
  }
  const person = R.people.find(p => p.id === userId);
  if (person) person.stage = stage;
  const entry = R.shortlist.find(s => s.user_id === userId);
  if (entry) { entry.stage = stage || entry.stage; if (note !== undefined) entry.note = note; }
}

// ---------- seats ----------
function renderSeats() {
  const a = R.me.access;
  el('recBody').innerHTML = `<div class="ch-panel rc-seats">
    <h3>Seats</h3><p class="ch-muted">${escapeHtml(a.name)} includes ${a.seats} seat${a.seats === 1 ? '' : 's'}, yours included. Colleagues need a Connect2Minds account.</p>
    ${R.me.seat_members.map(m => `<div class="rc-seat">${icon('person')}<span>${escapeHtml(m.name)} <small class="ch-muted">${escapeHtml(m.email)}</small></span><span class="ch-spacer"></span>
      <button class="ch-btn line small danger" type="button" data-unseat="${m.id}">Remove</button></div>`).join('') || '<p class="ch-muted">No colleagues yet.</p>'}
    <div class="ap-inline"><input class="ch-input" id="seatEmail" type="email" placeholder="colleague@company.com"><button class="ch-btn solid" type="button" data-act="add-seat">${icon('person_add')}Add</button></div>
  </div>`;
}

document.querySelector('main').addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    R.tab = tab.dataset.tab;
    renderHead();
    if (R.tab === 'search') return search();
    if (R.tab === 'shortlist') return loadShortlist();
    return renderSeats();
  }
  const button = e.target.closest('[data-act], [data-unlock], [data-remove], [data-unseat]');
  if (!button) return;
  if (button.dataset.unlock) return unlock(Number(button.dataset.unlock), button);
  if (button.dataset.remove) { await saveStage(Number(button.dataset.remove), ''); return loadShortlist(); }
  if (button.dataset.unseat) {
    await attempt(() => api(`/api/recruiter/seats/${button.dataset.unseat}`, { method: 'DELETE' }), 'Seat removed.');
    return loadRecruiter();
  }
  const act = button.dataset.act;
  if (act === 'search') { readFilters(); return search(); }
  if (act === 'csv') {
    return downloadCsv([['Name', 'College', 'Department', 'Skills', 'GitHub', 'Stage', 'Note', 'Updated']].concat(
      R.shortlist.map(s => [s.name, s.college, s.department, s.skills, s.github_username ? `https://github.com/${s.github_username}` : '', STAGE_LABELS[s.stage] || s.stage, s.note, s.updated_at])), 'shortlist.csv');
  }
  if (act === 'add-seat') {
    const email = el('seatEmail').value.trim();
    if (!email) return;
    const ok = await attempt(() => api('/api/recruiter/seats', { method: 'POST', body: { email } }), 'Colleague added.');
    if (ok) loadRecruiter();
  }
});

document.querySelector('main').addEventListener('change', (e) => {
  if (e.target.dataset.stage !== undefined) {
    const userId = Number(e.target.dataset.stage);
    const note = R.shortlist.find(s => s.user_id === userId);
    saveStage(userId, e.target.value, note ? note.note : '');
  }
  if (e.target.dataset.note !== undefined) {
    const userId = Number(e.target.dataset.note);
    const entry = R.shortlist.find(s => s.user_id === userId);
    if (entry) saveStage(userId, entry.stage, e.target.value);
  }
});
document.querySelector('main').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.filter !== undefined) { readFilters(); search(); }
});

bindModal();
loadRecruiter();
