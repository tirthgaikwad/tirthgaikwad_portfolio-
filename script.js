/* ==========================================================================
   Portfolio — Main Script
   Pure vanilla ES6+ · No dependencies
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  /* --------------------------------------------------------------------
     0. UTILITY HELPERS
     -------------------------------------------------------------------- */

  /** Debounce — collapse rapid calls into one trailing invocation */
  const debounce = (fn, ms = 200) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  /** Throttle via rAF — at most one call per animation frame */
  const rafThrottle = (fn) => {
    let ticking = false;
    return (...args) => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          fn(...args);
          ticking = false;
        });
      }
    };
  };

  /** Shorthand selectors */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* --------------------------------------------------------------------
     1. PRELOADER
     -------------------------------------------------------------------- */

  const initPreloader = () => {
    const preloader = $('.preloader');
    if (!preloader) return;

    const MIN_DISPLAY = 1500; // ms
    const loadStart = Date.now();

    const hidePreloader = () => {
      const elapsed = Date.now() - loadStart;
      const remaining = Math.max(0, MIN_DISPLAY - elapsed);

      setTimeout(() => {
        preloader.classList.add('hidden');

        // After the CSS transition finishes, remove from flow entirely
        const onTransitionEnd = () => {
          preloader.style.display = 'none';
          preloader.removeEventListener('transitionend', onTransitionEnd);
        };
        preloader.addEventListener('transitionend', onTransitionEnd);
      }, remaining);
    };

    // window.load may have already fired if script is deferred
    if (document.readyState === 'complete') {
      hidePreloader();
    } else {
      window.addEventListener('load', hidePreloader);
    }
  };

  /* --------------------------------------------------------------------
     2. NAVBAR SCROLL EFFECT  &  18. ACTIVE NAV LINK / SECTION TRACKING
     -------------------------------------------------------------------- */

  const initNavbar = () => {
    const navbar = $('.navbar');
    const navLinks = $$('.nav-links a');
    const sections = $$('section[id]');
    if (!navbar) return;

    const SCROLL_THRESHOLD = 50;
    const navHeight = navbar.offsetHeight;

    // --- scroll class ---
    const handleNavScroll = () => {
      if (window.scrollY > SCROLL_THRESHOLD) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };

    // --- active link tracking via IntersectionObserver ---
    const activateLink = (id) => {
      navLinks.forEach((link) => {
        link.classList.toggle(
          'active',
          link.getAttribute('href') === `#${id}`
        );
      });

      // Optionally update URL hash without jumping
      if (id && history.replaceState) {
        history.replaceState(null, '', `#${id}`);
      }
    };

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            activateLink(entry.target.id);
          }
        });
      },
      {
        rootMargin: `-${navHeight + 10}px 0px -40% 0px`,
        threshold: 0.15,
      }
    );

    sections.forEach((sec) => sectionObserver.observe(sec));

    window.addEventListener('scroll', rafThrottle(handleNavScroll), {
      passive: true,
    });
  };

  /* --------------------------------------------------------------------
     3. MOBILE NAVIGATION
     -------------------------------------------------------------------- */

  const initMobileNav = () => {
    const toggle = $('.nav-toggle');
    const navLinks = $('.nav-links');
    if (!toggle || !navLinks) return;

    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      navLinks.classList.toggle('active');
    });

    // Close menu when a link is clicked
    $$('.nav-links a').forEach((link) => {
      link.addEventListener('click', () => {
        toggle.classList.remove('active');
        navLinks.classList.remove('active');
      });
    });
  };

  /* --------------------------------------------------------------------
     4. SMOOTH SCROLLING
     -------------------------------------------------------------------- */

  const initSmoothScroll = () => {
    const navbar = $('.navbar');
    const offset = navbar ? navbar.offsetHeight : 70;

    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a[href^="#"]');
      if (!anchor) return;

      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;

      const target = $(targetId);
      if (!target) return;

      e.preventDefault();

      const top =
        target.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({ top, behavior: 'smooth' });
    });
  };

  /* --------------------------------------------------------------------
     5. THEME TOGGLE (Dark / Light)
     -------------------------------------------------------------------- */

  const initThemeToggle = () => {
    const btn = $('.theme-toggle');
    if (!btn) return;

    const STORAGE_KEY = 'portfolio-theme';
    const LIGHT_CLASS = 'light-mode';

    const applyTheme = (isLight) => {
      document.body.classList.toggle(LIGHT_CLASS, isLight);
      btn.innerHTML = isLight ? '☀️' : '🌙';
    };

    // Load saved preference (default: dark)
    const saved = localStorage.getItem(STORAGE_KEY);
    applyTheme(saved === 'light');

    btn.addEventListener('click', () => {
      const nowLight = document.body.classList.toggle(LIGHT_CLASS);
      btn.innerHTML = nowLight ? '☀️' : '🌙';
      localStorage.setItem(STORAGE_KEY, nowLight ? 'light' : 'dark');
    });
  };

  /* --------------------------------------------------------------------
     6. TYPING ANIMATION
     -------------------------------------------------------------------- */

  const initTypingAnimation = () => {
    const el = $('.typing-text');
    if (!el) return;

    const words = [
      'Java Programmer',
      'AI & DS Student',
      'Web Project Builder',
      'Future ML Engineer',
    ];

    const TYPING_SPEED = 100; // ms per character
    const DELETE_SPEED = 50;
    const PAUSE_END = 2000; // pause after full word
    const PAUSE_BETWEEN = 500; // pause after deletion

    let wordIdx = 0;
    let charIdx = 0;
    let isDeleting = false;

    const tick = () => {
      const current = words[wordIdx];

      if (!isDeleting) {
        // Typing forward
        charIdx++;
        el.textContent = current.slice(0, charIdx);

        if (charIdx === current.length) {
          // Full word displayed — pause, then start deleting
          isDeleting = true;
          setTimeout(tick, PAUSE_END);
          return;
        }
        setTimeout(tick, TYPING_SPEED);
      } else {
        // Deleting
        charIdx--;
        el.textContent = current.slice(0, charIdx);

        if (charIdx === 0) {
          isDeleting = false;
          wordIdx = (wordIdx + 1) % words.length;
          setTimeout(tick, PAUSE_BETWEEN);
          return;
        }
        setTimeout(tick, DELETE_SPEED);
      }
    };

    tick();
  };

  /* --------------------------------------------------------------------
     7. SCROLL REVEAL ANIMATION
     -------------------------------------------------------------------- */

  const initScrollReveal = () => {
    const reveals = $$('.reveal');
    if (!reveals.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
            observer.unobserve(entry.target); // one-shot
          }
        });
      },
      { threshold: 0.15 }
    );

    reveals.forEach((el) => observer.observe(el));
  };

  /* --------------------------------------------------------------------
     8. SKILL PROGRESS BARS
     -------------------------------------------------------------------- */

  const initSkillBars = () => {
    const bars = $$('.skill-bar');
    if (!bars.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          // Find all .skill-progress children inside this bar's parent group
          const container = entry.target.closest('.skill-bar') || entry.target;
          const progressEl = container.querySelector('.skill-progress');

          if (progressEl) {
            const target = progressEl.getAttribute('data-progress');
            // Slight stagger based on element index inside parent
            const siblings = container.parentElement
              ? $$('.skill-bar', container.parentElement)
              : [container];
            const idx = siblings.indexOf(container);
            const delay = idx * 120; // 120ms stagger

            setTimeout(() => {
              progressEl.style.width = `${target}%`;
            }, delay);
          }

          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.2 }
    );

    bars.forEach((bar) => observer.observe(bar));
  };

  /* --------------------------------------------------------------------
     9. PARTICLE SYSTEM
     -------------------------------------------------------------------- */

  const initParticles = () => {
    const container = $('.particles-container');
    if (!container) return;

    const COUNT = 50;
    const frag = document.createDocumentFragment();

    for (let i = 0; i < COUNT; i++) {
      const p = document.createElement('span');
      p.classList.add('particle');

      const size = Math.random() * 4 + 2; // 2–6 px
      const left = Math.random() * 100; // 0–100 %
      const opacity = Math.random() * 0.4 + 0.1; // 0.1–0.5
      const duration = Math.random() * 15 + 10; // 10–25 s
      const delay = Math.random() * duration; // stagger
      const drift = Math.random() * 40 - 20; // -20 to +20 px horizontal drift

      Object.assign(p.style, {
        position: 'absolute',
        bottom: '0',
        left: `${left}%`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '50%',
        background: 'currentColor',
        opacity: opacity,
        pointerEvents: 'none',
        animation: `particleFloat ${duration}s ${delay}s linear infinite`,
        '--drift': `${drift}px`,
      });

      frag.appendChild(p);
    }

    container.appendChild(frag);

    // Inject the keyframes if not already present
    if (!$('#particle-keyframes')) {
      const style = document.createElement('style');
      style.id = 'particle-keyframes';
      style.textContent = `
        @keyframes particleFloat {
          0%   { transform: translateY(0)   translateX(0);           opacity: var(--p-opacity, 0.3); }
          50%  { opacity: 0.5; }
          100% { transform: translateY(-100vh) translateX(var(--drift, 0px)); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  };

  /* --------------------------------------------------------------------
     10. PROJECT FILTERING
     -------------------------------------------------------------------- */

  const initProjectFilter = () => {
    const buttons = $$('.filter-btn');
    const cards = $$('.project-card');
    if (!buttons.length || !cards.length) return;

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        // Update active button
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        const filter = btn.getAttribute('data-filter');

        cards.forEach((card, idx) => {
          const categories = card.getAttribute('data-category') || '';
          const matches =
            filter === 'all' || categories.split(/\s+/).includes(filter);

          // Stagger the reveal
          const delay = idx * 80;

          if (matches) {
            setTimeout(() => card.classList.remove('hidden'), delay);
          } else {
            card.classList.add('hidden');
          }
        });
      });
    });
  };

  /* --------------------------------------------------------------------
     11. SKILL RADAR CHART (SVG)
     -------------------------------------------------------------------- */

  const initRadarChart = () => {
    const container = $('.radar-chart');
    if (!container) return;

    const skills = [
      { label: 'Java', value: 65 },
      { label: 'Python', value: 40 },
      { label: 'C++', value: 35 },
      { label: 'HTML/CSS', value: 70 },
      { label: 'JavaScript', value: 45 },
      { label: 'Problem\nSolving', value: 60 },
    ];

    const cx = 150; // center x
    const cy = 150; // center y
    const maxR = 110; // max radius
    const levels = 3; // grid rings
    const n = skills.length;
    const angleStep = (2 * Math.PI) / n;
    const startAngle = -Math.PI / 2; // top

    /** Return {x,y} on the polygon for a given index & radius */
    const point = (i, r) => ({
      x: cx + r * Math.cos(startAngle + i * angleStep),
      y: cy + r * Math.sin(startAngle + i * angleStep),
    });

    /** Build a polygon points-string at a given radius fraction */
    const ring = (fraction) =>
      skills
        .map((_, i) => {
          const p = point(i, maxR * fraction);
          return `${p.x},${p.y}`;
        })
        .join(' ');

    // --- Build SVG ---
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 300 300');
    svg.setAttribute('class', 'radar-svg');
    svg.style.width = '100%';
    svg.style.height = '100%';

    // Defs — gradient for the data polygon
    const defs = document.createElementNS(ns, 'defs');
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.id = 'radarGrad';
    grad.setAttribute('x1', '0%');
    grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%');
    grad.setAttribute('y2', '100%');

    const stop1 = document.createElementNS(ns, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#6c63ff');
    stop1.setAttribute('stop-opacity', '0.6');
    const stop2 = document.createElementNS(ns, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#00d4ff');
    stop2.setAttribute('stop-opacity', '0.6');
    grad.append(stop1, stop2);
    defs.appendChild(grad);
    svg.appendChild(defs);

    // Grid rings
    for (let l = 1; l <= levels; l++) {
      const poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', ring(l / levels));
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', 'currentColor');
      poly.setAttribute('stroke-opacity', '0.15');
      poly.setAttribute('stroke-width', '1');
      svg.appendChild(poly);
    }

    // Axis lines
    skills.forEach((_, i) => {
      const p = point(i, maxR);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', cx);
      line.setAttribute('y1', cy);
      line.setAttribute('x2', p.x);
      line.setAttribute('y2', p.y);
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-opacity', '0.1');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);
    });

    // Data polygon (starts at center, animates outward)
    const dataPoints = skills
      .map((s, i) => {
        const p = point(i, (maxR * s.value) / 100);
        return `${p.x},${p.y}`;
      })
      .join(' ');

    const centerPoints = skills.map(() => `${cx},${cy}`).join(' ');

    const dataPoly = document.createElementNS(ns, 'polygon');
    dataPoly.setAttribute('points', centerPoints); // start collapsed
    dataPoly.setAttribute('fill', 'url(#radarGrad)');
    dataPoly.setAttribute('stroke', '#6c63ff');
    dataPoly.setAttribute('stroke-width', '2');
    dataPoly.classList.add('radar-data');
    svg.appendChild(dataPoly);

    // Data points (small circles at vertices)
    const dots = skills.map((s, i) => {
      const p = point(i, (maxR * s.value) / 100);
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', cx);
      circle.setAttribute('cy', cy);
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', '#6c63ff');
      circle.classList.add('radar-dot');
      circle.dataset.cx = p.x;
      circle.dataset.cy = p.y;
      svg.appendChild(circle);
      return circle;
    });

    // Labels
    skills.forEach((s, i) => {
      const labelR = maxR + 22;
      const p = point(i, labelR);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', p.x);
      text.setAttribute('y', p.y);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', 'currentColor');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '500');
      text.setAttribute('class', 'radar-label');

      // Handle multi-line labels (e.g. "Problem\nSolving")
      const lines = s.label.split('\n');
      if (lines.length === 1) {
        text.textContent = s.label;
      } else {
        lines.forEach((line, li) => {
          const tspan = document.createElementNS(ns, 'tspan');
          tspan.setAttribute('x', p.x);
          tspan.setAttribute('dy', li === 0 ? '-0.35em' : '1.1em');
          tspan.textContent = line;
          text.appendChild(tspan);
        });
      }
      svg.appendChild(text);
    });

    container.appendChild(svg);

    // Animate on scroll into view
    const animateRadar = () => {
      dataPoly.setAttribute('points', dataPoints);
      dots.forEach((dot) => {
        dot.setAttribute('cx', dot.dataset.cx);
        dot.setAttribute('cy', dot.dataset.cy);
      });
    };

    const radarObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Small delay so the transition is visible
          requestAnimationFrame(() => {
            setTimeout(animateRadar, 150);
          });
          radarObserver.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    radarObserver.observe(container);

    // Inject transition styles for the radar polygon & dots
    if (!$('#radar-keyframes')) {
      const style = document.createElement('style');
      style.id = 'radar-keyframes';
      style.textContent = `
        .radar-data {
          transition: points 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .radar-dot {
          transition: cx 0.8s cubic-bezier(0.22, 1, 0.36, 1),
                      cy 0.8s cubic-bezier(0.22, 1, 0.36, 1);
        }
      `;
      document.head.appendChild(style);
    }
  };

  /* --------------------------------------------------------------------
     12. BACK TO TOP BUTTON
     -------------------------------------------------------------------- */

  const initBackToTop = () => {
    const btn = $('.back-to-top');
    if (!btn) return;

    const SHOW_AFTER = 500; // px

    const toggle = () => {
      btn.classList.toggle('visible', window.scrollY > SHOW_AFTER);
    };

    window.addEventListener('scroll', rafThrottle(toggle), { passive: true });

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    toggle(); // initial state
  };

  /* --------------------------------------------------------------------
     13. CONTACT FORM
     -------------------------------------------------------------------- */

  const initContactForm = () => {
    const form = $('#contact-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      // Basic required-field validation
      const required = $$('[required]', form);
      let valid = true;
      required.forEach((input) => {
        if (!input.value.trim()) {
          valid = false;
          input.classList.add('error');
        } else {
          input.classList.remove('error');
        }
      });

      if (!valid) return;

      // Show success
      const btn = $('button[type="submit"]', form) || $('button', form);
      const originalText = btn.textContent;
      btn.textContent = 'Message Sent! ✓';
      btn.disabled = true;

      setTimeout(() => {
        form.reset();
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    });
  };

  /* --------------------------------------------------------------------
     14. SCROLL INDICATOR (Hero)
     -------------------------------------------------------------------- */

  const initScrollIndicator = () => {
    const indicator = $('.scroll-indicator');
    if (!indicator) return;

    const fade = () => {
      // Fade out over the first 300px of scroll
      const opacity = Math.max(0, 1 - window.scrollY / 300);
      indicator.style.opacity = opacity;
    };

    window.addEventListener('scroll', rafThrottle(fade), { passive: true });
    fade();
  };

  /* --------------------------------------------------------------------
     15. FLOATING ICONS — Mouse Parallax
     -------------------------------------------------------------------- */

  const initFloatingIcons = () => {
    const icons = $$('.floating-icon');
    const hero = $('section, .hero, #hero'); // best guess for hero section
    if (!icons.length || !hero) return;

    hero.addEventListener(
      'mousemove',
      rafThrottle((e) => {
        const rect = hero.getBoundingClientRect();
        // Normalise mouse position to -1…+1 from centre
        const mx = (e.clientX - rect.left) / rect.width - 0.5;
        const my = (e.clientY - rect.top) / rect.height - 0.5;

        icons.forEach((icon, i) => {
          const speed = parseFloat(icon.dataset.speed) || (i + 1) * 8;
          const tx = mx * speed;
          const ty = my * speed;
          icon.style.transform = `translate(${tx}px, ${ty}px)`;
        });
      }),
      { passive: true }
    );
  };

  /* --------------------------------------------------------------------
     16. COUNTER ANIMATION
     -------------------------------------------------------------------- */

  const initCounters = () => {
    const counters = $$('.counter[data-target]');
    if (!counters.length) return;

    const animate = (el) => {
      const target = parseInt(el.dataset.target, 10);
      if (isNaN(target)) return;

      const duration = 1500; // ms
      const start = performance.now();

      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        // Ease-out quad
        const ease = 1 - (1 - progress) * (1 - progress);
        el.textContent = Math.floor(ease * target);
        if (progress < 1) requestAnimationFrame(step);
        else el.textContent = target; // ensure exact final value
      };

      requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animate(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach((c) => observer.observe(c));
  };

  /* --------------------------------------------------------------------
     17. CURRENTLY LEARNING — Pulsing Indicator
     -------------------------------------------------------------------- */

  const initLearningPulse = () => {
    const items = $$('.currently-learning .learning-item');
    if (!items.length) return;

    let activeIdx = 0;
    const INTERVAL = 3000; // cycle every 3 s

    // Inject a pulsing dot into each item (if not already present)
    items.forEach((item) => {
      if (!item.querySelector('.pulse-dot')) {
        const dot = document.createElement('span');
        dot.classList.add('pulse-dot');
        item.prepend(dot);
      }
    });

    // Inject pulse-dot styles
    if (!$('#pulse-dot-styles')) {
      const style = document.createElement('style');
      style.id = 'pulse-dot-styles';
      style.textContent = `
        .pulse-dot {
          display: inline-block;
          width: 8px; height: 8px;
          border-radius: 50%;
          background: #6c63ff;
          margin-right: 8px;
          vertical-align: middle;
          opacity: 0.35;
          transition: opacity 0.4s, transform 0.4s;
          flex-shrink: 0;
        }
        .learning-item.active-learning .pulse-dot {
          opacity: 1;
          animation: pulseDot 1.2s ease-in-out infinite;
        }
        @keyframes pulseDot {
          0%, 100% { transform: scale(1);   box-shadow: 0 0 0 0 rgba(108,99,255,0.5); }
          50%       { transform: scale(1.4); box-shadow: 0 0 0 6px rgba(108,99,255,0); }
        }
      `;
      document.head.appendChild(style);
    }

    const cycle = () => {
      items.forEach((item, i) => {
        item.classList.toggle('active-learning', i === activeIdx);
      });
      activeIdx = (activeIdx + 1) % items.length;
    };

    cycle();
    setInterval(cycle, INTERVAL);
  };

  /* --------------------------------------------------------------------
     19. EASTER EGG — Konami Code
     -------------------------------------------------------------------- */

  const initKonamiCode = () => {
    const sequence = [
      'ArrowUp',
      'ArrowUp',
      'ArrowDown',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ArrowLeft',
      'ArrowRight',
      'b',
      'a',
    ];
    let idx = 0;

    const showMessage = () => {
      const msg = document.createElement('div');
      Object.assign(msg.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%) scale(0)',
        background: 'linear-gradient(135deg, #6c63ff 0%, #00d4ff 100%)',
        color: '#fff',
        padding: '28px 48px',
        borderRadius: '16px',
        fontSize: '1.35rem',
        fontWeight: '700',
        zIndex: '99999',
        textAlign: 'center',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s',
        opacity: '0',
        pointerEvents: 'none',
      });
      msg.textContent = '🎮 You found the secret! Keep coding! 🚀';
      document.body.appendChild(msg);

      // Animate in
      requestAnimationFrame(() => {
        msg.style.transform = 'translate(-50%, -50%) scale(1)';
        msg.style.opacity = '1';
      });

      // Fade out after 3 s
      setTimeout(() => {
        msg.style.transform = 'translate(-50%, -50%) scale(0.8)';
        msg.style.opacity = '0';
        setTimeout(() => msg.remove(), 500);
      }, 3000);
    };

    document.addEventListener('keydown', (e) => {
      if (e.key === sequence[idx]) {
        idx++;
        if (idx === sequence.length) {
          showMessage();
          idx = 0;
        }
      } else {
        idx = e.key === sequence[0] ? 1 : 0;
      }
    });
  };

  /* --------------------------------------------------------------------
     20. PERFORMANCE — Debounced Resize Handler
     -------------------------------------------------------------------- */

  const initResizeHandler = () => {
    // Recalculate any dimension-dependent values on resize
    const onResize = debounce(() => {
      // Refresh navbar height for smooth-scroll offset, etc.
      // (Modules read it at call-time so nothing to cache here.)
    }, 250);

    window.addEventListener('resize', onResize, { passive: true });
  };

  /* ====================================================================
     INIT — Wire everything up
     ==================================================================== */

  initPreloader();
  initNavbar();
  initMobileNav();
  initSmoothScroll();
  initThemeToggle();
  initTypingAnimation();
  initScrollReveal();
  initSkillBars();
  initParticles();
  initProjectFilter();
  initRadarChart();
  initBackToTop();
  initContactForm();
  initScrollIndicator();
  initFloatingIcons();
  initCounters();
  initLearningPulse();
  initResizeHandler();
  initKonamiCode();
});
