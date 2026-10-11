// ==========================================
// COLLEGE-HUB.JS — The College Hub page: a college's notice board, its groups, its chat rooms and its students
// Loaded after shared.js and chat-common.js (api, caches, toast, el, norm, avatars, time formats, linkify, live socket),
// and after college-hub-work.js (polls, read confirmation, handed-in work, check-ins), college-hub-calendar.js
// (calendar, attendance) and college-hub-learn.js (resources, Q&A), whose functions this file calls.
// A group here is an ordinary team that belongs to the college, so its own chat lives on the My Teams page.
// ==========================================

const HUB_REFRESH_MS = 60000;
const HUB_COLLEGE_ROOM = 'college';
const HUB_MAX_GROUP_SIZE = 50;      // the server's limit for a group that belongs to no activity
const HUB_TABS = ['board', 'groups', 'calendar', 'chat', 'resources', 'qa', 'attendance', 'students'];

let hub = null;                     // what /api/college-hub returned, or null before the first load
let hubLoading = false;
let hubLoadedAt = 0;
let hubReloadTimer = null;
let peopleById = new Map();

// What is being looked at. The tab and the activity are mirrored in the address bar.
const view = { tab: 'board', activity: 'all', dept: '', division: '', mine: false, rosterActivity: '', rosterFree: false, rosterQuery: '' };

// The chat: one entry per room that has been opened, and unread counts for rooms that are not on screen
const chat = { room: HUB_COLLEGE_ROOM, rooms: {}, unread: {} };

let modalSubmit = null;             // what the pop-up's main button does; throws an Error to show a message
let picker = null;                  // the student picker inside the pop-up, while one is open

// ==========================================
// 1. LOADING
// ==========================================
function initHub() {
  const params = new URLSearchParams(window.location.search);
  if (HUB_TABS.includes(params.get('tab'))) view.tab = params.get('tab');
  if (params.get('activity')) view.activity = params.get('activity');
  bindHub();

  const cached = cacheGet('collegeHub');
  if (cached && cached.me) setHub(cached);
  else renderLoading();

  loadHub();
  connectNotifications(handleHubEvent, loadHub);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - hubLoadedAt > HUB_REFRESH_MS) loadHub();
  });
}

async function loadHub() {
  if (hubLoading) return;
  hubLoading = true;
  try {
    setHub(await fetchPageData('/api/college-hub'));
    hubLoadedAt = Date.now();
    cacheSet('collegeHub', hub);
  } catch (err) {
    if (!hub) renderProblem(err.message);
  } finally {
    hubLoading = false;
  }
}

function setHub(data) {
  hub = data;
  peopleById = new Map((hub.people || []).map(person => [person.id, person]));
  if (hub.online_user_ids) onlineUserIds = new Set(hub.online_user_ids);
  renderHub();
}

// Several changes can arrive close together (a teacher filling groups); one reload covers them
function queueHubReload() {
  clearTimeout(hubReloadTimer);
  hubReloadTimer = setTimeout(loadHub, 250);
}

// ==========================================
// 2. WHAT THE DATA MEANS
// ==========================================
const isTeacher = () => hub.me.role === 'teacher';
const isMember = () => hub.me.role !== 'none';
const students = () => hub.people.filter(person => !person.is_teacher);
const activities = () => hub.posts.filter(post => post.kind === 'activity');
const activityById = (id) => activities().find(post => post.id === Number(id)) || null;
const groupsOf = (activityId) => hub.groups.filter(group => (group.activity_id || null) === (activityId || null));
const studentIdsOf = (group) => group.members.filter(member => !member.is_teacher).map(member => member.id);
const todayIso = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD in local time
const deadlinePassed = (deadline) => Boolean(deadline) && deadline < todayIso();
const classRoomOf = (department, division) => `class:${norm(department)}|${norm(division)}`;
const classLabel = (person) => [person.department, person.division ? `Div ${person.division}` : ''].filter(Boolean).join(' · ') || 'No class set';
const nameOf = (id) => (peopleById.get(id) || { name: `User #${id}` }).name;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// Which group each student is in, for one activity (or for the groups of no activity)
function groupByStudent(activityId) {
  const map = new Map();
  groupsOf(activityId).forEach(group => studentIdsOf(group).forEach(id => map.set(id, group)));
  return map;
}

// The students an activity is addressed to
function audienceOf(activity) {
  return students().filter(person =>
    (!activity.department || norm(activity.department) === norm(person.department)) &&
    (!activity.division || norm(activity.division) === norm(person.division)));
}

function unassignedOf(activity) {
  const placed = groupByStudent(activity.id);
  return audienceOf(activity).filter(person => !placed.has(person.id));
}

// Whether students are the ones forming groups right now, and if not, why
function studentRule(activity) {
  if (activity) {
    if (!activity.students_form_groups) return 'Teachers are forming the groups for this activity.';
    if (deadlinePassed(activity.deadline)) return 'The deadline for forming groups has passed.';
    return '';
  }
  return hub.settings.students_can_form_groups ? '' : 'Teachers have turned off student-made groups.';
}

const iAmIn = (group) => group.members.some(member => member.id === hub.me.id);
function iManage(group) {
  if (isTeacher()) return true;
  return !group.teacher_managed && group.members.some(member => member.id === hub.me.id && member.role === 'Admin');
}

function sizeLimit(activity) {
  return activity ? activity.group_max : HUB_MAX_GROUP_SIZE;
}

function formatDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

const icon = (name) => `<span class="material-symbols-outlined ch-ico">${name}</span>`;
const avatarOf = (person) => `<span class="ch-avatar">${avatarHtml(person && person.profile_pic ? mediaUrl(person.profile_pic) : '', person ? person.name : '?', '')}</span>`;

// ==========================================
// 3. RENDERING: FRAME
// ==========================================
function renderLoading() {
  el('boardList').innerHTML = '<div class="skeleton" style="height:150px"></div><div class="skeleton" style="height:150px"></div>';
}

function renderProblem(message) {
  el('boardList').innerHTML = `<div class="ch-empty">${icon('cloud_off')}<h3>Could not load College Hub</h3><p>${escapeHtml(message)}</p><button class="ch-btn solid" type="button" data-act="retry">Try again</button></div>`;
}

function renderHub() {
  const member = isMember();
  el('hubTabs').classList.toggle('ch-hidden', !member);
  el('hubOutsider').classList.toggle('ch-hidden', member);
  document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('ch-hidden', !member || panel.dataset.panel !== view.tab));
  if (!member) return renderOutsider();

  el('hubCollege').textContent = hub.me.college || 'Your college';
  const licence = hub.licence;
  const licenceChip = licence ? `<span class="ch-chip ${licence.trial ? 'indigo' : 'green'}" title="Institution licence">${icon(licence.trial ? 'hourglass_top' : 'workspace_premium')}${escapeHtml(licence.name)} until ${escapeHtml(formatDate(licence.ends_at))}</span>` : '';
  el('hubSummary').innerHTML = isTeacher()
    ? `<span class="ch-role">${icon('verified_user')}Teacher</span><span>You run the groups, the notice board and the chat rooms of this college.</span>${licenceChip}${licence ? ' <a class="msg-link" href="institution.html">Analytics</a>' : ''}`
    : `<span>Your class: <b>${escapeHtml(classLabel(hub.me))}</b></span>`;
  el('hubStats').innerHTML = [
    [students().length, 'students'], [hub.groups.length, 'groups'], [activities().length, 'activities']
  ].map(([count, label]) => `<div class="ch-stat"><b>${count}</b><span>${label}</span></div>`).join('');

  document.querySelectorAll('#hubTabs [data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === view.tab)));
  if (view.tab === 'board') renderBoard();
  if (view.tab === 'groups') renderGroups();
  if (view.tab === 'students') renderStudents();
  if (view.tab === 'calendar') renderCalendar();
  if (view.tab === 'resources') renderResources();
  if (view.tab === 'qa') renderQa();
  if (view.tab === 'attendance') renderAttendance();
  if (view.tab === 'chat') {
    renderChat();
    if (!roomState(chat.room).loaded) openRoom(chat.room);   // the page was opened straight on the chat tab
  }
  renderChatUnread();
}

function setTab(tab) {
  view.tab = tab;
  writeUrl();
  renderHub();
  if (tab === 'chat') openRoom(chat.room);
}

function writeUrl() {
  const params = new URLSearchParams();
  if (view.tab !== 'board') params.set('tab', view.tab);
  if (view.tab === 'groups' && view.activity !== 'all') params.set('activity', view.activity);
  const query = params.toString();
  history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
}

// Someone who is neither a student of a college nor an approved teacher
function renderOutsider() {
  el('hubCollege').textContent = 'College Hub';
  el('hubSummary').textContent = 'Groups, notices and class chat for a college.';
  el('hubStats').innerHTML = '';
  const request = hub.request;
  let action;
  if (request && request.status === 'pending') {
    action = `<p><b>Your request for teacher access for ${escapeHtml(request.college)} is waiting for an admin.</b></p>`;
  } else {
    const declined = request && request.status === 'declined' ? `<p>Your last request (for ${escapeHtml(request.college)}) was declined. You can apply again.</p>` : '';
    action = `${declined}<a class="ch-btn solid" href="apply-teacher.html" style="margin-top:16px">${icon('how_to_reg')}Apply as a teacher</a>`;
  }
  el('hubOutsider').innerHTML = `<div class="ch-empty">${icon('school')}
    <h3>This page is for students and teachers of a college</h3>
    <p>Students see it automatically for the college on their profile. If you teach at ${escapeHtml(hub.me.college || 'a college')}, apply for teacher access with your staff ID: the founder checks it, and then you can form groups, post notices, take attendance and read the class chat rooms.</p>
    ${action}</div>`;
}

// ==========================================
// 4. RENDERING: NOTICE BOARD
// ==========================================
function renderBoard() {
  const teacher = isTeacher();
  el('boardList').innerHTML = hub.posts.length
    ? hub.posts.map(postHtml).join('')
    : `<div class="ch-empty">${icon('campaign')}<h3>Nothing on the board yet</h3><p>${teacher ? 'Post a notice, or an activity that says how groups should be formed and on which topics.' : 'When a teacher posts a notice or an activity, it shows up here.'}</p>${teacher ? `<button class="ch-btn solid" type="button" data-act="new-post">${icon('add')}New post</button>` : ''}</div>`;

  const allowed = hub.settings.students_can_form_groups;
  const teacherPanels = teacher ? `
    <div class="ch-panel">
      <h3>Post to the board</h3>
      <p>A notice is information. An activity also sets how groups are formed for it.</p>
      <button class="ch-btn solid" type="button" data-act="new-post" style="margin-top:12px;width:100%">${icon('add')}New post</button>
    </div>
    <div class="ch-panel">
      <div class="ch-switch">
        <button class="ch-switch-btn" type="button" role="switch" aria-checked="${allowed}" aria-labelledby="switchTitle" data-act="toggle-switch"></button>
        <div><h3 id="switchTitle">Students can form their own groups</h3>
        <p>${allowed ? 'On. Students can make groups that belong to no activity. Each activity has its own setting.' : 'Off. Only teachers make groups that belong to no activity. Each activity has its own setting.'}</p></div>
      </div>
    </div>` : '';
  el('boardSide').innerHTML = `${thisWeekPanelHtml()}${teacherPanels}
    <div class="ch-panel">
      <h3>How groups work</h3>
      <ul class="ch-howto">
        <li>${icon('campaign')}<span>A teacher posts an activity with the group size, the deadline and the topics.</span></li>
        <li>${icon('group_add')}<span>${teacher ? 'Students form their groups, or you form them yourself.' : (allowed ? 'You can form a group with students of your college, unless the activity says teachers form them.' : 'For now teachers form the groups.')}</span></li>
        <li>${icon('forum')}<span>Each group gets its own chat and task board under My Teams.</span></li>
        <li>${icon('lock')}<span>A group marked "Set by teachers" can only be changed by a teacher.</span></li>
      </ul>
    </div>`;
}

function postHtml(post) {
  const teacher = isTeacher();
  const activity = post.kind === 'activity';
  const audience = post.department ? `${post.department}${post.division ? ` · Div ${post.division}` : ''}` : 'Whole college';
  const chips = `${post.pinned ? `<span class="ch-chip indigo">${icon('push_pin')}Pinned</span>` : ''}
    <span class="ch-chip ${activity ? 'navy' : ''}">${icon(activity ? 'assignment' : 'campaign')}${activity ? 'Activity' : 'Notice'}</span>
    <span class="ch-chip">${icon('groups')}${escapeHtml(audience)}</span>`;
  const manage = teacher ? `<span class="ch-spacer"></span>
    <button class="ch-icon-btn" type="button" data-act="pin-post" data-id="${post.id}" title="${post.pinned ? 'Unpin' : 'Pin to the top'}" aria-label="${post.pinned ? 'Unpin' : 'Pin to the top'}"><span class="material-symbols-outlined">${post.pinned ? 'keep_off' : 'push_pin'}</span></button>
    <button class="ch-icon-btn" type="button" data-act="edit-post" data-id="${post.id}" title="Edit" aria-label="Edit"><span class="material-symbols-outlined">edit</span></button>
    <button class="ch-icon-btn danger" type="button" data-act="delete-post" data-id="${post.id}" title="Delete" aria-label="Delete"><span class="material-symbols-outlined">delete</span></button>` : '';

  let details = '', actions = '';
  if (activity) {
    const groups = groupsOf(post.id);
    const placed = groupByStudent(post.id);
    const everyone = audienceOf(post);
    const waiting = everyone.filter(person => !placed.has(person.id));
    const closed = deadlinePassed(post.deadline);
    const size = post.group_min === post.group_max ? `${post.group_min}` : `${post.group_min} to ${post.group_max}`;
    const taken = new Set(groups.map(group => norm(group.topic)).filter(Boolean));
    details = `
      <div class="ch-rules">
        <span class="ch-chip indigo">${icon('group')}Groups of ${size}</span>
        ${post.deadline ? `<span class="ch-chip ${closed ? 'warn' : 'indigo'}">${icon('event')}${closed ? 'Deadline passed' : `Form groups by ${formatDate(post.deadline)}`}</span>` : ''}
        <span class="ch-chip indigo">${icon(post.students_form_groups ? 'diversity_3' : 'supervisor_account')}${post.students_form_groups ? 'Students form the groups' : 'Teachers form the groups'}</span>
      </div>
      ${post.topics.length ? `<div class="ch-topics"><h4>Topics</h4><ul>${post.topics.map(topic => `<li class="ch-topic${taken.has(norm(topic)) ? ' taken' : ''}" title="${taken.has(norm(topic)) ? 'Taken by a group' : 'Free'}">${escapeHtml(topic)}</li>`).join('')}</ul></div>` : ''}
      <p class="ch-post-status"><b>${plural(groups.length, 'group', 'groups')}</b> · ${everyone.length - waiting.length} of ${plural(everyone.length, 'student', 'students')} placed${
        teacher ? '' : (placed.has(hub.me.id) ? ` · You are in <b>${escapeHtml(placed.get(hub.me.id).name)}</b>` : (everyone.some(person => person.id === hub.me.id) ? ' · <b>You are not in a group yet</b>' : ''))}</p>`;

    const see = `<button class="ch-btn line small" type="button" data-act="see-groups" data-id="${post.id}">${icon('groups')}See groups</button>`;
    if (teacher) {
      actions = `<button class="ch-btn solid small" type="button" data-act="new-group" data-activity="${post.id}">${icon('group_add')}Create group</button>
        ${waiting.length ? `<button class="ch-btn line small" type="button" data-act="autofill" data-id="${post.id}">${icon('shuffle')}Auto-fill ${waiting.length}</button>
        <button class="ch-btn line small" type="button" data-act="remind" data-id="${post.id}">${icon('notifications_active')}Remind ${waiting.length}</button>` : ''}
        ${see}
        <button class="ch-btn line small" type="button" data-act="roster-csv" data-id="${post.id}">${icon('download')}Roster</button>`;
    } else if (!placed.has(hub.me.id) && !studentRule(post) && everyone.some(person => person.id === hub.me.id)) {
      actions = `<button class="ch-btn solid small" type="button" data-act="new-group" data-activity="${post.id}">${icon('group_add')}Form a group</button>${see}`;
    } else {
      actions = see;
    }
  }

  return `
    <article class="ch-panel ch-post${post.pinned ? ' is-pinned' : ''}" data-post="${post.id}">
      <div class="ch-post-top">${chips}<time>${escapeHtml(formatTime(post.created_at))}</time></div>
      <h3>${escapeHtml(post.title)}</h3>
      ${post.body ? `<div class="ch-post-body">${linkify(post.body)}</div>` : ''}
      ${details}
      ${activity ? workHtml(post) + checkinSummaryHtml(post) : ''}
      ${pollHtml(post)}
      ${ackHtml(post)}
      ${actions || manage ? `<div class="ch-post-actions">${actions}${manage}</div>` : ''}
    </article>`;
}

// ==========================================
// 5. RENDERING: GROUPS
// ==========================================
function filteredGroups() {
  return hub.groups.filter(group => {
    if (view.activity === 'none' && group.activity_id) return false;
    if (view.activity !== 'all' && view.activity !== 'none' && group.activity_id !== Number(view.activity)) return false;
    if (view.mine && !iAmIn(group)) return false;
    if (view.dept || view.division) {
      const inClass = studentIdsOf(group).some(id => {
        const person = peopleById.get(id);
        return person && (!view.dept || norm(person.department) === view.dept) && (!view.division || norm(person.division) === view.division);
      });
      if (!inClass) return false;
    }
    return true;
  });
}

// Distinct values of a field among the students, as <option>s
function optionsOf(field, chosen, within) {
  const seen = new Map();
  (within || students()).forEach(person => { if (person[field]) seen.set(norm(person[field]), person[field]); });
  return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === chosen ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function renderGroups() {
  const teacher = isTeacher();
  const chosen = view.activity !== 'all' && view.activity !== 'none' ? activityById(view.activity) : null;
  if (view.activity !== 'all' && view.activity !== 'none' && !chosen) view.activity = 'all';
  const groups = filteredGroups();
  const rule = teacher ? '' : studentRule(chosen);
  const alreadyIn = !teacher && chosen && groupByStudent(chosen.id).has(hub.me.id);
  const mayCreate = teacher || (!rule && !alreadyIn);

  el('groupBar').innerHTML = `
    <h2 class="ch-bar-title">Groups<small>${groups.length}</small></h2>
    <select class="ch-select" id="groupActivity" aria-label="Activity">
      <option value="all" ${view.activity === 'all' ? 'selected' : ''}>All activities</option>
      ${activities().map(post => `<option value="${post.id}" ${String(post.id) === String(view.activity) ? 'selected' : ''}>${escapeHtml(post.title)}</option>`).join('')}
      <option value="none" ${view.activity === 'none' ? 'selected' : ''}>Not for an activity</option>
    </select>
    <select class="ch-select" id="groupDept" aria-label="Department"><option value="">All departments</option>${optionsOf('department', view.dept)}</select>
    <select class="ch-select" id="groupDivision" aria-label="Division"><option value="">All divisions</option>${optionsOf('division', view.division)}</select>
    <button class="ch-btn line" type="button" data-act="toggle-mine" aria-pressed="${view.mine}">${icon('person')}My groups</button>
    ${mayCreate ? `<button class="ch-btn solid" type="button" data-act="new-group" data-activity="${chosen ? chosen.id : ''}">${icon('group_add')}${teacher ? 'Create group' : 'Form a group'}</button>` : ''}`;

  const note = !teacher && rule ? `<p class="ch-post-status" style="grid-column:1/-1;margin:0">${icon('info')} ${escapeHtml(rule)}</p>` : '';
  el('groupGrid').innerHTML = note + (groups.length
    ? groups.map(groupHtml).join('')
    : `<div class="ch-empty" style="grid-column:1/-1">${icon('groups')}<h3>No groups here yet</h3><p>${teacher ? 'Create a group by picking students, or let students form their own.' : (mayCreate ? 'Be the first: form a group with students of your college.' : 'Groups will show up here once they are formed.')}</p></div>`);
}

function groupHtml(group) {
  const teacher = isTeacher();
  const activity = group.activity_id ? activityById(group.activity_id) : null;
  const ids = studentIdsOf(group);
  const mine = iAmIn(group);
  const manage = iManage(group);
  const limit = sizeLimit(activity);
  const needs = activity ? Math.max(0, activity.group_min - ids.length) : 0;
  const rule = teacher ? '' : studentRule(activity);
  const others = teacher ? groupsOf(group.activity_id).filter(other => other.id !== group.id) : [];

  const tags = `${group.teacher_managed ? `<span class="ch-chip navy">${icon('lock')}Set by teachers</span>` : ''}
    ${group.open_to_join && !group.teacher_managed ? `<span class="ch-chip green">${icon('door_open')}Open to join</span>` : ''}
    ${group.topic ? `<span class="ch-chip indigo">${icon('topic')}${escapeHtml(group.topic)}</span>` : ''}
    ${needs ? `<span class="ch-chip warn">Needs ${needs} more</span>` : ''}
    ${groupWorkChip(group, activity)}`;

  const members = group.members.map(member => {
    const person = peopleById.get(member.id);
    const you = member.id === hub.me.id;
    const removable = manage && !member.is_teacher && !you && (teacher || !rule);
    return `<div class="ch-member">
      ${avatarOf(person || { name: nameOf(member.id) })}
      <span class="ch-member-name">${escapeHtml(nameOf(member.id))}${you ? ' (you)' : ''}<small>${member.is_teacher ? 'Teacher' : escapeHtml(person ? classLabel(person) : '')}</small></span>
      ${teacher && !member.is_teacher && others.length ? `<select class="ch-select" data-move="${member.id}" data-group="${group.id}" aria-label="Move ${escapeHtml(nameOf(member.id))} to another group"><option value="">Move to</option>${others.map(other => `<option value="${other.id}">${escapeHtml(other.name)}</option>`).join('')}</select>` : ''}
      ${removable ? `<button class="ch-icon-btn danger" type="button" data-act="remove-member" data-group="${group.id}" data-user="${member.id}" title="Remove from group" aria-label="Remove ${escapeHtml(nameOf(member.id))}"><span class="material-symbols-outlined">person_remove</span></button>` : ''}
    </div>`;
  }).join('');

  const full = ids.length >= limit;
  const canJoin = !teacher && !mine && group.open_to_join && !group.teacher_managed && !rule && !full && !(activity && groupByStudent(activity.id).has(hub.me.id));
  const canLeave = !teacher && mine && !group.teacher_managed && group.created_by !== hub.me.id && !rule;
  const foot = `
    ${mine ? `<a class="ch-btn solid small" href="team.html?team=${group.id}">${icon('forum')}Open group chat</a>` : ''}
    ${canJoin ? `<button class="ch-btn solid small" type="button" data-act="join-group" data-group="${group.id}">${icon('login')}Join</button>` : ''}
    ${manage && !full && (teacher || !rule) ? `<button class="ch-btn line small" type="button" data-act="add-members" data-group="${group.id}">${icon('person_add')}Add</button>` : ''}
    ${canLeave ? `<button class="ch-btn line small danger" type="button" data-act="leave-group" data-group="${group.id}">Leave</button>` : ''}
    <span class="ch-spacer"></span>
    ${manage ? `<button class="ch-icon-btn" type="button" data-act="edit-group" data-group="${group.id}" title="Rename or change topic" aria-label="Rename or change topic"><span class="material-symbols-outlined">edit</span></button>` : ''}
    ${teacher ? `<button class="ch-icon-btn" type="button" data-act="lock-group" data-group="${group.id}" title="${group.teacher_managed ? 'Let students change this group' : 'Lock: only teachers can change it'}" aria-label="${group.teacher_managed ? 'Unlock group' : 'Lock group'}"><span class="material-symbols-outlined">${group.teacher_managed ? 'lock_open' : 'lock'}</span></button>` : ''}
    ${teacher || (!group.teacher_managed && group.created_by === hub.me.id) ? `<button class="ch-icon-btn danger" type="button" data-act="delete-group" data-group="${group.id}" title="Delete group" aria-label="Delete group"><span class="material-symbols-outlined">delete</span></button>` : ''}`;

  return `
    <article class="ch-panel ch-group${mine && !teacher ? ' is-mine' : ''}" data-group-card="${group.id}">
      <div class="ch-group-top">
        <div style="flex:1;min-width:0"><h3>${escapeHtml(group.name)}</h3>
        <p class="ch-group-sub">${escapeHtml(activity ? activity.title : 'Not for an activity')} · ${ids.length}${activity ? ` of ${limit}` : ''} ${ids.length === 1 && !activity ? 'student' : 'students'}</p></div>
      </div>
      ${activity ? `<div class="ch-meter"><i style="width:${Math.min(100, Math.round(ids.length / limit * 100))}%"></i></div>` : ''}
      ${tags.trim() ? `<div class="ch-group-tags">${tags}</div>` : ''}
      <div class="ch-members">${members}</div>
      ${groupCheckinHtml(group, activity)}
      <div class="ch-group-foot">${foot}</div>
    </article>`;
}

// ==========================================
// 6. RENDERING: STUDENTS
// ==========================================
function renderStudents() {
  const teacher = isTeacher();
  const activity = view.rosterActivity ? activityById(view.rosterActivity) : null;
  if (view.rosterActivity && !activity) view.rosterActivity = '';
  const placed = activity ? groupByStudent(activity.id) : new Map();
  const query = norm(view.rosterQuery);
  let list = activity ? audienceOf(activity) : students();
  if (query) list = list.filter(person => norm(person.name).includes(query));
  if (activity && view.rosterFree) list = list.filter(person => !placed.has(person.id));

  el('studentBar').innerHTML = `
    <h2 class="ch-bar-title">Students<small>${list.length}</small></h2>
    <input class="ch-input" id="rosterSearch" type="search" placeholder="Search a name" aria-label="Search students" value="${escapeHtml(view.rosterQuery)}">
    <select class="ch-select" id="rosterActivity" aria-label="Show groups for">
      <option value="">No activity chosen</option>
      ${activities().map(post => `<option value="${post.id}" ${String(post.id) === String(view.rosterActivity) ? 'selected' : ''}>${escapeHtml(post.title)}</option>`).join('')}
    </select>
    ${activity ? `<button class="ch-btn line" type="button" data-act="toggle-free" aria-pressed="${view.rosterFree}">${icon('person_off')}Without a group</button>` : ''}
    ${activity && teacher ? `<button class="ch-btn line" type="button" data-act="roster-csv" data-id="${activity.id}">${icon('download')}Roster</button>` : ''}`;

  if (!list.length) {
    el('studentList').innerHTML = `<div class="ch-empty">${icon('badge')}<h3>${activity && view.rosterFree ? 'Everyone has a group' : 'No students to show'}</h3><p>${activity && view.rosterFree ? 'Every student this activity is for is in a group.' : 'Students appear here when the college on their profile matches yours.'}</p></div>`;
    return;
  }
  const classes = new Map();
  list.forEach(person => {
    const label = classLabel(person);
    if (!classes.has(label)) classes.set(label, []);
    classes.get(label).push(person);
  });
  const openGroups = activity ? groupsOf(activity.id) : [];
  el('studentList').innerHTML = [...classes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, people]) => `
    <div class="ch-panel ch-class">
      <div class="ch-class-head"><b>${escapeHtml(label)}</b><span>${plural(people.length, 'student', 'students')}</span></div>
      ${people.map(person => {
        const group = placed.get(person.id);
        let right = '';
        if (activity && teacher) {
          right = `<select class="ch-select" data-place="${person.id}" data-from="${group ? group.id : ''}" aria-label="Group of ${escapeHtml(person.name)}">
            <option value="">${group ? escapeHtml(group.name) : 'No group'}</option>
            ${openGroups.filter(other => !group || other.id !== group.id).map(other => `<option value="${other.id}">${group ? 'Move to' : 'Put in'} ${escapeHtml(other.name)}</option>`).join('')}
          </select>`;
        } else if (activity) {
          right = group ? `<span class="ch-chip indigo">${icon('groups')}${escapeHtml(group.name)}</span>` : '<span class="ch-chip warn">No group</span>';
        }
        return `<div class="ch-student">${avatarOf(person)}<span class="ch-student-name">${escapeHtml(person.name)}${person.id === hub.me.id ? ' (you)' : ''}</span>${right}</div>`;
      }).join('')}
    </div>`).join('');
}

// ==========================================
// 7. CHAT
// ==========================================

// The rooms this person may open: the college, their own class, and for a teacher every class there is
function chatRoomList() {
  const rooms = [{ key: HUB_COLLEGE_ROOM, label: 'Whole college', sub: hub.me.college, icon: 'apartment' }];
  if (isTeacher()) {
    const seen = new Map();
    students().forEach(person => seen.set(classRoomOf(person.department, person.division), classLabel(person)));
    [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([key, label]) => rooms.push({ key, label, sub: 'Class room', icon: 'meeting_room' }));
  } else {
    rooms.push({ key: hub.me.room, label: 'My class', sub: classLabel(hub.me), icon: 'meeting_room' });
  }
  return rooms;
}

function roomState(key) {
  if (!chat.rooms[key]) chat.rooms[key] = { messages: [], hasMore: false, loaded: false, loading: false };
  return chat.rooms[key];
}

function renderChat() {
  const rooms = chatRoomList();
  if (!rooms.some(room => room.key === chat.room)) chat.room = HUB_COLLEGE_ROOM;
  const current = rooms.find(room => room.key === chat.room);
  el('chatRooms').innerHTML = '<h3>Rooms</h3>' + rooms.map(room => `
    <button class="ch-room" type="button" data-room="${escapeHtml(room.key)}" aria-current="${room.key === chat.room}">
      <span class="ch-room-ico"><span class="material-symbols-outlined">${room.icon}</span></span>
      <span class="ch-room-text"><b>${escapeHtml(room.label)}</b><small>${escapeHtml(room.sub)}</small></span>
      ${chat.unread[room.key] ? `<span class="ch-dot">${chat.unread[room.key]}</span>` : ''}
    </button>`).join('');
  el('chatRoomSelect').innerHTML = rooms.map(room => `<option value="${escapeHtml(room.key)}" ${room.key === chat.room ? 'selected' : ''}>${escapeHtml(room.label)}${room.label === 'My class' ? `: ${escapeHtml(room.sub)}` : ''}${chat.unread[room.key] ? ` (${chat.unread[room.key]})` : ''}</option>`).join('');
  el('chatTitle').textContent = current.label;
  el('chatSub').textContent = current.sub;
  el('chatInput').placeholder = `Message ${current.label === 'My class' ? 'your class' : (current.key === HUB_COLLEGE_ROOM ? 'the whole college' : current.label)}`;
  renderMessages();
}

function messageHtml(message) {
  const mine = message.sender_id === hub.me.id;
  const deletable = mine || isTeacher();
  return `<div class="ch-msg${mine ? ' is-mine' : ''}" data-message="${message.id}">
    <span class="ch-avatar">${avatarHtml(message.sender_pic ? mediaUrl(message.sender_pic) : '', message.sender_name, '')}</span>
    <div class="ch-msg-main">
      <div class="ch-msg-head"><b>${escapeHtml(message.sender_name)}${mine ? ' (you)' : ''}</b>${message.is_teacher ? '<span class="ch-chip navy">Teacher</span>' : ''}<time>${escapeHtml(formatClock(message.timestamp))}</time>
        ${deletable ? `<button class="ch-icon-btn danger" type="button" data-act="delete-message" data-id="${message.id}" title="Delete message" aria-label="Delete message"><span class="material-symbols-outlined">delete</span></button>` : ''}</div>
      <div class="ch-msg-text">${linkify(message.content)}</div>
    </div>
  </div>`;
}

function renderMessages(keepScroll) {
  const box = el('chatMessages');
  const state = roomState(chat.room);
  const fromBottom = box.scrollHeight - box.scrollTop;
  if (!state.loaded) {
    box.innerHTML = '<div class="skeleton" style="height:48px;margin-bottom:10px"></div><div class="skeleton" style="height:48px;width:70%"></div>';
    return;
  }
  if (!state.messages.length) {
    box.innerHTML = `<div class="ch-empty" style="border:0;background:none">${icon('forum')}<h3>No messages yet</h3><p>Say hello, ask about an activity, or look for a group.</p></div>`;
    return;
  }
  let lastDay = '';
  box.innerHTML = (state.hasMore ? '<div style="text-align:center;margin-bottom:8px"><button class="ch-btn line small" type="button" data-act="older">Load older messages</button></div>' : '')
    + state.messages.map(message => {
      const day = formatDay(message.timestamp);
      const separator = day !== lastDay ? `<div class="ch-day">${escapeHtml(day)}</div>` : '';
      lastDay = day;
      return separator + messageHtml(message);
    }).join('');
  box.scrollTop = keepScroll ? box.scrollHeight - fromBottom : box.scrollHeight;
}

async function openRoom(key) {
  chat.room = key;
  delete chat.unread[key];
  renderChat();
  renderChatUnread();
  const state = roomState(key);
  if (state.loaded || state.loading) return;
  state.loading = true;
  try {
    const data = await api(`/api/college-hub/chat?room=${encodeURIComponent(key)}`);
    // Messages that arrived live while this was loading are kept
    const have = new Set(data.messages.map(message => message.id));
    state.messages = [...data.messages, ...state.messages.filter(message => !have.has(message.id))];
    state.hasMore = data.has_more;
    state.loaded = true;
  } catch (err) {
    showToast(err.message);
  }
  state.loading = false;
  if (chat.room === key && view.tab === 'chat') renderMessages();
}

async function loadOlderMessages() {
  const state = roomState(chat.room);
  if (state.loading || !state.messages.length) return;
  state.loading = true;
  try {
    const data = await api(`/api/college-hub/chat?room=${encodeURIComponent(chat.room)}&before_id=${state.messages[0].id}`);
    state.messages = [...data.messages, ...state.messages];
    state.hasMore = data.has_more;
    renderMessages(true);
  } catch (err) {
    showToast(err.message);
  }
  state.loading = false;
}

async function sendChatMessage() {
  const input = el('chatInput');
  const content = input.value.trim();
  if (!content) return;
  const button = el('chatSend');
  button.disabled = true;
  try {
    const saved = await api('/api/college-hub/chat', { method: 'POST', body: { room: chat.room, content } });
    input.value = '';
    input.style.height = '';
    addChatMessage(saved);
  } catch (err) {
    showToast(err.message);
  }
  button.disabled = false;
  input.focus();
}

// A message from the server: our own coming back from the send, or anyone's arriving live
function addChatMessage(message) {
  const state = roomState(message.room);
  if (state.messages.some(have => have.id === message.id)) return;
  state.messages.push(message);
  const onScreen = view.tab === 'chat' && chat.room === message.room && !document.hidden;
  if (onScreen) {
    const box = el('chatMessages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    renderMessages(!nearBottom && message.sender_id !== hub.me.id);
  } else if (message.sender_id !== hub.me.id) {
    chat.unread[message.room] = (chat.unread[message.room] || 0) + 1;
    if (view.tab === 'chat') renderChat();
    renderChatUnread();
  }
}

async function deleteChatMessage(id) {
  try {
    await api(`/api/college-hub/chat/${id}`, { method: 'DELETE' });
    const state = roomState(chat.room);
    state.messages = state.messages.filter(message => message.id !== id);
    renderMessages(true);
  } catch (err) {
    showToast(err.message);
  }
}

function renderChatUnread() {
  const total = Object.values(chat.unread).reduce((sum, count) => sum + count, 0);
  el('chatUnread').textContent = total > 99 ? '99+' : total;
  el('chatUnread').classList.toggle('ch-hidden', total === 0);
}

// ==========================================
// 8. LIVE UPDATES
// ==========================================
function handleHubEvent(data) {
  if (!hub || !isMember()) {
    if (data.type === 'college_hub_changed') queueHubReload();   // teacher access may just have been given
    return;
  }
  if (data.type === 'college_hub_changed') return queueHubReload();
  if (data.type === 'college_chat' && data.message) return addChatMessage(data.message);
  if (data.type === 'college_poll') return applyPollEvent(data);
  if (data.type === 'college_ack') return applyAckEvent(data);
  if (data.type === 'college_qa_changed') return applyQaEvent();
  if (data.type === 'college_resources_changed') { if (learn.resources) loadResources(); return; }
  if (data.type === 'college_chat_deleted') {
    const state = roomState(data.room);
    state.messages = state.messages.filter(message => message.id !== data.id);
    if (view.tab === 'chat' && chat.room === data.room) renderMessages(true);
  }
}

// ==========================================
// 9. THE POP-UP AND THE STUDENT PICKER
// ==========================================
function openHubModal({ title, body, confirmText, onConfirm, onOpen, wide }) {
  el('hubModalTitle').textContent = title;
  el('hubModalBody').onclick = null;
  el('hubModalBody').innerHTML = body;
  el('hubModal').querySelector('.ch-modal').classList.toggle('ch-modal-wide', Boolean(wide));
  el('hubModalConfirm').textContent = confirmText || 'Save';
  el('hubModalConfirm').disabled = false;
  showModalError('');
  modalSubmit = onConfirm;
  el('hubModal').classList.add('active');
  if (onOpen) onOpen();
  const first = el('hubModalBody').querySelector('input:not([type=checkbox]), textarea, select');
  if (first) first.focus();
}

function closeHubModal() {
  el('hubModal').classList.remove('active');
  modalSubmit = null;
  picker = null;
}

function showModalError(message) {
  el('hubModalError').textContent = message;
  el('hubModalError').classList.toggle('ch-hidden', !message);
}

async function submitHubModal() {
  if (!modalSubmit) return;
  const button = el('hubModalConfirm');
  button.disabled = true;
  showModalError('');
  try {
    await modalSubmit();
    closeHubModal();
    await loadHub();
  } catch (err) {
    showModalError(err.message);
    button.disabled = false;
  }
}

// A list of students with tick boxes. taken maps a student id to the reason they cannot be picked.
// limit is how many may be ticked; fixed is how many places are already used (the creator, current members).
function pickerHtml(note) {
  return `<div><span class="ch-field-label">Students <small>${escapeHtml(note)}</small></span>
    <div class="ch-picker" style="margin-top:5px">
      <div class="ch-picker-tools">
        <input class="ch-input" id="pickSearch" type="search" placeholder="Search a name" aria-label="Search students">
        <select class="ch-select" id="pickDept" aria-label="Department"><option value="">All departments</option>${optionsOf('department', picker.dept, picker.pool)}</select>
        <select class="ch-select" id="pickDivision" aria-label="Division"><option value="">All divisions</option>${optionsOf('division', picker.division, picker.pool)}</select>
      </div>
      <div class="ch-picker-list" id="pickList"></div>
      <div class="ch-picker-foot" id="pickFoot"></div>
    </div></div>`;
}

function startPicker({ pool, taken, limit, fixed, dept, division }) {
  picker = { pool, taken: taken || new Map(), limit, fixed: fixed || 0, dept: dept || '', division: division || '', query: '', chosen: new Set() };
}

function renderPicker() {
  const query = norm(picker.query);
  const list = picker.pool.filter(person =>
    (!picker.dept || norm(person.department) === picker.dept) &&
    (!picker.division || norm(person.division) === picker.division) &&
    (!query || norm(person.name).includes(query)));
  const room = picker.limit - picker.fixed - picker.chosen.size;
  el('pickList').innerHTML = list.length ? list.map(person => {
    const reason = picker.taken.get(person.id);
    const ticked = picker.chosen.has(person.id);
    const off = Boolean(reason) || (!ticked && room <= 0);
    return `<label class="ch-pick${off ? ' is-off' : ''}">
      <input type="checkbox" value="${person.id}" ${ticked ? 'checked' : ''} ${off ? 'disabled' : ''}>
      ${avatarOf(person)}
      <span class="ch-pick-name">${escapeHtml(person.name)}<small>${escapeHtml(reason || classLabel(person))}</small></span>
    </label>`;
  }).join('') : '<p class="ch-picker-foot" style="border:0">No students match.</p>';
  el('pickFoot').textContent = `${picker.fixed + picker.chosen.size} of ${picker.limit} places used`;
}

function bindPicker() {
  el('pickSearch').addEventListener('input', (e) => { picker.query = e.target.value; renderPicker(); });
  el('pickDept').addEventListener('change', (e) => { picker.dept = e.target.value; renderPicker(); });
  el('pickDivision').addEventListener('change', (e) => { picker.division = e.target.value; renderPicker(); });
  el('pickList').addEventListener('change', (e) => {
    const id = Number(e.target.value);
    if (e.target.checked) picker.chosen.add(id); else picker.chosen.delete(id);
    renderPicker();
  });
  renderPicker();
}

// Who may be picked for a group of this activity, and who is already placed
function pickerSetup(activity, fixed) {
  const pool = (activity ? audienceOf(activity) : students()).filter(person => person.id !== hub.me.id || isTeacher());
  const taken = new Map();
  if (activity) groupByStudent(activity.id).forEach((group, id) => taken.set(id, `Already in ${group.name}`));
  // A student starts on their own class; a teacher on the class the activity is for
  const dept = isTeacher() ? norm(activity && activity.department) : norm(hub.me.department);
  const division = isTeacher() ? norm(activity && activity.division) : norm(hub.me.division);
  const inPool = (field, value) => value && pool.some(person => norm(person[field]) === value);
  startPicker({ pool, taken, limit: sizeLimit(activity), fixed, dept: inPool('department', dept) ? dept : '', division: inPool('division', division) ? division : '' });
}

// ==========================================
// 10. FORMS
// ==========================================
function openPostForm(post) {
  const editing = Boolean(post);
  let kind = editing ? post.kind : 'notice';
  const value = (field, fallback) => escapeHtml(editing ? post[field] : fallback);
  const divisionOptions = (dept) => optionsOf('division', editing ? norm(post.division) : '', students().filter(person => norm(person.department) === dept));
  const pollOptions = editing ? post.poll_options || [] : [];
  const pollLocked = editing && post.poll_total > 0;
  openHubModal({
    title: editing ? 'Edit post' : 'New post',
    confirmText: editing ? 'Save changes' : 'Post',
    body: `
      <div class="ch-seg" id="postKind">
        <button type="button" data-kind="notice" aria-pressed="${kind === 'notice'}" ${editing ? 'disabled' : ''}>Notice</button>
        <button type="button" data-kind="activity" aria-pressed="${kind === 'activity'}" ${editing ? 'disabled' : ''}>Activity with groups</button>
      </div>
      <label>Title<input class="ch-input" id="postTitle" maxlength="120" value="${value('title', '')}" placeholder="For example: Seminar presentations, semester 5"></label>
      <label>Details<textarea class="ch-textarea" id="postBody" maxlength="4000" placeholder="What students need to know: how to form groups, what to prepare, where to submit.">${value('body', '')}</textarea></label>
      <div class="ch-row2">
        <label>For<select class="ch-select" id="postDept"><option value="">Whole college</option>${optionsOf('department', editing ? norm(post.department) : '')}</select></label>
        <label>Division<select class="ch-select" id="postDivision"><option value="">All divisions</option>${editing && post.department ? divisionOptions(norm(post.department)) : ''}</select></label>
      </div>
      <div id="postActivity" class="ch-form ${kind === 'activity' ? '' : 'ch-hidden'}">
        <div class="ch-row3">
          <label>Smallest group<input class="ch-input" id="postMin" type="number" min="1" max="50" value="${editing ? post.group_min : 2}"></label>
          <label>Largest group<input class="ch-input" id="postMax" type="number" min="1" max="50" value="${editing ? post.group_max : 5}"></label>
          <label>Form groups by <small>(optional)</small><input class="ch-input" id="postDeadline" type="date" value="${value('deadline', '')}"></label>
        </div>
        <label>Topics <small>(optional, one per line; each can be taken by one group)</small><textarea class="ch-textarea" id="postTopics" placeholder="Renewable energy&#10;Smart cities&#10;Water management">${escapeHtml(editing ? post.topics.join('\n') : '')}</textarea></label>
        <label class="ch-check"><input type="checkbox" id="postWork" ${editing && post.accepts_work ? 'checked' : ''}>Groups hand in their work here</label>
        <div id="postWorkFields" class="ch-row2 ${editing && post.accepts_work ? '' : 'ch-hidden'}">
          <label>Hand in by <small>(optional)</small><input class="ch-input" id="postSubmitBy" type="date" value="${value('submit_by', '')}"></label>
          <label>Marks out of <small>(0 = feedback only)</small><input class="ch-input" id="postMarks" type="number" min="0" max="1000" value="${editing ? post.max_marks : 10}"></label>
        </div>
        <label class="ch-check"><input type="checkbox" id="postCheckins" ${editing && post.weekly_checkins ? 'checked' : ''}>Groups write a short check-in every week</label>
        <label>Who forms the groups<select class="ch-select" id="postWho">
          <option value="students" ${!editing ? (hub.settings.students_can_form_groups ? 'selected' : '') : (post.students_form_groups ? 'selected' : '')}>Students form their own groups</option>
          <option value="teachers" ${!editing ? (hub.settings.students_can_form_groups ? '' : 'selected') : (post.students_form_groups ? '' : 'selected')}>Teachers form the groups</option>
        </select></label>
      </div>
      <label class="ch-check"><input type="checkbox" id="postPoll" ${pollOptions.length ? 'checked' : ''} ${pollLocked ? 'disabled' : ''}>Add a poll</label>
      <div id="postPollFields" class="ch-form ${pollOptions.length ? '' : 'ch-hidden'}">
        <label>Choices <small>(one per line, 2 to 10)</small><textarea class="ch-textarea" id="postPollOptions" ${pollLocked ? 'disabled' : ''} placeholder="Monday&#10;Wednesday&#10;Friday">${escapeHtml(pollOptions.join('\n'))}</textarea></label>
        <label class="ch-check"><input type="checkbox" id="postPollMulti" ${editing && post.poll_multi ? 'checked' : ''} ${pollLocked ? 'disabled' : ''}>Students may pick more than one</label>
        ${pollLocked ? '<p class="ch-muted">Students have already voted, so the choices stay as they are.</p>' : ''}
      </div>
      <label class="ch-check"><input type="checkbox" id="postAck" ${editing && post.needs_ack ? 'checked' : ''}>Ask students to confirm they have read it</label>
      <label class="ch-check"><input type="checkbox" id="postPinned" ${editing && post.pinned ? 'checked' : ''}>Pin to the top of the board</label>`,
    onOpen: () => {
      el('postKind').addEventListener('click', (e) => {
        const button = e.target.closest('[data-kind]');
        if (!button || button.disabled) return;
        kind = button.dataset.kind;
        el('postKind').querySelectorAll('button').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        el('postActivity').classList.toggle('ch-hidden', kind !== 'activity');
      });
      el('postDept').addEventListener('change', (e) => {
        el('postDivision').innerHTML = '<option value="">All divisions</option>' + (e.target.value ? divisionOptions(e.target.value) : '');
      });
      el('postPoll').addEventListener('change', (e) => el('postPollFields').classList.toggle('ch-hidden', !e.target.checked));
      el('postWork').addEventListener('change', (e) => el('postWorkFields').classList.toggle('ch-hidden', !e.target.checked));
    },
    onConfirm: async () => {
      const labelOf = (select) => (select.value ? select.options[select.selectedIndex].textContent : '');
      const body = {
        kind, title: el('postTitle').value, body: el('postBody').value,
        department: labelOf(el('postDept')), division: labelOf(el('postDivision')), pinned: el('postPinned').checked,
        group_min: Number(el('postMin').value) || 1, group_max: Number(el('postMax').value) || 1,
        deadline: el('postDeadline').value, topics: el('postTopics').value.split('\n').map(line => line.trim()).filter(Boolean),
        students_form_groups: el('postWho').value === 'students',
        poll_options: pollLocked ? pollOptions : (el('postPoll').checked ? el('postPollOptions').value.split('\n').map(line => line.trim()).filter(Boolean) : []),
        poll_multi: pollLocked ? post.poll_multi : el('postPollMulti').checked,
        needs_ack: el('postAck').checked,
        accepts_work: el('postWork').checked, submit_by: el('postSubmitBy').value, max_marks: Number(el('postMarks').value) || 0,
        weekly_checkins: el('postCheckins').checked
      };
      if (!body.title.trim()) throw new Error('Give the post a title.');
      if (el('postPoll').checked && !pollLocked && body.poll_options.length < 2) throw new Error('A poll needs at least two choices, one per line.');
      if (editing) await api(`/api/college-hub/posts/${post.id}`, { method: 'PUT', body });
      else await api('/api/college-hub/posts', { method: 'POST', body });
      showToast(editing ? 'Post updated.' : 'Posted to the board.');
    }
  });
}

function topicField(activity, current, ownGroupId) {
  if (!activity || !activity.topics.length) {
    return `<label>Topic <small>(optional)</small><input class="ch-input" id="groupTopic" maxlength="80" value="${escapeHtml(current || '')}" placeholder="What the group will work on"></label>`;
  }
  const taken = new Set(groupsOf(activity.id).filter(group => group.id !== ownGroupId).map(group => norm(group.topic)).filter(Boolean));
  return `<label>Topic<select class="ch-select" id="groupTopic"><option value="">Decide later</option>${activity.topics.map(topic =>
    `<option value="${escapeHtml(topic)}" ${norm(topic) === norm(current) ? 'selected' : ''} ${taken.has(norm(topic)) ? 'disabled' : ''}>${escapeHtml(topic)}${taken.has(norm(topic)) ? ' (taken)' : ''}</option>`).join('')}</select></label>`;
}

function openGroupForm(activityId) {
  const teacher = isTeacher();
  let activity = activityId ? activityById(activityId) : null;
  // A student in a class with open activities usually means one of those: offer the choice
  const choices = teacher ? activities() : activities().filter(post => !studentRule(post) && !groupByStudent(post.id).has(hub.me.id) && audienceOf(post).some(person => person.id === hub.me.id));
  const generalAllowed = teacher || !studentRule(null);
  if (!activity && !generalAllowed && choices.length) activity = choices[0];

  const draw = () => {
    pickerSetup(activity, teacher ? 0 : 1);
    const number = groupsOf(activity ? activity.id : null).length + 1;
    openHubModal({
      title: teacher ? 'Create a group' : 'Form a group',
      confirmText: 'Create group',
      body: `
        <label>For<select class="ch-select" id="groupFor">
          ${generalAllowed ? `<option value="" ${activity ? '' : 'selected'}>No activity: a general group</option>` : ''}
          ${choices.map(post => `<option value="${post.id}" ${activity && activity.id === post.id ? 'selected' : ''}>${escapeHtml(post.title)}</option>`).join('')}
        </select></label>
        <label>Group name<input class="ch-input" id="groupName" maxlength="80" value="Group ${number}"></label>
        ${topicField(activity, '', null)}
        ${pickerHtml(teacher ? `(up to ${sizeLimit(activity)})` : `(you are in it; up to ${sizeLimit(activity)} with you)`)}
        ${teacher ? '' : '<label class="ch-check"><input type="checkbox" id="groupOpen">Let other students join until it is full</label>'}`,
      onOpen: () => {
        bindPicker();
        el('groupFor').addEventListener('change', (e) => { activity = e.target.value ? activityById(e.target.value) : null; draw(); });
      },
      onConfirm: async () => {
        const name = el('groupName').value.trim();
        if (!name) throw new Error('Give the group a name.');
        if (teacher && !picker.chosen.size) throw new Error('Pick at least one student.');
        await api('/api/college-hub/groups', { method: 'POST', body: {
          name, topic: el('groupTopic').value, activity_id: activity ? activity.id : null,
          member_ids: [...picker.chosen], open_to_join: !teacher && el('groupOpen').checked
        } });
        showToast('Group created. Its chat is under My Teams.');
        view.tab = 'groups';
        view.activity = activity ? String(activity.id) : 'none';
        writeUrl();
      }
    });
  };
  if (!teacher && !generalAllowed && !choices.length) return showToast(studentRule(null));
  draw();
}

function openAddMembers(group) {
  const activity = group.activity_id ? activityById(group.activity_id) : null;
  const inGroup = new Set(studentIdsOf(group));
  pickerSetup(activity, inGroup.size);
  picker.pool = picker.pool.filter(person => !inGroup.has(person.id));
  openHubModal({
    title: `Add students to ${group.name}`,
    confirmText: 'Add',
    body: pickerHtml(`(${inGroup.size} in the group now)`),
    onOpen: bindPicker,
    onConfirm: async () => {
      if (!picker.chosen.size) throw new Error('Pick at least one student.');
      for (const id of picker.chosen) {
        await api(`/api/college-hub/groups/${group.id}/members`, { method: 'POST', body: { user_id: id } });
      }
      showToast(`${plural(picker.chosen.size, 'student', 'students')} added.`);
    }
  });
}

function openEditGroup(group) {
  const activity = group.activity_id ? activityById(group.activity_id) : null;
  openHubModal({
    title: 'Edit group',
    confirmText: 'Save changes',
    body: `
      <label>Group name<input class="ch-input" id="groupName" maxlength="80" value="${escapeHtml(group.name)}"></label>
      ${topicField(activity, group.topic, group.id)}
      ${group.teacher_managed ? '' : `<label class="ch-check"><input type="checkbox" id="groupOpen" ${group.open_to_join ? 'checked' : ''}>Let other students join until it is full</label>`}`,
    onConfirm: async () => {
      const name = el('groupName').value.trim();
      if (!name) throw new Error('Give the group a name.');
      const body = { name, topic: el('groupTopic').value };
      if (el('groupOpen')) body.open_to_join = el('groupOpen').checked;
      await api(`/api/college-hub/groups/${group.id}`, { method: 'PUT', body });
      showToast('Group updated.');
    }
  });
}

// Spread people over as few groups as the size allows, as evenly as possible
function splitIntoGroups(people, size) {
  const count = Math.ceil(people.length / size);
  const groups = Array.from({ length: count }, () => []);
  people.forEach((person, n) => groups[n % count].push(person));
  return groups;
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function openAutofill(activity) {
  let plan = [];
  const first = groupsOf(activity.id).length + 1;
  const draw = () => {
    plan = splitIntoGroups(shuffled(unassignedOf(activity)), activity.group_max);
    el('autofillPreview').innerHTML = plan.map((group, n) =>
      `<div><b>Group ${first + n} · ${group.length}</b>${group.map(person => `<span>${escapeHtml(person.name)}</span>`).join('')}</div>`).join('');
  };
  openHubModal({
    title: `Auto-fill: ${activity.title}`,
    confirmText: 'Create these groups',
    body: `<p style="margin:0;font-size:14px;color:#475569">The students who have no group yet are placed at random into groups of up to ${activity.group_max}. The groups are locked, so only teachers can change them afterwards. Nothing is created until you confirm.</p>
      <div class="ch-preview" id="autofillPreview"></div>
      <button class="ch-btn line small" type="button" id="autofillShuffle" style="justify-self:start">${icon('shuffle')}Shuffle again</button>`,
    onOpen: () => {
      draw();
      el('autofillShuffle').addEventListener('click', draw);
    },
    onConfirm: async () => {
      const result = await api(`/api/college-hub/activities/${activity.id}/autofill`, { method: 'POST', body: { groups: plan.map(group => group.map(person => person.id)) } });
      showToast(`${plural(result.created, 'group', 'groups')} created.`);
    }
  });
}

// The roster of an activity as a file a spreadsheet opens
function downloadRoster(activity) {
  const placed = groupByStudent(activity.id);
  const cell = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
  const rows = [['Name', 'Department', 'Division', 'Group', 'Topic']].concat(
    audienceOf(activity).map(person => {
      const group = placed.get(person.id);
      return [person.name, person.department, person.division, group ? group.name : '', group ? group.topic : ''];
    }).sort((a, b) => a[3].localeCompare(b[3]) || a[0].localeCompare(b[0])));
  const file = new Blob(['﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = `${activity.title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'activity'}-roster.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  window.__lastRosterCsv = rows;   // lets a check read what was written without opening the file
}

// ==========================================
// 11. ACTIONS
// ==========================================

// Runs a change, says so, and fetches the hub again. Problems are shown as a toast.
async function run(request, doneMessage) {
  try {
    const result = await request();
    if (doneMessage) showToast(typeof doneMessage === 'function' ? doneMessage(result) : doneMessage);
    await loadHub();
  } catch (err) {
    showToast(err.message);
  }
}

const confirmThen = (title, text, button, action) => window.showSystemModal(title, escapeHtml(text), 'confirm', action, button);

function onHubClick(e) {
  const tab = e.target.closest('[data-tab]');
  if (tab) return setTab(tab.dataset.tab);
  const room = e.target.closest('[data-room]');
  if (room) return openRoom(room.dataset.room);

  const button = e.target.closest('[data-act]');
  if (!button) return;
  const act = button.dataset.act;
  if (hubActions[act]) return hubActions[act](button);
  const post = button.dataset.id ? hub.posts.find(item => item.id === Number(button.dataset.id)) : null;
  const group = button.dataset.group ? hub.groups.find(item => item.id === Number(button.dataset.group)) : null;

  if (act === 'retry') { renderLoading(); return loadHub(); }
  if (act === 'request-teacher') return requestTeacherAccess();
  if (act === 'new-post') return openPostForm(null);
  if (act === 'edit-post' && post) return openPostForm(post);
  if (act === 'pin-post' && post) return run(() => api(`/api/college-hub/posts/${post.id}`, { method: 'PUT', body: { ...post, pinned: !post.pinned } }), post.pinned ? 'Unpinned.' : 'Pinned to the top.');
  if (act === 'delete-post' && post) {
    return confirmThen('Delete this post?', post.kind === 'activity' ? 'The activity is removed from the board, with any work handed in for it. Its groups are kept, as groups of no activity.' : 'The notice is removed from the board, with its poll votes.', 'Delete',
      () => run(() => api(`/api/college-hub/posts/${post.id}`, { method: 'DELETE' }), 'Post deleted.'));
  }
  if (act === 'toggle-switch') {
    const next = !hub.settings.students_can_form_groups;
    return run(() => api('/api/college-hub/settings', { method: 'PUT', body: { students_can_form_groups: next } }), next ? 'Students can form their own groups.' : 'Only teachers form groups now.');
  }
  if (act === 'see-groups' && post) { view.activity = String(post.id); view.mine = false; return setTab('groups'); }
  if (act === 'new-group') return openGroupForm(button.dataset.activity ? Number(button.dataset.activity) : null);
  if (act === 'autofill' && post) return openAutofill(post);
  if (act === 'remind' && post) return run(() => api(`/api/college-hub/activities/${post.id}/remind`, { method: 'POST' }), (result) => `Reminder sent to ${plural(result.reminded, 'student', 'students')}.`);
  if (act === 'roster-csv' && post) return downloadRoster(post);
  if (act === 'toggle-mine') { view.mine = !view.mine; return renderGroups(); }
  if (act === 'toggle-free') { view.rosterFree = !view.rosterFree; return renderStudents(); }
  if (act === 'older') return loadOlderMessages();
  if (act === 'delete-message') return deleteChatMessage(Number(button.dataset.id));

  if (!group) return;
  if (act === 'add-members') return openAddMembers(group);
  if (act === 'edit-group') return openEditGroup(group);
  if (act === 'join-group') return run(() => api(`/api/college-hub/groups/${group.id}/members`, { method: 'POST', body: { user_id: hub.me.id } }), `You joined ${group.name}.`);
  if (act === 'leave-group') {
    return confirmThen(`Leave ${group.name}?`, 'You will no longer see its chat or task board.', 'Leave',
      () => run(() => api(`/api/college-hub/groups/${group.id}/members/${hub.me.id}`, { method: 'DELETE' }), `You left ${group.name}.`));
  }
  if (act === 'remove-member') {
    const userId = Number(button.dataset.user);
    return confirmThen(`Remove ${nameOf(userId)}?`, `${nameOf(userId)} will be taken out of ${group.name}.`, 'Remove',
      () => run(() => api(`/api/college-hub/groups/${group.id}/members/${userId}`, { method: 'DELETE' }), `${nameOf(userId)} removed.`));
  }
  if (act === 'lock-group') {
    return run(() => api(`/api/college-hub/groups/${group.id}`, { method: 'PUT', body: { teacher_managed: !group.teacher_managed } }),
      group.teacher_managed ? 'Unlocked. The students in it can change it again.' : 'Locked. Only teachers can change it now.');
  }
  if (act === 'delete-group') {
    return confirmThen(`Delete ${group.name}?`, 'The group, its chat and its task board are deleted for everyone in it.', 'Delete',
      () => run(() => api(`/api/college-hub/groups/${group.id}`, { method: 'DELETE' }), 'Group deleted.'));
  }
}

function onHubChange(e) {
  const target = e.target;
  if (hubChangeHandlers.some(handler => handler(target))) return;
  if (target.id === 'groupActivity') { view.activity = target.value; writeUrl(); return renderGroups(); }
  if (target.id === 'groupDept') { view.dept = target.value; return renderGroups(); }
  if (target.id === 'groupDivision') { view.division = target.value; return renderGroups(); }
  if (target.id === 'rosterActivity') { view.rosterActivity = target.value; view.rosterFree = false; return renderStudents(); }
  if (target.id === 'chatRoomSelect') return openRoom(target.value);
  // A teacher moving a student from a group card
  if (target.dataset.move && target.value) {
    const userId = Number(target.dataset.move), to = Number(target.value);
    return run(() => api(`/api/college-hub/groups/${target.dataset.group}/move`, { method: 'POST', body: { user_id: userId, to_group_id: to } }), `${nameOf(userId)} moved.`);
  }
  // A teacher placing or moving a student from the Students tab
  if (target.dataset.place && target.value) {
    const userId = Number(target.dataset.place), to = Number(target.value);
    if (target.dataset.from) {
      return run(() => api(`/api/college-hub/groups/${target.dataset.from}/move`, { method: 'POST', body: { user_id: userId, to_group_id: to } }), `${nameOf(userId)} moved.`);
    }
    return run(() => api(`/api/college-hub/groups/${to}/members`, { method: 'POST', body: { user_id: userId } }), `${nameOf(userId)} placed.`);
  }
}

async function requestTeacherAccess() {
  const error = el('teacherError');
  error.classList.add('ch-hidden');
  try {
    await api('/api/college-hub/teacher-request', { method: 'POST', body: { note: el('teacherNote').value } });
    showToast('Request sent. An admin will look at it.');
    await loadHub();
  } catch (err) {
    error.textContent = err.message;
    error.classList.remove('ch-hidden');
  }
}

function bindHub() {
  document.querySelector('main').addEventListener('click', onHubClick);
  document.querySelector('main').addEventListener('change', onHubChange);
  bindLearn();
  el('studentBar').addEventListener('input', (e) => {
    if (e.target.id !== 'rosterSearch') return;
    view.rosterQuery = e.target.value;
    renderStudents();
    const box = el('rosterSearch');   // the bar was redrawn: put the cursor back where it was
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  });

  el('chatForm').addEventListener('submit', (e) => { e.preventDefault(); sendChatMessage(); });
  el('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
  el('chatInput').addEventListener('input', (e) => {
    e.target.style.height = '';
    e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
  });

  el('hubModalCancel').addEventListener('click', closeHubModal);
  el('hubModalConfirm').addEventListener('click', submitHubModal);
  el('hubModal').addEventListener('click', (e) => { if (e.target === el('hubModal')) closeHubModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el('hubModal').classList.contains('active')) closeHubModal(); });
}

initHub();
