// ==========================================
// INBOX.JS — Direct chats, group channels, search, attachments, settings
// Loaded after shared.js and chat-common.js (api, caches, message rendering, uploads, emoji). Calls live in inbox-calls.js.
// ==========================================

// Direct chat state
let contacts = {};                 // contactId -> { id, name, profile_pic, college_name, department, skills, lastMessage, timestamp, unread, archived }
const threads = {};                // contactId -> { messages, hasMore, loaded, loading, stale }
let activeContactId = null;
let chatActionsState = { muted: [], blocked: [] };
let showArchived = false;
let listQuery = '';

// Group state
let currentTab = 'direct';
let myTeams = [];
let activeTeamId = null;
let activeChannelId = null;
const teamChannels = {};           // teamId -> [channel]
const teamMembers = {};            // teamId -> [member]
const channelThreads = {};         // channelId -> { messages, hasMore, loaded, loading }
let teamWs = null;
let teamWsChannelId = null;

// Connection state
let ws = null;
let wsRetryDelay = 1000;
let wsHasConnectedBefore = false;

// Typing state
let typingTimeout = null;
let isTyping = false;
const typingUsers = {};            // contactId -> timer that clears their "typing" state

// Voice recording state
let mediaRecorder = null;
let audioChunks = [];
let recordingInterval = null;
let recordingSeconds = 0;
let recordingCancelled = false;
const MAX_RECORDING_SECONDS = 300;

// ==========================================
// 3. SETTINGS AND NOTIFICATIONS
// ==========================================
function openSettingsModal() {
  el('setting-sound').checked = settings.sound;
  el('setting-desktop').checked = settings.desktop && 'Notification' in window && Notification.permission === 'granted';
  el('setting-enter').checked = settings.enterToSend;
  el('settings-modal').classList.add('active');
}

function closeSettingsModal() {
  el('settings-modal').classList.remove('active');
}

async function saveSettingsFromModal() {
  settings.sound = el('setting-sound').checked;
  settings.enterToSend = el('setting-enter').checked;

  if (el('setting-desktop').checked) {
    if (!('Notification' in window)) {
      el('setting-desktop').checked = false;
      showToast('This browser does not support desktop notifications.');
    } else if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        el('setting-desktop').checked = false;
        showToast('Notifications are blocked for this site in your browser settings.');
      }
    }
  }
  settings.desktop = el('setting-desktop').checked;

  cacheSet('settings', settings);
  applySettings();
}

function notifyIncoming(contact, previewText) {
  if (settings.sound) {
    playTone(880, 0.18, 0.08);
  }
  if (settings.desktop && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification(contact ? contact.name : 'New message', { body: previewText, tag: `chat-${contact ? contact.id : ''}` });
      notification.onclick = () => { window.focus(); if (contact) { switchInboxTab('direct'); selectContact(contact.id); } notification.close(); };
    } catch (e) { /* ignore */ }
  }
}

function updateUnreadBadge() {
  const total = Object.values(contacts).reduce((sum, c) => sum + (c.unread || 0), 0);
  const badge = el('unread-badge');
  if (badge) {
    badge.textContent = `${total} Unread`;
    badge.style.display = total > 0 ? '' : 'none';
  }
  document.title = total > 0 ? `(${total}) ProPartner | Messages` : 'ProPartner | Messages';
}

// ==========================================
// 4. INITIALIZATION
// ==========================================
async function initInbox() {
  // Old cache format held every profile and message; it is no longer used
  ['cachedProfiles', 'cachedContacts', 'cachedTeams'].forEach(key => localStorage.removeItem(key));

  loadSettings();

  // 1. Draw the last known conversation list straight away
  const cachedContacts = cacheGet('conversations');
  if (cachedContacts) {
    contacts = cachedContacts;
    renderContacts();
    updateUnreadBadge();
  }
  myTeams = cacheGet('teams') || [];

  // 2. Real-time connection and input handlers
  setupWebSocket();
  initEmojiPicker();
  initComposer();
  el('messages-scroll-area').addEventListener('scroll', handleMessagesScroll);
  el('chat-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); stepChatSearch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') toggleChatSearch();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentTab === 'direct' && activeContactId && contacts[activeContactId] && contacts[activeContactId].unread > 0) {
      markMessagesAsRead(activeContactId);
    }
  });
  setInterval(pollOnlineStatus, 60000);

  // 3. Everything the page needs, requested in parallel
  const autoUser = parseInt(new URLSearchParams(window.location.search).get('user'));
  const startup = [loadConversations(), fetchChatActionsState(), pollOnlineStatus(), fetchTeams()];
  if (autoUser && autoUser !== currentUserId) startup.push(ensureContact(autoUser));
  await Promise.allSettled(startup);

  // 4. Open the chat named in the URL, if any
  if (autoUser && autoUser !== currentUserId && contacts[autoUser]) {
    selectContact(autoUser);
  }

  // 5. Fetch the most recent conversations in the background so opening them is instant
  Object.values(contacts)
    .filter(c => !c.archived && c.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 3)
    .forEach(c => loadThread(c.id));
}

function contactFromCard(card) {
  return {
    id: card.id,
    name: card.name,
    profile_pic: card.profile_pic || '',
    college_name: card.college_name || '',
    department: card.department || '',
    skills: card.skills || '',
    lastMessage: '',
    timestamp: '',
    unread: 0,
    archived: false
  };
}

function previewLine(message) {
  const preview = getMessagePreview(message.content);
  return message.sender_id === currentUserId ? `You: ${preview}` : preview;
}

async function loadConversations() {
  let conversations;
  try {
    // The first load was already requested from the page head
    const prefetched = window.__inboxPrefetch ? await window.__inboxPrefetch : null;
    window.__inboxPrefetch = null;
    conversations = prefetched || await api('/api/conversations');
  } catch (err) {
    console.warn('loadConversations failed:', err.message);
    if (Object.keys(contacts).length === 0) renderContactsError(err.message);
    return;
  }

  const fresh = {};
  conversations.forEach(c => {
    const contact = contactFromCard(c);
    contact.lastMessage = previewLine(c.last_message);
    contact.timestamp = c.last_message.timestamp;
    contact.unread = c.unread;
    contact.archived = c.archived;
    fresh[c.id] = contact;
  });
  // Keep chats that were just started here and have no messages on the server yet
  Object.values(contacts).forEach(c => {
    if (!fresh[c.id] && (c.id === activeContactId || (threads[c.id] && threads[c.id].messages.some(m => !m.id)))) fresh[c.id] = c;
  });
  contacts = fresh;
  cacheSet('conversations', contacts);
  renderContacts();
  updateUnreadBadge();
  // The open conversation is being read right now
  if (activeContactId && contacts[activeContactId] && contacts[activeContactId].unread > 0 && currentTab === 'direct' && !document.hidden) {
    markMessagesAsRead(activeContactId);
  }
}

// Make sure a contact entry exists for this user (used for deep links, new chats and incoming messages)
async function ensureContact(userId) {
  if (contacts[userId]) return contacts[userId];
  try {
    const card = await api(`/api/users/${userId}/card`);
    if (!contacts[userId]) contacts[userId] = contactFromCard(card);
  } catch (err) {
    if (!contacts[userId]) contacts[userId] = contactFromCard({ id: userId, name: `User #${userId}` });
  }
  renderContacts();
  return contacts[userId];
}

async function fetchChatActionsState() {
  try {
    chatActionsState = await api('/api/chat/actions/state');
    updateComposerState();
  } catch (err) {
    console.warn('fetchChatActionsState failed:', err.message);
  }
}

// ==========================================
// 5. ONLINE STATUS
// ==========================================
async function pollOnlineStatus() {
  try {
    const data = await api('/api/users/online');
    onlineUserIds = new Set(data.online_user_ids || []);
    updateOnlineIndicators();
  } catch (e) { /* silent */ }
}

function updateOnlineIndicators() {
  const others = [...onlineUserIds].filter(id => id !== currentUserId).length;
  const onlineText = el('online-count-text');
  if (onlineText) onlineText.textContent = `${others} online`;

  document.querySelectorAll('#contactList [data-contact-id]').forEach(item => {
    const dot = item.querySelector('.online-dot');
    if (dot) dot.classList.toggle('offline', !onlineUserIds.has(parseInt(item.getAttribute('data-contact-id'))));
  });
  if (currentTab === 'direct' && activeContactId) {
    updateChatHeaderStatus();
    if (el('collab-info-panel').style.display === 'flex') updateInfoPanel();
  }
}

function updateChatHeaderStatus() {
  const c = contacts[activeContactId];
  if (!c) return;
  const infoEl = el('chat-header-info');
  const baseInfo = [c.college_name, c.department].filter(Boolean).join(' • ');
  const online = onlineUserIds.has(c.id);
  el('chat-header-online-dot').style.display = '';
  el('chat-header-online-dot').classList.toggle('offline', !online);
  if (online) {
    infoEl.innerHTML = `${baseInfo ? escapeHtml(baseInfo) + ' · ' : ''}<span class="text-tertiary font-semibold">Online</span>`;
  } else {
    infoEl.textContent = baseInfo || 'Offline';
  }
}

// ==========================================
// 6. TYPING INDICATOR
// ==========================================
function handleTypingInput() {
  const targetId = currentTab === 'direct' ? activeContactId : null;
  if (!targetId) return;

  if (!isTyping) {
    isTyping = true;
    wsSend({ type: 'typing', to: targetId, typing: true });
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => stopTyping(targetId), 2000);
}

function stopTyping(targetId) {
  clearTimeout(typingTimeout);
  if (isTyping && targetId) wsSend({ type: 'typing', to: targetId, typing: false });
  isTyping = false;
}

function setContactTyping(fromUserId, typing) {
  clearTimeout(typingUsers[fromUserId]);
  delete typingUsers[fromUserId];
  if (typing) {
    // If the "stopped typing" event is lost, clear it ourselves
    typingUsers[fromUserId] = setTimeout(() => setContactTyping(fromUserId, false), 4000);
  }
  renderTypingIndicator();
  const preview = document.querySelector(`#contactList [data-contact-id="${fromUserId}"] .contact-preview`);
  if (preview && contacts[fromUserId]) {
    preview.innerHTML = typing ? '<span class="text-tertiary font-semibold">typing...</span>' : contactPreviewHtml(contacts[fromUserId]);
  }
}

function renderTypingIndicator() {
  const active = currentTab === 'direct' && activeContactId && typingUsers[activeContactId] !== undefined;
  const indicator = el('typing-indicator');
  const wasActive = indicator.classList.contains('active');
  indicator.classList.toggle('active', !!active);
  el('chat-header-typing').classList.toggle('hidden', !active);
  el('chat-header-info').classList.toggle('hidden', !!active);

  if (active) {
    const c = contacts[activeContactId];
    el('typing-avatar').innerHTML = avatarHtml(c.profile_pic, c.name, 'text-[10px] font-bold');
    el('typing-name').textContent = `${c.name} is typing`;
    if (!wasActive && isNearBottom()) scrollToBottom();
  }
}

// ==========================================
// 7. CONVERSATION LIST
// ==========================================
function contactPreviewHtml(c) {
  return c.lastMessage ? escapeHtml(c.lastMessage) : '<span class="italic">New connection</span>';
}

function renderContactsError(message) {
  el('contactList').innerHTML = `
    <div class="flex flex-col items-center justify-center py-12 text-on-surface-variant text-center px-4">
      <span class="material-symbols-outlined text-[40px] text-outline mb-3">cloud_off</span>
      <p class="font-body-md text-body-md">Could not load your conversations.</p>
      <p class="font-body-sm text-body-sm text-outline mt-1">${escapeHtml(message)}</p>
      <button type="button" class="mt-3 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md" onclick="loadConversations()">Try again</button>
    </div>`;
}

function renderContacts() {
  const list = el('contactList');
  const query = listQuery;
  const sorted = Object.values(contacts)
    .filter(c => !!c.archived === showArchived)
    .filter(c => !query || c.name.toLowerCase().includes(query) || (c.lastMessage && c.lastMessage.toLowerCase().includes(query)))
    .sort((a, b) => {
      if (!a.timestamp && !b.timestamp) return 0;
      if (!a.timestamp) return -1;   // chats that were just started stay on top
      if (!b.timestamp) return 1;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

  el('list-title').textContent = showArchived ? 'Archived' : 'Messages';
  const archivedBtn = el('archived-toggle-btn');
  if (archivedBtn) {
    archivedBtn.classList.toggle('text-primary', showArchived);
    archivedBtn.title = showArchived ? 'Back to Messages' : 'Archived Messages';
  }

  if (sorted.length === 0) {
    const emptyText = query ? 'No conversations match your search.' : (showArchived ? 'No archived conversations.' : 'No conversations yet.');
    const emptyHint = query ? '' : (showArchived ? 'Archive a chat from its ⋮ menu to move it here.' : 'Start a new chat to get going!');
    list.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-on-surface-variant text-center px-4">
        <span class="material-symbols-outlined text-[40px] text-outline mb-3">${showArchived ? 'inventory_2' : 'chat_bubble_outline'}</span>
        <p class="font-body-md text-body-md">${emptyText}</p>
        <p class="font-body-sm text-body-sm text-outline mt-1">${emptyHint}</p>
      </div>`;
    return;
  }

  list.innerHTML = sorted.map(c => {
    const isActive = currentTab === 'direct' && activeContactId === c.id;
    const isOnline = onlineUserIds.has(c.id);
    const isMuted = chatActionsState.muted.includes(c.id);
    const isTypingNow = typingUsers[c.id] !== undefined;

    return `
      <div class="group relative p-space-sm rounded-xl ${isActive ? 'bg-primary-fixed/30 hover:bg-primary-fixed/40' : 'hover:bg-surface-container-low'} transition-all cursor-pointer mt-1" data-contact-id="${c.id}" onclick="selectContact(${c.id})">
        <div class="flex items-start gap-space-sm">
          <div class="relative shrink-0">
            <div class="w-12 h-12 rounded-xl bg-surface-container-high overflow-hidden flex items-center justify-center text-on-surface-variant font-headline-sm">
              ${avatarHtml(c.profile_pic, c.name, 'font-bold text-sm')}
            </div>
            <span class="online-dot ${isOnline ? '' : 'offline'}"></span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1">
              <span class="font-headline-sm text-headline-sm ${isActive || c.unread ? 'font-bold' : 'font-semibold'} text-on-surface truncate">${escapeHtml(c.name)}</span>
              <span class="font-label-sm text-[11px] ${isActive || c.unread ? 'text-primary font-semibold' : 'text-outline'} shrink-0">${formatTime(c.timestamp)}</span>
            </div>
            ${c.college_name ? `<div class="flex items-center gap-1 text-[12px] text-on-surface-variant mt-0.5"><span class="truncate">${escapeHtml(c.college_name)}${c.department ? ' • ' + escapeHtml(c.department) : ''}</span></div>` : ''}
            <div class="flex items-center justify-between gap-2 mt-1 text-body-sm ${c.unread ? 'text-on-surface font-semibold' : 'text-on-surface-variant'}">
              <p class="truncate contact-preview">${isTypingNow ? '<span class="text-tertiary font-semibold">typing...</span>' : contactPreviewHtml(c)}</p>
              <span class="flex items-center gap-1 shrink-0">
                ${isMuted ? '<span class="material-symbols-outlined text-[14px] text-outline" title="Muted">notifications_off</span>' : ''}
                ${c.unread ? `<span class="unread-pill">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
              </span>
            </div>
          </div>
        </div>
        ${isActive ? '<div class="absolute left-0 top-2 bottom-2 w-1 bg-primary rounded-r-full"></div>' : ''}
      </div>`;
  }).join('');
}

function toggleArchivedView() {
  showArchived = !showArchived;
  if (currentTab !== 'direct') switchInboxTab('direct');
  else renderContacts();
}

function filterConversations() {
  listQuery = el('conversation-search-input').value.toLowerCase().trim();
  if (currentTab === 'direct') renderContacts();
  else renderGroups();
}

// ==========================================
// 8. DIRECT CHAT: THREADS
// ==========================================
function getThread(contactId) {
  if (!threads[contactId]) {
    threads[contactId] = { messages: [], hasMore: true, loaded: false, loading: false, stale: false };
    // Show the last messages we saw for this chat until the server answers
    const cached = cacheGet(`thread:${contactId}`);
    if (Array.isArray(cached)) threads[contactId].messages = cached.map(m => Object.assign(m, { key: 'm' + m.id }));
  }
  return threads[contactId];
}

function saveThreadCache(contactId) {
  const thread = threads[contactId];
  if (!thread) return;
  const recent = thread.messages
    .filter(m => m.id && String(m.content).length <= 4000)
    .slice(-30)
    .map(m => ({ id: m.id, sender_id: m.sender_id, receiver_id: m.receiver_id, content: m.content, timestamp: m.timestamp, message_status: m.message_status }));
  cacheSet(`thread:${contactId}`, recent);
}

// Saved messages are ordered by id; messages still being sent stay at the end
function sortMessages(messages) {
  messages.sort((a, b) => {
    if (a.id && b.id) return a.id - b.id;
    if (a.id) return -1;
    if (b.id) return 1;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}

function mergeServerMessages(thread, serverMessages) {
  serverMessages.forEach(sm => {
    const existing = thread.messages.find(m => m.id === sm.id);
    if (existing) {
      existing.content = sm.content;
      existing.message_status = sm.message_status;
      existing.timestamp = sm.timestamp;
    } else {
      thread.messages.push(Object.assign({ key: 'm' + sm.id }, sm));
    }
  });
  sortMessages(thread.messages);
}

// Loads the newest page of a conversation. Safe to call repeatedly.
async function loadThread(contactId) {
  const thread = getThread(contactId);
  if (thread.loading || (thread.loaded && !thread.stale)) return thread;
  thread.loading = true;
  try {
    const page = await api(`/api/messages/with/${contactId}?limit=${PAGE_SIZE}`);
    // Anything we hold in the range this page covers but the server no longer has was deleted or cleared
    const pageIds = new Set(page.messages.map(m => m.id));
    const knownIds = new Set(thread.messages.map(m => m.id).filter(Boolean));
    const oldestInPage = page.messages.length ? page.messages[0].id : 0;
    thread.messages = thread.messages.filter(m => !m.id || pageIds.has(m.id) || (thread.loaded && m.id < oldestInPage));
    // A message we were still sending may have been saved just before the connection dropped
    const arrived = page.messages.filter(s => s.sender_id === currentUserId && !knownIds.has(s.id));
    thread.messages = thread.messages.filter(m => m.id || !arrived.some(s => s.content === m.content));
    mergeServerMessages(thread, page.messages);
    if (!thread.loaded) thread.hasMore = page.has_more;
    thread.loaded = true;
    thread.stale = false;
    thread.error = null;
    saveThreadCache(contactId);
  } catch (err) {
    thread.error = err.message;
  } finally {
    thread.loading = false;
  }
  if (currentTab === 'direct' && activeContactId === contactId) renderChat();
  return thread;
}

async function loadOlderMessages() {
  const view = currentView();
  if (!view || !view.thread.loaded || !view.thread.hasMore || view.thread.loadingOlder) return;
  const oldest = view.thread.messages.find(m => m.id);
  if (!oldest) return;

  view.thread.loadingOlder = true;
  const scrollArea = el('messages-scroll-area');
  const previousHeight = scrollArea.scrollHeight;
  const previousTop = scrollArea.scrollTop;
  try {
    if (view.type === 'direct') {
      const page = await api(`/api/messages/with/${view.id}?limit=${PAGE_SIZE}&before_id=${oldest.id}`);
      mergeServerMessages(view.thread, page.messages);
      view.thread.hasMore = page.has_more;
    } else {
      const page = await api(`/api/channels/${view.id}/messages?limit=${PAGE_SIZE}&before_id=${oldest.id}`);
      mergeServerMessages(view.thread, page);
      view.thread.hasMore = page.length === PAGE_SIZE;
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    view.thread.loadingOlder = false;
  }

  const stillOpen = currentView();
  if (stillOpen && stillOpen.thread === view.thread) {
    renderActiveThread({ keepScroll: true });
    scrollArea.scrollTop = scrollArea.scrollHeight - previousHeight + previousTop;
  }
}

function handleMessagesScroll() {
  if (el('messages-scroll-area').scrollTop < 80) loadOlderMessages();
}

function fillViewportIfShort() {
  const area = el('messages-scroll-area');
  if (area.scrollHeight <= area.clientHeight) loadOlderMessages();
}

// The thread currently on screen, direct or group
function currentView() {
  if (currentTab === 'direct' && activeContactId) return { type: 'direct', id: activeContactId, thread: getThread(activeContactId) };
  if (currentTab === 'groups' && activeChannelId && channelThreads[activeChannelId]) return { type: 'group', id: activeChannelId, thread: channelThreads[activeChannelId] };
  return null;
}

function renderActiveThread(options) {
  if (currentTab === 'direct') renderChat(options);
  else renderTeamChat(options);
}

function isNearBottom() {
  const area = el('messages-scroll-area');
  return area.scrollHeight - area.scrollTop - area.clientHeight < 160;
}

function scrollToBottom() {
  const area = el('messages-scroll-area');
  area.scrollTop = area.scrollHeight;
}

function showChatPane() {
  el('empty-chat-state').style.display = 'none';
  el('active-chat-container').style.display = 'flex';
  document.body.classList.add('chat-open');
}

function showEmptyPane() {
  el('empty-chat-state').style.display = 'flex';
  el('active-chat-container').style.display = 'none';
  document.body.classList.remove('chat-open');
}

// Back button on phones: return to the list
function closeActiveChat() {
  if (currentTab === 'direct') {
    stopTyping(activeContactId);
    activeContactId = null;
    renderContacts();
  } else {
    activeTeamId = null;
    activeChannelId = null;
    closeTeamSocket();
    renderGroups();
  }
  showEmptyPane();
}

function selectContact(id) {
  if (!contacts[id]) return;
  if (activeContactId && activeContactId !== id) stopTyping(activeContactId);
  activeContactId = id;
  if (contacts[id].archived !== showArchived) showArchived = !!contacts[id].archived;

  showChatPane();
  closeChatSearch();
  renderChat();
  renderContacts();
  updateComposerState();
  updateInfoPanel();
  renderTypingIndicator();
  loadThread(id);
  if (contacts[id].unread > 0) markMessagesAsRead(id);
  el('message-input').focus();
}

async function markMessagesAsRead(contactId) {
  const contact = contacts[contactId];
  if (contact && contact.unread) {
    contact.unread = 0;
    renderContacts();
    updateUnreadBadge();
    cacheSet('conversations', contacts);
  }
  try {
    await api(`/api/messages/read/${contactId}`, { method: 'POST' });
  } catch (e) { /* will be retried the next time the chat is opened */ }
}

// ==========================================
// 9. DIRECT CHAT: RENDERING
// ==========================================
function getTickHtml(msg) {
  if (msg.sender_id !== currentUserId) return '';
  const status = msg.message_status || 'sent';

  if (status === 'sending') {
    return `<span class="material-symbols-outlined text-[13px] text-outline opacity-60 animate-spin" title="Sending...">progress_activity</span>`;
  } else if (status === 'failed') {
    return `<span class="material-symbols-outlined text-[14px] text-error" title="Failed to send">error</span>`;
  } else if (status === 'read') {
    return `<span class="material-symbols-outlined text-[14px]" style="color: #3b82f6;" title="Read">done_all</span>`;
  } else if (status === 'delivered') {
    return `<span class="material-symbols-outlined text-[14px] text-outline" title="Delivered">done_all</span>`;
  }
  return `<span class="material-symbols-outlined text-[14px] text-outline" title="Sent">check</span>`;
}

function daySeparatorHtml(ts) {
  return `
    <div class="flex items-center justify-center my-space-xs" data-day-separator>
      <div class="px-space-sm py-1 rounded-full bg-surface-container-high/80 text-on-surface-variant font-label-sm text-label-sm border border-outline-variant/30 shadow-xs">${escapeHtml(formatDay(ts))}</div>
    </div>`;
}

function sentActionsHtml(msg, scope) {
  if (msg.message_status === 'failed') {
    return `
      <button class="text-[11px] font-semibold text-primary hover:underline" type="button" onclick="retryMessage('${msg.key}')">Retry</button>
      <button class="text-[11px] font-semibold text-error hover:underline" type="button" onclick="discardMessage('${msg.key}')">Delete</button>`;
  }
  if (!msg.id) return '';
  const handler = scope === 'group' ? `deleteTeamMessage(${msg.id})` : `deleteMessage(${msg.id})`;
  return `
    <button class="hidden group-hover/msg:inline-flex p-0.5 text-on-surface-variant hover:text-error transition-colors" title="Delete message" type="button" onclick="${handler}">
      <span class="material-symbols-outlined text-[14px]">delete</span>
    </button>`;
}

function directBubbleHtml(msg, contact, animate) {
  const isSent = msg.sender_id === currentUserId;
  const contentHtml = renderMessageContent(msg.content);
  const fade = animate ? ' animate-fade-in' : '';

  if (isSent) {
    return `
      <div class="flex flex-col items-end ml-auto max-w-[85%] md:max-w-[70%] group/msg w-full${fade}" data-msg-key="${msg.key}">
        <div class="msg-bubble px-4 py-2.5 rounded-2xl rounded-br-xs bg-primary text-on-primary shadow-sm text-body-md font-medium whitespace-pre-wrap break-words" data-msg-id="${msg.id || ''}">${contentHtml}</div>
        <div class="flex items-center gap-1.5 mt-1 mr-1">
          <span class="font-label-sm text-[10px] text-outline">${formatClock(msg.timestamp)}</span>
          ${getTickHtml(msg)}
          ${sentActionsHtml(msg, 'direct')}
        </div>
      </div>`;
  }
  return `
    <div class="flex items-end gap-2.5 max-w-[85%] md:max-w-[70%] group/msg w-full${fade}" data-msg-key="${msg.key}">
      <div class="w-8 h-8 rounded-lg overflow-hidden bg-primary-fixed shrink-0 self-end mb-1 flex items-center justify-center text-on-primary-fixed">${avatarHtml(contact.profile_pic, contact.name, 'text-[10px] font-bold')}</div>
      <div class="flex flex-col min-w-0">
        <div class="msg-bubble px-4 py-2.5 rounded-2xl rounded-bl-xs bg-surface-container-lowest border border-outline-variant/20 shadow-xs text-on-surface text-body-md whitespace-pre-wrap break-words" data-msg-id="${msg.id || ''}">${contentHtml}</div>
        <div class="flex items-center gap-1 ml-1 mt-1">
          <span class="font-label-sm text-[10px] text-outline">${formatClock(msg.timestamp)}</span>
        </div>
      </div>
    </div>`;
}

function threadStatusHtml(thread, emptyHtml) {
  if (thread.error && !thread.loaded && thread.messages.length === 0) {
    return `
      <div class="flex flex-col items-center justify-center h-full text-on-surface-variant text-center">
        <span class="material-symbols-outlined text-[48px] text-outline mb-3">cloud_off</span>
        <p class="font-body-md text-body-md">Could not load messages.</p>
        <p class="font-body-sm text-body-sm text-outline mt-1">${escapeHtml(thread.error)}</p>
        <button type="button" class="mt-3 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md" onclick="retryLoadActiveThread()">Try again</button>
      </div>`;
  }
  if (!thread.loaded && thread.messages.length === 0) {
    return `
      <div class="flex flex-col items-center justify-center h-full text-on-surface-variant">
        <div class="w-8 h-8 border-4 border-primary-fixed border-t-primary rounded-full animate-spin mb-3"></div>
        <p class="font-body-md text-body-md">Loading messages...</p>
      </div>`;
  }
  return emptyHtml;
}

function retryLoadActiveThread() {
  const view = currentView();
  if (!view) return;
  view.thread.error = null;
  if (view.type === 'direct') { renderChat(); loadThread(view.id); }
  else { renderTeamChat(); loadChannelThread(view.id); }
}

function renderChatHeaderForContact(c) {
  el('chat-header-avatar').innerHTML = avatarHtml(c.profile_pic, c.name, 'text-on-primary font-bold');
  el('chat-header-name').textContent = c.name;
  updateChatHeaderStatus();
  el('chat-header-profile-link').onclick = () => { window.location.href = `profile.html?id=${c.id}`; };
  el('message-input').placeholder = `Message ${c.name}...`;
  el('voice-call-btn').style.display = '';
  el('video-call-btn').style.display = '';
}

function renderChat(options = {}) {
  if (currentTab !== 'direct' || !activeContactId || !contacts[activeContactId]) return;
  const c = contacts[activeContactId];
  const thread = getThread(activeContactId);
  const scrollArea = el('messages-scroll-area');

  renderChatHeaderForContact(c);

  if (thread.messages.length === 0) {
    scrollArea.innerHTML = threadStatusHtml(thread, `
      <div class="flex flex-col items-center justify-center h-full text-on-surface-variant">
        <span class="material-symbols-outlined text-[48px] text-outline mb-3">waving_hand</span>
        <p class="font-body-md text-body-md">No messages yet.</p>
        <p class="font-body-sm text-body-sm text-outline mt-1">Say hi to ${escapeHtml(c.name)}!</p>
      </div>`);
    return;
  }

  let lastDay = '';
  let html = thread.loaded && thread.hasMore
    ? '<div class="flex justify-center py-2"><div class="w-5 h-5 border-2 border-primary-fixed border-t-primary rounded-full animate-spin"></div></div>'
    : '';
  thread.messages.forEach(msg => {
    const day = formatDay(msg.timestamp);
    if (day !== lastDay) {
      lastDay = day;
      html += daySeparatorHtml(msg.timestamp);
    }
    html += directBubbleHtml(msg, c, false);
  });

  scrollArea.innerHTML = html;
  if (!options.keepScroll) scrollToBottom();
  if (chatSearchQuery) searchInChat();
  fillViewportIfShort();
}

// Adds one new message to the bottom of the open conversation without redrawing the rest
function appendBubble(msg, html) {
  const scrollArea = el('messages-scroll-area');
  const stick = isNearBottom() || msg.sender_id === currentUserId;
  if (!scrollArea.querySelector('[data-msg-key]')) scrollArea.innerHTML = '';

  const view = currentView();
  const previous = view ? view.thread.messages[view.thread.messages.indexOf(msg) - 1] : null;
  if (!previous || formatDay(previous.timestamp) !== formatDay(msg.timestamp)) {
    scrollArea.insertAdjacentHTML('beforeend', daySeparatorHtml(msg.timestamp));
  }
  scrollArea.insertAdjacentHTML('beforeend', html);
  if (stick) scrollToBottom();
}

function replaceBubble(msg, html) {
  const node = document.querySelector(`#messages-scroll-area [data-msg-key="${msg.key}"]`);
  if (!node) return false;
  node.outerHTML = html;
  return true;
}

function removeBubble(key) {
  const node = document.querySelector(`#messages-scroll-area [data-msg-key="${key}"]`);
  if (!node) return;
  const before = node.previousElementSibling;
  const after = node.nextElementSibling;
  node.remove();
  // Drop a date heading that no longer has any messages under it
  if (before && before.hasAttribute('data-day-separator') && (!after || after.hasAttribute('data-day-separator'))) before.remove();
}

function refreshDirectBubble(contactId, msg) {
  if (currentTab === 'direct' && activeContactId === contactId && contacts[contactId]) {
    replaceBubble(msg, directBubbleHtml(msg, contacts[contactId], false));
  }
}

// Puts a contact's latest message into the list entry
function touchContact(contactId, message) {
  const contact = contacts[contactId];
  if (!contact) return;
  contact.lastMessage = previewLine(message);
  contact.timestamp = message.timestamp;
  cacheSet('conversations', contacts);
  renderContacts();
}

function refreshContactPreview(contactId) {
  const contact = contacts[contactId];
  const thread = threads[contactId];
  if (!contact || !thread) return;
  const last = thread.messages[thread.messages.length - 1];
  if (last) {
    contact.lastMessage = previewLine(last);
    contact.timestamp = last.timestamp;
  } else if (thread.loaded && !thread.hasMore) {
    contact.lastMessage = '';
    contact.timestamp = '';
  } else {
    loadConversations();
    return;
  }
  cacheSet('conversations', contacts);
  renderContacts();
}

// ==========================================
// 10. SENDING MESSAGES
// ==========================================
function wsSend(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(payload)); return true; } catch (e) { /* fall through */ }
  }
  return false;
}

function initComposer() {
  const input = el('message-input');
  const form = el('chat-composer-form');

  input.addEventListener('input', () => { autoGrowInput(); handleTypingInput(); });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const send = settings.enterToSend ? !e.shiftKey : (e.ctrlKey || e.metaKey);
    if (send) {
      e.preventDefault();
      submitComposer();
    }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (files.length) {
      e.preventDefault();
      sendFiles(files);
    }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); submitComposer(); });
}

function submitComposer() {
  const input = el('message-input');
  const content = input.value.trim();
  if (!content) return;
  if (!sendMessage(content)) return;

  input.value = '';
  autoGrowInput();
  el('emoji-picker').classList.remove('active');
  input.focus();
}

// Sends to whatever is open. Returns false if nothing is open or sending is not allowed.
function sendMessage(content) {
  if (currentTab === 'direct') {
    if (!activeContactId) return false;
    if (chatActionsState.blocked.includes(activeContactId)) {
      showToast('You have blocked this user. Unblock them to send a message.');
      return false;
    }
    stopTyping(activeContactId);
    sendDirectMessage(activeContactId, content);
    return true;
  }
  if (!activeChannelId) return false;
  sendTeamMessage(activeChannelId, content);
  return true;
}

function sendDirectMessage(contactId, content) {
  const thread = getThread(contactId);
  const tempId = newTempId();
  const msg = {
    id: null,
    key: tempId,
    temp_id: tempId,
    sender_id: currentUserId,
    receiver_id: contactId,
    content: content,
    timestamp: new Date().toISOString(),
    message_status: 'sending'
  };
  thread.messages.push(msg);

  if (currentTab === 'direct' && activeContactId === contactId) {
    appendBubble(msg, directBubbleHtml(msg, contacts[contactId], true));
  }
  touchContact(contactId, msg);
  transmitDirectMessage(msg);
}

async function transmitDirectMessage(msg) {
  const contactId = msg.receiver_id;
  if (wsSend({ type: 'chat_message', to: contactId, content: msg.content, temp_id: msg.temp_id })) {
    // No acknowledgement from the server means the message did not go through
    setTimeout(() => {
      if (msg.message_status === 'sending') markMessageFailed(msg);
    }, 20000);
    return;
  }

  // Not connected right now: send over HTTP instead
  try {
    const saved = await api('/api/messages', {
      method: 'POST',
      body: { sender_id: currentUserId, receiver_id: contactId, content: msg.content, temp_id: msg.temp_id }
    });
    confirmDirectMessage(msg, saved.id, saved.message_status || 'sent', saved.timestamp);
  } catch (err) {
    markMessageFailed(msg, err.status === 403 || err.status === 400 ? err.message : null);
  }
}

function confirmDirectMessage(msg, id, status, timestamp) {
  msg.id = id;
  if (msg.message_status === 'sending' || msg.message_status === 'failed') msg.message_status = status;
  msg.timestamp = timestamp || msg.timestamp;
  refreshDirectBubble(msg.receiver_id, msg);
  saveThreadCache(msg.receiver_id);
}

function markMessageFailed(msg, reason) {
  msg.message_status = 'failed';
  refreshDirectBubble(msg.receiver_id, msg);
  if (reason) showToast(reason);
}

function findPendingMessage(key) {
  for (const contactId of Object.keys(threads)) {
    const msg = threads[contactId].messages.find(m => m.key === key);
    if (msg) return { msg, contactId: parseInt(contactId) };
  }
  return null;
}

function retryMessage(key) {
  const found = findPendingMessage(key);
  if (found) {
    found.msg.message_status = 'sending';
    refreshDirectBubble(found.contactId, found.msg);
    transmitDirectMessage(found.msg);
    return;
  }
  retryTeamMessage(key);
}

function discardMessage(key) {
  const found = findPendingMessage(key);
  if (found) {
    const thread = threads[found.contactId];
    thread.messages = thread.messages.filter(m => m.key !== key);
    if (currentTab === 'direct' && activeContactId === found.contactId) removeBubble(key);
    refreshContactPreview(found.contactId);
    return;
  }
  discardTeamMessage(key);
}

// ===== MESSAGE DELETION =====
function deleteMessage(msgId) {
  window.showSystemModal('Delete Message', 'Delete this message for everyone in this chat?', 'confirm', async () => {
    try {
      await api(`/api/messages/${msgId}`, { method: 'DELETE' });
      applyDirectDeletion(msgId);
    } catch (err) {
      showToast(err.message);
    }
  }, 'Delete');
}

function applyDirectDeletion(msgId, contactIdHint) {
  const contactIds = contactIdHint ? [contactIdHint] : Object.keys(threads).map(Number);
  contactIds.forEach(contactId => {
    const thread = threads[contactId];
    if (!thread) return;
    const msg = thread.messages.find(m => m.id === msgId);
    if (!msg) return;
    thread.messages = thread.messages.filter(m => m !== msg);
    if (currentTab === 'direct' && activeContactId === contactId) {
      removeBubble(msg.key);
      if (thread.messages.length === 0) renderChat();
    }
    saveThreadCache(contactId);
    refreshContactPreview(contactId);
  });
}

// ==========================================
// 11. REAL-TIME CONNECTION
// ==========================================
function setConnectionStatus(connected) {
  const status = el('connection-status');
  if (!status) return;
  status.className = `flex items-center gap-1 ${connected ? 'text-tertiary' : 'text-error'}`;
  status.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${connected ? 'bg-tertiary' : 'bg-error animate-pulse'}"></span><span>${connected ? 'Connected' : 'Reconnecting...'}</span>`;
}

function setupWebSocket() {
  ws = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/api/ws/${currentUserId}`);

  ws.onopen = () => {
    wsRetryDelay = 1000;
    setConnectionStatus(true);
    if (wsHasConnectedBefore) resyncAfterReconnect();
    wsHasConnectedBefore = true;
  };

  ws.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    handleSocketEvent(data);
  };

  ws.onclose = async () => {
    setConnectionStatus(false);
    // The server closes the socket when the login has expired: check before retrying forever
    try {
      const res = await fetch(`${API_BASE}/api/users/online`, { credentials: 'include' });
      if (res.status === 401) return handleLoggedOut();
    } catch (e) { /* server unreachable, keep retrying */ }
    setTimeout(setupWebSocket, wsRetryDelay);
    wsRetryDelay = Math.min(wsRetryDelay * 2, 10000);
  };
  ws.onerror = () => { try { ws.close(); } catch (e) { /* already closed */ } };
}

// Messages may have arrived while we were disconnected
function resyncAfterReconnect() {
  Object.values(threads).forEach(thread => { if (thread.loaded) thread.stale = true; });
  loadConversations();
  pollOnlineStatus();
  if (currentTab === 'direct' && activeContactId) loadThread(activeContactId);
  // Messages still marked as sending were in flight when the connection dropped:
  // check what the server already has, then send whatever is still missing
  Object.keys(threads).forEach(async (contactId) => {
    if (!threads[contactId].messages.some(m => !m.id && m.message_status === 'sending')) return;
    await loadThread(parseInt(contactId));
    threads[contactId].messages.filter(m => !m.id && m.message_status === 'sending').forEach(m => transmitDirectMessage(m));
  });
}

function handleSocketEvent(data) {
  switch (data.type) {
    case 'typing':
      setContactTyping(data.from, !!data.typing);
      return;

    case 'presence':
      if (data.online) onlineUserIds.add(data.user_id); else onlineUserIds.delete(data.user_id);
      updateOnlineIndicators();
      return;

    case 'read_receipt':
      applyStatusReceipt(data.reader_id, data.message_ids || [], 'read');
      return;

    case 'delivered_receipt':
      applyStatusReceipt(data.receiver_id, data.message_ids || [], 'delivered');
      return;

    case 'message_ack': {
      const found = findPendingMessage(data.temp_id);
      if (found) confirmDirectMessage(found.msg, data.id, data.message_status || 'sent', data.timestamp);
      return;
    }

    case 'message_failed': {
      const found = findPendingMessage(data.temp_id);
      if (found) markMessageFailed(found.msg, data.detail);
      else if (data.detail) showToast(data.detail);
      return;
    }

    case 'message_deleted':
      applyDirectDeletion(data.id, data.sender_id === currentUserId ? data.receiver_id : data.sender_id);
      return;

    case 'message_id_update':
      return;
  }

  if (data.type && data.type.startsWith('call_')) {
    if (typeof handleCallSignal === 'function') handleCallSignal(data);
    return;
  }

  if (data.content !== undefined && data.sender_id !== undefined) handleIncomingMessage(data);
}

function applyStatusReceipt(contactId, messageIds, status) {
  const thread = threads[contactId];
  if (!thread) return;
  const ids = new Set(messageIds);
  thread.messages.forEach(m => {
    if (!ids.has(m.id) || m.message_status === 'read' || m.message_status === status) return;
    m.message_status = status;
    refreshDirectBubble(contactId, m);
  });
  saveThreadCache(contactId);
}

async function handleIncomingMessage(data) {
  const otherId = data.sender_id === currentUserId ? data.receiver_id : data.sender_id;
  const thread = getThread(otherId);

  // Our own message coming back (sent from another tab, or echoed): match it to what we already show
  const existing = thread.messages.find(m => (data.id && m.id === data.id) || (data.temp_id && m.temp_id === data.temp_id));
  if (existing) {
    if (!existing.id && data.id) confirmDirectMessage(existing, data.id, data.message_status, data.timestamp);
    return;
  }

  const msg = {
    id: data.id,
    key: 'm' + data.id,
    sender_id: data.sender_id,
    receiver_id: data.receiver_id,
    content: data.content,
    timestamp: data.timestamp,
    message_status: data.message_status || 'sent'
  };
  thread.messages.push(msg);
  sortMessages(thread.messages);
  saveThreadCache(otherId);

  const contact = await ensureContact(otherId);
  const isIncoming = data.sender_id !== currentUserId;
  const isOpen = currentTab === 'direct' && activeContactId === otherId;

  if (isIncoming) setContactTyping(otherId, false);
  if (isOpen) {
    appendBubble(msg, directBubbleHtml(msg, contact, true));
  }

  if (isIncoming) {
    if (isOpen && !document.hidden) {
      markMessagesAsRead(otherId);
    } else {
      contact.unread = (contact.unread || 0) + 1;
      updateUnreadBadge();
    }
    const muted = data.muted || chatActionsState.muted.includes(otherId);
    if (!muted && (!isOpen || document.hidden)) notifyIncoming(contact, getMessagePreview(msg.content));
  }
  touchContact(otherId, msg);
}

// ==========================================
// 12. COMPOSER STATE AND CHAT ACTIONS
// ==========================================
function updateComposerState() {
  const blocked = currentTab === 'direct' && activeContactId && chatActionsState.blocked.includes(activeContactId);
  el('blocked-msg-area').classList.toggle('hidden', !blocked);
  el('chat-composer-form').style.display = blocked ? 'none' : '';
}

function closeChatActionsMenu(e) {
  const menu = el('chat-actions-menu');
  const btn = el('chat-actions-btn');
  if (!e || (!menu.contains(e.target) && !btn.contains(e.target))) {
    menu.classList.add('hidden');
    document.removeEventListener('click', closeChatActionsMenu);
  }
}

function toggleChatActionsMenu() {
  const menu = el('chat-actions-menu');
  if (!menu.classList.contains('hidden')) return closeChatActionsMenu();

  const items = currentTab === 'direct' ? directMenuItems() : groupMenuItems();
  if (items.length === 0) return;
  menu.innerHTML = items.map(item => item === 'divider'
    ? '<div class="h-[1px] w-full bg-outline-variant/30 my-1"></div>'
    : `<button type="button" onclick="closeChatActionsMenu(); ${item.action}" class="w-full text-left px-4 py-2.5 text-body-sm font-medium ${item.danger ? 'text-error hover:bg-error/10' : 'text-on-surface hover:bg-surface-container'} transition-colors flex items-center gap-3">
        <span class="material-symbols-outlined text-[20px]">${item.icon}</span>
        <span>${item.label}</span>
      </button>`).join('');
  menu.classList.remove('hidden');
  setTimeout(() => document.addEventListener('click', closeChatActionsMenu), 10);
}

function directMenuItems() {
  if (!activeContactId || !contacts[activeContactId]) return [];
  const isMuted = chatActionsState.muted.includes(activeContactId);
  const isBlocked = chatActionsState.blocked.includes(activeContactId);
  const isArchived = contacts[activeContactId].archived;
  return [
    { icon: isMuted ? 'notifications_active' : 'notifications_off', label: isMuted ? 'Unmute notifications' : 'Mute notifications', action: 'toggleMute()' },
    { icon: isArchived ? 'unarchive' : 'archive', label: isArchived ? 'Unarchive chat' : 'Archive chat', action: 'toggleArchive()' },
    { icon: 'delete_sweep', label: 'Clear chat history', action: 'clearChatHistory()' },
    'divider',
    { icon: 'block', label: isBlocked ? 'Unblock user' : 'Block user', action: 'toggleBlock()', danger: true }
  ];
}

async function toggleMute() {
  const contactId = activeContactId;
  if (!contactId) return;
  try {
    const data = await api(`/api/users/${contactId}/mute`, { method: 'POST' });
    chatActionsState.muted = chatActionsState.muted.filter(id => id !== contactId);
    if (data.status === 'muted') chatActionsState.muted.push(contactId);
    showToast(data.status === 'muted' ? 'Notifications muted for this chat.' : 'Notifications turned back on for this chat.');
    renderContacts();
    if (activeContactId === contactId) updateInfoPanel();
  } catch (err) {
    showToast(err.message);
  }
}

function toggleBlock() {
  const contactId = activeContactId;
  if (!contactId || !contacts[contactId]) return;
  const isBlocked = chatActionsState.blocked.includes(contactId);
  const name = escapeHtml(contacts[contactId].name);
  const message = isBlocked
    ? `Unblock ${name}? You will be able to message each other again.`
    : `Block ${name}? You will not be able to message or call each other.`;

  window.showSystemModal(isBlocked ? 'Unblock User' : 'Block User', message, 'confirm', async () => {
    try {
      const data = await api(`/api/users/${contactId}/block`, { method: 'POST' });
      chatActionsState.blocked = chatActionsState.blocked.filter(id => id !== contactId);
      if (data.status === 'blocked') chatActionsState.blocked.push(contactId);
      updateComposerState();
      if (activeContactId === contactId) updateInfoPanel();
      showToast(data.status === 'blocked' ? 'User blocked.' : 'User unblocked.');
    } catch (err) {
      showToast(err.message);
    }
  }, isBlocked ? 'Unblock' : 'Block');
}

function clearChatHistory() {
  const contactId = activeContactId;
  if (!contactId || !contacts[contactId]) return;
  const name = escapeHtml(contacts[contactId].name);

  window.showSystemModal('Clear Chat History', `Clear your chat history with ${name}? This only clears it for you and cannot be undone.`, 'confirm', async () => {
    try {
      await api(`/api/users/${contactId}/clear_chat`, { method: 'POST' });
      threads[contactId] = { messages: [], hasMore: false, loaded: true, loading: false, stale: false };
      saveThreadCache(contactId);
      contacts[contactId].lastMessage = '';
      contacts[contactId].timestamp = '';
      contacts[contactId].unread = 0;
      cacheSet('conversations', contacts);
      updateUnreadBadge();
      renderContacts();
      if (activeContactId === contactId) renderChat();
    } catch (err) {
      showToast(err.message);
    }
  }, 'Clear');
}

async function toggleArchive() {
  const contactId = activeContactId;
  if (!contactId || !contacts[contactId]) return;
  try {
    const data = await api(`/api/users/${contactId}/archive`, { method: 'POST' });
    contacts[contactId].archived = data.status === 'archived';
    cacheSet('conversations', contacts);
    showToast(data.status === 'archived' ? 'Chat archived. Find it under the Archived button.' : 'Chat moved back to Messages.');
    // Leave the chat that just moved to the other list
    activeContactId = null;
    showEmptyPane();
    renderContacts();
  } catch (err) {
    showToast(err.message);
  }
}

// ==========================================
// 13. INFO PANEL
// ==========================================
function updateInfoPanel() {
  if (currentTab === 'groups') {
    updateTeamInfoPanel();
    return;
  }
  if (!activeContactId || !contacts[activeContactId]) return;
  const c = contacts[activeContactId];
  const panel = el('info-panel-content');

  const picture = c.profile_pic
    ? `<img src="${escapeHtml(c.profile_pic)}" alt="${escapeHtml(c.name)}" class="w-full h-full object-cover"/>`
    : `<div class="w-full h-full rounded-2xl bg-primary-fixed flex items-center justify-center"><span class="text-2xl font-bold text-on-primary-fixed">${escapeHtml(getInitials(c.name))}</span></div>`;

  const isOnline = onlineUserIds.has(c.id);
  const isMuted = chatActionsState.muted.includes(c.id);
  const isBlocked = chatActionsState.blocked.includes(c.id);
  const skillsHtml = c.skills
    ? c.skills.split(',').map(s => s.trim()).filter(Boolean).map(s =>
        `<span class="px-2.5 py-1 rounded-lg bg-surface-container text-on-surface font-skill-pill text-skill-pill border border-outline-variant/30 font-medium">${escapeHtml(s)}</span>`
      ).join('')
    : '<span class="text-outline font-body-sm text-body-sm">No skills listed</span>';

  panel.innerHTML = `
    <div class="p-space-md flex flex-col items-center text-center border-b border-outline-variant/20">
      <div class="relative mb-space-xs">
        <div class="w-20 h-20 rounded-2xl overflow-hidden shadow-sm bg-primary-fixed">${picture}</div>
        <span class="online-dot ${isOnline ? '' : 'offline'}" style="width:14px;height:14px;border-width:3px;bottom:-2px;right:-2px;"></span>
      </div>
      <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">${escapeHtml(c.name)}</h4>
      <p class="font-label-sm text-label-sm ${isOnline ? 'text-tertiary' : 'text-outline'} mt-0.5 font-semibold">${isOnline ? '● Online' : '○ Offline'}</p>
      ${c.college_name ? `<p class="font-body-sm text-body-sm text-primary font-medium mt-0.5">${escapeHtml(c.college_name)}${c.department ? ' • ' + escapeHtml(c.department) : ''}</p>` : ''}
      <div class="flex items-center gap-space-xs mt-space-sm w-full">
        <a class="flex-1 py-1.5 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md font-semibold text-center transition-colors" href="profile.html?id=${c.id}">View Profile</a>
      </div>
    </div>
    <div class="p-space-md border-b border-outline-variant/20">
      <span class="font-label-sm text-label-sm uppercase tracking-wider text-outline font-bold">Skills</span>
      <div class="flex flex-wrap gap-1.5 mt-space-xs">${skillsHtml}</div>
    </div>
    <div class="p-space-md flex flex-col gap-2">
      <button type="button" class="w-full py-2 px-3 rounded-xl bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-on-surface font-label-md text-label-md flex items-center justify-between transition-colors" onclick="toggleMute()">
        <span class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">${isMuted ? 'notifications_active' : 'notifications_off'}</span>${isMuted ? 'Unmute Notifications' : 'Mute Notifications'}</span>
        <span class="text-[11px] font-semibold ${isMuted ? 'text-error' : 'text-outline'}">${isMuted ? 'Muted' : 'On'}</span>
      </button>
      <button type="button" class="w-full py-2 px-3 rounded-xl bg-surface-container-low hover:bg-error-container/20 text-on-surface-variant hover:text-error font-label-md text-label-md flex items-center justify-between transition-colors" onclick="toggleBlock()">
        <span class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">block</span>${isBlocked ? 'Unblock User' : 'Block User'}</span>
        <span class="material-symbols-outlined text-[16px] text-outline">chevron_right</span>
      </button>
    </div>`;
}

function toggleInfoPanel() {
  const panel = el('collab-info-panel');
  if (panel.style.display === 'none' || !panel.style.display) {
    panel.style.display = 'flex';
    updateInfoPanel();
  } else {
    panel.style.display = 'none';
  }
}

// ==========================================
// 14. GROUPS AND CHANNELS
// ==========================================
async function fetchTeams() {
  try {
    myTeams = await api('/api/teams');
    cacheSet('teams', myTeams);
    if (currentTab === 'groups') renderGroups();
  } catch (err) {
    console.warn('fetchTeams failed:', err.message);
  }
}

function switchInboxTab(tab) {
  if (currentTab === 'direct' && tab !== 'direct') stopTyping(activeContactId);
  currentTab = tab;
  const activeClass = 'py-1.5 text-center font-label-md text-label-md text-on-primary bg-primary rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 font-semibold';
  const idleClass = 'py-1.5 text-center font-label-md text-label-md text-on-surface-variant hover:text-on-surface rounded-lg transition-colors flex items-center justify-center gap-1.5';

  el('tab-direct').className = tab === 'direct' ? activeClass : idleClass;
  el('tab-groups').className = tab === 'groups' ? activeClass : idleClass;
  el('contactList').classList.toggle('hidden', tab !== 'direct');
  el('groupsList').classList.toggle('hidden', tab !== 'groups');
  closeChatSearch();
  closeChatActionsMenu();
  renderTypingIndicator();
  updateComposerState();

  if (tab === 'direct') {
    closeTeamSocket();
    renderContacts();
    if (activeContactId && contacts[activeContactId]) selectContact(activeContactId);
    else showEmptyPane();
  } else {
    renderGroups();
    if (activeTeamId && myTeams.some(t => t.id === activeTeamId)) selectTeam(activeTeamId);
    else showEmptyPane();
  }
}

function renderGroups() {
  const list = el('groupsList');
  const teams = myTeams.filter(t => !listQuery || t.name.toLowerCase().includes(listQuery) || (t.description || '').toLowerCase().includes(listQuery));

  if (teams.length === 0) {
    list.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-on-surface-variant text-center px-4">
        <span class="material-symbols-outlined text-[40px] text-outline mb-3">groups</span>
        <p class="font-body-md text-body-md">${listQuery ? 'No groups match your search.' : 'No groups yet.'}</p>
        ${listQuery ? '' : '<button type="button" class="mt-3 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md" onclick="openNewGroupModal()">Create a group</button>'}
      </div>`;
    return;
  }

  list.innerHTML = teams.map(t => {
    const isActive = currentTab === 'groups' && activeTeamId === t.id;
    return `
      <div class="group relative p-space-sm rounded-xl ${isActive ? 'bg-primary-fixed/30 hover:bg-primary-fixed/40' : 'hover:bg-surface-container-low'} transition-all cursor-pointer mt-1" data-team-id="${t.id}" onclick="selectTeam(${t.id})">
        <div class="flex items-start gap-space-sm">
          <div class="relative shrink-0">
            <div class="w-12 h-12 rounded-xl bg-surface-container-high overflow-hidden flex items-center justify-center text-on-surface-variant font-headline-sm">
              ${avatarHtml(t.avatar_url, t.name, 'font-bold text-sm')}
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-1">
              <span class="font-headline-sm text-headline-sm ${isActive ? 'font-bold' : 'font-semibold'} text-on-surface truncate">${escapeHtml(t.name)}</span>
            </div>
            ${t.description ? `<div class="flex items-center gap-1 text-[12px] text-on-surface-variant mt-0.5"><span class="truncate">${escapeHtml(t.description)}</span></div>` : ''}
          </div>
        </div>
        ${isActive ? '<div class="absolute left-0 top-2 bottom-2 w-1 bg-primary rounded-r-full"></div>' : ''}
      </div>`;
  }).join('');
}

function activeTeam() {
  return myTeams.find(t => t.id === activeTeamId) || null;
}

function myTeamRole(teamId) {
  const me = (teamMembers[teamId] || []).find(m => m.user_id === currentUserId);
  return me ? me.role : null;
}

async function loadTeamMembers(teamId) {
  try {
    teamMembers[teamId] = await api(`/api/teams/${teamId}/members`);
  } catch (err) {
    teamMembers[teamId] = teamMembers[teamId] || [];
  }
  if (activeTeamId === teamId && el('collab-info-panel').style.display === 'flex') updateTeamInfoPanel();
}

async function selectTeam(id) {
  activeTeamId = id;
  renderGroups();
  showChatPane();
  renderTeamHeader();
  updateComposerState();
  loadTeamMembers(id);

  if (!teamChannels[id]) {
    el('messages-scroll-area').innerHTML = threadStatusHtml({ loaded: false, messages: [] }, '');
    try {
      teamChannels[id] = await api(`/api/teams/${id}/channels`);
    } catch (err) {
      if (activeTeamId === id) {
        el('messages-scroll-area').innerHTML = `<div class="flex flex-col items-center justify-center h-full text-on-surface-variant"><p class="font-body-md text-body-md">${escapeHtml(err.message)}</p></div>`;
      }
      return;
    }
  }
  if (activeTeamId !== id) return;

  const textChannels = teamChannels[id].filter(c => c.channel_type !== 'voice');
  const stillValid = textChannels.find(c => c.id === activeChannelId);
  const target = stillValid || textChannels.find(c => c.name.toLowerCase() === 'general') || textChannels[0];
  if (target) {
    selectChannel(target.id);
  } else {
    activeChannelId = null;
    closeTeamSocket();
    renderTeamHeader();
    el('messages-scroll-area').innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-on-surface-variant text-center">
        <span class="material-symbols-outlined text-[48px] text-outline mb-3">tag</span>
        <p class="font-body-md text-body-md">This group has no text channels yet.</p>
        <button type="button" class="mt-3 px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md" onclick="openNewChannelModal()">Create a channel</button>
      </div>`;
  }
  updateTeamInfoPanel();
}

function getChannelThread(channelId) {
  if (!channelThreads[channelId]) {
    channelThreads[channelId] = { messages: [], hasMore: true, loaded: false, loading: false };
  }
  return channelThreads[channelId];
}

async function loadChannelThread(channelId) {
  const thread = getChannelThread(channelId);
  if (thread.loading) return;
  thread.loading = true;
  try {
    const page = await api(`/api/channels/${channelId}/messages?limit=${PAGE_SIZE}`);
    const pageIds = new Set(page.map(m => m.id));
    const oldestInPage = page.length ? page[0].id : 0;
    thread.messages = thread.messages.filter(m => !m.id || pageIds.has(m.id) || (thread.loaded && m.id < oldestInPage));
    mergeServerMessages(thread, page);
    if (!thread.loaded) thread.hasMore = page.length === PAGE_SIZE;
    thread.loaded = true;
    thread.error = null;
  } catch (err) {
    thread.error = err.message;
  } finally {
    thread.loading = false;
  }
  if (currentTab === 'groups' && activeChannelId === channelId) renderTeamChat();
}

function selectChannel(channelId) {
  activeChannelId = channelId;
  closeChatSearch();
  showChatPane();
  renderTeamChat();
  updateTeamInfoPanel();
  // The channel socket is only open while the channel is on screen, so always catch up on open
  loadChannelThread(channelId);
  connectTeamSocket(channelId);
}

function renderTeamHeader() {
  const team = activeTeam();
  if (!team) return;
  const channel = (teamChannels[activeTeamId] || []).find(c => c.id === activeChannelId);

  el('chat-header-avatar').innerHTML = avatarHtml(team.avatar_url, team.name, 'text-on-primary font-bold');
  el('chat-header-name').textContent = team.name;
  el('chat-header-info').textContent = channel ? `# ${channel.name}` : '';
  el('chat-header-info').classList.remove('hidden');
  el('chat-header-online-dot').style.display = 'none';
  el('chat-header-profile-link').onclick = () => toggleInfoPanel();
  el('message-input').placeholder = `Message #${channel ? channel.name : 'channel'}...`;
  // Calls are one-to-one; group calls live on the My Teams page
  el('voice-call-btn').style.display = 'none';
  el('video-call-btn').style.display = 'none';
}

function canDeleteTeamMessage(msg) {
  return msg.sender_id === currentUserId || myTeamRole(activeTeamId) === 'Admin';
}

function teamBubbleHtml(msg, animate) {
  const fade = animate ? ' animate-fade-in' : '';
  if (msg.is_system_message) {
    return `<div class="msg-system${fade}" data-msg-key="${msg.key}"><span data-msg-id="${msg.id || ''}">${escapeHtml(msg.content)}</span></div>`;
  }

  const isSent = msg.sender_id === currentUserId;
  const contentHtml = renderMessageContent(msg.content);

  if (isSent) {
    return `
      <div class="flex flex-col items-end ml-auto max-w-[85%] md:max-w-[70%] group/msg w-full${fade}" data-msg-key="${msg.key}">
        <div class="msg-bubble px-4 py-2.5 rounded-2xl rounded-br-xs bg-primary text-on-primary shadow-sm text-body-md font-medium whitespace-pre-wrap break-words" data-msg-id="${msg.id || ''}">${contentHtml}</div>
        <div class="flex items-center gap-1.5 mt-1 mr-1">
          <span class="font-label-sm text-[10px] text-outline">${formatClock(msg.timestamp)}</span>
          ${getTickHtml(msg)}
          ${sentActionsHtml(msg, 'group')}
        </div>
      </div>`;
  }

  return `
    <div class="flex flex-col items-start max-w-[85%] md:max-w-[70%] group/msg w-full${fade}" data-msg-key="${msg.key}">
      <span class="text-[12px] font-semibold text-on-surface-variant mb-1 ml-10">${escapeHtml(msg.sender_name || 'Unknown')}</span>
      <div class="flex items-end gap-2.5 w-full">
        <div class="w-8 h-8 rounded-lg overflow-hidden bg-primary-fixed shrink-0 self-end mb-1 flex items-center justify-center text-on-primary-fixed" title="${escapeHtml(msg.sender_name || 'User')}">${avatarHtml(msg.sender_pic, msg.sender_name || 'User', 'text-[10px] font-bold')}</div>
        <div class="flex flex-col min-w-0">
          <div class="msg-bubble px-4 py-2.5 rounded-2xl rounded-bl-xs bg-surface-container-lowest border border-outline-variant/20 shadow-xs text-on-surface text-body-md whitespace-pre-wrap break-words" data-msg-id="${msg.id || ''}">${contentHtml}</div>
          <div class="flex items-center gap-1 ml-1 mt-1">
            <span class="font-label-sm text-[10px] text-outline">${formatClock(msg.timestamp)}</span>
            ${msg.id && canDeleteTeamMessage(msg) ? sentActionsHtml(msg, 'group') : ''}
          </div>
        </div>
      </div>
    </div>`;
}

function renderTeamChat(options = {}) {
  if (currentTab !== 'groups' || !activeTeamId || !activeChannelId) return;
  const channel = (teamChannels[activeTeamId] || []).find(c => c.id === activeChannelId);
  const thread = getChannelThread(activeChannelId);
  const scrollArea = el('messages-scroll-area');

  renderTeamHeader();

  if (thread.messages.length === 0) {
    scrollArea.innerHTML = threadStatusHtml(thread, `
      <div class="flex flex-col items-center justify-center h-full text-on-surface-variant">
        <span class="material-symbols-outlined text-[48px] text-outline mb-3">tag</span>
        <p class="font-body-md text-body-md">Welcome to #${escapeHtml(channel ? channel.name : 'channel')}!</p>
        <p class="font-body-sm text-body-sm text-outline mt-1">This is the start of the channel.</p>
      </div>`);
    return;
  }

  let lastDay = '';
  let html = thread.loaded && thread.hasMore
    ? '<div class="flex justify-center py-2"><div class="w-5 h-5 border-2 border-primary-fixed border-t-primary rounded-full animate-spin"></div></div>'
    : '';
  thread.messages.forEach(msg => {
    const day = formatDay(msg.timestamp);
    if (day !== lastDay) {
      lastDay = day;
      html += daySeparatorHtml(msg.timestamp);
    }
    html += teamBubbleHtml(msg, false);
  });

  scrollArea.innerHTML = html;
  if (!options.keepScroll) scrollToBottom();
  if (chatSearchQuery) searchInChat();
  fillViewportIfShort();
}

function refreshTeamBubble(channelId, msg) {
  if (currentTab === 'groups' && activeChannelId === channelId) replaceBubble(msg, teamBubbleHtml(msg, false));
}

function sendTeamMessage(channelId, content) {
  const thread = getChannelThread(channelId);
  const profile = window.currentUserProfile || {};
  const tempId = newTempId();
  const msg = {
    id: null,
    key: tempId,
    temp_id: tempId,
    team_id: activeTeamId,
    channel_id: channelId,
    sender_id: currentUserId,
    content: content,
    timestamp: new Date().toISOString(),
    is_system_message: 0,
    sender_name: profile.name || 'You',
    sender_pic: profile.profile_pic || '',
    message_status: 'sending'
  };
  thread.messages.push(msg);
  if (currentTab === 'groups' && activeChannelId === channelId) appendBubble(msg, teamBubbleHtml(msg, true));
  transmitTeamMessage(msg);
}

async function transmitTeamMessage(msg) {
  try {
    const saved = await api(`/api/channels/${msg.channel_id}/messages`, {
      method: 'POST',
      body: { content: msg.content, is_system_message: 0, temp_id: msg.temp_id }
    });
    confirmTeamMessage(msg, saved);
  } catch (err) {
    msg.message_status = 'failed';
    refreshTeamBubble(msg.channel_id, msg);
    showToast(err.message);
  }
}

function confirmTeamMessage(msg, saved) {
  msg.id = saved.id;
  msg.timestamp = saved.timestamp || msg.timestamp;
  msg.message_status = 'sent';
  refreshTeamBubble(msg.channel_id, msg);
}

function findTeamMessage(key) {
  for (const channelId of Object.keys(channelThreads)) {
    const msg = channelThreads[channelId].messages.find(m => m.key === key);
    if (msg) return msg;
  }
  return null;
}

function retryTeamMessage(key) {
  const msg = findTeamMessage(key);
  if (!msg) return;
  msg.message_status = 'sending';
  refreshTeamBubble(msg.channel_id, msg);
  transmitTeamMessage(msg);
}

function discardTeamMessage(key) {
  const msg = findTeamMessage(key);
  if (!msg) return;
  const thread = channelThreads[msg.channel_id];
  thread.messages = thread.messages.filter(m => m !== msg);
  if (currentTab === 'groups' && activeChannelId === msg.channel_id) removeBubble(key);
}

function deleteTeamMessage(msgId) {
  const channelId = activeChannelId;
  window.showSystemModal('Delete Message', 'Delete this message for everyone in this channel?', 'confirm', async () => {
    try {
      await api(`/api/channels/${channelId}/messages/${msgId}`, { method: 'DELETE' });
      applyTeamDeletion(channelId, msgId);
    } catch (err) {
      showToast(err.message);
    }
  }, 'Delete');
}

function applyTeamDeletion(channelId, msgId) {
  const thread = channelThreads[channelId];
  if (!thread) return;
  const msg = thread.messages.find(m => m.id === msgId);
  if (!msg) return;
  thread.messages = thread.messages.filter(m => m !== msg);
  if (currentTab === 'groups' && activeChannelId === channelId) {
    removeBubble(msg.key);
    if (thread.messages.length === 0) renderTeamChat();
  }
}

function closeTeamSocket() {
  teamWsChannelId = null;
  if (teamWs) {
    const socket = teamWs;
    teamWs = null;
    socket.onclose = null;
    try { socket.close(); } catch (e) { /* already closed */ }
  }
}

function connectTeamSocket(channelId) {
  if (teamWs && teamWsChannelId === channelId && teamWs.readyState <= WebSocket.OPEN) return;
  closeTeamSocket();
  teamWsChannelId = channelId;
  const socket = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/api/ws/channels/${channelId}/${currentUserId}`);
  teamWs = socket;

  socket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    handleTeamSocketEvent(channelId, data);
  };
  socket.onclose = () => {
    if (teamWs !== socket) return;
    teamWs = null;
    // Reconnect while this channel is still the one on screen, then catch up on anything missed
    setTimeout(() => {
      if (currentTab === 'groups' && activeChannelId === channelId) {
        connectTeamSocket(channelId);
        loadChannelThread(channelId);
      }
    }, 3000);
  };
  socket.onerror = () => { try { socket.close(); } catch (e) { /* already closed */ } };
}

function handleTeamSocketEvent(channelId, data) {
  if (data.type === 'message_deleted') {
    applyTeamDeletion(channelId, data.id);
    return;
  }
  if (data.type || data.content === undefined) return;

  const thread = getChannelThread(channelId);
  // Our own message coming back: it is already on screen
  const existing = thread.messages.find(m => m.id === data.id || (data.temp_id && m.temp_id === data.temp_id));
  if (existing) {
    if (!existing.id) confirmTeamMessage(existing, data);
    return;
  }

  const msg = Object.assign({ key: 'm' + data.id }, data);
  thread.messages.push(msg);
  sortMessages(thread.messages);
  if (currentTab === 'groups' && activeChannelId === channelId) {
    appendBubble(msg, teamBubbleHtml(msg, true));
    if (msg.sender_id !== currentUserId && document.hidden && settings.sound) playTone(880, 0.18, 0.08);
  }
}

// ===== GROUP INFO PANEL =====
function updateTeamInfoPanel() {
  const team = activeTeam();
  if (!team) return;
  const panel = el('info-panel-content');
  const isAdmin = myTeamRole(team.id) === 'Admin';
  const channels = (teamChannels[team.id] || []).filter(c => c.channel_type !== 'voice');
  const members = teamMembers[team.id];

  const picture = team.avatar_url
    ? `<img src="${escapeHtml(team.avatar_url)}" alt="${escapeHtml(team.name)}" class="w-full h-full object-cover"/>`
    : `<div class="w-full h-full rounded-2xl bg-primary-fixed flex items-center justify-center"><span class="text-2xl font-bold text-on-primary-fixed">${escapeHtml(getInitials(team.name))}</span></div>`;

  const membersHtml = !members
    ? '<span class="text-outline text-body-sm italic">Loading members...</span>'
    : members.map(m => `
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-full overflow-hidden bg-primary-fixed shrink-0 text-on-primary-fixed flex items-center justify-center font-bold text-[10px]">
            ${avatarHtml(m.user_profile_pic, m.user_name || 'U', '')}
          </div>
          <span class="font-body-sm text-body-sm text-on-surface truncate">${escapeHtml(m.user_name || 'Unknown')}${m.user_id === currentUserId ? ' (You)' : ''}</span>
          <span class="ml-auto font-label-sm text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">${escapeHtml(m.role)}</span>
        </div>`).join('');

  const addButton = (handler, title) => isAdmin
    ? `<button type="button" class="p-1 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-low transition-colors" title="${title}" onclick="${handler}"><span class="material-symbols-outlined text-[16px]">add</span></button>`
    : '';

  panel.innerHTML = `
    <div class="p-space-md flex flex-col items-center text-center border-b border-outline-variant/20">
      <div class="relative mb-space-xs">
        <div class="w-20 h-20 rounded-2xl overflow-hidden shadow-sm bg-primary-fixed">${picture}</div>
      </div>
      <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface">${escapeHtml(team.name)}</h4>
      <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">${escapeHtml(team.description || '')}</p>
    </div>
    <div class="p-space-md border-b border-outline-variant/20">
      <div class="flex items-center justify-between mb-2">
        <span class="font-label-sm text-label-sm uppercase tracking-wider text-outline font-bold">Channels</span>
        ${addButton('openNewChannelModal()', 'New channel')}
      </div>
      <div class="flex flex-col gap-1">
        ${channels.map(c => `
          <button type="button" class="w-full text-left px-3 py-2 rounded-lg font-label-md text-label-md transition-colors ${activeChannelId === c.id ? 'bg-primary-fixed/30 text-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface'}" onclick="selectChannel(${c.id})">
            # ${escapeHtml(c.name)}
          </button>
        `).join('') || '<span class="text-outline text-body-sm">No channels</span>'}
      </div>
    </div>
    <div class="p-space-md border-b border-outline-variant/20">
      <div class="flex items-center justify-between mb-2">
        <span class="font-label-sm text-label-sm uppercase tracking-wider text-outline font-bold">Members${members ? ` (${members.length})` : ''}</span>
        ${addButton('openAddMemberModal()', 'Add member')}
      </div>
      <div class="flex flex-col gap-2">${membersHtml}</div>
    </div>`;
}

function groupMenuItems() {
  const team = activeTeam();
  if (!team) return [];
  const isAdmin = myTeamRole(team.id) === 'Admin';
  const isCreator = team.created_by === currentUserId;
  const items = [{ icon: 'info', label: 'Group details', action: 'openGroupDetails()' }];
  if (isAdmin) {
    items.push({ icon: 'person_add', label: 'Add member', action: 'openAddMemberModal()' });
    items.push({ icon: 'tag', label: 'New channel', action: 'openNewChannelModal()' });
  }
  items.push('divider');
  if (isCreator) items.push({ icon: 'delete_forever', label: 'Delete group', action: 'deleteActiveTeam()', danger: true });
  else items.push({ icon: 'logout', label: 'Leave group', action: 'leaveActiveTeam()', danger: true });
  return items;
}

function openGroupDetails() {
  el('collab-info-panel').style.display = 'flex';
  updateTeamInfoPanel();
}

function forgetTeam(teamId) {
  (teamChannels[teamId] || []).forEach(c => delete channelThreads[c.id]);
  delete teamChannels[teamId];
  delete teamMembers[teamId];
  myTeams = myTeams.filter(t => t.id !== teamId);
  cacheSet('teams', myTeams);
  if (activeTeamId === teamId) {
    activeTeamId = null;
    activeChannelId = null;
    closeTeamSocket();
    showEmptyPane();
  }
  renderGroups();
}

function leaveActiveTeam() {
  const team = activeTeam();
  if (!team) return;
  window.showSystemModal('Leave Group', `Leave ${escapeHtml(team.name)}? You will need to be added again to rejoin.`, 'confirm', async () => {
    try {
      await api(`/api/teams/${team.id}/leave`, { method: 'POST' });
      forgetTeam(team.id);
      showToast('You left the group.');
    } catch (err) {
      showToast(err.message);
    }
  }, 'Leave');
}

function deleteActiveTeam() {
  const team = activeTeam();
  if (!team) return;
  window.showSystemModal('Delete Group', `Permanently delete ${escapeHtml(team.name)}? All its channels and messages will be removed for every member.`, 'confirm', async () => {
    try {
      await api(`/api/teams/${team.id}`, { method: 'DELETE' });
      forgetTeam(team.id);
      showToast('Group deleted.');
    } catch (err) {
      showToast(err.message);
    }
  }, 'Delete');
}

// ===== NEW GROUP =====
function openNewGroupModal() {
  el('new-group-modal').classList.add('active');
  el('new-group-name').value = '';
  el('new-group-desc').value = '';
  setTimeout(() => el('new-group-name').focus(), 100);
}

function closeNewGroupModal() {
  el('new-group-modal').classList.remove('active');
}

async function createNewGroup() {
  const name = el('new-group-name').value.trim();
  const desc = el('new-group-desc').value.trim();
  if (!name) return showToast('Group name is required.');

  try {
    const team = await api('/api/teams', { method: 'POST', body: { name: name, description: desc } });
    closeNewGroupModal();
    myTeams.push(team);
    cacheSet('teams', myTeams);
    activeTeamId = team.id;
    activeChannelId = null;
    switchInboxTab('groups');
  } catch (err) {
    showToast(err.message);
  }
}

// ===== NEW CHANNEL =====
function openNewChannelModal() {
  if (!activeTeamId) return;
  el('new-channel-modal').classList.add('active');
  el('new-channel-name').value = '';
  setTimeout(() => el('new-channel-name').focus(), 100);
}

function closeNewChannelModal() {
  el('new-channel-modal').classList.remove('active');
}

async function createNewChannel() {
  const name = el('new-channel-name').value.trim();
  const teamId = activeTeamId;
  if (!name || !teamId) return;

  try {
    const channel = await api(`/api/teams/${teamId}/channels`, { method: 'POST', body: { name: name, channel_type: 'text' } });
    closeNewChannelModal();
    teamChannels[teamId] = (teamChannels[teamId] || []).concat(channel);
    if (activeTeamId === teamId) selectChannel(channel.id);
  } catch (err) {
    showToast(err.status === 403 ? 'Only Admins can create channels.' : err.message);
  }
}

// ===== ADD MEMBER =====
function openAddMemberModal() {
  if (!activeTeamId) return;
  el('add-member-modal').classList.add('active');
  el('add-member-search').value = '';
  el('add-member-user-list').innerHTML = '<p class="text-center text-on-surface-variant font-body-sm py-4">Type a name to search...</p>';
  setTimeout(() => el('add-member-search').focus(), 100);
}

function closeAddMemberModal() {
  el('add-member-modal').classList.remove('active');
}

function searchAddMemberUsers() {
  const existing = new Set((teamMembers[activeTeamId] || []).map(m => m.user_id));
  searchUsers(el('add-member-search').value, el('add-member-user-list'), (user) => {
    if (existing.has(user.id)) return { label: 'Member', disabled: true };
    return { label: 'Add', handler: `addMemberToActiveTeam(${user.id})` };
  });
}

async function addMemberToActiveTeam(userId) {
  const teamId = activeTeamId;
  try {
    await api(`/api/teams/${teamId}/members`, { method: 'POST', body: { user_id: userId, role: 'Member' } });
    showToast('Member added.');
    await loadTeamMembers(teamId);
    if (el('add-member-modal').classList.contains('active')) searchAddMemberUsers();
    if (activeTeamId === teamId) updateTeamInfoPanel();
  } catch (err) {
    showToast(err.message);
  }
}

// ==========================================
// 15. FINDING PEOPLE (new chat, add member)
// ==========================================
function openNewChatModal() {
  el('new-chat-modal').classList.add('active');
  el('new-chat-search').value = '';
  el('new-chat-user-list').innerHTML = '<p class="text-center text-on-surface-variant font-body-sm py-4">Type a name to search...</p>';
  setTimeout(() => el('new-chat-search').focus(), 100);
}

function closeNewChatModal() {
  el('new-chat-modal').classList.remove('active');
}

function searchNewChatUsers() {
  searchUsers(el('new-chat-search').value, el('new-chat-user-list'), (user) => ({ rowHandler: `startChatWith(${user.id})` }));
}

function startChatWith(userId) {
  closeNewChatModal();
  if (!contacts[userId] && userSearchResults[userId]) {
    contacts[userId] = contactFromCard(userSearchResults[userId]);
  }
  if (!contacts[userId]) return;
  if (currentTab !== 'direct') {
    activeContactId = userId;
    switchInboxTab('direct');
  } else {
    selectContact(userId);
  }
}

// ==========================================
// 16. SEARCH INSIDE A CONVERSATION
// ==========================================
let chatSearchQuery = '';
let searchMatchIndex = 0;
let searchMatches = [];

function closeChatSearch() {
  const bar = el('chat-search-bar');
  if (bar.style.display === 'none') return;
  bar.style.display = 'none';
  el('chat-search-input').value = '';
  chatSearchQuery = '';
  clearSearchHighlights();
}

function toggleChatSearch() {
  const bar = el('chat-search-bar');
  if (bar.style.display === 'none') {
    bar.style.display = 'block';
    el('chat-search-input').focus();
  } else {
    closeChatSearch();
  }
}

function clearSearchHighlights() {
  document.querySelectorAll('#messages-scroll-area .search-highlight').forEach(b => b.classList.remove('search-highlight', 'search-match-current'));
  searchMatches = [];
  searchMatchIndex = 0;
  el('chat-search-count').textContent = '';
}

function searchInChat() {
  chatSearchQuery = el('chat-search-input').value.toLowerCase().trim();
  clearSearchHighlights();
  if (!chatSearchQuery) return;

  document.querySelectorAll('#messages-scroll-area [data-msg-id]').forEach(b => {
    if (b.textContent.toLowerCase().includes(chatSearchQuery)) {
      b.classList.add('search-highlight');
      searchMatches.push(b);
    }
  });

  if (searchMatches.length === 0) {
    const view = currentView();
    el('chat-search-count').textContent = view && view.thread.hasMore ? 'No matches in loaded messages' : 'No matches';
    return;
  }
  // Start from the newest match, which is where the reader is
  searchMatchIndex = searchMatches.length - 1;
  showCurrentSearchMatch();
}

function showCurrentSearchMatch() {
  searchMatches.forEach(b => b.classList.remove('search-match-current'));
  const current = searchMatches[searchMatchIndex];
  if (!current) return;
  current.classList.add('search-match-current');
  current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el('chat-search-count').textContent = `${searchMatchIndex + 1} / ${searchMatches.length}`;
}

function stepChatSearch(direction) {
  if (searchMatches.length === 0) return;
  searchMatchIndex = (searchMatchIndex + direction + searchMatches.length) % searchMatches.length;
  showCurrentSearchMatch();
}

// ==========================================
// 18. ATTACHMENTS, CODE SNIPPETS, VOICE MEMOS
// ==========================================
// Uploads each file and sends it as its own message. Whatever is typed in the box is left alone.
async function sendFiles(files) {
  const view = currentView();
  if (!view) return;
  if (view.type === 'direct' && chatActionsState.blocked.includes(view.id)) {
    return showToast('You have blocked this user. Unblock them to send a message.');
  }

  for (const file of files) {
    try {
      const upload = await uploadChatFile(file);
      const token = attachmentToken(upload);
      // Deliver to the chat the upload was started from, even if another one is open by now
      if (view.type === 'direct') sendDirectMessage(view.id, token);
      else sendTeamMessage(view.id, token);
    } catch (err) {
      window.showSystemModal('Upload Error', escapeHtml(`${file.name || 'File'}: ${err.message}`), 'alert');
    }
  }
  setUploadProgress('', null);
}

async function handleFileAttach(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (files.length) await sendFiles(files);
}

// ===== CODE SNIPPET =====
function openCodeSnippetModal() {
  el('code-snippet-modal').classList.add('active');
  el('code-snippet-input').value = '';
  el('code-language-select').value = '';
  setTimeout(() => el('code-snippet-input').focus(), 100);
}

function closeCodeSnippetModal() {
  el('code-snippet-modal').classList.remove('active');
}

function sendCodeSnippet() {
  const code = el('code-snippet-input').value.replace(/\s+$/, '');
  const lang = el('code-language-select').value;
  if (!code.trim()) return showToast('Please enter some code.');

  const codeMsg = '```' + lang + '\n' + code + '\n```';
  if (codeMsg.length > 5000) return showToast('That snippet is too long. The limit is 5000 characters.');
  if (sendMessage(codeMsg)) closeCodeSnippetModal();
}

// ===== VOICE RECORDING =====
function resetRecordingUi() {
  clearInterval(recordingInterval);
  el('voice-recording-bar').classList.remove('active');
  el('voice-record-btn').querySelector('span').textContent = 'mic';
  el('recording-timer').textContent = '00:00';
}

async function toggleVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    // Already recording, stop and send
    sendVoiceRecording();
    return;
  }
  const view = currentView();
  if (!view) return;
  if (view.type === 'direct' && chatActionsState.blocked.includes(view.id)) {
    return showToast('You have blocked this user. Unblock them to send a message.');
  }

  const format = pickRecordingFormat();
  if (!format || !navigator.mediaDevices) {
    return window.showSystemModal('Voice Memos', 'This browser cannot record audio.', 'alert');
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    return window.showSystemModal('Microphone Access', 'Please allow microphone access to record voice memos.', 'alert');
  }

  audioChunks = [];
  recordingCancelled = false;
  recordingSeconds = 0;
  const recorder = new MediaRecorder(stream, { mimeType: format.mime });
  mediaRecorder = recorder;

  recorder.ondataavailable = (e) => { if (e.data && e.data.size) audioChunks.push(e.data); };
  recorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    const chunks = audioChunks;
    const seconds = recordingSeconds;
    const cancelled = recordingCancelled;
    audioChunks = [];
    mediaRecorder = null;
    resetRecordingUi();
    if (cancelled || chunks.length === 0) return;
    if (seconds < 1) return showToast('That recording was too short.');

    try {
      const blob = new Blob(chunks, { type: format.mime.split(';')[0] });
      const upload = await uploadChatFile(blob, `Voice memo ${formatDuration(seconds)}.${format.ext}`.replace(':', '-'));
      const token = `[FILE|${upload.url}|Voice memo ${formatDuration(seconds)}.${format.ext}|${formatBytes(upload.size)}]`;
      if (view.type === 'direct') sendDirectMessage(view.id, token);
      else sendTeamMessage(view.id, token);
    } catch (err) {
      window.showSystemModal('Voice Memo', escapeHtml(err.message), 'alert');
    }
    setUploadProgress('', null);
  };

  recorder.start();
  el('voice-recording-bar').classList.add('active');
  el('voice-record-btn').querySelector('span').textContent = 'stop';

  recordingInterval = setInterval(() => {
    recordingSeconds++;
    const mins = Math.floor(recordingSeconds / 60).toString().padStart(2, '0');
    const secs = (recordingSeconds % 60).toString().padStart(2, '0');
    el('recording-timer').textContent = `${mins}:${secs}`;
    if (recordingSeconds >= MAX_RECORDING_SECONDS) sendVoiceRecording();
  }, 1000);
}

function cancelVoiceRecording() {
  recordingCancelled = true;
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  else resetRecordingUi();
}

function sendVoiceRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  clearInterval(recordingInterval);
  mediaRecorder.stop();
}

// ===== INIT =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initInbox);
} else {
  initInbox();
}
