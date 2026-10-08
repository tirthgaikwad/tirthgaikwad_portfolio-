// ==========================================
// NETWORK.JS — The My Network page: followers, following, mutual connections and suggestions
// Loaded after shared.js and chat-common.js (api, caches, toast, el, onlineUserIds, the people-card helpers).
// ==========================================

const NETWORK_PER_PAGE = 9;
const NETWORK_REFRESH_MS = 60000;
const SUGGESTIONS_SHOWN = 3;
const NETWORK_TABS = {
  followers: { label: 'Followers', nouns: ['follower', 'followers'] },
  following: { label: 'Following', nouns: ['person', 'people'] },
  mutual: { label: 'Mutual', nouns: ['mutual connection', 'mutual connections'] }
};

// Everyone the page knows about, by id. One person is one object even when they are in several lists,
// so a follow made on one card shows on all of them.
let networkPeople = new Map();
let suggestionIds = [];
let suggestionOffset = 0;
let networkLoaded = false;
let networkLoading = false;
let networkLoadedAt = 0;
let networkSkills = new Set();

const networkView = { tab: 'followers', q: '', sort: 'recent', notBack: false, page: 1 };
const networkPending = new Set();
let networkSearchTimer = null;
let networkRenderQueued = false;
let networkReloadTimer = null;

// ==========================================
// 1. LOADING
// ==========================================
function initNetwork() {
  readNetworkUrl();
  networkSkills = ownSkillSet();
  bindNetworkControls();
  syncNetworkControls();

  // 1. The copy saved on the last visit, so the page is never blank
  const cached = cacheGet('network');
  if (cached && Array.isArray(cached.followers)) {
    setNetwork(cached, []);
  } else {
    el('networkGrid').innerHTML = peopleSkeletonHtml(3);
    el('suggestedGrid').innerHTML = peopleSkeletonHtml(SUGGESTIONS_SHOWN);
  }

  // 2. The real thing (already requested from the page head)
  loadNetwork();
  connectNotifications((data) => { if (networkLoaded) handleNetworkEvent(data); }, loadNetwork);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - networkLoadedAt > NETWORK_REFRESH_MS) loadNetwork();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadNetwork(); });
}

async function loadNetwork() {
  if (networkLoading) return;
  networkLoading = true;
  try {
    const data = await fetchPageData('/api/network');
    networkLoadedAt = Date.now();
    setNetwork(data, data.online_user_ids || []);
    saveNetwork(data);
  } catch (err) {
    if (!networkLoaded) renderNetworkProblem(err.message);
  } finally {
    networkLoading = false;
  }
}

function setNetwork(data, onlineIds) {
  networkPeople = new Map();
  const take = (card, sinceField) => {
    const person = networkPeople.get(card.id) || indexPerson(Object.assign({ followerSince: '', followingSince: '', reason: '' }, card));
    if (sinceField) person[sinceField] = card.since || '';
    if (card.reason) person.reason = card.reason;
    networkPeople.set(person.id, person);
    return person;
  };
  (data.followers || []).forEach(card => take(card, 'followerSince'));
  (data.following || []).forEach(card => take(card, 'followingSince'));
  suggestionIds = (data.suggestions || []).map(card => take(card, '').id);
  suggestionOffset = 0;
  onlineUserIds = new Set(onlineIds);
  networkSkills = ownSkillSet();
  networkLoaded = true;
  renderNetwork();
}

function saveNetwork(data) {
  cacheSet('network', { followers: data.followers, following: data.following, suggestions: data.suggestions });
}

// ==========================================
// 2. ADDRESS BAR
// ==========================================
function readNetworkUrl() {
  const params = new URLSearchParams(window.location.search);
  networkView.tab = NETWORK_TABS[params.get('tab')] ? params.get('tab') : 'followers';
  networkView.q = (params.get('q') || '').trim();
  networkView.sort = ['recent', 'name', 'followers'].includes(params.get('sort')) ? params.get('sort') : 'recent';
  networkView.page = Math.max(1, parseInt(params.get('page')) || 1);
}

function writeNetworkUrl() {
  const params = new URLSearchParams();
  if (networkView.tab !== 'followers') params.set('tab', networkView.tab);
  if (networkView.q) params.set('q', networkView.q);
  if (networkView.sort !== 'recent') params.set('sort', networkView.sort);
  if (networkView.page > 1) params.set('page', networkView.page);
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

// ==========================================
// 3. LISTS
// ==========================================
function networkList(tab) {
  const everyone = [...networkPeople.values()];
  if (tab === 'followers') return everyone.filter(person => person.follows_me);
  if (tab === 'following') return everyone.filter(person => person.is_following);
  return everyone.filter(person => person.follows_me && person.is_following);
}

function visibleNetworkList() {
  const tokens = norm(networkView.q).split(/\s+/).filter(Boolean);
  const sinceField = networkView.tab === 'following' ? 'followingSince' : 'followerSince';
  const list = networkList(networkView.tab).filter(person => {
    if (networkView.notBack && networkView.tab === 'followers' && person.is_following) return false;
    return tokens.every(token => person.x.text.includes(token));
  });
  if (networkView.sort === 'name') list.sort((a, b) => a.x.name.localeCompare(b.x.name));
  else if (networkView.sort === 'followers') list.sort((a, b) => (b.followers_count - a.followers_count) || a.x.name.localeCompare(b.x.name));
  else list.sort((a, b) => String(b[sinceField]).localeCompare(String(a[sinceField])) || a.x.name.localeCompare(b.x.name));
  return list;
}

// ==========================================
// 4. RENDERING
// ==========================================
function queueNetworkRender() {
  if (networkRenderQueued) return;
  networkRenderQueued = true;
  requestAnimationFrame(() => { networkRenderQueued = false; renderNetwork(); });
}

function networkViewChanged(keepPage) {
  if (!keepPage) networkView.page = 1;
  writeNetworkUrl();
  syncNetworkControls();
  if (networkLoaded) renderNetwork();
}

function networkCardHtml(person, inSuggestions) {
  let note = '';
  if (inSuggestions) note = escapeHtml(person.reason || '');
  else if (networkView.tab === 'following' && person.followingSince) note = `followed ${escapeHtml(timeAgo(person.followingSince))}`;
  else if (person.followerSince) note = `since ${escapeHtml(timeAgo(person.followerSince))}`;
  return personCardHtml(person, { mySkills: networkSkills, pending: networkPending, note });
}

function renderNetwork() {
  el('followersCount').textContent = networkList('followers').length;
  el('followingCount').textContent = networkList('following').length;
  el('mutualCount').textContent = networkList('mutual').length;

  const people = visibleNetworkList();
  const totalInTab = networkList(networkView.tab).length;
  const totalPages = Math.max(1, Math.ceil(people.length / NETWORK_PER_PAGE));
  if (networkView.page > totalPages) { networkView.page = totalPages; writeNetworkUrl(); }
  const start = (networkView.page - 1) * NETWORK_PER_PAGE;
  const visible = people.slice(start, start + NETWORK_PER_PAGE);

  el('networkGrid').innerHTML = visible.length ? visible.map(person => networkCardHtml(person, false)).join('') : networkEmptyHtml(totalInTab);
  el('networkCount').textContent = people.length === totalInTab ? '' : `${people.length} of ${totalInTab} match`;
  el('networkPagination').innerHTML = peoplePaginationHtml(networkView.page, people.length, start, visible.length, totalPages, NETWORK_TABS[networkView.tab].nouns);
  renderSuggestions();
}

function networkEmptyHtml(totalInTab) {
  if (totalInTab > 0) {
    return peopleStateBlock('search_off', 'Nobody in this list matches', 'Try a different name or skill, or clear the search.',
      '<button type="button" data-action="clear" class="btn-primary-modal">Clear search</button>');
  }
  if (networkView.tab === 'followers') {
    return peopleStateBlock('group', 'No followers yet', 'People who follow you will appear here. Share your profile link, or follow a few people first: many follow back.',
      '<button type="button" data-action="share" class="btn-primary-modal">Copy my profile link</button>');
  }
  if (networkView.tab === 'following') {
    return peopleStateBlock('person_add', 'You are not following anyone yet', 'Follow people to keep them one click away. The suggestions below are a good place to start.',
      '<a href="search.html" class="btn-primary-modal" style="display:inline-block;text-decoration:none;">Discover talent</a>');
  }
  return peopleStateBlock('handshake', 'No mutual connections yet', 'When you follow someone and they follow you back, they appear here.', '');
}

function renderNetworkProblem(message) {
  el('networkGrid').innerHTML = peopleStateBlock('cloud_off', 'Could not load your network', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
  el('networkPagination').innerHTML = '';
  el('suggestedGrid').innerHTML = '';
}

// People we already follow drop out of the suggestions; "Show others" walks through the rest
function openSuggestions() {
  return suggestionIds.map(id => networkPeople.get(id)).filter(person => person && !person.is_following);
}

function renderSuggestions() {
  const open = openSuggestions();
  if (suggestionOffset >= open.length) suggestionOffset = 0;
  const shown = open.slice(suggestionOffset, suggestionOffset + SUGGESTIONS_SHOWN);
  el('suggestedGrid').innerHTML = shown.length
    ? shown.map(person => networkCardHtml(person, true)).join('')
    : peopleStateBlock('task_alt', 'No suggestions right now', 'You already follow everyone we would suggest. New members will show up here.', '');
  el('moreSuggestionsBtn').classList.toggle('hidden', open.length <= SUGGESTIONS_SHOWN);
}

function syncNetworkControls() {
  document.querySelectorAll('#networkTabs [data-tab]').forEach(tab => {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === networkView.tab));
  });
  const input = el('networkSearch');
  if (input.value.trim() !== networkView.q) input.value = networkView.q;
  el('networkSearchClear').classList.toggle('hidden', !networkView.q);
  el('networkSort').value = networkView.sort;
  const toggle = el('notFollowingBackToggle');
  toggle.classList.toggle('hidden', networkView.tab !== 'followers');
  toggle.setAttribute('aria-pressed', String(networkView.notBack));
  document.title = `ProPartner | ${NETWORK_TABS[networkView.tab].label}`;
}

// ==========================================
// 5. CONTROLS
// ==========================================
function bindNetworkControls() {
  el('networkTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab && tab.dataset.tab !== networkView.tab) { networkView.tab = tab.dataset.tab; networkViewChanged(); }
  });

  const input = el('networkSearch');
  input.addEventListener('input', () => {
    clearTimeout(networkSearchTimer);
    networkSearchTimer = setTimeout(() => { networkView.q = input.value.trim(); networkViewChanged(); }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); setNetworkSearch(''); }
  });
  el('networkSearchClear').addEventListener('click', () => { setNetworkSearch(''); input.focus(); });
  el('networkSort').addEventListener('change', (e) => { networkView.sort = e.target.value; networkViewChanged(); });
  el('notFollowingBackToggle').addEventListener('click', () => { networkView.notBack = !networkView.notBack; networkViewChanged(); });
  el('shareProfileBtn').addEventListener('click', shareMyProfile);
  el('moreSuggestionsBtn').addEventListener('click', () => { suggestionOffset += SUGGESTIONS_SHOWN; renderSuggestions(); });

  [el('networkGrid'), el('suggestedGrid')].forEach(grid => {
    grid.addEventListener('click', onNetworkGridClick);
    bindAvatarFallback(grid);
  });

  el('networkPagination').addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    networkView.page = parseInt(button.dataset.page);
    networkViewChanged(true);
    el('networkTop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function onNetworkGridClick(e) {
  // A skill on a card searches the whole platform for it; this page only lists our own connections
  const skill = e.target.closest('[data-skill]');
  if (skill) { window.location.href = `search.html?q=${encodeURIComponent(skill.dataset.skill)}`; return; }

  const button = e.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'retry') { el('networkGrid').innerHTML = peopleSkeletonHtml(3); return loadNetwork(); }
  if (action === 'clear') return setNetworkSearch('');
  if (action === 'share') return shareMyProfile();

  const card = button.closest('[data-id]');
  const personId = card ? parseInt(card.dataset.id) : 0;
  if (action === 'follow' || action === 'save') toggleNetworkRelation(action, personId);
  if (action === 'team') window.openAddToTeamModal(personId);
}

function setNetworkSearch(text) {
  clearTimeout(networkSearchTimer);
  networkView.q = text;
  networkView.notBack = false;
  networkViewChanged();
}

function shareMyProfile() {
  copyText(new URL(`profile.html?id=${currentUserId}`, window.location.href).href, 'Profile link copied.');
}

// ==========================================
// 6. FOLLOW AND SAVE
// ==========================================
// The same person can be on screen twice (their list card and a suggestion card)
function refreshNetworkCards(personId) {
  const person = networkPeople.get(personId);
  if (!person) return;
  document.querySelectorAll(`#networkGrid [data-id="${personId}"]`).forEach(card => { card.outerHTML = networkCardHtml(person, false); });
  document.querySelectorAll(`#suggestedGrid [data-id="${personId}"]`).forEach(card => { card.outerHTML = networkCardHtml(person, true); });
}

async function toggleNetworkRelation(kind, personId) {
  const person = networkPeople.get(personId);
  if (!person) return;
  const wasFollowing = person.is_following;
  const done = await togglePersonRelation(kind, person, networkPending, () => refreshNetworkCards(personId));
  if (!done) return;
  if (kind === 'follow' && person.is_following !== wasFollowing) {
    if (person.is_following) person.followingSince = new Date().toISOString();
    cacheSet('network', null);   // the lists changed; the next visit starts from a fresh copy
    renderNetwork();             // counts, tabs and suggestions all depend on who we follow
  }
}

// ==========================================
// 7. LIVE UPDATES
// ==========================================
function handleNetworkEvent(data) {
  if (data.type === 'follow_changed' && data.followed_id === currentUserId) {
    const follower = networkPeople.get(data.follower_id);
    if (!follower) {
      // Someone we have no card for just followed us: fetch the lists again, once for a burst of events
      clearTimeout(networkReloadTimer);
      networkReloadTimer = setTimeout(loadNetwork, 400);
      return;
    }
    if (data.following) follower.followerSince = new Date().toISOString();
  }

  const result = applyPeopleEvent(data, networkPeople, networkPending);
  if (result === 'presence') {
    document.querySelectorAll(`[data-id="${data.user_id}"] [data-online-dot]`).forEach(dot => dot.classList.toggle('hidden', !data.online));
  } else if (result === 'changed') {
    queueNetworkRender();
  }
}

initNetwork();
