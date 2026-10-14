// ==========================================
// HOME.JS — The Home page: what is waiting for me, what is new for me, how my week went,
// and the switches for notifications on this device and the weekly email.
// Loaded after shared.js and chat-common.js (api, caches, toast, el, togglePersonRelation, connectNotifications).
// ==========================================

const HOME_REFRESH_MS = 60000;
// Live events that change something Home shows
const HOME_EVENTS = ['college_hub_changed', 'college_poll', 'board_post_added', 'board_post_updated', 'board_post_removed', 'follow_changed'];
const HOME_ICONS = {
  message: 'chat', ack: 'mark_email_read', poll: 'how_to_vote', group: 'group_add', work: 'upload_file', checkin: 'edit_note',
  event: 'event', attendance: 'warning', grade: 'grading', marks: 'workspace_premium', applicants: 'person_search',
  mark: 'how_to_reg', task: 'assignment'
};

let home = null;                  // what /api/home returned, or null before the first load
let homeLoading = false;
let homeLoadedAt = 0;
let homeReloadTimer = null;
const homePending = new Set();    // "follow:12" while a follow request is running
let pushState = 'checking';       // checking, unsupported, blocked, off, on
let pushBusy = false;

const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// ==========================================
// 1. LOADING
// ==========================================
function initHome() {
  bindHome();
  renderGreeting();
  const cached = cacheGet('home');
  if (cached && cached.me) setHome(cached);
  else el('homeNeeds').innerHTML = `<div class="hm-head"><h2>Waiting for you</h2></div><div class="hm-list">${'<div class="skeleton hm-skel"></div>'.repeat(3)}</div>`;

  loadHome();
  checkPush();
  connectNotifications((data) => { if (HOME_EVENTS.includes(data.type)) queueHomeReload(); }, loadHome);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - homeLoadedAt > HOME_REFRESH_MS) loadHome();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) loadHome(); });
}

async function loadHome() {
  if (homeLoading) return;
  homeLoading = true;
  try {
    const data = await fetchPageData('/api/home');
    homeLoadedAt = Date.now();
    setHome(data);
    cacheSet('home', data);
  } catch (err) {
    if (!home) renderHomeProblem(err.message);
  } finally {
    homeLoading = false;
  }
}

function queueHomeReload() {
  clearTimeout(homeReloadTimer);
  homeReloadTimer = setTimeout(loadHome, 1500);
}

function setHome(data) {
  home = data;
  onlineUserIds = new Set(data.online_user_ids || []);
  renderGreeting();
  renderNeeds();
  renderClasses();
  renderNews();
  renderOpportunities();
  renderPeople();
  renderWeek();
  renderChecklist();
  renderReach();
}

// ==========================================
// 2. RENDERING
// ==========================================
function renderGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const name = (home && home.me.name) || (cacheGet('me') || {}).name || '';
  const first = name.trim().split(/\s+/)[0];
  const hello = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  el('homeGreeting').textContent = first ? `${hello}, ${first}` : hello;
  el('homeDate').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  if (!home) return;
  const waiting = home.needs.length;
  el('homeSub').textContent = waiting
    ? `${plural(waiting, 'thing is', 'things are')} waiting for you${home.me.college ? ` · ${home.me.college}` : ''}`
    : `Nothing is waiting on you${home.me.college ? ` · ${home.me.college}` : ''}`;
}

// "Due tomorrow", "3 days late": worked out from the server's own date, so a wrong clock on the phone does not matter
function dueLabel(due) {
  if (!due || !home) return '';
  const days = Math.round((Date.parse(due) - Date.parse(home.today)) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days < 0) return `${plural(-days, 'day', 'days')} late`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 14) return `In ${days} days`;
  return new Date(due).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function itemRowHtml(item, good) {
  const due = item.kind === 'event' ? '' : dueLabel(item.due);
  return `
    <a class="hm-row${item.urgent ? ' is-urgent' : ''}" href="${escapeHtml(item.link)}">
      <span class="hm-icon${good ? ' is-good' : ''}">${icon(HOME_ICONS[item.kind] || 'notifications')}</span>
      <span class="hm-row-text"><strong>${escapeHtml(item.title)}</strong>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</span>
      ${due ? `<span class="hm-due">${escapeHtml(due)}</span>` : ''}
      <span class="material-symbols-outlined hm-go" aria-hidden="true">chevron_right</span>
    </a>`;
}

function renderNeeds() {
  const needs = home.needs;
  const body = needs.length
    ? `<div class="hm-list">${needs.map(item => itemRowHtml(item)).join('')}</div>`
    : `<div class="hm-clear"><span class="hm-icon is-good">${icon('task_alt')}</span>
         <span><strong>You are all caught up</strong><small>${home.me.role === 'none' ? 'New messages and replies will show up here.' : 'Notices, work to hand in and messages will show up here.'}</small></span></div>`;
  el('homeNeeds').innerHTML = `
    <div class="hm-head"><h2>Waiting for you${needs.length ? `<span class="hm-count">${needs.length}</span>` : ''}</h2></div>${body}`;
}

// Today's classes from My Study, with the next one marked. Attendance is marked on the Study page.
function renderClasses() {
  const box = el('homeClasses');
  const classes = home.classes || [];
  box.hidden = classes.length === 0;
  if (box.hidden) return;
  const now = new Date();
  const nowText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const clock = (time) => { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const next = classes.find(entry => entry.start_time > nowText);
  const marks = { present: 'Present', absent: 'Absent', cancelled: 'No class' };
  box.innerHTML = `<div class="hm-head"><h2>Today's classes</h2><a href="study.html">My Study</a></div><div class="hm-list">${classes.map(entry => {
    const on = entry.start_time <= nowText && nowText < entry.end_time;
    const tag = entry.status ? marks[entry.status] : (on ? 'Now' : (entry === next ? 'Next' : ''));
    return `
      <a class="hm-row" href="study.html">
        <span class="hm-icon${entry.status === 'present' ? ' is-good' : ''}">${icon(entry.kind === 'lab' ? 'science' : 'menu_book')}</span>
        <span class="hm-row-text"><strong>${escapeHtml(entry.subject)}</strong><small>${clock(entry.start_time)} – ${clock(entry.end_time)}${entry.room ? ` · Room ${escapeHtml(entry.room)}` : ''}</small></span>
        ${tag ? `<span class="hm-due">${tag}</span>` : ''}
      </a>`;
  }).join('')}</div>`;
}

function renderNews() {
  const box = el('homeNews');
  box.hidden = home.news.length === 0;
  if (box.hidden) return;
  box.innerHTML = `<div class="hm-head"><h2>Good news</h2></div><div class="hm-list">${home.news.map(item => itemRowHtml(item, true)).join('')}</div>`;
}

function opportunityHtml(post) {
  // A challenge opens on the board by its id; an ordinary post is found by its title
  const link = post.is_sponsored ? `board.html?post=${post.id}` : `board.html?q=${encodeURIComponent(post.title)}`;
  const tags = [
    `<span class="hm-tag">${escapeHtml(post.is_sponsored ? 'Challenge' : post.category)}</span>`,
    post.prize ? `<span class="hm-tag is-prize">${escapeHtml(post.prize)}</span>` : '',
    post.is_urgent ? '<span class="hm-tag is-urgent">Urgent</span>' : ''
  ].join('');
  const by = post.is_sponsored && post.sponsor_name ? post.sponsor_name : post.author_name;
  const closes = dueLabel(post.deadline);
  const facts = [by, closes ? `closes ${/^(Today|Tomorrow|In )/.test(closes) ? closes.toLowerCase() : `on ${closes}`}` : '', plural(post.applicant_count, 'applicant', 'applicants')].filter(Boolean).join(' · ');
  return `
    <a class="hm-opp" href="${escapeHtml(link)}">
      <span class="hm-opp-top">${tags}</span>
      <strong>${escapeHtml(post.title)}</strong>
      <small>${escapeHtml(facts)}</small>
      ${post.match.length ? `<span class="hm-match">${icon('check_circle')}<span>Asks for ${escapeHtml(post.match.slice(0, 3).join(', '))}</span></span>` : ''}
    </a>`;
}

function renderOpportunities() {
  const box = el('homeOpportunities');
  const posts = [...home.challenges, ...home.opportunities].slice(0, 4);
  box.hidden = false;
  const matching = posts.some(post => post.match.length);
  box.innerHTML = posts.length
    ? `<div class="hm-head"><h2>${matching ? 'Opportunities for your skills' : 'New opportunities'}</h2><a href="board.html">See all</a></div><div class="hm-opps">${posts.map(opportunityHtml).join('')}</div>`
    : `<div class="hm-head"><h2>Opportunities</h2><a href="board.html">Open the board</a></div>
       <p class="hm-note">Nothing new for you right now. Looking for teammates or have a project idea? <a href="board.html?new=1" style="color:#3525cd;font-weight:600;">Post it</a> and people with the right skills are told.</p>`;
}

function personReason(person) {
  const parts = [];
  if (person.same_college) parts.push('Your college');
  else if (person.college_name) parts.push(person.college_name);
  if (person.shared_skills.length) parts.push(`${person.shared_skills.join(', ')} in common`);
  if (person.follows_me) parts.push('follows you');
  return parts.join(' · ') || person.department || 'New on Connect2Minds';
}

function personRowHtml(person) {
  const picture = safeUrl(person.profile_pic);
  const face = person.profile_pic && picture !== '#'
    ? `<img src="${escapeHtml(picture)}" alt="" loading="lazy" data-initials="${escapeHtml(getInitials(person.name || '?'))}"/>`
    : escapeHtml(getInitials(person.name || '?'));
  const busy = homePending.has(`follow:${person.id}`) ? 'disabled' : '';
  const label = person.is_following ? 'Following' : (person.follows_me ? 'Follow back' : 'Follow');
  return `
    <div class="hm-person" data-id="${person.id}">
      <a class="hm-avatar" href="profile.html?id=${person.id}" aria-label="${escapeHtml(person.name)}'s profile">${face}${onlineUserIds.has(person.id) ? '<i title="Online now"></i>' : ''}</a>
      <div class="hm-person-text"><a href="profile.html?id=${person.id}">${escapeHtml(person.name || 'Unnamed')}</a><small>${escapeHtml(personReason(person))}</small></div>
      <button class="hm-btn${person.is_following ? ' is-quiet' : ''}" type="button" data-action="follow" aria-pressed="${person.is_following}" ${busy}>${icon(person.is_following ? 'check' : 'person_add')}${label}</button>
    </div>`;
}

function renderPeople() {
  const box = el('homePeople');
  box.hidden = home.people.length === 0;
  if (box.hidden) return;
  box.innerHTML = `<div class="hm-head"><h2>People to know</h2><a href="search.html">Find more</a></div><div>${home.people.map(personRowHtml).join('')}</div>`;
}

function renderWeek() {
  const week = home.week;
  const stat = (count, label, link) => `<a class="hm-stat" href="${link}"><b>${count}</b><span>${label}</span></a>`;
  el('homeWeek').hidden = false;
  el('homeWeek').innerHTML = `
    <div class="hm-head"><h2>Your week</h2></div>
    <div class="hm-stats">
      ${stat(week.profile_views, week.profile_views === 1 ? 'person saw your profile' : 'people saw your profile', 'profile.html')}
      ${stat(week.new_followers, week.new_followers === 1 ? 'new follower' : 'new followers', 'network.html')}
      ${stat(week.applications, week.applications === 1 ? 'application sent' : 'applications sent', 'board.html')}
      ${stat(week.unread, week.unread === 1 ? 'unread message' : 'unread messages', 'inbox.html')}
      ${stat(week.study_streak || 0, 'day study streak', 'study.html?tab=timer')}
      ${stat(week.study_minutes >= 60 ? `${Math.round(week.study_minutes / 6) / 10} h` : `${week.study_minutes || 0} min`, 'studied this week', 'study.html?tab=timer')}
    </div>
    ${practiceRowHtml(home.practice)}`;
}

// One line about the daily practice questions: how many are done today and the streak
function practiceRowHtml(practice) {
  if (!practice || !practice.total_today) return '';
  const done = practice.done_today >= practice.total_today;
  return `
    <a class="hm-row hm-practice" href="practice.html">
      <span class="hm-icon${done ? ' is-good' : ''}">${icon(done ? 'task_alt' : 'quiz')}</span>
      <span class="hm-row-text"><strong>Daily practice</strong><small>${done ? 'Done for today' : `${practice.done_today} of ${practice.total_today} done today`}${practice.streak ? ` · ${practice.streak} day streak` : ''}</small></span>
      ${done ? '' : '<span class="hm-due">2 min</span>'}
    </a>`;
}

function renderChecklist() {
  const box = el('homeChecklist');
  const steps = home.checklist;
  box.hidden = steps.length === 0;
  if (box.hidden) return;
  const done = steps.filter(step => step.done).length;
  box.innerHTML = `
    <div class="hm-head"><h2>Finish setting up</h2><span class="hm-note">${done} of ${steps.length}</span></div>
    <div class="hm-bar"><i style="width:${Math.round(done * 100 / steps.length)}%"></i></div>
    ${steps.map(step => step.done
      ? `<div class="hm-step is-done">${icon('check_circle')}<span>${escapeHtml(step.label)}</span></div>`
      : `<a class="hm-step" href="${escapeHtml(step.link)}">${icon('radio_button_unchecked')}<span>${escapeHtml(step.label)}</span>${step.progress ? `<em>${escapeHtml(step.progress)}</em>` : ''}</a>`).join('')}`;
}

function renderHomeProblem(message) {
  el('homeNeeds').innerHTML = `
    <div class="hm-problem">${icon('cloud_off')}<p>${escapeHtml(message)}</p>
      <button class="hm-btn" type="button" data-action="retry">Try again</button></div>`;
}

// ==========================================
// 3. STAY IN THE LOOP: notifications on this device, the weekly email
// ==========================================
function renderReach() {
  const box = el('homeReach');
  box.hidden = false;
  const push = {
    checking: ['', ''],
    unsupported: [/iPhone|iPad/.test(navigator.userAgent)
      ? 'On an iPhone, first add this site to your Home Screen (Share, then Add to Home Screen) and open it from there.'
      : 'This browser cannot show notifications.', ''],
    blocked: ['Notifications are blocked for this site. Allow them in your browser\'s site settings, then come back.', ''],
    off: ['Hear about notices, deadlines and messages even when the site is closed.',
          `<button class="hm-btn" type="button" data-action="push-on" ${pushBusy ? 'disabled' : ''}>${icon('notifications_active')}Turn on</button>`],
    on: ['On for this device.',
         `<button class="hm-btn is-quiet" type="button" data-action="push-test" ${pushBusy ? 'disabled' : ''}>Send a test</button>
          <button class="hm-btn is-quiet" type="button" data-action="push-off" ${pushBusy ? 'disabled' : ''}>Turn off</button>`]
  }[home.push.available ? pushState : 'unsupported'];

  const email = home.me.has_email
    ? '<p>One email a week, only when something is waiting for you.</p>'
    : `<p>Add an email address to get one summary a week, only when something is waiting for you.</p>
       <form class="hm-email" id="homeEmailForm" novalidate><input type="email" id="homeEmail" placeholder="you@example.com" autocomplete="email" maxlength="254" aria-label="Email address"/><button class="hm-btn" type="submit">Save</button></form>`;

  box.innerHTML = `
    <div class="hm-head"><h2>Stay in the loop</h2></div>
    <div class="hm-reach">
      <div class="hm-reach-top"><strong>Notifications</strong></div>
      <p>${push[0]}</p>
      ${push[1] ? `<div class="hm-reach-actions">${push[1]}</div>` : ''}
    </div>
    <div class="hm-reach">
      <div class="hm-reach-top"><strong>Weekly email</strong>
        <label class="hm-switch"><input type="checkbox" id="homeDigest" aria-label="Weekly email" ${home.me.has_email && home.me.digest_on ? 'checked' : ''} ${home.me.has_email ? '' : 'disabled'}/><i></i></label>
      </div>
      ${email}
    </div>`;
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// The server's key as the bytes the browser wants
function keyBytes(key) {
  const text = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(text, char => char.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

function setPushState(state) {
  pushState = state;
  if (home) renderReach();
}

async function checkPush() {
  if (!pushSupported()) return setPushState('unsupported');
  if (Notification.permission === 'denied') return setPushState('blocked');
  try {
    const subscription = await currentSubscription();
    setPushState(subscription ? 'on' : 'off');
    // The server is told again on every visit, so this device follows whoever is logged in on it now
    if (subscription) api('/api/push/subscribe', { method: 'POST', body: subscription.toJSON() }).catch(() => {});
  } catch (e) {
    setPushState('off');
  }
}

async function turnPushOn() {
  if (pushBusy) return;
  pushBusy = true;
  renderReach();
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { pushState = permission === 'denied' ? 'blocked' : 'off'; return; }
    await navigator.serviceWorker.register('sw.js');
    const registration = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    const options = { userVisibleOnly: true, applicationServerKey: keyBytes(key) };
    let subscription;
    try {
      subscription = await registration.pushManager.subscribe(options);
    } catch (e) {
      // An older subscription made for a different server key: drop it and ask again
      const old = await registration.pushManager.getSubscription();
      if (!old) throw e;
      await old.unsubscribe();
      subscription = await registration.pushManager.subscribe(options);
    }
    await api('/api/push/subscribe', { method: 'POST', body: subscription.toJSON() });
    pushState = 'on';
    showToast('Notifications are on for this device.');
  } catch (err) {
    showToast(err instanceof ApiError ? err.message : 'Could not turn notifications on in this browser.');
  } finally {
    pushBusy = false;
    renderReach();
  }
}

async function turnPushOff() {
  if (pushBusy) return;
  pushBusy = true;
  renderReach();
  try {
    const subscription = await currentSubscription();
    if (subscription) {
      await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } }).catch(() => {});
      await subscription.unsubscribe();
    }
    pushState = 'off';
    showToast('Notifications are off for this device.');
  } catch (err) {
    showToast('Could not turn notifications off. Try again.');
  } finally {
    pushBusy = false;
    renderReach();
  }
}

async function sendTestPush() {
  try {
    const result = await api('/api/push/test', { method: 'POST' });
    showToast(result.sent ? 'Sent. It should appear in a moment.' : 'No device could be reached. Turn notifications off and on again.');
  } catch (err) {
    showToast(err.message);
  }
}

async function saveDigest(box) {
  const wanted = box.checked;
  box.disabled = true;
  try {
    await api('/api/home/settings', { method: 'POST', body: { digest: wanted } });
    home.me.digest_on = wanted;
    cacheSet('home', home);
    showToast(wanted ? 'Weekly email is on.' : 'Weekly email is off.');
  } catch (err) {
    showToast(err.message);
  }
  renderReach();
}

async function saveEmail(form) {
  const input = el('homeEmail');
  const email = input.value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { showToast('Enter a valid email address.'); return input.focus(); }
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/home/settings', { method: 'POST', body: { email, digest: true } });
    home.me.has_email = true;
    home.me.digest_on = true;
    cacheSet('home', home);
    showToast('Saved. Your first weekly email comes when something is waiting for you.');
    renderReach();
  } catch (err) {
    button.disabled = false;
    showToast(err.message);
  }
}

// ==========================================
// 4. CONTROLS
// ==========================================
async function followFromHome(personId) {
  const person = home.people.find(entry => entry.id === personId);
  if (!person) return;
  const redraw = () => {
    const row = el('homePeople').querySelector(`[data-id="${personId}"]`);
    if (row) row.outerHTML = personRowHtml(person);
  };
  const done = await togglePersonRelation('follow', person, homePending, redraw);
  if (done) cacheSet('home', home);
}

function bindHome() {
  document.querySelector('.hm-page').addEventListener('click', (e) => {
    const button = e.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'retry') return loadHome();
    if (action === 'push-on') return turnPushOn();
    if (action === 'push-off') return turnPushOff();
    if (action === 'push-test') return sendTestPush();
    if (action === 'follow') return followFromHome(parseInt(button.closest('[data-id]').dataset.id));
  });
  el('homeReach').addEventListener('change', (e) => { if (e.target.id === 'homeDigest') saveDigest(e.target); });
  el('homeReach').addEventListener('submit', (e) => { e.preventDefault(); if (e.target.id === 'homeEmailForm') saveEmail(e.target); });
  // A picture that fails to load is swapped for the person's initials
  el('homePeople').addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') e.target.replaceWith(document.createTextNode(e.target.dataset.initials || '?'));
  }, true);
}

initHome();
