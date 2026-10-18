// ==========================================
// ROOMS.JS — Study rooms (rooms.html). rooms.html lists my college's rooms; rooms.html?room=ID is one room with its
// shared timer, the people in it, reactions and nudges. Live changes come over the notification socket
// (room_state, room_reaction, room_nudge, room_closed). Loaded after shared.js, chat-common.js and formsheet.js.
// ==========================================

let roomsData = null;              // /api/rooms
let room = null;                   // the room I am in, as the server last sent it
let roomSeenAt = 0;                // when that state arrived (the countdown runs from it)
let roomTick = null, roomPing = null;
let focusSeen = null;              // { round, startedAt } of the focus round I am counted in, to log its minutes when it ends
let mySubject = localStorage.getItem('c2m:roomSubject') || '';
const rmIcon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
const rmPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function roomId() { return Number(new URLSearchParams(location.search).get('room')) || 0; }

function initRooms() {
  document.addEventListener('click', onRoomsClick);
  document.addEventListener('change', onRoomsChange);
  window.addEventListener('popstate', showRooms);
  window.addEventListener('pagehide', () => { if (room) fetch(`${API_BASE}/api/rooms/${room.id}/leave`, { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {}); });
  connectNotifications(onRoomEvent, () => { if (room) joinRoom(room.id, true); });
  showRooms();
}

function goRooms(id) {
  history.pushState({}, '', id ? `rooms.html?room=${id}` : 'rooms.html');
  showRooms();
}

async function showRooms() {
  const id = roomId();
  if (!id && room) leaveRoom(true);
  if (id) return joinRoom(id);
  try {
    roomsData = await fetchPageData('/api/rooms');
    renderList();
  } catch (err) {
    el('roomsView').innerHTML = `<div class="hm-card hm-problem">${rmIcon('cloud_off')}<p>${escapeHtml(err.message)}</p></div>`;
  }
}

function faceHtml(person) {
  return `<span class="rm-face" title="${escapeHtml(person.name)}">${person.pic ? `<img src="${escapeHtml(person.pic)}" alt="" loading="lazy"/>` : escapeHtml(getInitials(person.name))}</span>`;
}

function phaseLabel(r) {
  return { focus: 'Focusing', break: 'On a break', paused: 'Paused', idle: 'Not started' }[r.phase] || r.phase;
}

function renderList() {
  const d = roomsData;
  el('roomsView').innerHTML = `
    <section class="hm-hero">
      <div class="hm-hero-text"><p class="hm-date">Study</p><h1 class="hm-title">Study rooms</h1>
        <p class="hm-sub">Study alongside classmates on one shared timer. No camera, no chat: just everyone focusing together.</p></div>
      <nav class="hm-quick" aria-label="Study"><a href="study.html?tab=timer">${rmIcon('timer')}Solo timer</a><a href="progress.html">${rmIcon('leaderboard')}League</a></nav>
    </section>
    <div class="rm-now">${d.studying_people ? '<span class="rm-pulse" aria-hidden="true"></span>' : ''}<b>${d.studying_people}</b>
      <div><strong>${d.studying_people === 1 ? 'person' : 'people'} from ${escapeHtml(d.college || 'your college')} studying right now</strong>
        <small>Counted while a focus timer runs, solo or in a room.</small></div>
      <button class="hm-btn" type="button" data-rm="create">${rmIcon('add')}Open a room</button></div>
    <div class="hm-grid">
      <div class="hm-main">
        <section class="hm-card">
          <div class="hm-head"><h2>Rooms at your college</h2></div>
          ${d.rooms.length ? `<div class="rm-list">${d.rooms.map(r => `
            <div class="rm-card">
              <div class="rm-card-top"><strong>${escapeHtml(r.name)}</strong><span class="pp-chip${r.phase === 'focus' ? '' : ' is-quiet'}">${phaseLabel(r)}</span></div>
              <small>${escapeHtml(r.subject || 'Any subject')} · ${r.focus_minutes}/${r.break_minutes} min${r.public ? '' : ' · private'}${r.mine ? ' · yours' : ''}</small>
              <div class="rm-faces">${r.members.slice(0, 6).map(faceHtml).join('')}${r.members.length > 6 ? `<span class="hm-note" style="margin-left:6px">+${r.members.length - 6}</span>` : ''}${r.members.length ? '' : '<small>Nobody in yet</small>'}</div>
              <button class="hm-btn" type="button" data-rm="enter" data-id="${r.id}">Join</button>
            </div>`).join('')}</div>`
          : `<div class="st-empty">${rmIcon('groups')}<strong>No rooms open yet</strong><p>Open one for your subject and share its code with your friends. Classmates can find it here.</p>
              <div class="st-empty-actions"><button class="hm-btn" type="button" data-rm="create">Open a room</button></div></div>`}
        </section>
      </div>
      <aside class="hm-side">
        <section class="hm-card"><div class="hm-head"><h2>Got a code?</h2></div>
          <form class="rm-join" data-rm-form="code"><input name="code" maxlength="8" placeholder="AB12CD" aria-label="Room code" autocomplete="off"/><button class="hm-btn" type="submit">Join</button></form></section>
        <section class="hm-card"><div class="hm-head"><h2>How it works</h2></div>
          <p class="hm-note">The person who opens a room runs its timer. Everyone sees the same countdown. A focus round counts for your XP and streak like the solo timer, and you can send a reaction or a friendly nudge.</p></section>
      </aside>
    </div>`;
}

// ---------- inside a room ----------
async function joinRoom(id, quiet) {
  try {
    const state = await api(`/api/rooms/${id}/join`, { method: 'POST', body: { subject: mySubject } });
    setRoom(state);
    clearInterval(roomPing);
    roomPing = setInterval(() => {
      if (!room) return;
      api(`/api/rooms/${room.id}/ping`, { method: 'POST', body: { subject: mySubject } }).catch((err) => { if (err.status === 409) joinRoom(room.id, true); });
    }, 30000);
  } catch (err) {
    if (quiet) return;
    el('roomsView').innerHTML = `<a class="pp-back" href="rooms.html" data-rm="back">${rmIcon('arrow_back')}Study rooms</a><div class="hm-card hm-problem">${rmIcon('door_front')}<p>${escapeHtml(err.message)}</p></div>`;
  }
}

function leaveRoom(silent) {
  if (!room) return;
  const id = room.id;
  tellRoomStudying(false);
  room = null;
  focusSeen = null;
  clearInterval(roomTick); clearInterval(roomPing);
  api(`/api/rooms/${id}/leave`, { method: 'POST' }).catch(() => {});
  if (!silent) goRooms(0);
}

function setRoom(state) {
  const before = room;
  room = state;
  roomSeenAt = Date.now();
  trackFocus(before, state);
  renderRoom();
  clearInterval(roomTick);
  roomTick = setInterval(paintClock, 500);
}

// When a focus round I was in ends, its minutes count as a study session (XP, streak, My Study hours)
function trackFocus(before, now) {
  if (now.phase === 'focus') {
    if (!focusSeen || focusSeen.round !== now.round) {
      const elapsed = now.focus_minutes * 60 - now.seconds_left;
      focusSeen = { round: now.round, startedAt: Date.now() - Math.max(0, elapsed) * 1000, joinedAt: Date.now() };
      tellRoomStudying(true);
    }
  } else if (focusSeen && before && before.phase === 'focus' && now.round === focusSeen.round) {
    const minutes = Math.floor((Date.now() - Math.max(focusSeen.startedAt, focusSeen.joinedAt)) / 60000);
    focusSeen = null;
    tellRoomStudying(false);
    if (now.phase === 'break' && minutes >= 1) {
      api('/api/study/sessions', { method: 'POST', body: { minutes: Math.min(180, minutes) } })
        .then(r => { showXpPop(r.xp); showToast(`${rmPlural(minutes, 'minute', 'minutes')} of focus logged. Take a break.`); })
        .catch(() => {});
    }
  }
}

function tellRoomStudying(on) {
  if (on && room) api('/api/study/now', { method: 'POST', body: { minutes: Math.ceil(room.seconds_left / 60) || room.focus_minutes, subject: mySubject } }).catch(() => {});
  else api('/api/study/now', { method: 'DELETE' }).catch(() => {});
}

function secondsLeft() {
  if (!room || !['focus', 'break'].includes(room.phase)) return room ? (room.phase === 'paused' ? Math.round(room.paused_left) : room.focus_minutes * 60) : 0;
  return Math.max(0, room.seconds_left - Math.floor((Date.now() - roomSeenAt) / 1000));
}

function paintClock() {
  const clock = el('rmClock');
  if (!clock || !room) return;
  const s = secondsLeft();
  clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const total = (room.phase === 'break' ? room.break_minutes : room.focus_minutes) * 60;
  const bar = el('rmBar');
  if (bar) bar.style.width = `${room.phase === 'idle' ? 0 : Math.round((1 - s / Math.max(1, total)) * 100)}%`;
  document.title = room.phase === 'focus' || room.phase === 'break' ? `${clock.textContent} ${room.phase === 'focus' ? 'Focus' : 'Break'} · ${room.name}` : `${room.name} · Connect2Minds`;
}

function renderRoom() {
  const r = room;
  const iRun = r.mine || !r.members.some(m => m.id === r.owner_id);
  const controls = !iRun ? `<p class="hm-note">${escapeHtml((r.members.find(m => m.id === r.owner_id) || {}).name || 'The room owner')} runs the timer.</p>`
    : r.phase === 'focus' || r.phase === 'break'
      ? `<button class="hm-btn is-quiet" type="button" data-rm="timer" data-action="pause">${rmIcon('pause')}Pause</button><button class="hm-btn is-quiet" type="button" data-rm="timer" data-action="skip">${r.phase === 'focus' ? 'End focus now' : 'Skip break'}</button><button class="hm-btn is-quiet" type="button" data-rm="timer" data-action="stop">Stop</button>`
      : `<button class="hm-btn" type="button" data-rm="timer" data-action="start">${rmIcon('play_arrow')}${r.phase === 'paused' ? 'Resume' : `Start ${r.focus_minutes} min focus`}</button>`;
  el('roomsView').innerHTML = `
    <a class="pp-back" href="rooms.html" data-rm="leave">${rmIcon('arrow_back')}Leave the room</a>
    <div class="pp-head"><div><h1 class="hm-title">${escapeHtml(r.name)}</h1>
      <div class="pp-head-meta"><span class="pp-chip is-quiet">${escapeHtml(r.subject || 'Any subject')}</span>${r.code ? `<span class="rm-code" title="Share this code">${escapeHtml(r.code)}</span><button class="pp-small" type="button" data-rm="copy">${rmIcon('content_copy')}Copy invite</button>` : ''}</div></div>
      ${r.mine ? `<div class="pp-head-actions"><button class="pp-small st-danger" type="button" data-rm="close">Close the room</button></div>` : ''}</div>
    <div class="rm-room">
      <section class="hm-card rm-timer${r.phase === 'break' ? ' is-break' : ''}">
        <div class="rm-phase">${phaseLabel(r)}${r.round ? ` · round ${r.round}` : ''}</div>
        <div class="rm-clock" id="rmClock" role="timer" aria-live="off">--:--</div>
        <div class="hm-bar" aria-hidden="true"><i id="rmBar" style="width:0"></i></div>
        <div class="rm-controls">${controls}</div>
        <div class="rm-reactions" role="group" aria-label="Send a reaction">${(roomsData ? roomsData.reactions : ['👍', '🔥', '💪', '☕', '🎉', '😴']).map(e => `<button type="button" data-rm="react" data-emoji="${e}" aria-label="Send ${e}">${e}</button>`).join('')}</div>
      </section>
      <aside class="hm-card">
        <div class="hm-head"><h2>${rmPlural(r.members.length, 'person', 'people')} here</h2></div>
        <label class="fs-field" style="display:block;margin-bottom:10px"><span class="hm-note">What are you studying?</span>
          <input data-rm-change="subject" maxlength="80" value="${escapeHtml(mySubject)}" placeholder="DBMS unit 3" style="width:100%;padding:8px 10px;border-radius:9px;border:1px solid rgba(199,196,216,0.9);font-size:14px;margin-top:4px"/></label>
        <div class="rm-members">${r.members.map(m => `
          <div class="rm-member">${faceHtml(m)}<div><strong>${escapeHtml(m.name)}${m.id === currentUserId ? ' (you)' : ''}${m.id === r.owner_id ? ' · host' : ''}</strong><small>${escapeHtml(m.subject || 'Studying')}</small></div>
            ${m.id !== currentUserId ? `<button class="pp-small" type="button" data-rm="nudge" data-id="${m.id}" title="Send a friendly nudge">👋</button>` : ''}</div>`).join('')}</div>
      </aside>
    </div>`;
  paintClock();
}

function floatEmoji(emoji) {
  const box = el('roomFloats');
  if (!box) return;
  const n = document.createElement('span');
  n.className = 'rm-float';
  n.textContent = emoji;
  n.style.left = `${10 + Math.random() * 80}%`;
  box.appendChild(n);
  setTimeout(() => n.remove(), 2700);
}

function onRoomEvent(data) {
  if (!room || data.room_id !== room.id) return;
  if (data.type === 'room_state' && data.room) setRoom(data.room);
  else if (data.type === 'room_reaction') floatEmoji(data.emoji);
  else if (data.type === 'room_nudge') { showToast(`👋 ${data.from_name} says: back to work!`); try { if (navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(120); } catch (e) { /* optional */ } }
  else if (data.type === 'room_closed') { room = null; clearInterval(roomTick); clearInterval(roomPing); showToast('The host closed this room.'); goRooms(0); }
}

function onRoomsClick(e) {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  const act = b.dataset.rm;
  if (act === 'enter') goRooms(Number(b.dataset.id));
  else if (act === 'back') { e.preventDefault(); goRooms(0); }
  else if (act === 'leave') { e.preventDefault(); leaveRoom(false); }
  else if (act === 'create') openSheet({
    title: 'Open a study room',
    fields: [
      { name: 'name', label: 'Room name', required: true, maxlength: 60, placeholder: 'DBMS before the mid-sem' },
      { name: 'subject', label: 'Subject', maxlength: 80, placeholder: 'Optional' },
      { name: 'focus_minutes', label: 'Focus (minutes)', type: 'number', value: 25, min: 10, max: 120, half: true },
      { name: 'break_minutes', label: 'Break (minutes)', type: 'number', value: 5, min: 1, max: 30, half: true },
      { name: 'public', label: 'Show it to everyone at my college (otherwise only people with the code can join)', type: 'checkbox', value: true }
    ],
    submitLabel: 'Open room',
    onSubmit: async (values) => { const created = await api('/api/rooms', { method: 'POST', body: values }); goRooms(created.id); }
  });
  else if (act === 'timer') api(`/api/rooms/${room.id}/timer`, { method: 'POST', body: { action: b.dataset.action } }).then(setRoom, err => showToast(err.message));
  else if (act === 'react') { floatEmoji(b.dataset.emoji); api(`/api/rooms/${room.id}/react`, { method: 'POST', body: { emoji: b.dataset.emoji } }).catch(err => showToast(err.message)); }
  else if (act === 'nudge') api(`/api/rooms/${room.id}/nudge`, { method: 'POST', body: { user_id: Number(b.dataset.id) } }).then(() => showToast('Nudge sent'), err => showToast(err.message));
  else if (act === 'copy') {
    const text = `Study with me on Connect2Minds: open Study rooms and join with code ${room.code}`;
    navigator.clipboard.writeText(text).then(() => showToast('Invite copied'), () => showToast(`The code is ${room.code}`));
  } else if (act === 'close') {
    if (!window.confirm('Close this room for everyone?')) return;
    api(`/api/rooms/${room.id}`, { method: 'DELETE' }).then(() => { room = null; clearInterval(roomTick); clearInterval(roomPing); goRooms(0); }, err => showToast(err.message));
  }
}

function onRoomsChange(e) {
  const input = e.target.closest('[data-rm-change="subject"]');
  if (!input || !room) return;
  mySubject = input.value.trim().slice(0, 80);
  try { localStorage.setItem('c2m:roomSubject', mySubject); } catch (err) { /* convenience only */ }
  api(`/api/rooms/${room.id}/ping`, { method: 'POST', body: { subject: mySubject } }).catch(() => {});
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-rm-form="code"]');
  if (!form) return;
  e.preventDefault();
  const code = form.elements.code.value.trim();
  if (!code) return;
  try {
    const state = await api('/api/rooms/join-code', { method: 'POST', body: { code } });
    history.pushState({}, '', `rooms.html?room=${state.id}`);
    joinRoom(state.id);
  } catch (err) { showToast(err.message); }
});

initRooms();
