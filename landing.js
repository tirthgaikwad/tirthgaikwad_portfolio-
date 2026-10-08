// ==========================================
// LANDING.JS — The landing page (index.html): header, scroll effects, the product preview and the 3D wave
// Loaded after three.js and shared.js. Nothing here talks to the server.
// ==========================================
(function () {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const byId = (id) => document.getElementById(id);

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

  // Clear over the hero, solid once the page has moved (or while the phone menu is open)
  function syncHeader() {
    header.classList.toggle('is-solid', window.scrollY > 12 || mobileMenu.classList.contains('open'));
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
    const progress = Math.min(1, Math.max(0, (reach - box.top) / box.height));
    steps.style.setProperty('--progress', progress.toFixed(3));
    stepItems.forEach(step => {
      step.classList.toggle('on', step.getBoundingClientRect().top + 22 < reach);
    });
  }

  let scrollQueued = false;
  function onScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      syncHeader();
      syncSteps();
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  syncHeader();
  syncSteps();

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
  // 4. HERO: ROTATING WORD, PRODUCT PREVIEW, TILT
  // ==========================================
  const USE_CASES = ['hackathon', 'capstone project', 'research paper', 'startup', 'competition'];
  const SEARCHES = ['React', 'Python', 'Figma', ''];
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

  // Shows the rows whose skills contain the text, the way the real Discover search does
  function filterPreview(text) {
    const query = text.trim().toLowerCase();
    let shown = 0;
    byId('previewList').querySelectorAll('.p-row').forEach(row => {
      const match = !query || row.dataset.skills.includes(query);
      row.classList.toggle('out', !match);
      if (match) shown++;
      row.querySelectorAll('.chip').forEach(chip => {
        chip.classList.toggle('hit', Boolean(query) && chip.textContent.toLowerCase().includes(query));
      });
    });
    byId('previewCount').textContent = query ? `${shown} of 4 match` : '4 people';
  }

  async function typePreview() {
    const typed = byId('previewTyped');
    await wait(1400);
    for (let round = 0; ; round++) {
      const text = SEARCHES[round % SEARCHES.length];
      for (let i = 1; i <= text.length; i++) {
        typed.textContent = text.slice(0, i);
        filterPreview(typed.textContent);
        await wait(110);
      }
      await wait(text ? 2400 : 1600);
      while (typed.textContent) {
        typed.textContent = typed.textContent.slice(0, -1);
        await wait(45);
      }
      filterPreview('');
      await wait(500);
      while (document.hidden) await wait(500);
    }
  }

  function bindTilt() {
    const hero = byId('hero');
    const preview = byId('preview');
    hero.addEventListener('mousemove', (e) => {
      const box = hero.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width - 0.5;
      const y = (e.clientY - box.top) / box.height - 0.5;
      preview.style.setProperty('--ry', `${(x * 6).toFixed(2)}deg`);
      preview.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`);
    });
    hero.addEventListener('mouseleave', () => {
      preview.style.setProperty('--ry', '0deg');
      preview.style.setProperty('--rx', '0deg');
    });
  }

  // The light on a product card follows the cursor
  function bindSpotlight() {
    document.querySelectorAll('.card').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - box.left}px`);
        card.style.setProperty('--my', `${e.clientY - box.top}px`);
      });
    });
  }

  // The strip scrolls by half its width, so it needs its list twice to loop without a seam
  const stripTrack = byId('stripTrack');
  const stripCopy = stripTrack.firstElementChild.cloneNode(true);
  stripCopy.setAttribute('aria-hidden', 'true');
  stripTrack.appendChild(stripCopy);

  if (!reducedMotion) {
    rotateWord();
    typePreview();
    if (finePointer) { bindTilt(); bindSpotlight(); }
  }

  // ==========================================
  // 5. THE 3D WAVE BEHIND THE HERO
  // ==========================================
  const WAVE_HIGH = [53, 37, 205];    // the site's primary indigo, on the crests
  const WAVE_LOW = [125, 150, 255];   // a lighter blue, in the troughs
  const WAVE_SPACING = 35;

  function initWave() {
    const hero = byId('hero');
    const container = byId('heroWave');
    if (reducedMotion || !window.THREE || !container) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      return; // no WebGL: the hero keeps its gradient
    }

    const small = window.innerWidth < 760;
    const gridSize = small ? 90 : 150;
    const wrapDistance = gridSize * WAVE_SPACING;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 10000);
    camera.position.set(0, 400, 1200);
    camera.lookAt(0, -200, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
    container.appendChild(renderer.domElement);

    function resize() {
      const width = hero.clientWidth, height = hero.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }
    resize();

    // A soft round dot for each particle
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const ctx = dot.getContext('2d');
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    const count = gridSize * gridSize;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    let index = 0;
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        positions[index * 3] = (i - gridSize / 2) * WAVE_SPACING;
        positions[index * 3 + 1] = 0; // height comes from the shader
        positions[index * 3 + 2] = (j - gridSize / 2) * WAVE_SPACING;
        offsets[index] = Math.random() * Math.PI * 2;
        index++;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));

    const toVector = (rgb) => new THREE.Vector3(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uWrap: { value: wrapDistance },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uColorHigh: { value: toVector(WAVE_HIGH) },
        uColorLow: { value: toVector(WAVE_LOW) },
        uTexture: { value: new THREE.CanvasTexture(dot) }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uScroll;
        uniform float uWrap;
        uniform vec2 uMouse;
        uniform vec3 uColorHigh;
        uniform vec3 uColorLow;
        attribute float aOffset;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec3 pos = position;

          // Endless treadmill: scrolling moves the grid, and points that leave one end come back at the other
          float halfWrap = uWrap / 2.0;
          pos.z += uScroll * 0.8;
          pos.z = mod(pos.z + halfWrap, uWrap) - halfWrap;

          float wave1 = sin(pos.x * 0.003 + uTime * 0.4) * 150.0;
          float wave2 = cos(pos.z * 0.004 - uTime * 0.3) * 150.0;
          float wave3 = sin((pos.x + pos.z) * 0.002 + uTime * 0.2 + aOffset) * 100.0;
          pos.y = wave1 + wave2 + wave3;

          // The surface dips under the cursor
          vec2 worldMouse = vec2(uMouse.x * 2000.0, uMouse.y * -2000.0);
          float mouseInfluence = smoothstep(600.0, 0.0, distance(vec2(pos.x, pos.z), worldMouse));
          pos.y -= mouseInfluence * 150.0;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = 5.0 * (1000.0 / -mvPosition.z);

          vColor = mix(uColorLow, uColorHigh, smoothstep(-150.0, 150.0, pos.y));

          // Fade the far edges (hides the wrap) and the points nearest the camera
          float edgeFade = 1.0 - smoothstep(1000.0, uWrap * 0.57, length(pos.xz));
          float depthFade = smoothstep(100.0, 500.0, -mvPosition.z);
          vAlpha = edgeFade * depthFade * 0.42;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          gl_FragColor = vec4(vColor, vAlpha) * texture2D(uTexture, gl_PointCoord);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    const wave = new THREE.Points(geometry, material);
    wave.rotation.x = -0.1;
    wave.position.y = -200;
    scene.add(wave);

    let mouseX = 0, mouseY = 0, targetX = 0, targetY = 0;
    let scrollY = window.scrollY;
    document.addEventListener('mousemove', (e) => {
      targetX = (e.clientX / window.innerWidth) * 2 - 1;
      targetY = -(e.clientY / window.innerHeight) * 2 + 1;
    });
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    let frame = 0;
    let elapsed = 0;   // only counts time spent drawing, so the wave does not jump after a pause
    let heroVisible = true;

    function draw() {
      frame = requestAnimationFrame(draw);
      mouseX += (targetX - mouseX) * 0.05;
      mouseY += (targetY - mouseY) * 0.05;
      scrollY += (window.scrollY - scrollY) * 0.05;

      elapsed += clock.getDelta();
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uScroll.value = scrollY;
      material.uniforms.uMouse.value.set(mouseX, mouseY);
      camera.position.x = mouseX * 200;
      camera.position.y = 400 - scrollY * 0.05;
      camera.lookAt(0, -200, 0);
      renderer.render(scene, camera);
    }

    // Draw only while the hero can be seen
    function syncRunning() {
      const shouldRun = heroVisible && !document.hidden;
      if (shouldRun && !frame) { clock.start(); draw(); }
      if (!shouldRun && frame) { cancelAnimationFrame(frame); frame = 0; clock.stop(); }
      container.dataset.running = shouldRun ? '1' : '0';
    }
    new IntersectionObserver((entries) => {
      heroVisible = entries[0].isIntersecting;
      syncRunning();
    }).observe(hero);
    document.addEventListener('visibilitychange', syncRunning);

    syncRunning();
    container.classList.add('ready');
  }

  initWave();
})();
