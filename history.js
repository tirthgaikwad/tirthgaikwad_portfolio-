// ==========================================
// HISTORY.JS — The Activity History page: our own timeline, with categories, search, date ranges and export
// Loaded after shared.js and chat-common.js (api, caches, toast, el).
// ==========================================

const HISTORY_PAGE_SIZE = 100;
const HISTORY_CATEGORY_ORDER = ['Network', 'Messages', 'Teams', 'Board', 'Profile', 'Account', 'Other'];
const HISTORY_ICONS = {
  Network: ['group', 'bg-secondary-container text-on-secondary-fixed'],
  Messages: ['chat_bubble', 'bg-primary-fixed text-on-primary-fixed'],
  Teams: ['corporate_fare', 'bg-surface-container-high text-primary'],
  Board: ['campaign', 'bg-tertiary-fixed text-on-tertiary-fixed'],
  Profile: ['person', 'bg-surface-container text-primary'],
  Account: ['shield_person', 'bg-surface-container-low text-on-surface-variant'],
  Other: ['history', 'bg-surface-container-low text-on-surface-variant']
};
const HISTORY_RANGES = { today: 1, week: 7, month: 30 };

let historyItems = [];            // newest first; older pages are appended by "Load older"
let historyCounts = {};           // entries per category across the whole log, not only what is loaded
let historyTotal = 0;
let historyHasMore = false;
let historyLoaded = false;
let historyLoading = false;

const historyView = { q: '', category: '', range: 'all' };
let historySearchTimer = null;

// ==========================================
// 1. LOADING
// ==========================================
function initHistory() {
  readHistoryUrl();
  bindHistoryControls();
  syncHistoryControls();

  // 1. The copy saved on the last visit, so the page is never blank
  const cached = cacheGet('history');
  if (cached && Array.isArray(cached.items)) setHistory(cached);
  else renderHistorySkeleton();

  // 2. The real thing (already requested from the page head)
  loadHistory();
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadHistory(); });
}

async function loadHistory() {
  if (historyLoading) return;
  historyLoading = true;
  try {
    const data = await fetchPageData('/api/history');
    setHistory(data);
    cacheSet('history', data);
  } catch (err) {
    if (!historyLoaded) renderHistoryProblem(err.message);
  } finally {
    historyLoading = false;
  }
}

function setHistory(data) {
  historyItems = data.items || [];
  historyCounts = data.counts || {};
  historyTotal = data.total || 0;
  historyHasMore = Boolean(data.has_more);
  historyLoaded = true;
  renderHistory();
}

async function loadOlderHistory() {
  if (historyLoading || !historyHasMore || !historyItems.length) return;
  historyLoading = true;
  const button = el('historyMore');
  button.disabled = true;
  try {
    const oldest = historyItems[historyItems.length - 1].id;
    const data = await api(`/api/history?before=${oldest}&limit=${HISTORY_PAGE_SIZE}`);
    historyItems = historyItems.concat(data.items || []);
    historyCounts = data.counts || historyCounts;
    historyTotal = data.total || historyTotal;
    historyHasMore = Boolean(data.has_more);
    renderHistory();
  } catch (err) {
    showToast(err.message);
  } finally {
    historyLoading = false;
    button.disabled = false;
  }
}

// ==========================================
// 2. ADDRESS BAR
// ==========================================
function readHistoryUrl() {
  const params = new URLSearchParams(window.location.search);
  historyView.q = (params.get('q') || '').trim();
  historyView.category = HISTORY_CATEGORY_ORDER.includes(params.get('category')) ? params.get('category') : '';
  historyView.range = HISTORY_RANGES[params.get('range')] ? params.get('range') : 'all';
}

function writeHistoryUrl() {
  const params = new URLSearchParams();
  if (historyView.q) params.set('q', historyView.q);
  if (historyView.category) params.set('category', historyView.category);
  if (historyView.range !== 'all') params.set('range', historyView.range);
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

// ==========================================
// 3. FILTERING AND RENDERING
// ==========================================
function rangeStart() {
  const days = HISTORY_RANGES[historyView.range];
  if (!days) return 0;
  if (historyView.range === 'today') return new Date().setHours(0, 0, 0, 0);
  return Date.now() - days * 86400000;
}

function filteredHistory() {
  const tokens = historyView.q.toLowerCase().split(/\s+/).filter(Boolean);
  const from = rangeStart();
  return historyItems.filter(item => {
    if (historyView.category && item.category !== historyView.category) return false;
    if (from && !(Date.parse(item.time) >= from)) return false;
    const text = `${item.action} ${item.detail}`.toLowerCase();
    return tokens.every(token => text.includes(token));
  });
}

function historyHasFilters() {
  return Boolean(historyView.q || historyView.category || historyView.range !== 'all');
}

function historyViewChanged() {
  writeHistoryUrl();
  syncHistoryControls();
  if (historyLoaded) renderHistory();
}

function dayLabel(time) {
  const then = new Date(time);
  if (isNaN(then)) return 'Earlier';
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  if (then >= startOfToday) return 'Today';
  if (then >= startOfToday - 86400000) return 'Yesterday';
  return then.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function historyItemHtml(item) {
  const [icon, colors] = HISTORY_ICONS[item.category] || HISTORY_ICONS.Other;
  const then = new Date(item.time);
  const clock = isNaN(then) ? '' : then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="flex items-start gap-space-md p-space-sm rounded-xl hover:bg-surface-container-low/70 transition-colors">
      <div class="w-10 h-10 rounded-xl ${colors} flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-[20px]">${icon}</span>
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-headline-sm text-headline-sm text-on-surface">${escapeHtml(item.action)}</h3>
          <span class="px-2 py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm text-on-surface-variant">${escapeHtml(item.category)}</span>
        </div>
        <p class="font-body-md text-body-md text-on-surface-variant break-words">${escapeHtml(item.detail)}</p>
      </div>
      <span class="font-body-sm text-body-sm text-outline shrink-0 mt-1" title="${escapeHtml(isNaN(then) ? '' : then.toLocaleString())}">${escapeHtml(clock)}</span>
    </div>`;
}

function renderHistory() {
  renderHistoryStats();
  renderHistoryChips();

  const items = filteredHistory();
  let html = '';
  let lastDay = null;
  for (const item of items) {
    const day = dayLabel(item.time);
    if (day !== lastDay) {
      html += `<h2 class="font-label-sm text-label-sm uppercase tracking-wider text-outline ${lastDay === null ? '' : 'mt-space-md'} mb-1 px-space-sm">${escapeHtml(day)}</h2>`;
      lastDay = day;
    }
    html += historyItemHtml(item);
  }
  el('historyFeed').innerHTML = html || historyEmptyHtml();

  const loaded = historyItems.length;
  const scope = historyHasMore ? `the ${loaded} most recent of ${historyTotal} entries` : `${loaded} ${loaded === 1 ? 'entry' : 'entries'}`;
  el('historyCount').textContent = historyHasFilters()
    ? `${items.length} ${items.length === 1 ? 'match' : 'matches'} in ${scope}`
    : (loaded ? `Showing ${scope}` : '');
  el('historyMoreWrap').classList.toggle('hidden', !historyHasMore);
  el('historyExport').disabled = items.length === 0;
  el('historyClearAll').disabled = historyTotal === 0;
}

function renderHistoryStats() {
  const count = (name) => historyCounts[name] || 0;
  const weekAgo = Date.now() - 7 * 86400000;
  const thisWeek = historyItems.filter(item => Date.parse(item.time) >= weekAgo).length;
  el('hTotal').textContent = historyTotal;
  el('hNetwork').textContent = count('Network');
  el('hWork').textContent = count('Teams') + count('Board');
  // Only as many entries as are loaded can be counted here; "+" says there may be more
  const oldestLoaded = historyItems.length ? Date.parse(historyItems[historyItems.length - 1].time) : 0;
  el('hWeek').textContent = thisWeek + (historyHasMore && oldestLoaded >= weekAgo ? '+' : '');
}

function renderHistoryChips() {
  const chip = (value, label, count) =>
    `<button type="button" class="history-chip" data-category="${value}" aria-pressed="${historyView.category === value}">${label} <span>${count}</span></button>`;
  el('historyChips').innerHTML = chip('', 'All activity', historyTotal) +
    HISTORY_CATEGORY_ORDER.filter(name => historyCounts[name] || historyView.category === name)
      .map(name => chip(name, name, historyCounts[name] || 0)).join('');
}

function historyEmptyHtml() {
  if (historyTotal === 0) {
    return peopleStateBlock('history', 'No activity yet', 'Follow someone, save a profile or post an opportunity and it will be listed here.', '');
  }
  const more = historyHasMore ? ' Older entries are not loaded yet; "Load older activity" searches further back.' : '';
  return peopleStateBlock('search_off', 'Nothing matches that', `Try a different word, category or time range.${more}`,
    '<button type="button" data-action="clear" class="btn-primary-modal">Clear filters</button>');
}

function renderHistoryProblem(message) {
  el('historyFeed').innerHTML = peopleStateBlock('cloud_off', 'Could not load your activity', message,
    '<button type="button" data-action="retry" class="btn-primary-modal">Try again</button>');
  el('historyCount').textContent = '';
}

function renderHistorySkeleton() {
  const row = `
    <div class="flex items-start gap-space-md p-space-sm">
      <div class="skeleton w-10 h-10 shrink-0" style="border-radius:12px;"></div>
      <div class="flex-1"><div class="skeleton h-4 w-1/3 mb-2"></div><div class="skeleton h-3.5 w-2/3"></div></div>
    </div>`;
  el('historyFeed').innerHTML = row.repeat(6);
}

function syncHistoryControls() {
  const input = el('historySearch');
  if (input.value.trim() !== historyView.q) input.value = historyView.q;
  el('historySearchClear').classList.toggle('hidden', !historyView.q);
  el('historyRange').value = historyView.range;
  el('historyRange').classList.toggle('is-set', historyView.range !== 'all');
  el('historyClearFilters').classList.toggle('hidden', !historyHasFilters());
}

// ==========================================
// 4. CONTROLS
// ==========================================
function bindHistoryControls() {
  const input = el('historySearch');
  input.addEventListener('input', () => {
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(() => { historyView.q = input.value.trim(); historyViewChanged(); }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); clearTimeout(historySearchTimer); historyView.q = ''; historyViewChanged(); }
  });
  el('historySearchClear').addEventListener('click', () => { clearTimeout(historySearchTimer); historyView.q = ''; historyViewChanged(); input.focus(); });
  el('historyRange').addEventListener('change', (e) => { historyView.range = e.target.value; historyViewChanged(); });
  el('historyClearFilters').addEventListener('click', clearHistoryFilters);
  el('historyChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-category]');
    if (chip) { historyView.category = chip.dataset.category; historyViewChanged(); }
  });
  el('historyFeed').addEventListener('click', (e) => {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'clear') clearHistoryFilters();
    if (button.dataset.action === 'retry') { renderHistorySkeleton(); loadHistory(); }
  });
  el('historyMore').addEventListener('click', loadOlderHistory);
  el('historyExport').addEventListener('click', exportHistory);
  el('historyClearAll').addEventListener('click', clearAllHistory);
}

function clearHistoryFilters() {
  clearTimeout(historySearchTimer);
  historyView.q = '';
  historyView.category = '';
  historyView.range = 'all';
  historyViewChanged();
}

// ==========================================
// 5. EXPORT AND CLEAR
// ==========================================
// Exports what is on screen: the current search, category and time range
function exportHistory() {
  const items = filteredHistory();
  if (!items.length) return;
  // A leading =, +, - or @ would be run as a formula by spreadsheet programs
  const cell = (value) => {
    let text = String(value === null || value === undefined ? '' : value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = [['Time', 'Category', 'Action', 'Detail'].map(cell).join(',')];
  for (const item of items) {
    const then = new Date(item.time);
    rows.push([isNaN(then) ? item.time : then.toLocaleString(), item.category, item.action, item.detail].map(cell).join(','));
  }
  // The BOM makes Excel read the file as UTF-8
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `connect2minds-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${items.length} ${items.length === 1 ? 'entry' : 'entries'}.`);
}

function clearAllHistory() {
  window.showSystemModal('Clear activity history',
    'This permanently removes your whole activity log, including entries that are not loaded on this page. The record of when your account was created is kept. This cannot be undone.',
    'confirm', async () => {
      try {
        const result = await api('/api/history', { method: 'DELETE' });
        showToast(`Removed ${result.removed} ${result.removed === 1 ? 'entry' : 'entries'}.`);
        cacheSet('history', null);
        await loadHistory();
      } catch (err) {
        showToast(err.message);
      }
    }, 'Clear history');
}

initHistory();
