// ==========================================
// CAMPUS.JS — The Campus Network page: everyone from our own college, with search, filters and live updates
// Loaded after shared.js and chat-common.js (api, caches, toast, el, onlineUserIds, the people-card helpers).
// ==========================================

const CAMPUS_PER_PAGE = 9;
const CAMPUS_REFRESH_MS = 60000;
const CAMPUS_TOGGLES = ['online', 'verified', 'following', 'saved'];

let campus = { college: '', department: '' };   // our own college and department
let classmates = [];                            // everyone else from the college, as returned by /api/campus
let classmatesById = new Map();
let campusLoaded = false;
let campusLoading = false;
let campusLoadedAt = 0;
let campusSkills = new Set();

// What the person has typed and picked. Mirrored in the address bar.
const campusView = { q: '', dept: '', sort: 'match', online: false, verified: false, following: false, saved: false, page: 1 };
const campusPending = new Set();
let campusSearchTimer = null;
let campusRenderQueued = false;

// ==========================================
// 1. LOADING
// ==========================================
function initCampus() {
  readCampusUrl();
  campusSkills = ownSkillSet();
  bindCampusControls();
  syncCampusControls();

  // 1. The copy saved on the last visit, so the page is never blank
  const cached = cacheGet('campus');
  if (cached && Array.isArray(cached.people)) setCampus(cached, []);
  else el('campusGrid').innerHTML = peopleSkeletonHtml(6);

  // 2. The real thing (already requested from the page head)
  loadCampus();
  connectNotifications((data) => { if (campusLoaded) handleCampusEvent(data); }, loadCampus);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - campusLoadedAt > CAMPUS_REFRESH_MS) loadCampus();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadCampus(); });
}

async function loadCampus() {
  if (campusLoading) return;
  campusLoading = true;
  try {
    const data = await fetchPageData('/api/campus');
    campusLoadedAt = Date.now();
    setCampus(data, data.online_user_ids || []);
    saveCampus();
  } catch (err) {
    if (!campusLoaded) renderCampusProblem(err.message);
  } finally {
    campusLoading = false;
  }
}

function setCampus(data, onlineIds) {
  campus = { college: data.college || '', department: data.department || '' };
  classmates = (data.people || []).map(indexPerson);
  classmatesById = new Map(classmates.map(person => [person.id, person]));
  onlineUserIds = new Set(onlineIds);
  campusSkills = ownSkillSet();
  campusLoaded = true;
  renderCampus();
}

function saveCampus() {
  cacheSet('campus', { college: campus.college, department: campus.department, people: classmates.map(plainPerson) });
}

// ==========================================
// 2. ADDRESS BAR
// ==========================================
function readCampusUrl() {
  const params = new URLSearchParams(window.location.search);
  campusView.q = (params.get('q') || '').trim();
  campusView.dept = norm(params.get('dept'));
  campusView.sort = ['match', 'name', 'followers', 'newest'].includes(params.get('sort')) ? params.get('sort') : 'match';
  CAMPUS_TOGGLES.forEach(key => { campusView[key] = params.get(key) === '1'; });
  campusView.page = Math.max(1, parseInt(params.get('page')) || 1);
}

function writeCampusUrl() {
  const params = new URLSearchParams();
  if (campusView.q) params.set('q', campusView.q);
  if (campusView.dept) params.set('dept', campusView.dept);
  if (campusView.sort !== 'match') params.set('sort', campusView.sort);
  CAMPUS_TOGGLES.forEach(key => { if (campusView[key]) params.set(key, '1'); });
  if (campusView.page > 1) params.set('page', campusView.page);
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

// ==========================================
// 3. FILTERING AND SORTING
// ==========================================
function campusScore(person, tokens) {
  let score = 0;
  for (const token of tokens) {
    if (person.x.name.startsWith(token)) score += 12;
    else if (person.x.name.includes(token)) score += 8;
    if (person.x.skillKeys.includes(token)) score += 6;
  }
  score += person.x.skillKeys.filter(skill => campusSkills.has(skill)).length * 2;
  if (campus.department && person.x.department === norm(campus.department)) score += 1;
  return score;
}

// Everything but the department tab, so the tabs can show how many each department would give
function campusMatches(person, tokens) {
  if (campusView.online && !onlineUserIds.has(person.id)) return false;
  if (campusView.verified && person.account_status !== 'verified') return false;
  if (campusView.following && !person.is_following) return false;
  if (campusView.saved && !person.is_saved) return false;
  return tokens.every(token => person.x.text.includes(token));
}

function sortCampus(list, tokens) {
  if (campusView.sort === 'name') return list.sort((a, b) => a.x.name.localeCompare(b.x.name));
  if (campusView.sort === 'followers') return list.sort((a, b) => (b.followers_count - a.followers_count) || (b.id - a.id));
  if (campusView.sort === 'newest') return list.sort((a, b) => b.id - a.id);
  const scores = new Map(list.map(person => [person.id, campusScore(person, tokens)]));
  return list.sort((a, b) => (scores.get(b.id) - scores.get(a.id)) || (b.followers_count - a.followers_count) || a.x.name.localeCompare(b.x.name));
}

function campusHasFilters() {
  return Boolean(campusView.q || campusView.dept || CAMPUS_TOGGLES.some(key => campusView[key]));
}

// ==========================================
// 4. RENDERING
// ==========================================
function queueCampusRender() {
  if (campusRenderQueued) return;
  campusRenderQueued = true;
  requestAnimationFrame(() => {
    campusRenderQueued = false;
    renderCampus();
    saveCampus();
  });
}

function campusViewChanged(keepPage) {
  if (!keepPage) campusView.page = 1;
  writeCampusUrl();
  syncCampusControls();
  if (campusLoaded) renderCampus();
}

function renderCampus() {
  renderCampusHeader();
  const grid = el('campusGrid');
  if (!campus.college) {
    grid.innerHTML = peopleStateBlock('school', 'Add your college first', 'Your profile has no college yet, so there is no campus to show. Add it and your classmates will appear here.',
      '<a href="profile.html" class="btn-primary-modal" style="display:inline-block;text-decoration:none;">Edit my profile</a>');
    el('campusPagination').innerHTML = '';
    el('campusCount').textContent = '';
    el('deptTabs').innerHTML = '';
    return;
  }

  const tokens = norm(campusView.q).split(/\s+/).filter(Boolean);
  const matching = classmates.filter(person => campusMatches(person, tokens));
  renderDeptTabs(matching);
  const people = sortCampus(matching.filter(person => !campusView.dept || person.x.department === campusView.dept), tokens);

  const totalPages = Math.max(1, Math.ceil(people.length / CAMPUS_PER_PAGE));
  if (campusView.page > totalPages) { campusView.page = totalPages; writeCampusUrl(); }
  const start = (campusView.page - 1) * CAMPUS_PER_PAGE;
  const visible = people.slice(start, start + CAMPUS_PER_PAGE);

  grid.innerHTML = visible.length ? visible.map(campusCardHtml).join('') : campusEmptyHtml();
  el('campusCount').textContent = people.length === classmates.length
    ? `${classmates.length} ${classmates.length === 1 ? 'classmate' : 'classmates'}`
    : `${people.length} of ${classmates.length} match`;
  el('campusPagination').innerHTML = peoplePaginationHtml(campusView.page, people.length, start, visible.length, totalPages, ['classmate', 'classmates']);
}

function campusCardHtml(person) {
  return personCardHtml(person, { mySkills: campusSkills, pending: campusPending });
}

function renderCampusHeader() {
  el('campusName').textContent = campus.college || 'Your campus';
  el('campusSub').textContent = campus.college
    ? `Everyone from ${campus.college} who is on Connect2Minds. Find teammates down the hall before you look anywhere else.`
    : 'Everyone from your college who is on Connect2Minds.';
  document.title = campus.college ? `Connect2Minds | ${campus.college}` : 'Connect2Minds | Campus Network';

  // The counts include us: we are a member of our own campus
  const departments = new Set(classmates.map(person => person.x.department).filter(Boolean));
  if (campus.department) departments.add(norm(campus.department));
  const me = window.currentUserProfile || cacheGet('me') || {};
  el('mMembers').textContent = campus.college ? classmates.length + 1 : 0;
  el('mDepartments').textContent = campus.college ? departments.size : 0;
  el('mVerified').textContent = classmates.filter(person => person.account_status === 'verified').length + (campus.college && me.account_status === 'verified' ? 1 : 0);
  el('mOnline').textContent = classmates.filter(person => onlineUserIds.has(person.id)).length;
  // A filter nobody would pass is left out until someone qualifies
  const anyVerified = classmates.some(person => person.account_status === 'verified');
  document.querySelector('[data-toggle="verified"]').classList.toggle('hidden', !anyVerified && !campusView.verified);
}

function renderDeptTabs(matching) {
  const counts = new Map();
  for (const person of matching) {
    if (!person.x.department) continue;
    const entry = counts.get(person.x.department) || { label: String(person.department).trim(), count: 0 };
    entry.count++;
    counts.set(person.x.department, entry);
  }
  // A department picked from a link stays selectable even if nobody matches it right now
  if (campusView.dept && !counts.has(campusView.dept)) counts.set(campusView.dept, { label: campusView.dept, count: 0 });
  const tabs = [...counts.entries()].sort((a, b) => (b[1].count - a[1].count) || a[1].label.localeCompare(b[1].label));
  el('deptTabs').innerHTML =
    `<button type="button" class="dept-tab" data-dept="" aria-pressed="${!campusView.dept}">All departments <span>${matching.length}</span></button>` +
    tabs.map(([key, entry]) => `<button type="button" class="dept-tab" data-dept="${escapeHtml(key)}" aria-pressed="${campusView.dept === key}">${escapeHtml(entry.label)} <span>${entry.count}</span></button>`).join('');
}

function campusEmptyHtml() {
  if (classmates.length === 0) {
    return peopleStateBlock('group_off', 'You are the first one here', `Nobody else from ${campus.college} has joined yet. Invite your classmates, or look across every college.`,
      '<button type="button" data-action="invite" class="btn-primary-modal">Copy invite link</button>');
  }
  return peopleStateBlock('search_off', 'No classmates match that', 'Try a different name or skill, or remove some filters.',
    '<button type="button" data-action="clear" class="btn-primary-modal">Clear search and filters</button>');
}

function renderCampusProblem(message) {
  el('campusGrid').innerHTML = peopleStateBlock('cloud_off', 'Could not load your campus', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
  el('campusPagination').innerHTML = '';
  el('campusCount').textContent = '';
}

function syncCampusControls() {
  const input = el('campusSearch');
  if (input.value.trim() !== campusView.q) input.value = campusView.q;
  el('campusSearchClear').classList.toggle('hidden', !campusView.q);
  el('campusSort').value = campusView.sort;
  CAMPUS_TOGGLES.forEach(key => {
    document.querySelector(`[data-toggle="${key}"]`).setAttribute('aria-pressed', String(campusView[key]));
  });
  el('campusClear').classList.toggle('hidden', !campusHasFilters());
}

// ==========================================
// 5. CONTROLS
// ==========================================
function bindCampusControls() {
  const input = el('campusSearch');
  input.addEventListener('input', () => {
    clearTimeout(campusSearchTimer);
    campusSearchTimer = setTimeout(() => { campusView.q = input.value.trim(); campusViewChanged(); }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); setCampusSearch(''); }
  });
  el('campusSearchClear').addEventListener('click', () => { setCampusSearch(''); input.focus(); });
  el('campusClear').addEventListener('click', clearCampusFilters);
  el('campusSort').addEventListener('change', (e) => { campusView.sort = e.target.value; campusViewChanged(); });
  el('inviteBtn').addEventListener('click', copyInviteLink);

  CAMPUS_TOGGLES.forEach(key => {
    document.querySelector(`[data-toggle="${key}"]`).addEventListener('click', () => { campusView[key] = !campusView[key]; campusViewChanged(); });
  });
  el('deptTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-dept]');
    if (tab) { campusView.dept = tab.dataset.dept; campusViewChanged(); }
  });

  const grid = el('campusGrid');
  grid.addEventListener('click', onCampusGridClick);
  bindAvatarFallback(grid);

  el('campusPagination').addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    campusView.page = parseInt(button.dataset.page);
    campusViewChanged(true);
    el('campusTop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); window.focusHeaderSearch(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); window.focusHeaderSearch(); }
  });
}

// The "Search network" box in the site header and Ctrl/⌘+K both land on this page's own search
window.focusHeaderSearch = function () {
  const input = el('campusSearch');
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.focus({ preventScroll: true });
  input.select();
};

function onCampusGridClick(e) {
  const skill = e.target.closest('[data-skill]');
  if (skill) return setCampusSearch(skill.dataset.skill);

  const button = e.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'retry') { el('campusGrid').innerHTML = peopleSkeletonHtml(6); return loadCampus(); }
  if (action === 'clear') return clearCampusFilters();
  if (action === 'invite') return copyInviteLink();

  const card = button.closest('[data-id]');
  const personId = card ? parseInt(card.dataset.id) : 0;
  if (action === 'follow' || action === 'save') toggleCampusRelation(action, personId);
  if (action === 'team') window.openAddToTeamModal(personId);
}

function setCampusSearch(text) {
  clearTimeout(campusSearchTimer);
  campusView.q = text;
  campusViewChanged();
}

function clearCampusFilters() {
  clearTimeout(campusSearchTimer);
  campusView.q = '';
  campusView.dept = '';
  CAMPUS_TOGGLES.forEach(key => { campusView[key] = false; });
  campusViewChanged();
}

function copyInviteLink() {
  copyText(new URL('register.html', window.location.href).href, 'Sign-up link copied. Send it to your classmates.');
}

// ==========================================
// 6. FOLLOW AND SAVE
// ==========================================
function refreshCampusCard(personId) {
  const person = classmatesById.get(personId);
  const card = el('campusGrid').querySelector(`[data-id="${personId}"]`);
  if (person && card) card.outerHTML = campusCardHtml(person);
}

async function toggleCampusRelation(kind, personId) {
  const person = classmatesById.get(personId);
  if (!person) return;
  const done = await togglePersonRelation(kind, person, campusPending, () => refreshCampusCard(personId));
  if (!done) return;
  saveCampus();
  // With the Following or Saved filter on, this person may no longer belong in the list
  if (campusView[kind === 'follow' ? 'following' : 'saved'] || campusView.sort === 'followers') renderCampus();
}

// ==========================================
// 7. LIVE UPDATES
// ==========================================
function handleCampusEvent(data) {
  if (data.type === 'profile_added') {
    // Someone new signed up; they belong here if they named our college
    const profile = data.profile;
    if (!profile || profile.id === currentUserId || classmatesById.has(profile.id) || !campus.college) return;
    if (norm(profile.college_name) !== norm(campus.college) || profile.account_status === 'rejected') return;
    const person = indexPerson(Object.assign({ followers_count: 0, is_following: false, is_saved: false, follows_me: false }, profile));
    classmates.push(person);
    classmatesById.set(person.id, person);
    return queueCampusRender();
  }
  if (data.type === 'profile_updated' && data.profile && campus.college) {
    // A profile edit can move someone into or out of our college
    const known = classmatesById.has(data.profile.id);
    const belongs = norm(data.profile.college_name) === norm(campus.college) && data.profile.account_status !== 'rejected';
    if (known !== belongs && data.profile.id !== currentUserId) return loadCampus();
    if (data.profile.id === currentUserId && norm(data.profile.college_name) !== norm(campus.college)) return loadCampus();
  }

  const result = applyPeopleEvent(data, classmatesById, campusPending);
  if (result === 'presence') {
    if (campusView.online) return renderCampus();
    const dot = el('campusGrid').querySelector(`[data-id="${data.user_id}"] [data-online-dot]`);
    if (dot) dot.classList.toggle('hidden', !data.online);
    el('mOnline').textContent = classmates.filter(person => onlineUserIds.has(person.id)).length;
  } else if (result === 'changed') {
    queueCampusRender();
  }
}

initCampus();
