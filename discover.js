// ==========================================
// DISCOVER.JS — The Discover Talent page: search, filters, follow/save/add-to-team, live updates
// Loaded after shared.js and chat-common.js (api, caches, toast, el, onlineUserIds, the people-card helpers).
// ==========================================

const CARDS_PER_PAGE = 10;
const REFRESH_AFTER_MS = 60000;
const TRENDING_COUNT = 8;

let directory = [];               // everyone on the platform except us, as returned by /api/discover
let directoryById = new Map();
let directoryLoaded = false;      // false until the first list (cached or fresh) is on screen
let directoryLoading = false;
let directoryLoadedAt = 0;
let mySkills = new Set();
let myCollege = '';

// What the person has typed and picked. Mirrored in the address bar.
const view = { q: '', college: '', department: '', city: '', type: '', sort: 'match', online: false, verified: false, following: false, saved: false, page: 1 };
const SELECT_FILTERS = ['college', 'department', 'city', 'type', 'sort'];
const TOGGLE_FILTERS = ['online', 'verified', 'following', 'saved'];
const FILTER_LABELS = { online: 'Online now', verified: 'Verified', following: 'People I follow', saved: 'Saved' };
const FACET_LABELS = { college: 'College', department: 'Department', city: 'City' };
const FACET_FIELDS = { college: 'college_name', department: 'department', city: 'city' };
const TYPE_LABELS = { student: 'Students', professional: 'Professionals' };

const pendingActions = new Set(); // "follow:12" while that request is in flight
let searchTimer = null;
let renderQueued = false;

// ==========================================
// 1. LOADING
// ==========================================
function initDiscover() {
  readViewFromUrl();
  loadMyProfile();
  bindControls();
  syncControls();

  // 1. The copy saved on the last visit, so the page is never blank
  const cached = cacheGet('discover');
  if (cached && Array.isArray(cached.people)) {
    setDirectory(cached.people, []);
  } else {
    renderSkeleton();
  }

  // 2. The real thing (already requested from the page head)
  loadDirectory();
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
    const prefetched = window.__discoverPrefetch ? await window.__discoverPrefetch : null;
    window.__discoverPrefetch = null;
    let data;
    if (prefetched && prefetched.status === 200) {
      data = prefetched.data;
    } else if (prefetched && prefetched.status === 401) {
      return handleLoggedOut();
    } else {
      data = await api('/api/discover');
    }
    directoryLoadedAt = Date.now();
    setDirectory(data.people || [], data.online_user_ids || []);
    saveDirectory();
  } catch (err) {
    if (!directoryLoaded) renderProblem(err.message);
  } finally {
    directoryLoading = false;
  }
}

function setDirectory(people, onlineIds) {
  directory = people.map(indexPerson);
  directoryById = new Map(directory.map(person => [person.id, person]));
  onlineUserIds = new Set(onlineIds);
  directoryLoaded = true;
  renderFacets();
  render();
}

function saveDirectory() {
  cacheSet('discover', { people: directory.map(plainPerson) });
}

// Our own skills and college decide what "Best match" means when nothing is typed
function loadMyProfile() {
  const me = window.currentUserProfile || cacheGet('me');
  if (!me) return;
  mySkills = new Set(String(me.skills || '').split(',').map(norm).filter(Boolean));
  myCollege = norm(me.college_name);
}

// ==========================================
// 2. ADDRESS BAR
// ==========================================
function readViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  view.q = (params.get('q') || params.get('skill') || '').trim();
  ['college', 'department', 'city'].forEach(key => { view[key] = norm(params.get(key)); });
  view.type = ['student', 'professional'].includes(params.get('type')) ? params.get('type') : '';
  view.sort = ['match', 'newest', 'followers', 'name'].includes(params.get('sort')) ? params.get('sort') : 'match';
  TOGGLE_FILTERS.forEach(key => { view[key] = params.get(key) === '1'; });
  view.page = Math.max(1, parseInt(params.get('page')) || 1);
}

function writeViewToUrl() {
  const params = new URLSearchParams();
  if (view.q) params.set('q', view.q);
  ['college', 'department', 'city', 'type'].forEach(key => { if (view[key]) params.set(key, view[key]); });
  if (view.sort !== 'match') params.set('sort', view.sort);
  TOGGLE_FILTERS.forEach(key => { if (view[key]) params.set(key, '1'); });
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
    if (person.x.skillKeys.includes(token)) score += 6;
    else if (person.x.skillKeys.some(skill => skill.includes(token))) score += 4;
  }
  score += person.x.skillKeys.filter(skill => mySkills.has(skill)).length * 2;
  if (myCollege && person.x.college === myCollege) score += 1;
  return score;
}

function filteredPeople() {
  const tokens = searchTokens();
  const list = directory.filter(person => {
    if (view.college && person.x.college !== view.college) return false;
    if (view.department && person.x.department !== view.department) return false;
    if (view.city && person.x.city !== view.city) return false;
    if (view.type === 'professional' && person.account_type !== 'professional') return false;
    if (view.type === 'student' && person.account_type === 'professional') return false;
    if (view.online && !onlineUserIds.has(person.id)) return false;
    if (view.verified && person.account_status !== 'verified') return false;
    if (view.following && !person.is_following) return false;
    if (view.saved && !person.is_saved) return false;
    return tokens.every(token => person.x.text.includes(token));
  });

  if (view.sort === 'newest') {
    list.sort((a, b) => b.id - a.id);
  } else if (view.sort === 'followers') {
    list.sort((a, b) => (b.followers_count - a.followers_count) || (b.id - a.id));
  } else if (view.sort === 'name') {
    list.sort((a, b) => a.x.name.localeCompare(b.x.name));
  } else {
    const scores = new Map(list.map(person => [person.id, matchScore(person, tokens)]));
    list.sort((a, b) => (scores.get(b.id) - scores.get(a.id)) || (b.followers_count - a.followers_count) || (b.id - a.id));
  }
  return list;
}

// ==========================================
// 4. RENDERING
// ==========================================
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderFacets();
    render();
    saveDirectory();
  });
}

function viewChanged(keepPage) {
  if (!keepPage) view.page = 1;
  writeViewToUrl();
  syncControls();
  if (directoryLoaded) render();
}

function render() {
  const grid = el('search-results-grid');
  const people = filteredPeople();
  const totalPages = Math.max(1, Math.ceil(people.length / CARDS_PER_PAGE));
  if (view.page > totalPages) { view.page = totalPages; writeViewToUrl(); }

  const start = (view.page - 1) * CARDS_PER_PAGE;
  const visible = people.slice(start, start + CARDS_PER_PAGE);
  grid.innerHTML = visible.length ? visible.map(cardHtml).join('') : emptyHtml();

  el('resultCount').textContent = people.length === directory.length
    ? `${directory.length} ${directory.length === 1 ? 'person' : 'people'}`
    : `${people.length} of ${directory.length} match`;
  renderPagination(people.length, start, visible.length, totalPages);
  renderTrending();
  renderActiveFilters();
}

// One person as a row of the list. The data-* hooks are the same ones the shared people card uses.
function cardHtml(person) {
  const profileLink = `profile.html?id=${person.id}`;
  const online = onlineUserIds.has(person.id);
  const place = [person.college_name, person.department, person.city].map(part => String(part || '').trim()).filter(Boolean).join(' · ');
  const shown = person.x.skills.slice(0, MAX_SKILLS_ON_CARD);
  const extra = person.x.skills.length - shown.length;
  const skillsHtml = shown.map(skill => {
    const shared = mySkills.has(norm(skill));
    return `<button type="button" data-skill="${escapeHtml(skill)}" title="${shared ? 'You both list this skill. ' : ''}Search ${escapeHtml(skill)}" class="px-2 py-0.5 rounded text-[12px] leading-4 font-medium transition-colors ${shared ? 'bg-indigo-50 text-primary hover:bg-indigo-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}">${escapeHtml(skill)}</button>`;
  }).join('') + (extra > 0 ? `<span class="px-1 py-0.5 text-[12px] leading-4 text-slate-500">+${extra}</span>` : '');
  const followBusy = pendingActions.has(`follow:${person.id}`) ? 'disabled' : '';
  const saveBusy = pendingActions.has(`save:${person.id}`) ? 'disabled' : '';
  const followLabel = person.is_following ? 'Following' : (person.follows_me ? 'Follow back' : 'Follow');
  const relation = person.is_following && person.follows_me ? 'you follow each other' : (person.is_following ? 'you follow' : (person.follows_me ? 'follows you' : ''));
  // overflow-hidden: until the icon font arrives an icon is its name in plain text, wider than the button
  const iconButton = 'w-8 h-8 rounded-md border flex items-center justify-center overflow-hidden transition-colors';
  const quietIcon = 'border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-100';

  return `
    <article class="flex flex-col sm:flex-row gap-3 sm:gap-4 px-4 sm:px-5 py-4 hover:bg-slate-50 transition-colors" data-id="${person.id}">
      <div class="flex gap-4 flex-1 min-w-0">
        <a class="relative block shrink-0 self-start" href="${profileLink}" aria-label="${escapeHtml(person.name)}'s profile">
          <div class="w-12 h-12 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">${personAvatarHtml(person)}</div>
          <span data-online-dot class="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white ${online ? '' : 'hidden'}" title="Online now"></span>
        </a>
        <div class="min-w-0 flex-1">
          <h3 class="flex items-center gap-1.5 text-[15px] leading-5 font-semibold text-slate-900">
            <a class="truncate hover:text-primary hover:underline" href="${profileLink}">${escapeHtml(person.name || 'Unnamed')}</a>
            ${person.account_status === 'verified' ? '<span class="material-symbols-outlined text-[16px] text-primary shrink-0" title="Verified account">verified</span>' : ''}
            ${person.account_type === 'professional' ? '<span class="shrink-0 px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 text-[10px] leading-3 font-semibold uppercase tracking-wide">Pro</span>' : ''}
          </h3>
          <p class="text-[13px] leading-5 text-slate-600 truncate mt-0.5" title="${escapeHtml(place)}">${escapeHtml(place || 'No college listed')}</p>
          ${person.bio ? `<p class="text-[13px] leading-5 text-slate-600 line-clamp-2 mt-1.5">${escapeHtml(person.bio)}</p>` : ''}
          <div class="flex flex-wrap items-center gap-1.5 mt-2">${skillsHtml || '<span class="text-[12px] text-slate-400">No skills listed yet</span>'}</div>
          <p class="text-[12px] leading-4 text-slate-500 mt-2">${person.followers_count} ${person.followers_count === 1 ? 'follower' : 'followers'}${relation ? ` · ${relation}` : ''}</p>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 self-start pl-16 sm:pl-0">
        <button type="button" data-action="follow" ${followBusy} aria-pressed="${person.is_following}" class="h-8 min-w-[104px] px-3 rounded-md text-[13px] font-semibold flex items-center justify-center transition-colors ${person.is_following ? 'border border-slate-300 bg-white text-slate-700 hover:border-rose-300 hover:text-rose-600' : 'bg-primary hover:bg-primary-container text-white'}">${followLabel}</button>
        <a class="${iconButton} ${quietIcon}" title="Message" aria-label="Message ${escapeHtml(person.name)}" href="inbox.html?user=${person.id}">
          <span class="material-symbols-outlined text-[18px]">chat</span>
        </a>
        <button type="button" data-action="save" ${saveBusy} aria-pressed="${person.is_saved}" title="${person.is_saved ? 'Remove from Saved Profiles' : 'Save profile'}" aria-label="${person.is_saved ? 'Remove from Saved Profiles' : 'Save profile'}" class="${iconButton} ${person.is_saved ? 'border-indigo-200 bg-indigo-50 text-primary hover:bg-indigo-100' : quietIcon}">
          <span class="material-symbols-outlined text-[18px]">${person.is_saved ? 'bookmark_added' : 'bookmark_add'}</span>
        </button>
        <button type="button" data-action="team" title="Add to one of your teams" aria-label="Add ${escapeHtml(person.name)} to one of your teams" class="${iconButton} ${quietIcon}">
          <span class="material-symbols-outlined text-[18px]">group_add</span>
        </button>
      </div>
    </article>`;
}

// What is narrowing the list right now, each with its own remove button
function renderActiveFilters() {
  const chips = [];
  if (view.q) chips.push(['q', `"${view.q}"`]);
  for (const key of ['college', 'department', 'city']) {
    if (!view[key]) continue;
    const sample = directory.find(person => person.x[key] === view[key]);
    chips.push([key, `${FACET_LABELS[key]}: ${sample ? String(sample[FACET_FIELDS[key]]).trim() : view[key]}`]);
  }
  if (view.type) chips.push(['type', TYPE_LABELS[view.type]]);
  TOGGLE_FILTERS.forEach(key => { if (view[key]) chips.push([key, FILTER_LABELS[key]]); });

  el('activeFilterChips').innerHTML = chips.map(([key, label]) => `
    <button type="button" data-clear="${key}" title="Remove this filter" class="inline-flex items-center gap-1 max-w-full h-7 pl-2.5 pr-1.5 rounded-md border border-slate-300 bg-white text-[12px] font-medium text-slate-700 hover:bg-slate-100 transition-colors">
      <span class="truncate">${escapeHtml(label)}</span>
      <span class="material-symbols-outlined text-[14px] text-slate-400 shrink-0">close</span>
    </button>`).join('');
  el('activeFilters').classList.toggle('hidden', chips.length === 0);

  // Search has its own box at the top, so the phone "Filters" button counts only what is inside the panel
  const inPanel = chips.filter(([key]) => key !== 'q').length;
  el('filterPanelCount').textContent = inPanel;
  el('filterPanelCount').classList.toggle('hidden', inPanel === 0);
}

function emptyHtml() {
  if (directory.length === 0) {
    return peopleStateBlock('group_off', 'No one else is here yet', 'When more people join ProPartner they will show up on this page.', '');
  }
  return peopleStateBlock('search_off', 'No one matches that', 'Try a different skill or name, or remove some filters.',
    '<button type="button" data-action="clear" class="btn-primary-modal">Clear search and filters</button>');
}

function renderProblem(message) {
  el('search-results-grid').innerHTML = peopleStateBlock('cloud_off', 'Could not load people', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
  el('discoverPagination').innerHTML = '';
  el('resultCount').textContent = '';
}

function renderSkeleton() {
  el('search-results-grid').innerHTML = `
    <div class="flex gap-4 px-4 sm:px-5 py-4">
      <div class="skeleton w-12 h-12 shrink-0" style="border-radius:9999px;"></div>
      <div class="flex-1 min-w-0">
        <div class="skeleton h-4 w-40 mb-2"></div>
        <div class="skeleton h-3.5 w-64 max-w-full mb-3"></div>
        <div class="skeleton h-3.5 w-full mb-3"></div>
        <div class="skeleton h-5 w-48"></div>
      </div>
      <div class="skeleton h-8 w-[104px] hidden sm:block"></div>
    </div>`.repeat(6);
}

function renderPagination(total, start, shownCount, totalPages) {
  el('discoverPagination').innerHTML = peoplePaginationHtml(view.page, total, start, shownCount, totalPages);
}

// The skills most people list, with real counts
function renderTrending() {
  const counts = new Map();
  for (const person of directory) {
    person.x.skills.forEach((skill, i) => {
      const entry = counts.get(person.x.skillKeys[i]) || { label: skill, count: 0 };
      entry.count++;
      counts.set(person.x.skillKeys[i], entry);
    });
  }
  const top = [...counts.entries()].sort((a, b) => (b[1].count - a[1].count) || a[1].label.localeCompare(b[1].label)).slice(0, TRENDING_COUNT);
  el('trendingSection').classList.toggle('hidden', top.length === 0);

  const current = norm(view.q);
  el('trendingSkills').innerHTML = top.map(([key, entry]) => {
    const active = key === current;
    return `<button type="button" data-skill="${escapeHtml(entry.label)}" aria-pressed="${active}" title="Search ${escapeHtml(entry.label)}" class="w-[calc(100%+16px)] -mx-2 px-2 py-1.5 rounded-md flex items-center justify-between gap-2 text-[13px] text-left transition-colors ${active ? 'bg-indigo-50 text-primary font-semibold' : 'text-slate-700 hover:bg-slate-100'}">
      <span class="truncate">${escapeHtml(entry.label)}</span>
      <span class="text-[12px] tabular-nums shrink-0 ${active ? 'text-primary' : 'text-slate-400'}">${entry.count}</span>
    </button>`;
  }).join('');
}

// College, department and city choices come from the people who are actually here
function renderFacets() {
  const facets = [
    ['college', 'filterCollege', 'All colleges', 'college_name'],
    ['department', 'filterDepartment', 'All departments', 'department'],
    ['city', 'filterCity', 'All cities', 'city']
  ];
  let collegeCount = 0;
  for (const [key, id, allLabel, field] of facets) {
    const counts = new Map();
    for (const person of directory) {
      if (!person.x[key]) continue;
      const entry = counts.get(person.x[key]) || { label: String(person[field]).trim(), count: 0 };
      entry.count++;
      counts.set(person.x[key], entry);
    }
    if (key === 'college') collegeCount = counts.size;
    // A choice that came from a link stays selectable even if nobody matches it right now
    if (view[key] && !counts.has(view[key])) counts.set(view[key], { label: view[key], count: 0 });
    const options = [...counts.entries()].sort((a, b) => (b[1].count - a[1].count) || a[1].label.localeCompare(b[1].label));
    el(id).innerHTML = `<option value="">${allLabel}</option>` + options.map(([value, entry]) =>
      `<option value="${escapeHtml(value)}">${escapeHtml(entry.label)} (${entry.count})</option>`).join('');
    el(id).value = view[key];
  }
  // Filters that nobody would pass are left out until someone qualifies
  const anyVerified = directory.some(person => person.account_status === 'verified');
  const anyProfessional = directory.some(person => person.account_type === 'professional');
  document.querySelector('[data-toggle="verified"]').classList.toggle('hidden', !anyVerified && !view.verified);
  el('filterTypeField').classList.toggle('hidden', !anyProfessional && !view.type);

  if (directory.length > 0) {
    el('directorySummary').textContent = `${directory.length} ${directory.length === 1 ? 'person' : 'people'}`
      + (collegeCount > 0 ? ` across ${collegeCount} ${collegeCount === 1 ? 'college' : 'colleges'}` : '');
  }
}

function syncControls() {
  const input = el('talent-search-input');
  if (input.value.trim() !== view.q) input.value = view.q;
  el('searchClearBtn').classList.toggle('hidden', !view.q);
  el('searchShortcutHint').classList.toggle('md:block', !view.q);
  SELECT_FILTERS.forEach(key => {
    const select = document.querySelector(`[data-filter="${key}"]`);
    select.value = view[key];
    select.classList.toggle('is-set', key !== 'sort' && Boolean(view[key]));
  });
  TOGGLE_FILTERS.forEach(key => {
    document.querySelector(`[data-toggle="${key}"]`).setAttribute('aria-pressed', String(view[key]));
  });
  renderActiveFilters();
}

// ==========================================
// 5. CONTROLS
// ==========================================
function bindControls() {
  const input = el('talent-search-input');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { view.q = input.value.trim(); viewChanged(); }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); setSearch(input.value.trim()); }
    if (e.key === 'Escape' && input.value) { e.preventDefault(); setSearch(''); }
  });
  el('searchClearBtn').addEventListener('click', () => { setSearch(''); input.focus(); });
  el('clearFiltersBtn').addEventListener('click', clearFilters);
  el('activeFilterChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-clear]');
    if (chip) clearFilter(chip.dataset.clear);
  });
  // On phones the filters sit behind this button
  el('filterPanelBtn').addEventListener('click', () => {
    const nowHidden = el('filterPanel').classList.toggle('hidden');
    el('filterPanelBtn').setAttribute('aria-expanded', String(!nowHidden));
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) el('searchShortcutHint').textContent = '⌘K';

  SELECT_FILTERS.forEach(key => {
    document.querySelector(`[data-filter="${key}"]`).addEventListener('change', (e) => { view[key] = e.target.value; viewChanged(); });
  });
  TOGGLE_FILTERS.forEach(key => {
    document.querySelector(`[data-toggle="${key}"]`).addEventListener('click', () => { view[key] = !view[key]; viewChanged(); });
  });

  el('trendingSkills').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-skill]');
    if (pill) setSearch(norm(view.q) === norm(pill.dataset.skill) ? '' : pill.dataset.skill);
  });

  const grid = el('search-results-grid');
  grid.addEventListener('click', onGridClick);
  bindAvatarFallback(grid);

  el('discoverPagination').addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    view.page = parseInt(button.dataset.page);
    viewChanged(true);
    el('resultsTop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusDiscoverSearch(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); focusDiscoverSearch(); }
  });
}

function onGridClick(e) {
  const skill = e.target.closest('[data-skill]');
  if (skill) return setSearch(skill.dataset.skill);

  const button = e.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'retry') { renderSkeleton(); return loadDirectory(); }
  if (action === 'clear') return clearFilters();

  const card = button.closest('[data-id]');
  const personId = card ? parseInt(card.dataset.id) : 0;
  if (action === 'follow' || action === 'save') toggleRelation(action, personId);
  if (action === 'team') window.openAddToTeamModal(personId);
}

function setSearch(text) {
  clearTimeout(searchTimer);
  view.q = text;
  viewChanged();
}

function clearFilter(key) {
  if (key === 'q') return setSearch('');
  view[key] = TOGGLE_FILTERS.includes(key) ? false : '';
  viewChanged();
}

function clearFilters() {
  clearTimeout(searchTimer);
  view.q = '';
  ['college', 'department', 'city', 'type'].forEach(key => { view[key] = ''; });
  TOGGLE_FILTERS.forEach(key => { view[key] = false; });
  viewChanged();
}

// The "Search network" box in the site header and Ctrl/⌘+K both land here
function focusDiscoverSearch() {
  const input = el('talent-search-input');
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.focus({ preventScroll: true });
  input.select();
}

function showGuidelines() {
  const rules = [
    ['Be clear about the work', 'Say what you are building, the role you need filled and the time it will take before you invite someone.'],
    ['Credit everyone', 'List every contributor on submissions, repositories and papers. Do not present shared work as only yours.'],
    ['Follow both colleges\' rules', 'Cross-campus teams must respect each institute\'s honor code and each event\'s eligibility rules.'],
    ['Keep it respectful', 'No spam invitations, no harassment. Use Block in Messages and tell a campus ambassador if someone crosses the line.'],
    ['Protect private details', 'Share contact details, ID documents and repository access only with people on your team.']
  ];
  window.showSystemModal('Cross-Campus Collaboration Guidelines', rules.map(([title, text]) =>
    `<span style="display:block;margin-bottom:10px;"><strong style="color:#0b1c30;">${escapeHtml(title)}.</strong> ${escapeHtml(text)}</span>`).join(''), 'alert', null, 'Got it');
}

// ==========================================
// 6. FOLLOW AND SAVE
// ==========================================
function refreshCard(personId) {
  const person = directoryById.get(personId);
  const card = el('search-results-grid').querySelector(`[data-id="${personId}"]`);
  if (person && card) card.outerHTML = cardHtml(person);
}

async function toggleRelation(kind, personId) {
  const person = directoryById.get(personId);
  if (!person) return;
  const done = await togglePersonRelation(kind, person, pendingActions, () => refreshCard(personId));
  if (!done) return;
  saveDirectory();
  // With the Following or Saved filter on, this person may no longer belong in the list
  if (view[kind === 'follow' ? 'following' : 'saved'] || view.sort === 'followers') render();
}

// ==========================================
// 7. LIVE UPDATES
// ==========================================
function handleLiveEvent(data) {
  switch (data.type) {
    case 'presence': {
      if (data.online) onlineUserIds.add(data.user_id); else onlineUserIds.delete(data.user_id);
      if (view.online) return render();
      const dot = el('search-results-grid').querySelector(`[data-id="${data.user_id}"] [data-online-dot]`);
      if (dot) dot.classList.toggle('hidden', !data.online);
      return;
    }
    case 'profile_updated': {
      const person = data.profile && directoryById.get(data.profile.id);
      if (!person) return;
      Object.assign(person, data.profile);
      indexPerson(person);
      return queueRender();
    }
    case 'profile_added': {
      const profile = data.profile;
      if (!profile || profile.id === currentUserId || directoryById.has(profile.id) || profile.account_status === 'rejected') return;
      const person = indexPerson(Object.assign({ followers_count: 0, is_following: false, is_saved: false, projects_text: '' }, profile));
      directory.unshift(person);
      directoryById.set(person.id, person);
      return queueRender();
    }
    case 'follow_changed': {
      const person = directoryById.get(data.followed_id);
      if (!person) return;
      if (data.follower_id === currentUserId) {
        // Our own follow, made here or in another tab. The button already shows it if it was made here.
        if (person.is_following === data.following || pendingActions.has(`follow:${person.id}`)) return;
        person.is_following = data.following;
      }
      person.followers_count = Math.max(0, person.followers_count + (data.following ? 1 : -1));
      return queueRender();
    }
  }
}

initDiscover();
