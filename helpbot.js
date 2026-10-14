// ==========================================
// HELPBOT.JS — The Connect2Minds helper: a chat panel on every page that explains the site, takes people to the
// right place (and highlights what to press), looks up their own things, does small jobs after they confirm,
// gives a first-visit tour, and listens and speaks with the browser's own voice features.
//
// Two brains, same knowledge (helpbot_kb.json):
//   built-in  - always available, free: command patterns first, then keyword matching against the articles
//   AI        - when the server has an Anthropic key (/api/helpbot/status): Claude answers, streaming; if it fails
//               or the daily allowance is used up, the built-in guide answers that question instead
// Nothing is ever changed without the person pressing Confirm. Chat history stays in this browser.
// Self-contained: works on pages without shared.js (landing, login, sign-up).
// ==========================================
(() => {
  if (window.__helpbot) return;
  window.__helpbot = true;
  if (window.frameElement && window.frameElement.id === 'dockFrame') return;   // inside the call dock: the outer page has the helper

  const API = `${location.protocol}//${location.hostname || '127.0.0.1'}:8000`;
  const PAGE = location.pathname.split('/').pop() || 'index.html';
  const UID = parseInt(localStorage.getItem('currentUserId'), 10) || null;
  const MEMBER = !!UID;
  const STORE = `c2m:helpbot:${UID || 'guest'}`;
  const MAX_HISTORY = 30;
  const MEMBER_PAGES_FREE = ['index.html', 'login.html', 'register.html', 'privacy.html', 'terms.html', 'support.html', 'cookies.html', 'pricing.html'];
  const TAB_PAGES = { 'study.html': 'tab', 'project_management.html': 'tab', 'college-hub.html': 'tab' };

  let kb = null;
  let ai = null;                // true / false once known
  let history = [];
  let settings = { speak: false, lang: 'en-IN' };
  let busy = false;
  let recognition = null;
  let spokeLast = false;        // the last question came by voice: answer aloud

  // ---------- small helpers ----------
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const $ = (sel, root = document) => root.querySelector(sel);
  const load = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; } };
  const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or off */ } };
  const ICONS = {
    chat: '<path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H9l-4.2 3.6a.5.5 0 01-.8-.4V16.4A2.5 2.5 0 014 14z"/><circle cx="9" cy="9.5" r="1" fill="currentColor"/><circle cx="12" cy="9.5" r="1" fill="currentColor"/><circle cx="15" cy="9.5" r="1" fill="currentColor"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
    more: '<circle cx="12" cy="5.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="18.5" r="1.2" fill="currentColor"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  };
  const svg = (name, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  async function call(path, options = {}) {
    const res = await fetch(`${API}${path}`, { credentials: 'include', ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) {
      const err = new Error(res.status === 401 ? 'Please log in first.' : (data && typeof data.detail === 'string' ? data.detail : 'That did not work. Please try again.'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function isoOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function niceDay(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const diff = Math.round((date - new Date(new Date().toDateString())) / 86400000);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    return date.toLocaleDateString([], { weekday: diff > 0 && diff < 7 ? 'long' : undefined, day: 'numeric', month: 'short' });
  }

  // ==========================================
  // 1. THE PANEL
  // ==========================================
  function build() {
    if ($('#helpbotButton')) return;
    if (!document.querySelector('link[href$="helpbot.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'helpbot.css';
      document.head.appendChild(link);
    }
    document.body.insertAdjacentHTML('beforeend', `
      <button type="button" class="hb-fab" id="helpbotButton" aria-label="Open the Connect2Minds helper" aria-expanded="false" aria-controls="helpbotPanel">${svg('chat', 26)}<span class="hb-fab-dot" hidden></span></button>
      <div class="hb-offer" id="hbOffer" hidden role="status"></div>
      <section class="hb-panel" id="helpbotPanel" role="dialog" aria-modal="false" aria-labelledby="hbTitle" hidden>
        <header class="hb-head">
          <span class="hb-avatar">${svg('spark', 22)}</span>
          <div class="hb-titles"><strong id="hbTitle">Helper</strong><small id="hbMode">Here to help you find your way</small></div>
          <button type="button" class="hb-icon" data-hb="menu" aria-label="Options" aria-haspopup="true" aria-expanded="false">${svg('more')}</button>
          <button type="button" class="hb-icon" data-hb="close" aria-label="Close the helper">${svg('close')}</button>
          <div class="hb-menu" id="hbMenu" hidden>
            <label class="hb-switch"><input type="checkbox" id="hbSpeak"> Read answers aloud</label>
            <label class="hb-row">Voice language
              <select id="hbLang"><option value="en-IN">English (India)</option><option value="hi-IN">हिन्दी (Hindi)</option></select></label>
            <p class="hb-note" id="hbVoiceNote" hidden>Talking needs Chrome, Edge or Safari. You can still type.</p>
            <button type="button" data-hb="tour">Start the tour</button>
            <button type="button" data-hb="clear">Clear this chat</button>
          </div>
        </header>
        <div class="hb-log" id="hbLog" role="log" aria-live="polite" aria-relevant="additions"></div>
        <div class="hb-chips" id="hbChips"></div>
        <p class="hb-listening" id="hbListening" hidden><span class="hb-pulse"></span><span id="hbInterim">Listening…</span></p>
        <form class="hb-input" id="hbForm">
          <button type="button" class="hb-mic" data-hb="mic" aria-label="Speak your question" aria-pressed="false">${svg('mic')}</button>
          <textarea id="hbText" rows="1" maxlength="600" placeholder="Ask anything about the site…" aria-label="Your question"></textarea>
          <button type="submit" class="hb-send" aria-label="Send">${svg('send')}</button>
        </form>
      </section>
      <div class="hb-spot" id="hbSpot" hidden></div>
      <div class="hb-tip" id="hbTip" hidden role="dialog" aria-live="polite"></div>`);

    document.body.classList.add('has-helpbot');
    if (/^(inbox|team)\.html$/.test(PAGE)) document.body.classList.add('hb-raise');
    $('#helpbotButton').addEventListener('click', () => toggle());
    $('#helpbotPanel').addEventListener('click', onPanelClick);
    $('#hbForm').addEventListener('submit', (e) => { e.preventDefault(); sendTyped(); });
    $('#hbText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTyped(); } });
    $('#hbText').addEventListener('input', (e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; });
    $('#hbSpeak').addEventListener('change', (e) => { settings.speak = e.target.checked; save(`${STORE}:settings`, settings); if (!settings.speak) stopSpeaking(); });
    $('#hbLang').addEventListener('change', (e) => { settings.lang = e.target.value; save(`${STORE}:settings`, settings); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#hbTip').hidden) return endSpotlight();
      if (!$('#helpbotPanel').hidden) toggle(false);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#hbMenu, [data-hb="menu"]')) closeMenu();
    });
    if (!speechInput()) { $('[data-hb="mic"]').hidden = true; $('#hbVoiceNote').hidden = false; }
  }

  function toggle(open) {
    const panel = $('#helpbotPanel');
    const show = open === undefined ? panel.hidden : open;
    panel.hidden = !show;
    $('#helpbotButton').setAttribute('aria-expanded', String(show));
    $('#helpbotButton').classList.toggle('is-open', show);
    $('#hbOffer').hidden = true;
    if (show) {
      ensureKnowledge().then(() => {
        if (!history.length) greet();
        render();
        paintChips();
        $('#hbText').focus();
      });
      checkAI();
    } else {
      stopListening();
      stopSpeaking();
      $('#helpbotButton').focus();
    }
  }

  function closeMenu() {
    const menu = $('#hbMenu');
    if (menu && !menu.hidden) { menu.hidden = true; $('[data-hb="menu"]').setAttribute('aria-expanded', 'false'); }
  }

  function onPanelClick(e) {
    const hb = e.target.closest('[data-hb]');
    if (hb) {
      const what = hb.dataset.hb;
      if (what === 'close') return toggle(false);
      if (what === 'menu') { const m = $('#hbMenu'); m.hidden = !m.hidden; hb.setAttribute('aria-expanded', String(!m.hidden)); return; }
      if (what === 'mic') return listening() ? stopListening() : startListening();
      if (what === 'tour') { closeMenu(); return startTour(); }
      if (what === 'clear') { closeMenu(); history = []; persist(); greet(); render(); return; }
    }
    const chip = e.target.closest('[data-ask]');
    if (chip) return ask(chip.dataset.ask);
    const go = e.target.closest('[data-go]');
    if (go) return goToArticle(go.dataset.go, go.dataset.show === '1');
    const link = e.target.closest('[data-href]');
    if (link) { location.href = link.dataset.href; return; }
    const card = e.target.closest('[data-card]');
    if (card) return answerCard(parseInt(card.dataset.msg, 10), card.dataset.card);
    const pick = e.target.closest('[data-pick]');
    if (pick) return pickChoice(parseInt(pick.dataset.msg, 10), parseInt(pick.dataset.pick, 10));
  }

  // ==========================================
  // 2. MESSAGES
  // ==========================================
  function persist() {
    history = history.slice(-MAX_HISTORY);
    save(STORE, history);
  }

  function addBot(text, extras = {}) {
    const message = { role: 'bot', text, ...extras, at: Date.now() };
    history.push(message);
    persist();
    render();
    if (settings.speak || spokeLast) speak(text);
    return message;
  }

  function addUser(text) {
    history.push({ role: 'user', text, at: Date.now() });
    persist();
    render();
  }

  function formatText(text) {
    let html = esc(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[([^\]]+)\]\(((?:https?:\/\/|[a-z_-]+\.html)[^\s)]*)\)/g, (m, label, url) => `<a href="${url}"${url.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`);
    html = html.replace(/(^|\n)[-•] (.+)/g, '$1<span class="hb-li">• $2</span>');
    return html.replace(/\n/g, '<br>');
  }

  function render() {
    const log = $('#hbLog');
    if (!log) return;
    log.innerHTML = history.map((m, i) => {
      if (m.role === 'user') return `<div class="hb-msg is-user"><p>${esc(m.text)}</p></div>`;
      const buttons = (m.buttons || []).map(b => b.go
        ? `<button type="button" class="hb-btn" data-go="${esc(b.go)}" data-show="${b.show ? 1 : 0}">${svg(b.show ? 'eye' : 'arrow', 16)}${esc(b.label)}</button>`
        : `<button type="button" class="hb-btn" data-href="${esc(b.href)}">${svg('arrow', 16)}${esc(b.label)}</button>`).join('');
      const choices = (m.choices || []).map((c, j) => `<button type="button" class="hb-chip" data-msg="${i}" data-pick="${j}">${esc(c.label)}</button>`).join('');
      const card = m.card ? cardHtml(m.card, i) : '';
      return `<div class="hb-msg is-bot${m.streaming ? ' is-streaming' : ''}"><p>${formatText(m.text)}${m.streaming ? '<span class="hb-caret"></span>' : ''}</p>
        ${buttons ? `<div class="hb-btns">${buttons}</div>` : ''}${choices ? `<div class="hb-choices">${choices}</div>` : ''}${card}</div>`;
    }).join('') + (busy && !history.some(m => m.streaming) ? '<div class="hb-msg is-bot"><p class="hb-typing"><span></span><span></span><span></span></p></div>' : '');
    log.scrollTop = log.scrollHeight;
  }

  function greet() {
    const name = (() => { try { return (JSON.parse(localStorage.getItem(`c2m:${UID}:me`)) || {}).name || ''; } catch (e) { return ''; } })();
    const first = name ? name.split(' ')[0] : '';
    history.push({ role: 'bot', at: Date.now(), text: MEMBER
      ? `Hi${first ? ' ' + first : ''}! I can explain anything on Connect2Minds, take you to the right page, tell you what's due, your attendance or unread messages, and add tasks for you. Type or press the mic.`
      : 'Hi! I can tell you what Connect2Minds does and help you get started. Ask me anything, or take a quick tour.' });
    persist();
  }

  function paintChips() {
    const box = $('#hbChips');
    if (!box || !kb) return;
    const here = kb.articles.filter(a => a.page.split('?')[0] === PAGE && allowed(a)).slice(0, 2).map(a => a.title);
    const general = MEMBER ? ["What's due this week?", 'My attendance', 'What can you do?'] : ['What is Connect2Minds?', 'How do I sign up?', 'Take the tour'];
    const chips = [...new Set(here.concat(general))].slice(0, 4);
    box.innerHTML = chips.map(c => `<button type="button" class="hb-chip" data-ask="${esc(c)}">${esc(c)}</button>`).join('');
  }

  function allowed(article) {
    if (article.audience === 'visitor') return !MEMBER;
    return true;
  }

  // ==========================================
  // 3. ASKING
  // ==========================================
  function sendTyped() {
    const box = $('#hbText');
    const text = box.value.trim();
    if (!text || busy) return;
    box.value = '';
    box.style.height = 'auto';
    spokeLast = false;
    ask(text);
  }

  async function ask(text) {
    if (busy) return;
    await ensureKnowledge();
    addUser(text);
    busy = true;
    render();
    try {
      // The built-in commands that change things or need exact data are run here even in AI mode only when AI is off;
      // with AI on, Claude uses its tools and the same confirm cards.
      if (ai === null) await checkAI();
      if (ai && await aiAnswer(text)) return;
      await builtinAnswer(text);
    } catch (err) {
      addBot(err.message || 'Something went wrong. Please try again.');
    } finally {
      busy = false;
      render();
      paintChips();
    }
  }

  async function ensureKnowledge() {
    if (kb) return kb;
    try {
      const res = await fetch('helpbot_kb.json', { cache: 'no-cache' });
      kb = await res.json();
    } catch (e) {
      kb = { articles: [], tour: {} };
    }
    kb.articles.forEach(a => {
      a._phrases = a.keywords.map(k => stem(norm(k)));
      a._tokens = new Set(a._phrases.flatMap(p => p.split(' ')).concat(stem(norm(a.title)).split(' ')).filter(t => t.length > 2 && !STOP.has(t)));
    });
    kb._vocab = [...new Set(kb.articles.flatMap(a => [...a._tokens]))];
    return kb;
  }

  async function checkAI() {
    if (ai !== null) return ai;
    const cached = sessionStorage.getItem('helpbotAI');
    if (cached) { const [value, at] = cached.split('|'); if (Date.now() - Number(at) < 600000) { ai = value === '1'; paintMode(); return ai; } }
    try { ai = !!(await call('/api/helpbot/status')).ai; } catch (e) { ai = false; }
    try { sessionStorage.setItem('helpbotAI', `${ai ? 1 : 0}|${Date.now()}`); } catch (e) { /* off */ }
    paintMode();
    return ai;
  }

  function paintMode() {
    const mode = $('#hbMode');
    if (mode) mode.textContent = ai ? 'AI helper · answers may not be perfect' : 'Here to help you find your way';
  }

  // ==========================================
  // 4. THE BUILT-IN GUIDE
  // ==========================================
  const STOP = new Set(['the', 'and', 'for', 'how', 'can', 'what', 'where', 'does', 'this', 'that', 'with', 'you', 'your', 'are', 'there', 'want', 'need', 'please', 'tell', 'about', 'from', 'into', 'have', 'which', 'when', 'will', 'should', 'would', 'could', 'some', 'any', 'get', 'use', 'using', 'make', 'way', 'site', 'website', 'page']);
  const HINGLISH = [[/\bkaise\b/g, 'how'], [/\bkahan\b|\bkaha\b/g, 'where'], [/\bkya\b/g, 'what'], [/\bmera\b|\bmeri\b|\bmere\b/g, 'my'], [/\bkitna\b|\bkitni\b|\bkitne\b/g, 'how many'],
    [/\bkarna\b|\bkaru\b|\bkaro\b|\bkarein\b/g, 'do'], [/\bbanana\b|\bbanao\b|\bbanau\b/g, 'make'], [/\bdhundh\w*\b|\bdhoond\w*\b/g, 'find'], [/\bbatao\b|\bbataiye\b/g, 'tell'],
    [/\bhazri\b|\bhaziri\b/g, 'attendance'], [/\bpadhai\b/g, 'study'], [/\bnaukri\b/g, 'job'], [/\bdost\b/g, 'friend'], [/\bmadad\b/g, 'help'], [/\bkhata\b/g, 'account'], [/\bhatao\b|\bmitao\b/g, 'delete']];
  const SYNONYMS = { 'pwd': 'password', 'pass': 'password', 'msg': 'message', 'msgs': 'messages', 'dp': 'profile picture', 'pic': 'picture', 'ppt': 'ppt', 'hw': 'homework', 'asap': '', 'pls': '', 'plz': '', 'u': 'you', 'ur': 'your', 'r': 'are', 'acc': 'account', 'accnt': 'account', 'att': 'attendance', 'atten': 'attendance', 'proj': 'project', 'teammates': 'teammate', 'yaar': '', 'bhai': '' };

  function norm(text) {
    let t = ` ${String(text).toLowerCase().replace(/[’']/g, "'")} `;
    HINGLISH.forEach(([re, to]) => { t = t.replace(re, to); });
    t = t.replace(/[^a-z0-9%#+@&.' ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return t.split(' ').map(w => (w in SYNONYMS ? SYNONYMS[w] : w)).filter(Boolean).join(' ');
  }

  function close(a, b) {
    // Damerau-free edit distance within 1 (one typo)
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  // "doctors" -> "doctor" on both sides, so only matching sees it (commands keep the plain words)
  function stem(text) {
    return text.split(' ').map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
  }

  // A word with one typo becomes the known word it is closest to ("projet" -> "project")
  function fixTypos(text) {
    return text.split(' ').map(w => {
      if (w.length < 5 || kb._vocab.includes(w)) return w;
      return kb._vocab.find(k => k.length >= 5 && close(w, k)) || w;
    }).join(' ');
  }

  function rank(question) {
    const q = fixTypos(stem(norm(question)));
    const padded = ` ${q} `;
    const tokens = q.split(' ').filter(t => t.length > 2 && !STOP.has(t));
    return kb.articles.filter(allowed).map(a => {
      let score = 0;
      a._phrases.forEach(p => { if (p && padded.includes(` ${p} `)) score += 2 + p.split(' ').length * 1.2; });
      tokens.forEach(t => {
        if (a._tokens.has(t)) score += 1;
        else if (t.length >= 5 && [...a._tokens].some(k => k.length >= 5 && close(t, k))) score += 0.6;
      });
      if (a.page.split('?')[0] === PAGE) score += 0.2;
      return { a, score };
    }).filter(x => x.score > 0).sort((x, y) => y.score - x.score);
  }

  async function builtinAnswer(text) {
    const command = matchCommand(text);
    if (command) return command();
    const ranked = rank(text);
    const best = ranked[0];
    if (best && best.score >= 2.4 && (!ranked[1] || best.score - ranked[1].score >= 0.6 || best.score >= 4.5)) return answerArticle(best.a);
    if (best && best.score >= 1.2) {
      return addBot(`Here's what I think you mean. Pick one:`, { choices: ranked.slice(0, 3).map(r => ({ label: r.a.title, article: r.a.id })).concat([{ label: 'None of these: ask Support', support: text }]) });
    }
    addBot("I'm not sure about that one. You can rephrase it, pick a topic below, or ask the Support team.",
      { choices: [{ label: 'What can you do?', ask: 'What can you do?' }, { label: 'Ask Support', support: text }] });
  }

  function answerArticle(article) {
    const needsLogin = !MEMBER && article.audience === 'member' && !MEMBER_PAGES_FREE.includes(article.page.split('?')[0]);
    const buttons = needsLogin
      ? [{ label: 'Sign up free', href: 'register.html' }, { label: 'Log in', href: 'login.html' }]
      : [{ label: article.page.split('?')[0] === PAGE && article.highlight ? 'Show me' : `Take me there`, go: article.id, show: !!article.highlight }];
    if (article.id === 'tour') return addBot(article.answer, { choices: [{ label: 'Start the tour', tour: true }] });
    addBot(article.answer + (needsLogin ? '\n\nYou need a free account for this.' : ''), { buttons, article: article.id });
  }

  function pickChoice(msgIndex, choiceIndex) {
    const message = history[msgIndex];
    const choice = message && message.choices && message.choices[choiceIndex];
    if (!choice) return;
    if (choice.article) { addUser(choice.label); return answerArticle(kb.articles.find(a => a.id === choice.article)); }
    if (choice.ask) return ask(choice.ask);
    if (choice.tour) return startTour();
    if (choice.support !== undefined) { location.href = `support.html?about=${encodeURIComponent(choice.support.slice(0, 300))}`; return; }
    if (choice.run) return choice.run();     // only for live (unsaved) choices
    if (choice.card) return addBot(choice.cardText || 'Please confirm:', { card: choice.card });
  }

  // ---------- commands: look-ups and small jobs (members) ----------
  function matchCommand(text) {
    const q = norm(text);
    if (/^(hi+|hello|hey|namaste|good (morning|afternoon|evening)|hola)\b/.test(q) && q.split(' ').length <= 3) {
      return () => addBot(MEMBER ? 'Hello! What would you like to do?' : 'Hello! Want to know what Connect2Minds is, or how to sign up?');
    }
    if (/^(thanks|thank you|thx|ty|shukriya|dhanyavad)\b/.test(q)) return () => addBot("You're welcome! I'm here whenever you need me.");
    if (/\b(take the tour|start the tour|show me around|walk ?through|give me a tour|tour)\b/.test(q) && q.split(' ').length <= 6) return () => { addBot("Let's go! Follow the highlights and press Next."); startTour(); };
    if (!MEMBER) {
      if (/\b(my|me)\b.*\b(attendance|due|deadline|messages|unread|tasks|classes)\b/.test(q)) {
        return () => addBot('Log in to see your own things here. New to Connect2Minds? Sign up in a minute.', { buttons: [{ label: 'Log in', href: 'login.html' }, { label: 'Sign up free', href: 'register.html' }] });
      }
      return null;
    }
    // A question about HOW something works is answered with its article, not run as a command
    if (/^(how|where|why|can i|is|are|which)\b/.test(q) && !/\b(how many classes|who knows)\b/.test(q)) return null;
    // small jobs first: they also mention words like "attendance" and "task"
    if (/\b(start|begin)\b.*\btimer\b/.test(q)) return () => proposeTimer(true);
    if (/\b(stop|end|pause)\b.*\btimer\b/.test(q)) return () => proposeTimer(false);
    let m = /\bmark (?:me |my )?(?:as )?(present|absent|cancelled|cancel)\b(?:.*?\b(?:in|for|of)\b)?\s*(.*)$/.exec(q) || /\bmark (?:my )?attendance\b(?:.*?\b(?:in|for|of)\b)?\s*(.*)$/.exec(q);
    if (m) {
      const status = m.length === 3 ? (m[1] === 'cancel' ? 'cancelled' : m[1]) : 'present';
      const subject = (m.length === 3 ? m[2] : m[1]).replace(/\b(today|class|lecture|please)\b/g, '').trim();
      return () => proposeAttendance(subject, status);
    }
    if ((m = /\b(?:create|add|new|make)\b (?:a |an )?project task\b\s*(.*)$/.exec(q))) return () => proposeProjectTask(text, m[1]);
    if ((m = /\b(?:add|create|new|make|remind me|set)\b (?:a |an |me )?(?:to ?do|task|assignment|exam|test|reminder|homework)\b\s*(.*)$/.exec(q))
        && !/^(an? )?(assignment|exam|task|deadline|reminder)?\s*(deadline|date)?\s*(to|in|into) (the |my )?planner$/.test(m[1])) return () => proposeStudyTask(text);
    if (/^remind me (to|about)\b/.test(q)) return () => proposeStudyTask(text);
    // look-ups
    if ((/\b(due|deadlines?|pending (work|tasks|assignments)|to submit)\b/.test(q) && !/\b(calendar|planner|where)\b/.test(q)) || /\bwhat (do i have|is) (this|next) week\b/.test(q)) return lookupDue;
    if (/\b(attendance|bunk|classes can i miss|classes can i skip|how many classes)\b/.test(q) && !/\bhow (do|to|can) i (mark|track|add)\b/.test(q)) {
      const sm = /\b(?:in|for|of)\s+([a-z0-9 &.+-]{2,40})$/.exec(q);
      return () => lookupAttendance(sm ? sm[1].replace(/\b(subject|class|please)\b/g, '').trim() : '');
    }
    if (/\b(next class|classes today|today'?s classes|lectures? today|my timetable today|class today|next lecture)\b/.test(q)) return lookupClasses;
    if (/\b(unread|new messages|any messages|who messaged|messages do i have|did anyone message)\b/.test(q)) return lookupUnread;
    if (/\bmy (project )?tasks\b|\bassigned to me\b|\bmy work in (project hub|teams)\b/.test(q)) return lookupProjectTasks;
    if ((m = /\b(?:find|search for|search|looking for|who knows|anyone who knows|people (?:who know|with|good at)|someone (?:who knows|good at|with)|teammates? (?:who know|with|for))\b\s+(?:people |someone |a |an )?(?:who know|with|good at|skilled in|for|in)?\s*([a-z0-9+#. ]{1,30})$/.exec(q))) {
      const skill = m[1].replace(/\b(skills?|people|developers?|experts?|in|at|college|please|by)\b/g, '').trim();
      const generic = /^(people|someone|teammates?|members?|mentors?|my|my project|a project|project|team|jobs?|internships?|opportunit\w*)$/;
      if (skill && !generic.test(skill)) return () => findPeople(skill);
    }
    return null;
  }

  async function study() { return call('/api/study'); }

  async function lookupDue() {
    const data = await study();
    const until = isoOf(new Date(Date.now() + 7 * 86400000));
    const names = Object.fromEntries(data.subjects.map(s => [s.id, s.name]));
    const items = data.tasks.filter(t => !t.done && t.due_date && t.due_date <= until)
      .map(t => ({ when: t.due_date, text: `${t.title}${t.subject_id && names[t.subject_id] ? ` (${names[t.subject_id]})` : ''}`, late: t.due_date < data.today }))
      .concat((data.hub_deadlines || []).filter(d => d.due && d.due <= until).map(d => ({ when: d.due, text: `${d.title} (College Hub)`, late: d.due < data.today })))
      .sort((a, b) => a.when.localeCompare(b.when));
    if (!items.length) return addBot('Nothing is due in the next 7 days. 🎉 Add assignments and exams in My Study → Planner so I can remind you.', { buttons: [{ label: 'Open the Planner', go: 'planner' }] });
    addBot(`Due in the next 7 days:\n${items.slice(0, 10).map(i => `- **${niceDay(i.when)}**${i.late ? ' (late)' : ''}: ${i.text}`).join('\n')}${items.length > 10 ? `\n…and ${items.length - 10} more.` : ''}`,
      { buttons: [{ label: 'Open the Planner', go: 'planner' }] });
  }

  function attendanceLine(s) {
    const present = s.base_attended + s.present;
    const total = s.base_total + s.present + s.absent;
    if (!total) return `- **${s.name}**: no classes marked yet.`;
    const percent = Math.round(present * 100 / total);
    let advice;
    if (present * 100 >= s.goal * total) {
      const canMiss = Math.floor((present * 100 - s.goal * total) / s.goal);
      advice = canMiss ? `you can miss ${canMiss} more and stay at ${s.goal}%` : `right on ${s.goal}%, don't miss the next one`;
    } else {
      const need = s.goal < 100 ? Math.ceil((s.goal * total - present * 100) / (100 - s.goal)) : null;
      advice = need === null ? `${s.goal}% can no longer be reached` : `attend the next ${need} to get back to ${s.goal}%`;
    }
    return `- **${s.name}**: ${percent}% (${present}/${total}), ${advice}.`;
  }

  async function lookupAttendance(subject) {
    const data = await study();
    let subjects = data.subjects.filter(s => !s.archived);
    if (!subjects.length) return addBot("You haven't added subjects yet. Add them in My Study → Timetable, then mark classes in Attendance.", { buttons: [{ label: 'Set up my timetable', go: 'timetable' }] });
    if (subject) {
      const match = subjects.filter(s => s.name.toLowerCase().includes(subject) || (s.code || '').toLowerCase() === subject);
      if (match.length) subjects = match;
    }
    addBot(`Your attendance:\n${subjects.map(attendanceLine).join('\n')}`, { buttons: [{ label: 'Open Attendance', go: 'attendance' }] });
  }

  async function lookupClasses() {
    const data = await study();
    const names = Object.fromEntries(data.subjects.map(s => [s.id, s.name]));
    const today = data.slots.filter(s => s.weekday === data.weekday).sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (!today.length) return addBot(data.slots.length ? 'No classes today on your timetable. 🙂' : "Your timetable is empty. Add your classes in My Study → Timetable (or import your class timetable if a teacher published it).",
      { buttons: [{ label: 'Open the Timetable', go: 'timetable' }] });
    const next = today.find(s => s.start_time > data.now);
    addBot(`${next ? `Next: **${names[next.subject_id] || 'Class'}** at ${next.start_time}${next.room ? ` in ${next.room}` : ''}.\n\n` : 'No more classes today.\n\n'}Today:\n${today.map(s => `- ${s.start_time}–${s.end_time} ${names[s.subject_id] || 'Class'}${s.room ? ` (${s.room})` : ''}`).join('\n')}`,
      { buttons: [{ label: 'Open My Study', go: 'study' }] });
  }

  async function lookupUnread() {
    const list = await call('/api/conversations');
    const unread = list.filter(c => c.unread > 0 && !c.archived);
    if (!unread.length) return addBot('No unread messages. You are all caught up.', { buttons: [{ label: 'Open Messages', href: 'inbox.html' }] });
    const total = unread.reduce((sum, c) => sum + c.unread, 0);
    addBot(`You have ${total} unread message${total === 1 ? '' : 's'}:\n${unread.slice(0, 8).map(c => `- **${c.name}**: ${c.unread}`).join('\n')}`,
      { buttons: unread.slice(0, 3).map(c => ({ label: `Open ${c.name.split(' ')[0]}`, href: `inbox.html?user=${c.id}` })) });
  }

  async function lookupProjectTasks() {
    const teams = await call('/api/teams');
    if (!teams.length) return addBot("You're not in any team yet. Create or join one in My Teams; each team gets a Project Hub.", { buttons: [{ label: 'Open My Teams', href: 'team.html' }] });
    const boards = await Promise.all(teams.slice(0, 6).map(t => call(`/api/teams/${t.id}/board`).then(b => ({ t, b })).catch(() => null)));
    const tasks = boards.filter(Boolean).flatMap(({ t, b }) => b.tasks.filter(x => x.assignee_id === UID && x.column !== 'done').map(x => ({ ...x, team: t })))
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    if (!tasks.length) return addBot('No open Project Hub tasks are assigned to you right now.', { buttons: [{ label: 'Open Project Hub', go: 'project-hub' }] });
    addBot(`Your open project tasks:\n${tasks.slice(0, 10).map(x => `- ${x.title} (${x.team.name})${x.due_date ? `, due **${niceDay(x.due_date)}**` : ''}`).join('\n')}`,
      { buttons: [{ label: 'Open Project Hub', href: `project_management.html?team=${tasks[0].team.id}&tab=list` }] });
  }

  async function findPeople(skill) {
    const data = await call('/api/discover');
    const wanted = skill.toLowerCase();
    const people = data.people.filter(p => (p.skills || '').toLowerCase().split(',').some(s => s.trim().includes(wanted)));
    if (!people.length) return addBot(`I couldn't find anyone listing “${skill}”. Try a related skill, or search on Discover.`, { buttons: [{ label: 'Open Discover', go: 'discover' }] });
    addBot(`${people.length} ${people.length === 1 ? 'person lists' : 'people list'} “${skill}”:\n${people.slice(0, 5).map(p => `- **${p.name}**${p.college_name ? `, ${p.college_name}` : ''}`).join('\n')}`,
      { buttons: people.slice(0, 3).map(p => ({ label: p.name.split(' ')[0], href: `profile.html?id=${p.id}` })).concat([{ label: 'See all on Discover', href: `search.html` }]) });
  }

  // ---------- dates in plain words ----------
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function findDate(text) {
    const t = text.toLowerCase();
    const now = new Date();
    let m;
    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) return { iso: m[0], match: m[0] };
    if ((m = /\b(?:on |by |due |for )?(today|tonight|aaj)\b/.exec(t))) return { iso: todayIso(), match: m[0] };
    if ((m = /\b(?:on |by |due |for )?(tomorrow|tmrw|tmr|kal)\b/.exec(t))) return { iso: isoOf(new Date(Date.now() + 86400000)), match: m[0] };
    if ((m = /\b(?:on |by |due |for |next |this )*(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?\b/.exec(t))) {
      const want = WEEKDAYS.findIndex(d => d.startsWith(m[1].slice(0, 3)));
      const d = new Date(now); let add = (want - d.getDay() + 7) % 7 || 7;
      if (/\bnext\b/.test(m[0]) && add < 7) add += 0;
      d.setDate(d.getDate() + add);
      return { iso: isoOf(d), match: m[0] };
    }
    if ((m = /\b(?:on |by |due |for )?(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(t))) {
      let d = new Date(now.getFullYear(), MONTHS.indexOf(m[2]), parseInt(m[1], 10));
      if (d < new Date(now.toDateString())) d = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
      return { iso: isoOf(d), match: m[0] };
    }
    if ((m = /\b(?:on |by |due |for )?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(t))) {
      const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : now.getFullYear();
      const d = new Date(year, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
      if (!isNaN(d)) return { iso: isoOf(d), match: m[0] };
    }
    if ((m = /\b(?:in|after) (\d{1,2}) days?\b/.exec(t))) return { iso: isoOf(new Date(Date.now() + parseInt(m[1], 10) * 86400000)), match: m[0] };
    return null;
  }

  function cleanTitle(text, date) {
    let t = text;
    if (date) t = t.replace(new RegExp(date.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
    t = t.replace(/^\s*(please\s+)?(add|create|new|make|remind me( to| about)?|set)\s+(a |an |me )?(project )?(to ?do|task|assignment|exam|test|reminder|homework)?\s*(called|named|titled|for|to|:|-)?\s*/i, '');
    t = t.replace(/\s+(due|by|on|for)\s*$/i, '').replace(/\s+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ---------- small jobs: always a card to confirm ----------
  function proposeStudyTask(text) {
    const date = findDate(text);
    const kind = /\bexam\b|\btest\b/i.test(text) ? 'exam' : /\bassignment\b|\bhomework\b/i.test(text) ? 'assignment' : 'todo';
    const title = cleanTitle(text, date);
    if (!title) return addBot('What should the task be called? For example: “add assignment DBMS report by Friday”.');
    addBot('Shall I add this to your My Study planner?', { card: { type: 'add_study_task', title, kind, due_date: date ? date.iso : '', state: 'pending' } });
  }

  async function proposeAttendance(subjectWords, status) {
    const data = await study();
    const subjects = data.subjects.filter(s => !s.archived);
    if (!subjects.length) return addBot('Add your subjects in My Study → Timetable first.', { buttons: [{ label: 'Set up my timetable', go: 'timetable' }] });
    let match = subjectWords ? subjects.filter(s => s.name.toLowerCase().includes(subjectWords) || subjectWords.includes(s.name.toLowerCase()) || (s.code || '').toLowerCase() === subjectWords) : [];
    const todays = data.slots.filter(s => s.weekday === data.weekday);
    if (!match.length && !subjectWords && todays.length === 1) match = subjects.filter(s => s.id === todays[0].subject_id);
    if (match.length !== 1) {
      const options = (match.length ? match : subjects).slice(0, 8);
      return addBot(`Which subject should I mark ${status}?`, { choices: options.map(s => ({ label: s.name, card: attendanceCard(s, status, data, todays), cardText: `Mark **${status}** for ${s.name} today?` })) });
    }
    addBot(`Mark **${status}** for ${match[0].name} today?`, { card: attendanceCard(match[0], status, data, todays) });
  }

  function attendanceCard(subject, status, data, todays) {
    const slot = todays.find(s => s.subject_id === subject.id);
    return { type: 'mark_attendance', subject_id: subject.id, subject: subject.name, status, date: data.today, slot_id: slot ? slot.id : 0, state: 'pending' };
  }

  async function chooseTeam(intro, makeCard) {
    const teams = await call('/api/teams');
    if (!teams.length) return addBot("You're not in any team yet. Create one in My Teams first.", { buttons: [{ label: 'Open My Teams', href: 'team.html' }] });
    let current = null;
    // Project Hub remembers the workspace last opened (its own variables are not reachable from here)
    try { current = JSON.parse(localStorage.getItem(`c2m:${UID}:hub-last-team`)); } catch (e) { /* none */ }
    const preferred = teams.find(t => t.id === current);
    if (teams.length === 1 || (preferred && PAGE === 'project_management.html')) {
      const team = preferred || teams[0];
      return addBot(intro(team), { card: makeCard(team) });
    }
    addBot('Which team?', { choices: teams.slice(0, 8).map(t => ({ label: t.name, card: makeCard(t), cardText: intro(t) })) });
  }

  function proposeTimer(start) {
    if (!start) return addBot('Stop your running timer and log the time?', { card: { type: 'stop_timer', state: 'pending' } });
    return chooseTeam(t => `Start a timer in **${t.name}**? It shows in Project Hub's header and logs the time when you stop it.`,
      t => ({ type: 'start_timer', team_id: t.id, team: t.name, state: 'pending' }));
  }

  function proposeProjectTask(text) {
    const date = findDate(text);
    const title = cleanTitle(text, date);
    if (!title) return addBot('What should the task be called? For example: “create project task design the login screen by Monday”.');
    return chooseTeam(t => `Add this task to **${t.name}**'s Project Hub?`, t => ({ type: 'create_project_task', team_id: t.id, team: t.name, title, due_date: date ? date.iso : '', state: 'pending' }));
  }

  function cardHtml(card, msgIndex) {
    const rows = {
      add_study_task: () => [['Task', card.title], ['Type', card.kind || 'todo'], ['Due', card.due_date ? niceDay(card.due_date) : 'no date'], card.subject ? ['Subject', card.subject] : null],
      mark_attendance: () => [['Subject', card.subject], ['Mark', card.status], ['Day', niceDay(card.date)]],
      start_timer: () => [['Team', card.team], ['Starts', 'now']],
      stop_timer: () => [['Timer', 'your running timer']],
      create_project_task: () => [['Task', card.title], ['Team', card.team], ['Due', card.due_date ? niceDay(card.due_date) : 'no date']],
    }[card.type];
    const lines = rows ? rows().filter(Boolean) : [];
    const state = card.state === 'done' ? `<p class="hb-card-state is-done">✓ ${esc(card.result || 'Done')}</p>`
      : card.state === 'cancelled' ? '<p class="hb-card-state">Cancelled. Nothing was changed.</p>'
      : card.state === 'error' ? `<p class="hb-card-state is-error">${esc(card.result)}</p>` : '';
    return `<div class="hb-card"><dl>${lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${card.state === 'pending' || card.state === 'error' ? `<div class="hb-card-btns"><button type="button" class="hb-btn is-primary" data-card="confirm" data-msg="${msgIndex}">Confirm</button>
      <button type="button" class="hb-btn" data-card="cancel" data-msg="${msgIndex}">Cancel</button></div>` : ''}${state}</div>`;
  }

  async function answerCard(msgIndex, choice) {
    const message = history[msgIndex];
    if (!message || !message.card || (message.card.state !== 'pending' && message.card.state !== 'error')) return;
    const card = message.card;
    if (choice === 'cancel') { card.state = 'cancelled'; persist(); return render(); }
    card.state = 'working';
    render();
    try {
      card.result = await runCard(card);
      card.state = 'done';
      if (settings.speak || spokeLast) speak(card.result);
    } catch (err) {
      card.state = 'error';
      card.result = err.message;
    }
    persist();
    render();
  }

  async function runCard(card) {
    switch (card.type) {
      case 'add_study_task': {
        const body = { title: card.title.slice(0, 160), kind: ['assignment', 'exam', 'todo'].includes(card.kind) ? card.kind : 'todo', due_date: card.due_date || '' };
        if (card.subject_id) body.subject_id = card.subject_id;
        await call('/api/study/tasks', { method: 'POST', body });
        return `Added “${body.title}” to your planner${body.due_date ? `, due ${niceDay(body.due_date)}` : ''}.`;
      }
      case 'mark_attendance':
        await call('/api/study/attendance', { method: 'POST', body: { subject_id: card.subject_id, date: card.date, slot_id: card.slot_id || 0, status: card.status } });
        return `Marked ${card.status} for ${card.subject}.`;
      case 'start_timer':
        await call(`/api/teams/${card.team_id}/time/start`, { method: 'POST', body: { task_id: null } });
        return `Timer started in ${card.team}. Say “stop the timer” when you're done.`;
      case 'stop_timer': {
        const result = await call('/api/time/stop', { method: 'POST' });
        return result.stopped ? `Stopped. Logged ${result.stopped.minutes} minute${result.stopped.minutes === 1 ? '' : 's'}.` : 'No timer was running.';
      }
      case 'create_project_task': {
        const body = { title: card.title.slice(0, 160) };
        if (card.due_date) body.due_date = card.due_date;
        await call(`/api/teams/${card.team_id}/tasks`, { method: 'POST', body });
        return `Added “${body.title}” to ${card.team}'s board.`;
      }
    }
    throw new Error('I do not know how to do that.');
  }

  // Cards proposed by the AI name things (a subject, a team); the browser finds them before showing the card
  async function cardFromAI(action) {
    const type = action.type;
    if (type === 'add_study_task') {
      const card = { type, title: action.title || '', kind: 'todo', due_date: action.due_date || '', state: 'pending' };
      if (action.subject) {
        const data = await study();
        const s = data.subjects.find(x => x.name.toLowerCase().includes(action.subject.toLowerCase()));
        if (s) { card.subject_id = s.id; card.subject = s.name; }
      }
      return addBot('Please confirm:', { card });
    }
    if (type === 'mark_attendance') return proposeAttendance((action.subject || '').toLowerCase(), ['present', 'absent', 'cancelled'].includes(action.status) ? action.status : 'present');
    if (type === 'stop_timer') return proposeTimer(false);
    const teams = await call('/api/teams');
    const named = action.team ? teams.find(t => t.name.toLowerCase().includes(action.team.toLowerCase())) : null;
    if (type === 'start_timer') {
      return named ? addBot(`Start a timer in **${named.name}**?`, { card: { type, team_id: named.id, team: named.name, state: 'pending' } }) : proposeTimer(true);
    }
    if (type === 'create_project_task') {
      const make = t => ({ type, team_id: t.id, team: t.name, title: action.title || '', due_date: action.due_date || '', state: 'pending' });
      return named ? addBot(`Add this task to **${named.name}**?`, { card: make(named) }) : chooseTeam(t => `Add this task to **${t.name}**?`, make);
    }
  }

  // ==========================================
  // 5. AI ANSWERS (streamed from the server)
  // ==========================================
  async function aiAnswer(question) {
    const turns = history.filter(m => (m.role === 'user' || m.role === 'bot') && m.text && !m.streaming).slice(-12)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }));
    let res;
    try {
      res = await fetch(`${API}/api/helpbot/chat`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: turns, page: PAGE }) });
    } catch (e) {
      return false;
    }
    if (!res.ok || !res.body) {
      if (res.status === 503) { ai = false; try { sessionStorage.setItem('helpbotAI', `0|${Date.now()}`); } catch (e) { /* off */ } paintMode(); }
      return false;                     // 429 (allowance used), 503, errors: the built-in guide answers
    }
    const message = { role: 'bot', text: '', streaming: true, buttons: [], at: Date.now() };
    history.push(message);
    const pending = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let failed = false;
    let lastPaint = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        if (!chunk.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(chunk.slice(6)); } catch (e) { continue; }
        if (event.type === 'text') message.text += event.text;
        else if (event.type === 'navigate') {
          const article = kb.articles.find(a => a.id === event.article);
          if (article && !message.buttons.some(b => b.go === article.id)) message.buttons.push({ label: article.page.split('?')[0] === PAGE && article.highlight ? `Show me: ${article.title}` : `Open ${article.title}`, go: article.id, show: !!article.highlight });
        } else if (event.type === 'action_card') pending.push(event.action);
        else if (event.type === 'error') failed = true;
      }
      if (Date.now() - lastPaint > 60) { render(); lastPaint = Date.now(); }
    }
    message.streaming = false;
    if (failed && !message.text.trim()) {
      history.splice(history.indexOf(message), 1);
      return false;
    }
    if (!message.buttons.length) delete message.buttons;
    persist();
    render();
    if ((settings.speak || spokeLast) && message.text) speak(message.text);
    for (const action of pending) { try { await cardFromAI(action); } catch (err) { addBot(err.message); } }
    return true;
  }

  // ==========================================
  // 6. TAKE ME THERE / SHOW ME
  // ==========================================
  function articleTarget(article) {
    const [path, query] = article.page.split('?');
    const tab = query ? new URLSearchParams(query).get('tab') : null;
    return { path, tab };
  }

  function goToArticle(id, show) {
    const article = kb && kb.articles.find(a => a.id === id);
    if (!article) return;
    const { path, tab } = articleTarget(article);
    const steps = (article.highlight || []).map(s => ({ sel: s.sel, text: s.text }));
    if (path === PAGE) {
      if (tab) switchTabHere(path, tab);
      if (steps.length) { toggle(false); setTimeout(() => spotlight(steps, 0), tab ? 500 : 50); }
      else addBot(`You're already on ${article.title}.`);
      return;
    }
    try { sessionStorage.setItem('helpbotPending', JSON.stringify({ steps: show || steps.length ? steps : [], at: Date.now(), page: path })); } catch (e) { /* off */ }
    location.href = article.page;
  }

  function switchTabHere(path, tab) {
    if (path === 'project_management.html' && typeof window.switchHubTab === 'function') return window.switchHubTab(tab);
    const button = document.querySelector(`#studyTabs [data-tab="${tab}"], #hubTabs [data-tab="${tab}"]`);
    if (button) button.click();
  }

  function visibleOf(selectorList) {
    for (const sel of selectorList.split(',').map(s => s.trim()).filter(Boolean)) {
      let nodes = [];
      try { nodes = [...document.querySelectorAll(sel)]; } catch (e) { continue; }
      const shown = nodes.find(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; });
      if (shown) return shown;
    }
    return null;
  }

  async function waitFor(sel, ms = 9000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const node = visibleOf(sel);
      if (node) return node;
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  }

  let spot = null;     // { steps, i, node, onDone }
  async function spotlight(steps, i, onDone) {
    const step = steps[i];
    if (!step) return endSpotlight();
    const node = await waitFor(step.sel, onDone ? 5000 : 9000);
    if (!node && !onDone) {
      // "Show me" on something not on screen right now (for example a chat that is not open): skip that step
      if (i + 1 < steps.length) return spotlight(steps, i + 1, onDone);
      return endSpotlight();
    }
    // A tour stop always shows its words; without its element (say, no teams yet) the tip sits in the middle
    spot = { steps, i, node, onDone };
    if (node) node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    const tip = $('#hbTip');
    const last = i === steps.length - 1;
    tip.innerHTML = `<p>${esc(step.text)}</p><div class="hb-tip-row"><span>${steps.length > 1 ? `${i + 1} of ${steps.length}` : ''}</span>
      ${i > 0 ? '<button type="button" class="hb-btn" data-tip="back">Back</button>' : ''}
      <button type="button" class="hb-btn is-primary" data-tip="next">${last ? (onDone ? 'Next' : 'Done') : 'Next'}</button>
      ${onDone ? '<button type="button" class="hb-btn" data-tip="skip">End tour</button>' : ''}</div>`;
    $('#hbSpot').hidden = !node;
    tip.hidden = false;
    placeSpot();
    setTimeout(placeSpot, 400);
    tip.querySelector('[data-tip="next"]').focus({ preventScroll: true });
  }

  function placeSpot() {
    if (!spot) return;
    if (!spot.node) {
      const tip = $('#hbTip');
      const tw = Math.min(340, window.innerWidth - 24);
      tip.style.width = `${tw}px`;
      tip.style.left = `${(window.innerWidth - tw) / 2}px`;
      tip.style.top = `${Math.max(12, (window.innerHeight - tip.offsetHeight) / 2)}px`;
      return;
    }
    const r = spot.node.getBoundingClientRect();
    const box = $('#hbSpot');
    box.style.left = `${r.left - 6}px`; box.style.top = `${r.top - 6}px`;
    box.style.width = `${r.width + 12}px`; box.style.height = `${r.height + 12}px`;
    const tip = $('#hbTip');
    const tw = Math.min(320, window.innerWidth - 24);
    tip.style.width = `${tw}px`;
    const below = r.bottom + 14 + tip.offsetHeight < window.innerHeight;
    tip.style.top = `${below ? r.bottom + 14 : Math.max(12, r.top - 14 - tip.offsetHeight)}px`;
    tip.style.left = `${Math.max(12, Math.min(window.innerWidth - tw - 12, r.left + r.width / 2 - tw / 2))}px`;
  }

  function endSpotlight() {
    spot = null;
    $('#hbSpot').hidden = true;
    $('#hbTip').hidden = true;
  }

  function onTipClick(e) {
    const b = e.target.closest('[data-tip]');
    if (!b || !spot) return;
    const { steps, i, onDone } = spot;
    if (b.dataset.tip === 'back') return spotlight(steps, i - 1, onDone);
    if (b.dataset.tip === 'skip') { endSpotlight(); return endTour(); }
    if (i + 1 < steps.length) return spotlight(steps, i + 1, onDone);
    endSpotlight();
    if (onDone) onDone();
  }

  // ==========================================
  // 7. THE TOUR
  // ==========================================
  function tourSteps() {
    return (kb && kb.tour && kb.tour[MEMBER ? 'member' : 'visitor']) || [];
  }

  async function startTour() {
    await ensureKnowledge();
    toggle(false);
    save(`c2m:${UID || 'guest'}:helpbotTourOffered`, true);
    runTour(0);
  }

  function runTour(i) {
    const steps = tourSteps();
    if (i >= steps.length) return endTour(true);
    const step = steps[i];
    if (step.page !== PAGE) {
      try { sessionStorage.setItem('helpbotTour', JSON.stringify({ i, at: Date.now() })); } catch (e) { /* off */ }
      location.href = step.page;
      return;
    }
    try { sessionStorage.setItem('helpbotTour', JSON.stringify({ i, at: Date.now() })); } catch (e) { /* off */ }
    spotlight([{ sel: step.sel, text: step.text }], 0, () => runTour(i + 1));
    const tipRow = $('#hbTip .hb-tip-row span');
    if (tipRow) tipRow.textContent = `${i + 1} of ${steps.length}`;
  }

  function endTour(finished) {
    try { sessionStorage.removeItem('helpbotTour'); } catch (e) { /* off */ }
    if (finished) {
      toggle(true);
      setTimeout(() => addBot("That's the tour! Ask me anything, any time, from the round button. Try “what's due this week?”"), 300);
    }
  }

  function offerTour() {
    const key = `c2m:${UID || 'guest'}:helpbotTourOffered`;
    if (load(key, false)) return;
    if (!(MEMBER ? PAGE === 'home.html' : PAGE === 'index.html')) return;
    // The cookie banner comes first; the offer follows once it is answered
    if (window.CookieConsent && !window.CookieConsent.chosen()) {
      document.addEventListener('cookieconsent', offerTour, { once: true });
      return;
    }
    setTimeout(() => {
      if (!$('#helpbotPanel').hidden || load(key, false)) return;
      const offer = $('#hbOffer');
      offer.innerHTML = `<p>${MEMBER ? 'New here? Let me show you around in a minute.' : 'Want a quick tour of Connect2Minds?'}</p>
        <div><button type="button" class="hb-btn is-primary" data-offer="yes">Start the tour</button><button type="button" class="hb-btn" data-offer="no">Not now</button></div>`;
      offer.hidden = false;
      offer.addEventListener('click', (e) => {
        const b = e.target.closest('[data-offer]');
        if (!b) return;
        save(key, true);
        offer.hidden = true;
        if (b.dataset.offer === 'yes') startTour();
      }, { once: true });
    }, 2500);
  }

  // Continue what a previous page started: a tour step or a "show me"
  async function resume() {
    let tour = null, pending = null;
    try { tour = JSON.parse(sessionStorage.getItem('helpbotTour')); } catch (e) { /* none */ }
    try { pending = JSON.parse(sessionStorage.getItem('helpbotPending')); } catch (e) { /* none */ }
    if (tour && Date.now() - tour.at < 120000) {
      await ensureKnowledge();
      const step = tourSteps()[tour.i];
      if (step && step.page === PAGE) return setTimeout(() => runTour(tour.i), 600);
    }
    if (pending && Date.now() - pending.at < 60000 && pending.page === PAGE) {
      sessionStorage.removeItem('helpbotPending');
      if (pending.steps && pending.steps.length) setTimeout(() => spotlight(pending.steps, 0), 600);
    }
  }

  // ==========================================
  // 8. VOICE (the browser's own speech features)
  // ==========================================
  function speechInput() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }
  function listening() { return !!recognition; }

  function startListening() {
    const SR = speechInput();
    if (!SR) return;
    stopSpeaking();
    try {
      recognition = new SR();
    } catch (e) {
      recognition = null;
      return addBot('Your browser could not start listening. You can type instead.');
    }
    recognition.lang = settings.lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    let finalText = '';
    $('#hbListening').hidden = false;
    $('#hbInterim').textContent = 'Listening…';
    $('[data-hb="mic"]').classList.add('is-on');
    $('[data-hb="mic"]').setAttribute('aria-pressed', 'true');
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += piece; else interim += piece;
      }
      $('#hbInterim').textContent = (finalText + interim).trim() || 'Listening…';
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        addBot("I can't use the microphone. Allow it with the 🔒 or camera icon in the address bar, then press the mic again.");
      } else if (event.error === 'no-speech') {
        $('#hbInterim').textContent = "I didn't hear anything. Press the mic and try again.";
      }
    };
    recognition.onend = () => {
      const text = finalText.trim();
      stopListening(true);
      if (text) { spokeLast = true; ask(text); }
    };
    try { recognition.start(); } catch (e) { stopListening(true); }
  }

  function stopListening(ended) {
    if (recognition && !ended) { try { recognition.stop(); } catch (e) { /* already stopped */ } return; }
    recognition = null;
    const mic = $('[data-hb="mic"]');
    if (mic) { mic.classList.remove('is-on'); mic.setAttribute('aria-pressed', 'false'); }
    const bar = $('#hbListening');
    if (bar) setTimeout(() => { if (!recognition) bar.hidden = true; }, 1200);
  }

  function plain(text) {
    return String(text).replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[-•]\s*/gm, '').replace(/[🎉🙂✓🔒]/gu, '');
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    stopSpeaking();
    const utter = new SpeechSynthesisUtterance(plain(text).slice(0, 900));
    utter.lang = settings.lang;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang === settings.lang) || voices.find(v => v.lang && v.lang.startsWith(settings.lang.slice(0, 2)));
    if (voice) utter.voice = voice;
    utter.rate = 1.02;
    window.speechSynthesis.speak(utter);
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  // ==========================================
  // 9. START
  // ==========================================
  function start() {
    history = load(STORE, []);
    settings = { ...settings, ...load(`${STORE}:settings`, {}) };
    build();
    $('#hbSpeak').checked = settings.speak;
    $('#hbLang').value = settings.lang;
    $('#hbTip').addEventListener('click', onTipClick);
    window.addEventListener('scroll', () => { if (spot) requestAnimationFrame(placeSpot); }, true);
    window.addEventListener('resize', () => { if (spot) requestAnimationFrame(placeSpot); });
    resume();
    offerTour();
    // The Support page fills in a question passed from here
    const about = new URLSearchParams(location.search).get('about');
    if (about && PAGE === 'support.html') setTimeout(() => { const box = document.getElementById('supMessage'); if (box && !box.value) box.value = about; }, 800);
  }

  window.Helpbot = { open: () => toggle(true), ask: (q) => { toggle(true); return ask(q); }, tour: startTour, _rank: (q) => ensureKnowledge().then(() => rank(q)), _command: (q) => !!matchCommand(q) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
