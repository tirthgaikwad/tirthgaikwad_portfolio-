// ==========================================
// DISCOVER.JS — The Discover Talent page: search, filters, follow/save/add-to-team, live updates
// Loaded after shared.js and chat-common.js (api, caches, toast, el, getInitials, onlineUserIds).
// ==========================================

const CARDS_PER_PAGE = 9;
const REFRESH_AFTER_MS = 60000;
const MAX_SKILLS_ON_CARD = 5;
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
const FILTER_LABELS = { online: 'Online now', verified: 'Verified', following: 'Following', saved: 'Saved' };

const pendingActions = new Set(); // "follow:12" while that request is in flight
let searchTimer = null;
let renderQueued = false;
let liveSocket = null;
let liveRetries = 0;

const norm = (value) => String(value || '').trim().toLowerCase();

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
  connectLive();

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

// Search text and lookup keys are worked out once per person, not on every keystroke
function indexPerson(person) {
  const skills = String(person.skills || '').split(',').map(s => s.trim()).filter(Boolean);
  person.x = {
    skills,
    skillKeys: skills.map(norm),
    name: norm(person.name),
    college: norm(person.college_name),
    department: norm(person.department),
    city: norm(person.city),
    text: norm([person.name, person.college_name, person.department, person.city, person.skills, person.bio, person.projects_text, person.github_username].join(' '))
  };
  return person;
}

function saveDirectory() {
  cacheSet('discover', { people: directory.map(({ x, ...person }) => person) });
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

function hasActiveFilters() {
  return Boolean(view.q || view.college || view.department || view.city || view.type || TOGGLE_FILTERS.some(key => view[key]));
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
}

function avatarMarkup(person) {
  const initials = `<span class="text-primary font-bold text-headline-md">${escapeHtml(getInitials(person.name || '?'))}</span>`;
  const picture = safeUrl(person.profile_pic);
  if (!person.profile_pic || picture === '#') return initials;
  return `<img src="${escapeHtml(picture)}" alt="" loading="lazy" decoding="async" data-initials="${escapeHtml(getInitials(person.name || '?'))}" class="w-full h-full object-cover"/>`;
}

function cardHtml(person) {
  const profileLink = `profile.html?id=${person.id}`;
  const online = onlineUserIds.has(person.id);
  const place = [person.department, person.city].filter(Boolean).join(' · ');
  const shown = person.x.skills.slice(0, MAX_SKILLS_ON_CARD);
  const extra = person.x.skills.length - shown.length;
  const skillsHtml = shown.map(skill => {
    const shared = mySkills.has(norm(skill));
    return `<button type="button" data-skill="${escapeHtml(skill)}" title="${shared ? 'You both list this skill. ' : ''}Search ${escapeHtml(skill)}" class="px-2 py-0.5 rounded font-skill-pill text-skill-pill transition-colors ${shared ? 'bg-primary-fixed text-on-primary-fixed-variant hover:bg-primary-fixed-dim' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'}">${escapeHtml(skill)}</button>`;
  }).join('') + (extra > 0 ? `<span class="px-2 py-0.5 rounded text-outline font-skill-pill text-skill-pill">+${extra}</span>` : '');
  const followBusy = pendingActions.has(`follow:${person.id}`) ? 'disabled' : '';
  const saveBusy = pendingActions.has(`save:${person.id}`) ? 'disabled' : '';

  return `
    <article class="developer-card group bg-surface-container-lowest rounded-xl p-space-lg shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col relative" data-id="${person.id}">
      <div class="flex items-start justify-between gap-space-sm mb-space-md">
        <a class="relative block shrink-0" href="${profileLink}" aria-label="${escapeHtml(person.name)}'s profile">
          <div class="w-16 h-16 rounded-full overflow-hidden shadow-md ring-2 ring-surface-container bg-surface-container flex items-center justify-center">${avatarMarkup(person)}</div>
          <span data-online-dot class="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white ${online ? '' : 'hidden'}" title="Online now"></span>
        </a>
        <div class="flex items-center gap-1">
          <button type="button" data-action="save" ${saveBusy} aria-pressed="${person.is_saved}" title="${person.is_saved ? 'Remove from Saved Profiles' : 'Save profile'}" class="p-2 rounded-lg transition-colors ${person.is_saved ? 'text-primary bg-primary-fixed/60 hover:bg-primary-fixed' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'}">
            <span class="material-symbols-outlined text-[20px] block">${person.is_saved ? 'bookmark_added' : 'bookmark_add'}</span>
          </button>
          <button type="button" data-action="team" title="Add to one of your teams" class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors">
            <span class="material-symbols-outlined text-[20px] block">group_add</span>
          </button>
        </div>
      </div>
      <a class="block mb-space-sm" href="${profileLink}">
        <h3 class="font-headline-md text-headline-md text-on-surface font-bold group-hover:text-primary transition-colors flex items-center gap-1.5">
          <span class="truncate">${escapeHtml(person.name || 'Unnamed')}</span>
          ${person.account_status === 'verified' ? '<span class="material-symbols-outlined text-[18px] text-primary shrink-0" title="Verified account">verified</span>' : ''}
          ${person.account_type === 'professional' ? '<span class="shrink-0 px-1.5 py-0.5 rounded bg-secondary-container text-on-secondary-container text-[10px] font-semibold uppercase tracking-wide">Pro</span>' : ''}
        </h3>
        <p class="font-body-sm text-body-sm text-primary font-medium flex items-center gap-1 mt-0.5">
          <span class="material-symbols-outlined text-[15px] shrink-0">school</span>
          <span class="truncate">${escapeHtml(person.college_name || 'No college listed')}</span>
        </p>
        ${place ? `<p class="font-body-sm text-body-sm text-on-surface-variant truncate mt-0.5">${escapeHtml(place)}</p>` : ''}
      </a>
      ${person.bio ? `<p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2 mb-space-sm">${escapeHtml(person.bio)}</p>` : ''}
      <div class="mb-space-md">
        <div class="flex flex-wrap gap-1.5">${skillsHtml || '<span class="font-body-sm text-body-sm text-outline">No skills listed yet</span>'}</div>
      </div>
      <div class="mt-auto pt-space-sm border-t border-outline-variant/30">
        <p class="font-body-sm text-body-sm text-on-surface-variant mb-space-xs flex items-center gap-1">
          <span class="material-symbols-outlined text-[15px]">group</span>
          <span>${person.followers_count} ${person.followers_count === 1 ? 'follower' : 'followers'}</span>
          ${person.is_following ? '<span class="text-outline">· you follow</span>' : ''}
        </p>
        <div class="flex items-center gap-2">
          <a class="flex-1 py-2 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md text-center transition-colors" href="${profileLink}">View Profile</a>
          <button type="button" data-action="follow" ${followBusy} aria-pressed="${person.is_following}" class="py-2 px-3 rounded-lg font-label-md text-label-md flex items-center gap-1 transition-colors ${person.is_following ? 'border border-outline-variant/60 text-on-surface-variant hover:text-error hover:border-error/40' : 'bg-primary hover:bg-primary-container text-on-primary'}">
            <span class="material-symbols-outlined text-[16px]">${person.is_following ? 'check' : 'person_add'}</span>
            <span>${person.is_following ? 'Following' : 'Follow'}</span>
          </button>
          <a class="py-2 px-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors" title="Message" aria-label="Message ${escapeHtml(person.name)}" href="inbox.html?user=${person.id}">
            <span class="material-symbols-outlined text-[20px] block">chat</span>
          </a>
        </div>
      </div>
    </article>`;
}

function stateBlock(icon, title, text, buttonHtml) {
  return `
    <div class="col-span-full flex flex-col items-center text-center py-space-2xl">
      <span class="material-symbols-outlined text-[44px] text-outline-variant mb-space-xs">${icon}</span>
      <h3 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(title)}</h3>
      <p class="font-body-md text-body-md text-on-surface-variant mt-1 max-w-md">${escapeHtml(text)}</p>
      ${buttonHtml ? `<div class="mt-space-md">${buttonHtml}</div>` : ''}
    </div>`;
}

function emptyHtml() {
  if (directory.length === 0) {
    return stateBlock('group_off', 'No one else is here yet', 'When more people join ProPartner they will show up on this page.', '');
  }
  return stateBlock('search_off', 'No one matches that', 'Try a different skill or name, or remove some filters.',
    '<button type="button" data-action="clear" class="btn-primary-modal">Clear search and filters</button>');
}

function renderProblem(message) {
  el('search-results-grid').innerHTML = stateBlock('cloud_off', 'Could not load people', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
  el('discoverPagination').innerHTML = '';
  el('resultCount').textContent = '';
}

function renderSkeleton() {
  const card = `
    <div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm">
      <div class="skeleton w-16 h-16 mb-space-md" style="border-radius:9999px;"></div>
      <div class="skeleton h-5 w-2/3 mb-2"></div>
      <div class="skeleton h-3.5 w-1/2 mb-space-md"></div>
      <div class="skeleton h-3.5 w-full mb-2"></div>
      <div class="skeleton h-3.5 w-4/5 mb-space-md"></div>
      <div class="skeleton h-9 w-full"></div>
    </div>`;
  el('search-results-grid').innerHTML = card.repeat(6);
}

function renderPagination(total, start, shownCount, totalPages) {
  const container = el('discoverPagination');
  if (total === 0) { container.innerHTML = ''; return; }

  const pageButton = (page) => page === view.page
    ? `<button class="w-8 h-8 rounded-lg bg-primary text-on-primary font-label-md text-label-md flex items-center justify-center font-bold shadow-sm" type="button" aria-current="page">${page}</button>`
    : `<button class="w-8 h-8 rounded-lg text-on-surface-variant hover:bg-surface-container font-label-md text-label-md flex items-center justify-center transition-colors" type="button" data-page="${page}">${page}</button>`;
  let pages = '';
  for (let page = 1; page <= totalPages; page++) {
    if (page === 1 || page === totalPages || Math.abs(page - view.page) <= 1) pages += pageButton(page);
    else if (Math.abs(page - view.page) === 2) pages += '<span class="px-1 text-outline font-label-md">...</span>';
  }
  const stepClass = 'px-3 py-1.5 rounded-lg border border-outline-variant/60 text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-label-md text-label-md disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1 transition-colors';

  container.innerHTML = `
    <div class="font-body-sm text-body-sm text-on-surface-variant">
      Showing <span class="font-medium text-on-surface">${start + 1} - ${start + shownCount}</span> of <span class="font-medium text-on-surface">${total}</span> ${total === 1 ? 'person' : 'people'}
    </div>
    <div class="flex items-center gap-1 ${totalPages === 1 ? 'hidden' : ''}">
      <button class="${stepClass}" type="button" data-page="${view.page - 1}" ${view.page === 1 ? 'disabled' : ''}>
        <span class="material-symbols-outlined text-[16px]">chevron_left</span> Previous
      </button>
      ${pages}
      <button class="${stepClass}" type="button" data-page="${view.page + 1}" ${view.page === totalPages ? 'disabled' : ''}>
        Next <span class="material-symbols-outlined text-[16px]">chevron_right</span>
      </button>
    </div>`;
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
  const container = el('trendingSkills');
  if (top.length === 0) { container.innerHTML = ''; return; }

  const current = norm(view.q);
  container.innerHTML = `
    <span class="font-label-sm text-label-sm uppercase tracking-wider text-outline mr-space-2xs flex items-center gap-1">
      <span class="material-symbols-outlined text-[14px]">local_fire_department</span> Trending:
    </span>` + top.map(([key, entry]) => {
    const active = key === current;
    return `<button type="button" data-skill="${escapeHtml(entry.label)}" aria-pressed="${active}" class="px-space-sm py-1 rounded-full font-skill-pill text-skill-pill flex items-center gap-1 transition-colors active:scale-95 ${active ? 'bg-primary text-on-primary shadow-sm' : 'bg-surface-container-lowest hover:bg-surface-container text-on-surface-variant border border-outline-variant/30'}">
      ${escapeHtml(entry.label)} <span class="text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20' : 'bg-surface-container-high text-on-surface'}">${entry.count}</span>
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
  for (const [key, id, allLabel, field] of facets) {
    const counts = new Map();
    for (const person of directory) {
      if (!person.x[key]) continue;
      const entry = counts.get(person.x[key]) || { label: String(person[field]).trim(), count: 0 };
      entry.count++;
      counts.set(person.x[key], entry);
    }
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
  el('filterType').classList.toggle('hidden', !anyProfessional && !view.type);
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
  el('clearFiltersBtn').classList.toggle('hidden', !hasActiveFilters());
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
    if (e.key === 'Enter') { e.preventDefault(); searchNow(); }
    if (e.key === 'Escape' && input.value) { e.preventDefault(); setSearch(''); }
  });
  el('search-btn').addEventListener('click', searchNow);
  el('searchClearBtn').addEventListener('click', () => { setSearch(''); input.focus(); });
  el('clearFiltersBtn').addEventListener('click', clearFilters);
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
  // A picture that fails to load is swapped for the person's initials
  grid.addEventListener('error', (e) => {
    if (e.target.tagName !== 'IMG') return;
    const initials = document.createElement('span');
    initials.className = 'text-primary font-bold text-headline-md';
    initials.textContent = e.target.dataset.initials || '?';
    e.target.replaceWith(initials);
  }, true);

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

function searchNow() {
  setSearch(el('talent-search-input').value.trim());
  el('resultsTop').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

// The card changes at once; the server's answer then confirms it or puts it back
async function toggleRelation(kind, personId) {
  const person = directoryById.get(personId);
  const key = `${kind}:${personId}`;
  if (!person || pendingActions.has(key)) return;
  pendingActions.add(key);

  const field = kind === 'follow' ? 'is_following' : 'is_saved';
  const before = person[field];
  const followersBefore = person.followers_count;
  const apply = (value) => {
    person[field] = value;
    if (kind === 'follow') person.followers_count = Math.max(0, followersBefore + (value === before ? 0 : (value ? 1 : -1)));
  };

  apply(!before);
  refreshCard(personId);
  try {
    const result = await api(`/api/${kind}/${personId}`, { method: 'POST' });
    apply(result.status === (kind === 'follow' ? 'followed' : 'saved'));
    if (kind === 'follow') showToast(person.is_following ? `You are now following ${person.name}.` : `You unfollowed ${person.name}.`);
    else showToast(person.is_saved ? 'Saved. Find it under Saved Profiles.' : 'Removed from Saved Profiles.');
  } catch (err) {
    apply(before);
    showToast(err.message);
  }
  pendingActions.delete(key);
  saveDirectory();
  // With the Following or Saved filter on, this person may no longer belong in the list
  if (view[kind === 'follow' ? 'following' : 'saved'] || view.sort === 'followers') render();
  else refreshCard(personId);
}

// ==========================================
// 7. LIVE UPDATES
// ==========================================
function connectLive() {
  let socket;
  try {
    socket = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/api/ws/notifications/${currentUserId}`);
  } catch (e) { return; }
  liveSocket = socket;

  socket.onopen = () => {
    // Anything that changed while we were disconnected was missed, so ask again
    if (liveRetries > 0) loadDirectory();
    liveRetries = 0;
  };
  socket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    if (data && directoryLoaded) handleLiveEvent(data);
  };
  socket.onclose = () => {
    if (liveSocket !== socket) return;
    liveSocket = null;
    setTimeout(connectLive, Math.min(30000, 1000 * 2 ** liveRetries++));
  };
}

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
    default:
      // A bell notification for us
      if (data.content) {
        document.querySelectorAll('[data-notif-badge]').forEach(badge => {
          const count = (parseInt(badge.textContent) || 0) + 1;
          badge.textContent = count > 99 ? '99+' : count;
          badge.style.display = 'flex';
        });
        showToast(data.content);
      }
  }
}

initDiscover();
