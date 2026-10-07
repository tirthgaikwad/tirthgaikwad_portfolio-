// ==========================================
// CHAT-COMMON.JS — Helpers shared by the Messages page (inbox.js) and the Teams page (team.js)
// Loaded after shared.js (API_BASE, escapeHtml, safeUrl, showSystemModal) and before the page script.
// ==========================================

const currentUserId = parseInt(localStorage.getItem('currentUserId'));
if (!currentUserId) { window.location.href = 'login.html'; }

const PAGE_SIZE = 50;
const CACHE_PREFIX = `c2m:${currentUserId}:`;
const el = (id) => document.getElementById(id);

// Who is online right now (kept up to date by each page)
let onlineUserIds = new Set();

// Settings (saved in this browser)
let settings = { sound: true, desktop: false, enterToSend: true };

// ===== EMOJI DATA =====
const emojiData = {
  'Smileys': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴','😵','🤯','🥳','🥸','😎','🤓','🧐'],
  'Gestures': ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏'],
  'Hearts': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟'],
  'Objects': ['💻','⌨️','🖥️','📱','📲','☎️','📞','📟','📠','🔋','🔌','💡','🔦','📷','📸','📹','🎥','📽️','🎬','📺','📻','🎙️','🎚️','🎛️','⏱️','⏰','📡','🔬','🔭','📐','📏','✂️','📎','📌','📍','🗂️','📁','📂','📊','📈','📉','📋','📝','✏️','🖊️','🖋️','✒️'],
  'Nature': ['🌸','💐','🌷','🌹','🥀','🌺','🌻','🌼','🌱','🪴','🌲','🌳','🌴','🌵','🌾','🌿','☘️','🍀','🍁','🍂','🍃','🍄','🌰','🦀','🦞','🦐','🦑','🐙','🦈','🐳','🐋','🐬','🦭','🐟','🐠','🐡','🦇','🐝','🐛','🦋','🐌','🐞','🐜','🪰','🪲'],
  'Food': ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🌶️','🫑','🥒','🥬','🥦','🧄','🧅','🥔','🍠','🫘','🥜','🌰','🍞','🥐','🥖','🫓','🥨','🥯','🧇','🥞','🧈','🍕','🍔','🍟','🌭','🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍳','🥘','🍲'],
  'Flags': ['🏳️','🏴','🏁','🚩','🎌','🏴‍☠️','🇮🇳','🇺🇸','🇬🇧','🇯🇵','🇰🇷','🇨🇳','🇫🇷','🇩🇪','🇧🇷','🇦🇺','🇨🇦','🇮🇹','🇪🇸','🇷🇺','🇲🇽','🇸🇦','🇦🇪','🇸🇬']
};

// Words people type when looking for an emoji. Anything not listed is still found by its category name.
const emojiKeywords = {
  '😀': 'grin smile happy', '😃': 'smile happy joy', '😄': 'smile happy laugh', '😁': 'grin beam happy', '😆': 'laugh haha', '😅': 'sweat laugh nervous relief',
  '🤣': 'rofl laugh lol rolling', '😂': 'joy laugh tears lol cry', '🙂': 'smile slight', '😊': 'blush smile happy shy', '😇': 'angel innocent halo',
  '🥰': 'love hearts adore', '😍': 'love heart eyes', '🤩': 'star struck wow excited', '😘': 'kiss love', '😋': 'yum tasty delicious', '😛': 'tongue', '😜': 'wink tongue joke',
  '🤪': 'crazy zany silly', '🤑': 'money rich', '🤗': 'hug', '🤭': 'oops giggle', '🤫': 'shh quiet secret', '🤔': 'think thinking hmm', '🫡': 'salute respect',
  '🤐': 'zip quiet secret', '🤨': 'suspicious raised eyebrow', '😐': 'neutral meh', '😑': 'expressionless blank', '😶': 'speechless no mouth', '😏': 'smirk',
  '😒': 'unamused annoyed', '🙄': 'eye roll whatever', '😬': 'grimace awkward', '😌': 'relieved calm', '😔': 'sad pensive', '😪': 'sleepy tired', '😴': 'sleep zzz tired',
  '😷': 'mask sick', '🤒': 'sick fever ill', '🤕': 'hurt injured', '🤢': 'sick nausea', '🤮': 'vomit sick', '🥴': 'woozy dizzy', '😵': 'dizzy', '🤯': 'mind blown shocked',
  '🥳': 'party celebrate birthday', '😎': 'cool sunglasses', '🤓': 'nerd geek glasses', '🧐': 'monocle curious inspect',
  '👋': 'wave hello hi bye', '✋': 'hand stop high five', '👌': 'ok okay perfect', '✌️': 'peace victory', '🤞': 'fingers crossed luck', '🤟': 'love you', '🤘': 'rock',
  '🤙': 'call me', '👈': 'left point', '👉': 'right point', '👆': 'up point', '👇': 'down point', '☝️': 'one up point', '👍': 'thumbs up like yes good ok',
  '👎': 'thumbs down dislike no bad', '✊': 'fist', '👊': 'fist bump punch', '👏': 'clap applause bravo', '🙌': 'raise hands hooray celebrate', '🫶': 'heart hands love',
  '🤝': 'handshake deal agree', '🙏': 'pray please thanks thank you namaste',
  '❤️': 'heart love red', '🧡': 'heart orange', '💛': 'heart yellow', '💚': 'heart green', '💙': 'heart blue', '💜': 'heart purple', '🖤': 'heart black', '🤍': 'heart white',
  '💔': 'broken heart sad', '❤️‍🔥': 'heart fire passion', '💕': 'hearts love', '💖': 'sparkle heart', '💘': 'cupid heart arrow', '💝': 'heart gift',
  '💻': 'laptop computer code', '⌨️': 'keyboard type', '🖥️': 'desktop computer monitor', '📱': 'phone mobile', '☎️': 'telephone phone', '📞': 'phone call', '🔋': 'battery',
  '🔌': 'plug power', '💡': 'idea bulb light', '📷': 'camera photo', '📸': 'camera flash photo', '📹': 'video camera', '🎥': 'movie camera film', '🎬': 'clapper movie action',
  '📺': 'tv television', '🎙️': 'microphone mic podcast', '⏱️': 'stopwatch timer', '⏰': 'alarm clock time', '🔬': 'microscope science', '🔭': 'telescope', '✂️': 'scissors cut',
  '📎': 'paperclip attach', '📌': 'pin pushpin', '📍': 'location pin', '📁': 'folder', '📂': 'folder open', '📊': 'chart bar graph', '📈': 'chart up growth', '📉': 'chart down',
  '📋': 'clipboard', '📝': 'memo note write', '✏️': 'pencil write edit', '🖊️': 'pen write',
  '🌸': 'flower blossom', '💐': 'bouquet flowers', '🌷': 'tulip flower', '🌹': 'rose flower', '🌻': 'sunflower', '🌱': 'seedling plant grow', '🌲': 'tree evergreen', '🌳': 'tree',
  '🌴': 'palm tree', '🌵': 'cactus', '🍀': 'clover luck', '🍁': 'maple leaf autumn', '🍄': 'mushroom', '🦀': 'crab', '🐙': 'octopus', '🦈': 'shark', '🐳': 'whale', '🐬': 'dolphin',
  '🐟': 'fish', '🐝': 'bee', '🦋': 'butterfly', '🐌': 'snail slow', '🐞': 'ladybug bug', '🐜': 'ant',
  '🍎': 'apple', '🍊': 'orange', '🍋': 'lemon', '🍌': 'banana', '🍉': 'watermelon', '🍇': 'grapes', '🍓': 'strawberry', '🍒': 'cherry', '🍑': 'peach', '🥭': 'mango',
  '🍍': 'pineapple', '🥥': 'coconut', '🍅': 'tomato', '🥑': 'avocado', '🌶️': 'chili pepper spicy hot', '🥦': 'broccoli', '🥔': 'potato', '🍞': 'bread', '🥐': 'croissant',
  '🍕': 'pizza', '🍔': 'burger', '🍟': 'fries', '🌭': 'hot dog', '🥪': 'sandwich', '🌮': 'taco', '🌯': 'burrito wrap', '🥚': 'egg', '🍳': 'egg fry cooking breakfast',
  '🏁': 'finish flag race', '🚩': 'red flag', '🇮🇳': 'india flag', '🇺🇸': 'usa america flag', '🇬🇧': 'uk britain flag', '🇯🇵': 'japan flag', '🇰🇷': 'korea flag',
  '🇨🇳': 'china flag', '🇫🇷': 'france flag', '🇩🇪': 'germany flag', '🇧🇷': 'brazil flag', '🇦🇺': 'australia flag', '🇨🇦': 'canada flag', '🇮🇹': 'italy flag', '🇪🇸': 'spain flag'
};

// ==========================================
// 1. HELPERS
// ==========================================
class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      signal: controller.signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (res.status === 401) { handleLoggedOut(); throw new ApiError(401, 'Please log in again.'); }
    if (!res.ok) {
      throw new ApiError(res.status, data && typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.');
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError(0, 'The server took too long to respond.');
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'Could not reach the server.');
  } finally {
    clearTimeout(timer);
  }
}

function handleLoggedOut() {
  localStorage.removeItem('currentUserId');
  window.location.href = 'login.html';
}

function cacheGet(key) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)); } catch (e) { return null; }
}

function cacheSet(key, value) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch (e) { /* storage full or unavailable */ }
}

function showToast(message) {
  document.querySelectorAll('.chat-toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = 'chat-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function getInitials(name) {
  if (!name || name.startsWith('User #')) return name ? name.split('#')[1] : '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

function avatarHtml(pic, name, textClass) {
  return pic
    ? `<img src="${escapeHtml(pic)}" alt="${escapeHtml(name)}" class="w-full h-full object-cover"/>`
    : `<span class="${textClass}">${escapeHtml(getInitials(name))}</span>`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  const oneDay = 86400000;

  if (diff < oneDay && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diff < 7 * oneDay) {
    return d.toLocaleDateString([], { weekday: 'short' });
  } else {
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  }
}

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDay(ts) {
  return new Date(ts).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Paths the API hands back as "/api/..." or "/static/..." live on the API server, not on this page's server
function mediaUrl(url) {
  const value = String(url || '').trim();
  return value.startsWith('/') ? API_BASE + value : value;
}

function newTempId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ==========================================
// 2. MESSAGE CONTENT
// ==========================================
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const VIDEO_EXT = ['mp4', 'mov'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a'];
const TOKEN_PATTERN = /\[(IMAGE|VIDEO|FILE)\|([^|\]]*)\|([^|\]]*)(?:\|([^\]]*))?\]/g;
const CALL_PATTERN = /^\[CALL\|(audio|video)\|(ended|missed)\|(\d+)\]$/;

function fileExtension(name) {
  const match = /\.([a-z0-9]+)(?:\.txt)?$/i.exec(String(name || '').split('?')[0]);
  return match ? match[1].toLowerCase() : '';
}

function isVoiceMemoName(name) {
  return /^voice[ -]memo/i.test(name || '');
}

function attachmentHtml(kind, rawUrl, name, size) {
  const url = escapeHtml(safeUrl(mediaUrl(rawUrl)));
  const label = escapeHtml(name || 'File');
  const ext = fileExtension(name) || fileExtension(rawUrl);

  if (kind === 'IMAGE' || (kind === 'FILE' && IMAGE_EXT.includes(ext))) {
    return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${label}" loading="lazy" class="msg-media"/></a>`;
  }
  if (kind === 'VIDEO' || (kind === 'FILE' && VIDEO_EXT.includes(ext))) {
    return `<video src="${url}" controls preload="metadata" class="msg-media bg-black"></video>`;
  }
  if (isVoiceMemoName(name) || AUDIO_EXT.includes(ext)) {
    const title = isVoiceMemoName(name) ? '🎤 ' + escapeHtml(name.replace(/\.[a-z0-9]+$/i, '').replace(/-/g, ' ')) : label;
    return `<div class="flex flex-col gap-1"><span class="text-xs opacity-75">${title}</span><audio controls preload="none" src="${url}" class="max-w-[220px] sm:max-w-[260px] h-8"></audio></div>`;
  }
  // Kept on one line: message bubbles preserve whitespace, so line breaks here would show up
  const sizeHtml = size ? `<span class="block text-[11px] opacity-70">${escapeHtml(size)}</span>` : '';
  return `<a href="${url}" target="_blank" rel="noopener" download class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/10 hover:bg-black/20 transition-colors font-medium text-sm"><span class="material-symbols-outlined text-[18px]">description</span><span class="min-w-0"><span class="block truncate max-w-[200px] underline">${label}</span>${sizeHtml}</span></a>`;
}

function linkify(text) {
  return text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, i) => {
    if (i % 2 === 1) {
      const url = escapeHtml(safeUrl(part));
      return `<a href="${url}" target="_blank" rel="noopener" class="msg-link">${escapeHtml(part)}</a>`;
    }
    return escapeHtml(part);
  }).join('');
}

function callNoteHtml(match) {
  const isVideo = match[1] === 'video';
  const missed = match[2] === 'missed';
  const label = missed ? `Missed ${isVideo ? 'video' : 'voice'} call` : `${isVideo ? 'Video' : 'Voice'} call · ${formatDuration(parseInt(match[3]))}`;
  return `<span class="inline-flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">${missed ? 'phone_missed' : (isVideo ? 'videocam' : 'call')}</span>${label}</span>`;
}

// Turns stored message text into safe HTML. Shared by direct chats and group channels.
function renderMessageContent(rawContent) {
  const content = String(rawContent || '');

  // Fenced code can be the whole message or sit between lines of ordinary text
  if (content.includes('```')) {
    return content.split(/```([\s\S]*?)(?:```|$)/g).map((part, i) => {
      if (i % 2 === 0) return renderMessageText(part.replace(/^\n|\n$/g, ''));
      const code = part.replace(/^[A-Za-z0-9+#.-]{0,12}\n/, '').replace(/\n$/, '');
      return `<pre class="code-block text-[13px] font-mono bg-black/20 rounded-lg p-3 my-1 overflow-x-auto whitespace-pre-wrap"><code>${escapeHtml(code)}</code></pre>`;
    }).join('');
  }

  const call = CALL_PATTERN.exec(content);
  if (call) return callNoteHtml(call);

  // Formats used by earlier versions of this page
  let legacy = /^\[📎 File:\s*([^\]]+)\]\(([^)]+)\)$/.exec(content);
  if (legacy) return attachmentHtml('FILE', legacy[2], legacy[1].trim(), '');
  legacy = /^\[🎤 Voice memo\s*\(?([^\])]*)\)?\]\(([^)]+)\)$/.exec(content);
  if (legacy) return attachmentHtml('FILE', legacy[2], `Voice memo ${legacy[1]}.webm`, '');
  if (content.startsWith('<img') || content.startsWith('<audio') || content.startsWith('<div class="audio')) {
    const src = (/src="([^"]+)"/.exec(content) || [])[1];
    if (src) return attachmentHtml(content.startsWith('<img') ? 'IMAGE' : 'FILE', src, content.startsWith('<img') ? 'photo' : 'Voice memo.webm', '');
  }

  return renderMessageText(content);
}

// Plain text with links and attachment tokens
function renderMessageText(content) {
  let html = '';
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let token;
  while ((token = TOKEN_PATTERN.exec(content)) !== null) {
    html += linkify(content.slice(lastIndex, token.index).replace(/\n$/, ''));
    html += `<div class="my-1">${attachmentHtml(token[1], token[2], token[3], token[4] || '')}</div>`;
    lastIndex = token.index + token[0].length;
  }
  html += linkify(content.slice(lastIndex).replace(/^\n/, ''));
  return html;
}

// One-line summary of a message for the conversation list
function getMessagePreview(content) {
  if (!content) return '';
  if (content.startsWith('```')) return '💻 Code snippet';
  const call = CALL_PATTERN.exec(content);
  if (call) return call[2] === 'missed' ? '📞 Missed call' : `📞 ${call[1] === 'video' ? 'Video' : 'Voice'} call`;
  if (content.startsWith('<img') || content.startsWith('data:image')) return '📷 Photo';
  if (content.startsWith('<div class="audio') || content.startsWith('<audio') || content.startsWith('[🎤')) return '🎤 Voice memo';
  if (content.startsWith('[📎')) return '📎 Attachment';

  TOKEN_PATTERN.lastIndex = 0;
  const token = TOKEN_PATTERN.exec(content);
  if (token) {
    const before = content.slice(0, token.index).trim();
    if (before) return before.length > 50 ? before.substring(0, 50) + '...' : before;
    const ext = fileExtension(token[3]) || fileExtension(token[2]);
    if (token[1] === 'IMAGE' || IMAGE_EXT.includes(ext)) return '📷 Photo';
    if (token[1] === 'VIDEO' || VIDEO_EXT.includes(ext)) return '🎬 Video';
    if (isVoiceMemoName(token[3]) || AUDIO_EXT.includes(ext)) return '🎤 Voice memo';
    return '📎 ' + (token[3] || 'Attachment');
  }
  const text = content.replace(/\s+/g, ' ').trim();
  return text.length > 50 ? text.substring(0, 50) + '...' : text;
}

function attachmentToken(upload) {
  const name = String(upload.filename || 'file').replace(/[|\[\]\n\r]/g, '_');
  const type = upload.content_type || '';
  if (type.startsWith('image/')) return `[IMAGE|${upload.url}|${name}]`;
  if (type.startsWith('video/')) return `[VIDEO|${upload.url}|${name}]`;
  return `[FILE|${upload.url}|${name}|${formatBytes(upload.size)}]`;
}

// ==========================================
// 3. SETTINGS AND SOUNDS
// ==========================================
function loadSettings() {
  settings = Object.assign(settings, cacheGet('settings') || {});
  applySettings();
}

function applySettings() {
  const hint = el('send-hint');
  if (hint) hint.textContent = settings.enterToSend ? 'Press Enter to send, Shift+Enter for a new line' : 'Press Ctrl+Enter to send';
}

let audioContext = null;
function playTone(frequency, duration, volume) {
  try {
    audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch (e) { /* audio not available until the user interacts with the page */ }
}

// ==========================================
// 4. COMPOSER, UPLOADS, RECORDING
// ==========================================
function autoGrowInput() {
  const input = el('message-input');
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 144) + 'px';
}

function setUploadProgress(name, fraction) {
  const box = el('upload-progress');
  if (fraction === null) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const percent = Math.round(fraction * 100);
  el('upload-progress-name').textContent = `Uploading ${name}`;
  el('upload-progress-percent').textContent = `${percent}%`;
  el('upload-progress-bar').style.width = `${percent}%`;
}

function uploadChatFile(file, filename) {
  const name = filename || file.name || 'file';
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/upload/chat-file`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(name, e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      if (xhr.status === 401) return handleLoggedOut();
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
      else reject(new Error(data && typeof data.detail === 'string' ? data.detail : 'Upload failed. Please try again.'));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    const formData = new FormData();
    formData.append('file', file, name);
    setUploadProgress(name, 0);
    xhr.send(formData);
  });
}

function pickRecordingFormat() {
  const formats = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', ext: 'm4a' },
    { mime: 'audio/ogg;codecs=opus', ext: 'ogg' }
  ];
  return formats.find(f => window.MediaRecorder && MediaRecorder.isTypeSupported(f.mime)) || null;
}

// ==========================================
// 5. FINDING PEOPLE
// ==========================================
let userSearchTimer = null;
let userSearchSeq = 0;

// Searches people by name on the server and draws the result rows. describeAction decides each row's button.
function searchUsers(rawQuery, listEl, describeAction) {
  const query = rawQuery.trim();
  clearTimeout(userSearchTimer);

  if (!query) {
    listEl.innerHTML = '<p class="text-center text-on-surface-variant font-body-sm py-4">Type a name to search...</p>';
    return;
  }
  listEl.innerHTML = '<p class="text-center text-on-surface-variant font-body-sm py-4">Searching...</p>';

  const seq = ++userSearchSeq;
  userSearchTimer = setTimeout(async () => {
    let results;
    try {
      results = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
    } catch (err) {
      if (seq === userSearchSeq) listEl.innerHTML = `<p class="text-center text-error font-body-sm py-4">${escapeHtml(err.message)}</p>`;
      return;
    }
    if (seq !== userSearchSeq) return;   // a newer search has started

    if (results.length === 0) {
      listEl.innerHTML = '<p class="text-center text-on-surface-variant font-body-sm py-4">No users found.</p>';
      return;
    }

    listEl.innerHTML = results.map(p => {
      const action = describeAction(p);
      const isOnline = onlineUserIds.has(p.id);
      const rowHandler = action.rowHandler ? ` onclick="${action.rowHandler}"` : '';
      const button = action.label
        ? `<button type="button" ${action.disabled ? 'disabled' : `onclick="${action.handler}"`} class="px-3 py-1 rounded-lg font-label-sm text-label-sm font-semibold ${action.disabled ? 'bg-surface-container text-outline' : 'bg-primary text-on-primary hover:bg-primary-container'}">${action.label}</button>`
        : (isOnline ? '<span class="text-[11px] text-tertiary font-semibold">Online</span>' : '');
      return `
        <div class="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-container-low ${action.rowHandler ? 'cursor-pointer' : ''} transition-colors"${rowHandler}>
          <div class="relative">
            <div class="w-10 h-10 rounded-xl bg-surface-container-high overflow-hidden flex items-center justify-center text-on-surface-variant">${avatarHtml(p.profile_pic, p.name, 'text-sm font-bold')}</div>
            <span class="online-dot ${isOnline ? '' : 'offline'}" style="width:8px;height:8px;"></span>
          </div>
          <div class="flex-1 min-w-0">
            <p class="font-headline-sm text-headline-sm font-semibold text-on-surface truncate">${escapeHtml(p.name)}</p>
            <p class="font-body-sm text-body-sm text-on-surface-variant truncate">${escapeHtml(p.college_name || '')} ${p.department ? '• ' + escapeHtml(p.department) : ''}</p>
          </div>
          ${button}
        </div>`;
    }).join('');

    results.forEach(p => { userSearchResults[p.id] = p; });
  }, 250);
}

const userSearchResults = {};

// ==========================================
// 17. EMOJI PICKER
// ==========================================
function emojiButtonsHtml(emojis) {
  return emojis.map(e => `<button type="button" onclick="insertEmoji('${e}')">${e}</button>`).join('');
}

function initEmojiPicker() {
  const categoryIcons = {
    'Smileys': '😀', 'Gestures': '👋', 'Hearts': '❤️',
    'Objects': '💻', 'Nature': '🌸', 'Food': '🍎', 'Flags': '🏳️'
  };

  el('emoji-categories').innerHTML = Object.keys(emojiData).map((cat, i) =>
    `<button type="button" class="${i === 0 ? 'active' : ''}" title="${cat}" onclick="selectEmojiCategory('${cat}', this)">${categoryIcons[cat] || '📁'}</button>`
  ).join('');
  renderEmojiGrid(Object.keys(emojiData)[0]);

  // Close the picker when clicking outside it
  document.addEventListener('click', (e) => {
    const picker = el('emoji-picker');
    if (picker.classList.contains('active') && !picker.contains(e.target) && !e.target.closest('[title="Insert Emoji"]')) {
      picker.classList.remove('active');
    }
  });
}

function selectEmojiCategory(cat, btn) {
  document.querySelectorAll('.emoji-categories button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  el('emoji-search-input').value = '';
  renderEmojiGrid(cat);
}

function renderEmojiGrid(category) {
  el('emoji-grid').innerHTML = emojiButtonsHtml(emojiData[category] || []);
}

function filterEmojis() {
  const query = el('emoji-search-input').value.toLowerCase().trim();
  if (!query) {
    const activeBtn = document.querySelector('.emoji-categories button.active');
    renderEmojiGrid(activeBtn ? activeBtn.title : Object.keys(emojiData)[0]);
    return;
  }

  const matches = [];
  Object.entries(emojiData).forEach(([category, emojis]) => {
    const categoryMatches = category.toLowerCase().includes(query);
    emojis.forEach(e => {
      if (categoryMatches || (emojiKeywords[e] || '').includes(query)) matches.push(e);
    });
  });
  el('emoji-grid').innerHTML = matches.length
    ? emojiButtonsHtml(matches)
    : '<p style="grid-column: 1 / -1; text-align: center; padding: 16px; font-size: 13px; color: #777587;">No emoji found.</p>';
}

function toggleEmojiPicker() {
  el('emoji-picker').classList.toggle('active');
}

function insertEmoji(emoji) {
  const input = el('message-input');
  const start = input.selectionStart;
  const end = input.selectionEnd;
  input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
  input.focus();
  input.setSelectionRange(start + emoji.length, start + emoji.length);
  autoGrowInput();
}
