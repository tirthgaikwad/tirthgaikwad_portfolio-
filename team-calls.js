// ==========================================
// TEAM-CALLS.JS — Voice rooms and group calls for the Teams page (WebRTC mesh)
// Everyone in a room connects directly to everyone else, so audio and video never pass through the
// server. That keeps it simple and free, and is comfortable for about six people; beyond that each
// browser is sending too many copies of its own stream.
// Loaded after team.js and uses its state, socket and helpers.
// ==========================================

const VOICE_RTC_CONFIG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

let voiceRooms = {};          // room -> [{ user_id, name, profile_pic, muted, video, sharing }], as reported by the server
let voice = null;             // the room this page is in: { teamId, channelId, room, localStream, peers, muted, cameraTrack, screenStream, ... }
let speakingTimer = null;
let voiceAudioContext = null;

function roomKey(channel) {
  return `${channel.channel_type === 'voice' ? 'voice' : 'call'}:${channel.id}`;
}

function roomParticipants(room) {
  return voiceRooms[room] || [];
}

function channelOfRoom(room) {
  const ws = workspace();
  const channelId = parseInt((room || '').split(':')[1]);
  return ws ? ws.channels.find(c => c.id === channelId) || null : null;
}

// ==========================================
// 1. WHAT THE SERVER TELLS US
// ==========================================
function applyVoiceState(state) {
  voiceRooms = state || {};
  renderVoiceChannels();
  renderCallBanner();
  if (voice && voice.room) renderCallTiles();
}

function handleVoiceEvent(teamId, data) {
  switch (data.type) {
    case 'voice_state':
      if (teamId === activeTeamId) applyVoiceState(data.voice);
      return;

    case 'voice_joined':
      if (!voice || voice.room) {
        // We gave up waiting, or this is a stale answer: do not stay in a room we are not showing
        if (!voice) teamSocketSend({ type: 'voice_leave' });
        return;
      }
      voice.room = data.room;
      playTone(660, 0.15, 0.06);
      // The newcomer calls everyone who is already there
      data.peers.forEach(peerId => callPeer(peerId));
      updateVoiceUi();
      if (voice.wantVideo) toggleVoiceCamera();
      if (voice.openView) openCallView();
      return;

    case 'voice_left':
      if (voice && voice.room === data.room && data.user_id !== currentUserId) {
        closePeer(data.user_id);
        playTone(440, 0.15, 0.05);
      }
      return;

    case 'voice_replaced':
      if (voice && voice.room === data.room) {
        teardownVoice();
        showToast('You joined this room from another tab.');
      }
      return;

    case 'rtc':
      if (voice && voice.room === data.room) handleRtc(data.from, data.data || {});
      return;
  }
}

// The workspace socket (re)connected
function onTeamSocketOpen(teamId) {
  if (!voice) return;
  if (voice.teamId !== teamId) {
    teardownVoice();
    showToast('You left the voice room when you switched workspace.');
  } else if (!voice.room) {
    // We were dropped from the room when the connection was lost: go back in
    teamSocketSend({ type: 'voice_join', channel_id: voice.channelId });
  }
}

// The workspace socket dropped: the server has taken us out of the room, so the others have hung up on us
function onTeamSocketLost() {
  if (!voice) return;
  Object.keys(voice.peers).forEach(peerId => closePeer(parseInt(peerId)));
  voice.room = null;
  updateVoiceUi();
}

function leaveVoiceIfIn(teamId) {
  if (voice && voice.teamId === teamId) teardownVoice();
}

// ==========================================
// 2. JOINING AND LEAVING
// ==========================================
function joinVoiceChannel(channelId) {
  if (voice && voice.channelId === channelId) return openCallView();
  joinRoom(channelId, { video: false, openView: false });
}

function startChannelCall(kind) {
  if (!activeChannelId) return;
  if (voice && voice.channelId === activeChannelId) {
    openCallView();
    if (kind === 'video' && !voice.cameraTrack) toggleVoiceCamera();
    return;
  }
  joinRoom(activeChannelId, { video: kind === 'video', openView: true });
}

function joinChannelCall() {
  if (activeChannelId) joinRoom(activeChannelId, { video: false, openView: true });
}

async function joinRoom(channelId, options) {
  if (!window.RTCPeerConnection || !navigator.mediaDevices) {
    return window.showSystemModal('Voice', 'This browser does not support voice and video calls.', 'alert');
  }
  if (!teamSocket || teamSocket.readyState !== WebSocket.OPEN) return showToast('Not connected right now. Try again in a moment.');
  if (voice) leaveVoice();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const message = err && err.name === 'NotFoundError' ? 'No microphone was found on this device.' : 'Could not access your microphone. Please allow access in your browser and try again.';
    return window.showSystemModal('Microphone Access', message, 'alert');
  }
  if (voice) return stream.getTracks().forEach(t => t.stop());   // another join finished first

  voice = {
    teamId: activeTeamId, channelId, room: null, localStream: stream, peers: {},
    muted: false, cameraTrack: null, screenStream: null,
    wantVideo: !!options.video, openView: !!options.openView
  };
  updateVoiceUi();
  if (!teamSocketSend({ type: 'voice_join', channel_id: channelId })) {
    teardownVoice();
    showToast('Not connected right now. Try again in a moment.');
  }
}

function leaveVoice() {
  if (!voice) return;
  teamSocketSend({ type: 'voice_leave' });
  teardownVoice();
}

function teardownVoice() {
  if (!voice) return;
  const ended = voice;
  voice = null;
  Object.values(ended.peers).forEach(peer => { try { peer.pc.close(); } catch (e) { /* already closed */ } });
  ended.localStream.getTracks().forEach(t => t.stop());
  if (ended.cameraTrack) ended.cameraTrack.stop();
  if (ended.screenStream) ended.screenStream.getTracks().forEach(t => t.stop());
  clearInterval(speakingTimer);
  speakingTimer = null;
  el('video-grid').innerHTML = '';
  closeCallView();
  updateVoiceUi();
}

// ==========================================
// 3. PEER CONNECTIONS
// ==========================================
function outgoingVideoTrack() {
  if (!voice) return null;
  if (voice.screenStream) return voice.screenStream.getVideoTracks()[0] || null;
  return voice.cameraTrack;
}

function createPeer(peerId) {
  const pc = new RTCPeerConnection(VOICE_RTC_CONFIG);
  const peer = { pc, stream: new MediaStream(), videoSender: null, remoteSet: false, pending: [], analyser: null };
  voice.peers[peerId] = peer;

  voice.localStream.getAudioTracks().forEach(track => pc.addTrack(track, voice.localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) teamSocketSend({ type: 'rtc', to: peerId, data: { candidate: e.candidate } });
  };
  pc.ontrack = (e) => {
    if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
    renderCallTiles();
  };
  pc.onconnectionstatechange = () => {
    if (!voice || voice.peers[peerId] !== peer) return;
    if (pc.connectionState === 'failed') {
      const person = roomParticipants(voice.room).find(p => p.user_id === peerId);
      showToast(`Could not connect to ${person ? person.name : 'a participant'}. Your networks may not allow a direct connection.`);
    }
    renderCallTiles();
  };
  return peer;
}

// A video slot is always negotiated, even with the camera off, so turning the camera or screen
// share on later is just a matter of putting a track into it: no second round of set-up.
async function callPeer(peerId) {
  const peer = createPeer(peerId);
  const transceiver = peer.pc.addTransceiver('video', { direction: 'sendrecv' });
  peer.videoSender = transceiver.sender;
  const video = outgoingVideoTrack();
  if (video) await transceiver.sender.replaceTrack(video);
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    teamSocketSend({ type: 'rtc', to: peerId, data: { sdp: peer.pc.localDescription } });
  } catch (err) {
    closePeer(peerId);
  }
}

async function flushCandidates(peer) {
  peer.remoteSet = true;
  const queued = peer.pending;
  peer.pending = [];
  for (const candidate of queued) {
    try { await peer.pc.addIceCandidate(candidate); } catch (e) { /* no longer applies */ }
  }
}

async function handleRtc(fromId, data) {
  if (!voice) return;
  try {
    if (data.sdp && data.sdp.type === 'offer') {
      if (voice.peers[fromId]) closePeer(fromId);   // they reconnected
      const peer = createPeer(fromId);
      await peer.pc.setRemoteDescription(data.sdp);
      const transceiver = peer.pc.getTransceivers().find(t => t.receiver.track && t.receiver.track.kind === 'video');
      if (transceiver) {
        transceiver.direction = 'sendrecv';
        peer.videoSender = transceiver.sender;
        const video = outgoingVideoTrack();
        if (video) await transceiver.sender.replaceTrack(video);
      }
      await flushCandidates(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      teamSocketSend({ type: 'rtc', to: fromId, data: { sdp: peer.pc.localDescription } });
      renderCallTiles();
    } else if (data.sdp && data.sdp.type === 'answer') {
      const peer = voice.peers[fromId];
      if (peer && !peer.remoteSet) {
        await peer.pc.setRemoteDescription(data.sdp);
        await flushCandidates(peer);
      }
    } else if (data.candidate) {
      const peer = voice.peers[fromId];
      if (!peer) return;
      if (peer.remoteSet) {
        try { await peer.pc.addIceCandidate(data.candidate); } catch (e) { /* no longer applies */ }
      } else {
        peer.pending.push(data.candidate);
      }
    }
  } catch (err) {
    console.warn('Voice set-up with', fromId, 'failed:', err);
  }
}

function closePeer(peerId) {
  if (!voice || !voice.peers[peerId]) return;
  try { voice.peers[peerId].pc.close(); } catch (e) { /* already closed */ }
  delete voice.peers[peerId];
  renderCallTiles();
}

async function sendVideoToEveryone() {
  const track = outgoingVideoTrack();
  await Promise.all(Object.values(voice.peers).map(peer => peer.videoSender ? peer.videoSender.replaceTrack(track).catch(() => {}) : null));
}

// ==========================================
// 4. CONTROLS
// ==========================================
function toggleVoiceMute() {
  if (!voice) return;
  voice.muted = !voice.muted;
  voice.localStream.getAudioTracks().forEach(t => { t.enabled = !voice.muted; });
  teamSocketSend({ type: 'voice_update', muted: voice.muted });
  updateVoiceUi();
}

async function toggleVoiceCamera() {
  if (!voice) return;
  if (voice.cameraTrack) {
    voice.cameraTrack.stop();
    voice.cameraTrack = null;
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } } });
      if (!voice) return stream.getTracks().forEach(t => t.stop());
      voice.cameraTrack = stream.getVideoTracks()[0];
    } catch (err) {
      const message = err && err.name === 'NotFoundError' ? 'No camera was found on this device.' : 'Could not access your camera. Please allow access in your browser and try again.';
      return window.showSystemModal('Camera Access', message, 'alert');
    }
  }
  await sendVideoToEveryone();
  teamSocketSend({ type: 'voice_update', video: !!voice.cameraTrack });
  updateVoiceUi();
}

async function toggleVoiceScreenShare() {
  if (!voice) return;
  if (voice.screenStream) return stopVoiceScreenShare();
  if (!navigator.mediaDevices.getDisplayMedia) return showToast('This browser cannot share the screen.');

  let screenStream;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch (err) {
    return;   // the screen picker was closed
  }
  if (!voice) return screenStream.getTracks().forEach(t => t.stop());
  voice.screenStream = screenStream;
  // The browser's own "Stop sharing" button ends the track
  screenStream.getVideoTracks()[0].onended = () => stopVoiceScreenShare();
  await sendVideoToEveryone();
  teamSocketSend({ type: 'voice_update', sharing: true });
  updateVoiceUi();
}

async function stopVoiceScreenShare() {
  if (!voice || !voice.screenStream) return;
  voice.screenStream.getTracks().forEach(t => t.stop());
  voice.screenStream = null;
  await sendVideoToEveryone();   // back to the camera, or to nothing
  teamSocketSend({ type: 'voice_update', sharing: false });
  updateVoiceUi();
}

function openCallView() {
  if (!voice) return;
  const channel = (workspaces[voice.teamId] || { channels: [] }).channels.find(c => c.id === voice.channelId);
  el('call-title').textContent = !channel ? 'Call' : (channel.channel_type === 'voice' ? `🔊 ${channel.name}` : `📞 Call in #${channel.name}`);
  el('call-overlay').classList.add('active');
  renderCallTiles();
}

function closeCallView() {
  el('call-overlay').classList.remove('active');
}

// ==========================================
// 5. DRAWING
// ==========================================
function setControl(buttonId, icon, stateClass, title) {
  const button = el(buttonId);
  button.querySelector('span').textContent = icon;
  button.classList.remove('is-off', 'is-on');
  if (stateClass) button.classList.add(stateClass);
  button.title = title;
}

function updateVoiceUi() {
  const panel = el('voice-connected-panel');
  if (!voice) {
    hide(panel);
  } else {
    const channel = (workspaces[voice.teamId] || { channels: [] }).channels.find(c => c.id === voice.channelId);
    show(panel);
    el('voice-status-text').textContent = !voice.room ? 'Connecting...' : (voice.muted ? 'Muted' : 'Voice Connected');
    el('voice-channel-name-display').textContent = channel ? `${channel.channel_type === 'voice' ? '' : 'Call in '}#${channel.name}` : '';
    el('mic-toggle').innerHTML = voice.muted
      ? '<span class="material-symbols-outlined text-[16px] text-rose-500">mic_off</span>'
      : '<span class="material-symbols-outlined text-[16px]">mic</span>';
    el('mic-toggle').title = voice.muted ? 'Unmute microphone' : 'Mute microphone';
    setControl('call-mic-btn', voice.muted ? 'mic_off' : 'mic', voice.muted ? 'is-off' : '', voice.muted ? 'Unmute microphone' : 'Mute microphone');
    setControl('call-video-btn', voice.cameraTrack ? 'videocam' : 'videocam_off', voice.cameraTrack ? '' : 'is-off', voice.cameraTrack ? 'Turn camera off' : 'Turn camera on');
    setControl('call-screen-btn', voice.screenStream ? 'stop_screen_share' : 'screen_share', voice.screenStream ? 'is-on' : '', voice.screenStream ? 'Stop sharing' : 'Share screen');
  }
  renderVoiceChannels();
  renderCallBanner();
  if (voice) renderCallTiles();
}

function renderVoiceChannels() {
  const ws = workspace();
  const list = el('voice-channels-list');
  if (!ws || !list) return;

  let live = 0;
  list.innerHTML = ws.channels.filter(c => c.channel_type === 'voice').map(ch => {
    const people = roomParticipants(`voice:${ch.id}`);
    live += people.length;
    const inRoom = !!voice && voice.channelId === ch.id;
    return `
      <div>
        <div data-channel-id="${ch.id}" onclick="joinVoiceChannel(${ch.id})" class="group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-xs font-medium ${inRoom ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'} transition-colors" title="${inRoom ? 'Open call view' : 'Join voice room'}">
          <span class="material-symbols-outlined text-[16px] ${people.length ? 'text-emerald-600' : 'text-slate-400'}">volume_up</span>
          <span class="truncate">${escapeHtml(ch.name)}</span>
          ${people.length ? `<span class="ml-auto px-1.5 py-0.5 text-[9px] bg-emerald-200/80 text-emerald-800 rounded font-mono font-bold group-hover:hidden">${people.length} LIVE</span>` : ''}
          ${channelAdminButtons(ch)}
        </div>
        ${people.map(p => `
          <div class="flex items-center gap-2 pl-8 pr-2 py-1 text-[11px] text-slate-600" data-voice-user="${p.user_id}">
            ${personAvatar(p.user_id, p.name, p.profile_pic, 'w-5 h-5', 'text-[8px]')}
            <span class="truncate">${escapeHtml(p.name)}${p.user_id === currentUserId ? ' (You)' : ''}</span>
            <span class="ml-auto flex items-center gap-0.5 text-slate-400">
              ${p.sharing ? '<span class="material-symbols-outlined text-[13px]" title="Sharing screen">screen_share</span>' : ''}
              ${p.video ? '<span class="material-symbols-outlined text-[13px]" title="Camera on">videocam</span>' : ''}
              ${p.muted ? '<span class="material-symbols-outlined text-[13px] text-rose-400" title="Muted">mic_off</span>' : ''}
            </span>
          </div>`).join('')}
      </div>`;
  }).join('') || '<p class="px-2.5 text-[11px] text-slate-400">No voice rooms yet.</p>';

  el('voice-live-count').textContent = live ? `${live} live` : '';
}

// A call is running in the text channel on screen and this person is not in it
function renderCallBanner() {
  const banner = el('call-banner');
  const people = activeChannelId ? roomParticipants(`call:${activeChannelId}`) : [];
  const inIt = !!voice && voice.channelId === activeChannelId;
  if (people.length === 0 || inIt) return hide(banner, 'flex');
  const names = people.map(p => p.name);
  el('call-banner-text').textContent = `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} ${names.length === 1 ? 'is' : 'are'} in a call`;
  show(banner, 'flex');
}

function tileHtml(person) {
  return `
    <div class="call-tile" data-user-id="${person.user_id}">
      <div class="flex flex-col items-center gap-2" data-avatar>
        ${personAvatar(person.user_id, person.name, person.profile_pic, 'w-20 h-20', 'text-2xl')}
      </div>
      <video autoplay playsinline style="display:none;"></video>
      <div class="absolute bottom-2 left-2 px-2 py-1 bg-black/50 backdrop-blur-sm rounded-lg text-white text-xs font-semibold flex items-center gap-1.5">
        <span data-name></span>
        <span class="material-symbols-outlined text-[14px] text-rose-400" data-muted style="display:none;">mic_off</span>
      </div>
      <div class="absolute top-2 right-2 px-2 py-0.5 bg-black/50 rounded text-[10px] text-slate-200" data-status style="display:none;"></div>
    </div>`;
}

// Keeps one tile per person in the room. Tiles are updated in place so video and audio never restart.
function renderCallTiles() {
  if (!voice) return;
  const grid = el('video-grid');
  const me = { user_id: currentUserId, name: myName(), profile_pic: myPicture(), muted: voice.muted, video: !!voice.cameraTrack, sharing: !!voice.screenStream };
  const others = roomParticipants(voice.room).filter(p => p.user_id !== currentUserId);
  const people = [me].concat(others);

  grid.querySelectorAll('.call-tile').forEach(tile => {
    if (!people.some(p => String(p.user_id) === tile.dataset.userId)) tile.remove();
  });
  grid.style.gridTemplateColumns = `repeat(${people.length <= 1 ? 1 : people.length <= 4 ? 2 : 3}, minmax(0, 1fr))`;
  grid.style.maxWidth = people.length <= 1 ? '720px' : '';

  people.forEach(person => {
    let tile = grid.querySelector(`.call-tile[data-user-id="${person.user_id}"]`);
    if (!tile) {
      grid.insertAdjacentHTML('beforeend', tileHtml(person));
      tile = grid.lastElementChild;
    }
    const isMe = person.user_id === currentUserId;
    const video = tile.querySelector('video');
    const peer = isMe ? null : voice.peers[person.user_id];

    if (isMe) {
      const track = outgoingVideoTrack();
      video.muted = true;
      if (track && (!video.srcObject || video.srcObject.getVideoTracks()[0] !== track)) video.srcObject = new MediaStream([track]);
      if (!track) video.srcObject = null;
    } else if (peer && video.srcObject !== peer.stream) {
      video.srcObject = peer.stream;
      video.play().catch(() => { /* starts once the browser allows it */ });
    }

    const showVideo = !!(person.video || person.sharing) && (isMe ? !!outgoingVideoTrack() : !!peer);
    video.style.display = showVideo ? '' : 'none';
    tile.querySelector('[data-avatar]').style.display = showVideo ? 'none' : '';
    tile.classList.toggle('is-screen', !!person.sharing);
    tile.querySelector('[data-name]').textContent = isMe ? `${person.name} (You)` : person.name;
    tile.querySelector('[data-muted]').style.display = person.muted ? '' : 'none';

    const status = tile.querySelector('[data-status]');
    const state = isMe ? 'connected' : (peer ? peer.pc.connectionState : 'new');
    status.textContent = state === 'failed' ? 'Could not connect' : 'Connecting...';
    status.style.display = isMe || state === 'connected' ? 'none' : '';
  });

  startSpeakingMeter();
}

// Highlights whoever is talking
function startSpeakingMeter() {
  if (speakingTimer || !voice) return;
  try {
    voiceAudioContext = voiceAudioContext || new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    return;
  }
  const levelOf = (holder, stream) => {
    if (!stream.getAudioTracks().length) return 0;
    if (!holder.analyser) {
      holder.analyser = voiceAudioContext.createAnalyser();
      holder.analyser.fftSize = 256;
      voiceAudioContext.createMediaStreamSource(stream).connect(holder.analyser);
    }
    const data = new Uint8Array(holder.analyser.frequencyBinCount);
    holder.analyser.getByteFrequencyData(data);
    return data.reduce((sum, v) => sum + v, 0) / data.length;
  };
  speakingTimer = setInterval(() => {
    if (!voice) return;
    const mark = (userId, speaking) => {
      const tile = document.querySelector(`#video-grid .call-tile[data-user-id="${userId}"]`);
      if (tile) tile.classList.toggle('is-speaking', speaking);
      const row = document.querySelector(`#voice-channels-list [data-voice-user="${userId}"]`);
      if (row) row.classList.toggle('text-emerald-700', speaking);
    };
    try {
      mark(currentUserId, !voice.muted && levelOf(voice, voice.localStream) > 12);
      Object.entries(voice.peers).forEach(([peerId, peer]) => mark(peerId, levelOf(peer, peer.stream) > 12));
    } catch (e) { /* a stream ended between ticks */ }
  }, 250);
}
