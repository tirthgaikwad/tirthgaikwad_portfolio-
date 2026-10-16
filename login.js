// ==========================================
// LOGIN.JS — The login page (login.html): member login, admin login and the switch between them, and the second
// step (authenticator code) for accounts with two-step login on
// Loaded after auth.js, which provides postJson, setFieldError, showNotice and setBusy.
// ==========================================
(function () {
  const byId = (id) => document.getElementById(id);
  const modeSwitch = byId('modeSwitch');
  const notice = byId('loginNotice');
  const forms = { user: byId('loginForm'), admin: byId('adminLoginForm') };
  const twoFactor = { form: byId('twoFactorForm'), ticket: '' };
  const MODE_TEXT = {
    // Sent here from a members-only page (landing page links, shared.js): say which one
    user: { title: 'Log in', lead: NEXT_PAGE ? `Log in or sign up to open ${nextPageName()}.` : 'Use the roll number or ID you signed up with.' },
    admin: { title: 'Admin access', lead: 'For Connect2Minds admins. Enter your admin name and secure code.' }
  };

  // ==========================================
  // 1. MEMBER OR ADMIN
  // ==========================================
  function setMode(mode, focus) {
    modeSwitch.dataset.mode = mode;
    modeSwitch.querySelectorAll('button').forEach(tab => {
      const on = tab.dataset.mode === mode;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    forms.user.hidden = mode !== 'user';
    forms.admin.hidden = mode !== 'admin';
    twoFactor.form.hidden = true;
    byId('loginTitle').textContent = MODE_TEXT[mode].title;
    byId('loginDesc').textContent = MODE_TEXT[mode].lead;
    byId('signupPrompt').hidden = mode !== 'user';
    showNotice(notice, '');
    if (focus) forms[mode].querySelector('input').focus();
  }

  modeSwitch.addEventListener('click', (e) => {
    const tab = e.target.closest('button');
    if (tab) setMode(tab.dataset.mode, true);
  });
  // Arrow keys move between the two tabs, as in any tab list
  modeSwitch.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = modeSwitch.dataset.mode === 'user' ? 'admin' : 'user';
    setMode(next, false);
    modeSwitch.querySelector(`[data-mode="${next}"]`).focus();
  });

  // ==========================================
  // 2. SENDING A FORM
  // ==========================================

  // Marks every empty field and puts the cursor in the first one. True when nothing is empty.
  function requireAll(fields) {
    let firstEmpty = null;
    fields.forEach(([input, message]) => {
      const empty = !input.value.trim();
      setFieldError(input, empty ? message : '');
      if (empty && !firstEmpty) firstEmpty = input;
    });
    if (firstEmpty) firstEmpty.focus();
    return !firstEmpty;
  }

  // Runs one login: send, then either go to the next page or say what went wrong.
  // onRefused(result) may handle a refusal itself (return true), e.g. the admin tab asking for a code.
  async function submitLogin(form, path, body, refusedText, onSuccess, onRefused) {
    const button = form.querySelector('.btn');
    showNotice(notice, '');
    setBusy(button, true);
    const result = await postJson(path, body);
    if (!result.ok) {
      setBusy(button, false);
      if (onRefused && onRefused(result)) return;
      // Suspended accounts and guardian refusals are 403 with a reason worth showing
      const refused = result.status === 401 || (result.status === 403 && !result.message);
      showNotice(notice, refused ? refusedText : (result.message || 'Log in failed. Try again.'));
      return;
    }
    if (result.data && result.data.two_factor) {
      setBusy(button, false);
      return askForCode(result.data.ticket);
    }
    let nextPage = onSuccess(result.data);
    // Under 18 and the guardian has not agreed yet: the waiting page (guardian.html)
    if (result.data && result.data.guardian_needed) nextPage = 'guardian.html';
    button.classList.remove('loading');
    button.classList.add('done');
    button.firstElementChild.textContent = 'Logged in';
    // Logging in during the waiting time of an account deletion cancels it (account.html)
    const restored = Boolean(result.data && result.data.restored);
    if (restored) button.firstElementChild.textContent = 'Welcome back! Deletion cancelled';
    setTimeout(() => { window.location.href = nextPage; }, restored ? 2600 : (REDUCED_MOTION ? 0 : 450));
  }

  forms.user.addEventListener('submit', (e) => {
    e.preventDefault();
    const roll = byId('rollNumber'), password = byId('password');
    if (!requireAll([[roll, 'Enter your roll number or ID.'], [password, 'Enter your password.']])) return;
    submitLogin(forms.user, '/api/login', { roll_no: roll.value.trim(), password: password.value, remember: byId('rememberMe').checked },
      'That roll number or password is not right.', (data) => memberDone(data));
  });

  const memberDone = (data) => {
    localStorage.setItem('currentUserId', data.user_id);
    localStorage.setItem('userRole', data.is_admin ? 'admin' : 'user');
    return NEXT_PAGE || 'home.html';
  };

  // ==========================================
  // 2b. TWO-STEP LOGIN
  // ==========================================
  function askForCode(ticket) {
    twoFactor.ticket = ticket;
    forms.user.hidden = true;
    modeSwitch.hidden = true;
    byId('signupPrompt').hidden = true;
    twoFactor.form.hidden = false;
    byId('loginTitle').textContent = 'Two-step login';
    byId('loginDesc').textContent = 'Open your authenticator app and type the 6-digit code for Connect2Minds.';
    byId('totpCode').value = '';
    byId('totpCode').focus();
  }

  twoFactor.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = byId('totpCode');
    if (!requireAll([[code, 'Enter the code.']])) return;
    submitLogin(twoFactor.form, '/api/login/2fa', { ticket: twoFactor.ticket, code: code.value.trim() }, 'That took too long. Go back and log in again.', memberDone,
      (result) => {
        if (result.status !== 400) return false;
        setFieldError(code, result.message || 'That code is not right.');
        code.select();
        return true;
      });
  });

  byId('twoFactorBack').addEventListener('click', () => {
    twoFactor.ticket = '';
    modeSwitch.hidden = false;
    setMode('user', true);
  });

  forms.admin.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = byId('adminName'), code = byId('adminCode'), totp = byId('adminTotp');
    if (!requireAll([[name, 'Enter your admin name.'], [code, 'Enter your secure code.']])) return;
    submitLogin(forms.admin, '/api/admin/login', { name: name.value.trim(), bypass_code: code.value.trim(), code: totp.value.trim() },
      'That admin name or secure code is not right.',
      (data) => {
        localStorage.setItem('currentUserId', data.user_id);
        localStorage.setItem('userRole', data.role);
        localStorage.setItem('adminToken', data.token);
        return data.role === 'founder' ? 'founder.html' : 'verify.html';
      },
      (result) => {
        // The account has two-step login on: show the code box and ask again
        if (result.status !== 401 || !/code/i.test(result.message || '')) return false;
        byId('adminTotpField').hidden = false;
        setFieldError(totp, totp.value.trim() ? result.message : '');
        if (!totp.value.trim()) showNotice(notice, result.message);
        totp.focus();
        return true;
      });
  });

  // ==========================================
  // 3. ALREADY LOGGED IN ON THIS BROWSER
  // ==========================================
  // Nobody goes into the app from the landing page without choosing: an existing login is offered, not used silently
  async function offerExistingLogin() {
    const done = () => document.documentElement.classList.remove('checking-login');
    if (!localStorage.getItem('currentUserId') || window.location.hash === '#admin') return done();
    let me = null;
    try {
      const res = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
      if (res.status === 401) localStorage.removeItem('currentUserId');
      if (res.ok) me = await res.json();
    } catch (err) { /* offline: just show the form */ }
    if (me && me.id) {
      const name = me.name || 'your account';
      byId('whoName').textContent = name;
      byId('whoSub').textContent = me.college_name || '';
      const avatar = byId('whoAvatar');
      const pic = String(me.profile_pic || '').trim();
      if (pic) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = pic.startsWith('/') ? API_BASE + pic : pic;
        img.onerror = () => { avatar.textContent = initials(name); };
        avatar.replaceChildren(img);
      } else {
        avatar.textContent = initials(name);
      }
      const go = byId('continueBtn');
      go.href = NEXT_PAGE || 'home.html';
      go.firstElementChild.textContent = `Continue as ${name.split(/\s+/)[0]}`;
      byId('loginTitle').textContent = 'Welcome back';
      byId('loginDesc').textContent = NEXT_PAGE ? `You are already logged in. Continue to ${nextPageName()}, or use another account.` : 'You are already logged in on this browser.';
      modeSwitch.hidden = true;
      forms.user.hidden = true;
      byId('signedIn').hidden = false;
    }
    done();
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  }

  byId('otherAccountBtn').addEventListener('click', () => {
    byId('signedIn').hidden = true;
    modeSwitch.hidden = false;
    setMode('user', true);
  });

  byId('signupPrompt').querySelector('a').href = withNext('register.html');

  // login.html#admin opens straight on the admin tab
  if (window.location.hash === '#admin') setMode('admin', false);
  else if (NEXT_PAGE) byId('loginDesc').textContent = MODE_TEXT.user.lead;
  offerExistingLogin();
})();
