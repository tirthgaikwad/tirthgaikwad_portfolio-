// ==========================================
// ACCOUNT-SECURITY.JS — The safety cards on account.html (section 31 of main.py): change password, log out of all
// other devices, confirm the email address with a 6-digit code, and two-step login with an authenticator app.
// Loaded after shared.js, chat-common.js and account.js.
// ==========================================
const SEC = { state: null, twoFactorMode: '' };   // twoFactorMode: setup, off or codes (what the password form is for)
const QR_SCRIPT = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

function showFormError(id, message) {
  el(id).textContent = message || '';
  el(id).hidden = !message;
}

function setStatus(id, message, isError) {
  el(id).textContent = message || '';
  el(id).classList.toggle('is-error', Boolean(isError));
}

async function loadSecurity() {
  try {
    SEC.state = await api('/api/me/safety');
  } catch (err) {
    ['emAddress', 'emState', 'tfState'].forEach(id => { el(id).textContent = 'Could not load. Refresh the page.'; });
    return;
  }
  paintEmail();
  paintTwoFactor();
}

// ---------- password and devices ----------
function openPasswordForm(open) {
  el('pwForm').hidden = !open;
  el('pwOpenBtn').hidden = open;
  showFormError('pwError', '');
  if (open) el('pwCurrent').focus();
  else ['pwCurrent', 'pwNew', 'pwNew2'].forEach(id => { el(id).value = ''; });
}

async function changePassword(event) {
  event.preventDefault();
  const current = el('pwCurrent').value, next = el('pwNew').value;
  if (!current) return showFormError('pwError', 'Type your current password.');
  if (next.length < 8) return showFormError('pwError', 'Use at least 8 characters for the new password.');
  if (next !== el('pwNew2').value) return showFormError('pwError', 'The two new passwords are not the same.');
  el('pwSave').disabled = true;
  try {
    await api('/api/me/password', { method: 'POST', body: { current_password: current, new_password: next } });
    openPasswordForm(false);
    setStatus('secStatus', 'Password changed. Other devices were logged out.');
  } catch (err) {
    showFormError('pwError', err.message);
  } finally {
    el('pwSave').disabled = false;
  }
}

function logoutOtherDevices() {
  window.showSystemModal('Log out of all other devices?', 'Every other browser and phone logged in to your account is logged out. This one stays logged in.', 'confirm', async () => {
    try {
      await api('/api/me/logout-all', { method: 'POST' });
      setStatus('secStatus', 'Done. Only this device is logged in now.');
    } catch (err) {
      setStatus('secStatus', err.message, true);
    }
  }, 'Log them out');
}

// ---------- email ----------
function paintEmail() {
  const s = SEC.state;
  el('emAddress').textContent = s.email || 'No email on your account';
  el('emState').innerHTML = s.email_verified
    ? '<span class="ac-ok">Confirmed</span>'
    : (s.email ? 'Not confirmed yet' : 'Add one to be able to reset your password');
  el('emSendBtn').hidden = !s.email || s.email_verified || !s.email_ready;
  el('emChangeBtn').hidden = !s.email_ready;
  el('emChangeBtn').lastChild.textContent = s.email ? 'Use another email' : 'Add an email';
  if (!s.email_ready) setStatus('emStatus', 'Email sending is not set up on Connect2Minds yet, so codes cannot be sent for now.');
}

async function sendEmailCode(address) {
  setStatus('emStatus', 'Sending…');
  try {
    const result = await api('/api/me/email/send-code', { method: 'POST', body: { email: address || '' } });
    setStatus('emStatus', '');
    el('emNewForm').hidden = true;
    el('emSentTo').textContent = `We sent a 6-digit code to ${result.sent_to}. It works for ${result.minutes} minutes.`;
    el('emCodeForm').hidden = false;
    showFormError('emError', '');
    el('emCode').value = '';
    el('emCode').focus();
  } catch (err) {
    setStatus('emStatus', err.message, true);
  }
}

async function confirmEmailCode(event) {
  event.preventDefault();
  const code = el('emCode').value.trim();
  if (!/^\d{6}$/.test(code)) return showFormError('emError', 'Type the 6 digits from the email.');
  try {
    const result = await api('/api/me/email/verify', { method: 'POST', body: { code } });
    el('emCodeForm').hidden = true;
    SEC.state.email = result.email;
    SEC.state.email_verified = true;
    paintEmail();
    setStatus('emStatus', result.account_status === 'verified' ? 'Email confirmed. Your college email also verified your account.' : 'Email confirmed.');
  } catch (err) {
    showFormError('emError', err.message);
  }
}

// ---------- two-step login ----------
function paintTwoFactor() {
  const on = SEC.state.two_factor;
  el('tfState').innerHTML = on ? '<span class="ac-ok">On</span>' : 'Off';
  el('tfBackups').textContent = on ? String(SEC.state.backup_codes_left) : '—';
  el('tfStartBtn').hidden = on;
  el('tfOffBtn').hidden = !on;
  el('tfNewCodesBtn').hidden = !on;
}

function askPassword(mode) {
  SEC.twoFactorMode = mode;
  ['tfSetup', 'tfCodes'].forEach(id => { el(id).hidden = true; });
  el('tfPwForm').hidden = false;
  el('tfOffCodeField').hidden = mode !== 'off';
  el('tfPwGo').textContent = { setup: 'Continue', off: 'Turn off two-step login', codes: 'Make new codes' }[mode];
  showFormError('tfPwError', '');
  el('tfPassword').value = '';
  el('tfOffCode').value = '';
  el('tfPassword').focus();
}

function loadQrScript() {
  if (window.QRCode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QR_SCRIPT;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function passwordStep(event) {
  event.preventDefault();
  const password = el('tfPassword').value;
  if (!password) return showFormError('tfPwError', 'Type your password.');
  el('tfPwGo').disabled = true;
  try {
    if (SEC.twoFactorMode === 'setup') {
      const setup = await api('/api/me/2fa/setup', { method: 'POST', body: { password } });
      el('tfPwForm').hidden = true;
      el('tfSecret').textContent = setup.secret.replace(/(.{4})/g, '$1 ').trim();
      el('tfQr').replaceChildren();
      try {
        await loadQrScript();
        new window.QRCode(el('tfQr'), { text: setup.uri, width: 168, height: 168, correctLevel: window.QRCode.CorrectLevel.M });
      } catch (err) {
        el('tfQr').textContent = 'The QR code could not load. Type the setup key instead.';
      }
      el('tfSetup').hidden = false;
      showFormError('tfError', '');
      el('tfCode').value = '';
      el('tfCode').focus();
    } else if (SEC.twoFactorMode === 'off') {
      await api('/api/me/2fa/disable', { method: 'POST', body: { password, code: el('tfOffCode').value.trim() } });
      el('tfPwForm').hidden = true;
      SEC.state.two_factor = false;
      paintTwoFactor();
      setStatus('tfStatus', 'Two-step login is off. Other devices were logged out.');
    } else {
      const result = await api('/api/me/2fa/backup-codes', { method: 'POST', body: { password } });
      el('tfPwForm').hidden = true;
      showBackupCodes(result.backup_codes);
    }
  } catch (err) {
    showFormError('tfPwError', err.message);
  } finally {
    el('tfPwGo').disabled = false;
  }
}

async function confirmTwoFactor(event) {
  event.preventDefault();
  const code = el('tfCode').value.trim();
  if (!/^\d{6}$/.test(code)) return showFormError('tfError', 'Type the 6 digits your app shows.');
  try {
    const result = await api('/api/me/2fa/enable', { method: 'POST', body: { code } });
    el('tfSetup').hidden = true;
    SEC.state.two_factor = true;
    showBackupCodes(result.backup_codes);
    setStatus('tfStatus', 'Two-step login is on. Other devices were logged out.');
  } catch (err) {
    showFormError('tfError', err.message);
  }
}

function showBackupCodes(codes) {
  SEC.state.backup_codes_left = codes.length;
  paintTwoFactor();
  el('tfCodeList').innerHTML = codes.map(code => `<li><code>${escapeHtml(code)}</code></li>`).join('');
  el('tfCodes').hidden = false;
  el('tfCopyCodes').onclick = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setStatus('tfStatus', 'Codes copied.');
    } catch (err) {
      setStatus('tfStatus', 'Could not copy. Write them down instead.', true);
    }
  };
}

function initSecurityCards() {
  el('pwOpenBtn').addEventListener('click', () => openPasswordForm(true));
  el('pwCancel').addEventListener('click', () => openPasswordForm(false));
  el('pwForm').addEventListener('submit', changePassword);
  el('logoutAllBtn').addEventListener('click', logoutOtherDevices);

  el('emSendBtn').addEventListener('click', () => sendEmailCode(''));
  el('emChangeBtn').addEventListener('click', () => { el('emNewForm').hidden = false; el('emCodeForm').hidden = true; el('emNew').focus(); });
  el('emNewCancel').addEventListener('click', () => { el('emNewForm').hidden = true; });
  el('emNewForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const address = el('emNew').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setStatus('emStatus', 'Enter a valid email address.', true);
    sendEmailCode(address);
  });
  el('emCodeForm').addEventListener('submit', confirmEmailCode);

  el('tfStartBtn').addEventListener('click', () => askPassword('setup'));
  el('tfOffBtn').addEventListener('click', () => askPassword('off'));
  el('tfNewCodesBtn').addEventListener('click', () => askPassword('codes'));
  el('tfPwCancel').addEventListener('click', () => { el('tfPwForm').hidden = true; });
  el('tfSetupCancel').addEventListener('click', () => { el('tfSetup').hidden = true; });
  el('tfPwForm').addEventListener('submit', passwordStep);
  el('tfConfirmForm').addEventListener('submit', confirmTwoFactor);
  el('tfCodesDone').addEventListener('click', () => { el('tfCodes').hidden = true; });
  loadSecurity();
}

initSecurityCards();
