// ==========================================
// PROFESSIONALS.JS — The Professionals page: everyone by profession, with a skill filter that fits the profession
// Loaded after shared.js, chat-common.js (api, caches, toast, el, the people helpers) and professions.js (the list of professions).
// ==========================================

const CARDS_PER_PAGE = 12;       // fills whole rows at both 2 and 3 cards across
const REFRESH_AFTER_MS = 60000;
const EXTRA_SKILLS = 8;          // how many skills people really list are added to a profession's typical ones
const FIND_RESULTS = 8;
const INTRO_REASONS = ['Mentorship', 'Collaboration', 'Hiring', 'A question'];
const ALL_GROUPS_ICON = 'groups';

let directory = [];               // everyone on the platform except us, as returned by /api/discover
let directoryById = new Map();
let directoryLoaded = false;      // false until the first list (cached or fresh) is on screen
let directoryLoading = false;
let directoryLoadedAt = 0;
let mySkills = new Set();
let proContacts = new Set();      // people we already have a chat with in the Professionals section of Messages

// What the person has typed and picked. Mirrored in the address bar.
const view = { q: '', group: '', profession: '', skills: [], openTo: '', verified: false, online: false, sort: 'match', page: 1 };
const TOGGLES = ['verified', 'online'];
const SORTS = ['match', 'experience', 'followers', 'newest', 'name'];

const pendingActions = new Set(); // "follow:12" while that request is in flight
let searchTimer = null;
let renderQueued = false;
let animateNextRender = false;    // true when the next redraw comes from the person's own choice
let introPerson = null;           // who the "introduce yourself" box is open for
let introReason = INTRO_REASONS[0];
let findActive = -1;              // highlighted row in the "Find a profession" list
let showEmptyFields = false;      // fields nobody has joined yet stay folded away until asked for

// ==========================================
// 1. LOADING
// ==========================================
function initProfessionals() {
  readViewFromUrl();
  mySkills = ownSkillSet();
  bindControls();
  syncControls();

  // 1. The copy saved on the last visit (Discover saves the same list), so the page is never blank
  const cached = cacheGet('discover');
  if (cached && Array.isArray(cached.people)) {
    setDirectory(cached.people, []);
  } else {
    renderSkeleton();
  }

  // 2. The real thing (already requested from the page head)
  loadDirectory();
  loadProContacts();
  connectNotifications((data) => { if (directoryLoaded) handleLiveEvent(data); }, loadDirectory);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - directoryLoadedAt > REFRESH_AFTER_MS) loadDirectory();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadDirectory(); });
}

async function loadDirectory() {
  if (directoryLoading) return;
  directoryLoading = true;
  try {
    const data = await fetchPageData('/api/discover');
    directoryLoadedAt = Date.now();
    setDirectory(data.people || [], data.online_user_ids || []);
    saveDirectory();
  } catch (err) {
    if (!directoryLoaded) renderProblem(err.message);
  } finally {
    directoryLoading = false;
  }
}

// Who we already talk to in the Professionals section: their Message button opens the chat straight away
async function loadProContacts() {
  try {
    const state = await api('/api/chat/actions/state');
    proContacts = new Set(state.pro || []);
  } catch (err) { /* the box is shown instead, which is harmless */ }
}

function setDirectory(people, onlineIds) {
  directory = people.map(indexProfessional);
  directoryById = new Map(directory.map(person => [person.id, person]));
  onlineUserIds = new Set(onlineIds);
  if (!directoryLoaded) animateNextRender = true;   // the first list rises in; the refresh that follows does not
  directoryLoaded = true;
  render();
}

function saveDirectory() {
  cacheSet('discover', { people: directory.map(person => { const { p, ...plain } = plainPerson(person); return plain; }) });
}

// Adds what this page looks up often: the person's profession, its group and what they are open to
function indexProfessional(person) {
  indexPerson(person);
  const name = professionOf(person);
  const known = findProfession(name);
  const openKeys = new Set(String(person.open_to || '').split(',').map(norm).filter(Boolean));
  person.p = {
    name,
    key: norm(name),
    group: known ? known.group : OTHER_PROFESSION,
    icon: known ? known.icon : 'more_horiz',
    professional: isProfessional(person),
    openKeys,
    openLabels: openToLabels(person.open_to),
    years: parseInt(person.experience_years) || 0
  };
  person.x.text += ` ${person.p.key} ${norm(person.p.group)}`;
  return person;
}

// ==========================================
// 2. ADDRESS BAR
// ==========================================
function readViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  view.q = (params.get('q') || '').trim();
  const profession = findProfession(params.get('profession'));
  const group = PROFESSION_GROUPS.find(g => norm(g.name) === norm(params.get('group')));
  view.profession = profession ? profession.name : '';
  view.group = profession ? profession.group : (group ? group.name : '');
  view.skills = view.profession ? (params.get('skills') || '').split(',').map(skill => skill.trim()).filter(Boolean) : [];
  view.openTo = OPEN_TO_OPTIONS.some(([key]) => key === params.get('open')) ? params.get('open') : '';
  view.sort = SORTS.includes(params.get('sort')) ? params.get('sort') : 'match';
  TOGGLES.forEach(key => { view[key] = params.get(key) === '1'; });
  view.page = Math.max(1, parseInt(params.get('page')) || 1);
}

function writeViewToUrl() {
  const params = new URLSearchParams();
  if (view.q) params.set('q', view.q);
  if (view.profession) params.set('profession', view.profession);
  else if (view.group) params.set('group', view.group);
  if (view.skills.length) params.set('skills', view.skills.join(','));
  if (view.openTo) params.set('open', view.openTo);
  if (view.sort !== 'match') params.set('sort', view.sort);
  TOGGLES.forEach(key => { if (view[key]) params.set(key, '1'); });
  if (view.page > 1) params.set('page', view.page);
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

// ==========================================
// 3. FILTERING AND SORTING
// ==========================================
function searchTokens() {
  return norm(view.q).split(/\s+/).filter(Boolean);
}

function matchScore(person, tokens) {
  let score = 0;
  for (const token of tokens) {
    if (person.x.name.startsWith(token)) score += 12;
    else if (person.x.name.includes(token)) score += 8;
    if (person.p.key.includes(token)) score += 6;
    if (person.x.skillKeys.includes(token)) score += 6;
    else if (person.x.skillKeys.some(skill => skill.includes(token))) score += 4;
  }
  score += person.x.skillKeys.filter(skill => mySkills.has(skill)).length * 2;
  if (person.account_status === 'verified') score += 1;
  return score;
}

// Everyone who passes the choices. options.ignoreSkills leaves the skill chips out, for counting what each chip would give.
function filteredPeople(options = {}) {
  const tokens = searchTokens();
  const professionKey = norm(view.profession);
  const skillKeys = options.ignoreSkills ? [] : view.skills.map(norm);
  const list = directory.filter(person => {
    if (professionKey ? person.p.key !== professionKey : (view.group && person.p.group !== view.group)) return false;
    if (!skillKeys.every(skill => person.x.skillKeys.includes(skill))) return false;
    if (view.openTo && !person.p.openKeys.has(view.openTo)) return false;
    if (view.verified && person.account_status !== 'verified') return false;
    if (view.online && !onlineUserIds.has(person.id)) return false;
    return tokens.every(token => person.x.text.includes(token));
  });

  if (view.sort === 'newest') {
    list.sort((a, b) => b.id - a.id);
  } else if (view.sort === 'followers') {
    list.sort((a, b) => (b.followers_count - a.followers_count) || (b.id - a.id));
  } else if (view.sort === 'name') {
    list.sort((a, b) => a.x.name.localeCompare(b.x.name));
  } else if (view.sort === 'experience') {
    list.sort((a, b) => (b.p.years - a.p.years) || (b.followers_count - a.followers_count) || (b.id - a.id));
  } else {
    const boost = (person) => (person.plan === 'premium_plus' ? 1 : 0);   // Premium Plus profile boost
    const scores = new Map(list.map(person => [person.id, matchScore(person, tokens)]));
    list.sort((a, b) => (scores.get(b.id) - scores.get(a.id)) || (boost(b) - boost(a)) || (b.followers_count - a.followers_count) || (b.id - a.id));
  }
  return list;
}

// Advanced filters (open-to, experience sort, more than one must-have skill) come with the paid plans
const ADVANCED_PLANS = ['student_pro', 'premium', 'premium_plus'];
function advancedAllowed() {
  const me = window.currentUserProfile || {};
  return Number(me.is_founder) === 1 || ADVANCED_PLANS.includes(me.plan);
}
function refuseAdvanced(what) {
  if (advancedAllowed()) return false;
  window.upgradePrompt(`${what} is an advanced filter, part of Student Pro and the Premium plans.`);
  return true;
}

// How many people each group and each profession has
function headCounts() {
  const groups = new Map(), professions = new Map();
  for (const person of directory) {
    groups.set(person.p.group, (groups.get(person.p.group) || 0) + 1);
    professions.set(person.p.key, (professions.get(person.p.key) || 0) + 1);
  }
  return { groups, professions };
}

// ==========================================
// 4. RENDERING
// ==========================================
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
    saveDirectory();
  });
}

function viewChanged(keepPage) {
  if (!keepPage) view.page = 1;
  writeViewToUrl();
  syncControls();
  animateNextRender = true;
  if (directoryLoaded) render();
}

function render() {
  const grid = el('proGrid');
  const counts = headCounts();
  const people = filteredPeople();
  const totalPages = Math.max(1, Math.ceil(people.length / CARDS_PER_PAGE));
  if (view.page > totalPages) { view.page = totalPages; writeViewToUrl(); }
  const start = (view.page - 1) * CARDS_PER_PAGE;
  const visible = people.slice(start, start + CARDS_PER_PAGE);

  // Cards rise in only for a redraw the person asked for, not when a live update repaints the list
  grid.classList.toggle('pp-animate', animateNextRender);
  animateNextRender = false;
  grid.innerHTML = visible.length ? visible.map(cardHtml).join('') : emptyHtml(counts);

  renderSummary(counts);
  renderGroupTiles(counts);
  renderProfessionChips(counts);
  renderSkillChips();
  renderCount(people.length);
  renderActiveChips();
  el('proPagination').innerHTML = peoplePaginationHtml(view.page, people.length, start, visible.length, totalPages);
}

function renderSummary(counts) {
  if (!directory.length) return;
  const professions = counts.professions.size;
  el('proSummary').textContent = `${directory.length} ${directory.length === 1 ? 'person' : 'people'} in ${professions} ${professions === 1 ? 'profession' : 'professions'}. Pick a field to narrow it down.`;
}

function renderCount(shown) {
  const where = view.profession || view.group || 'Everyone';
  const narrowed = view.q || view.skills.length || view.openTo || view.verified || view.online;
  el('proCount').innerHTML = `${escapeHtml(where)}<small>${shown} ${shown === 1 ? 'person' : 'people'}${narrowed ? ' match' : ''}</small>`;
}

// The fields. The ones nobody has joined yet are folded behind a "More fields" tile, except the one being browsed.
function renderGroupTiles(counts) {
  const folded = (name, count) => !showEmptyFields && count === 0 && view.group !== name;
  const hiddenCount = PROFESSION_GROUPS.filter(group => folded(group.name, counts.groups.get(group.name) || 0)).length;
  const tile = (name, icon, count) => `
    <button type="button" class="pp-tile${count ? '' : ' is-empty'}${folded(name, count) ? ' pp-hidden' : ''}" data-group="${escapeHtml(name)}" aria-pressed="${view.group === name}">
      <span class="pp-tile-ico"><span class="material-symbols-outlined">${icon}</span></span>
      <span class="pp-tile-text"><b>${escapeHtml(name || 'All fields')}</b><small>${count} ${count === 1 ? 'person' : 'people'}</small></span>
    </button>`;
  const more = hiddenCount || showEmptyFields ? `
    <button type="button" class="pp-tile is-more" data-more-fields aria-expanded="${showEmptyFields}">
      <span class="pp-tile-ico"><span class="material-symbols-outlined">${showEmptyFields ? 'unfold_less' : 'unfold_more'}</span></span>
      <span class="pp-tile-text"><b>${showEmptyFields ? 'Fewer fields' : 'More fields'}</b><small>${showEmptyFields ? 'Hide the empty ones' : `${hiddenCount} with no one yet`}</small></span>
    </button>` : '';
  el('groupTiles').innerHTML = tile('', ALL_GROUPS_ICON, directory.length)
    + PROFESSION_GROUPS.map(group => tile(group.name, group.icon, counts.groups.get(group.name) || 0)).join('') + more;
}

// The professions of the chosen field, the ones that have people first
function renderProfessionChips(counts) {
  const group = PROFESSION_GROUPS.find(g => g.name === view.group);
  el('professionRow').classList.toggle('pp-hidden', !group);
  if (!group) return;
  el('professionRowLabel').textContent = `Professions in ${group.name}`;
  const sorted = group.professions
    .map(profession => ({ profession, count: counts.professions.get(profession.key) || 0 }))
    .sort((a, b) => (b.count - a.count) || a.profession.name.localeCompare(b.profession.name));
  el('professionChips').innerHTML = `<button type="button" class="pp-chip" data-profession="" aria-pressed="${!view.profession}">All<i>${counts.groups.get(group.name) || 0}</i></button>`
    + sorted.map(({ profession, count }) =>
      `<button type="button" class="pp-chip${count ? '' : ' is-empty'}" data-profession="${escapeHtml(profession.name)}" aria-pressed="${view.profession === profession.name}">${escapeHtml(profession.name)}<i>${count}</i></button>`).join('');
}

// The skills that fit the chosen profession: its typical ones, then the ones its people really list
function professionSkillChoices() {
  const professionKey = norm(view.profession);
  const inProfession = directory.filter(person => person.p.key === professionKey);
  const counts = new Map();   // skill key -> { label, count }
  for (const person of inProfession) {
    person.x.skills.forEach((skill, i) => {
      const entry = counts.get(person.x.skillKeys[i]) || { label: skill, count: 0 };
      entry.count++;
      counts.set(person.x.skillKeys[i], entry);
    });
  }
  const typical = professionSkills(view.profession).map(skill => ({ label: skill, count: (counts.get(norm(skill)) || { count: 0 }).count }));
  const typicalKeys = new Set(typical.map(skill => norm(skill.label)));
  const listed = [...counts.entries()]
    .filter(([key]) => !typicalKeys.has(key))
    .sort((a, b) => (b[1].count - a[1].count) || a[1].label.localeCompare(b[1].label))
    .slice(0, EXTRA_SKILLS)
    .map(([, entry]) => entry);
  // A skill picked from a link stays on show even if it is in neither list
  const picked = view.skills.filter(skill => !typicalKeys.has(norm(skill)) && !listed.some(entry => norm(entry.label) === norm(skill)))
    .map(skill => ({ label: skill, count: (counts.get(norm(skill)) || { count: 0 }).count }));
  return [...typical, ...listed, ...picked];
}

function renderSkillChips() {
  el('skillRow').classList.toggle('pp-hidden', !view.profession);
  if (!view.profession) return;
  el('skillRowLabel').textContent = `Skills for ${view.profession}`;
  const chosen = new Set(view.skills.map(norm));
  el('skillChips').innerHTML = professionSkillChoices().map(skill =>
    `<button type="button" class="pp-chip${skill.count ? '' : ' is-empty'}" data-skill-filter="${escapeHtml(skill.label)}" aria-pressed="${chosen.has(norm(skill.label))}">${escapeHtml(skill.label)}<i>${skill.count}</i></button>`).join('');
}

// One person as a card. position is the card's place on the page; it only staggers the entrance.
function cardHtml(person, position = 0) {
  const profileLink = `profile.html?id=${person.id}`;
  const online = onlineUserIds.has(person.id);
  const workplace = String(person.college_name || '').trim();
  const city = String(person.city || '').trim();
  const field = String(person.department || '').trim();
  const chosen = new Set(view.skills.map(norm));
  // The skills being filtered on are shown first, so the reason this person is listed is visible
  const ordered = [...person.x.skills].sort((a, b) => Number(chosen.has(norm(b))) - Number(chosen.has(norm(a))));
  const shown = ordered.slice(0, MAX_SKILLS_ON_CARD);
  const extra = ordered.length - shown.length;
  const skillsHtml = shown.map(skill =>
    `<button type="button" data-skill="${escapeHtml(skill)}" title="Search ${escapeHtml(skill)}" class="pp-skill${chosen.has(norm(skill)) ? ' hit' : ''}">${escapeHtml(skill)}</button>`).join('')
    + (extra > 0 ? `<span class="pp-more">+${extra}</span>` : '');
  const followBusy = pendingActions.has(`follow:${person.id}`) ? 'disabled' : '';
  const saveBusy = pendingActions.has(`save:${person.id}`) ? 'disabled' : '';
  const followLabel = person.is_following ? 'Following' : (person.follows_me ? 'Follow back' : 'Follow');
  const relation = person.is_following && person.follows_me ? 'you follow each other' : (person.is_following ? 'you follow' : (person.follows_me ? 'follows you' : ''));
  const icon = (name) => `<span class="material-symbols-outlined pp-ico">${name}</span>`;
  const facts = (person.p.years ? `<span class="pp-fact plain">${icon('workspace_premium')}${person.p.years} ${person.p.years === 1 ? 'yr' : 'yrs'} experience</span>` : '')
    + person.p.openLabels.map(label => `<span class="pp-fact">${icon('check_circle')}${escapeHtml(label)}</span>`).join('');

  return `
    <article class="pp-card" data-id="${person.id}" style="--n:${position}">
      <div class="pp-strip">
        <span class="pp-strip-ico"><span class="material-symbols-outlined">${person.p.icon}</span></span>
        <span class="pp-strip-text"><span class="pp-prof" data-card-profession>${escapeHtml(person.p.name)}</span><span class="pp-group">${escapeHtml(person.p.group)}</span></span>
        <button type="button" data-action="save" ${saveBusy} aria-pressed="${person.is_saved}" title="${person.is_saved ? 'Remove from Saved Profiles' : 'Save profile'}" aria-label="${person.is_saved ? 'Remove from Saved Profiles' : 'Save profile'}" class="pp-save">
          <span class="material-symbols-outlined">${person.is_saved ? 'bookmark_added' : 'bookmark_add'}</span>
        </button>
      </div>
      <a class="pp-photo-link" href="${profileLink}" aria-label="${escapeHtml(person.name)}'s profile">
        <div class="pp-photo">${personAvatarHtml(person)}</div>
        <span data-online-dot class="pp-online ${online ? '' : 'hidden'}" title="Online now"></span>
      </a>
      <div class="pp-body">
        <h3 class="pp-name">
          <a class="truncate" href="${profileLink}">${escapeHtml(person.name || 'Unnamed')}</a>
          ${person.account_status === 'verified' ? '<span class="material-symbols-outlined pp-ico" title="Verified account">verified</span>' : ''}
          ${roleBadgesHtml(person)}
        </h3>
        ${workplace ? `<p class="pp-meta" title="${escapeHtml(workplace)}">${icon(person.p.professional ? 'apartment' : 'school')}<span>${escapeHtml(workplace)}</span></p>` : ''}
        ${field || city ? `<p class="pp-meta" title="${escapeHtml([field, city].filter(Boolean).join(' · '))}">${icon(city ? 'location_on' : 'category')}<span>${escapeHtml([field, city].filter(Boolean).join(' · '))}</span></p>` : ''}
        ${facts ? `<div class="pp-facts">${facts}</div>` : ''}
        ${person.bio ? `<p class="pp-bio line-clamp-2">${escapeHtml(person.bio)}</p>` : ''}
        <div class="pp-skills">${skillsHtml || '<span class="pp-more">No skills listed yet</span>'}</div>
        <div class="pp-foot">
          <p class="pp-followers">${person.followers_count} ${person.followers_count === 1 ? 'follower' : 'followers'}${relation ? ` · ${relation}` : ''}</p>
          <div class="pp-actions">
            <button type="button" data-action="message" class="pp-btn primary">${icon('chat')}Message</button>
            <button type="button" data-action="follow" ${followBusy} aria-pressed="${person.is_following}" class="pp-btn ghost">${icon(person.is_following ? 'check' : 'person_add')}${followLabel}</button>
            <button type="button" data-action="team" title="Add to one of your teams" aria-label="Add ${escapeHtml(person.name)} to one of your teams" class="pp-icon-btn">
              <span class="material-symbols-outlined">group_add</span>
            </button>
            <button type="button" data-action="link" title="Copy profile link" aria-label="Copy the link to ${escapeHtml(person.name)}'s profile" class="pp-icon-btn">
              <span class="material-symbols-outlined">link</span>
            </button>
          </div>
        </div>
      </div>
    </article>`;
}

// What is narrowing the list right now, each with its own remove button
function renderActiveChips() {
  const chips = [];
  if (view.q) chips.push(['q', `"${view.q}"`]);
  view.skills.forEach(skill => chips.push([`skill:${skill}`, skill]));
  if (view.openTo) chips.push(['openTo', `Open to ${openToLabels(view.openTo)[0].toLowerCase()}`]);
  if (view.verified) chips.push(['verified', 'Verified']);
  if (view.online) chips.push(['online', 'Online now']);

  el('proActiveChips').innerHTML = chips.map(([key, label]) => `
    <button type="button" data-clear="${escapeHtml(key)}" title="Remove this filter" class="pp-chip" aria-pressed="true">
      <span class="truncate">${escapeHtml(label)}</span>
      <span class="material-symbols-outlined pp-ico">close</span>
    </button>`).join('');
  el('proActive').classList.toggle('hidden', chips.length === 0);
}

// Nobody to show. When a whole profession is still empty, the people of its field are offered instead.
function emptyHtml(counts) {
  if (directory.length === 0) {
    return peopleStateBlock('group_off', 'No one else is here yet', 'When more people join Connect2Minds they will show up on this page.', '');
  }
  const inviteButton = '<button type="button" data-action="invite" class="btn-primary-modal">Copy sign-up link</button>';
  if (view.profession && !counts.professions.get(norm(view.profession))) {
    const block = peopleStateBlock('person_search', `No one has joined as ${view.profession} yet`, 'Know someone? Send them the sign-up link.', inviteButton);
    const others = directory.filter(person => person.p.group === view.group).slice(0, 6);
    if (!others.length) return block;
    return block + `<h3 class="pp-subhead col-span-full">Others in ${escapeHtml(view.group)}</h3>` + others.map(cardHtml).join('');
  }
  if (view.group && !counts.groups.get(view.group) && !view.q) {
    return peopleStateBlock('person_search', `No one in ${view.group} yet`, 'Know someone? Send them the sign-up link.', inviteButton);
  }
  return peopleStateBlock('search_off', 'No one matches that', 'Try fewer skills, a different search, or clear the filters.',
    '<button type="button" data-action="clear" class="btn-primary-modal">Clear search and filters</button>');
}

function renderProblem(message) {
  el('proGrid').innerHTML = peopleStateBlock('cloud_off', 'Could not load people', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
  el('proPagination').innerHTML = '';
  el('proCount').textContent = '';
}

function renderSkeleton() {
  el('proGrid').innerHTML = `
    <div class="pp-card" aria-hidden="true">
      <div class="pp-strip"></div>
      <div class="pp-body">
        <div class="skeleton h-4 w-2/3 mb-2" style="margin-top:42px;"></div>
        <div class="skeleton h-3.5 w-full mb-2"></div>
        <div class="skeleton h-3.5 w-4/5 mb-4"></div>
        <div class="skeleton h-6 w-1/2 mb-6"></div>
        <div class="skeleton h-9 w-full" style="border-radius:10px;"></div>
      </div>
    </div>`.repeat(6);
}

function syncControls() {
  const input = el('proSearchInput');
  if (input.value.trim() !== view.q) input.value = view.q;
  el('proSearchClear').classList.toggle('hidden', !view.q);
  el('proShortcutHint').classList.toggle('md:block', !view.q);
  el('proSort').value = view.sort;
  el('proOpenTo').value = view.openTo;
  el('proOpenTo').classList.toggle('is-set', Boolean(view.openTo));
  TOGGLES.forEach(key => {
    document.querySelector(`[data-toggle="${key}"]`).setAttribute('aria-pressed', String(view[key]));
  });
  renderActiveChips();
}

// ==========================================
// 5. CONTROLS
// ==========================================
function bindControls() {
  const input = el('proSearchInput');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { view.q = input.value.trim(); viewChanged(); }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); setSearch(input.value.trim()); }
    if (e.key === 'Escape' && input.value) { e.preventDefault(); setSearch(''); }
  });
  el('proSearchClear').addEventListener('click', () => { setSearch(''); input.focus(); });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) el('proShortcutHint').textContent = '⌘K';

  el('groupTiles').addEventListener('click', (e) => {
    if (e.target.closest('[data-more-fields]')) {
      showEmptyFields = !showEmptyFields;
      renderGroupTiles(headCounts());
      return;
    }
    const tile = e.target.closest('[data-group]');
    if (tile) pickProfession(tile.dataset.group, '');
  });
  el('professionChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-profession]');
    if (chip) pickProfession(view.group, view.profession === chip.dataset.profession ? '' : chip.dataset.profession);
  });
  el('skillChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-skill-filter]');
    if (chip) toggleSkill(chip.dataset.skillFilter);
  });

  el('proOpenTo').innerHTML = '<option value="">Open to anything</option>'
    + OPEN_TO_OPTIONS.map(([key, label]) => `<option value="${key}">Open to ${label.toLowerCase()}</option>`).join('');
  el('proOpenTo').addEventListener('change', (e) => {
    if (e.target.value && refuseAdvanced('Filtering by what people are open to')) { e.target.value = view.openTo; return; }
    view.openTo = e.target.value;
    viewChanged();
  });
  el('proSort').addEventListener('change', (e) => {
    if (e.target.value === 'experience' && refuseAdvanced('Sorting by experience')) { e.target.value = view.sort; return; }
    view.sort = e.target.value;
    viewChanged();
  });
  TOGGLES.forEach(key => {
    document.querySelector(`[data-toggle="${key}"]`).addEventListener('click', () => { view[key] = !view[key]; viewChanged(); });
  });
  el('proClearAll').addEventListener('click', clearFilters);
  el('proActiveChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-clear]');
    if (chip) clearFilter(chip.dataset.clear);
  });

  const grid = el('proGrid');
  grid.addEventListener('click', onGridClick);
  bindAvatarFallback(grid);

  el('proPagination').addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    view.page = parseInt(button.dataset.page);
    viewChanged(true);
    el('resultsTop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  bindProfessionFinder();
  bindIntroBox();

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusProSearch(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); focusProSearch(); }
    else if (e.key === 'Escape' && introPerson) closeIntroBox();
  });
}

function onGridClick(e) {
  const skill = e.target.closest('[data-skill]');
  if (skill) {
    // Inside a profession a skill narrows the list; anywhere else it becomes the search
    if (view.profession) toggleSkill(skill.dataset.skill);
    else setSearch(skill.dataset.skill);
    return;
  }
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'retry') { renderSkeleton(); return loadDirectory(); }
  if (action === 'clear') return clearFilters();
  if (action === 'invite') return copyText(new URL('register.html', window.location.href).href, 'Sign-up link copied. Send it to someone who should be here.');

  const card = button.closest('[data-id]');
  const person = card ? directoryById.get(parseInt(card.dataset.id)) : null;
  if (!person) return;
  if (action === 'follow' || action === 'save') toggleRelation(action, person.id);
  if (action === 'team') window.openAddToTeamModal(person.id);
  if (action === 'link') copyText(new URL(`profile.html?id=${person.id}`, window.location.href).href, 'Profile link copied.');
  if (action === 'message') startMessage(person);
}

// A field, and optionally one profession inside it. Skills belong to a profession, so they reset.
function pickProfession(group, profession) {
  view.group = group;
  view.profession = profession;
  view.skills = [];
  viewChanged();
}

function toggleSkill(skill) {
  const key = norm(skill);
  const adding = !view.skills.some(have => norm(have) === key);
  if (adding && view.skills.length >= 1 && refuseAdvanced('Requiring several skills at once')) return;
  view.skills = adding ? [...view.skills, skill] : view.skills.filter(have => norm(have) !== key);
  viewChanged();
}

function setSearch(text) {
  clearTimeout(searchTimer);
  view.q = text;
  viewChanged();
}

function clearFilter(key) {
  if (key === 'q') return setSearch('');
  if (key.startsWith('skill:')) return toggleSkill(key.slice(6));
  view[key] = key === 'openTo' ? '' : false;
  viewChanged();
}

// Clears the search and the narrowing choices; the field and profession being browsed stay
function clearFilters() {
  clearTimeout(searchTimer);
  view.q = '';
  view.skills = [];
  view.openTo = '';
  TOGGLES.forEach(key => { view[key] = false; });
  viewChanged();
}

// The search box in the site header, "/" and Ctrl/⌘+K all land here
function focusProSearch() {
  const input = el('proSearchInput');
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.focus({ preventScroll: true });
  input.select();
}
window.focusHeaderSearch = focusProSearch;

// ==========================================
// 6. "FIND A PROFESSION"
// ==========================================
function bindProfessionFinder() {
  const input = el('professionFind');
  const list = el('professionFindList');

  function close() {
    list.classList.add('pp-hidden');
    list.innerHTML = '';
    findActive = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function choose(option) {
    const profession = findProfession(option.dataset.value);
    input.value = '';
    close();
    if (profession) pickProfession(profession.group, profession.name);
  }

  function setActive(index) {
    const options = [...list.querySelectorAll('[data-value]')];
    if (!options.length) return;
    findActive = (index + options.length) % options.length;
    options.forEach((option, n) => {
      option.classList.toggle('active', n === findActive);
      option.setAttribute('aria-selected', String(n === findActive));
    });
    options[findActive].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', options[findActive].id);
  }

  input.addEventListener('input', () => {
    const typed = input.value.trim();
    if (!typed) return close();
    const counts = headCounts().professions;
    const matches = searchProfessions(typed, FIND_RESULTS);
    list.innerHTML = matches.length
      ? matches.map((profession, n) => {
        const count = counts.get(profession.key) || 0;
        return `<li id="professionFind-${n}" role="option" data-value="${escapeHtml(profession.name)}">
          <span class="material-symbols-outlined pp-ico">${profession.icon}</span>
          <span class="min-w-0"><b>${escapeHtml(profession.name)}</b><small>${escapeHtml(profession.group)}</small></span>
          <em>${count} ${count === 1 ? 'person' : 'people'}</em>
        </li>`;
      }).join('')
      : '<li class="pp-none">No profession by that name. Try a broader word, or pick a field below.</li>';
    findActive = -1;
    list.classList.remove('pp-hidden');
    input.setAttribute('aria-expanded', 'true');
  });
  input.addEventListener('keydown', (e) => {
    if (list.classList.contains('pp-hidden')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(findActive + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(findActive - 1); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const options = list.querySelectorAll('[data-value]');
      if (options.length) choose(options[Math.max(0, findActive)]);   // Enter with nothing highlighted takes the first match
    }
  });
  // mousedown, not click: the choice has to land before the field loses focus and the list closes
  list.addEventListener('mousedown', (e) => {
    const option = e.target.closest('[data-value]');
    if (!option) return;
    e.preventDefault();
    choose(option);
  });
  input.addEventListener('blur', close);
}

// ==========================================
// 7. MESSAGING A PROFESSIONAL
// A first message to a professional opens with a reason, and the chat goes to the Professionals section of Messages.
// A student, or someone we already talk to there, just opens the chat.
// ==========================================
function startMessage(person) {
  if (!person.p.professional || proContacts.has(person.id)) {
    window.location.href = `inbox.html?user=${person.id}`;
    return;
  }
  openIntroBox(person);
}

function openIntroBox(person) {
  introPerson = person;
  introReason = INTRO_REASONS[0];
  el('introPhoto').innerHTML = personAvatarHtml(person);
  el('introName').textContent = `Message ${person.name}`;
  el('introProfession').textContent = person.p.name;
  el('introText').value = '';
  setIntroNote('');
  renderIntroReasons();
  el('introModal').classList.add('active');
  el('introText').focus();
}

function closeIntroBox() {
  introPerson = null;
  el('introModal').classList.remove('active');
}

function renderIntroReasons() {
  el('introReasons').innerHTML = INTRO_REASONS.map(reason =>
    `<button type="button" class="pp-chip" data-reason="${reason}" aria-pressed="${reason === introReason}">${reason}</button>`).join('');
}

// The line under the message box: a problem when there is one, otherwise what will happen
function setIntroNote(problem) {
  el('introNote').classList.toggle('is-wrong', Boolean(problem));
  el('introHint').textContent = problem || 'This starts a chat in the Professionals section of Messages.';
  el('introCount').textContent = `${el('introText').value.length} / ${el('introText').maxLength}`;
}

async function sendIntro() {
  const person = introPerson;
  const text = el('introText').value.trim();
  if (!person) return;
  if (!text) { setIntroNote('Write a short message first.'); el('introText').focus(); return; }

  const button = el('introSend');
  button.disabled = true;
  button.textContent = 'Sending...';
  try {
    // Mark the chat as a professional one first, so the message lands in the right section for both people
    const opened = await api(`/api/pro-chats/${person.id}`, { method: 'POST' });
    if (opened.pro) proContacts.add(person.id);
    await api('/api/messages', { method: 'POST', body: { sender_id: currentUserId, receiver_id: person.id, content: `About: ${introReason}\n\n${text}`, temp_id: newTempId() } });
    window.location.href = `inbox.html?user=${person.id}`;
  } catch (err) {
    setIntroNote(err.message);
    button.disabled = false;
    button.textContent = 'Send message';
  }
}

function bindIntroBox() {
  el('introReasons').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-reason]');
    if (!chip) return;
    introReason = chip.dataset.reason;
    renderIntroReasons();
  });
  el('introText').addEventListener('input', () => setIntroNote(''));
  el('introCancel').addEventListener('click', closeIntroBox);
  el('introSend').addEventListener('click', sendIntro);
  el('introModal').addEventListener('click', (e) => { if (e.target === el('introModal')) closeIntroBox(); });
}

// ==========================================
// 8. FOLLOW AND SAVE
// ==========================================
function refreshCard(personId) {
  const person = directoryById.get(personId);
  const grid = el('proGrid');
  const card = grid.querySelector(`[data-id="${personId}"]`);
  if (!person || !card) return;
  grid.classList.remove('pp-animate');   // a card redrawn in place must not replay its entrance
  card.outerHTML = cardHtml(person);
}

async function toggleRelation(kind, personId) {
  const person = directoryById.get(personId);
  if (!person) return;
  const done = await togglePersonRelation(kind, person, pendingActions, () => refreshCard(personId));
  if (!done) return;
  saveDirectory();
  if (view.sort === 'followers') render();
}

// ==========================================
// 9. LIVE UPDATES
// ==========================================
function handleLiveEvent(data) {
  if (data.type === 'profile_added') {
    const profile = data.profile;
    if (!profile || profile.id === currentUserId || directoryById.has(profile.id) || profile.account_status === 'rejected') return;
    const person = indexProfessional(Object.assign({ followers_count: 0, is_following: false, is_saved: false, projects_text: '' }, profile));
    directory.unshift(person);
    directoryById.set(person.id, person);
    return queueRender();
  }
  if (data.type === 'profile_removed') {
    // Someone closed their account
    if (!directoryById.delete(data.id)) return;
    directory = directory.filter(person => person.id !== data.id);
    return queueRender();
  }
  const result = applyPeopleEvent(data, directoryById, pendingActions);
  if (result === 'presence') {
    if (view.online) return render();
    const dot = el('proGrid').querySelector(`[data-id="${data.user_id}"] [data-online-dot]`);
    if (dot) dot.classList.toggle('hidden', !data.online);
  } else if (result === 'changed') {
    // A changed profile may carry a new profession or new skills
    if (data.type === 'profile_updated') indexProfessional(directoryById.get(data.profile.id));
    queueRender();
  }
}

initProfessionals();
