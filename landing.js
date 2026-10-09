// ==========================================
// LANDING.JS — The landing page (index.html): header, scroll effects, the search demo,
// the product tour, the team game and the 3D network
// Loaded after three.js. Nothing here talks to the server.
// ==========================================
(function () {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const byId = (id) => document.getElementById(id);
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

  // ==========================================
  // 1. HEADER
  // ==========================================
  const header = byId('siteHeader');
  const menuBtn = byId('menuBtn');
  const mobileMenu = byId('mobileMenu');

  function setMenu(open) {
    mobileMenu.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    syncHeader();
  }

  // Clear over the hero, solid once the page has moved (or while the phone menu is open).
  // The thin bar under it shows how far down the page you are.
  function syncHeader() {
    header.classList.toggle('is-solid', window.scrollY > 12 || mobileMenu.classList.contains('open'));
    const room = document.documentElement.scrollHeight - window.innerHeight;
    header.style.setProperty('--scroll', room > 0 ? clamp(window.scrollY / room).toFixed(4) : '0');
  }

  menuBtn.addEventListener('click', () => setMenu(!mobileMenu.classList.contains('open')));
  mobileMenu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  // ==========================================
  // 2. SCROLL: REVEAL AND THE STEP LINE
  // ==========================================
  const revealItems = document.querySelectorAll('.reveal');
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach(item => item.classList.add('in'));
  } else {
    const revealer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        revealer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealItems.forEach(item => revealer.observe(item));
  }

  const steps = byId('steps');
  const stepItems = [...steps.querySelectorAll('.step')];

  // The line fills as the steps pass the middle of the screen; a step lights up when the line reaches it
  function syncSteps() {
    const box = steps.getBoundingClientRect();
    const reach = window.innerHeight * 0.6;
    const progress = clamp((reach - box.top) / box.height);
    steps.style.setProperty('--progress', progress.toFixed(3));
    stepItems.forEach(step => {
      step.classList.toggle('on', step.getBoundingClientRect().top + 22 < reach);
    });
  }

  // ==========================================
  // 3. FAQ
  // ==========================================
  byId('faqList').addEventListener('click', (e) => {
    const question = e.target.closest('.faq-q');
    if (!question) return;
    const open = question.getAttribute('aria-expanded') !== 'true';
    question.setAttribute('aria-expanded', String(open));
    byId(question.getAttribute('aria-controls')).classList.toggle('open', open);
  });

  // ==========================================
  // 4. HERO: ROTATING WORD AND THE SEARCH DEMO
  // ==========================================
  const USE_CASES = ['hackathon', 'capstone project', 'research paper', 'startup', 'competition'];
  const SEARCHES = ['React', 'Python', 'Figma'];

  function rotateWord() {
    const word = byId('rotatingWord');
    let index = 0;
    setInterval(() => {
      if (document.hidden) return;
      word.classList.add('swap');
      setTimeout(() => {
        index = (index + 1) % USE_CASES.length;
        word.textContent = USE_CASES[index];
        word.classList.remove('swap');
      }, 300);
    }, 2600);
  }

  const demoInput = byId('demoInput');
  const demoGrid = byId('demoGrid');
  const demoCards = [...demoGrid.querySelectorAll('.d-card')];
  const demoChips = [...byId('demoChips').querySelectorAll('button')];
  let demoTouched = false;   // true once the visitor uses the demo; the self-typing stops for good
  demoCards.forEach(card => { card.dataset.find = card.textContent.replace(/\s+/g, ' ').toLowerCase(); });

  // Shows the sample people whose name, place or skills contain the text, the way the real Discover search does.
  // Cards that stay slide from their old place to the new one.
  function filterDemo(text) {
    const query = text.trim().toLowerCase();
    const before = reducedMotion ? null : new Map(demoCards.map(card => [card, card.hidden ? null : card.getBoundingClientRect()]));
    let shown = 0;
    demoCards.forEach(card => {
      const match = !query || card.dataset.find.includes(query);
      card.hidden = !match;
      if (match) shown++;
      card.querySelectorAll('.chip').forEach(chip => {
        chip.classList.toggle('hit', Boolean(query) && chip.textContent.toLowerCase().includes(query));
      });
    });
    demoChips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.q.toLowerCase() === query)));
    byId('demoCount').textContent = query ? `${shown} of ${demoCards.length} match` : `${demoCards.length} people`;
    byId('demoEmpty').hidden = shown > 0;
    if (!before) return;

    demoCards.forEach(card => {
      if (card.hidden) return;
      const from = before.get(card);
      const to = card.getBoundingClientRect();
      if (!from) {
        card.animate([{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE });
      } else if (Math.abs(from.left - to.left) > 1 || Math.abs(from.top - to.top) > 1) {
        card.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 460, easing: EASE });
      }
    });
  }

  // The grid keeps the height of the full list, so the page below does not jump while results change
  function lockDemoHeight() {
    if (demoInput.value.trim()) return;
    demoGrid.style.minHeight = '';
    demoGrid.style.minHeight = `${demoGrid.offsetHeight}px`;
  }

  function takeOverDemo() {
    if (demoTouched) return;
    demoTouched = true;
    demoInput.value = '';
    filterDemo('');
  }

  demoInput.addEventListener('focus', takeOverDemo);
  demoInput.addEventListener('input', () => { demoTouched = true; filterDemo(demoInput.value); });
  byId('demoChips').addEventListener('click', (e) => {
    const chip = e.target.closest('button');
    if (!chip) return;
    takeOverDemo();
    demoInput.value = chip.getAttribute('aria-pressed') === 'true' ? '' : chip.dataset.q;
    filterDemo(demoInput.value);
  });

  // Until someone tries it, the demo types a few searches by itself
  async function autoTypeDemo() {
    await wait(1800);
    for (let round = 0; !demoTouched; round++) {
      const text = SEARCHES[round % SEARCHES.length];
      for (let i = 1; i <= text.length && !demoTouched; i++) {
        demoInput.value = text.slice(0, i);
        filterDemo(demoInput.value);
        await wait(120);
      }
      await wait(2400);
      while (demoInput.value && !demoTouched) {
        demoInput.value = demoInput.value.slice(0, -1);
        await wait(45);
      }
      if (demoTouched) return;
      filterDemo('');
      await wait(900);
      while (document.hidden && !demoTouched) await wait(500);
    }
  }

  // ==========================================
  // 5. PRODUCT TOUR
  // On a wide screen the section pins: one screen stays put and its content changes as the six
  // steps scroll past. Otherwise (phone, short window, reduced motion) the steps are plain cards.
  // ==========================================
  const tour = byId('tour');
  const tourSteps = [...tour.querySelectorAll('.tour-step')];
  const tourMedia = window.matchMedia('(min-width: 961px) and (min-height: 640px)');
  let tourPinned = false;

  function setTourStep(index) {
    tourSteps.forEach((step, n) => {
      step.classList.toggle('on', n === index);
      const button = step.querySelector('.tour-btn');
      if (tourPinned && n === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    byId('tourTitle').textContent = tourSteps[index].dataset.title;
  }

  function tourScrollRoom() {
    return tour.offsetHeight - window.innerHeight;
  }

  function syncTour() {
    if (!tourPinned) return;
    const progress = clamp(-tour.getBoundingClientRect().top / tourScrollRoom());
    tour.style.setProperty('--p', progress.toFixed(3));
    const index = Math.min(tourSteps.length - 1, Math.floor(progress * tourSteps.length));
    if (!tourSteps[index].classList.contains('on')) setTourStep(index);
  }

  function syncTourMode() {
    tourPinned = tourMedia.matches && !reducedMotion;
    tour.classList.toggle('pinned', tourPinned);
    // In the stacked layout a step's title is only a heading, so it leaves the tab order
    tourSteps.forEach(step => { step.querySelector('.tour-btn').tabIndex = tourPinned ? 0 : -1; });
    if (tourPinned) { setTourStep(0); syncTour(); }
  }

  tour.addEventListener('click', (e) => {
    const button = e.target.closest('.tour-btn');
    if (!button || !tourPinned) return;
    const index = tourSteps.indexOf(button.closest('.tour-step'));
    const top = window.scrollY + tour.getBoundingClientRect().top + tourScrollRoom() * (index + 0.5) / tourSteps.length;
    window.scrollTo({ top, behavior: 'smooth' });
  });
  tourMedia.addEventListener('change', syncTourMode);
  syncTourMode();

  // ==========================================
  // 6. BUILD A TEAM
  // Every sample person has one role and every project needs four different roles,
  // so a team can always be completed whatever order people are tapped in.
  // ==========================================
  const ROLES = {
    frontend: 'Frontend', backend: 'Backend', design: 'Design', ml: 'Machine learning',
    hardware: 'Hardware', research: 'Research', business: 'Business', writing: 'Writing'
  };
  const PROJECTS = [
    { label: 'Hackathon', roles: ['frontend', 'backend', 'design', 'ml'] },
    { label: 'Startup', roles: ['frontend', 'backend', 'design', 'business'] },
    { label: 'Research paper', roles: ['research', 'ml', 'writing', 'design'] },
    { label: 'Capstone project', roles: ['frontend', 'backend', 'hardware', 'writing'] }
  ];
  const PEOPLE = [
    { initials: 'AS', name: 'Aarav S.', tone: 'a', role: 'frontend', skills: 'React · TypeScript' },
    { initials: 'KN', name: 'Kabir N.', tone: 'e', role: 'backend', skills: 'Node.js · PostgreSQL' },
    { initials: 'SD', name: 'Sara D.', tone: 'd', role: 'design', skills: 'Figma · UI/UX' },
    { initials: 'MK', name: 'Meera K.', tone: 'b', role: 'ml', skills: 'Python · PyTorch' },
    { initials: 'RP', name: 'Rohan P.', tone: 'c', role: 'hardware', skills: 'Embedded C · IoT' },
    { initials: 'AR', name: 'Ananya R.', tone: 'b', role: 'research', skills: 'Statistics · Lab research' },
    { initials: 'DM', name: 'Dev M.', tone: 'c', role: 'business', skills: 'Pitching · Finance' },
    { initials: 'IT', name: 'Isha T.', tone: 'd', role: 'writing', skills: 'Tech writing · Editing' }
  ];
  const RING_LENGTH = 339.3;   // circumference of the progress ring (r = 54)
  const SPARK_COLORS = ['#7a6cff', '#b06bff', '#38bdf8', '#34d399', '#ffffff'];

  const teamTypes = byId('teamTypes');
  const teamBoard = byId('teamBoard');
  const teamPool = byId('teamPool');
  const teamSlots = [...teamBoard.querySelectorAll('.slot')];
  const teamLines = [...teamBoard.querySelectorAll('line')];
  let teamProject = 0;
  let teamFilled = [null, null, null, null];   // one person (or null) per role of the current project
  let teamDoneTimer = 0;

  const avatarHtml = (person) => `<span class="p-avatar tone-${person.tone}">${person.initials}</span>`;
  const announceTeam = (text) => { byId('teamLive').textContent = text; };

  function renderTeam() {
    const project = PROJECTS[teamProject];
    const count = teamFilled.filter(Boolean).length;

    [...teamTypes.children].forEach((button, n) => button.setAttribute('aria-pressed', String(n === teamProject)));
    teamSlots.forEach((slot, n) => {
      const person = teamFilled[n];
      const role = ROLES[project.roles[n]];
      slot.classList.toggle('filled', Boolean(person));
      slot.disabled = !person;
      slot.setAttribute('aria-label', person ? `${role}: ${person.name}. Remove` : `${role}: empty`);
      slot.innerHTML = `<span class="slot-role">${role}</span>` + (person
        ? `<span class="slot-who">${avatarHtml(person)}${person.name}<svg class="icon"><use href="#i-x"/></svg></span>`
        : '<span class="slot-empty">Open role</span>');
      teamLines[n].classList.toggle('lit', Boolean(person));
    });
    [...teamPool.children].forEach((button, n) => button.setAttribute('aria-pressed', String(teamFilled.includes(PEOPLE[n]))));

    byId('teamCount').textContent = `${count}/4`;
    byId('teamLabel').textContent = project.label;
    byId('teamRing').style.strokeDashoffset = String(RING_LENGTH * (1 - count / 4));
    byId('teamCore').classList.toggle('full', count === 4);
  }

  function showTeamDone(done) {
    clearTimeout(teamDoneTimer);
    teamPool.hidden = done;
    byId('teamDone').hidden = !done;
  }

  function setTeamProject(index) {
    teamProject = index;
    teamFilled = [null, null, null, null];
    showTeamDone(false);
    renderTeam();
  }

  // A copy of the avatar travels from the person to the role they fill
  function flyAvatar(fromEl, toEl) {
    if (reducedMotion) return;
    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    const ghost = fromEl.cloneNode(true);
    ghost.classList.add('fly');
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    document.body.appendChild(ghost);
    const dx = to.left + 14 - from.left;
    const dy = to.top + to.height / 2 - from.top - from.height / 2 + 10;
    ghost.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.85)`, opacity: 1, offset: 0.85 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.85)`, opacity: 0 }
    ], { duration: 520, easing: EASE }).onfinish = () => ghost.remove();
  }

  function burst(el) {
    if (reducedMotion) return;
    const box = el.getBoundingClientRect();
    for (let i = 0; i < 28; i++) {
      const spark = document.createElement('i');
      spark.className = 'spark';
      spark.style.left = `${box.left + box.width / 2}px`;
      spark.style.top = `${box.top + box.height / 2}px`;
      spark.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
      document.body.appendChild(spark);
      const angle = (i / 28) * Math.PI * 2 + Math.random() * 0.4;
      const reach = 90 + Math.random() * 150;
      spark.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach}px) scale(0.2)`, opacity: 0 }
      ], { duration: 800 + Math.random() * 500, easing: EASE }).onfinish = () => spark.remove();
    }
  }

  function pickPerson(person, button) {
    const project = PROJECTS[teamProject];
    const held = teamFilled.indexOf(person);
    if (held >= 0) {   // tapping someone who is already on the team takes them out
      teamFilled[held] = null;
      renderTeam();
      announceTeam(`${person.name} removed. ${ROLES[person.role]} is open again.`);
      return;
    }
    const index = project.roles.indexOf(person.role);
    if (index < 0) {
      button.classList.remove('shake');
      void button.offsetWidth;   // lets the shake run again on a second wrong tap
      button.classList.add('shake');
      setTimeout(() => button.classList.remove('shake'), 500);
      announceTeam(`A ${project.label.toLowerCase()} team here has no ${ROLES[person.role]} role. Try someone else.`);
      return;
    }
    teamFilled[index] = person;
    flyAvatar(button.querySelector('.p-avatar'), teamSlots[index]);
    renderTeam();

    const count = teamFilled.filter(Boolean).length;
    if (count < 4) {
      announceTeam(`${person.name} fills ${ROLES[person.role]}. ${count} of 4 roles filled.`);
      return;
    }
    announceTeam('All 4 roles filled. This is what a full team looks like.');
    teamDoneTimer = setTimeout(() => {
      burst(byId('teamCore'));
      showTeamDone(true);
    }, reducedMotion ? 0 : 700);
  }

  teamTypes.innerHTML = PROJECTS.map(project => `<button class="pick" type="button" aria-pressed="false">${project.label}</button>`).join('');
  teamPool.innerHTML = PEOPLE.map(person => `<button class="person" type="button" aria-pressed="false">${avatarHtml(person)}<span><b>${person.name}</b><small>${person.skills}</small><em>${ROLES[person.role]}</em></span></button>`).join('');

  teamTypes.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) setTeamProject([...teamTypes.children].indexOf(button));
  });
  teamPool.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) pickPerson(PEOPLE[[...teamPool.children].indexOf(button)], button);
  });
  teamBoard.addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (!slot) return;
    const index = teamSlots.indexOf(slot);
    const person = teamFilled[index];
    if (!person) return;
    teamFilled[index] = null;
    showTeamDone(false);
    renderTeam();
    announceTeam(`${person.name} removed. ${ROLES[person.role]} is open again.`);
  });
  byId('teamAgain').addEventListener('click', () => {
    setTeamProject((teamProject + 1) % PROJECTS.length);
    announceTeam(`New project: ${PROJECTS[teamProject].label}. 0 of 4 roles filled.`);
    teamPool.querySelector('button').focus({ preventScroll: true });
  });
  renderTeam();

  // ==========================================
  // 7. MOTION: SCROLL WIRING, STRIP, TILT, SPOTLIGHT, MAGNETIC BUTTONS, CURSOR LIGHT
  // ==========================================
  let scrollQueued = false;
  function onScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      syncHeader();
      syncSteps();
      syncTour();
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { lockDemoHeight(); onScroll(); });
  window.addEventListener('load', lockDemoHeight);
  lockDemoHeight();
  syncHeader();
  syncSteps();

  // A strip row scrolls by half its width, so it needs its list twice to loop without a seam
  document.querySelectorAll('.strip-track').forEach(track => {
    const copy = track.firstElementChild.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    track.appendChild(copy);
  });

  // The panel leans a few degrees toward the cursor while it is over the area
  function bindTilt(area, panel, degrees) {
    area.addEventListener('mousemove', (e) => {
      const box = area.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width - 0.5;
      const y = (e.clientY - box.top) / box.height - 0.5;
      panel.style.setProperty('--ry', `${(x * degrees).toFixed(2)}deg`);
      panel.style.setProperty('--rx', `${(-y * degrees).toFixed(2)}deg`);
    });
    area.addEventListener('mouseleave', () => {
      panel.style.setProperty('--ry', '0deg');
      panel.style.setProperty('--rx', '0deg');
    });
  }

  // The light on a card follows the cursor
  function bindSpotlight() {
    document.querySelectorAll('.spot').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - box.left}px`);
        card.style.setProperty('--my', `${e.clientY - box.top}px`);
      });
    });
  }

  // The main buttons lean a little toward the cursor
  function bindMagnets() {
    document.querySelectorAll('.magnetic').forEach(button => {
      button.addEventListener('mousemove', (e) => {
        const box = button.getBoundingClientRect();
        button.style.setProperty('--tx', `${((e.clientX - box.left - box.width / 2) * 0.22).toFixed(1)}px`);
        button.style.setProperty('--ty', `${((e.clientY - box.top - box.height / 2) * 0.3).toFixed(1)}px`);
      });
      button.addEventListener('mouseleave', () => {
        button.style.setProperty('--tx', '0px');
        button.style.setProperty('--ty', '0px');
      });
    });
  }

  // A soft light trails the cursor over the whole page
  function bindCursorGlow() {
    const glow = byId('cursorGlow');
    let x = 0, y = 0, targetX = 0, targetY = 0, frame = 0;
    function follow() {
      x += (targetX - x) * 0.14;
      y += (targetY - y) * 0.14;
      glow.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      frame = Math.abs(targetX - x) + Math.abs(targetY - y) > 0.5 ? requestAnimationFrame(follow) : 0;
    }
    document.addEventListener('mousemove', (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!glow.classList.contains('on')) { x = targetX; y = targetY; glow.classList.add('on'); }
      if (!frame) frame = requestAnimationFrame(follow);
    });
    document.documentElement.addEventListener('mouseleave', () => glow.classList.remove('on'));
  }

  if (!reducedMotion) {
    rotateWord();
    autoTypeDemo();
    if (finePointer) {
      bindTilt(byId('demoWrap'), byId('demo'), 3);
      bindTilt(byId('storyTilt'), byId('storyQuote'), 7);
      bindSpotlight();
      bindMagnets();
      bindCursorGlow();
    }
  }

  // ==========================================
  // 8. THE 3D NETWORK BEHIND THE HERO
  // Points drift in a wide, shallow box. Any two that come close are joined by a line,
  // bright dots travel along the lines, and the points near the cursor link to it.
  // ==========================================
  const NET_NODES = 140;
  const NET_NODES_SMALL = 60;
  const NET_LINK = 190;         // two points closer than this are joined
  const NET_REACH = 260;        // how far the cursor reaches
  const NET_CAMERA = 1000;      // camera distance from the middle of the box
  const NET_MAX_LINES = 1800;
  const NET_PULSES = 7;
  const NET_COLORS = [[0.43, 0.37, 0.99], [0.69, 0.42, 1.0], [0.22, 0.74, 0.97]];   // indigo, violet, cyan: left to right

  function initNetwork() {
    const container = byId('heroNet');
    if (reducedMotion || !window.THREE || !container) return;

    let renderer;
    try {
      // Opaque black canvas: the stylesheet screens it onto the page, which is what makes the lines glow
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      return; // no WebGL: the hero keeps the page backdrop
    }

    const small = window.innerWidth < 760;
    const count = small ? NET_NODES_SMALL : NET_NODES;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 4000);
    camera.position.set(0, 0, NET_CAMERA);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
    container.appendChild(renderer.domElement);

    // Half the height the camera sees at the middle of the box; the box is sized from it
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(25)) * NET_CAMERA;
    const extentY = halfHeight * 0.95;
    const extentZ = 320;
    let extentX = halfHeight;

    function resize() {
      const width = container.clientWidth, height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      extentX = halfHeight * camera.aspect * 1.15;
    }
    resize();

    // A soft round glow for each point
    const dot = document.createElement('canvas');
    dot.width = dot.height = 64;
    const ctx = dot.getContext('2d');
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glow.addColorStop(0.25, 'rgba(255, 255, 255, 0.75)');
    glow.addColorStop(0.5, 'rgba(255, 255, 255, 0.18)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
    const dotTexture = new THREE.CanvasTexture(dot);

    // Where each point rests (as a share of the box), and how it sways around that spot
    const rest = new Float32Array(count * 3);
    const phase = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const tint = new Float32Array(count * 3);
    for (let n = 0; n < count; n++) {
      for (let axis = 0; axis < 3; axis++) {
        rest[n * 3 + axis] = Math.random() * 2 - 1;
        phase[n * 3 + axis] = Math.random() * Math.PI * 2;
      }
      speed[n] = 0.15 + Math.random() * 0.25;
      const across = (rest[n * 3] + 1) / 2;   // 0 on the left, 1 on the right
      const from = across < 0.5 ? NET_COLORS[0] : NET_COLORS[1];
      const to = across < 0.5 ? NET_COLORS[1] : NET_COLORS[2];
      const mix = across < 0.5 ? across * 2 : across * 2 - 1;
      for (let c = 0; c < 3; c++) tint[n * 3 + c] = from[c] + (to[c] - from[c]) * mix;
    }

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    nodeGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const nodes = new THREE.Points(nodeGeometry, new THREE.PointsMaterial({
      size: 30, map: dotTexture, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));

    const linePositions = new Float32Array(NET_MAX_LINES * 6);
    const lineColors = new Float32Array(NET_MAX_LINES * 6);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));

    const pulsePositions = new Float32Array(NET_PULSES * 3);
    const pulseGeometry = new THREE.BufferGeometry();
    pulseGeometry.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
    const pulseMaterial = new THREE.PointsMaterial({
      size: 46, map: dotTexture, color: 0xcfe8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const pulseDots = new THREE.Points(pulseGeometry, pulseMaterial);

    // The buffers change every frame, so three.js must not cull by a stale bounding sphere
    const cloud = new THREE.Group();
    [lines, nodes, pulseDots].forEach(part => { part.frustumCulled = false; cloud.add(part); });
    scene.add(cloud);

    function placeNodes(time) {
      for (let n = 0; n < count; n++) {
        const at = n * 3, t = time * speed[n];
        positions[at] = (rest[at] + Math.sin(t + phase[at]) * 0.07) * extentX;
        positions[at + 1] = (rest[at + 1] + Math.sin(t * 0.9 + phase[at + 1]) * 0.09) * extentY;
        positions[at + 2] = (rest[at + 2] + Math.sin(t * 0.8 + phase[at + 2]) * 0.25) * extentZ;
      }
    }

    function distanceSquared(a, b) {
      const dx = positions[a * 3] - positions[b * 3];
      const dy = positions[a * 3 + 1] - positions[b * 3 + 1];
      const dz = positions[a * 3 + 2] - positions[b * 3 + 2];
      return dx * dx + dy * dy + dz * dz;
    }

    // A pulse runs from point a to point b, then carries on from b to one of b's neighbours
    const pulses = [];
    function sendPulse(pulse, from, avoid) {
      const choices = [];
      for (let n = 0; n < count; n++) {
        if (n !== from && n !== avoid && distanceSquared(from, n) < NET_LINK * NET_LINK) choices.push(n);
      }
      if (!choices.length && avoid >= 0) return sendPulse(pulse, Math.floor(Math.random() * count), -1);
      pulse.a = from;
      pulse.b = choices.length ? choices[Math.floor(Math.random() * choices.length)] : from;
      pulse.t = 0;
      pulse.speed = 0.7 + Math.random() * 0.7;
    }
    placeNodes(0);
    for (let p = 0; p < NET_PULSES; p++) {
      pulses.push({ a: 0, b: 0, t: 0, speed: 1 });
      sendPulse(pulses[p], Math.floor(Math.random() * count), -1);
    }

    let mouseX = 0, mouseY = 0, targetX = 0, targetY = 0, pointerOn = false, reach = 0;
    document.addEventListener('mousemove', (e) => {
      const box = container.getBoundingClientRect();
      pointerOn = e.clientY >= box.top && e.clientY <= box.bottom;
      targetX = ((e.clientX - box.left) / box.width) * 2 - 1;
      targetY = -(((e.clientY - box.top) / box.height) * 2 - 1);
    });
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    let frame = 0;
    let elapsed = 0;   // only counts time spent drawing, so nothing jumps after a pause
    let heroVisible = true;

    function draw() {
      frame = requestAnimationFrame(draw);
      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta;
      mouseX += (targetX - mouseX) * 0.06;
      mouseY += (targetY - mouseY) * 0.06;
      reach += ((pointerOn ? 1 : 0) - reach) * 0.08;

      // The lines grow out over the first two seconds
      const intro = 1 - Math.pow(1 - clamp(elapsed / 2.2), 3);
      const link = NET_LINK * intro;
      const linkSquared = link * link;
      const cursorX = mouseX * halfHeight * camera.aspect;
      const cursorY = mouseY * halfHeight;

      placeNodes(elapsed);

      let segments = 0;
      function addLine(ax, ay, az, bx, by, bz, r, g, b) {
        if (segments >= NET_MAX_LINES) return;
        const at = segments * 6;
        linePositions[at] = ax; linePositions[at + 1] = ay; linePositions[at + 2] = az;
        linePositions[at + 3] = bx; linePositions[at + 4] = by; linePositions[at + 5] = bz;
        lineColors[at] = lineColors[at + 3] = r;
        lineColors[at + 1] = lineColors[at + 4] = g;
        lineColors[at + 2] = lineColors[at + 5] = b;
        segments++;
      }

      for (let n = 0; n < count; n++) {
        const at = n * 3;
        const x = positions[at], y = positions[at + 1], z = positions[at + 2];
        // Where the point appears on the plane the cursor moves in
        const scale = NET_CAMERA / (NET_CAMERA - z);
        const away = Math.hypot(x * scale - cursorX, y * scale - cursorY);
        const near = reach * clamp(1 - away / NET_REACH);
        const depth = 0.4 + 0.6 * (z + extentZ) / (2 * extentZ);   // points further back are dimmer
        const bright = intro * depth * (0.8 + near * 1.1);
        colors[at] = tint[at] * bright;
        colors[at + 1] = tint[at + 1] * bright;
        colors[at + 2] = tint[at + 2] * bright;
        if (near > 0.05) addLine(x, y, z, cursorX, cursorY, 0, 0.5 * near, 0.55 * near, 0.9 * near);
      }

      if (linkSquared > 1) {
        for (let a = 0; a < count; a++) {
          for (let b = a + 1; b < count; b++) {
            const gap = distanceSquared(a, b);
            if (gap >= linkSquared) continue;
            const strength = (1 - Math.sqrt(gap) / link) * 0.5;
            addLine(
              positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2],
              positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2],
              (colors[a * 3] + colors[b * 3]) * strength,
              (colors[a * 3 + 1] + colors[b * 3 + 1]) * strength,
              (colors[a * 3 + 2] + colors[b * 3 + 2]) * strength
            );
          }
        }
      }

      pulses.forEach((pulse, p) => {
        pulse.t += delta * pulse.speed;
        if (pulse.t >= 1) sendPulse(pulse, pulse.b, pulse.a);
        for (let axis = 0; axis < 3; axis++) {
          const from = positions[pulse.a * 3 + axis], to = positions[pulse.b * 3 + axis];
          pulsePositions[p * 3 + axis] = from + (to - from) * pulse.t;
        }
      });
      pulseMaterial.opacity = intro * 0.9;

      nodeGeometry.attributes.position.needsUpdate = true;
      nodeGeometry.attributes.color.needsUpdate = true;
      lineGeometry.attributes.position.needsUpdate = true;
      lineGeometry.attributes.color.needsUpdate = true;
      lineGeometry.setDrawRange(0, segments * 2);
      pulseGeometry.attributes.position.needsUpdate = true;

      // Scrolling pushes the cloud back and lets it fade
      const scrolled = window.scrollY;
      cloud.position.z = -scrolled * 0.6;
      cloud.position.y = scrolled * 0.12;
      renderer.domElement.style.opacity = clamp(1 - scrolled / 760).toFixed(3);
      camera.position.x = mouseX * 60;
      camera.position.y = mouseY * 36;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }

    // Draw only while the top of the hero can be seen
    function syncRunning() {
      const shouldRun = heroVisible && !document.hidden;
      if (shouldRun && !frame) { clock.start(); draw(); }
      if (!shouldRun && frame) { cancelAnimationFrame(frame); frame = 0; clock.stop(); }
      container.dataset.running = shouldRun ? '1' : '0';
    }
    new IntersectionObserver((entries) => {
      heroVisible = entries[0].isIntersecting;
      syncRunning();
    }).observe(container);
    document.addEventListener('visibilitychange', syncRunning);

    syncRunning();
    container.classList.add('ready');
  }

  initNetwork();
})();
