// ==========================================
// COOKIES.JS — The cookie banner and Cookie settings, on every page (shared.js loads it; index, login and register
// include it themselves). Three kinds, explained to people on cookies.html:
//   essential    the login cookies (authToken, adminToken; set by the server) and this choice. Always on.
//   preferences  what this browser remembers to make the site nicer: the helper's chat history and voice settings,
//                Messages settings, the call window's size and place, the last Project Hub workspace, and saved copies
//                of pages so they open faster. Browser storage only, never sent to the server.
//                Off: none of it is saved, and what was saved before is removed.
//   analytics    a random visitor id (the c2m_vid cookie) so the server can count visits and popular pages
//                (main.py section 29). No IP address, no account, nothing shared with anyone else.
// The choice is the c2m_consent cookie ("v1.p1.a0"), kept for 180 days; after that the banner asks again.
// Until someone chooses, both optional kinds stay off.
// window.CookieConsent: allows(kind), chosen(), open(). Any element with data-cookie-settings opens the settings.
// ==========================================
(function () {
  if (window.CookieConsent) return;
  const IN_DOCK = !!(window.frameElement && window.frameElement.id === 'dockFrame');
  const CONSENT = 'c2m_consent', VISITOR = 'c2m_vid', VERSION = 'v1';
  const KEEP_DAYS = 180, VISITOR_DAYS = 365;
  const API = window.C2M_API_BASE || ((/^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname) || location.port === '5500') ? `${location.protocol}//${location.hostname || '127.0.0.1'}:8000` : location.origin);
  const PAGE = location.pathname.split('/').pop() || 'index.html';
  const SECURE = location.protocol === 'https:' ? '; Secure' : '';

  function readCookie(name) {
    const found = document.cookie.split('; ').find(part => part.startsWith(name + '='));
    return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
  }
  function writeCookie(name, value, days) {
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${Math.round(days * 86400)}; Path=/; SameSite=Lax${SECURE}`;
  }
  function readChoice() {
    const parts = (readCookie(CONSENT) || '').split('.');
    if (parts.length !== 3 || parts[0] !== VERSION) return null;
    return { preferences: parts[1] === 'p1', analytics: parts[2] === 'a1' };
  }

  let choice = readChoice();
  const allows = (kind) => !!(choice && choice[kind]);

  // ---------- preferences: the browser storage that only makes the site nicer ----------
  // Login state (currentUserId, userRole, adminToken) and "already offered the tour" are essential and always kept.
  const isPreference = (key) => (/^c2m:/.test(key) && !/:helpbotTourOffered$/.test(key)) || key === 'callDockSplit' || key === 'callDockBar';
  try {
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (!allows('preferences') && isPreference(String(key)) && this === window.localStorage) return;
      return realSetItem.call(this, key, value);
    };
  } catch (e) { /* storage unavailable */ }

  function clearPreferences() {
    try { Object.keys(localStorage).filter(isPreference).forEach(key => localStorage.removeItem(key)); } catch (e) { /* storage unavailable */ }
  }

  // ---------- analytics: one count per page opened ----------
  let counted = false;
  function countVisit() {
    if (counted || IN_DOCK || !allows('analytics')) return;
    counted = true;
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(readCookie(VISITOR) || '')) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      writeCookie(VISITOR, id, VISITOR_DAYS);
    }
    fetch(`${API}/api/visits`, { method: 'POST', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: PAGE }) }).catch(() => { /* counting is optional */ });
  }

  function save(next) {
    choice = { preferences: !!next.preferences, analytics: !!next.analytics };
    writeCookie(CONSENT, `${VERSION}.p${choice.preferences ? 1 : 0}.a${choice.analytics ? 1 : 0}`, KEEP_DAYS);
    if (!choice.preferences) clearPreferences();
    if (!choice.analytics) writeCookie(VISITOR, '', 0);
    closeBanner();
    document.dispatchEvent(new CustomEvent('cookieconsent', { detail: { ...choice } }));
    countVisit();
    toast('Cookie choices saved.');
  }

  // ---------- the banner ----------
  let banner = null;
  function showBanner() {
    if (banner || IN_DOCK) return;
    banner = document.createElement('section');
    banner.className = 'ck-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookies');
    banner.innerHTML = `
      <div class="ck-text">
        <h2>Cookies on Connect2Minds</h2>
        <p>Essential cookies keep you logged in. With your OK, we also remember your settings on this device and count visits to improve the site. No ads, and nothing is shared with other companies. <a href="cookies.html">Cookie policy</a></p>
      </div>
      <div class="ck-actions">
        <button type="button" class="ck-btn is-link" data-ck="choose">Choose</button>
        <button type="button" class="ck-btn" data-ck="essential">Essentials only</button>
        <button type="button" class="ck-btn is-primary" data-ck="all">Accept all</button>
      </div>`;
    banner.addEventListener('click', (e) => {
      const button = e.target.closest('[data-ck]');
      if (!button) return;
      if (button.dataset.ck === 'all') save({ preferences: true, analytics: true });
      else if (button.dataset.ck === 'essential') save({ preferences: false, analytics: false });
      else openSettings();
    });
    document.body.appendChild(banner);
    document.body.classList.add('ck-banner-open');
  }
  function closeBanner() {
    if (banner) banner.remove();
    banner = null;
    document.body.classList.remove('ck-banner-open');
  }

  // ---------- Cookie settings ----------
  const KINDS = [
    { id: 'essential', name: 'Essential', fixed: true,
      text: 'Keep you logged in and remember this choice. The site cannot work without them.' },
    { id: 'preferences', name: 'Preferences',
      text: 'Remember things on this device: the helper\'s chat history and voice settings, Messages settings, the call window\'s size and place, your last Project Hub workspace, and copies of pages so they open faster.' },
    { id: 'analytics', name: 'Visit counts',
      text: 'A random ID so we can count visits and see which pages are used. We never store your IP address or link it to your account.' }
  ];
  let dialog = null;
  function openSettings() {
    if (IN_DOCK && window.top.CookieConsent) return window.top.CookieConsent.open();
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'ck-dialog';
      dialog.setAttribute('aria-labelledby', 'ckTitle');
      dialog.innerHTML = `
        <form method="dialog">
          <div class="ck-head"><h2 id="ckTitle">Cookie settings</h2>
            <button type="button" class="ck-x" data-ck-close aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
          <p class="ck-lead">Choose what Connect2Minds may keep on this device. You can change this any time from <a href="cookies.html">Cookies</a> at the bottom of every page.</p>
          ${KINDS.map(kind => `
            <div class="ck-row">
              <div><h3 id="ck-${kind.id}-name">${kind.name}</h3><p id="ck-${kind.id}-text">${kind.text}</p></div>
              ${kind.fixed ? '<span class="ck-always">Always on</span>'
                : `<label class="ck-switch"><input type="checkbox" role="switch" id="ck-${kind.id}" aria-labelledby="ck-${kind.id}-name" aria-describedby="ck-${kind.id}-text"><span aria-hidden="true"></span></label>`}
            </div>`).join('')}
          <div class="ck-foot">
            <button type="button" class="ck-btn" data-ck-save>Save my choices</button>
            <button type="button" class="ck-btn is-primary" data-ck-all>Accept all</button>
          </div>
        </form>`;
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog || e.target.closest('[data-ck-close]')) return dialog.close();
        if (e.target.closest('[data-ck-all]')) { save({ preferences: true, analytics: true }); dialog.close(); }
        if (e.target.closest('[data-ck-save]')) {
          save({ preferences: dialog.querySelector('#ck-preferences').checked, analytics: dialog.querySelector('#ck-analytics').checked });
          dialog.close();
        }
      });
      document.body.appendChild(dialog);
    }
    dialog.querySelector('#ck-preferences').checked = allows('preferences');
    dialog.querySelector('#ck-analytics').checked = allows('analytics');
    dialog.showModal();
  }

  function toast(message) {
    document.querySelectorAll('.ck-toast').forEach(node => node.remove());
    const node = document.createElement('div');
    node.className = 'ck-toast';
    node.setAttribute('role', 'status');
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2600);
  }

  document.addEventListener('click', (e) => {
    const opener = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (!opener) return;
    e.preventDefault();
    openSettings();
  });

  window.CookieConsent = { allows, chosen: () => !!choice, open: openSettings };

  function start() {
    if (choice && !choice.preferences) clearPreferences();
    if (!choice) showBanner();
    countVisit();
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
