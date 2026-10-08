// ==========================================
// SAVED.JS — The Saved Profiles page: our private shortlist, with search, filters, bulk actions and undo
// Loaded after shared.js and chat-common.js (api, caches, toast, el, onlineUserIds, the people-card helpers).
// ==========================================

const SAVED_PER_PAGE = 9;
const SAVED_REFRESH_MS = 60000;
const UNDO_MS = 7000;

let savedPeople = [];             // most recently saved first, as returned by /api/saved
let savedById = new Map();
let savedLoaded = false;
let savedLoading = false;
let savedLoadedAt = 0;
let savedSkills = new Set();

const savedView = { q: '', college: '', department: '', sort: 'recent', page: 1 };
const savedSelected = new Set();  // ids ticked for a bulk action
const savedPending = new Set();
let savedSearchTimer = null;
let savedRenderQueued = false;
let undoTimer = null;

// ==========================================
// 1. LOADING
// ==========================================
function initSaved() {
  readSavedUrl();
  savedSkills = ownSkillSet();
  bindSavedControls();
  syncSavedControls();

  // 1. The copy saved on the last visit, so the page is never blank
  const cached = cacheGet('saved');
  if (cached && Array.isArray(cached.people)) setSaved(cached.people, []);
  else el('savedGrid').innerHTML = peopleSkeletonHtml(3);

  // 2. The real thing (already requested from the page head)
  loadSaved();
  connectNotifications((data) => { if (savedLoaded) handleSavedEvent(data); }, loadSaved);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - savedLoadedAt > SAVED_REFRESH_MS) loadSaved();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadSaved(); });
}

async function loadSaved() {
  if (savedLoading) return;
  savedLoading = true;
  try {
    const data = await fetchPageData('/api/saved');
    savedLoadedAt = Date.now();
    setSaved(data.people || [], data.online_user_ids || []);
    storeSaved();
  } catch (err) {
    if (!savedLoaded) renderSavedProblem(err.message);
  } finally {
    savedLoading = false;
  }
}

function setSaved(people, onlineIds) {
  savedPeople = people.map(indexPerson);
  savedById = new Map(savedPeople.map(person => [person.id, person]));
  onlineUserIds = new Set(onlineIds);
  savedSkills = ownSkillSet();
  // Ticks only survive for people who are still in the list
  [...savedSelected].forEach(id => { if (!savedById.has(id)) savedSelected.delete(id); });
  savedLoaded = true;
  renderSavedFacets();
  renderSaved();
}

function storeSaved() {
  cacheSet('saved', { people: savedPeople.map(plainPerson) });
}

// ==========================================
// 2. ADDRESS BAR
// ==========================================
function readSavedUrl() {
  const params = new URLSearchParams(window.location.search);
  savedView.q = (params.get('q') || '').trim();
  savedView.college = norm(params.get('college'));
  savedView.department = norm(params.get('department'));
  savedView.sort = ['recent', 'name', 'followers'].includes(params.get('sort')) ? params.get('sort') : 'recent';
  savedView.page = Math.max(1, parseInt(params.get('page')) || 1);
}

function writeSavedUrl() {
  const params = new URLSearchParams();
  if (savedView.q) params.set('q', savedView.q);
  if (savedView.college) params.set('college', savedView.college);
  if (savedView.department) params.set('department', savedView.department);
  if (savedView.sort !== 'recent') params.set('sort', savedView.sort);
  if (savedView.page > 1) params.set('page', savedView.page);
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

// ==========================================
// 3. FILTERING AND RENDERING
// ==========================================
function filteredSaved() {
  const tokens = norm(savedView.q).split(/\s+/).filter(Boolean);
  const list = savedPeople.filter(person => {
    if (savedView.college && person.x.college !== savedView.college) return false;
    if (savedView.department && person.x.department !== savedView.department) return false;
    return tokens.every(token => person.x.text.includes(token));
  });
  // savedPeople is already in "recently saved" order
  if (savedView.sort === 'name') list.sort((a, b) => a.x.name.localeCompare(b.x.name));
  else if (savedView.sort === 'followers') list.sort((a, b) => (b.followers_count - a.followers_count) || a.x.name.localeCompare(b.x.name));
  return list;
}

function savedHasFilters() {
  return Boolean(savedView.q || savedView.college || savedView.department);
}

function queueSavedRender() {
  if (savedRenderQueued) return;
  savedRenderQueued = true;
  requestAnimationFrame(() => { savedRenderQueued = false; renderSavedFacets(); renderSaved(); storeSaved(); });
}

function savedViewChanged(keepPage) {
  if (!keepPage) savedView.page = 1;
  writeSavedUrl();
  syncSavedControls();
  if (savedLoaded) renderSaved();
}

function savedCardHtml(person) {
  return personCardHtml(person, {
    mySkills: savedSkills,
    pending: savedPending,
    selected: savedSelected.has(person.id),
    note: person.saved_at ? `saved ${escapeHtml(timeAgo(person.saved_at))}` : ''
  });
}

function renderSaved() {
  const people = filteredSaved();
  const totalPages = Math.max(1, Math.ceil(people.length / SAVED_PER_PAGE));
  if (savedView.page > totalPages) { savedView.page = totalPages; writeSavedUrl(); }
  const start = (savedView.page - 1) * SAVED_PER_PAGE;
  const visible = people.slice(start, start + SAVED_PER_PAGE);

  el('savedGrid').innerHTML = visible.length ? visible.map(savedCardHtml).join('') : savedEmptyHtml();
  el('savedCount').textContent = people.length === savedPeople.length
    ? `${savedPeople.length} saved`
    : `${people.length} of ${savedPeople.length} match`;
  el('savedPagination').innerHTML = peoplePaginationHtml(savedView.page, people.length, start, visible.length, totalPages, ['saved profile', 'saved profiles']);
  renderSavedSelection(people);
}

// The select-all box covers everyone the current search and filters match, on every page
function renderSavedSelection(people) {
  const matching = people || filteredSaved();
  const ticked = matching.filter(person => savedSelected.has(person.id)).length;
  const box = el('savedSelectAll');
  box.checked = matching.length > 0 && ticked === matching.length;
  box.indeterminate = ticked > 0 && ticked < matching.length;
  box.disabled = matching.length === 0;
  el('savedSelectedText').textContent = savedSelected.size ? `${savedSelected.size} selected` : 'Select all';
  el('savedBulkBar').classList.toggle('hidden', savedSelected.size === 0);
  el('savedBulkBar').classList.toggle('flex', savedSelected.size > 0);
}

function savedEmptyHtml() {
  if (savedPeople.length === 0) {
    return peopleStateBlock('bookmark_add', 'Nothing saved yet', 'Use the bookmark on anyone\'s card to keep them here for later.',
      '<a href="search.html" class="btn-primary-modal" style="display:inline-block;text-decoration:none;">Discover talent</a>');
  }
  return peopleStateBlock('search_off', 'No saved profile matches that', 'Try a different name or skill, or remove some filters.',
    '<button type="button" data-action="clear" class="btn-primary-modal">Clear search and filters</button>');
}

function renderSavedProblem(message) {
  el('savedGrid').innerHTML = peopleStateBlock('cloud_off', 'Could not load your saved profiles', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
  el('savedPagination').innerHTML = '';
  el('savedCount').textContent = '';
}

// College and department choices come from the people who are actually saved
function renderSavedFacets() {
  const facets = [['college', 'savedCollege', 'All colleges', 'college_name'], ['department', 'savedDepartment', 'All departments', 'department']];
  for (const [key, id, allLabel, field] of facets) {
    const counts = new Map();
    for (const person of savedPeople) {
      if (!person.x[key]) continue;
      const entry = counts.get(person.x[key]) || { label: String(person[field]).trim(), count: 0 };
      entry.count++;
      counts.set(person.x[key], entry);
    }
    if (savedView[key] && !counts.has(savedView[key])) counts.set(savedView[key], { label: savedView[key], count: 0 });
    const options = [...counts.entries()].sort((a, b) => (b[1].count - a[1].count) || a[1].label.localeCompare(b[1].label));
    el(id).innerHTML = `<option value="">${allLabel}</option>` + options.map(([value, entry]) =>
      `<option value="${escapeHtml(value)}">${escapeHtml(entry.label)} (${entry.count})</option>`).join('');
    el(id).value = savedView[key];
  }
}

function syncSavedControls() {
  const input = el('savedSearch');
  if (input.value.trim() !== savedView.q) input.value = savedView.q;
  el('savedSearchClear').classList.toggle('hidden', !savedView.q);
  ['college', 'department'].forEach(key => {
    const select = document.querySelector(`[data-filter="${key}"]`);
    select.value = savedView[key];
    select.classList.toggle('is-set', Boolean(savedView[key]));
  });
  el('savedSort').value = savedView.sort;
  el('savedClear').classList.toggle('hidden', !savedHasFilters());
}

// ==========================================
// 4. CONTROLS
// ==========================================
function bindSavedControls() {
  const input = el('savedSearch');
  input.addEventListener('input', () => {
    clearTimeout(savedSearchTimer);
    savedSearchTimer = setTimeout(() => { savedView.q = input.value.trim(); savedViewChanged(); }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); setSavedSearch(''); }
  });
  el('savedSearchClear').addEventListener('click', () => { setSavedSearch(''); input.focus(); });
  el('savedClear').addEventListener('click', clearSavedFilters);
  ['college', 'department'].forEach(key => {
    document.querySelector(`[data-filter="${key}"]`).addEventListener('change', (e) => { savedView[key] = e.target.value; savedViewChanged(); });
  });
  el('savedSort').addEventListener('change', (e) => { savedView.sort = e.target.value; savedViewChanged(); });

  el('savedSelectAll').addEventListener('change', (e) => {
    filteredSaved().forEach(person => { if (e.target.checked) savedSelected.add(person.id); else savedSelected.delete(person.id); });
    renderSaved();
  });
  el('savedBulkRemove').addEventListener('click', removeSelected);
  el('savedBulkTeam').addEventListener('click', addSelectedToTeam);

  const grid = el('savedGrid');
  grid.addEventListener('click', onSavedGridClick);
  grid.addEventListener('change', (e) => {
    if (!e.target.matches('[data-select]')) return;
    const id = parseInt(e.target.closest('[data-id]').dataset.id);
    if (e.target.checked) savedSelected.add(id); else savedSelected.delete(id);
    refreshSavedCard(id);
    renderSavedSelection();
  });
  bindAvatarFallback(grid);

  el('savedPagination').addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    savedView.page = parseInt(button.dataset.page);
    savedViewChanged(true);
    el('savedTop').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function onSavedGridClick(e) {
  const skill = e.target.closest('[data-skill]');
  if (skill) return setSavedSearch(skill.dataset.skill);

  const button = e.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'retry') { el('savedGrid').innerHTML = peopleSkeletonHtml(3); return loadSaved(); }
  if (action === 'clear') return clearSavedFilters();

  const card = button.closest('[data-id]');
  const personId = card ? parseInt(card.dataset.id) : 0;
  if (action === 'save') unsavePerson(personId);
  if (action === 'follow') toggleSavedFollow(personId);
  if (action === 'team') window.openAddToTeamModal(personId);
}

function setSavedSearch(text) {
  clearTimeout(savedSearchTimer);
  savedView.q = text;
  savedViewChanged();
}

function clearSavedFilters() {
  clearTimeout(savedSearchTimer);
  savedView.q = '';
  savedView.college = '';
  savedView.department = '';
  savedViewChanged();
}

function refreshSavedCard(personId) {
  const person = savedById.get(personId);
  const card = el('savedGrid').querySelector(`[data-id="${personId}"]`);
  if (person && card) card.outerHTML = savedCardHtml(person);
}

async function toggleSavedFollow(personId) {
  const person = savedById.get(personId);
  if (!person) return;
  const done = await togglePersonRelation('follow', person, savedPending, () => refreshSavedCard(personId));
  if (done) { storeSaved(); if (savedView.sort === 'followers') renderSaved(); }
}

// ==========================================
// 5. REMOVING, WITH UNDO
// ==========================================
function dropFromSaved(ids) {
  const gone = new Set(ids);
  savedPeople = savedPeople.filter(person => !gone.has(person.id));
  ids.forEach(id => { savedById.delete(id); savedSelected.delete(id); });
  renderSavedFacets();
  renderSaved();
  storeSaved();
}

// Puts people back where they were in the list
function restoreToSaved(entries) {
  entries.sort((a, b) => a.index - b.index).forEach(({ person, index }) => {
    if (savedById.has(person.id)) return;
    savedPeople.splice(Math.min(index, savedPeople.length), 0, person);
    savedById.set(person.id, person);
  });
  renderSavedFacets();
  renderSaved();
  storeSaved();
}

function showUndoToast(message, onUndo) {
  clearTimeout(undoTimer);
  document.querySelectorAll('.undo-toast, .chat-toast').forEach(toast => toast.remove());
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Undo';
  button.addEventListener('click', () => { toast.remove(); onUndo(); });
  toast.append(text, button);
  document.body.appendChild(toast);
  undoTimer = setTimeout(() => toast.remove(), UNDO_MS);
}

// The card leaves at once; the server's answer confirms it or brings it back
async function unsavePerson(personId) {
  const person = savedById.get(personId);
  const key = `save:${personId}`;
  if (!person || savedPending.has(key)) return;
  savedPending.add(key);
  const entry = { person, index: savedPeople.indexOf(person) };
  dropFromSaved([personId]);
  try {
    await api('/api/saved/remove', { method: 'POST', body: { ids: [personId] } });
    showUndoToast(`Removed ${person.name} from Saved Profiles.`, () => undoRemoval([entry]));
  } catch (err) {
    restoreToSaved([entry]);
    showToast(err.message);
  }
  savedPending.delete(key);
}

async function undoRemoval(entries) {
  restoreToSaved(entries.slice());
  const failed = [];
  for (const entry of entries) {
    try {
      const result = await api(`/api/save/${entry.person.id}`, { method: 'POST' });
      // The endpoint is a toggle: if it answers "unsaved" the profile had been saved again elsewhere, so save it back
      if (result.status !== 'saved') await api(`/api/save/${entry.person.id}`, { method: 'POST' });
      entry.person.saved_at = new Date().toISOString();
    } catch (err) {
      failed.push(entry.person.id);
    }
  }
  if (failed.length) {
    dropFromSaved(failed);
    showToast(`Could not restore ${failed.length === 1 ? 'that profile' : `${failed.length} profiles`}. Please save again from the profile.`);
  } else {
    renderSaved();
    storeSaved();
    showToast(entries.length === 1 ? 'Restored.' : `Restored ${entries.length} profiles.`);
  }
}

function removeSelected() {
  const ids = [...savedSelected];
  if (!ids.length) return;
  window.showSystemModal('Remove saved profiles', `Remove ${ids.length} ${ids.length === 1 ? 'profile' : 'profiles'} from your saved list?`, 'confirm', async () => {
    const entries = ids.map(id => ({ person: savedById.get(id), index: savedPeople.indexOf(savedById.get(id)) })).filter(entry => entry.person);
    dropFromSaved(ids);
    try {
      await api('/api/saved/remove', { method: 'POST', body: { ids } });
      showUndoToast(`Removed ${entries.length} ${entries.length === 1 ? 'profile' : 'profiles'}.`, () => undoRemoval(entries));
    } catch (err) {
      restoreToSaved(entries);
      showToast(err.message);
    }
  }, 'Remove');
}

// ==========================================
// 6. ADDING SEVERAL PEOPLE TO A TEAM
// ==========================================
async function addSelectedToTeam() {
  const ids = [...savedSelected];
  if (!ids.length) return;
  let teams;
  try {
    teams = await api('/api/teams');
  } catch (err) {
    return showToast(err.message);
  }
  if (!teams.length) {
    return window.showSystemModal('Add to a team', 'You do not have a team yet. Create one on the My Teams page first.', 'alert');
  }
  const form = `
    <span class="block text-left">
      <label class="block text-sm font-medium text-on-surface-variant mb-1" for="bulkTeamSelect">Add ${ids.length} ${ids.length === 1 ? 'person' : 'people'} to</label>
      <select id="bulkTeamSelect" class="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
        ${teams.map(team => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('')}
      </select>
    </span>`;
  window.showSystemModal('Add to a team', form, 'confirm', async () => {
    const teamId = el('bulkTeamSelect').value;
    let added = 0;
    const problems = [];
    for (const id of ids) {
      try {
        await api(`/api/teams/${teamId}/members`, { method: 'POST', body: { user_id: id, role: 'Member' } });
        added++;
      } catch (err) {
        const person = savedById.get(id);
        problems.push(`${person ? person.name : 'Someone'}: ${err.message}`);
      }
    }
    if (problems.length === 0) return showToast(`Added ${added} ${added === 1 ? 'person' : 'people'} to the team.`);
    window.showSystemModal(added ? `Added ${added} of ${ids.length}` : 'Nobody was added',
      problems.map(line => `<span style="display:block;">${escapeHtml(line)}</span>`).join(''), 'alert');
  }, 'Add');
}

// ==========================================
// 7. LIVE UPDATES
// ==========================================
function handleSavedEvent(data) {
  const result = applyPeopleEvent(data, savedById, savedPending);
  if (result === 'presence') {
    const dot = el('savedGrid').querySelector(`[data-id="${data.user_id}"] [data-online-dot]`);
    if (dot) dot.classList.toggle('hidden', !data.online);
  } else if (result === 'changed') {
    queueSavedRender();
  }
}

initSaved();
