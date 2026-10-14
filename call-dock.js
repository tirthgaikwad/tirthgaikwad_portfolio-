// ==========================================
// CALL-DOCK.JS — Stay in a call while using the rest of the site.
// The page that holds the call (team.html or inbox.html) never unloads during a call. Any other page
// opens inside it, in a frame: full screen with a small floating call bar, or side by side with the call.
// A page shown in the frame knows it (html.in-dock, set by shared.js) and hides its phone tab bar and footer.
//
// The calling page hands over a "session":
//   title(), subtitle()            what the call bar shows
//   controls()                     [{ icon, title, off, on, danger, phoneHidden, onClick }]
//   isCallViewOpen(), showCall(), hideCall()
//   minimized()                    true when the call window is closed but the call goes on
//   plan                           optional { label, url(), invite() }: "Plan together"
//   pipElement()                   optional: the video to pop out into a floating window
// ==========================================

const CallDock = (() => {
  // A page inside the frame never docks another call: it just works as a normal page there
  const inFrame = !!(window.frameElement && window.frameElement.id === 'dockFrame');
  const SPLIT_KEY = 'callDockSplit';
  const BAR_KEY = 'callDockBar';
  const QUICK_PAGES = [
    ['home.html', 'home', 'Home'], ['project_management.html', 'view_kanban', 'Project Hub'], ['study.html', 'menu_book', 'My Study'],
    ['notes.html', 'description', 'Notes'], ['search.html', 'explore', 'Discover'], ['board.html', 'work', 'Opportunities'],
    ['college-hub.html', 'school', 'College Hub'], ['team.html', 'groups', 'My Teams'], ['inbox.html', 'chat', 'Messages']
  ];

  let session = null;
  let mode = 'call';            // call: only the calling page; full: a page over it; split: a page beside it
  let built = false;
  let leavingOnPurpose = false;
  let pip = null;               // { win, element, parent, next }
  const hostPage = (location.pathname.split('/').pop() || 'index.html');

  const $ = (id) => document.getElementById(id);
  const isPhone = () => window.matchMedia('(max-width: 767px)').matches;
  const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;

  // ---------- building the pieces once ----------
  function build() {
    if (built) return;
    built = true;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="cd-dock" id="callDock" hidden>
        <div class="cd-frame-bar">
          <button type="button" class="cd-icon" data-cd="back" title="Back">${icon('arrow_back')}</button>
          <span class="cd-frame-title" id="callDockTitle">Loading…</span>
          <button type="button" class="cd-icon" data-cd="reload" title="Reload this page">${icon('refresh')}</button>
          <button type="button" class="cd-icon cd-desktop" data-cd="split" title="Side by side">${icon('vertical_split')}</button>
          <button type="button" class="cd-icon" data-cd="close" title="Close this page and go back to the call">${icon('close')}</button>
        </div>
        <iframe id="dockFrame" name="dockFrame" title="Page opened during the call"></iframe>
      </div>
      <div class="cd-splitter" id="callDockSplitter" hidden title="Drag to resize"></div>
      <div class="cd-bar" id="callDockBar" hidden role="region" aria-label="Call controls">
        <span class="cd-grip" id="callDockGrip" title="Drag to move">${icon('drag_indicator')}</span>
        <span class="cd-live" aria-hidden="true"></span>
        <div class="cd-bar-text"><strong id="callDockBarTitle"></strong><small id="callDockBarSub"></small></div>
        <div class="cd-bar-controls" id="callDockControls"></div>
        <span class="cd-sep"></span>
        <div class="cd-menu-wrap">
          <button type="button" class="cd-icon" data-cd="pages" title="Open a page while you talk" aria-haspopup="true">${icon('apps')}</button>
          <div class="cd-menu" id="callDockMenu" hidden></div>
        </div>
        <button type="button" class="cd-icon" data-cd="plan" id="callDockPlan" hidden>${icon('view_kanban')}</button>
        <button type="button" class="cd-icon cd-desktop" data-cd="mode" id="callDockMode" title="Side by side">${icon('vertical_split')}</button>
        <button type="button" class="cd-icon" data-cd="pip" id="callDockPip" hidden title="Pop the video out into a floating window">${icon('picture_in_picture_alt')}</button>
        <button type="button" class="cd-pill" data-cd="call" id="callDockCall">${icon('call')}<span>Show call</span></button>
      </div>`);

    $('callDock').addEventListener('click', onDockClick);
    $('callDockBar').addEventListener('click', onDockClick);
    $('dockFrame').addEventListener('load', onFrameLoad);
    initSplitter();
    initBarDrag();
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.cd-menu-wrap')) $('callDockMenu').hidden = true;
    });
    window.addEventListener('resize', () => { if (session && mode === 'split' && isPhone()) setMode('full'); else layout(); });
  }

  // ---------- opening pages ----------
  function pageOf(url) {
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin) return null;
      const page = u.pathname.split('/').pop() || 'index.html';
      return /\.html$/.test(page) ? { page, url: u.pathname.split('/').pop() + u.search + u.hash } : null;
    } catch (e) {
      return null;
    }
  }

  function open(url, wanted) {
    if (!session) return false;
    const target = pageOf(url);
    if (!target) return false;
    // The calling page itself is already here: just show the call
    if (target.page === hostPage) { backToCall(); return true; }
    if (['login.html', 'index.html', 'register.html'].includes(target.page)) return false;
    build();
    const frame = $('dockFrame');
    $('callDockTitle').textContent = 'Loading…';
    if (frame.dataset.url !== target.url) {
      frame.dataset.url = target.url;
      frame.src = target.url;
    }
    setMode(wanted === 'split' && !isPhone() ? 'split' : (mode === 'split' && !isPhone() ? 'split' : 'full'));
    return true;
  }

  function backToCall() {
    if (!session) return;
    setMode('call');
    if (!session.isCallViewOpen() && session.showCall) session.showCall();
  }

  // The frame's 'load' event waits for every font and script from the internet, which can take long on a slow
  // connection. Instead the frame is looked at a few times a second while it is shown: as soon as its page can be
  // read, its title goes into the strip (pages change their title once their data arrives, so it is kept in step).
  let frameTimer = null;
  function onFrameLoad() { syncFrame(); }

  function syncFrame() {
    const frame = $('dockFrame');
    let win = null;
    try { win = frame.contentWindow; if (!win.document) win = null; } catch (e) { win = null; }
    if (!win || win.location.href === 'about:blank') return;
    const url = (win.location.pathname.split('/').pop() || '') + win.location.search;
    if (frame.dataset.url !== url) frame.dataset.url = url;
    const title = (win.document.title || '').replace(/^Connect2Minds \| /, '') || 'Page';
    if ($('callDockTitle').textContent !== title) $('callDockTitle').textContent = title;
  }

  function watchFrame(on) {
    if (on && !frameTimer) frameTimer = setInterval(syncFrame, 400);
    if (!on && frameTimer) { clearInterval(frameTimer); frameTimer = null; }
  }

  // Links on the calling page itself open in the frame while a call is on
  function interceptLinks(e) {
    if (!session || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest && e.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download') || link.closest('#callDock, #callDockBar')) return;
    const target = pageOf(link.getAttribute('href'));
    if (!target || target.page === hostPage) return;
    if (open(link.getAttribute('href'))) e.preventDefault();
  }

  // ---------- layout ----------
  function setMode(next) {
    mode = next;
    if (session && mode !== 'call' && session.isCallViewOpen() && session.hideCall && mode === 'full') session.hideCall();
    layout();
  }

  function splitWidth() {
    const saved = parseInt(localStorage.getItem(SPLIT_KEY) || '0', 10);
    const width = saved || Math.round(window.innerWidth * 0.5);
    return Math.max(360, Math.min(window.innerWidth - 360, width));
  }

  function layout() {
    if (!built) return;
    const dock = $('callDock');
    dock.hidden = mode === 'call';
    watchFrame(mode !== 'call');
    dock.classList.toggle('is-split', mode === 'split');
    $('callDockSplitter').hidden = mode !== 'split';
    document.body.classList.toggle('dock-split', mode === 'split');
    document.body.classList.toggle('dock-full', mode === 'full');
    document.documentElement.style.setProperty('--dock-w', mode === 'split' ? `${splitWidth()}px` : '0px');
    // Side by side, the call bar sits in the page's panel under its title strip instead of floating over the calling page
    const bar = $('callDockBar');
    if (mode === 'split' && bar.parentNode !== dock) dock.insertBefore(bar, $('dockFrame'));
    if (mode !== 'split' && bar.parentNode !== document.body) document.body.appendChild(bar);
    bar.classList.toggle('is-strip', mode === 'split');
    if (session || mode === 'call') renderBar();   // after a call ended the bar shows the "call ended" choice instead
  }

  function renderBar() {
    if (!built) return;
    const bar = $('callDockBar');
    const visible = !!session && (mode !== 'call' || (session.minimized && session.minimized()));
    bar.hidden = !visible;
    if (!visible) return;
    $('callDockBarTitle').textContent = session.title ? session.title() : 'Call';
    $('callDockBarSub').textContent = session.subtitle ? session.subtitle() : '';
    const controlsHtml = (session.controls ? session.controls() : []).map((c, i) => `
      <button type="button" class="cd-ctl${c.off ? ' is-off' : ''}${c.on ? ' is-on' : ''}${c.danger ? ' is-danger' : ''}${c.phoneHidden ? ' cd-desktop' : ''}"
        data-ctl="${i}" title="${escapeHtml(c.title || '')}" aria-label="${escapeHtml(c.title || '')}">${icon(c.icon)}</button>`).join('');
    // Redrawn only when something changed, so a click is never lost to a redraw (the bar refreshes every second)
    const controls = $('callDockControls');
    if (controls.dataset.html !== controlsHtml) { controls.innerHTML = controlsHtml; controls.dataset.html = controlsHtml; }
    const plan = $('callDockPlan');
    plan.hidden = !session.plan;
    if (session.plan) plan.title = session.plan.label;
    $('callDockMode').innerHTML = icon(mode === 'split' ? 'fullscreen' : 'vertical_split');
    $('callDockMode').title = mode === 'split' ? 'Page full screen' : 'Side by side';
    $('callDockMode').hidden = mode === 'call';
    $('callDockPip').hidden = !(window.documentPictureInPicture && session.pipElement && session.pipElement());
    const callButton = $('callDockCall');
    const callShown = mode !== 'full' && session.isCallViewOpen();
    callButton.hidden = callShown;
    callButton.querySelector('span:last-child').textContent = mode === 'call' ? 'Show call' : 'Back to call';
    placeBar();
  }

  // ---------- the bar's buttons ----------
  function onDockClick(e) {
    const ended = e.target.closest('[data-ended]');
    if (ended) return afterEnd(ended.dataset.ended);
    if (!session) {
      // After the call ended only the frame's own buttons still work
      const button = e.target.closest('[data-cd]');
      if (button && button.dataset.cd === 'close') afterEnd('close');
      else if (button && ['back', 'reload'].includes(button.dataset.cd)) { /* handled below */ } else return;
    }
    const ctl = e.target.closest('[data-ctl]');
    if (ctl) {
      const control = (session.controls() || [])[parseInt(ctl.dataset.ctl, 10)];
      if (control) Promise.resolve(control.onClick()).finally(renderBar);
      return;
    }
    const button = e.target.closest('[data-cd]');
    if (!button) return;
    const frame = $('dockFrame');
    switch (button.dataset.cd) {
      case 'back': try { frame.contentWindow.history.back(); } catch (err) { /* nothing to go back to */ } return;
      case 'reload': try { frame.contentWindow.location.reload(); } catch (err) { /* not loaded */ } return;
      case 'close': return backToCall();
      case 'split': case 'mode': return setMode(mode === 'split' ? 'full' : 'split');
      case 'call': return mode === 'full' ? backToCall() : (session.showCall && session.showCall(), renderBar());
      case 'plan': return openPlanMenu(button);
      case 'pip': return popOutVideo();
      case 'pages': return toggleMenu(QUICK_PAGES.filter(([page]) => page !== hostPage).map(([page, ic, label]) => ({ icon: ic, label, action: () => open(page) })));
      case 'menu': {
        const item = (menuItems || [])[parseInt(button.dataset.index, 10)];
        $('callDockMenu').hidden = true;
        if (item) item.action();
        return;
      }
    }
  }

  let menuItems = [];
  function toggleMenu(items) {
    const menu = $('callDockMenu');
    if (!menu.hidden) { menu.hidden = true; return; }
    menuItems = items;
    menu.innerHTML = items.map((item, i) => `<button type="button" data-cd="menu" data-index="${i}">${icon(item.icon)}<span>${escapeHtml(item.label)}</span></button>`).join('');
    menu.hidden = false;
  }

  function openPlanMenu() {
    if (!session.plan) return;
    toggleMenu([
      { icon: 'vertical_split', label: 'Open Project Hub side by side', action: () => open(session.plan.url(), 'split') },
      { icon: 'campaign', label: 'Ask everyone in the call to open it', action: () => { open(session.plan.url(), 'split'); session.plan.invite(); showToast('Asked everyone in the call to open Project Hub.'); } }
    ]);
  }

  // ---------- Picture-in-Picture (Chrome / Edge) ----------
  async function popOutVideo() {
    if (pip) { pip.win.close(); return; }
    const element = session.pipElement && session.pipElement();
    if (!element || !window.documentPictureInPicture) return;
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 420, height: 260 });
      [...document.styleSheets].forEach(sheet => {
        try {
          const style = win.document.createElement('style');
          style.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
          win.document.head.appendChild(style);
        } catch (err) {
          if (sheet.href) { const link = win.document.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; win.document.head.appendChild(link); }
        }
      });
      win.document.body.className = 'cd-pip';
      pip = { win, element, parent: element.parentNode, next: element.nextSibling };
      win.document.body.appendChild(element);
      element.querySelectorAll('video').forEach(v => v.play().catch(() => {}));
      win.addEventListener('pagehide', () => {
        if (!pip) return;
        pip.parent.insertBefore(pip.element, pip.next);
        pip.element.querySelectorAll('video').forEach(v => v.play().catch(() => {}));
        pip = null;
        renderBar();
      });
    } catch (err) {
      showToast('This browser could not pop the video out.');
    }
  }

  // ---------- dragging ----------
  function initSplitter() {
    const splitter = $('callDockSplitter');
    splitter.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      document.body.classList.add('cd-resizing');
      const move = (ev) => {
        const width = Math.max(360, Math.min(window.innerWidth - 360, window.innerWidth - ev.clientX));
        document.documentElement.style.setProperty('--dock-w', `${width}px`);
        try { localStorage.setItem(SPLIT_KEY, String(width)); } catch (err) { /* storage unavailable */ }
      };
      const up = () => {
        splitter.removeEventListener('pointermove', move);
        document.body.classList.remove('cd-resizing');
        window.dispatchEvent(new Event('resize'));
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up, { once: true });
    });
  }

  function placeBar() {
    const bar = $('callDockBar');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(BAR_KEY)); } catch (e) { /* none */ }
    if (isPhone() || !saved || mode === 'split') { bar.style.left = ''; bar.style.top = ''; bar.classList.remove('is-placed'); return; }
    const x = Math.max(8, Math.min(window.innerWidth - bar.offsetWidth - 8, saved.x));
    const y = Math.max(8, Math.min(window.innerHeight - bar.offsetHeight - 8, saved.y));
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
    bar.classList.add('is-placed');
  }

  function initBarDrag() {
    const grip = $('callDockGrip');
    const bar = $('callDockBar');
    grip.addEventListener('pointerdown', (e) => {
      if (isPhone() || mode === 'split') return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const box = bar.getBoundingClientRect();
      const dx = e.clientX - box.left, dy = e.clientY - box.top;
      document.body.classList.add('cd-resizing');
      const move = (ev) => {
        bar.classList.add('is-placed');
        bar.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, ev.clientX - dx))}px`;
        bar.style.top = `${Math.max(8, Math.min(window.innerHeight - box.height - 8, ev.clientY - dy))}px`;
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        document.body.classList.remove('cd-resizing');
        try { localStorage.setItem(BAR_KEY, JSON.stringify({ x: parseInt(bar.style.left, 10), y: parseInt(bar.style.top, 10) })); } catch (err) { /* storage unavailable */ }
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
    });
  }

  // ---------- the call starting and ending ----------
  function activate(newSession) {
    if (inFrame) return;
    session = newSession;
    build();
    $('callDockBar').classList.remove('is-ended');
    $('callDockBar').querySelector('.cd-menu-wrap').hidden = false;
    layout();
  }

  function deactivate() {
    if (!session) return;
    session = null;
    if (pip) { try { pip.win.close(); } catch (e) { /* already closed */ } }
    if (!built) return;
    if (mode === 'call') return layout();
    // A page is open: leave it exactly as it is (it may hold unsaved typing) and let the person choose
    const bar = $('callDockBar');
    bar.hidden = false;
    bar.classList.add('is-ended');
    $('callDockBarTitle').textContent = 'The call ended';
    $('callDockBarSub').textContent = 'Your page is still open.';
    $('callDockControls').dataset.html = '';
    $('callDockControls').innerHTML = `
      <button type="button" class="cd-pill" data-ended="stay">${icon('open_in_full')}<span>Stay on this page</span></button>
      <button type="button" class="cd-pill is-quiet" data-ended="close">${icon('close')}<span>Close it</span></button>`;
    ['callDockPlan', 'callDockMode', 'callDockPip', 'callDockCall'].forEach(id => { $(id).hidden = true; });
    bar.querySelector('.cd-menu-wrap').hidden = true;
  }

  function afterEnd(choice) {
    const frame = $('dockFrame');
    const url = frame.dataset.url;
    $('callDockBar').classList.remove('is-ended');
    $('callDockBar').querySelector('.cd-menu-wrap').hidden = false;
    if (choice === 'stay' && url && pageOf(url)) { window.location.href = url; return; }
    frame.removeAttribute('src');
    frame.dataset.url = '';
    mode = 'call';
    layout();
  }

  // Leave the site's page on purpose (for example logging out from inside the frame): end the call first
  function leaveTo(url) {
    leavingOnPurpose = true;
    if (session && session.end) { try { session.end(); } catch (e) { /* already ending */ } }
    window.location.href = url;
  }

  if (!inFrame) {
    document.addEventListener('click', interceptLinks, true);
    window.addEventListener('beforeunload', (e) => {
      if (!session || leavingOnPurpose) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  return {
    activate, deactivate, open, backToCall, leaveTo,
    refresh: () => { if (session) renderBar(); },
    get active() { return !!session; },
    get mode() { return mode; },
  };
})();
window.CallDock = CallDock;
