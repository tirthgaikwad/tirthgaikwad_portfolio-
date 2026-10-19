// ==========================================
// CHAT-COMMON.JS — Helpers shared by the Messages page (inbox.js) and the Teams page (team.js)
// Loaded after shared.js (API_BASE, escapeHtml, safeUrl, showSystemModal) and before the page script.
// ==========================================

const currentUserId = parseInt(localStorage.getItem('currentUserId'));
if (!currentUserId) { window.goToLogin(); }

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
    if (res.status === 402 && typeof window.upgradePrompt === 'function') {
      // A plan limit: the pop-up explains it and links to the plans
      window.upgradePrompt(data && typeof data.detail === 'string' ? data.detail : '');
    }
    if (!res.ok) {
      // A detail may be a plain message, or { message, ... } with more for the page (for example the newer version on a 409)
      const detail = data && data.detail;
      const message = typeof detail === 'string' ? detail : (detail && typeof detail.message === 'string' ? detail.message : 'Something went wrong. Please try again.');
      throw Object.assign(new ApiError(res.status, message), { data: detail });
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
  window.goToLogin();
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

// Live updates for pages that have no chat socket of their own (Discover, the Opportunities Board, the people pages).
// onEvent gets every page event; bell notifications go to the header bell in shared.js. onReconnect runs
// after a dropped connection comes back, because anything sent in between was missed.
let notificationSocket = null;

function connectNotifications(onEvent, onReconnect) {
  window.__bellSocketOwned = true;   // tells shared.js not to open a second socket for the bell
  let retries = 0;
  const open = () => {
    let socket;
    try {
      socket = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/api/ws/notifications/${currentUserId}`);
    } catch (e) { return; }
    notificationSocket = socket;

    socket.onopen = () => {
      if (retries > 0) {
        if (onReconnect) onReconnect();
        loadBell();
      }
      retries = 0;
    };
    socket.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (!data) return;
      if (data.content) window.onBellNotification(data);   // a bell notification for us
      else onEvent(data);
    };
    socket.onclose = () => {
      if (notificationSocket !== socket) return;
      notificationSocket = null;
      setTimeout(open, Math.min(30000, 1000 * 2 ** retries++));
    };
  };
  open();
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

// Shrinks a picture in the browser before it is uploaded: at most maxSide pixels on the long side.
// PNGs stay PNG (they may be see-through) unless that makes them large; a small GIF is sent as it is, so it keeps moving.
// Resolves to { blob, width, height }.
function shrinkImageFile(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG, WebP or GIF picture.'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('That picture is too large. Choose one under 15 MB.'));
    const image = new Image();
    const address = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(address);
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (file.type === 'image/gif' && file.size <= 3 * 1024 * 1024) return resolve({ blob: file, width, height });
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const asJpeg = () => {
        // JPEG has no see-through parts: put white behind them instead of black
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error('That picture could not be read.'))), 'image/jpeg', 0.86);
      };
      if (file.type !== 'image/png') return asJpeg();
      canvas.toBlob(blob => {
        if (blob && blob.size <= 2.5 * 1024 * 1024) resolve({ blob, width: canvas.width, height: canvas.height });
        else asJpeg();
      }, 'image/png');
    };
    image.onerror = () => { URL.revokeObjectURL(address); reject(new Error('That file is not a picture we can read.')); };
    image.src = address;
  });
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
// 6. PEOPLE CARDS (Discover, Campus Network, My Network, Saved Profiles)
// ==========================================
const MAX_SKILLS_ON_CARD = 5;
const norm = (value) => String(value || '').trim().toLowerCase();

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

// A person as stored in the page cache: without the search index
function plainPerson({ x, ...person }) {
  return person;
}

function personAvatarHtml(person) {
  const initials = `<span class="text-primary font-bold text-headline-md">${escapeHtml(getInitials(person.name || '?'))}</span>`;
  const picture = safeUrl(person.profile_pic);
  if (!person.profile_pic || picture === '#') return initials;
  return `<img src="${escapeHtml(picture)}" alt="" loading="lazy" decoding="async" data-initials="${escapeHtml(getInitials(person.name || '?'))}" class="w-full h-full object-cover"/>`;
}

// One person's card. options: mySkills (Set of our own skills, highlighted), pending (Set of "follow:12" keys
// with a request in flight), note (extra HTML for the line under the skills), selected (true/false shows a checkbox).
function personCardHtml(person, options = {}) {
  const mySkills = options.mySkills || new Set();
  const pending = options.pending || new Set();
  const profileLink = `profile.html?id=${person.id}`;
  const online = onlineUserIds.has(person.id);
  const place = [person.department, person.city].filter(Boolean).join(' · ');
  const shown = person.x.skills.slice(0, MAX_SKILLS_ON_CARD);
  const extra = person.x.skills.length - shown.length;
  const skillsHtml = shown.map(skill => {
    const shared = mySkills.has(norm(skill));
    return `<button type="button" data-skill="${escapeHtml(skill)}" title="${shared ? 'You both list this skill. ' : ''}Search ${escapeHtml(skill)}" class="px-2 py-0.5 rounded font-skill-pill text-skill-pill transition-colors ${shared ? 'bg-primary-fixed text-on-primary-fixed-variant hover:bg-primary-fixed-dim' : 'bg-surface-container text-on-surface hover:bg-surface-container-high'}">${escapeHtml(skill)}</button>`;
  }).join('') + (extra > 0 ? `<span class="px-2 py-0.5 rounded text-outline font-skill-pill text-skill-pill">+${extra}</span>` : '');
  const followBusy = pending.has(`follow:${person.id}`) ? 'disabled' : '';
  const saveBusy = pending.has(`save:${person.id}`) ? 'disabled' : '';
  const followLabel = person.is_following ? 'Following' : (person.follows_me ? 'Follow back' : 'Follow');
  const relation = person.is_following && person.follows_me ? 'you follow each other' : (person.is_following ? 'you follow' : (person.follows_me ? 'follows you' : ''));
  const checkbox = typeof options.selected === 'boolean'
    ? `<input type="checkbox" data-select aria-label="Select ${escapeHtml(person.name)}" ${options.selected ? 'checked' : ''} class="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"/>`
    : '';

  return `
    <article class="developer-card group bg-surface-container-lowest rounded-xl p-space-lg shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col relative ${options.selected ? 'ring-2 ring-primary' : ''}" data-id="${person.id}">
      <div class="flex items-start justify-between gap-space-sm mb-space-md">
        <a class="relative block shrink-0" href="${profileLink}" aria-label="${escapeHtml(person.name)}'s profile">
          <div class="w-16 h-16 rounded-full overflow-hidden shadow-md ring-2 ring-surface-container bg-surface-container flex items-center justify-center">${personAvatarHtml(person)}</div>
          <span data-online-dot class="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white ${online ? '' : 'hidden'}" title="Online now"></span>
        </a>
        <div class="flex items-center gap-1">
          ${checkbox}
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
          ${window.roleBadgesHtml ? window.roleBadgesHtml(person) : ''}
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
        <p class="font-body-sm text-body-sm text-on-surface-variant mb-space-xs flex items-center gap-1 flex-wrap">
          <span class="material-symbols-outlined text-[15px]">group</span>
          <span>${person.followers_count} ${person.followers_count === 1 ? 'follower' : 'followers'}</span>
          ${relation ? `<span class="text-outline">· ${relation}</span>` : ''}
          ${options.note ? `<span class="text-outline">· ${options.note}</span>` : ''}
        </p>
        <div class="flex items-center gap-2">
          <a class="flex-1 py-2 px-3 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md text-center transition-colors" href="${profileLink}">View Profile</a>
          <button type="button" data-action="follow" ${followBusy} aria-pressed="${person.is_following}" class="py-2 px-3 rounded-lg font-label-md text-label-md flex items-center gap-1 transition-colors ${person.is_following ? 'border border-outline-variant/60 text-on-surface-variant hover:text-error hover:border-error/40' : 'bg-primary hover:bg-primary-container text-on-primary'}">
            <span class="material-symbols-outlined text-[16px]">${person.is_following ? 'check' : 'person_add'}</span>
            <span>${followLabel}</span>
          </button>
          <a class="py-2 px-2.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors" title="Message" aria-label="Message ${escapeHtml(person.name)}" href="inbox.html?user=${person.id}">
            <span class="material-symbols-outlined text-[20px] block">chat</span>
          </a>
        </div>
      </div>
    </article>`;
}

function peopleStateBlock(icon, title, text, buttonHtml) {
  return `
    <div class="col-span-full flex flex-col items-center text-center py-space-2xl">
      <span class="material-symbols-outlined text-[44px] text-outline-variant mb-space-xs">${icon}</span>
      <h3 class="font-headline-md text-headline-md text-on-surface">${escapeHtml(title)}</h3>
      <p class="font-body-md text-body-md text-on-surface-variant mt-1 max-w-md">${escapeHtml(text)}</p>
      ${buttonHtml ? `<div class="mt-space-md">${buttonHtml}</div>` : ''}
    </div>`;
}

function peopleSkeletonHtml(count) {
  const card = `
    <div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm">
      <div class="skeleton w-16 h-16 mb-space-md" style="border-radius:9999px;"></div>
      <div class="skeleton h-5 w-2/3 mb-2"></div>
      <div class="skeleton h-3.5 w-1/2 mb-space-md"></div>
      <div class="skeleton h-3.5 w-full mb-2"></div>
      <div class="skeleton h-3.5 w-4/5 mb-space-md"></div>
      <div class="skeleton h-9 w-full"></div>
    </div>`;
  return card.repeat(count);
}

// "Showing 1 - 9 of 40 people" with Previous / page numbers / Next. Buttons carry data-page.
function peoplePaginationHtml(currentPage, total, start, shownCount, totalPages, nouns = ['person', 'people']) {
  if (total === 0) return '';
  const pageButton = (page) => page === currentPage
    ? `<button class="w-8 h-8 rounded-lg bg-primary text-on-primary font-label-md text-label-md flex items-center justify-center font-bold shadow-sm" type="button" aria-current="page">${page}</button>`
    : `<button class="w-8 h-8 rounded-lg text-on-surface-variant hover:bg-surface-container font-label-md text-label-md flex items-center justify-center transition-colors" type="button" data-page="${page}">${page}</button>`;
  let pages = '';
  for (let page = 1; page <= totalPages; page++) {
    if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) pages += pageButton(page);
    else if (Math.abs(page - currentPage) === 2) pages += '<span class="px-1 text-outline font-label-md">...</span>';
  }
  const stepClass = 'px-3 py-1.5 rounded-lg border border-outline-variant/60 text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-label-md text-label-md disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1 transition-colors';

  return `
    <div class="font-body-sm text-body-sm text-on-surface-variant">
      Showing <span class="font-medium text-on-surface">${start + 1} - ${start + shownCount}</span> of <span class="font-medium text-on-surface">${total}</span> ${total === 1 ? nouns[0] : nouns[1]}
    </div>
    <div class="flex items-center gap-1 ${totalPages === 1 ? 'hidden' : ''}">
      <button class="${stepClass}" type="button" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>
        <span class="material-symbols-outlined text-[16px]">chevron_left</span> Previous
      </button>
      ${pages}
      <button class="${stepClass}" type="button" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>
        Next <span class="material-symbols-outlined text-[16px]">chevron_right</span>
      </button>
    </div>`;
}

// A picture that fails to load is swapped for the person's initials
function bindAvatarFallback(container) {
  container.addEventListener('error', (e) => {
    if (e.target.tagName !== 'IMG') return;
    const initials = document.createElement('span');
    initials.className = 'text-primary font-bold text-headline-md';
    initials.textContent = e.target.dataset.initials || '?';
    e.target.replaceWith(initials);
  }, true);
}

// Follow or save a person. The card changes at once (redraw is called); the server's answer then
// confirms it or puts it back. Resolves to false if a request for this person was already running.
async function togglePersonRelation(kind, person, pending, redraw) {
  const key = `${kind}:${person.id}`;
  if (pending.has(key)) return false;
  pending.add(key);

  const field = kind === 'follow' ? 'is_following' : 'is_saved';
  const before = person[field];
  const followersBefore = person.followers_count;
  const apply = (value) => {
    person[field] = value;
    if (kind === 'follow') person.followers_count = Math.max(0, followersBefore + (value === before ? 0 : (value ? 1 : -1)));
  };

  apply(!before);
  redraw();
  try {
    const result = await api(`/api/${kind}/${person.id}`, { method: 'POST' });
    apply(result.status === (kind === 'follow' ? 'followed' : 'saved'));
    if (kind === 'follow') showToast(person.is_following ? `You are now following ${person.name}.` : `You unfollowed ${person.name}.`);
    else showToast(person.is_saved ? 'Saved. Find it under Saved Profiles.' : 'Removed from Saved Profiles.');
  } catch (err) {
    apply(before);
    showToast(err.message);
  }
  pending.delete(key);
  redraw();
  return true;
}

// The page head may already have asked for the page's data (window.__pagePrefetch); that answer is used once.
async function fetchPageData(path) {
  const prefetched = window.__pagePrefetch ? await window.__pagePrefetch : null;
  window.__pagePrefetch = null;
  if (prefetched && prefetched.status === 200) return prefetched.data;
  if (prefetched && prefetched.status === 401) { handleLoggedOut(); throw new ApiError(401, 'Please log in again.'); }
  return api(path);
}

// Applies a live event to the people a page holds (a Map by id). Returns 'presence' when only an online dot
// changed, 'changed' when a card's contents changed, and '' when the event is not about these people.
function applyPeopleEvent(data, peopleById, pending) {
  if (data.type === 'presence') {
    if (data.online) onlineUserIds.add(data.user_id); else onlineUserIds.delete(data.user_id);
    return peopleById.has(data.user_id) ? 'presence' : '';
  }
  if (data.type === 'profile_updated') {
    const person = data.profile && peopleById.get(data.profile.id);
    if (!person) return '';
    Object.assign(person, data.profile);
    indexPerson(person);
    return 'changed';
  }
  if (data.type === 'follow_changed') {
    let changed = '';
    const followed = peopleById.get(data.followed_id);
    if (followed) {
      const mine = data.follower_id === currentUserId;
      // Our own follow, made here or in another tab. The button already shows it if it was made here.
      const alreadyShown = mine && (followed.is_following === data.following || pending.has(`follow:${followed.id}`));
      if (!alreadyShown) {
        if (mine) followed.is_following = data.following;
        followed.followers_count = Math.max(0, followed.followers_count + (data.following ? 1 : -1));
        changed = 'changed';
      }
    }
    const follower = data.followed_id === currentUserId ? peopleById.get(data.follower_id) : null;
    if (follower && follower.follows_me !== data.following) {
      follower.follows_me = data.following;
      changed = 'changed';
    }
    return changed;
  }
  return '';
}

// Our own skills, lower-cased, from the header profile (or its cached copy)
function ownSkillSet() {
  const me = window.currentUserProfile || cacheGet('me') || {};
  return new Set(String(me.skills || '').split(',').map(norm).filter(Boolean));
}

// Copies text and says so. Falls back to showing the text when the clipboard is not available.
async function copyText(text, doneMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(doneMessage || 'Copied.');
  } catch (e) {
    window.showSystemModal('Copy this link', escapeHtml(text), 'alert');
  }
}

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

// ==========================================
// REPORTING (section 31 of main.py): one dialog for every page.
// openReportDialog({ kind, id, name, onBlock }) — kind is user, message, team_message, college_message, board_post
// or team; onBlock, when given, adds an "Also block" box and is called after the report is sent.
// reportButtonHtml(kind, id, name) is the small flag button shown on other people's messages.
// ==========================================
const REPORT_REASON_LIST = [
  ['harassment', 'Harassment or bullying'], ['hate', 'Hate or discrimination'], ['sexual', 'Sexual content'],
  ['violence', 'Threats or violence'], ['self_harm', 'Self-harm or suicide'], ['spam', 'Spam'], ['scam', 'Scam or fraud'],
  ['fake_profile', 'Fake profile'], ['impersonation', 'Pretending to be someone else'], ['privacy', "Shares someone's private information"],
  ['copyright', 'Copyright'], ['other', 'Something else'],
];
const REPORT_WHAT = { user: 'this person', message: 'this message', team_message: 'this message', college_message: 'this message', board_post: 'this post', team: 'this team', event: 'this event' };

function reportButtonHtml(kind, id, name) {
  if (!id) return '';
  return `<button class="hidden group-hover/msg:inline-flex p-0.5 text-on-surface-variant hover:text-error transition-colors" title="Report" aria-label="Report" type="button"
    data-report-kind="${kind}" data-report-id="${Number(id)}" data-report-name="${escapeHtml(name || '')}"><span class="material-symbols-outlined text-[14px]">flag</span></button>`;
}
// Any element with data-report-kind / data-report-id opens the dialog (message bubbles, menus, cards)
document.addEventListener('click', (e) => {
  const button = e.target.closest && e.target.closest('[data-report-kind][data-report-id]');
  if (!button) return;
  e.preventDefault();
  e.stopPropagation();
  openReportDialog({ kind: button.dataset.reportKind, id: Number(button.dataset.reportId), name: button.dataset.reportName || '' });
}, true);

function openReportDialog({ kind, id, name, onBlock }) {
  if (!document.querySelector('link[href="report.css"]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'report.css';
    document.head.appendChild(css);
  }
  document.getElementById('rpDialog')?.remove();
  const who = name ? escapeHtml(name) : '';
  const box = document.createElement('div');
  box.id = 'rpDialog';
  box.className = 'rp-overlay';
  box.innerHTML = `<form class="rp-box" role="dialog" aria-modal="true" aria-labelledby="rpTitle" novalidate>
      <h2 id="rpTitle">Report ${kind === 'user' && who ? who : REPORT_WHAT[kind] || 'this'}</h2>
      <p class="rp-sub">Only the Connect2Minds team sees who reported. We acknowledge it within 24 hours and decide within 15 days.</p>
      <fieldset><legend>What is wrong?</legend><div class="rp-reasons">
        ${REPORT_REASON_LIST.map(([key, label]) => `<label><input type="radio" name="reason" value="${key}"><span>${escapeHtml(label)}</span></label>`).join('')}
      </div></fieldset>
      <label class="rp-field">Anything else we should know? (optional)<textarea name="details" maxlength="1000" rows="3"></textarea></label>
      ${onBlock ? `<label class="rp-check"><input type="checkbox" name="block" checked><span>Also block ${who || 'them'}</span></label>` : ''}
      <p class="rp-help">If someone is in danger, call <b>112</b>. For self-harm, Tele-MANAS is free on <b>14416</b>.</p>
      <p class="rp-error" role="alert" hidden></p>
      <div class="rp-actions"><button type="button" class="rp-btn" data-rp-close>Cancel</button><button type="submit" class="rp-btn is-primary">Send report</button></div>
    </form>`;
  const form = box.querySelector('form');
  const error = box.querySelector('.rp-error');
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-rp-close]')) close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = form.reason.value;
    if (!reason) { error.textContent = 'Pick what is wrong.'; error.hidden = false; return; }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = await api('/api/reports', { method: 'POST', body: { kind, target_id: Number(id), reason, details: form.details.value.trim() } });
      if (onBlock && form.block && form.block.checked) { try { await onBlock(); } catch (err) { /* the report still went */ } }
      form.innerHTML = `<h2>Thank you</h2><p class="rp-sub">We got your report (#${data.id}). We will look at it and tell you what we decided in your notifications.</p>
        <div class="rp-actions"><button type="button" class="rp-btn is-primary" data-rp-close>Done</button></div>`;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
  document.body.appendChild(box);
  form.querySelector('input[name="reason"]').focus();
}
