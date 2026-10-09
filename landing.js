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
  // 8. THE 3D NETWORK BEHIND THE HERO (drawn by network3d.js)
  // ==========================================
  if (window.startNetwork) window.startNetwork(byId('heroNet'), { fadeOnScroll: true });
})();
