// ==========================================
// EVENT-CHECKIN.JS — the door scanner (event-checkin.html?id=ID), made for a phone held by a volunteer.
// Camera scanning uses the browser's BarcodeDetector where it exists, otherwise jsQR (loaded only when needed).
// With no internet, scans wait in this browser and are sent when the connection is back (the server checks each one then).
// ==========================================

const JSQR_SCRIPT = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
const ci = { id: Number(evParam('id')), stats: null, session: '', stream: null, detector: null, busy: false, lastToken: '', lastAt: 0, queue: [] };
const QUEUE_KEY = () => `c2m:${localStorage.getItem('currentUserId')}:checkin-queue:${ci.id}`;

async function initCheckin() {
  if (!ci.id) { el('ciRoot').innerHTML = evEmptyHtml('qr_code_scanner', 'No event chosen', 'Open the scanner from the event dashboard.', ''); return; }
  try { ci.stats = await api(`/api/events/${ci.id}/checkin/stats`); }
  catch (err) {
    el('ciRoot').innerHTML = evEmptyHtml('lock', err.status === 403 ? 'Only the event staff can check people in' : 'Could not open the scanner', err.message, '<a class="ev-btn is-quiet" href="my-events.html">My events</a>');
    return;
  }
  document.title = `Check-in · ${ci.stats.title} | Connect2Minds`;
  el('ciTitle').textContent = ci.stats.title;
  el('ciSub').textContent = `${evRange(ci.stats.start_at, ci.stats.end_at)} · you are ${ci.stats.my_role}`;
  el('ciControls').innerHTML = `<button type="button" class="ev-btn" id="ciCam">${evIcon('photo_camera')}Start camera</button>
    ${ci.stats.agenda.length ? `<label><span class="ev-sr">Session</span><select class="ev-select" id="ciSession"><option value="">Whole event</option>${ci.stats.agenda.map(s => `<option value="${escapeHtml(s.key)}">${escapeHtml(s.title)}</option>`).join('')}</select></label>` : ''}
    ${ci.stats.walkins_on || ['owner', 'manager'].includes(ci.stats.my_role) ? `<button type="button" class="ev-btn is-quiet" id="ciWalk">${evIcon('person_add')}Walk-in</button>` : ''}
    ${['owner', 'manager'].includes(ci.stats.my_role) ? `<a class="ev-btn is-quiet" href="event-manage.html?id=${ci.id}&tab=checkin">${evIcon('dashboard')}Dashboard</a>` : ''}`;
  el('ciCam').addEventListener('click', toggleCamera);
  const session = el('ciSession');
  if (session) session.addEventListener('change', () => { ci.session = session.value; });
  const walk = el('ciWalk');
  if (walk) walk.addEventListener('click', walkIn);
  let typing = null;
  el('ciSearch').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(search, 300); });
  showCounts(ci.stats);
  try { ci.queue = JSON.parse(localStorage.getItem(QUEUE_KEY()) || '[]'); } catch (e) { ci.queue = []; }
  renderQueue();
  window.addEventListener('online', flushQueue);
  if (ci.queue.length) flushQueue();
  connectNotifications((data) => { if (data.type === 'event_stats' && data.event_id === ci.id) showCounts(data.stats); }, refreshStats);
}

function showCounts(stats) {
  const nodes = el('ciCounts').querySelectorAll('b');
  nodes[0].textContent = stats.registered;
  nodes[1].textContent = stats.checked_in;
  nodes[2].textContent = stats.remaining;
}
async function refreshStats() { try { showCounts(await api(`/api/events/${ci.id}/checkin/stats`)); } catch (e) { /* the next scan updates them */ } }

function showResult(kind, title, text, person) {
  const box = el('ciResult');
  box.className = `ev-scan-result is-${kind}`;
  box.innerHTML = `${person ? evFaceHtml({ name: person.name, profile_pic: person.profile_pic }) : evIcon(kind === 'ok' ? 'check_circle' : kind === 'bad' ? 'cancel' : 'hourglass_top')}
    <div><b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span></div>`;
  // Phones buzz for each result; browsers refuse before the volunteer has tapped the page once
  if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(kind === 'ok' ? 80 : [60, 60, 60]);
}

async function checkIn(body) {
  if (ci.busy) return;
  ci.busy = true;
  const payload = Object.assign({ session: ci.session }, body);
  try {
    const result = await api(`/api/events/${ci.id}/checkin`, { method: 'POST', body: payload, timeout: 12000 });
    if (result.stats) showCounts(result.stats);
    const p = result.person || {};
    const detail = [p.college, p.team ? `Team ${p.team}` : ''].filter(Boolean).join(' · ');
    if (result.ok) showResult('ok', p.name || 'Checked in', detail || 'Welcome!', p);
    else showResult('bad', p.name || 'Not admitted', result.reason, p);
  } catch (err) {
    if (err.status === 0 && body.token) {
      queueScan(payload);
      showResult('wait', 'Saved, no internet', 'This scan will be checked when the connection is back.');
    } else {
      showResult('bad', 'Not admitted', err.message);
    }
  }
  ci.busy = false;
}

// ---------- offline queue ----------
function queueScan(payload) {
  if (ci.queue.some(q => q.token === payload.token && q.session === payload.session)) return;
  ci.queue.push(Object.assign({}, payload, { offline_at: new Date().toISOString() }));
  saveQueue();
}
function saveQueue() { try { localStorage.setItem(QUEUE_KEY(), JSON.stringify(ci.queue)); } catch (e) { /* storage off */ } renderQueue(); }
function renderQueue() {
  const box = el('ciQueue');
  box.hidden = !ci.queue.length;
  box.innerHTML = ci.queue.length ? `<div class="ev-note is-warn">${evIcon('cloud_off')}<span>${ci.queue.length} scan${ci.queue.length === 1 ? '' : 's'} waiting for internet. <button type="button" class="ev-btn is-quiet is-small" id="ciFlush">Send now</button></span></div>` : '';
  const flush = el('ciFlush');
  if (flush) flush.addEventListener('click', flushQueue);
}
async function flushQueue() {
  const waiting = ci.queue.slice();
  const problems = [];
  for (const scan of waiting) {
    try {
      const result = await api(`/api/events/${ci.id}/checkin`, { method: 'POST', body: scan, timeout: 12000 });
      ci.queue = ci.queue.filter(q => q !== scan);
      if (!result.ok && !result.duplicate) problems.push(`${(result.person || {}).name || 'Someone'}: ${result.reason}`);
      if (result.stats) showCounts(result.stats);
    } catch (err) {
      if (err.status === 0) break;                 // still offline: try again later
      ci.queue = ci.queue.filter(q => q !== scan);
      problems.push(err.message);
    }
  }
  saveQueue();
  if (problems.length) showResult('bad', 'Some offline scans were refused', problems.slice(0, 3).join(' · '));
  else if (waiting.length && !ci.queue.length) evToast('Offline scans sent.');
}

// ---------- camera ----------
async function toggleCamera() {
  if (ci.stream) return stopCamera();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showResult('bad', 'No camera here', 'This browser cannot use the camera. Search people by name instead.');
  try {
    ci.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (err) {
    return showResult('bad', 'Camera blocked', 'Allow the camera for this site in the browser settings, or search by name below.');
  }
  el('ciVideo').innerHTML = '<video playsinline muted autoplay aria-label="Camera"></video><span class="ev-scan-frame" aria-hidden="true"></span>';
  const video = el('ciVideo').querySelector('video');
  video.srcObject = ci.stream;
  el('ciCam').innerHTML = `${evIcon('stop_circle')}Stop camera`;
  if ('BarcodeDetector' in window) {
    try { ci.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { ci.detector = null; }
  }
  if (!ci.detector && !window.jsQR) {
    try { await evLoadScript(JSQR_SCRIPT); } catch (err) { showResult('bad', 'Scanner could not load', err.message); }
  }
  scanLoop(video);
}

function stopCamera() {
  if (ci.stream) ci.stream.getTracks().forEach(t => t.stop());
  ci.stream = null;
  el('ciVideo').innerHTML = `<div>${evIcon('qr_code_scanner')}<p>Camera off.</p></div>`;
  el('ciCam').innerHTML = `${evIcon('photo_camera')}Start camera`;
}

async function scanLoop(video) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (!ci.stream) return;
    if (video.readyState >= 2 && !ci.busy) {
      let text = '';
      try {
        if (ci.detector) {
          const codes = await ci.detector.detect(video);
          text = codes.length ? codes[0].rawValue : '';
        } else if (window.jsQR) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          text = code ? code.data : '';
        }
      } catch (e) { /* a frame that cannot be read */ }
      // The same code in front of the camera is read many times a second: act on it once every few seconds
      if (text && (text !== ci.lastToken || Date.now() - ci.lastAt > 4000)) {
        ci.lastToken = text;
        ci.lastAt = Date.now();
        if (/^C2M\.\d+\.\d+\./.test(text)) await checkIn({ token: text });
        else showResult('bad', 'Not a ticket', 'That QR code is not a Connect2Minds ticket.');
      }
    }
    setTimeout(tick, 180);
  };
  tick();
}

// ---------- search and walk-ins ----------
async function search() {
  const q = el('ciSearch').value.trim();
  const box = el('ciPeople');
  if (q.length < 2) { box.innerHTML = ''; return; }
  try {
    const data = await api(`/api/events/${ci.id}/checkin/search?q=${encodeURIComponent(q)}`);
    box.innerHTML = data.people.length ? data.people.map(p => `<div style="display:flex;align-items:center;gap:10px">${evFaceHtml(p, 36)}<span style="flex:1;min-width:0"><b>${escapeHtml(p.name)}</b><br><span class="ev-small">${escapeHtml(p.college)} · ${escapeHtml((EV_MY_STATUS[p.status] || [p.status])[0])}</span></span>
      ${p.checked_in ? `<span class="ev-chip is-good">${evIcon('check')}In</span>` : `<button type="button" class="ev-btn is-small" data-in="${p.registration_id}">Check in</button>`}</div>`).join('')
      : '<p class="ev-small">Nobody registered matches. Use Walk-in if they turned up without registering.</p>';
    box.querySelectorAll('[data-in]').forEach(b => b.addEventListener('click', async () => { await checkIn({ registration_id: Number(b.dataset.in) }); search(); }));
  } catch (err) { box.innerHTML = `<p class="ev-small">${escapeHtml(err.message)}</p>`; }
}

function walkIn() {
  const { box, close } = evDialog('Register a walk-in', `<p class="ev-small">They need a Connect2Minds account. They are registered and checked in at once.</p>
    <label class="ev-field"><span class="ev-label">Find them</span><input id="wkQ" placeholder="Name, roll number or email" autocomplete="off"></label><div id="wkPeople" style="display:flex;flex-direction:column;gap:6px"></div>`, '');
  let typing = null;
  box.querySelector('#wkQ').addEventListener('input', (e) => {
    clearTimeout(typing);
    typing = setTimeout(async () => {
      const data = await api(`/api/events/${ci.id}/walkin-search?q=${encodeURIComponent(e.target.value)}`).catch(() => ({ people: [] }));
      box.querySelector('#wkPeople').innerHTML = data.people.map(p => `<button type="button" class="ev-btn is-quiet" data-walk="${p.id}" style="justify-content:flex-start">${evFaceHtml(p, 28)} ${escapeHtml(p.name)} <span class="ev-small">${escapeHtml(p.college)}</span></button>`).join('')
        || '<p class="ev-small">Nobody found. They can sign up on their phone first.</p>';
      box.querySelectorAll('[data-walk]').forEach(b => b.addEventListener('click', async () => { close(); await checkIn({ walkin_user_id: Number(b.dataset.walk) }); }));
    }, 300);
  });
}

window.addEventListener('pagehide', stopCamera);
initCheckin();
