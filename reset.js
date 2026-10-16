// ==========================================
// RESET.JS — Forgot password (reset.html). Without ?t= it asks for the roll number, ID or email and the server
// emails a link (section 31 of main.py); with ?t= (that link) it asks for the new password.
// Loaded after auth.js, which provides postJson, setFieldError, showNotice and setBusy.
// ==========================================
(function () {
  const byId = (id) => document.getElementById(id);
  const notice = byId('resetNotice');
  const token = new URLSearchParams(window.location.search).get('t') || '';

  function finish(title, text, buttonText, href) {
    byId('askForm').hidden = true;
    byId('newForm').hidden = true;
    byId('resetTitle').textContent = title;
    byId('resetLead').textContent = '';
    byId('resetDoneText').textContent = text;
    byId('resetDoneBtn').href = href;
    byId('resetDoneBtn').firstElementChild.textContent = buttonText;
    byId('resetDone').hidden = false;
  }

  // 1. Ask for a link
  byId('askForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const who = byId('who');
    if (!who.value.trim()) { setFieldError(who, 'Enter your roll number, ID or email.'); return who.focus(); }
    const button = e.currentTarget.querySelector('.btn');
    showNotice(notice, '');
    setBusy(button, true);
    const result = await postJson('/api/password/forgot', { who: who.value.trim() });
    setBusy(button, false);
    if (!result.ok) return showNotice(notice, result.message || 'Could not send. Try again.');
    if (result.data.email_ready === false) return finish('We cannot email you yet', result.data.message, 'Write to Support', 'support.html');
    finish('Check your email', `${result.data.message} Look in spam too. No email on your account? Write to Support with your roll number.`, 'Back to log in', 'login.html');
  });

  // 2. Choose a new password from the emailed link
  async function openLink() {
    byId('askForm').hidden = true;
    byId('resetTitle').textContent = 'Checking your link…';
    byId('resetLead').textContent = '';
    let check = null;
    try {
      const res = await fetch(`${API_BASE}/api/password/reset?t=${encodeURIComponent(token)}`, { credentials: 'include' });
      check = await res.json();
    } catch (err) { /* shown below */ }
    if (!check || !check.valid) {
      byId('resetTitle').textContent = 'This link does not work any more';
      byId('resetLead').textContent = 'Reset links work once, for 30 minutes. Ask for a new one.';
      byId('askForm').hidden = false;
      history.replaceState(null, '', 'reset.html');
      return;
    }
    byId('resetTitle').textContent = check.first_name ? `New password for ${check.first_name}` : 'Choose a new password';
    byId('resetLead').textContent = 'Every device logged in to your account will be logged out.';
    byId('newForm').hidden = false;
    byId('newPassword').focus();
  }

  byId('newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const first = byId('newPassword'), second = byId('newPassword2');
    if (first.value.length < 8) { setFieldError(first, 'Use at least 8 characters.'); return first.focus(); }
    if (second.value !== first.value) { setFieldError(second, 'The two passwords are not the same.'); return second.focus(); }
    const button = e.currentTarget.querySelector('.btn');
    showNotice(notice, '');
    setBusy(button, true);
    const result = await postJson('/api/password/reset', { token, password: first.value });
    setBusy(button, false);
    if (!result.ok) return showNotice(notice, result.message || 'Could not save. Try again.');
    try { localStorage.removeItem('currentUserId'); } catch (err) { /* storage unavailable */ }
    history.replaceState(null, '', 'reset.html');
    finish('Password changed', 'Your new password is saved and every device was logged out. Log in with the new password.', 'Go to log in', 'login.html');
  });

  if (token) openLink();
  else byId('who').focus();
})();
