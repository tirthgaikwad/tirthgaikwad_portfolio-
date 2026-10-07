// ==========================================
// TEAM.JS — Workspaces, channels, messages, reactions, pins, resources, members
// Loaded after shared.js and chat-common.js (api, caches, message rendering, uploads, emoji).
// Voice rooms and group calls live in team-calls.js.
// ==========================================

let teams = [];
let activeTeamId = null;
let activeChannelId = null;
const workspaces = {};             // teamId -> { team, role, members, channels, resources }
const channelThreads = {};         // channelId -> { messages, hasMore, loaded, loading, loadingOlder, error }
let lastSeen = {};                 // channelId -> id of the newest message this person has looked at
let openTicket = 0;                // increases on every team switch so slow responses for an old team are ignored

// Real-time connection for the open workspace
let teamSocket = null;
let teamSocketTeamId = null;
let teamSocketRetry = 1000;
let teamSocketWasOpen = false;

// Composer state
let replyTarget = null;            // message being replied to
let typingSentAt = 0;
const typingByChannel = {};        // channelId -> { userId: { name, timer } }
let memoRecorder = null;
let memoChunks = [];
let memoSeconds = 0;
let memoTimer = null;
let memoCancelled = false;

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '🔥', '👀'];
const AVATAR_COLORS = ['bg-brand-700', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600'];

// ==========================================
// 1. SMALL HELPERS
// ==========================================
function show(node, display) {
  node.classList.remove('hidden');
  if (display) node.classList.add(display);
}

function hide(node, display) {
  node.classList.add('hidden');
  if (display) node.classList.remove(display);
}

function workspace() {
  return workspaces[activeTeamId] || null;
}

function isAdmin() {
  const ws = workspace();
  return !!ws && ws.role === 'Admin';
}

function isCreator() {
  const ws = workspace();
  return !!ws && ws.team.created_by === currentUserId;
}

function activeChannel() {
  const ws = workspace();
  return ws ? ws.channels.find(c => c.id === activeChannelId) || null : null;
}

function memberOf(userId) {
  const ws = workspace();
  return ws ? ws.members.find(m => m.user_id === userId) || null : null;
}

function myName() {
  const me = memberOf(currentUserId);
  return (me && me.user_name) || (window.currentUserProfile && window.currentUserProfile.name) || 'You';
}

function myPicture() {
  const me = memberOf(currentUserId);
  return (me && me.user_profile_pic) || (window.currentUserProfile && window.currentUserProfile.profile_pic) || '';
}

function personAvatar(userId, name, picture, sizeClass, textClass) {
  if (picture) {
    return `<img src="${escapeHtml(picture)}" class="${sizeClass} rounded-full object-cover flex-none" alt="${escapeHtml(name || '')}">`;
  }
  const color = AVATAR_COLORS[(userId || 0) % AVATAR_COLORS.length];
  return `<div class="${sizeClass} rounded-full ${color} text-white font-bold ${textClass} flex items-center justify-center flex-none">${escapeHtml(getInitials(name || '?'))}</div>`;
}

function confirmAction(title, message, confirmText, action) {
  window.showSystemModal(title, message, 'confirm', async () => {
    try {
      await action();
    } catch (err) {
      showToast(err.message);
    }
  }, confirmText);
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function openDrawer() { document.body.classList.add('drawer-open'); }
function closeDrawer() { document.body.classList.remove('drawer-open'); }

// ==========================================
// 2. INITIALIZATION
// ==========================================
async function initTeams() {
  loadSettings();
  initEmojiPicker();
  initTeamComposer();
  lastSeen = cacheGet('team-seen') || {};

  el('messages-feed').addEventListener('scroll', () => {
    if (el('messages-feed').scrollTop < 80) loadOlderTeamMessages();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#team-menu') && !e.target.closest('#team-menu-button')) el('team-menu').classList.add('hidden');
    // Tapping a message shows its actions (for touch screens); tapping elsewhere hides them again
    const tappedRow = e.target.closest('.msg-row');
    document.querySelectorAll('.msg-row.show-actions').forEach(r => { if (r !== tappedRow) r.classList.remove('show-actions'); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModals();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearchModal();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeChannelId) markChannelSeen(activeChannelId);
  });

  // 1. Draw what we knew last time straight away
  teams = cacheGet('teams') || [];
  renderRail();
  const rememberedTeam = cacheGet('team-last');
  const firstTeam = teams.find(t => t.id === rememberedTeam) || teams[0];
  if (firstTeam) openTeam(firstTeam.id);
  else if (!window.__teamsPrefetch) showEmptyState();

  // 2. Then the real list (already requested from the page head)
  await refreshTeams();
  if (teams.length === 0) {
    showEmptyState();
  } else if (!teams.some(t => t.id === activeTeamId)) {
    openTeam(teams[0].id);
  }
}

async function refreshTeams() {
  try {
    const prefetched = window.__teamsPrefetch ? await window.__teamsPrefetch : null;
    window.__teamsPrefetch = null;
    teams = prefetched || await api('/api/teams');
    cacheSet('teams', teams);
    renderRail();
  } catch (err) {
    if (teams.length === 0) showToast(err.message);
  }
}

function showEmptyState() {
  activeTeamId = null;
  activeChannelId = null;
  closeTeamSocket();
  document.body.classList.remove('is-admin');
  hide(el('channels-sidebar'), 'flex');
  hide(el('chat-area'), 'flex');
  hide(el('members-sidebar'), 'flex');
  show(el('empty-state'), 'flex');
}

// ==========================================
// 3. TEAMS RAIL
// ==========================================
function renderRail() {
  el('teams-list').innerHTML = teams.map(team => {
    const isActive = team.id === activeTeamId;
    return `
      <div class="relative group flex items-center justify-center w-full mt-2" data-team-id="${team.id}" onclick="openTeam(${team.id})">
        <div class="absolute left-0 w-1 ${isActive ? 'h-8 bg-brand-600' : 'h-0 group-hover:h-4 bg-slate-400'} rounded-r-md transition-all"></div>
        <button type="button" class="w-11 h-11 ${isActive ? 'rounded-2xl bg-brand-600 text-white shadow-md shadow-brand-500/30' : 'rounded-3xl group-hover:rounded-2xl bg-white text-slate-700 hover:bg-brand-50 border border-slate-200'} font-bold text-sm flex items-center justify-center transition-all duration-200 shadow-sm overflow-hidden" title="${escapeHtml(team.name)}">
          ${team.avatar_url ? `<img src="${escapeHtml(team.avatar_url)}" class="w-full h-full object-cover" alt="">` : escapeHtml(team.name.charAt(0).toUpperCase())}
        </button>
      </div>`;
  }).join('');
}

// ==========================================
// 4. OPENING A WORKSPACE
// ==========================================
async function openTeam(teamId) {
  if (activeTeamId === teamId && workspaces[teamId] && workspaces[teamId].fresh) return;
  const ticket = ++openTicket;
  const switching = activeTeamId !== teamId;
  activeTeamId = teamId;
  if (switching) {
    activeChannelId = null;
    cancelReply();
  }
  cacheSet('team-last', teamId);
  renderRail();
  hide(el('empty-state'), 'flex');
  show(el('channels-sidebar'), 'flex');

  // Last known state of this workspace, so the page is usable before the server answers
  if (!workspaces[teamId]) {
    const cached = cacheGet(`team-boot:${teamId}`);
    if (cached) workspaces[teamId] = Object.assign(cached, { fresh: false });
  }
  if (workspaces[teamId]) {
    renderWorkspace();
    if (!activeChannelId) openChannel(pickChannel(teamId), { quiet: true });
  } else {
    const team = teams.find(t => t.id === teamId);
    el('active-team-name').textContent = team ? team.name : 'Team';
    el('active-team-icon').textContent = team ? team.name.charAt(0).toUpperCase() : '⚡';
    el('team-member-count').textContent = 'Loading...';
    el('channels-list').innerHTML = '';
    el('voice-channels-list').innerHTML = '';
    hide(el('chat-area'), 'flex');
  }

  connectTeamSocket(teamId);

  let boot;
  try {
    boot = await api(`/api/teams/${teamId}/bootstrap`);
  } catch (err) {
    if (ticket !== openTicket) return;
    if (err.status === 403 || err.status === 404) {
      forgetTeam(teamId);
      showToast('You no longer have access to that workspace.');
    } else {
      showToast(err.message);
    }
    return;
  }
  workspaces[teamId] = { team: boot.team, role: boot.role, members: boot.members, channels: boot.channels, resources: boot.resources, fresh: true };
  cacheSet(`team-boot:${teamId}`, workspaces[teamId]);
  if (ticket !== openTicket) return;   // another team was opened while this one was loading

  onlineUserIds = new Set(boot.online_user_ids || []);
  if (typeof applyVoiceState === 'function') applyVoiceState(boot.voice || {});
  renderWorkspace();
  const stillThere = workspaces[teamId].channels.some(c => c.id === activeChannelId && c.channel_type !== 'voice');
  if (!stillThere) openChannel(pickChannel(teamId));
  else renderChannelHeader();
}

// The channel to show first: the one this person had open last, otherwise #general
function pickChannel(teamId) {
  const textChannels = workspaces[teamId].channels.filter(c => c.channel_type !== 'voice');
  const remembered = cacheGet(`team-channel:${teamId}`);
  const target = textChannels.find(c => c.id === remembered) || textChannels.find(c => c.name === 'general') || textChannels[0];
  return target ? target.id : null;
}

function renderWorkspace() {
  const ws = workspace();
  if (!ws) return;
  document.body.classList.toggle('is-admin', ws.role === 'Admin');
  el('active-team-name').textContent = ws.team.name;
  el('active-team-icon').textContent = ws.team.name.charAt(0).toUpperCase();
  el('team-member-count').textContent = `${ws.members.length} member${ws.members.length === 1 ? '' : 's'}`;
  renderChannels();
  renderMembers();
  renderResources();
}

function forgetTeam(teamId) {
  const ws = workspaces[teamId];
  if (ws) ws.channels.forEach(c => delete channelThreads[c.id]);
  delete workspaces[teamId];
  teams = teams.filter(t => t.id !== teamId);
  cacheSet('teams', teams);
  try { localStorage.removeItem(CACHE_PREFIX + `team-boot:${teamId}`); } catch (e) { /* ignore */ }
  if (typeof leaveVoiceIfIn === 'function') leaveVoiceIfIn(teamId);
  if (activeTeamId === teamId) {
    activeTeamId = null;
    activeChannelId = null;
    closeTeamSocket();
    hide(el('members-sidebar'), 'flex');
    if (teams.length) openTeam(teams[0].id);
    else showEmptyState();
  }
  renderRail();
}

// ==========================================
// 5. CHANNEL LIST
// ==========================================
function isUnread(channel) {
  return channel.channel_type !== 'voice' && channel.id !== activeChannelId && (channel.last_message_id || 0) > (lastSeen[channel.id] || 0);
}

function channelAdminButtons(channel) {
  if (!isAdmin()) return '';
  return `
    <span class="ml-auto hidden group-hover:flex items-center gap-0.5 flex-none">
      <button type="button" class="p-0.5 text-slate-400 hover:text-slate-700" title="Rename" onclick="event.stopPropagation(); openRenameChannel(${channel.id})"><span class="material-symbols-outlined text-[14px]">edit</span></button>
      <button type="button" class="p-0.5 text-slate-400 hover:text-rose-600" title="Delete" onclick="event.stopPropagation(); deleteChannel(${channel.id})"><span class="material-symbols-outlined text-[14px]">delete</span></button>
    </span>`;
}

function renderChannels() {
  const ws = workspace();
  if (!ws) return;

  el('channels-list').innerHTML = ws.channels.filter(c => c.channel_type !== 'voice').map(ch => {
    const isActive = ch.id === activeChannelId;
    const unread = isUnread(ch);
    return `
      <div data-channel-id="${ch.id}" onclick="openChannel(${ch.id})" class="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer mb-0.5 ${isActive ? 'bg-brand-100/70 text-brand-900 font-semibold border-l-2 border-brand-600' : (unread ? 'text-slate-900 font-bold hover:bg-slate-200/50' : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900')} transition-colors text-xs">
        <span class="text-slate-400 font-mono text-sm">#</span>
        <span class="truncate">${escapeHtml(ch.name)}</span>
        ${unread ? '<span class="unread-dot ml-auto group-hover:hidden" title="New messages"></span>' : ''}
        ${channelAdminButtons(ch)}
      </div>`;
  }).join('');

  if (typeof renderVoiceChannels === 'function') renderVoiceChannels();
}

function markChannelSeen(channelId) {
  const thread = channelThreads[channelId];
  const ws = workspace();
  const channel = ws ? ws.channels.find(c => c.id === channelId) : null;
  const newest = Math.max(
    channel ? channel.last_message_id || 0 : 0,
    thread ? thread.messages.reduce((max, m) => Math.max(max, m.id || 0), 0) : 0
  );
  if (newest > (lastSeen[channelId] || 0)) {
    lastSeen[channelId] = newest;
    cacheSet('team-seen', lastSeen);
  }
}

// ===== CREATE / RENAME / DELETE =====
let channelBeingRenamed = null;

function openChannelModal(type) {
  if (!activeTeamId) return;
  el('team-menu').classList.add('hidden');
  channelBeingRenamed = null;
  el('channel-modal-title').textContent = 'Create Channel';
  el('channel-form-submit').textContent = 'Create';
  el('channel-type-row').style.display = '';
  el('channel-name-input').value = '';
  document.querySelector(`input[name="channel-type"][value="${type === 'voice' ? 'voice' : 'text'}"]`).checked = true;
  el('channel-modal').classList.add('active');
  setTimeout(() => el('channel-name-input').focus(), 50);
}

function openRenameChannel(channelId) {
  const channel = workspace().channels.find(c => c.id === channelId);
  if (!channel) return;
  channelBeingRenamed = channelId;
  el('channel-modal-title').textContent = 'Rename Channel';
  el('channel-form-submit').textContent = 'Save';
  el('channel-type-row').style.display = 'none';
  el('channel-name-input').value = channel.name;
  el('channel-modal').classList.add('active');
  setTimeout(() => el('channel-name-input').select(), 50);
}

async function submitChannelForm(e) {
  e.preventDefault();
  const name = el('channel-name-input').value.trim();
  const teamId = activeTeamId;
  if (!name || !teamId) return;

  try {
    if (channelBeingRenamed) {
      const renamed = await api(`/api/channels/${channelBeingRenamed}`, { method: 'PATCH', body: { name } });
      const channel = workspaces[teamId].channels.find(c => c.id === renamed.id);
      if (channel) channel.name = renamed.name;
    } else {
      const type = document.querySelector('input[name="channel-type"]:checked').value;
      const created = await api(`/api/teams/${teamId}/channels`, { method: 'POST', body: { name, channel_type: type } });
      if (!workspaces[teamId].channels.some(c => c.id === created.id)) {
        workspaces[teamId].channels.push(Object.assign({ last_message_id: 0 }, created));
      }
      if (type === 'text' && activeTeamId === teamId) openChannel(created.id);
    }
    closeModals();
    if (activeTeamId === teamId) { renderChannels(); renderChannelHeader(); }
  } catch (err) {
    showToast(err.message);
  }
}

function deleteChannel(channelId) {
  const channel = workspace().channels.find(c => c.id === channelId);
  if (!channel) return;
  const what = channel.channel_type === 'voice' ? 'voice room' : 'channel and all its messages';
  confirmAction('Delete Channel', `Delete #${escapeHtml(channel.name)}? This removes the ${what} for everyone.`, 'Delete', async () => {
    await api(`/api/channels/${channelId}`, { method: 'DELETE' });
    applyChannelList(activeTeamId, workspace().channels.filter(c => c.id !== channelId));
  });
}

// The channel list changed (here or on someone else's screen)
function applyChannelList(teamId, channels) {
  const ws = workspaces[teamId];
  if (!ws) return;
  // Keep the newest message id we already know about for each channel
  channels.forEach(c => {
    const known = ws.channels.find(k => k.id === c.id);
    c.last_message_id = Math.max(c.last_message_id || 0, known ? known.last_message_id || 0 : 0);
  });
  ws.channels = channels;
  cacheSet(`team-boot:${teamId}`, ws);
  if (teamId !== activeTeamId) return;
  renderChannels();
  if (!channels.some(c => c.id === activeChannelId)) openChannel(pickChannel(teamId));
  else renderChannelHeader();
}

// ==========================================
// 6. MESSAGES: LOADING
// ==========================================
function getTeamThread(channelId) {
  if (!channelThreads[channelId]) {
    channelThreads[channelId] = { messages: [], hasMore: true, loaded: false, loading: false, loadingOlder: false, error: null };
    const cached = cacheGet(`team-thread:${channelId}`);
    if (Array.isArray(cached)) channelThreads[channelId].messages = cached.map(m => Object.assign(m, { key: 'm' + m.id }));
  }
  return channelThreads[channelId];
}

function saveTeamThreadCache(channelId) {
  const thread = channelThreads[channelId];
  if (!thread) return;
  cacheSet(`team-thread:${channelId}`, thread.messages.filter(m => m.id && String(m.content).length <= 4000).slice(-30).map(m => {
    const copy = Object.assign({}, m);
    delete copy.key;
    delete copy.temp_id;
    delete copy.status;
    return copy;
  }));
}

function sortTeamMessages(messages) {
  messages.sort((a, b) => {
    if (a.id && b.id) return a.id - b.id;
    if (a.id) return -1;
    if (b.id) return 1;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}

function mergeTeamMessages(thread, serverMessages) {
  serverMessages.forEach(sm => {
    const existing = thread.messages.find(m => m.id === sm.id);
    if (existing) Object.assign(existing, sm);
    else thread.messages.push(Object.assign({ key: 'm' + sm.id }, sm));
  });
  sortTeamMessages(thread.messages);
}

async function loadTeamThread(channelId) {
  const thread = getTeamThread(channelId);
  if (thread.loading) return;
  thread.loading = true;
  try {
    const page = await api(`/api/channels/${channelId}/messages?limit=${PAGE_SIZE}`);
    // Anything we hold in the range this page covers that the server no longer has was deleted
    const pageIds = new Set(page.map(m => m.id));
    const oldestInPage = page.length ? page[0].id : 0;
    thread.messages = thread.messages.filter(m => !m.id || pageIds.has(m.id) || (thread.loaded && m.id < oldestInPage));
    mergeTeamMessages(thread, page);
    if (!thread.loaded) thread.hasMore = page.length === PAGE_SIZE;
    thread.loaded = true;
    thread.error = null;
    saveTeamThreadCache(channelId);
    const ws = workspace();
    const channel = ws ? ws.channels.find(c => c.id === channelId) : null;
    if (channel && page.length) channel.last_message_id = Math.max(channel.last_message_id || 0, page[page.length - 1].id);
  } catch (err) {
    thread.error = err.message;
  } finally {
    thread.loading = false;
  }
  if (activeChannelId === channelId) {
    renderFeed();
    if (!document.hidden) markChannelSeen(channelId);
  }
}

async function loadOlderTeamMessages() {
  const channelId = activeChannelId;
  const thread = channelThreads[channelId];
  if (!thread || !thread.loaded || !thread.hasMore || thread.loadingOlder) return false;
  const oldest = thread.messages.find(m => m.id);
  if (!oldest) return false;

  thread.loadingOlder = true;
  const feed = el('messages-feed');
  const previousHeight = feed.scrollHeight;
  const previousTop = feed.scrollTop;
  let loaded = false;
  try {
    const page = await api(`/api/channels/${channelId}/messages?limit=${PAGE_SIZE}&before_id=${oldest.id}`);
    mergeTeamMessages(thread, page);
    thread.hasMore = page.length === PAGE_SIZE;
    loaded = page.length > 0;
  } catch (err) {
    showToast(err.message);
  } finally {
    thread.loadingOlder = false;
  }
  if (activeChannelId === channelId) {
    renderFeed({ keepScroll: true });
    feed.scrollTop = feed.scrollHeight - previousHeight + previousTop;
  }
  return loaded;
}

function openChannel(channelId, options = {}) {
  if (!channelId) {
    activeChannelId = null;
    hide(el('chat-area'), 'flex');
    return;
  }
  const changed = activeChannelId !== channelId;
  activeChannelId = channelId;
  if (changed) cancelReply();
  cacheSet(`team-channel:${activeTeamId}`, channelId);
  show(el('chat-area'), 'flex');
  closeDrawer();

  renderChannelHeader();
  renderChannels();
  renderFeed();
  renderTyping();
  if (typeof renderCallBanner === 'function') renderCallBanner();
  loadTeamThread(channelId);
  if (!options.quiet && window.innerWidth >= 1024) el('message-input').focus();
}

function renderChannelHeader() {
  const channel = activeChannel();
  if (!channel) return;
  el('active-channel-name').textContent = channel.name;
  el('channel-description').textContent = workspace().team.description || `Discussion in #${channel.name}`;
  el('message-input').placeholder = `Message #${channel.name}`;
}

// ==========================================
// 7. MESSAGES: RENDERING
// ==========================================
function isNearFeedBottom() {
  const feed = el('messages-feed');
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
}

function scrollFeedToBottom() {
  const feed = el('messages-feed');
  feed.scrollTop = feed.scrollHeight;
}

function teamDaySeparator(ts) {
  return `
    <div class="relative flex items-center justify-center my-3" data-day-separator>
      <div class="border-t border-slate-200 w-full"></div>
      <span class="bg-white px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider absolute whitespace-nowrap">${escapeHtml(formatDay(ts))}</span>
    </div>`;
}

function canDeleteMessage(msg) {
  return msg.sender_id === currentUserId || isAdmin();
}

function reactionsHtml(msg) {
  return (msg.reactions || []).map(r => {
    const mine = r.user_ids.includes(currentUserId);
    const names = r.user_ids.map(id => { const m = memberOf(id); return m ? m.user_name : 'Someone'; }).join(', ');
    // The emoji comes from the server, so it is escaped for both the handler and the label
    return `<button type="button" class="reaction-chip ${mine ? 'is-mine' : ''}" title="${escapeHtml(names)}" onclick="event.stopPropagation(); toggleReaction(${msg.id}, ${escapeJsArg(r.emoji)})"><span>${escapeHtml(r.emoji)}</span><span class="font-bold text-[11px]">${r.user_ids.length}</span></button>`;
  }).join('');
}

function messageRowHtml(msg, animate) {
  const fade = animate ? ' animate-fade-in' : '';
  const time = formatClock(msg.timestamp);

  if (msg.is_system_message) {
    return `
      <div class="msg-row flex items-center gap-2 py-1 px-2 text-xs text-slate-500 italic${fade}" data-msg-key="${msg.key}" data-msg-id="${msg.id || ''}">
        <span class="material-symbols-outlined text-[14px]">info</span>
        <span>${escapeHtml(msg.content)}</span>
        <span class="text-[10px] text-slate-400 not-italic">${time}</span>
      </div>`;
  }

  const sender = memberOf(msg.sender_id);
  const roleBadge = sender && sender.role === 'Admin' ? '<span class="px-1.5 py-0.5 bg-brand-100 text-brand-700 text-[10px] font-bold rounded">ADMIN</span>' : '';
  const reply = msg.reply_to
    ? `<div class="flex items-center gap-1.5 text-[11px] text-slate-500 mb-0.5 cursor-pointer hover:text-slate-700 min-w-0" onclick="jumpToMessage(${msg.reply_to.id})" title="Go to the original message">
         <span class="material-symbols-outlined text-[14px] flex-none">reply</span>
         <span class="font-semibold flex-none">${escapeHtml(msg.reply_to.sender_name)}</span>
         <span class="truncate">${escapeHtml(getMessagePreview(msg.reply_to.content))}</span>
       </div>`
    : '';

  let footer = '';
  let actions = '';
  if (msg.status === 'failed') {
    footer = `<div class="flex items-center gap-2 mt-1">
        <span class="text-[10px] text-rose-500 font-semibold">Failed to send</span>
        <button type="button" onclick="retryTeamMessage('${msg.key}')" class="text-[10px] text-brand-600 hover:text-brand-700 font-bold underline">Retry</button>
        <button type="button" onclick="discardTeamMessage('${msg.key}')" class="text-[10px] text-rose-600 font-bold underline">Delete</button>
      </div>`;
  } else if (msg.id) {
    actions = `
      <div class="quick-reactions">
        ${QUICK_REACTIONS.map(e => `<button type="button" title="React ${e}" onclick="toggleReaction(${msg.id}, '${e}')">${e}</button>`).join('')}
        <button type="button" title="Reply" onclick="startReply(${msg.id})"><span class="material-symbols-outlined text-[15px] align-middle">reply</span></button>
        <button type="button" title="${msg.is_pinned ? 'Unpin' : 'Pin'}" onclick="togglePin(${msg.id})"><span class="material-symbols-outlined text-[15px] align-middle ${msg.is_pinned ? 'text-amber-500' : ''}">push_pin</span></button>
        ${canDeleteMessage(msg) ? `<button type="button" title="Delete" onclick="deleteTeamMessage(${msg.id})"><span class="material-symbols-outlined text-[15px] align-middle hover:text-rose-600">delete</span></button>` : ''}
      </div>`;
  }

  return `
    <div class="msg-row relative flex items-start gap-3 hover:bg-slate-50 py-2 px-2 rounded-lg transition-colors${msg.status === 'sending' ? ' opacity-60' : ''}${fade}" data-msg-key="${msg.key}" data-msg-id="${msg.id || ''}" onclick="this.classList.toggle('show-actions')">
      ${personAvatar(msg.sender_id, msg.sender_name, msg.sender_pic, 'w-9 h-9', 'text-xs')}
      <div class="flex-1 min-w-0">
        ${reply}
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="text-xs font-bold text-slate-900">${escapeHtml(msg.sender_name || 'Unknown')}</span>
          ${roleBadge}
          <span class="text-[11px] text-slate-400">${time}</span>
          ${msg.is_pinned ? '<span class="material-symbols-outlined text-amber-500 text-[13px] self-center" title="Pinned">push_pin</span>' : ''}
        </div>
        <div class="msg-body text-sm text-slate-700 mt-0.5 leading-relaxed">${renderMessageContent(msg.content)}</div>
        <div class="flex items-center gap-1 mt-1 flex-wrap" data-reactions>${reactionsHtml(msg)}</div>
        ${footer}
      </div>
      ${actions}
    </div>`;
}

function renderFeed(options = {}) {
  const channel = activeChannel();
  if (!channel) return;
  const thread = getTeamThread(channel.id);
  const feed = el('messages-feed');

  if (thread.messages.length === 0 && thread.error && !thread.loaded) {
    feed.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center text-slate-500 text-center">
        <span class="material-symbols-outlined text-4xl text-slate-300 mb-2">cloud_off</span>
        <p class="text-sm">Could not load messages.</p>
        <p class="text-xs text-slate-400 mt-1">${escapeHtml(thread.error)}</p>
        <button type="button" class="mt-3 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold" onclick="loadTeamThread(${channel.id})">Try again</button>
      </div>`;
    return;
  }
  if (thread.messages.length === 0 && !thread.loaded) {
    feed.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center text-slate-400">
        <div class="w-7 h-7 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin mb-3"></div>
        <p class="text-sm">Loading messages...</p>
      </div>`;
    return;
  }

  let html = '';
  if (thread.loaded && thread.hasMore) {
    html += '<div class="flex justify-center py-2"><div class="w-5 h-5 border-2 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div></div>';
  } else if (thread.loaded) {
    html += `
      <div class="p-4 rounded-xl bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-100 flex items-start gap-3 mb-4">
        <div class="w-10 h-10 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold text-lg shadow-sm flex-none">#</div>
        <div>
          <h3 class="text-sm font-bold text-slate-900">Welcome to #${escapeHtml(channel.name)}!</h3>
          <p class="text-xs text-slate-600 mt-0.5 leading-relaxed">This is the start of the <strong>#${escapeHtml(channel.name)}</strong> channel.${thread.messages.length ? '' : ' Send a message to get the conversation going!'}</p>
        </div>
      </div>`;
  }

  let lastDay = '';
  thread.messages.forEach(msg => {
    const day = formatDay(msg.timestamp);
    if (day !== lastDay) {
      lastDay = day;
      html += teamDaySeparator(msg.timestamp);
    }
    html += messageRowHtml(msg, false);
  });

  feed.innerHTML = html;
  if (!options.keepScroll) scrollFeedToBottom();
  // A short channel cannot be scrolled, so keep fetching until the view is full
  if (feed.scrollHeight <= feed.clientHeight) loadOlderTeamMessages();
}

function rowNode(key) {
  return document.querySelector(`#messages-feed [data-msg-key="${key}"]`);
}

function appendRow(msg) {
  const feed = el('messages-feed');
  const thread = channelThreads[activeChannelId];
  const stick = isNearFeedBottom() || msg.sender_id === currentUserId;
  const previous = thread.messages[thread.messages.indexOf(msg) - 1];
  if (!feed.querySelector('[data-msg-key]') && !feed.querySelector('h3')) feed.innerHTML = '';
  if (!previous || formatDay(previous.timestamp) !== formatDay(msg.timestamp)) {
    feed.insertAdjacentHTML('beforeend', teamDaySeparator(msg.timestamp));
  }
  feed.insertAdjacentHTML('beforeend', messageRowHtml(msg, true));
  if (stick) scrollFeedToBottom();
}

function refreshRow(msg) {
  if (msg.channel_id !== activeChannelId) return;
  const node = rowNode(msg.key);
  if (!node) return;
  const wasOpen = node.classList.contains('show-actions');
  node.outerHTML = messageRowHtml(msg, false);
  if (wasOpen) { const fresh = rowNode(msg.key); if (fresh) fresh.classList.add('show-actions'); }
}

function removeRow(key) {
  const node = rowNode(key);
  if (!node) return;
  const before = node.previousElementSibling;
  const after = node.nextElementSibling;
  node.remove();
  if (before && before.hasAttribute('data-day-separator') && (!after || after.hasAttribute('data-day-separator'))) before.remove();
}

function findTeamMessage(predicate) {
  for (const channelId of Object.keys(channelThreads)) {
    const msg = channelThreads[channelId].messages.find(predicate);
    if (msg) return msg;
  }
  return null;
}

// Scroll to a message, fetching earlier pages if it is older than what is on screen
async function jumpToMessage(messageId) {
  closeModals();
  const channelId = activeChannelId;
  for (let page = 0; page < 40; page++) {
    const node = document.querySelector(`#messages-feed [data-msg-id="${messageId}"]`);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.classList.remove('is-flash');
      void node.offsetWidth;
      node.classList.add('is-flash');
      return;
    }
    const thread = channelThreads[channelId];
    if (!thread || !thread.hasMore || activeChannelId !== channelId) break;
    if (!await loadOlderTeamMessages() && !thread.hasMore) break;
  }
  showToast('That message is no longer available.');
}

// ==========================================
// 8. SENDING
// ==========================================
function initTeamComposer() {
  const input = el('message-input');
  input.addEventListener('input', () => { autoGrowInput(); sendTyping(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const send = settings.enterToSend ? !e.shiftKey : (e.ctrlKey || e.metaKey);
    if (send) {
      e.preventDefault();
      submitMessage();
    }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (files.length) {
      e.preventDefault();
      sendTeamFiles(files);
    }
  });
  el('create-team-form').addEventListener('submit', createTeam);
  el('channel-form').addEventListener('submit', submitChannelForm);
  el('add-resource-form').addEventListener('submit', addResource);
  el('team-settings-form').addEventListener('submit', saveTeamSettings);
}

function submitMessage() {
  const input = el('message-input');
  const content = input.value.trim();
  if (!content || !activeChannelId) return;
  if (content.length > 5000) return showToast('That message is too long. The limit is 5000 characters.');
  sendTeamMessage(activeChannelId, content, replyTarget ? replyTarget.id : null);
  input.value = '';
  autoGrowInput();
  cancelReply();
  el('emoji-picker').classList.remove('active');
  input.focus();
}

function sendTeamMessage(channelId, content, replyToId) {
  const thread = getTeamThread(channelId);
  const tempId = newTempId();
  const original = replyToId ? thread.messages.find(m => m.id === replyToId) : null;
  const msg = {
    id: null,
    key: tempId,
    temp_id: tempId,
    team_id: activeTeamId,
    channel_id: channelId,
    sender_id: currentUserId,
    sender_name: myName(),
    sender_pic: myPicture(),
    content: content,
    timestamp: new Date().toISOString(),
    is_system_message: 0,
    is_pinned: 0,
    reactions: [],
    reply_to: original ? { id: original.id, sender_name: original.sender_name, content: original.content } : null,
    reply_to_id: replyToId || null,
    status: 'sending'
  };
  thread.messages.push(msg);
  if (activeChannelId === channelId) appendRow(msg);
  transmitTeamMessage(msg);
}

async function transmitTeamMessage(msg) {
  try {
    const saved = await api(`/api/channels/${msg.channel_id}/messages`, {
      method: 'POST',
      body: { content: msg.content, temp_id: msg.temp_id, reply_to_id: msg.reply_to_id }
    });
    confirmTeamMessage(msg, saved);
  } catch (err) {
    msg.status = 'failed';
    refreshRow(msg);
    showToast(err.message);
  }
}

function confirmTeamMessage(msg, saved) {
  if (msg.id) return;
  Object.assign(msg, saved, { key: msg.key, status: null });
  refreshRow(msg);
  noteNewestMessage(msg.channel_id, msg.id);
  saveTeamThreadCache(msg.channel_id);
}

function retryTeamMessage(key) {
  const msg = findTeamMessage(m => m.key === key);
  if (!msg) return;
  msg.status = 'sending';
  refreshRow(msg);
  transmitTeamMessage(msg);
}

function discardTeamMessage(key) {
  const msg = findTeamMessage(m => m.key === key);
  if (!msg) return;
  const thread = channelThreads[msg.channel_id];
  thread.messages = thread.messages.filter(m => m !== msg);
  if (activeChannelId === msg.channel_id) removeRow(key);
}

function noteNewestMessage(channelId, messageId) {
  const ws = workspace();
  const channel = ws ? ws.channels.find(c => c.id === channelId) : null;
  if (channel) channel.last_message_id = Math.max(channel.last_message_id || 0, messageId || 0);
  if (channelId === activeChannelId && !document.hidden) markChannelSeen(channelId);
}

function deleteTeamMessage(messageId) {
  const channelId = activeChannelId;
  confirmAction('Delete Message', 'Delete this message for everyone in this channel?', 'Delete', async () => {
    await api(`/api/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
    applyMessageDeleted(channelId, messageId);
  });
}

function applyMessageDeleted(channelId, messageId) {
  const thread = channelThreads[channelId];
  if (!thread) return;
  const msg = thread.messages.find(m => m.id === messageId);
  if (!msg) return;
  thread.messages = thread.messages.filter(m => m !== msg);
  if (activeChannelId === channelId) {
    removeRow(msg.key);
    if (thread.messages.length === 0) renderFeed();
  }
  if (replyTarget && replyTarget.id === messageId) cancelReply();
  saveTeamThreadCache(channelId);
}

// ===== REPLY =====
function startReply(messageId) {
  const msg = findTeamMessage(m => m.id === messageId);
  if (!msg) return;
  replyTarget = msg;
  el('reply-preview-name').textContent = `Replying to ${msg.sender_name}`;
  el('reply-preview-text').textContent = getMessagePreview(msg.content);
  show(el('reply-preview'), 'flex');
  el('message-input').focus();
}

function cancelReply() {
  replyTarget = null;
  hide(el('reply-preview'), 'flex');
}

// ===== REACTIONS =====
async function toggleReaction(messageId, emoji) {
  const msg = findTeamMessage(m => m.id === messageId);
  if (!msg) return;
  // Show it straight away; the server's answer replaces this with the real list
  const before = JSON.parse(JSON.stringify(msg.reactions || []));
  const entry = (msg.reactions = msg.reactions || []).find(r => r.emoji === emoji);
  if (entry && entry.user_ids.includes(currentUserId)) {
    entry.user_ids = entry.user_ids.filter(id => id !== currentUserId);
    if (entry.user_ids.length === 0) msg.reactions = msg.reactions.filter(r => r !== entry);
  } else if (entry) {
    entry.user_ids.push(currentUserId);
  } else {
    msg.reactions.push({ emoji, user_ids: [currentUserId] });
  }
  refreshRow(msg);

  try {
    const result = await api(`/api/channels/${msg.channel_id}/messages/${messageId}/reactions`, { method: 'POST', body: { emoji } });
    msg.reactions = result.reactions;
  } catch (err) {
    msg.reactions = before;
    showToast(err.message);
  }
  refreshRow(msg);
  saveTeamThreadCache(msg.channel_id);
}

// ===== PINS =====
async function togglePin(messageId) {
  const msg = findTeamMessage(m => m.id === messageId);
  if (!msg) return;
  try {
    const result = await api(`/api/channels/${msg.channel_id}/messages/${messageId}/pin`, { method: 'POST' });
    msg.is_pinned = result.is_pinned;
    refreshRow(msg);
    showToast(result.is_pinned ? 'Pinned to this channel.' : 'Unpinned.');
  } catch (err) {
    showToast(err.message);
  }
}

function resultRowHtml(m, extraButton) {
  return `
    <div class="p-3 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors border border-slate-100" onclick="jumpToMessage(${m.id})">
      <div class="flex items-baseline gap-2 mb-1">
        <span class="text-xs font-bold text-slate-900">${escapeHtml(m.sender_name)}</span>
        <span class="text-[10px] text-slate-400">${escapeHtml(new Date(m.timestamp).toLocaleString())}</span>
        ${extraButton || ''}
      </div>
      <p class="text-xs text-slate-700 line-clamp-3">${escapeHtml(getMessagePreview(m.content))}</p>
    </div>`;
}

async function openPinsModal() {
  if (!activeChannelId) return;
  const channelId = activeChannelId;
  el('pins-modal').classList.add('active');
  el('pins-results').innerHTML = '<p class="text-center text-sm text-slate-400 py-6">Loading...</p>';
  try {
    const pins = await api(`/api/channels/${channelId}/pins`);
    el('pins-results').innerHTML = pins.length
      ? pins.map(m => resultRowHtml(m, `<button type="button" class="ml-auto text-[10px] font-bold text-slate-400 hover:text-rose-600" onclick="event.stopPropagation(); unpinFromList(${m.id})">Unpin</button>`)).join('')
      : '<p class="text-center text-sm text-slate-400 py-6">No pinned messages in this channel yet.<br>Hover over a message and click the pin to keep it here.</p>';
  } catch (err) {
    el('pins-results').innerHTML = `<p class="text-center text-sm text-rose-500 py-6">${escapeHtml(err.message)}</p>`;
  }
}

async function unpinFromList(messageId) {
  try {
    await api(`/api/channels/${activeChannelId}/messages/${messageId}/pin`, { method: 'POST' });
    const msg = findTeamMessage(m => m.id === messageId);
    if (msg) { msg.is_pinned = 0; refreshRow(msg); }
    openPinsModal();
  } catch (err) {
    showToast(err.message);
  }
}

// ===== SEARCH =====
let searchTimer = null;
let searchSeq = 0;

function openSearchModal() {
  if (!activeChannelId) return;
  el('search-modal').classList.add('active');
  el('search-messages-input').value = '';
  el('search-results').innerHTML = '<p class="text-center text-sm text-slate-400 py-6">Type to search messages...</p>';
  setTimeout(() => el('search-messages-input').focus(), 50);
}

function performSearch() {
  const query = el('search-messages-input').value.trim();
  const results = el('search-results');
  clearTimeout(searchTimer);
  if (!query) {
    results.innerHTML = '<p class="text-center text-sm text-slate-400 py-6">Type to search messages...</p>';
    return;
  }
  results.innerHTML = '<p class="text-center text-sm text-slate-400 py-6">Searching...</p>';
  const seq = ++searchSeq;
  const channelId = activeChannelId;
  searchTimer = setTimeout(async () => {
    try {
      const matches = await api(`/api/channels/${channelId}/search?q=${encodeURIComponent(query)}`);
      if (seq !== searchSeq) return;
      results.innerHTML = matches.length
        ? matches.map(m => resultRowHtml(m)).join('') + (matches.length === 30 ? '<p class="text-center text-[11px] text-slate-400 py-2">Showing the 30 most recent matches.</p>' : '')
        : '<p class="text-center text-sm text-slate-400 py-6">No messages found.</p>';
    } catch (err) {
      if (seq === searchSeq) results.innerHTML = `<p class="text-center text-sm text-rose-500 py-6">${escapeHtml(err.message)}</p>`;
    }
  }, 250);
}

// ===== ATTACHMENTS, CODE, VOICE MESSAGES =====
async function sendTeamFiles(files) {
  const channelId = activeChannelId;
  if (!channelId) return;
  for (const file of files) {
    try {
      const upload = await uploadChatFile(file);
      sendTeamMessage(channelId, attachmentToken(upload), null);
    } catch (err) {
      window.showSystemModal('Upload Error', escapeHtml(`${file.name || 'File'}: ${err.message}`), 'alert');
    }
  }
  setUploadProgress('', null);
}

async function handleFileSelect(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) await sendTeamFiles(files);
}

function insertCodeBlock() {
  const input = el('message-input');
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const selected = input.value.substring(start, end);
  const block = '```\n' + (selected || '') + '\n```';
  input.value = input.value.substring(0, start) + block + input.value.substring(end);
  input.focus();
  // Leave the cursor inside the block, ready to type or paste
  const cursor = start + 4 + selected.length;
  input.setSelectionRange(cursor, cursor);
  autoGrowInput();
}

function resetVoiceMemoUi() {
  clearInterval(memoTimer);
  el('voice-memo-btn').querySelector('.material-symbols-outlined').textContent = 'mic';
  el('voice-memo-btn').title = 'Record voice message';
  hide(el('voice-memo-timer'));
  hide(el('voice-memo-cancel'));
}

async function toggleVoiceMemo() {
  if (memoRecorder && memoRecorder.state === 'recording') {
    memoRecorder.stop();   // stop and send
    return;
  }
  const channelId = activeChannelId;
  if (!channelId) return;
  const format = pickRecordingFormat();
  if (!format || !navigator.mediaDevices) return window.showSystemModal('Voice Messages', 'This browser cannot record audio.', 'alert');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    return window.showSystemModal('Microphone Access', 'Please allow microphone access to record voice messages.', 'alert');
  }

  memoChunks = [];
  memoSeconds = 0;
  memoCancelled = false;
  const recorder = new MediaRecorder(stream, { mimeType: format.mime });
  memoRecorder = recorder;
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) memoChunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    const chunks = memoChunks;
    const seconds = memoSeconds;
    const cancelled = memoCancelled;
    memoChunks = [];
    memoRecorder = null;
    resetVoiceMemoUi();
    if (cancelled || chunks.length === 0) return;
    if (seconds < 1) return showToast('That recording was too short.');
    try {
      const blob = new Blob(chunks, { type: format.mime.split(';')[0] });
      const upload = await uploadChatFile(blob, `Voice memo ${formatDuration(seconds)}.${format.ext}`.replace(':', '-'));
      sendTeamMessage(channelId, `[FILE|${upload.url}|Voice memo ${formatDuration(seconds)}.${format.ext}|${formatBytes(upload.size)}]`, null);
    } catch (err) {
      window.showSystemModal('Voice Message', escapeHtml(err.message), 'alert');
    }
    setUploadProgress('', null);
  };

  recorder.start();
  el('voice-memo-btn').querySelector('.material-symbols-outlined').textContent = 'stop_circle';
  el('voice-memo-btn').title = 'Stop and send';
  el('voice-memo-timer').textContent = '0:00';
  show(el('voice-memo-timer'));
  show(el('voice-memo-cancel'));
  memoTimer = setInterval(() => {
    memoSeconds++;
    el('voice-memo-timer').textContent = formatDuration(memoSeconds);
    if (memoSeconds >= 300 && memoRecorder) memoRecorder.stop();
  }, 1000);
}

function cancelVoiceMemo() {
  memoCancelled = true;
  if (memoRecorder && memoRecorder.state === 'recording') memoRecorder.stop();
  else resetVoiceMemoUi();
}

// ===== TYPING =====
function sendTyping() {
  if (!activeChannelId || Date.now() - typingSentAt < 2500) return;
  typingSentAt = Date.now();
  teamSocketSend({ type: 'typing', channel_id: activeChannelId, typing: true });
}

function noteTyping(channelId, userId, name, typing) {
  const people = typingByChannel[channelId] = typingByChannel[channelId] || {};
  if (people[userId]) clearTimeout(people[userId].timer);
  delete people[userId];
  if (typing) {
    people[userId] = { name, timer: setTimeout(() => noteTyping(channelId, userId, name, false), 4000) };
  }
  if (channelId === activeChannelId) renderTyping();
}

function renderTyping() {
  const names = Object.values(typingByChannel[activeChannelId] || {}).map(p => p.name);
  const indicator = el('typing-indicator');
  if (names.length === 0) return hide(indicator);
  el('typing-text').textContent = names.length === 1 ? `${names[0]} is typing...`
    : names.length === 2 ? `${names[0]} and ${names[1]} are typing...`
    : 'Several people are typing...';
  show(indicator);
}

// ==========================================
// 9. REAL-TIME CONNECTION
// ==========================================
function teamSocketSend(payload) {
  if (teamSocket && teamSocket.readyState === WebSocket.OPEN) {
    try { teamSocket.send(JSON.stringify(payload)); return true; } catch (e) { /* fall through */ }
  }
  return false;
}

function closeTeamSocket() {
  teamSocketTeamId = null;
  if (teamSocket) {
    const socket = teamSocket;
    teamSocket = null;
    socket.onclose = null;
    try { socket.close(); } catch (e) { /* already closed */ }
  }
}

function connectTeamSocket(teamId) {
  if (teamSocket && teamSocketTeamId === teamId && teamSocket.readyState <= WebSocket.OPEN) return;
  closeTeamSocket();
  teamSocketTeamId = teamId;
  teamSocketWasOpen = false;
  openTeamSocket(teamId);
}

function openTeamSocket(teamId) {
  const socket = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/api/ws/teams/${teamId}/${currentUserId}`);
  teamSocket = socket;

  socket.onopen = () => {
    teamSocketRetry = 1000;
    hide(el('connection-status'));
    if (teamSocketWasOpen) resyncTeam(teamId);
    teamSocketWasOpen = true;
    if (typeof onTeamSocketOpen === 'function') onTeamSocketOpen(teamId);
  };
  socket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    handleTeamEvent(teamId, data);
  };
  socket.onclose = async () => {
    if (teamSocket !== socket) return;
    teamSocket = null;
    if (teamSocketTeamId !== teamId) return;
    show(el('connection-status'));
    if (typeof onTeamSocketLost === 'function') onTeamSocketLost();
    // The server refuses the socket when the login has expired or we were removed from the team
    try {
      await api(`/api/teams/${teamId}/members`);
    } catch (err) {
      if (err.status === 403 || err.status === 404) return forgetTeam(teamId);
      if (err.status === 401) return;
    }
    setTimeout(() => { if (teamSocketTeamId === teamId && !teamSocket) openTeamSocket(teamId); }, teamSocketRetry);
    teamSocketRetry = Math.min(teamSocketRetry * 2, 10000);
  };
  socket.onerror = () => { try { socket.close(); } catch (e) { /* already closed */ } };
}

// Things may have changed while we were disconnected
async function resyncTeam(teamId) {
  if (workspaces[teamId]) workspaces[teamId].fresh = false;
  if (activeTeamId !== teamId) return;
  try {
    const boot = await api(`/api/teams/${teamId}/bootstrap`);
    workspaces[teamId] = { team: boot.team, role: boot.role, members: boot.members, channels: boot.channels, resources: boot.resources, fresh: true };
    cacheSet(`team-boot:${teamId}`, workspaces[teamId]);
    if (activeTeamId !== teamId) return;
    onlineUserIds = new Set(boot.online_user_ids || []);
    if (typeof applyVoiceState === 'function') applyVoiceState(boot.voice || {});
    renderWorkspace();
    if (activeChannelId) loadTeamThread(activeChannelId);
  } catch (err) { /* the close handler deals with lost access */ }
}

function handleTeamEvent(teamId, data) {
  const ws = workspaces[teamId];

  switch (data.type) {
    case 'hello':
      onlineUserIds = new Set(data.online_user_ids || []);
      if (typeof applyVoiceState === 'function') applyVoiceState(data.voice || {});
      if (teamId === activeTeamId) renderMembers();
      return;

    case 'presence':
      if (data.online) onlineUserIds.add(data.user_id); else onlineUserIds.delete(data.user_id);
      if (teamId === activeTeamId) renderMembers();
      return;

    case 'message':
      return handleIncomingTeamMessage(teamId, data.message);

    case 'message_deleted':
      return applyMessageDeleted(data.channel_id, data.id);

    case 'reactions': {
      const msg = findTeamMessage(m => m.id === data.message_id);
      if (msg) { msg.reactions = data.reactions; refreshRow(msg); }
      return;
    }

    case 'pin': {
      const msg = findTeamMessage(m => m.id === data.message_id);
      if (msg) { msg.is_pinned = data.is_pinned; refreshRow(msg); }
      return;
    }

    case 'typing':
      return noteTyping(data.channel_id, data.user_id, data.name, data.typing);

    case 'members':
      if (!ws) return;
      ws.members = data.members;
      {
        const me = data.members.find(m => m.user_id === currentUserId);
        if (me) ws.role = me.role;
      }
      cacheSet(`team-boot:${teamId}`, ws);
      if (teamId === activeTeamId) { renderWorkspace(); renderFeed({ keepScroll: true }); }
      return;

    case 'channels':
      return applyChannelList(teamId, data.channels);

    case 'resources':
      if (!ws) return;
      ws.resources = data.resources;
      cacheSet(`team-boot:${teamId}`, ws);
      if (teamId === activeTeamId) renderResources();
      return;

    case 'team_updated': {
      if (ws) ws.team = data.team;
      const listed = teams.find(t => t.id === teamId);
      if (listed) Object.assign(listed, data.team);
      cacheSet('teams', teams);
      renderRail();
      if (teamId === activeTeamId) { renderWorkspace(); renderChannelHeader(); }
      return;
    }

    case 'team_deleted':
      forgetTeam(teamId);
      showToast('This workspace was deleted.');
      return;

    case 'evicted':
      forgetTeam(teamId);
      if (data.reason === 'removed') showToast('You were removed from that workspace.');
      return;
  }

  if (data.type && (data.type.startsWith('voice_') || data.type === 'rtc')) {
    if (typeof handleVoiceEvent === 'function') handleVoiceEvent(teamId, data);
  }
}

function handleIncomingTeamMessage(teamId, data) {
  const thread = getTeamThread(data.channel_id);
  // Our own message coming back: it is already on screen
  const existing = thread.messages.find(m => (data.id && m.id === data.id) || (data.temp_id && m.temp_id === data.temp_id));
  if (existing) {
    confirmTeamMessage(existing, data);
    return;
  }

  const msg = Object.assign({ key: 'm' + data.id }, data);
  delete msg.temp_id;
  thread.messages.push(msg);
  sortTeamMessages(thread.messages);
  saveTeamThreadCache(data.channel_id);
  if (msg.sender_id) noteTyping(data.channel_id, msg.sender_id, '', false);

  const isOpen = teamId === activeTeamId && data.channel_id === activeChannelId;
  if (isOpen) appendRow(msg);
  noteNewestMessage(data.channel_id, msg.id);
  if (!isOpen || document.hidden) {
    if (teamId === activeTeamId) renderChannels();
    if (settings.sound && msg.sender_id !== currentUserId && !msg.is_system_message) playTone(880, 0.18, 0.08);
  }
}

// ==========================================
// 10. MEMBERS
// ==========================================
function toggleMembers() {
  const sidebar = el('members-sidebar');
  if (sidebar.classList.contains('hidden')) show(sidebar, 'flex');
  else hide(sidebar, 'flex');
}

function memberCardHtml(m) {
  const ws = workspace();
  const isMe = m.user_id === currentUserId;
  const isOnline = isMe || onlineUserIds.has(m.user_id);
  const isTeamCreator = m.user_id === ws.team.created_by;
  const canManage = isAdmin() && !isMe && !isTeamCreator;

  return `
    <div class="group flex items-center gap-2.5 p-2 rounded-lg ${m.role === 'Admin' ? 'bg-white border border-slate-200/80 shadow-sm' : 'hover:bg-white'} transition-colors">
      <div class="relative flex-none">
        ${personAvatar(m.user_id, m.user_name, m.user_profile_pic, 'w-8 h-8', 'text-xs')}
        <span class="absolute bottom-0 right-0 w-2.5 h-2.5 ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'} border-2 border-white rounded-full" title="${isOnline ? 'Online' : 'Offline'}"></span>
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-bold text-slate-800 truncate">${escapeHtml(m.user_name)}${isMe ? ' (You)' : ''}</p>
        <p class="text-[10px] text-slate-400 truncate">${isTeamCreator ? 'Creator' : escapeHtml(m.role)}</p>
      </div>
      ${isMe ? '' : `<a href="inbox.html?user=${m.user_id}" class="p-1 text-slate-400 hover:text-brand-600 transition-colors" title="Direct Message"><span class="material-symbols-outlined text-[14px]">chat</span></a>`}
      ${canManage ? `
        <button type="button" onclick="changeMemberRole(${m.user_id}, '${m.role === 'Admin' ? 'Member' : 'Admin'}')" class="p-1 text-slate-400 hover:text-brand-600 transition-colors" title="${m.role === 'Admin' ? 'Make Member' : 'Make Admin'}"><span class="material-symbols-outlined text-[14px]">${m.role === 'Admin' ? 'remove_moderator' : 'add_moderator'}</span></button>
        <button type="button" onclick="removeMember(${m.user_id})" class="p-1 text-slate-400 hover:text-rose-600 transition-colors" title="Remove from workspace"><span class="material-symbols-outlined text-[14px]">person_remove</span></button>` : ''}
    </div>`;
}

function renderMembers() {
  const ws = workspace();
  if (!ws) return;
  const admins = ws.members.filter(m => m.role === 'Admin');
  const others = ws.members.filter(m => m.role !== 'Admin');
  const online = ws.members.filter(m => m.user_id === currentUserId || onlineUserIds.has(m.user_id)).length;

  el('members-header').textContent = `${ws.members.length} Members • ${online} Online`;
  const group = (title, list) => list.length ? `
    <div>
      <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-1">${title} — ${list.length}</div>
      <div class="space-y-1">${list.map(memberCardHtml).join('')}</div>
    </div>` : '';
  el('members-container').innerHTML = group('Admins', admins) + group('Members', others);
}

async function changeMemberRole(userId, role) {
  const teamId = activeTeamId;
  try {
    await api(`/api/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: { role } });
    const member = workspaces[teamId].members.find(m => m.user_id === userId);
    if (member) member.role = role;
    if (activeTeamId === teamId) { renderMembers(); renderFeed({ keepScroll: true }); }
    showToast(role === 'Admin' ? 'They are now an Admin.' : 'They are now a Member.');
  } catch (err) {
    showToast(err.message);
  }
}

function removeMember(userId) {
  const member = memberOf(userId);
  if (!member) return;
  const teamId = activeTeamId;
  confirmAction('Remove Member', `Remove ${escapeHtml(member.user_name)} from this workspace? They will lose access to all its channels.`, 'Remove', async () => {
    await api(`/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
    workspaces[teamId].members = workspaces[teamId].members.filter(m => m.user_id !== userId);
    if (activeTeamId === teamId) renderWorkspace();
  });
}

// ===== INVITE =====
function openInviteModal() {
  if (!activeTeamId) return;
  el('team-menu').classList.add('hidden');
  el('invite-modal').classList.add('active');
  el('invite-search').value = '';
  el('invite-user-list').innerHTML = '<p class="text-center text-sm text-slate-400 py-4">Type a name to search...</p>';
  setTimeout(() => el('invite-search').focus(), 50);
}

function searchInviteUsers() {
  const existing = new Set(workspace().members.map(m => m.user_id));
  const role = el('invite-role').value;
  searchUsers(el('invite-search').value, el('invite-user-list'), (user) => {
    if (existing.has(user.id)) return { label: 'Member', disabled: true };
    return { label: `Add as ${role}`, handler: `inviteUser(${user.id})` };
  });
}

async function inviteUser(userId) {
  const teamId = activeTeamId;
  try {
    await api(`/api/teams/${teamId}/members`, { method: 'POST', body: { user_id: userId, role: el('invite-role').value } });
    const card = userSearchResults[userId];
    if (card && !workspaces[teamId].members.some(m => m.user_id === userId)) {
      workspaces[teamId].members.push({ id: 0, team_id: teamId, user_id: userId, role: el('invite-role').value, joined_at: '', user_name: card.name, user_profile_pic: card.profile_pic });
    }
    showToast('Added to the workspace.');
    if (activeTeamId === teamId) renderWorkspace();
    if (el('invite-modal').classList.contains('active')) searchInviteUsers();
  } catch (err) {
    showToast(err.message);
  }
}

// ==========================================
// 11. SHARED RESOURCES
// ==========================================
function renderResources() {
  const ws = workspace();
  if (!ws) return;
  el('resources-list').innerHTML = ws.resources.map(r => {
    let domain = r.url;
    try { domain = new URL(r.url).hostname; } catch (e) { /* keep the raw text */ }
    const icon = domain.includes('github') ? 'code' : domain.includes('figma') ? 'design_services' : domain.includes('google') ? 'article' : 'link';
    const canRemove = r.added_by === currentUserId || isAdmin();
    return `
      <div class="group flex items-center gap-1">
        <a href="${escapeHtml(safeUrl(r.url))}" target="_blank" rel="noopener" class="flex-1 min-w-0 flex items-center gap-2.5 p-2 bg-white rounded-lg border border-slate-200 hover:border-brand-400 transition-all text-xs shadow-sm">
          <div class="w-7 h-7 rounded bg-slate-100 text-slate-600 flex items-center justify-center flex-none">
            <span class="material-symbols-outlined text-[16px]">${icon}</span>
          </div>
          <div class="truncate min-w-0 flex-1">
            <p class="font-semibold text-slate-800 truncate">${escapeHtml(r.name)}</p>
            <p class="text-[10px] text-slate-400 truncate">${escapeHtml(domain)}</p>
          </div>
        </a>
        ${canRemove ? `<button type="button" onclick="removeResource(${r.id})" class="p-1 text-slate-300 hover:text-rose-600 flex-none" title="Remove"><span class="material-symbols-outlined text-[14px]">close</span></button>` : ''}
      </div>`;
  }).join('') || '<p class="text-[11px] text-slate-400 px-1">No shared links yet.</p>';
}

function openResourceModal() {
  if (!activeTeamId) return;
  el('add-resource-form').reset();
  el('add-resource-modal').classList.add('active');
  setTimeout(() => el('resource-name').focus(), 50);
}

async function addResource(e) {
  e.preventDefault();
  const teamId = activeTeamId;
  try {
    const resource = await api(`/api/teams/${teamId}/resources`, { method: 'POST', body: { name: el('resource-name').value, url: el('resource-url').value } });
    if (!workspaces[teamId].resources.some(r => r.id === resource.id)) workspaces[teamId].resources.push(resource);
    closeModals();
    if (activeTeamId === teamId) renderResources();
  } catch (err) {
    showToast(err.message);
  }
}

async function removeResource(resourceId) {
  const teamId = activeTeamId;
  try {
    await api(`/api/teams/${teamId}/resources/${resourceId}`, { method: 'DELETE' });
    workspaces[teamId].resources = workspaces[teamId].resources.filter(r => r.id !== resourceId);
    if (activeTeamId === teamId) renderResources();
  } catch (err) {
    showToast(err.message);
  }
}

// ==========================================
// 12. WORKSPACE MENU, SETTINGS, PREFERENCES
// ==========================================
function toggleTeamMenu() {
  const menu = el('team-menu');
  if (!menu.classList.contains('hidden')) return menu.classList.add('hidden');
  if (!workspace()) return;

  const items = [];
  if (isAdmin()) {
    items.push({ icon: 'person_add', label: 'Invite People', action: 'openInviteModal()' });
    items.push({ icon: 'add_circle', label: 'Create Channel', action: "openChannelModal('text')" });
  }
  items.push({ icon: 'settings', label: 'Workspace Settings', action: 'openTeamSettings()' });
  items.push({ icon: 'group', label: 'Members', action: "el('team-menu').classList.add('hidden'); if (el('members-sidebar').classList.contains('hidden')) toggleMembers(); closeDrawer();" });
  items.push('divider');
  if (isCreator()) items.push({ icon: 'delete', label: 'Delete Workspace', action: 'deleteWorkspace()', danger: true });
  else items.push({ icon: 'logout', label: 'Leave Workspace', action: 'leaveWorkspace()', danger: true });

  menu.innerHTML = items.map(item => item === 'divider'
    ? '<div class="border-t border-slate-100 my-1"></div>'
    : `<button type="button" onclick="${item.action}" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${item.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-brand-50 hover:text-brand-700'} transition-colors">
        <span class="material-symbols-outlined text-[16px]">${item.icon}</span>
        ${item.label}
      </button>`).join('');
  menu.classList.remove('hidden');
}

function openTeamSettings() {
  const ws = workspace();
  if (!ws) return;
  el('team-menu').classList.add('hidden');
  const admin = isAdmin();
  el('settings-team-name').value = ws.team.name;
  el('settings-team-desc').value = ws.team.description || '';
  el('settings-team-name').disabled = !admin;
  el('settings-team-desc').disabled = !admin;
  el('settings-save').style.display = admin ? '' : 'none';
  const text = ws.channels.filter(c => c.channel_type !== 'voice').length;
  const created = ws.team.created_at ? new Date(ws.team.created_at).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown';
  el('settings-team-facts').textContent = `${ws.members.length} members · ${text} text channels · ${ws.channels.length - text} voice rooms · created ${created}`;
  el('settings-team-note').textContent = admin ? '' : 'Only Admins can change the name and description.';
  el('settings-danger').innerHTML = isCreator()
    ? '<button type="button" onclick="deleteWorkspace()" class="px-3 py-2 rounded-lg font-semibold text-sm text-rose-600 hover:bg-rose-50">Delete workspace</button>'
    : '<button type="button" onclick="leaveWorkspace()" class="px-3 py-2 rounded-lg font-semibold text-sm text-rose-600 hover:bg-rose-50">Leave workspace</button>';
  el('team-settings-modal').classList.add('active');
}

async function saveTeamSettings(e) {
  e.preventDefault();
  const teamId = activeTeamId;
  try {
    const team = await api(`/api/teams/${teamId}`, { method: 'PATCH', body: { name: el('settings-team-name').value, description: el('settings-team-desc').value } });
    workspaces[teamId].team = team;
    const listed = teams.find(t => t.id === teamId);
    if (listed) Object.assign(listed, team);
    cacheSet('teams', teams);
    closeModals();
    renderRail();
    if (activeTeamId === teamId) { renderWorkspace(); renderChannelHeader(); }
    showToast('Workspace updated.');
  } catch (err) {
    showToast(err.message);
  }
}

function leaveWorkspace() {
  const ws = workspace();
  if (!ws) return;
  const teamId = activeTeamId;
  el('team-menu').classList.add('hidden');
  closeModals();
  confirmAction('Leave Workspace', `Leave ${escapeHtml(ws.team.name)}? An Admin will need to add you again to rejoin.`, 'Leave', async () => {
    await api(`/api/teams/${teamId}/leave`, { method: 'POST' });
    forgetTeam(teamId);
    showToast('You left the workspace.');
  });
}

function deleteWorkspace() {
  const ws = workspace();
  if (!ws) return;
  const teamId = activeTeamId;
  el('team-menu').classList.add('hidden');
  closeModals();
  confirmAction('Delete Workspace', `Permanently delete ${escapeHtml(ws.team.name)}? All its channels, messages and members are removed. This cannot be undone.`, 'Delete', async () => {
    await api(`/api/teams/${teamId}`, { method: 'DELETE' });
    forgetTeam(teamId);
    showToast('Workspace deleted.');
  });
}

function openCreateTeamModal() {
  el('create-team-form').reset();
  el('create-team-modal').classList.add('active');
  setTimeout(() => el('new-team-name').focus(), 50);
}

async function createTeam(e) {
  e.preventDefault();
  const name = el('new-team-name').value.trim();
  if (!name) return;
  try {
    const team = await api('/api/teams', { method: 'POST', body: { name, description: el('new-team-desc').value.trim() } });
    teams.push(team);
    cacheSet('teams', teams);
    closeModals();
    openTeam(team.id);
  } catch (err) {
    showToast(err.message);
  }
}

function openPreferencesModal() {
  el('pref-sound').checked = settings.sound;
  el('pref-enter').checked = settings.enterToSend;
  el('preferences-modal').classList.add('active');
}

function savePreferences() {
  settings.sound = el('pref-sound').checked;
  settings.enterToSend = el('pref-enter').checked;
  cacheSet('settings', settings);
  applySettings();
}

// ===== INIT =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTeams);
} else {
  initTeams();
}
