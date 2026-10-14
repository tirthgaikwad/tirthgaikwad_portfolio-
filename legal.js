// ==========================================
// LEGAL.JS — Privacy, Terms and Support pages. They open for visitors who are not logged in too:
// those get a plain top bar with Log in and Sign up instead of the app's menus.
// The Support form sends an enquiry of kind "support"; it shows in the founder console under Enquiries.
// ==========================================

function initLegal() {
  if (!localStorage.getItem('currentUserId')) {
    const header = document.getElementById('appHeader');
    if (header) header.innerHTML = `<div class="lg-guest-bar"><a class="lg-brand" href="index.html">Connect2Minds</a>
      <nav><a class="hm-btn is-quiet" href="login.html">Log in</a><a class="hm-btn" href="register.html">Sign up</a></nav></div>`;
    document.body.classList.add('tabbar-off');      // the phone tab bar is for members
  }
  const form = document.getElementById('supportForm');
  if (form) initSupport(form);
}

function initSupport(form) {
  const field = (id) => document.getElementById(id);
  // A logged-in person's name and email are filled in for them
  const fill = () => {
    const me = window.currentUserProfile;
    if (!me) return false;
    if (!field('supName').value) field('supName').value = me.name || '';
    if (!field('supEmail').value && /@/.test(me.email || '') && !/placeholder/.test(me.email)) field('supEmail').value = me.email;
    return true;
  };
  // The header profile arrives a moment after the page (shared.js); look for it for a few seconds
  let tries = 0;
  const wait = setInterval(() => { if (fill() || ++tries > 30) clearInterval(wait); }, 300);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = field('supError');
    const show = (message) => { error.textContent = message; error.hidden = !message; };
    const topic = field('supTopic').value, name = field('supName').value.trim(), email = field('supEmail').value.trim(), message = field('supMessage').value.trim();
    if (!topic) return show('Pick a topic.');
    if (!name) return show('Tell us your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return show('Enter an email address we can reply to.');
    if (message.length < 10) return show('Tell us a little more about what happened.');
    show('');
    const button = field('supSend');
    button.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/enquiries`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'support', organisation: topic, contact_name: name, email, message })
      });
      let data = null;
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (!res.ok) throw new Error(res.status === 429 ? 'Too many messages. Wait a minute and try again.' : (data && typeof data.detail === 'string' ? data.detail : 'Could not send. Please try again.'));
      field('supSentTo').textContent = email;
      form.hidden = true;
      field('supSent').hidden = false;
    } catch (err) {
      show(err.message === 'Failed to fetch' ? 'Could not reach the server.' : err.message);
      button.disabled = false;
    }
  });
}
