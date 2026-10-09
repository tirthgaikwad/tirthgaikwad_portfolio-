// ==========================================
// NETWORK3D.JS — The 3D network of points and lines behind the landing, login and sign-up pages
// Loaded after three.js. window.startNetwork(container, { fadeOnScroll }) draws into the container.
// Points drift in a wide, shallow box. Any two that come close are joined by a line,
// bright dots travel along the lines, and the points near the cursor link to it.
// The canvas is opaque black: the page's stylesheet must give the container mix-blend-mode: screen.
// ==========================================
(function () {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

  const NET_NODES = 140;
  const NET_NODES_SMALL = 60;
  const NET_LINK = 190;         // two points closer than this are joined
  const NET_REACH = 260;        // how far the cursor reaches
  const NET_CAMERA = 1000;      // camera distance from the middle of the box
  const NET_MAX_LINES = 1800;
  const NET_PULSES = 7;
  const NET_COLORS = [[0.43, 0.37, 0.99], [0.69, 0.42, 1.0], [0.22, 0.74, 0.97]];   // indigo, violet, cyan: left to right

  window.startNetwork = function (container, options = {}) {
    if (reducedMotion || !window.THREE || !container) return;

    let renderer;
    try {
      // Opaque black canvas: the stylesheet screens it onto the page, which is what makes the lines glow
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      return; // no WebGL: the page keeps its plain backdrop
    }

    const small = container.clientWidth < 760;
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
    let inView = true;

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

      // Scrolling pushes the cloud back and lets it fade (only where the page asks for it)
      const scrolled = options.fadeOnScroll ? window.scrollY : 0;
      cloud.position.z = -scrolled * 0.6;
      cloud.position.y = scrolled * 0.12;
      renderer.domElement.style.opacity = clamp(1 - scrolled / 760).toFixed(3);
      camera.position.x = mouseX * 60;
      camera.position.y = mouseY * 36;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }

    // Draw only while the container can be seen
    function syncRunning() {
      const shouldRun = inView && !document.hidden;
      if (shouldRun && !frame) { clock.start(); draw(); }
      if (!shouldRun && frame) { cancelAnimationFrame(frame); frame = 0; clock.stop(); }
      container.dataset.running = shouldRun ? '1' : '0';
    }
    new IntersectionObserver((entries) => {
      inView = entries[0].isIntersecting;
      syncRunning();
    }).observe(container);
    document.addEventListener('visibilitychange', syncRunning);

    syncRunning();
    container.classList.add('ready');
  };
})();
