// ==========================================
// INBOX-CALLS.JS — One-to-one voice and video calls (WebRTC)
// Audio and video travel directly between the two browsers. The chat WebSocket only
// carries the set-up messages (offer, answer, network candidates, hang-up).
// Loaded after inbox.js and uses its state and helpers.
// ==========================================

// Public STUN servers let two browsers find a direct route. There is no relay (TURN) server,
// so a call can fail to connect between two very restrictive networks.
const RTC_CONFIG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const RING_TIMEOUT_MS = 30000;

let call = null;            // the call in progress or being placed
let incomingCall = null;    // an offer waiting for accept / decline
let toneTimer = null;

function isCallBusy() {
  return call !== null || incomingCall !== null;
}

// ===== TONES =====
function startTone(kind) {
  stopTone();
  const beep = kind === 'ring'
    ? () => { playTone(660, 0.35, 0.1); setTimeout(() => playTone(880, 0.35, 0.1), 400); }
    : () => playTone(440, 0.9, 0.04);
  beep();
  toneTimer = setInterval(beep, kind === 'ring' ? 2000 : 3000);
}

function stopTone() {
  clearInterval(toneTimer);
  toneTimer = null;
}

// ===== MEDIA =====
async function getLocalMedia(media) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: media === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
    });
  } catch (err) {
    const what = media === 'video' ? 'camera and microphone' : 'microphone';
    const message = err && err.name === 'NotFoundError'
      ? `No ${what} was found on this device.`
      : `Could not access your ${what}. Please allow access in your browser and try again.`;
    throw new Error(message);
  }
}

function stopStream(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

// ===== CALL OBJECT =====
function createCall({ id, peerId, media, role, stream }) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const newCall = {
    id, peerId, media, role, pc,
    localStream: stream,
    cameraTrack: stream.getVideoTracks()[0] || null,
    screenStream: null,
    state: 'ringing',
    remoteDescriptionSet: false,
    pendingCandidates: [],
    startedAt: null,
    timerInterval: null,
    ringTimer: null
  };

  stream.getTracks().forEach(track => pc.addTrack(track, stream));

  pc.onicecandidate = (e) => {
    if (e.candidate) wsSend({ type: 'call_ice', to: peerId, call_id: id, candidate: e.candidate });
  };
  pc.ontrack = (e) => {
    const remote = el('call-remote-video');
    if (remote.srcObject !== e.streams[0]) {
      remote.srcObject = e.streams[0];
      remote.play().catch(() => { /* starts once the browser allows it */ });
    }
    updateCallVideoLayout();
  };
  pc.onconnectionstatechange = () => {
    if (!call || call.pc !== pc) return;
    if (pc.connectionState === 'connected') onCallConnected();
    else if (pc.connectionState === 'disconnected') setCallStatus('Reconnecting...');
    else if (pc.connectionState === 'failed') {
      endCall({ notifyPeer: true, reason: 'The call could not connect. Your networks may not allow a direct connection.' });
    }
  };
  return newCall;
}

async function addRemoteCandidate(candidate) {
  try {
    await call.pc.addIceCandidate(candidate);
  } catch (e) { /* a candidate that no longer applies is safe to ignore */ }
}

async function applyRemoteDescription(sdp, earlyCandidates) {
  await call.pc.setRemoteDescription(sdp);
  call.remoteDescriptionSet = true;
  const queued = (earlyCandidates || []).concat(call.pendingCandidates);
  call.pendingCandidates = [];
  for (const candidate of queued) await addRemoteCandidate(candidate);
}

function onCallConnected() {
  if (!call) return;
  if (call.state === 'connected') return setCallStatus('Connected');
  call.state = 'connected';
  stopTone();
  clearTimeout(call.ringTimer);
  call.startedAt = Date.now();
  setCallStatus('Connected');
  updateCallVideoLayout();
  call.timerInterval = setInterval(() => {
    if (call) { el('call-timer').textContent = formatDuration((Date.now() - call.startedAt) / 1000).padStart(5, '0'); if (call.minimized || CallDock.mode !== 'call') CallDock.refresh(); }
  }, 1000);
}

// ===== CALL WINDOW =====
function setCallStatus(text) {
  el('call-status').textContent = text;
  CallDock.refresh();
}

function setCallButton(buttonId, icon, isOff, title) {
  const button = el(buttonId);
  button.querySelector('span').textContent = icon;
  button.classList.toggle('is-off', isOff);
  button.title = title;
}

function showCallWindow() {
  const contact = contacts[call.peerId] || { name: 'User', profile_pic: '' };
  el('call-name').textContent = contact.name;
  el('call-avatar').innerHTML = contact.profile_pic
    ? `<img src="${escapeHtml(contact.profile_pic)}" alt="${escapeHtml(contact.name)}"/>`
    : `<span class="material-symbols-outlined text-on-primary text-[32px]">person</span>`;
  el('call-timer').textContent = '00:00';

  const isVideo = call.media === 'video';
  el('call-camera-btn').style.display = isVideo ? '' : 'none';
  el('call-screen-btn').style.display = isVideo && navigator.mediaDevices.getDisplayMedia ? '' : 'none';
  setCallButton('call-mute-btn', 'mic', false, 'Mute microphone');
  setCallButton('call-camera-btn', 'videocam', false, 'Turn camera off');
  setCallButton('call-screen-btn', 'screen_share', false, 'Share screen');
  setCallButton('call-speaker-btn', 'volume_up', false, 'Mute speaker');
  el('call-remote-video').muted = false;

  const local = el('call-local-video');
  local.srcObject = isVideo ? call.localStream : null;
  local.style.display = isVideo ? '' : 'none';

  updateCallVideoLayout();
  el('call-modal').classList.add('active');
}

// Show the other person's video once it is flowing; otherwise show their name and picture
function updateCallVideoLayout() {
  if (!call) return;
  const remote = el('call-remote-video');
  const hasRemoteVideo = call.media === 'video' && call.state === 'connected' && remote.srcObject && remote.srcObject.getVideoTracks().length > 0;
  remote.style.display = hasRemoteVideo ? '' : 'none';
  el('call-identity').style.display = hasRemoteVideo ? 'none' : '';
}

function hideCallWindow() {
  el('call-modal').classList.remove('active');
  el('call-remote-video').srcObject = null;
  el('call-local-video').srcObject = null;
}

// ===== PLACING A CALL =====
async function startCall(media) {
  if (currentTab !== 'direct' || !activeContactId || !contacts[activeContactId]) return;
  const peerId = activeContactId;

  if (isCallBusy()) return showToast('You are already in a call.');
  if (chatActionsState.blocked.includes(peerId)) return showToast('You have blocked this user. Unblock them to call.');
  if (!window.RTCPeerConnection || !navigator.mediaDevices) {
    return window.showSystemModal('Calls', 'This browser does not support calls.', 'alert');
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return showToast('Not connected right now. Try again in a moment.');

  let stream;
  try {
    stream = await getLocalMedia(media);
  } catch (err) {
    return window.showSystemModal('Call', escapeHtml(err.message), 'alert');
  }
  if (isCallBusy()) return stopStream(stream);   // a call came in while the permission prompt was open

  const callId = newTempId();
  call = createCall({ id: callId, peerId, media, role: 'caller', stream });
  showCallWindow();
  CallDock.activate(directCallSession());
  setCallStatus('Calling...');
  startTone('ringback');

  try {
    const offer = await call.pc.createOffer();
    await call.pc.setLocalDescription(offer);
    wsSend({ type: 'call_offer', to: peerId, call_id: callId, media: media, sdp: call.pc.localDescription });
  } catch (err) {
    return endCall({ notifyPeer: false, reason: 'The call could not be started.', note: false });
  }

  call.ringTimer = setTimeout(() => {
    if (call && call.id === callId && call.state === 'ringing') endCall({ notifyPeer: true, reason: 'No answer.' });
  }, RING_TIMEOUT_MS);
}

// ===== RECEIVING A CALL =====
async function onIncomingOffer(data) {
  if (isCallBusy()) {
    wsSend({ type: 'call_busy', to: data.from, call_id: data.call_id });
    return;
  }
  const offer = { id: data.call_id, from: data.from, media: data.media === 'video' ? 'video' : 'audio', sdp: data.sdp, candidates: [] };
  incomingCall = offer;

  const contact = await ensureContact(data.from);
  if (incomingCall !== offer) return;   // the caller gave up while we were looking them up

  el('incoming-call-name').textContent = contact.name;
  el('incoming-call-kind').textContent = offer.media === 'video' ? 'Incoming video call' : 'Incoming voice call';
  el('incoming-call-avatar').innerHTML = contact.profile_pic
    ? `<img src="${escapeHtml(contact.profile_pic)}" alt="${escapeHtml(contact.name)}"/>`
    : `<span class="material-symbols-outlined text-on-primary text-[32px]">person</span>`;
  el('incoming-call-modal').classList.add('active');
  startTone('ring');

  if (settings.desktop && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new Notification(`${contact.name} is calling`, { body: el('incoming-call-kind').textContent, tag: 'incoming-call' });
      notification.onclick = () => { window.focus(); notification.close(); };
    } catch (e) { /* ignore */ }
  }
}

function dismissIncomingCall() {
  incomingCall = null;
  stopTone();
  el('incoming-call-modal').classList.remove('active');
}

function declineIncomingCall() {
  if (!incomingCall) return;
  wsSend({ type: 'call_decline', to: incomingCall.from, call_id: incomingCall.id });
  // Stop it ringing in this user's other open tabs too
  wsSend({ type: 'call_taken', to: currentUserId, call_id: incomingCall.id });
  dismissIncomingCall();
}

async function acceptIncomingCall() {
  const offer = incomingCall;
  if (!offer) return;
  stopTone();
  el('incoming-call-modal').classList.remove('active');

  let stream;
  try {
    stream = await getLocalMedia(offer.media);
  } catch (err) {
    if (incomingCall === offer) declineIncomingCall();
    return window.showSystemModal('Call', escapeHtml(err.message), 'alert');
  }
  if (incomingCall !== offer) return stopStream(stream);   // the caller hung up while the permission prompt was open

  incomingCall = null;
  call = createCall({ id: offer.id, peerId: offer.from, media: offer.media, role: 'callee', stream });
  call.state = 'connecting';
  showCallWindow();
  CallDock.activate(directCallSession());
  setCallStatus('Connecting...');
  wsSend({ type: 'call_taken', to: currentUserId, call_id: offer.id });

  try {
    await applyRemoteDescription(offer.sdp, offer.candidates);
    const answer = await call.pc.createAnswer();
    await call.pc.setLocalDescription(answer);
    wsSend({ type: 'call_answer', to: offer.from, call_id: offer.id, sdp: call.pc.localDescription });
  } catch (err) {
    endCall({ notifyPeer: true, reason: 'The call could not be connected.' });
  }
}

// ===== SIGNALS FROM THE OTHER SIDE =====
async function handleCallSignal(data) {
  const isCurrentCall = call && call.id === data.call_id;
  const isWaitingOffer = incomingCall && incomingCall.id === data.call_id;

  switch (data.type) {
    case 'call_offer':
      return onIncomingOffer(data);

    case 'call_answer':
      if (!isCurrentCall || call.role !== 'caller' || call.remoteDescriptionSet) return;
      stopTone();
      clearTimeout(call.ringTimer);
      call.state = 'connecting';
      setCallStatus('Connecting...');
      try {
        await applyRemoteDescription(data.sdp);
      } catch (err) {
        endCall({ notifyPeer: true, reason: 'The call could not be connected.' });
      }
      return;

    case 'call_ice':
      if (isCurrentCall) {
        if (call.remoteDescriptionSet) addRemoteCandidate(data.candidate);
        else call.pendingCandidates.push(data.candidate);
      } else if (isWaitingOffer) {
        incomingCall.candidates.push(data.candidate);
      }
      return;

    case 'call_end':
      if (isCurrentCall) endCall({ notifyPeer: false, reason: call.state === 'connected' ? null : 'The call was cancelled.' });
      else if (isWaitingOffer) { dismissIncomingCall(); showToast('Missed call.'); }
      return;

    case 'call_decline':
      if (isCurrentCall) endCall({ notifyPeer: false, reason: 'Call declined.' });
      return;

    case 'call_busy':
      if (isCurrentCall) endCall({ notifyPeer: false, reason: 'They are on another call.' });
      return;

    case 'call_unavailable':
      // "Offline" is a missed call worth recording; a block is not
      if (isCurrentCall) endCall({ notifyPeer: false, reason: data.detail || 'The call could not be placed.', note: /offline/i.test(data.detail || '') });
      return;

    case 'call_taken':
      // Answered or declined in another tab of this account
      if (isWaitingOffer) dismissIncomingCall();
      return;
  }
}

// ===== ENDING A CALL =====
function hangUpCall() {
  endCall({ notifyPeer: true, reason: null });
}

function endCall({ notifyPeer, reason, note = true }) {
  const ended = call;
  if (!ended) return;
  call = null;

  stopTone();
  clearTimeout(ended.ringTimer);
  clearInterval(ended.timerInterval);
  if (notifyPeer) wsSend({ type: 'call_end', to: ended.peerId, call_id: ended.id });

  ended.pc.onicecandidate = null;
  ended.pc.ontrack = null;
  ended.pc.onconnectionstatechange = null;
  try { ended.pc.close(); } catch (e) { /* already closed */ }
  stopStream(ended.localStream);
  stopStream(ended.screenStream);
  hideCallWindow();
  CallDock.deactivate();

  const seconds = ended.startedAt ? Math.round((Date.now() - ended.startedAt) / 1000) : 0;
  showToast(reason || (ended.startedAt ? `Call ended · ${formatDuration(seconds)}` : 'Call ended.'));

  // The caller leaves a record of the call in the conversation
  if (note && ended.role === 'caller' && contacts[ended.peerId]) {
    sendDirectMessage(ended.peerId, ended.startedAt ? `[CALL|${ended.media}|ended|${seconds}]` : `[CALL|${ended.media}|missed|0]`);
  }
}

// ===== IN-CALL CONTROLS =====
function toggleCallMute() {
  if (!call) return;
  const track = call.localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  setCallButton('call-mute-btn', track.enabled ? 'mic' : 'mic_off', !track.enabled, track.enabled ? 'Mute microphone' : 'Unmute microphone');
}

function toggleCallCamera() {
  if (!call || !call.cameraTrack) return;
  call.cameraTrack.enabled = !call.cameraTrack.enabled;
  const on = call.cameraTrack.enabled;
  setCallButton('call-camera-btn', on ? 'videocam' : 'videocam_off', !on, on ? 'Turn camera off' : 'Turn camera on');
}

function toggleCallSpeaker() {
  if (!call) return;
  const remote = el('call-remote-video');
  remote.muted = !remote.muted;
  setCallButton('call-speaker-btn', remote.muted ? 'volume_off' : 'volume_up', remote.muted, remote.muted ? 'Unmute speaker' : 'Mute speaker');
}

function videoSender() {
  return call.pc.getSenders().find(sender => sender.track && sender.track.kind === 'video') || null;
}

async function toggleScreenShare() {
  if (!call || call.media !== 'video') return;
  if (call.screenStream) return stopScreenShare();

  let screenStream;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
  } catch (err) {
    return;   // the user closed the screen picker
  }
  const sender = call ? videoSender() : null;
  if (!sender) return stopStream(screenStream);

  const screenTrack = screenStream.getVideoTracks()[0];
  await sender.replaceTrack(screenTrack);
  call.screenStream = screenStream;
  el('call-local-video').srcObject = screenStream;
  setCallButton('call-screen-btn', 'stop_screen_share', true, 'Stop sharing');
  // The browser's own "Stop sharing" button ends the track
  screenTrack.onended = () => stopScreenShare();
}

async function stopScreenShare() {
  if (!call || !call.screenStream) return;
  const screenStream = call.screenStream;
  call.screenStream = null;
  const sender = videoSender();
  if (sender && call.cameraTrack) await sender.replaceTrack(call.cameraTrack);
  stopStream(screenStream);
  if (call) {
    el('call-local-video').srcObject = call.localStream;
    setCallButton('call-screen-btn', 'screen_share', false, 'Share screen');
  }
}

// Leaving the page ends the call for the other person too. 'pagehide' fires only once the page is really left
// ('beforeunload' also fires when the person is asked "leave this page?" and stays).
window.addEventListener('pagehide', () => {
  if (call) wsSend({ type: 'call_end', to: call.peerId, call_id: call.id });
  if (incomingCall) wsSend({ type: 'call_decline', to: incomingCall.from, call_id: incomingCall.id });
});

// ===== STAYING IN THE CALL WHILE USING OTHER PAGES (call-dock.js) =====
// The call window can step aside: the call goes on, with a small bar to bring it back
function minimizeCallWindow() {
  if (!call) return;
  el('call-modal').classList.remove('active');
  call.minimized = true;
  CallDock.refresh();
}

function restoreCallWindow() {
  if (!call) return;
  call.minimized = false;
  el('call-modal').classList.add('active');
  updateCallVideoLayout();
  CallDock.refresh();
}

function directCallSession() {
  const audioOn = () => { const t = call && call.localStream.getAudioTracks()[0]; return !t || t.enabled; };
  return {
    title: () => (call && contacts[call.peerId] ? contacts[call.peerId].name : 'Call'),
    subtitle: () => (!call ? '' : call.state === 'connected' ? `${call.media === 'video' ? 'Video' : 'Voice'} call · ${el('call-timer').textContent}` : el('call-status').textContent),
    controls: () => !call ? [] : [
      { icon: audioOn() ? 'mic' : 'mic_off', off: !audioOn(), title: audioOn() ? 'Mute microphone' : 'Unmute microphone', onClick: toggleCallMute },
      ...(call.media === 'video' && call.cameraTrack ? [{ icon: call.cameraTrack.enabled ? 'videocam' : 'videocam_off', off: !call.cameraTrack.enabled, title: 'Camera', onClick: toggleCallCamera }] : []),
      ...(call.media === 'video' && navigator.mediaDevices.getDisplayMedia ? [{ icon: call.screenStream ? 'stop_screen_share' : 'screen_share', on: !!call.screenStream, phoneHidden: true, title: call.screenStream ? 'Stop sharing' : 'Share screen', onClick: toggleScreenShare }] : []),
      { icon: 'call_end', danger: true, title: 'End call', onClick: hangUpCall },
    ],
    isCallViewOpen: () => el('call-modal').classList.contains('active'),
    showCall: restoreCallWindow,
    hideCall: minimizeCallWindow,
    minimized: () => !!(call && call.minimized),
    end: hangUpCall,
    pipElement: () => (call && call.media === 'video' ? el('call-remote-video') : null),
  };
}
