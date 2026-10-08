// ==========================================
// BOARD.JS — The Opportunities Board: posts, search, filters, applying, applicants, live updates
// Loaded after shared.js and chat-common.js (api, caches, toast, el, getInitials, connectNotifications).
// ==========================================

const POSTS_PER_PAGE = 9;
const BOARD_REFRESH_AFTER_MS = 60000;
const QUICK_SKILL_COUNT = 5;
const BOARD_CATEGORIES = ['Hackathon', 'Side Project', 'Research / AI', 'Open Source'];
const CATEGORY_LABELS = { 'Hackathon': 'Hackathons', 'Side Project': 'Side Projects', 'Research / AI': 'Research / AI', 'Open Source': 'Open Source' };
const CATEGORY_ICONS = { 'Hackathon': 'emoji_events', 'Side Project': 'work', 'Research / AI': 'science', 'Open Source': 'code' };
const FIELD_LIMITS = { title: 120, skills: 300, description: 2000, note: 500 };

let posts = [];                   // every post on the board, as returned by /api/board
let postsById = new Map();
let boardLoaded = false;          // false until the first list (cached or fresh) is on screen
let boardLoading = false;
let boardLoadedAt = 0;
let viewerIsAdmin = false;

// What the person has typed and picked. Mirrored in the address bar.
const boardView = { q: '', category: '', sort: 'newest', mine: false, applied: false, page: 1 };
const BOARD_TOGGLES = ['mine', 'applied'];

const pendingPosts = new Set();   // post ids with an apply/withdraw/delete request in flight
let boardSearchTimer = null;
let boardRenderQueued = false;
let editingPostId = null;         // post being edited in the form, or null when writing a new one
let applyingPostId = null;
let detailPostId = null;
let applicantsPostId = null;

const normText = (value) => String(value || '').trim().toLowerCase();

// ==========================================
// 1. LOADING
// ==========================================
function initBoard() {
  const params = readBoardViewFromUrl();
  bindBoardControls();
  syncBoardControls();

  // 1. The copy saved on the last visit, so the page is never blank
  const cached = cacheGet('board');
  if (cached && Array.isArray(cached.posts)) {
    viewerIsAdmin = Boolean(cached.viewer_is_admin);
    setPosts(cached.posts);
  } else {
    renderBoardSkeleton();
  }

  // 2. The real thing (already requested from the page head)
  loadBoard();
  connectNotifications((data) => { if (boardLoaded) handleBoardEvent(data); }, loadBoard);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - boardLoadedAt > BOARD_REFRESH_AFTER_MS) loadBoard();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadBoard(); });

  // board.html?new=1 opens the form straight away (used by links on other pages)
  if (params.get('new') === '1') openPostForm();
}

async function loadBoard() {
  if (boardLoading) return;
  boardLoading = true;
  try {
    const prefetched = window.__boardPrefetch ? await window.__boardPrefetch : null;
    window.__boardPrefetch = null;
    let data;
    if (prefetched && prefetched.status === 200) {
      data = prefetched.data;
    } else if (prefetched && prefetched.status === 401) {
      return handleLoggedOut();
    } else {
      data = await api('/api/board');
    }
    boardLoadedAt = Date.now();
    viewerIsAdmin = Boolean(data.viewer_is_admin);
    setPosts(data.posts || []);
    saveBoard();
  } catch (err) {
    if (!boardLoaded) renderBoardProblem(err.message);
  } finally {
    boardLoading = false;
  }
}

function setPosts(list) {
  posts = list.map(indexPost);
  postsById = new Map(posts.map(post => [post.id, post]));
  boardLoaded = true;
  renderBoard();
}

// Search text and skill keys are worked out once per post, not on every keystroke
function indexPost(post) {
  const skills = String(post.skills_required || '').split(',').map(s => s.trim()).filter(Boolean);
  post.x = {
    skills,
    skillKeys: skills.map(normText),
    time: Date.parse(post.created_at) || 0,
    text: normText([post.title, post.description, post.skills_required, post.category, post.author_name, post.author_college].join(' '))
  };
  return post;
}

function saveBoard() {
  cacheSet('board', { posts: posts.map(({ x, ...post }) => post), viewer_is_admin: viewerIsAdmin });
}

// ==========================================
// 2. ADDRESS BAR
// ==========================================
function readBoardViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  boardView.q = (params.get('q') || '').trim();
  boardView.category = BOARD_CATEGORIES.includes(params.get('category')) ? params.get('category') : '';
  boardView.sort = ['newest', 'oldest', 'applicants'].includes(params.get('sort')) ? params.get('sort') : 'newest';
  BOARD_TOGGLES.forEach(key => { boardView[key] = params.get(key) === '1'; });
  boardView.page = Math.max(1, parseInt(params.get('page')) || 1);
  return params;
}

function writeBoardViewToUrl() {
  const params = new URLSearchParams();
  if (boardView.q) params.set('q', boardView.q);
  if (boardView.category) params.set('category', boardView.category);
  if (boardView.sort !== 'newest') params.set('sort', boardView.sort);
  BOARD_TOGGLES.forEach(key => { if (boardView[key]) params.set(key, '1'); });
  if (boardView.page > 1) params.set('page', boardView.page);
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

// ==========================================
// 3. FILTERING AND SORTING
// ==========================================
// Everything except the category, so the category tabs can show how many posts each one would give
function matchesSearchAndToggles(post, tokens) {
  if (boardView.mine && post.author_id !== currentUserId) return false;
  if (boardView.applied && !post.has_applied) return false;
  return tokens.every(token => post.x.text.includes(token));
}

function filteredPosts() {
  const tokens = normText(boardView.q).split(/\s+/).filter(Boolean);
  const list = posts.filter(post => (!boardView.category || post.category === boardView.category) && matchesSearchAndToggles(post, tokens));
  const byAge = (a, b) => (b.x.time - a.x.time) || (b.id - a.id);
  const order = boardView.sort === 'oldest' ? (a, b) => byAge(b, a)
    : boardView.sort === 'applicants' ? (a, b) => (b.applicant_count - a.applicant_count) || byAge(a, b)
    : byAge;
  // Urgent posts stay on top whatever the order
  return list.sort((a, b) => (Number(b.is_urgent) - Number(a.is_urgent)) || order(a, b));
}

function boardHasFilters() {
  return Boolean(boardView.q || boardView.category || boardView.mine || boardView.applied);
}

// ==========================================
// 4. RENDERING
// ==========================================
function queueBoardRender() {
  if (boardRenderQueued) return;
  boardRenderQueued = true;
  requestAnimationFrame(() => {
    boardRenderQueued = false;
    renderBoard();
    saveBoard();
  });
}

function boardViewChanged(keepPage) {
  if (!keepPage) boardView.page = 1;
  writeBoardViewToUrl();
  syncBoardControls();
  if (boardLoaded) renderBoard();
}

function renderBoard() {
  const list = filteredPosts();
  const totalPages = Math.max(1, Math.ceil(list.length / POSTS_PER_PAGE));
  if (boardView.page > totalPages) { boardView.page = totalPages; writeBoardViewToUrl(); }

  const start = (boardView.page - 1) * POSTS_PER_PAGE;
  const visible = list.slice(start, start + POSTS_PER_PAGE);
  el('board-grid').innerHTML = visible.length ? visible.map(postCardHtml).join('') : boardEmptyHtml();

  el('activeCallsCount').textContent = list.length === posts.length
    ? `${posts.length} open`
    : `${list.length} of ${posts.length} match`;
  const urgent = posts.filter(post => post.is_urgent).length;
  el('heroBadgeText').textContent = `${posts.length} open ${posts.length === 1 ? 'opportunity' : 'opportunities'}` + (urgent ? ` • ${urgent} urgent` : '');
  renderBoardPagination(list.length, start, visible.length, totalPages);
  renderCategoryTabs();
  renderQuickSkills();
  if (detailPostId !== null) renderPostDetails();
}

function timeAgo(timestamp) {
  const then = Date.parse(timestamp);
  if (!then) return 'recently';
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))}d ago`;
  return new Date(then).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function smallAvatarHtml(picture, name, sizeClass) {
  const initials = escapeHtml(getInitials(name || '?'));
  const url = safeUrl(picture);
  const inner = picture && url !== '#'
    ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" data-initials="${initials}" class="w-full h-full object-cover"/>`
    : `<span class="text-primary font-bold text-[11px]">${initials}</span>`;
  return `<span class="${sizeClass} rounded-full overflow-hidden bg-surface-container flex items-center justify-center shrink-0">${inner}</span>`;
}

function skillPillsHtml(post, limit) {
  const shown = post.x.skills.slice(0, limit);
  const extra = post.x.skills.length - shown.length;
  return shown.map(skill =>
    `<button type="button" data-skill="${escapeHtml(skill)}" title="Search ${escapeHtml(skill)}" class="px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-skill-pill text-skill-pill transition-colors">${escapeHtml(skill)}</button>`
  ).join('') + (extra > 0 ? `<span class="px-2 py-0.5 rounded text-outline font-skill-pill text-skill-pill">+${extra}</span>` : '');
}

// The buttons under a post: different for its author, for an admin and for everyone else
function postActionsHtml(post) {
  const mine = post.author_id === currentUserId;
  const busy = pendingPosts.has(post.id) ? 'disabled' : '';
  const iconButton = 'p-2 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-50';
  const deleteButton = `<button type="button" data-action="delete" ${busy} title="Delete post" class="${iconButton} hover:text-error"><span class="material-symbols-outlined text-[20px] block">delete</span></button>`;

  if (mine) {
    return `
      <button type="button" data-action="applicants" class="px-space-sm py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors flex items-center gap-1">
        <span class="material-symbols-outlined text-[16px]">groups</span> Applicants (${post.applicant_count})
      </button>
      <button type="button" data-action="edit" title="Edit post" class="${iconButton} hover:text-primary"><span class="material-symbols-outlined text-[20px] block">edit</span></button>
      ${deleteButton}`;
  }
  return `
    ${viewerIsAdmin ? deleteButton : ''}
    ${post.author_id ? `<a href="inbox.html?user=${post.author_id}" title="Message ${escapeHtml(post.author_name)}" class="${iconButton} hover:text-primary"><span class="material-symbols-outlined text-[20px] block">chat</span></a>` : ''}
    <button type="button" data-action="${post.has_applied ? 'withdraw' : 'apply'}" ${busy} aria-pressed="${post.has_applied}" title="${post.has_applied ? 'Click to withdraw your application' : 'Apply to this post'}" class="px-space-md py-1.5 rounded-lg font-label-md text-label-md transition-colors flex items-center gap-1 disabled:opacity-60 ${post.has_applied ? 'border border-outline-variant/60 text-on-surface-variant hover:text-error hover:border-error/40' : 'bg-primary hover:bg-primary-container text-on-primary'}">
      <span class="material-symbols-outlined text-[16px]">${post.has_applied ? 'check' : 'send'}</span>
      <span>${post.has_applied ? 'Applied' : 'Apply'}</span>
    </button>`;
}

function postBadgesHtml(post) {
  return `
    ${post.is_urgent ? '<span class="px-2 py-0.5 rounded-full bg-error-container text-on-error-container font-label-sm text-[10px] font-bold uppercase tracking-wide flex items-center gap-1"><span class="material-symbols-outlined text-[13px]">priority_high</span>Urgent</span>' : ''}
    <span class="px-2 py-0.5 rounded-full bg-tertiary text-on-tertiary font-label-sm text-[10px] font-bold flex items-center gap-1">
      <span class="material-symbols-outlined text-[13px]">${CATEGORY_ICONS[post.category] || 'work'}</span>${escapeHtml(post.category || 'Opportunity')}
    </span>
    ${post.author_id === currentUserId ? '<span class="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant font-label-sm text-[10px] font-bold">Your post</span>' : ''}`;
}

function authorLineHtml(post) {
  // The name keeps its room; a long college name is what gets cut short
  const nameClass = 'font-medium text-on-surface truncate shrink-0 max-w-[60%]';
  return `
    ${smallAvatarHtml(post.author_pic, post.author_name, 'w-6 h-6')}
    ${post.author_id
      ? `<a href="profile.html?id=${post.author_id}" class="${nameClass} hover:text-primary transition-colors">${escapeHtml(post.author_name)}</a>`
      : `<span class="${nameClass}">${escapeHtml(post.author_name)}</span>`}
    ${post.author_college ? `<span class="text-outline">•</span><span class="truncate min-w-0">${escapeHtml(post.author_college)}</span>` : ''}`;
}

function postCardHtml(post) {
  return `
    <article class="developer-card group bg-surface-container-lowest rounded-xl p-space-lg shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col border ${post.is_urgent ? 'border-error/30' : 'border-outline-variant/30'} relative" data-id="${post.id}">
      <div class="flex items-center flex-wrap gap-1.5 mb-space-sm">${postBadgesHtml(post)}</div>
      <button type="button" data-action="details" class="text-left mb-space-sm">
        <h3 class="font-headline-md text-headline-md text-on-surface font-bold group-hover:text-primary transition-colors line-clamp-2">${escapeHtml(post.title)}</h3>
      </button>
      <div class="flex items-center gap-2 mb-space-sm text-on-surface-variant font-body-sm text-body-sm min-w-0">${authorLineHtml(post)}</div>
      <p class="font-body-md text-body-md text-on-surface-variant mb-space-sm line-clamp-3">${escapeHtml(post.description || 'No description provided.')}</p>
      <div class="flex items-center gap-1.5 flex-wrap mb-space-md">${skillPillsHtml(post, 6)}</div>
      <div class="mt-auto pt-space-sm border-t border-outline-variant/30 flex items-center justify-between gap-2">
        <div class="font-label-sm text-label-sm text-on-surface-variant normal-case">
          ${timeAgo(post.created_at)}${post.author_id !== currentUserId && post.applicant_count ? ` · ${post.applicant_count} applied` : ''}
        </div>
        <div class="flex items-center gap-1">${postActionsHtml(post)}</div>
      </div>
    </article>`;
}

function boardStateBlock(icon, title, text, buttonHtml) {
  return `
    <div class="col-span-full flex flex-col items-center text-center py-space-2xl">
      <span class="material-symbols-outlined text-[44px] text-outline-variant mb-space-xs">${icon}</span>
      <h3 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(title)}</h3>
      <p class="font-body-md text-body-md text-on-surface-variant mt-1 max-w-md">${escapeHtml(text)}</p>
      ${buttonHtml ? `<div class="mt-space-md">${buttonHtml}</div>` : ''}
    </div>`;
}

function boardEmptyHtml() {
  if (posts.length === 0) {
    return boardStateBlock('campaign', 'No opportunities yet', 'Be the first to post an open role for your team or project.',
      '<button type="button" data-action="new" class="btn-primary-modal">Post an Opportunity</button>');
  }
  return boardStateBlock('search_off', 'Nothing matches that', 'Try a different search, another category, or remove some filters.',
    '<button type="button" data-action="clear" class="btn-primary-modal">Clear search and filters</button>');
}

function renderBoardProblem(message) {
  el('board-grid').innerHTML = boardStateBlock('cloud_off', 'Could not load opportunities', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
  el('board-pagination-container').innerHTML = '';
  el('activeCallsCount').textContent = '';
}

function renderBoardSkeleton() {
  const card = `
    <div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/30">
      <div class="skeleton h-4 w-24 mb-space-md"></div>
      <div class="skeleton h-6 w-4/5 mb-space-sm"></div>
      <div class="skeleton h-3.5 w-1/2 mb-space-md"></div>
      <div class="skeleton h-3.5 w-full mb-2"></div>
      <div class="skeleton h-3.5 w-full mb-2"></div>
      <div class="skeleton h-3.5 w-2/3 mb-space-md"></div>
      <div class="skeleton h-9 w-full"></div>
    </div>`;
  el('board-grid').innerHTML = card.repeat(6);
}

function renderBoardPagination(total, start, shownCount, totalPages) {
  const container = el('board-pagination-container');
  if (total === 0) { container.innerHTML = ''; return; }

  const pageButton = (page) => page === boardView.page
    ? `<button class="w-9 h-9 rounded-lg flex items-center justify-center bg-primary text-on-primary font-semibold shadow-sm" type="button" aria-current="page">${page}</button>`
    : `<button class="w-9 h-9 rounded-lg flex items-center justify-center border border-outline-variant/60 text-on-surface hover:bg-surface-container-low transition-colors" type="button" data-page="${page}">${page}</button>`;
  let pages = '';
  for (let page = 1; page <= totalPages; page++) {
    if (page === 1 || page === totalPages || Math.abs(page - boardView.page) <= 1) pages += pageButton(page);
    else if (Math.abs(page - boardView.page) === 2) pages += '<span class="px-1 text-outline">...</span>';
  }
  const stepClass = 'w-9 h-9 rounded-lg flex items-center justify-center border border-outline-variant/60 text-outline hover:text-on-surface hover:bg-surface-container-low transition-colors disabled:opacity-50 disabled:pointer-events-none';

  container.innerHTML = `
    <div>
      Showing <span class="font-semibold text-on-surface">${start + 1} - ${start + shownCount}</span> of <span class="font-semibold text-on-surface">${total}</span> open ${total === 1 ? 'opportunity' : 'opportunities'}
    </div>
    <div class="flex items-center gap-1 ${totalPages === 1 ? 'hidden' : ''}">
      <button class="${stepClass}" type="button" aria-label="Previous page" data-page="${boardView.page - 1}" ${boardView.page === 1 ? 'disabled' : ''}>
        <span class="material-symbols-outlined text-[18px]">chevron_left</span>
      </button>
      ${pages}
      <button class="${stepClass}" type="button" aria-label="Next page" data-page="${boardView.page + 1}" ${boardView.page === totalPages ? 'disabled' : ''}>
        <span class="material-symbols-outlined text-[18px]">chevron_right</span>
      </button>
    </div>`;
}

function renderCategoryTabs() {
  const tokens = normText(boardView.q).split(/\s+/).filter(Boolean);
  const candidates = posts.filter(post => matchesSearchAndToggles(post, tokens));
  const tab = (value, label, count) => {
    const active = boardView.category === value;
    return `<button type="button" data-category="${escapeHtml(value)}" aria-pressed="${active}" class="px-space-md py-2 rounded-lg font-label-md text-label-md transition-all ${active ? 'bg-on-surface text-surface-container-lowest shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-low'}">
      ${label} <span class="ml-1 text-[11px] py-0.5 px-1.5 rounded-full font-bold ${active ? 'bg-white/20' : 'bg-surface-container text-on-surface-variant'}">${count}</span>
    </button>`;
  };
  el('categoryTabs').innerHTML = tab('', 'All Opportunities', candidates.length) +
    BOARD_CATEGORIES.map(category => tab(category, CATEGORY_LABELS[category], candidates.filter(post => post.category === category).length)).join('');
}

// The skills most posts ask for, with real counts
function renderQuickSkills() {
  const counts = new Map();
  for (const post of posts) {
    post.x.skills.forEach((skill, i) => {
      const entry = counts.get(post.x.skillKeys[i]) || { label: skill, count: 0 };
      entry.count++;
      counts.set(post.x.skillKeys[i], entry);
    });
  }
  const top = [...counts.entries()].sort((a, b) => (b[1].count - a[1].count) || a[1].label.localeCompare(b[1].label)).slice(0, QUICK_SKILL_COUNT);
  const current = normText(boardView.q);
  el('quickSkills').innerHTML = (top.length ? '<span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider pl-1 hidden lg:inline">Quick:</span>' : '') +
    top.map(([key, entry]) => {
      const active = key === current;
      return `<button type="button" data-skill="${escapeHtml(entry.label)}" aria-pressed="${active}" class="px-space-sm py-1.5 rounded-lg border font-skill-pill text-skill-pill transition-colors whitespace-nowrap ${active ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant/70 text-on-surface hover:bg-surface-container-low'}">
        ${escapeHtml(entry.label)} <span class="font-normal ${active ? 'text-white/80' : 'text-outline'}">${entry.count}</span>
      </button>`;
    }).join('');
}

function syncBoardControls() {
  const input = el('board-search-input');
  if (input.value.trim() !== boardView.q) input.value = boardView.q;
  el('boardSearchClear').classList.toggle('hidden', !boardView.q);
  el('boardSort').value = boardView.sort;
  BOARD_TOGGLES.forEach(key => {
    document.querySelector(`[data-toggle="${key}"]`).setAttribute('aria-pressed', String(boardView[key]));
  });
  el('boardClearFilters').classList.toggle('hidden', !boardHasFilters());
}

// ==========================================
// 5. CONTROLS
// ==========================================
function bindBoardControls() {
  const input = el('board-search-input');
  input.addEventListener('input', () => {
    clearTimeout(boardSearchTimer);
    boardSearchTimer = setTimeout(() => { boardView.q = input.value.trim(); boardViewChanged(); }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); setBoardSearch(input.value.trim()); }
    if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); setBoardSearch(''); }
  });
  el('boardSearchClear').addEventListener('click', () => { setBoardSearch(''); input.focus(); });
  el('boardClearFilters').addEventListener('click', clearBoardFilters);
  el('boardSort').addEventListener('change', (e) => { boardView.sort = e.target.value; boardViewChanged(); });
  BOARD_TOGGLES.forEach(key => {
    document.querySelector(`[data-toggle="${key}"]`).addEventListener('click', () => { boardView[key] = !boardView[key]; boardViewChanged(); });
  });

  el('categoryTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-category]');
    if (tab) { boardView.category = tab.dataset.category; boardViewChanged(); }
  });
  el('quickSkills').addEventListener('click', (e) => {
    const pill = e.target.closest('[data-skill]');
    if (pill) setBoardSearch(normText(boardView.q) === normText(pill.dataset.skill) ? '' : pill.dataset.skill);
  });

  el('board-grid').addEventListener('click', onBoardClick);
  el('detailBody').addEventListener('click', onBoardClick);
  el('applicantsList').addEventListener('click', (e) => {
    const button = e.target.closest('[data-team-user]');
    if (button) window.openAddToTeamModal(button.dataset.teamUser);
  });
  // A picture that fails to load is swapped for the person's initials
  document.addEventListener('error', (e) => {
    if (e.target.tagName !== 'IMG' || !e.target.dataset.initials) return;
    const initials = document.createElement('span');
    initials.className = 'text-primary font-bold text-[11px]';
    initials.textContent = e.target.dataset.initials;
    e.target.replaceWith(initials);
  }, true);

  el('board-pagination-container').addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    boardView.page = parseInt(button.dataset.page);
    boardViewChanged(true);
    el('boardTop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Forms and modals
  el('postOppForm').addEventListener('submit', submitPostForm);
  el('applyForm').addEventListener('submit', submitApplication);
  [['po-title', 'title'], ['po-skills', 'skills'], ['po-description', 'description'], ['apply-note', 'note']].forEach(([id, field]) => {
    el(id).maxLength = FIELD_LIMITS[field];
    el(id).addEventListener('input', () => updateCounter(id, field));
  });
  document.querySelectorAll('.board-overlay').forEach(overlay => {
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeBoardModal(overlay.id); });
  });
  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeBoardModal(button.closest('.board-overlay').id));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (el('systemModal').classList.contains('active')) return window.closeSystemModal();
      const open = [...document.querySelectorAll('.board-overlay.active')].pop();
      if (open) return closeBoardModal(open.id);
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); focusBoardSearch(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); focusBoardSearch(); }
  });
}

// Clicks on a post card, and on the same buttons inside the details window
function onBoardClick(e) {
  const skill = e.target.closest('[data-skill]');
  if (skill) { closeBoardModal('detailModal'); return setBoardSearch(skill.dataset.skill); }

  const button = e.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'retry') { renderBoardSkeleton(); return loadBoard(); }
  if (action === 'clear') return clearBoardFilters();
  if (action === 'new') return openPostForm();

  const holder = button.closest('[data-id]');
  const post = holder ? postsById.get(parseInt(holder.dataset.id)) : null;
  if (!post) return;
  if (action === 'details') openPostDetails(post.id);
  if (action === 'apply') openApplyForm(post.id);
  if (action === 'withdraw') confirmWithdraw(post.id);
  if (action === 'applicants') openApplicants(post.id);
  if (action === 'edit') openPostForm(post.id);
  if (action === 'delete') confirmDeletePost(post.id);
}

function setBoardSearch(text) {
  clearTimeout(boardSearchTimer);
  boardView.q = text;
  boardViewChanged();
}

function clearBoardFilters() {
  clearTimeout(boardSearchTimer);
  boardView.q = '';
  boardView.category = '';
  BOARD_TOGGLES.forEach(key => { boardView[key] = false; });
  boardViewChanged();
}

// The "Search network" box in the site header and Ctrl/⌘+K both land here
function focusBoardSearch() {
  const input = el('board-search-input');
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  input.focus({ preventScroll: true });
  input.select();
}

function openBoardModal(id) {
  el(id).classList.add('active');
}

function closeBoardModal(id) {
  el(id).classList.remove('active');
  if (id === 'detailModal') detailPostId = null;
  if (id === 'applicantsModal') applicantsPostId = null;
  if (id === 'applyModal') applyingPostId = null;
  if (id === 'postOppModal') editingPostId = null;
}

function updateCounter(id, field) {
  el(`${id}-count`).textContent = `${el(id).value.length}/${FIELD_LIMITS[field]}`;
}

function showBoardGuidelines() {
  const rules = [
    ['Say exactly who you need', 'Name the role, the skills and the time commitment. "Need a React dev for a 36-hour hackathon on 14 Dec" gets answers; "need help" does not.'],
    ['One post per opening', 'Edit your post when things change instead of posting it again, and delete it once the role is filled.'],
    ['Use Urgent sparingly', 'Urgent pins your post to the top. Keep it for real deadlines in the next few days.'],
    ['Answer the people who apply', 'Open Applicants, read their notes and message them, even if the answer is no.'],
    ['Credit and respect', 'Everyone who contributes is credited. No paid-work bait, spam or harassment; admins remove such posts.']
  ];
  window.showSystemModal('Teammate Post Guidelines', rules.map(([title, text]) =>
    `<span style="display:block;margin-bottom:10px;"><strong style="color:#0b1c30;">${escapeHtml(title)}.</strong> ${escapeHtml(text)}</span>`).join(''), 'alert', null, 'Got it');
}

// ==========================================
// 6. POSTING, EDITING AND DELETING
// ==========================================
function openPostForm(postId) {
  const post = postId ? postsById.get(postId) : null;
  editingPostId = post ? post.id : null;
  el('postOppForm').reset();
  if (post) {
    el('po-category').value = post.category;
    el('po-title').value = post.title;
    el('po-skills').value = post.skills_required;
    el('po-description').value = post.description;
    el('po-urgent').checked = post.is_urgent;
  }
  el('postModalTitle').textContent = post ? 'Edit Opportunity' : 'Post a New Opportunity';
  el('po-btn-text').textContent = post ? 'Save Changes' : 'Post Now';
  el('po-error').classList.add('hidden');
  [['po-title', 'title'], ['po-skills', 'skills'], ['po-description', 'description']].forEach(([id, field]) => updateCounter(id, field));
  closeBoardModal('detailModal');
  openBoardModal('postOppModal');
  editingPostId = post ? post.id : null;
  setTimeout(() => el('po-title').focus(), 50);
}

async function submitPostForm(e) {
  e.preventDefault();
  const body = {
    category: el('po-category').value,
    title: el('po-title').value.trim(),
    skills_required: el('po-skills').value.trim(),
    description: el('po-description').value.trim(),
    is_urgent: el('po-urgent').checked
  };
  const problem = el('po-error');
  if (!body.title || !body.skills_required || !body.description) {
    problem.textContent = 'Please fill in the title, the skills and the description.';
    return problem.classList.remove('hidden');
  }
  problem.classList.add('hidden');

  const button = el('po-submit');
  const editing = editingPostId;
  button.disabled = true;
  el('po-btn-text').textContent = editing ? 'Saving...' : 'Posting...';
  try {
    const result = editing
      ? await api(`/api/board/posts/${editing}`, { method: 'PATCH', body })
      : await api('/api/board/posts', { method: 'POST', body });
    upsertPost(result.post);
    closeBoardModal('postOppModal');
    if (!editing) {
      // Make sure the new post is actually on screen
      boardView.page = 1;
      if (!filteredPosts().some(post => post.id === result.post.id)) clearBoardFilters();
    }
    renderBoard();
    saveBoard();
    showToast(editing ? 'Post updated.' : 'Your opportunity is live on the board.');
  } catch (err) {
    problem.textContent = err.message;
    problem.classList.remove('hidden');
  }
  button.disabled = false;
  el('po-btn-text').textContent = editingPostId ? 'Save Changes' : 'Post Now';
}

// Add a post, or replace the copy we have. Whether we applied is only known from our own requests.
function upsertPost(card) {
  const existing = postsById.get(card.id);
  if (existing) {
    const hasApplied = 'has_applied' in card ? card.has_applied : existing.has_applied;
    Object.assign(existing, card, { has_applied: hasApplied });
    indexPost(existing);
    return existing;
  }
  const post = indexPost(Object.assign({ has_applied: false, applicant_count: 0 }, card));
  posts.unshift(post);
  postsById.set(post.id, post);
  return post;
}

function removePost(postId) {
  if (!postsById.delete(postId)) return false;
  posts = posts.filter(post => post.id !== postId);
  if (detailPostId === postId) closeBoardModal('detailModal');
  if (applicantsPostId === postId) closeBoardModal('applicantsModal');
  if (applyingPostId === postId) closeBoardModal('applyModal');
  return true;
}

function confirmDeletePost(postId) {
  const post = postsById.get(postId);
  if (!post) return;
  window.showSystemModal('Delete this post?', `"${escapeHtml(post.title)}" will be removed from the board, along with its ${post.applicant_count} application${post.applicant_count === 1 ? '' : 's'}. This cannot be undone.`, 'confirm', async () => {
    if (pendingPosts.has(postId)) return;
    pendingPosts.add(postId);
    refreshPost(postId);
    try {
      await api(`/api/board/posts/${postId}`, { method: 'DELETE' });
      pendingPosts.delete(postId);
      removePost(postId);
      renderBoard();
      saveBoard();
      showToast('Post deleted.');
    } catch (err) {
      pendingPosts.delete(postId);
      // Someone else already removed it: nothing left to delete
      if (err.status === 404) { removePost(postId); renderBoard(); saveBoard(); }
      else refreshPost(postId);
      showToast(err.message);
    }
  }, 'Delete');
}

// ==========================================
// 7. DETAILS, APPLYING AND APPLICANTS
// ==========================================
function refreshPost(postId) {
  const post = postsById.get(postId);
  const card = el('board-grid').querySelector(`[data-id="${postId}"]`);
  if (post && card) card.outerHTML = postCardHtml(post);
  if (detailPostId === postId) renderPostDetails();
}

function openPostDetails(postId) {
  detailPostId = postId;
  renderPostDetails();
  openBoardModal('detailModal');
}

function renderPostDetails() {
  const post = postsById.get(detailPostId);
  if (!post) return closeBoardModal('detailModal');
  el('detailBody').dataset.id = post.id;
  el('detailBody').innerHTML = `
    <div class="flex items-center flex-wrap gap-1.5 mb-space-sm">${postBadgesHtml(post)}</div>
    <h3 class="font-headline-lg text-headline-lg text-on-surface mb-space-sm" style="overflow-wrap:anywhere;">${escapeHtml(post.title)}</h3>
    <div class="flex items-center gap-2 mb-space-md text-on-surface-variant font-body-sm text-body-sm min-w-0">${authorLineHtml(post)}</div>
    <p class="font-body-md text-body-md text-on-surface mb-space-md" style="white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(post.description || 'No description provided.')}</p>
    <div class="font-label-sm text-label-sm uppercase tracking-wider text-outline mb-1.5">Skills needed</div>
    <div class="flex items-center gap-1.5 flex-wrap mb-space-md">${skillPillsHtml(post, 50)}</div>
    <div class="pt-space-sm border-t border-outline-variant/30 flex items-center justify-between gap-2 flex-wrap">
      <div class="font-body-sm text-body-sm text-on-surface-variant">Posted ${timeAgo(post.created_at)} · ${post.applicant_count} ${post.applicant_count === 1 ? 'person has' : 'people have'} applied</div>
      <div class="flex items-center gap-1">${postActionsHtml(post)}</div>
    </div>`;
}

function openApplyForm(postId) {
  const post = postsById.get(postId);
  if (!post) return;
  el('applyForm').reset();
  updateCounter('apply-note', 'note');
  el('applyPostTitle').textContent = post.title;
  el('applyAuthorName').textContent = post.author_name;
  openBoardModal('applyModal');
  applyingPostId = postId;
  setTimeout(() => el('apply-note').focus(), 50);
}

function submitApplication(e) {
  e.preventDefault();
  const postId = applyingPostId;
  const note = el('apply-note').value.trim();
  closeBoardModal('applyModal');
  changeApplication(postId, true, note);
}

function confirmWithdraw(postId) {
  const post = postsById.get(postId);
  if (!post) return;
  window.showSystemModal('Withdraw application?', `${escapeHtml(post.author_name)} will no longer see you among the applicants for "${escapeHtml(post.title)}".`, 'confirm',
    () => changeApplication(postId, false), 'Withdraw');
}

// The card changes at once; the server's answer then confirms it or puts it back
async function changeApplication(postId, applying, note) {
  const post = postsById.get(postId);
  if (!post || pendingPosts.has(postId) || post.has_applied === applying) return;
  pendingPosts.add(postId);
  const countBefore = post.applicant_count;
  post.has_applied = applying;
  post.applicant_count = Math.max(0, countBefore + (applying ? 1 : -1));
  refreshPost(postId);
  try {
    await api(`/api/board/posts/${postId}/apply`, applying ? { method: 'POST', body: { note: note || '' } } : { method: 'DELETE' });
    showToast(applying ? `Applied. ${post.author_name} has been notified.` : 'Application withdrawn.');
  } catch (err) {
    post.has_applied = !applying;
    post.applicant_count = countBefore;
    showToast(err.message);
    if (err.status === 404) removePost(postId);
  }
  pendingPosts.delete(postId);
  saveBoard();
  if (boardView.applied || boardView.sort === 'applicants' || !postsById.has(postId)) renderBoard();
  else refreshPost(postId);
}

async function openApplicants(postId) {
  const post = postsById.get(postId);
  if (!post) return;
  closeBoardModal('detailModal');
  el('applicantsPostTitle').textContent = post.title;
  el('applicantsList').innerHTML = '<p class="text-center text-on-surface-variant py-6" style="margin:0;">Loading...</p>';
  openBoardModal('applicantsModal');
  applicantsPostId = postId;
  await loadApplicants(postId);
}

async function loadApplicants(postId) {
  let people;
  try {
    people = await api(`/api/board/posts/${postId}/applicants`);
  } catch (err) {
    if (applicantsPostId === postId) el('applicantsList').innerHTML = `<p class="text-center text-error py-6" style="margin:0;">${escapeHtml(err.message)}</p>`;
    return;
  }
  if (applicantsPostId !== postId) return;
  const post = postsById.get(postId);
  if (post && post.applicant_count !== people.length) { post.applicant_count = people.length; refreshPost(postId); saveBoard(); }

  if (people.length === 0) {
    el('applicantsList').innerHTML = '<p class="text-center text-on-surface-variant py-6" style="margin:0;">No one has applied yet. Applications show up here as they come in.</p>';
    return;
  }
  el('applicantsList').innerHTML = people.map(person => `
    <div class="flex items-start gap-3 py-3 border-b border-outline-variant/30 last:border-b-0">
      ${smallAvatarHtml(person.profile_pic, person.name, 'w-10 h-10')}
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <a href="profile.html?id=${person.id}" class="font-headline-sm text-headline-sm text-on-surface hover:text-primary transition-colors truncate">${escapeHtml(person.name)}</a>
          <span class="font-body-sm text-body-sm text-outline shrink-0">${timeAgo(person.applied_at)}</span>
        </div>
        <div class="font-body-sm text-body-sm text-on-surface-variant truncate">${escapeHtml([person.college_name, person.department].filter(Boolean).join(' · ') || 'No college listed')}</div>
        ${person.skills ? `<div class="font-body-sm text-body-sm text-outline truncate">${escapeHtml(person.skills)}</div>` : ''}
        ${person.note ? `<p class="font-body-md text-body-md text-on-surface bg-surface-container-low rounded-lg px-3 py-2 mt-2" style="margin-bottom:0;white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(person.note)}</p>` : ''}
        <div class="flex items-center gap-2 mt-2">
          <a href="profile.html?id=${person.id}" class="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors">View Profile</a>
          <a href="inbox.html?user=${person.id}" class="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md transition-colors">Message</a>
          <button type="button" data-team-user="${person.id}" class="px-3 py-1.5 rounded-lg border border-outline-variant/60 text-on-surface-variant hover:text-primary font-label-md text-label-md transition-colors">Add to team</button>
        </div>
      </div>
    </div>`).join('');
}

// ==========================================
// 8. LIVE UPDATES
// ==========================================
function handleBoardEvent(data) {
  switch (data.type) {
    case 'board_post_added':
    case 'board_post_updated':
      if (!data.post) return;
      // A post we do not have is only added when it is announced as new
      if (data.type === 'board_post_updated' && !postsById.has(data.post.id)) return;
      upsertPost(data.post);
      return queueBoardRender();
    case 'board_post_removed':
      if (removePost(data.post_id)) queueBoardRender();
      return;
    case 'board_applicants_changed': {
      const post = postsById.get(data.post_id);
      if (!post) return;
      // While our own request is in flight the number on screen already includes it
      if (!pendingPosts.has(post.id)) post.applicant_count = data.count;
      if (applicantsPostId === post.id) loadApplicants(post.id);
      return queueBoardRender();
    }
  }
}

initBoard();
