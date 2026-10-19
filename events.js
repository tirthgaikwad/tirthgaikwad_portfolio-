// ==========================================
// EVENTS.JS — Discover events (events.html): tabs, search and filters, cards or a month calendar, and a "recommended for you"
// row. Loaded after shared.js, chat-common.js and events-common.js.
//   events.html?tab=upcoming|now|past|mine|saved|organising
// ==========================================

const EV_TABS = [['upcoming', 'Upcoming'], ['now', 'Happening now'], ['past', 'Past'], ['mine', 'Registered'], ['saved', 'Saved'], ['organising', 'Organising']];
const ds = { tab: 'upcoming', page: 1, events: [], total: 0, view: 'grid', month: null, kinds: {}, loading: false, token: 0 };

async function initEvents() {
  const params = new URLSearchParams(location.search);
  ds.tab = EV_TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'upcoming';
  el('evQ').value = params.get('q') || '';
  renderTabs();
  bindFilters();
  try {
    const meta = await evApi('/api/events/templates');
    ds.kinds = meta.kinds;
    el('evKind').insertAdjacentHTML('beforeend', Object.entries(meta.kinds).map(([key, label]) => `<option value="${key}">${escapeHtml(label)}</option>`).join(''));
  } catch (e) { /* the type filter simply stays short */ }
  loadEvents(true);
  loadRecommended();
}

function renderTabs() {
  el('evTabs').innerHTML = EV_TABS.map(([key, label]) =>
    `<button type="button" role="tab" data-tab="${key}" aria-selected="${ds.tab === key}">${label}</button>`).join('');
}

function bindFilters() {
  el('evTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab || tab.dataset.tab === ds.tab) return;
    ds.tab = tab.dataset.tab;
    renderTabs();
    const url = new URL(location.href);
    url.searchParams.set('tab', ds.tab);
    history.replaceState(null, '', url);
    el('evRecommended').hidden = ds.tab !== 'upcoming' || !el('evRecommended').innerHTML;
    loadEvents(true);
  });
  let typing = null;
  el('evQ').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => loadEvents(true), 300); });
  ['evKind', 'evMode', 'evSort', 'evFrom'].forEach(id => el(id).addEventListener('change', () => {
    el(id).classList.toggle('is-set', !!el(id).value && id !== 'evSort');
    loadEvents(true);
  }));
  ['evOpen', 'evSeats'].forEach(id => el(id).addEventListener('click', () => {
    el(id).setAttribute('aria-pressed', el(id).getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    loadEvents(true);
  }));
  el('evViewGrid').addEventListener('click', () => setView('grid'));
  el('evViewCal').addEventListener('click', () => setView('calendar'));
  el('evMoreBtn').addEventListener('click', () => { ds.page += 1; loadEvents(false); });
}

function setView(view) {
  ds.view = view;
  el('evViewGrid').setAttribute('aria-pressed', view === 'grid');
  el('evViewCal').setAttribute('aria-pressed', view === 'calendar');
  if (view === 'calendar' && !ds.month) {
    const now = evParts(new Date().toISOString());
    ds.month = { year: +now.year, month: +now.month };
  }
  loadEvents(true);
}

function query() {
  const params = new URLSearchParams({ tab: ds.tab, page: ds.page, size: ds.view === 'calendar' ? 60 : 24 });
  const pairs = { q: el('evQ').value.trim(), kind: el('evKind').value, mode: el('evMode').value, sort: el('evSort').value, date_from: el('evFrom').value };
  if (ds.view === 'calendar') {
    const first = `${ds.month.year}-${String(ds.month.month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(ds.month.year, ds.month.month, 0)).toISOString().slice(0, 10);
    pairs.date_from = first;
    params.set('date_to', last);
    if (ds.tab === 'upcoming') params.set('tab', 'all');
  }
  Object.entries(pairs).forEach(([key, value]) => { if (value) params.set(key, value); });
  if (el('evOpen').getAttribute('aria-pressed') === 'true') params.set('open_only', 'true');
  if (el('evSeats').getAttribute('aria-pressed') === 'true') params.set('seats', 'true');
  return params;
}

async function loadEvents(reset) {
  if (reset) { ds.page = 1; ds.events = []; }
  const token = ++ds.token;
  if (reset) el('evList').setAttribute('aria-busy', 'true');
  try {
    const data = await evApi(`/api/events?${query()}`);
    if (token !== ds.token) return;
    ds.events = reset ? data.events : ds.events.concat(data.events);
    ds.total = data.total;
    if (data.can_create && !el('evCreateLink')) {
      el('evQuick').insertAdjacentHTML('afterbegin', '<a href="event-create.html" id="evCreateLink"><span class="material-symbols-outlined">add_circle</span>Create an event</a>');
    }
    render();
  } catch (err) {
    if (token !== ds.token) return;
    el('evList').innerHTML = evEmptyHtml('cloud_off', 'Could not load events', err.message, '<button type="button" class="ev-btn is-quiet" onclick="loadEvents(true)">Try again</button>');
  }
  el('evList').removeAttribute('aria-busy');
}

function filtersOn() {
  return !!(el('evQ').value.trim() || el('evKind').value || el('evMode').value || el('evFrom').value
    || el('evOpen').getAttribute('aria-pressed') === 'true' || el('evSeats').getAttribute('aria-pressed') === 'true');
}

function render() {
  const list = el('evList');
  el('evMore').hidden = ds.view === 'calendar' || ds.events.length >= ds.total;
  if (ds.view === 'calendar') { list.innerHTML = calendarHtml(); bindCalendar(); return; }
  if (!ds.events.length) {
    const empty = {
      upcoming: ['event_busy', filtersOn() ? 'No events match' : 'No upcoming events yet', filtersOn() ? 'Try fewer filters.' : 'When your college or the clubs you follow publish an event, it shows up here.'],
      now: ['schedule', 'Nothing is happening right now', 'Check the upcoming events.'],
      past: ['history', 'No past events', 'Completed events and their photos show here.'],
      mine: ['confirmation_number', 'You have not registered for anything', 'Find an event and register in one tap.'],
      saved: ['bookmark', 'Nothing saved yet', 'Tap the bookmark on any event to keep it here.'],
      organising: ['edit_calendar', 'You are not organising any event', 'Create one for your department, club or team.']
    }[ds.tab];
    const action = ds.tab === 'organising' ? '<a class="ev-btn" href="event-create.html">Create an event</a>' : (ds.tab !== 'upcoming' ? '<button type="button" class="ev-btn is-quiet" data-tab-go="upcoming">See upcoming events</button>' : '');
    list.innerHTML = evEmptyHtml(empty[0], empty[1], empty[2], action);
    const go = list.querySelector('[data-tab-go]');
    if (go) go.addEventListener('click', () => el('evTabs').querySelector('[data-tab="upcoming"]').click());
    return;
  }
  list.innerHTML = `<div class="ev-grid">${ds.events.map(ev => evCardHtml(ev, ds.tab === 'organising' ? { link: `event-manage.html?id=${ev.id}`, noSave: true, foot: `${evStatusChip(ev.display_status)}<span>Manage</span>` } : {})).join('')}</div>`;
}

async function loadRecommended() {
  try {
    const data = await evApi('/api/events/recommended');
    if (!data.events.length) return;
    el('evRecommended').innerHTML = `<div class="ev-row-title"><h2>Recommended for you</h2><span class="ev-small">From your college, your department and your skills</span></div>
      <div class="ev-strip">${data.events.map(ev => evCardHtml(ev)).join('')}</div>`;
    el('evRecommended').hidden = ds.tab !== 'upcoming';
  } catch (e) { /* the row is a nice extra */ }
}

// ---------- month calendar ----------
function calendarHtml() {
  const { year, month } = ds.month;
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;            // Monday first
  const byDay = {};
  ds.events.forEach(ev => { const key = evDayKey(ev.start_at); (byDay[key] = byDay[key] || []).push(ev); });
  const today = evDayKey(new Date().toISOString());
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="ev-cal-day is-other" aria-hidden="true"></div>');
  for (let d = 1; d <= days; d++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const items = byDay[key] || [];
    cells.push(`<div class="ev-cal-day${key === today ? ' is-today' : ''}"><span class="ev-cal-num">${d}</span>
      ${items.slice(0, 3).map(ev => `<a class="ev-cal-item" href="event.html?id=${ev.id}" title="${escapeHtml(ev.title)} · ${escapeHtml(evTime(ev.start_at))}">${escapeHtml(evTime(ev.start_at))} ${escapeHtml(ev.title)}</a>`).join('')}
      ${items.length > 3 ? `<span class="ev-small">+${items.length - 3} more</span>` : ''}</div>`);
  }
  while (cells.length % 7) cells.push('<div class="ev-cal-day is-other" aria-hidden="true"></div>');
  const label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  return `<div class="ev-cal"><div class="ev-cal-head"><button type="button" class="ev-iconbtn" data-cal="-1" aria-label="Previous month">${evIcon('chevron_left')}</button>
    <h3>${label}</h3><button type="button" class="ev-iconbtn" data-cal="1" aria-label="Next month">${evIcon('chevron_right')}</button></div>
    <div class="ev-cal-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="ev-cal-dow">${d}</div>`).join('')}${cells.join('')}</div></div>`;
}

function bindCalendar() {
  el('evList').querySelectorAll('[data-cal]').forEach(button => button.addEventListener('click', () => {
    let { year, month } = ds.month;
    month += Number(button.dataset.cal);
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    ds.month = { year, month };
    loadEvents(true);
  }));
}

initEvents();
