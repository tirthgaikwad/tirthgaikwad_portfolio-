// ==========================================
// EVENTS-COMMON.JS — shared by every events page. Loaded after shared.js (escapeHtml, safeUrl, API_BASE) and, on pages for
// members, after chat-common.js (api, el, showToast). event.html and certificate-check.html also open for visitors, who do not
// load chat-common.js: evApi() then falls back to a plain fetch.
// Times come from the server in UTC and are always shown in India time (the site's clock), whatever the device says.
// ==========================================

// Visitors do not load chat-common.js, which gives the member pages el()
if (typeof window.el !== 'function') window.el = (id) => document.getElementById(id);

const EV_TZ = 'Asia/Kolkata';
const EV_KIND_ICONS = {
  seminar: 'co_present', workshop: 'construction', webinar: 'videocam', hackathon: 'code', competition: 'emoji_events', fest: 'celebration',
  sports: 'sports_soccer', guest_lecture: 'record_voice_over', placement: 'work', recruitment: 'groups', orientation: 'explore',
  conference: 'forum', exhibition: 'museum', training: 'school', meetup: 'diversity_3', quiz: 'quiz', other: 'event'
};
const evIcon = (name, extra) => `<span class="material-symbols-outlined${extra ? ' ' + extra : ''}" aria-hidden="true">${name}</span>`;

// ---------- talking to the server ----------
async function evApi(path, options) {
  if (typeof window.api === 'function' && localStorage.getItem('currentUserId')) return window.api(path, options);
  const opts = options || {};
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: opts.method || 'GET', credentials: 'include',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    const error = new Error('Could not reach the server. Check your connection.');
    error.status = 0;
    throw error;
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) {
    const detail = data && data.detail;
    const error = new Error(typeof detail === 'string' ? detail : (detail && detail.message) || 'Something went wrong.');
    error.status = res.status;
    error.data = detail;
    throw error;
  }
  return data;
}

function evToast(message) {
  if (typeof window.showToast === 'function') return window.showToast(message);
  const toast = document.createElement('div');
  toast.className = 'chat-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ---------- dates in India time ----------
function evParts(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date)) return null;
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: EV_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  return parts;
}
function evDay(iso, opts) {
  return iso ? new Intl.DateTimeFormat('en-IN', Object.assign({ timeZone: EV_TZ, weekday: 'short', day: 'numeric', month: 'short' }, opts || {})).format(new Date(iso)) : '';
}
function evTime(iso) {
  return iso ? new Intl.DateTimeFormat('en-IN', { timeZone: EV_TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).replace(' ', ' ').toUpperCase() : '';
}
function evWhen(iso) { return iso ? `${evDay(iso)}, ${evTime(iso)}` : ''; }
function evRange(start, end) {
  if (!start) return 'Date to be announced';
  if (!end) return evWhen(start);
  const sameDay = evDayKey(start) === evDayKey(end);
  return sameDay ? `${evDay(start)}, ${evTime(start)} – ${evTime(end)}` : `${evWhen(start)} – ${evWhen(end)}`;
}
function evDayKey(iso) { const p = evParts(iso); return p ? `${p.year}-${p.month}-${p.day}` : ''; }
function evDuration(start, end) {
  if (!start || !end) return '';
  const minutes = Math.round((new Date(end) - new Date(start)) / 60000);
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 6) / 10} h`.replace('.0 h', ' h');
  return `${Math.round(minutes / 1440)} days`;
}
// For <input type="datetime-local">: the India-time wall clock of a UTC moment, and back (the server reads it as India time)
function evToInput(iso) { const p = evParts(iso); return p ? `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` : ''; }
function evFromInput(value) { return value ? `${value}:00+05:30` : ''; }
function evRelative(iso) {
  if (!iso) return '';
  const minutes = Math.round((new Date(iso) - Date.now()) / 60000);
  const abs = Math.abs(minutes);
  const text = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
  return minutes >= 0 ? `in ${text}` : `${text} ago`;
}

// ---------- status chips and cards ----------
const EV_STATUS_STYLE = {
  'Open': 'is-good', 'Almost full': 'is-warn', 'Waitlist': 'is-warn', 'Full': 'is-bad', 'Closed': 'is-grey', 'Opens soon': '', 'Live': 'is-live',
  'Completed': 'is-grey', 'Cancelled': 'is-bad', 'Draft': 'is-grey', 'In review': '', 'Changes requested': 'is-warn', 'Rejected': 'is-bad', 'Removed': 'is-bad'
};
function evStatusChip(label) { return `<span class="ev-chip ${EV_STATUS_STYLE[label] || ''}">${escapeHtml(label)}</span>`; }

const EV_MY_STATUS = { confirmed: ['Registered', 'is-good'], pending: ['Awaiting approval', ''], waitlisted: ['Waitlisted', 'is-warn'],
  cancelled: ['Cancelled', 'is-grey'], rejected: ['Not accepted', 'is-bad'], removed: ['Removed', 'is-bad'], no_show: ['Missed', 'is-grey'] };
function evMyChip(status) { const s = EV_MY_STATUS[status]; return s ? `<span class="ev-chip ${s[1]}">${s[0]}</span>` : ''; }

function evPosterHtml(ev, big) {
  const kind = `<span class="ev-poster-kind">${evIcon(EV_KIND_ICONS[ev.kind] || 'event')}${big ? '' : escapeHtml(ev.kind_label || '')}</span>`;
  return `<div class="ev-poster">${ev.poster_url ? `<img src="${escapeHtml(safeUrl(ev.poster_url))}" alt="" loading="lazy" onerror="this.remove()">` : kind}</div>`;
}

function evPlace(ev) {
  if (ev.mode === 'online') return 'Online';
  return [ev.venue, ev.city].filter(Boolean).join(', ') + (ev.mode === 'hybrid' ? ' · and online' : '') || 'Venue to be announced';
}

function evHostName(host) {
  return host ? `${escapeHtml(host.name || '')}${host.verified ? ` ${evIcon('verified', 'ev-verified')}<span class="ev-sr">verified</span>` : ''}` : '';
}

function evCardHtml(ev, options) {
  const opts = options || {};
  const parts = evParts(ev.start_at);
  const month = ev.start_at ? new Intl.DateTimeFormat('en-IN', { timeZone: EV_TZ, month: 'short' }).format(new Date(ev.start_at)) : '';
  const seats = ev.capacity ? (ev.seats_left > 0 ? `<span class="ev-seats${ev.seats_left <= Math.max(3, ev.capacity * 0.1) ? ' is-low' : ''}">${ev.seats_left} seat${ev.seats_left === 1 ? '' : 's'} left</span>` : '<span class="ev-seats is-low">Full</span>')
    : '<span class="ev-seats">Open seats</span>';
  const link = opts.link || `event.html?id=${ev.id}`;
  return `<article class="ev-card" data-event-id="${ev.id}">
    ${evPosterHtml(ev)}
    <span class="ev-card-status">${ev.my_status ? evMyChip(ev.my_status) : evStatusChip(ev.display_status)}</span>
    ${opts.noSave ? '' : `<button type="button" class="ev-iconbtn ev-card-save" data-ev-save="${ev.id}" aria-pressed="${ev.saved ? 'true' : 'false'}" aria-label="${ev.saved ? 'Saved' : 'Save'} ${escapeHtml(ev.title)}" title="${ev.saved ? 'Saved' : 'Save'}">${evIcon(ev.saved ? 'bookmark_added' : 'bookmark_add')}</button>`}
    ${parts ? `<span class="ev-date-badge" aria-hidden="true"><b>${parts.day.replace(/^0/, '')}</b><span>${month}</span></span>` : ''}
    <div class="ev-card-body">
      <h3 class="ev-card-title"><a href="${escapeHtml(link)}">${escapeHtml(ev.title)}</a></h3>
      <p class="ev-card-host">${evHostName(ev.host)}${ev.college_name && ev.host && ev.host.kind !== 'college' ? ` · ${escapeHtml(ev.college_name)}` : ''}</p>
      <div class="ev-card-facts">
        <span>${evIcon('schedule')}${escapeHtml(evRange(ev.start_at, ev.end_at))}</span>
        <span>${evIcon(ev.mode === 'online' ? 'videocam' : 'location_on')}${escapeHtml(evPlace(ev))}</span>
      </div>
      <div class="ev-card-foot">${opts.foot || `${seats}<span>Free</span>`}</div>
    </div>
  </article>`;
}

// Save buttons on cards (they sit on top of the card's link)
document.addEventListener('click', async (e) => {
  const button = e.target.closest && e.target.closest('[data-ev-save]');
  if (!button) return;
  e.preventDefault();
  e.stopPropagation();
  if (!localStorage.getItem('currentUserId')) { location.href = `login.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`; return; }
  button.disabled = true;
  try {
    const result = await evApi(`/api/events/${button.dataset.evSave}/save`, { method: 'POST' });
    button.setAttribute('aria-pressed', result.saved ? 'true' : 'false');
    button.innerHTML = evIcon(result.saved ? 'bookmark_added' : 'bookmark_add');
    button.title = result.saved ? 'Saved' : 'Save';
    evToast(result.saved ? 'Saved. Find it under Saved.' : 'Removed from Saved.');
  } catch (err) { evToast(err.message); }
  button.disabled = false;
});

// ---------- sharing and calendars ----------
function evGoogleCalendar(ev) {
  const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${stamp(ev.start_at)}/${stamp(ev.end_at || ev.start_at)}`,
    details: `${ev.tagline || ''}\n${ev.page_url || location.href}`.trim(), location: ev.mode === 'online' ? 'Online' : [ev.venue, ev.room, ev.address, ev.city].filter(Boolean).join(', ') });
  return `https://calendar.google.com/calendar/render?${params}`;
}
function evWhatsApp(ev) {
  const text = `${ev.title}\n${evRange(ev.start_at, ev.end_at)} · ${evPlace(ev)}\n${ev.share_url || location.href}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
async function evCopy(text, message) {
  try { await navigator.clipboard.writeText(text); evToast(message || 'Link copied.'); }
  catch (e) { window.prompt('Copy this link:', text); }
}

// ---------- QR codes (drawing: qrcodejs, the same library the two-step login set-up uses) ----------
const EV_QR_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
let evQrLoading = null;
function evLoadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('A part of the page could not be loaded. Check your connection.'));
    document.head.appendChild(script);
  });
}
async function evDrawQr(box, text, size) {
  if (!window.QRCode) { evQrLoading = evQrLoading || evLoadScript(EV_QR_SCRIPT); await evQrLoading; }
  box.innerHTML = '';
  new window.QRCode(box, { text, width: size || 216, height: size || 216, correctLevel: window.QRCode.CorrectLevel.M });
  box.setAttribute('role', 'img');
}

// ---------- pictures: shrink in the browser (at most 1600 px wide, JPEG), then upload ----------
function evShrinkImage(file, maxWidth) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return reject(new Error('Choose a JPG, PNG or WebP picture.'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('That picture is too large. Choose one under 15 MB.'));
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, (maxWidth || 1600) / image.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('That picture could not be read.')), 'image/jpeg', 0.86);
    };
    image.onerror = () => reject(new Error('That file is not a picture we can read.'));
    image.src = URL.createObjectURL(file);
  });
}
async function evUploadPicture(file, maxWidth) {
  const blob = await evShrinkImage(file, maxWidth);
  const form = new FormData();
  form.append('file', blob, 'poster.jpg');
  const res = await fetch(`${API_BASE}/api/events/upload/poster`, { method: 'POST', body: form, credentials: 'include' });
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error(data && typeof data.detail === 'string' ? data.detail : 'Upload failed. Try again.');
  return data.url;
}

// ---------- small shared pieces ----------
function evFaceHtml(person, size) {
  const name = (person && person.name) || '?';
  const initials = typeof getInitials === 'function' ? getInitials(name) : name.slice(0, 2).toUpperCase();
  return `<span class="ev-face"${size ? ` style="width:${size}px;height:${size}px"` : ''}>${person && person.profile_pic ? `<img src="${escapeHtml(safeUrl(person.profile_pic))}" alt="">` : escapeHtml(initials)}</span>`;
}
function evEmptyHtml(icon, title, text, action) {
  return `<div class="ev-empty">${evIcon(icon)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${action || ''}</div>`;
}
function evParam(name) { return new URLSearchParams(location.search).get(name) || ''; }

// A dialog that keeps keyboard focus inside and closes with Escape. Returns {box, close}.
function evDialog(title, bodyHtml, footHtml, options) {
  const opts = options || {};
  const overlay = document.createElement('div');
  overlay.className = 'ev-overlay';
  overlay.innerHTML = `<div class="ev-dialog" role="dialog" aria-modal="true" aria-labelledby="evDialogTitle"${opts.wide ? ' style="max-width:760px"' : ''}>
    <div class="ev-dialog-head"><h2 id="evDialogTitle">${escapeHtml(title)}</h2><button type="button" class="ev-iconbtn" data-ev-close aria-label="Close">${evIcon('close')}</button></div>
    ${opts.steps ? `<div class="ev-steps" aria-hidden="true">${Array.from({ length: opts.steps }, () => '<span></span>').join('')}</div>` : ''}
    <div class="ev-dialog-body">${bodyHtml}</div>${footHtml ? `<div class="ev-dialog-foot">${footHtml}</div>` : ''}</div>`;
  const before = document.activeElement;
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (before && before.focus) before.focus(); if (opts.onClose) opts.onClose(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const focusable = [...overlay.querySelectorAll('button, [href], input, select, textarea')].filter(n => !n.disabled && n.offsetParent !== null);
      if (!focusable.length) return;
      if (e.shiftKey && document.activeElement === focusable[0]) { e.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === focusable[focusable.length - 1]) { e.preventDefault(); focusable[0].focus(); }
    }
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-ev-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  setTimeout(() => { const first = overlay.querySelector('.ev-dialog-body input, .ev-dialog-body select, .ev-dialog-body textarea, .ev-dialog-body button') || overlay.querySelector('[data-ev-close]'); if (first) first.focus(); }, 30);
  return { box: overlay.querySelector('.ev-dialog'), close };
}
