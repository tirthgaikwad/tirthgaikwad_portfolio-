/**
 * =============================================================================
 * PORTFOLIO REDESIGN JAVASCRIPT ENGINE
 * =============================================================================
 * High-performance, production-grade Vanilla ES6+ script.
 * Zero external libraries: 100% Native Web APIs (IntersectionObserver,
 * requestAnimationFrame, Web Animations API, Fetch, CSS Variables).
 *
 * Architecture & Design:
 * - GPU-accelerated 3D transforms & lerp-smoothed cursor tracking
 * - Non-blocking passive scroll event listeners with requestAnimationFrame throttling
 * - Adaptive layout detection & Accessibility (prefers-reduced-motion, pointer:fine)
 * - Resilient async resource hydration with fallback timeouts & error boundaries
 * =============================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    /* =========================================================================
     * UTILITIES
     * ========================================================================= */
    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    const debounce = (fn, ms) => {
        let t;
        return (...a) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...a), ms);
        };
    };

    const rafThrottle = fn => {
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

    const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;


    /* =========================================================================
     * 1. initPreloader()
     * Displays a branded loading state with guaranteed minimum display time
     * to eliminate visual flashing and provide smooth screen entrance.
     * ========================================================================= */
    const initPreloader = () => {
        const preloader = $('#preloader');
        if (!preloader) return;

        const minDisplayTime = 1500;
        const startTime = performance.now();
        let isHidden = false;

        const hidePreloader = () => {
            if (isHidden) return;
            isHidden = true;

            const elapsedTime = performance.now() - startTime;
            const remainingTime = Math.max(0, minDisplayTime - elapsedTime);

            setTimeout(() => {
                preloader.classList.add('hidden');
                setTimeout(() => {
                    preloader.style.display = 'none';
                }, 500);
            }, remainingTime);
        };

        if (document.readyState === 'complete') {
            hidePreloader();
        } else {
            window.addEventListener('load', hidePreloader, { once: true });
        }

        // Safety fallback timeout to prevent infinite preloader in edge network drops
        setTimeout(() => {
            if (!isHidden) {
                hidePreloader();
            }
        }, 4000);
    };


    /* =========================================================================
     * 2. initIntroVideo()
     * Manages full-screen introductory video overlay with cinematic fade-in,
     * spinner loading states, autoplay handling, and skip buttons.
     * ========================================================================= */
    const initIntroVideo = () => {
        const overlay = $('#intro-video-overlay');
        const video = $('#intro-video');
        const skipBtn = $('#intro-skip-btn');
        const loading = $('#intro-video-loading');

        if (!overlay || !video) return;

        let hasClosed = false;

        // Cinematic fade-in entrance
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.5s ease-out';
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });

        const closeOverlay = () => {
            if (hasClosed) return;
            hasClosed = true;

            try {
                if (!video.paused) {
                    video.pause();
                }
            } catch (err) {
                // Silent fail
            }

            overlay.classList.add('hidden');
            overlay.style.opacity = '0';

            setTimeout(() => {
                overlay.style.display = 'none';
            }, 1000);
        };

        // When video has buffered enough to play
        video.addEventListener('canplay', () => {
            if (loading) {
                loading.style.display = 'none';
            }
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // Autoplay was prevented by browser policy (e.g. unmuted or power-save)
                    if (loading) loading.style.display = 'none';
                });
            }
        }, { once: true });

        // Video playback completion
        video.addEventListener('ended', closeOverlay);

        // Skip button interaction
        if (skipBtn) {
            skipBtn.addEventListener('click', closeOverlay);
        }

        // Media error fallback - close overlay instantly
        video.addEventListener('error', () => {
            closeOverlay();
        });

        // Maximum timeout fallback for video playback
        setTimeout(() => {
            if (!hasClosed && video.paused) {
                if (loading) loading.style.display = 'none';
            }
        }, 6000);
    };


    /* =========================================================================
     * 3. initNavbar()
     * Scrolled navbar elevation, dynamic link tracking with IntersectionObserver,
     * responsive hamburger drawer toggle, and offset smooth scrolling.
     * ========================================================================= */
    const initNavbar = () => {
        const navbar = $('#navbar');
        const navToggle = $('#nav-toggle') || $('#menu-toggle');
        const navLinks = $('#nav-links') || $('.nav-links');
        const navItems = $$('#nav-links a, .nav-links a');
        const sections = $$('section[id], header[id]');

        // Dynamic scrolled navbar background trigger
        const handleScroll = () => {
            if (window.scrollY > 50) {
                navbar?.classList.add('scrolled');
            } else {
                navbar?.classList.remove('scrolled');
            }
        };

        window.addEventListener('scroll', rafThrottle(handleScroll), { passive: true });
        handleScroll();

        // Mobile drawer toggling
        if (navToggle && navLinks) {
            navToggle.addEventListener('click', () => {
                navToggle.classList.toggle('active');
                navLinks.classList.toggle('active');
            });
        }

        // Close mobile drawer on item selection & smooth scroll with navbar height offset
        navItems.forEach(link => {
            link.addEventListener('click', (e) => {
                const targetHref = link.getAttribute('href');
                if (targetHref && targetHref.startsWith('#')) {
                    e.preventDefault();
                    const targetEl = $(targetHref);
                    if (targetEl) {
                        const navOffset = navbar ? navbar.offsetHeight : 80;
                        const elementPosition = targetEl.getBoundingClientRect().top + window.pageYOffset;
                        const offsetPosition = elementPosition - navOffset;

                        window.scrollTo({
                            top: offsetPosition,
                            behavior: 'smooth'
                        });

                        // Dismiss drawer
                        if (navToggle && navLinks) {
                            navToggle.classList.remove('active');
                            navLinks.classList.remove('active');
                        }
                    }
                }
            });
        });

        // Active navigation link tracking via IntersectionObserver
        if ('IntersectionObserver' in window && sections.length) {
            const sectionObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const currentId = entry.target.getAttribute('id');
                        navItems.forEach(link => {
                            const linkHref = link.getAttribute('href');
                            if (linkHref === `#${currentId}`) {
                                link.classList.add('active');
                            } else {
                                link.classList.remove('active');
                            }
                        });
                    }
                });
            }, {
                threshold: 0.3,
                rootMargin: '-80px 0px -20% 0px'
            });

            sections.forEach(sec => sectionObserver.observe(sec));
        }
    };


    /* =========================================================================
     * 4. initCursor()
     * Fluid custom cursor with instant dot positioning, lerp-lagged outer ring,
     * interactive element scaling, and physics-based magnetic button attraction.
     * ========================================================================= */
    const initCursor = () => {
        const dot = $('#cursor-dot');
        const ring = $('#cursor-ring');

        if (!dot || !ring) return;

        // Strict device & accessibility checks
        const isFinePointer = window.matchMedia('(pointer: fine)').matches;
        if (!isFinePointer || window.innerWidth <= 768) {
            dot.style.display = 'none';
            ring.style.display = 'none';
            return;
        }

        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;
        let ringX = mouseX;
        let ringY = mouseY;
        let cursorActive = false;

        // Immediate dot tracking on mousemove
        window.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;

            if (!cursorActive) {
                cursorActive = true;
                dot.style.opacity = '1';
                ring.style.opacity = '1';
            }

            dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
        }, { passive: true });

        // Lerp loop for ring follow animation
        if (!prefersReducedMotion()) {
            const lerpFactor = 0.15;
            const animateRing = () => {
                ringX += (mouseX - ringX) * lerpFactor;
                ringY += (mouseY - ringY) * lerpFactor;
                ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
                requestAnimationFrame(animateRing);
            };
            requestAnimationFrame(animateRing);
        } else {
            // Static positioning without animation for reduced-motion preference
            window.addEventListener('mousemove', (e) => {
                ring.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
            }, { passive: true });
        }

        // Interactive hover states delegation
        const interactiveSelector = 'a, button, .filter-pill, .project-filter, input, textarea, .project-card, .social-link, .tech-chip';

        document.addEventListener('mouseover', (e) => {
            if (e.target.closest(interactiveSelector)) {
                dot.classList.add('active');
                ring.classList.add('active');
            }
        });

        document.addEventListener('mouseout', (e) => {
            if (e.target.closest(interactiveSelector)) {
                dot.classList.remove('active');
                ring.classList.remove('active');
            }
        });

        // Magnetic pull effect on call-to-action buttons & filter pills
        const magneticElements = $$('.btn, .nav-cta-btn, .filter-pill, .project-filter');
        magneticElements.forEach(elem => {
            elem.addEventListener('mousemove', (e) => {
                const rect = elem.getBoundingClientRect();
                const elemCenterX = rect.left + rect.width / 2;
                const elemCenterY = rect.top + rect.height / 2;
                const deltaX = (e.clientX - elemCenterX) * 0.15;
                const deltaY = (e.clientY - elemCenterY) * 0.15;

                elem.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
            });

            elem.addEventListener('mouseleave', () => {
                elem.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
                elem.style.transform = 'translate3d(0, 0, 0)';
                setTimeout(() => {
                    elem.style.transition = '';
                }, 300);
            });
        });
    };


    /* =========================================================================
     * 5. initTyping()
     * Perpetual typewriter rotation effect featuring designated engineering titles.
     * ========================================================================= */
    const initTyping = () => {
        const textElement = $('#typing-text');
        if (!textElement) return;

        const phrases = [
            'Java Programmer',
            'AI & DS Student',
            'Web Project Builder',
            'Future ML Engineer'
        ];

        let phraseIndex = 0;
        let charIndex = 0;
        let isDeleting = false;
        const typingSpeed = 100;
        const deleteSpeed = 50;
        const pauseAtEnd = 1500;
        const pauseBeforeDelete = 500;

        const type = () => {
            const currentPhrase = phrases[phraseIndex];

            if (!isDeleting) {
                charIndex++;
                textElement.textContent = currentPhrase.substring(0, charIndex);

                if (charIndex === currentPhrase.length) {
                    // Complete phrase typed - pause before starting deletion
                    setTimeout(() => {
                        isDeleting = true;
                        setTimeout(type, pauseBeforeDelete);
                    }, pauseAtEnd);
                    return;
                }
                setTimeout(type, typingSpeed);
            } else {
                charIndex--;
                textElement.textContent = currentPhrase.substring(0, charIndex);

                if (charIndex === 0) {
                    // Word wiped - move to next phrase
                    isDeleting = false;
                    phraseIndex = (phraseIndex + 1) % phrases.length;
                    setTimeout(type, pauseBeforeDelete);
                    return;
                }
                setTimeout(type, deleteSpeed);
            }
        };

        // Initial launch delay
        setTimeout(type, 800);
    };


    /* =========================================================================
     * 6. initParticles()
     * Generates 40 ambient floating particles inside the hero stage, animated
     * via the native Web Animations API with randomized trajectory and timing.
     * ========================================================================= */
    const initParticles = () => {
        const container = $('#particles');
        if (!container) return;

        container.innerHTML = '';
        const particleCount = 40;

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';

            const size = Math.floor(Math.random() * 3) + 1; // 1-3px
            const initialX = Math.random() * 100; // 0 - 100%
            const initialY = Math.random() * 100; // 0 - 100%
            const baseOpacity = (Math.random() * 0.2 + 0.1).toFixed(2); // 0.1 - 0.3

            particle.style.position = 'absolute';
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.borderRadius = '50%';
            particle.style.left = `${initialX}%`;
            particle.style.top = `${initialY}%`;
            particle.style.backgroundColor = 'var(--text-primary, #D5D5D0)';
            particle.style.opacity = baseOpacity;
            particle.style.pointerEvents = 'none';

            container.appendChild(particle);

            // Animate using Web Animations API if user has not requested reduced motion
            if (!prefersReducedMotion()) {
                const duration = (Math.random() * 10 + 15) * 1000; // 15s to 25s
                const travelDistance = -(Math.random() * 120 + 80); // Upward float
                const driftDistance = (Math.random() - 0.5) * 40; // Horizontal drift

                particle.animate([
                    {
                        transform: 'translate3d(0, 0, 0)',
                        opacity: baseOpacity
                    },
                    {
                        transform: `translate3d(${driftDistance * 0.5}px, ${travelDistance * 0.5}px, 0)`,
                        opacity: (parseFloat(baseOpacity) * 1.3).toFixed(2),
                        offset: 0.5
                    },
                    {
                        transform: `translate3d(${driftDistance}px, ${travelDistance}px, 0)`,
                        opacity: 0
                    }
                ], {
                    duration: duration,
                    iterations: Infinity,
                    delay: Math.random() * 5000,
                    easing: 'linear'
                });
            }
        }
    };


    /* =========================================================================
     * 7. initParticleInteraction()
     * Coordinates an interactive radial ambient glow that follows the cursor
     * over the hero background layer using RAF throttling.
     * ========================================================================= */
    const initParticleInteraction = () => {
        const heroSection = $('#home') || $('.hero');
        const heroGradient = $('.hero-bg-gradient');

        if (!heroSection || !heroGradient) return;

        const updateGradient = (e) => {
            const rect = heroSection.getBoundingClientRect();
            const posX = e.clientX - rect.left;
            const posY = e.clientY - rect.top;

            heroGradient.style.background = `radial-gradient(circle 420px at ${posX}px ${posY}px, rgba(213, 213, 208, 0.04) 0%, transparent 80%)`;
        };

        heroSection.addEventListener('mousemove', rafThrottle(updateGradient), { passive: true });

        heroSection.addEventListener('mouseleave', () => {
            heroGradient.style.background = '';
        });
    };


    /* =========================================================================
     * 8. initSkillBars()
     * Triggers progress bar width animation when skill items enter the viewport.
     * ========================================================================= */
    const initSkillBars = () => {
        const skillItems = $$('.skill-item');
        if (!skillItems.length) return;

        // Reset all skill progress elements initially to zero width
        skillItems.forEach(item => {
            const progressBar = item.querySelector('.skill-progress');
            if (progressBar) {
                progressBar.style.width = '0%';
            }
        });

        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const progressBar = entry.target.querySelector('.skill-progress');
                    if (progressBar) {
                        const targetWidth = progressBar.getAttribute('data-progress');
                        if (targetWidth) {
                            progressBar.style.transition = 'width 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
                            progressBar.style.width = `${targetWidth}%`;
                        }
                    }
                    obs.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.5
        });

        skillItems.forEach(item => observer.observe(item));
    };


    /* =========================================================================
     * 9. initSkillFilters()
     * Categorical tab filters for developer skill cards with smooth fading.
     * ========================================================================= */
    const initSkillFilters = () => {
        const filterPills = $$('.filter-pill[data-skill-filter]');
        const skillCategories = $$('.skill-category[data-skill-category]');

        if (!filterPills.length || !skillCategories.length) return;

        filterPills.forEach(pill => {
            pill.addEventListener('click', () => {
                filterPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                const filterValue = pill.getAttribute('data-skill-filter');

                skillCategories.forEach(category => {
                    const categoryData = category.getAttribute('data-skill-category') || '';
                    const categoryTokens = categoryData.split(' ');
                    const isMatched = (filterValue === 'all' || categoryTokens.includes(filterValue));

                    if (isMatched) {
                        category.style.display = '';
                        requestAnimationFrame(() => {
                            category.style.opacity = '1';
                            category.style.transform = 'translateY(0) scale(1)';
                        });
                    } else {
                        category.style.opacity = '0';
                        category.style.transform = 'translateY(12px) scale(0.97)';
                        setTimeout(() => {
                            // Check again in case rapid clicking occurred
                            if (pill.getAttribute('data-skill-filter') !== 'all' && !categoryTokens.includes(pill.getAttribute('data-skill-filter'))) {
                                category.style.display = 'none';
                            }
                        }, 250);
                    }
                });
            });
        });
    };


    /* =========================================================================
     * 10. initRadarChart()
     * Generates a 280x280 SVG radar polygon chart centered at (140, 140)
     * with 5 concentric levels, 6 labeled axes, vertex dots, and expansion.
     * ========================================================================= */
    const initRadarChart = () => {
        const container = $('#radar-chart');
        if (!container) return;

        container.innerHTML = '';

        const chartSize = 280;
        const center = chartSize / 2; // 140
        const maxRadius = 90;
        const svgNS = 'http://www.w3.org/2000/svg';

        const skillsData = [
            { label: 'Java', value: 65 },
            { label: 'Python', value: 40 },
            { label: 'C++', value: 35 },
            { label: 'HTML', value: 75 },
            { label: 'CSS', value: 70 },
            { label: 'JavaScript', value: 45 }
        ];

        const axisCount = skillsData.length;
        const angleStep = (Math.PI * 2) / axisCount;

        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('viewBox', `0 0 ${chartSize} ${chartSize}`);
        svg.style.overflow = 'visible';

        // 1. Concentric polygon grid levels (20%, 40%, 60%, 80%, 100%)
        const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
        gridLevels.forEach(levelRatio => {
            const levelRadius = maxRadius * levelRatio;
            const gridPoly = document.createElementNS(svgNS, 'polygon');
            let pointsStr = '';

            for (let i = 0; i < axisCount; i++) {
                const angle = i * angleStep - Math.PI / 2;
                const ptX = center + levelRadius * Math.cos(angle);
                const ptY = center + levelRadius * Math.sin(angle);
                pointsStr += `${ptX.toFixed(2)},${ptY.toFixed(2)} `;
            }

            gridPoly.setAttribute('points', pointsStr.trim());
            gridPoly.setAttribute('fill', 'none');
            gridPoly.setAttribute('stroke', '#303237');
            gridPoly.setAttribute('stroke-width', '1');
            gridPoly.setAttribute('stroke-dasharray', levelRatio === 1.0 ? 'none' : '2,2');
            svg.appendChild(gridPoly);
        });

        // 2. Radial axis lines & Text labels
        skillsData.forEach((skill, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const edgeX = center + maxRadius * Math.cos(angle);
            const edgeY = center + maxRadius * Math.sin(angle);

            // Axis line
            const axisLine = document.createElementNS(svgNS, 'line');
            axisLine.setAttribute('x1', center);
            axisLine.setAttribute('y1', center);
            axisLine.setAttribute('x2', edgeX.toFixed(2));
            axisLine.setAttribute('y2', edgeY.toFixed(2));
            axisLine.setAttribute('stroke', '#303237');
            axisLine.setAttribute('stroke-width', '1');
            svg.appendChild(axisLine);

            // Axis label
            const labelDist = maxRadius + 22;
            const labelX = center + labelDist * Math.cos(angle);
            const labelY = center + labelDist * Math.sin(angle);

            const textElem = document.createElementNS(svgNS, 'text');
            textElem.setAttribute('x', labelX.toFixed(2));
            textElem.setAttribute('y', labelY.toFixed(2));
            textElem.setAttribute('fill', '#85878C');
            textElem.setAttribute('font-size', '11px');
            textElem.setAttribute('font-family', "'JetBrains Mono', 'Inter', monospace");
            textElem.setAttribute('font-weight', '500');
            textElem.setAttribute('text-anchor', 'middle');
            textElem.setAttribute('dominant-baseline', 'central');
            textElem.textContent = skill.label;
            svg.appendChild(textElem);
        });

        // 3. Data Polygon & Dots (Initial collapsed state)
        const dataPolygon = document.createElementNS(svgNS, 'polygon');
        let collapsedPoints = '';
        let targetPoints = '';
        const dotsList = [];

        skillsData.forEach((skill, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const skillRadius = maxRadius * (skill.value / 100);
            const targetX = center + skillRadius * Math.cos(angle);
            const targetY = center + skillRadius * Math.sin(angle);

            collapsedPoints += `${center},${center} `;
            targetPoints += `${targetX.toFixed(2)},${targetY.toFixed(2)} `;

            // Vertex circle
            const dot = document.createElementNS(svgNS, 'circle');
            dot.setAttribute('cx', center);
            dot.setAttribute('cy', center);
            dot.setAttribute('r', '3');
            dot.setAttribute('fill', '#D5D5D0');
            dot.style.opacity = '0';
            dot.style.transition = 'all 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
            svg.appendChild(dot);

            dotsList.push({ dot, targetX, targetY });
        });

        dataPolygon.setAttribute('points', collapsedPoints.trim());
        dataPolygon.setAttribute('stroke', '#D5D5D0');
        dataPolygon.setAttribute('stroke-width', '1.5');
        dataPolygon.setAttribute('fill', 'rgba(213, 213, 208, 0.1)');
        dataPolygon.style.transition = 'all 1.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
        svg.appendChild(dataPolygon);

        container.appendChild(svg);

        // 4. Scroll triggered expansion on IntersectionObserver
        const chartObserver = new IntersectionObserver((entries, obs) => {
            if (entries[0].isIntersecting) {
                setTimeout(() => {
                    dataPolygon.setAttribute('points', targetPoints.trim());
                    dotsList.forEach(item => {
                        item.dot.setAttribute('cx', item.targetX.toFixed(2));
                        item.dot.setAttribute('cy', item.targetY.toFixed(2));
                        item.dot.style.opacity = '1';
                    });
                }, 200);
                obs.disconnect();
            }
        }, { threshold: 0.25 });

        chartObserver.observe(container);
    };


    /* =========================================================================
     * 11. initProjectFilters()
     * Interactive project category filters supporting scale and stagger delay.
     * ========================================================================= */
    const initProjectFilters = () => {
        const filterButtons = $$('.project-filter[data-filter]');
        const projectCards = $$('.project-card');

        if (!filterButtons.length || !projectCards.length) return;

        filterButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                filterButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const filterValue = btn.getAttribute('data-filter');
                let matchCounter = 0;

                projectCards.forEach(card => {
                    const categoriesAttr = card.getAttribute('data-category') || '';
                    const categories = categoriesAttr.split(' ');
                    const isMatch = (filterValue === 'all' || categories.includes(filterValue));

                    if (isMatch) {
                        card.style.display = 'block';
                        setTimeout(() => {
                            card.style.opacity = '1';
                            card.style.transform = 'scale(1)';
                        }, matchCounter * 50);
                        matchCounter++;
                    } else {
                        card.style.opacity = '0';
                        card.style.transform = 'scale(0.95)';
                        setTimeout(() => {
                            if (card.style.opacity === '0') {
                                card.style.display = 'none';
                            }
                        }, 300);
                    }
                });
            });
        });
    };


    /* =========================================================================
     * 12. initScrollReveal()
     * Viewport intersection scroll reveal coordinator with staggered delays
     * and specialized motion variants for cards, timelines, and statistics.
     * ========================================================================= */
    const initScrollReveal = () => {
        const revealElements = $$('.reveal');
        if (!revealElements.length) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = entry.target;
                    target.classList.add('active');

                    // Specialized stagger and directional animations on child components
                    const childCards = target.querySelectorAll(
                        '.highlight-card, .stat-card, .project-card, .achievement-card, .service-card, .timeline-item'
                    );

                    childCards.forEach((child, index) => {
                        child.style.transitionDelay = `${index * 80}ms`;

                        // Differentiate animation profiles based on component semantics
                        if (child.classList.contains('highlight-card') || child.classList.contains('project-card') || child.classList.contains('achievement-card') || child.classList.contains('service-card')) {
                            child.style.opacity = '0';
                            child.style.transform = 'translate3d(0, 30px, 0)';
                            requestAnimationFrame(() => {
                                child.style.transition = 'opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)';
                                child.style.opacity = '1';
                                child.style.transform = 'translate3d(0, 0, 0)';
                            });
                        } else if (child.classList.contains('stat-card')) {
                            child.style.opacity = '0';
                            child.style.transform = 'scale(0.85)';
                            requestAnimationFrame(() => {
                                child.style.transition = 'opacity 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
                                child.style.opacity = '1';
                                child.style.transform = 'scale(1)';
                            });
                        } else if (child.classList.contains('timeline-item')) {
                            const isLeft = child.classList.contains('left');
                            const initialX = isLeft ? -40 : 40;
                            child.style.opacity = '0';
                            child.style.transform = `translate3d(${initialX}px, 0, 0)`;
                            requestAnimationFrame(() => {
                                child.style.transition = 'opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
                                child.style.opacity = '1';
                                child.style.transform = 'translate3d(0, 0, 0)';
                            });
                        }
                    });
                }
            });
        }, {
            threshold: 0.15,
            rootMargin: '-50px'
        });

        revealElements.forEach(el => observer.observe(el));
    };


    /* =========================================================================
     * 13. initBackToTop()
     * Smooth scroll-to-top button with scroll-depth visibility toggle.
     * ========================================================================= */
    const initBackToTop = () => {
        const backToTopBtn = $('#back-to-top');
        if (!backToTopBtn) return;

        const updateVisibility = () => {
            if (window.scrollY > 300) {
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
            }
        };

        window.addEventListener('scroll', rafThrottle(updateVisibility), { passive: true });
        updateVisibility();

        backToTopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    };


    /* =========================================================================
     * 14. initContactForm()
     * Real-time field validation, floating labels, animated submission feedback,
     * and automatic form reset states.
     * ========================================================================= */
    const initContactForm = () => {
        const form = $('#contact-form');
        if (!form) return;

        const inputs = $$('input, textarea', form);
        const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('.submit-btn');

        // Floating label filled state management
        inputs.forEach(input => {
            const formGroup = input.closest('.form-group') || input.parentElement;

            const handleFilledCheck = () => {
                if (input.value.trim() !== '') {
                    formGroup?.classList.add('filled');
                } else {
                    formGroup?.classList.remove('filled');
                }
            };

            input.addEventListener('focus', () => {
                formGroup?.classList.add('focused');
            });

            input.addEventListener('blur', () => {
                formGroup?.classList.remove('focused');
                handleFilledCheck();
            });

            input.addEventListener('input', () => {
                handleFilledCheck();
                // Clear validation red border on typing
                input.style.borderColor = '';
            });

            handleFilledCheck();
        });

        // Form submission handling
        form.addEventListener('submit', (e) => {
            e.preventDefault();

            let isFormValid = true;

            inputs.forEach(input => {
                if (!input.value.trim()) {
                    isFormValid = false;
                    input.style.borderColor = '#FF0055';
                } else {
                    input.style.borderColor = '';
                }
            });

            if (!isFormValid || !submitBtn) return;

            const originalBtnText = submitBtn.textContent;
            const originalBg = submitBtn.style.backgroundColor;

            submitBtn.textContent = 'Sending...';
            submitBtn.disabled = true;

            // Simulate dispatch network delay
            setTimeout(() => {
                submitBtn.textContent = 'Message Sent!';
                submitBtn.style.backgroundColor = 'var(--color-success, #6B7A6B)';

                setTimeout(() => {
                    submitBtn.textContent = originalBtnText || 'Send Message';
                    submitBtn.style.backgroundColor = originalBg;
                    submitBtn.disabled = false;
                    form.reset();

                    inputs.forEach(inp => {
                        const grp = inp.closest('.form-group') || inp.parentElement;
                        grp?.classList.remove('filled');
                        inp.style.borderColor = '';
                    });
                }, 3000);
            }, 1500);
        });
    };


    /* =========================================================================
     * 15. initScrollIndicator()
     * Calculates scroll progress through the hero section and smoothly fades out
     * the scroll indicator as user scrolls past 50% of the hero viewport.
     * ========================================================================= */
    const initScrollIndicator = () => {
        const indicator = $('#scroll-indicator');
        const heroSection = $('#home') || $('.hero');

        if (!indicator || !heroSection) return;

        const updateIndicatorOpacity = () => {
            const heroHeight = heroSection.offsetHeight || window.innerHeight;
            const scrollPos = window.scrollY;
            const threshold = heroHeight * 0.5;

            let computedOpacity = 1 - (scrollPos / threshold);
            computedOpacity = Math.max(0, Math.min(1, computedOpacity));

            indicator.style.opacity = computedOpacity.toString();
            indicator.style.pointerEvents = computedOpacity <= 0.05 ? 'none' : 'auto';
        };

        window.addEventListener('scroll', rafThrottle(updateIndicatorOpacity), { passive: true });
        updateIndicatorOpacity();
    };


    /* =========================================================================
     * 16. initEasterEgg()
     * Konami Code easter egg listener (Up, Up, Down, Down, Left, Right, Left, Right, B, A).
     * Triggers celebratory secret notification badge on execution.
     * ========================================================================= */
    const initEasterEgg = () => {
        const easterEgg = $('#easter-egg');
        if (!easterEgg) return;

        const konamiKeyCodes = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
        let konamiPointer = 0;

        window.addEventListener('keydown', (e) => {
            const pressedCode = e.keyCode || e.which;

            if (pressedCode === konamiKeyCodes[konamiPointer]) {
                konamiPointer++;
                if (konamiPointer === konamiKeyCodes.length) {
                    easterEgg.classList.add('show');
                    setTimeout(() => {
                        easterEgg.classList.remove('show');
                    }, 3000);
                    konamiPointer = 0;
                }
            } else {
                konamiPointer = (pressedCode === konamiKeyCodes[0]) ? 1 : 0;
            }
        });
    };


    /* =========================================================================
     * 17. initParallax()
     * Lightweight multi-layer hero typography & avatar parallax scroll effect.
     * ========================================================================= */
    const initParallax = () => {
        if (prefersReducedMotion()) return;

        const heroName = $('.hero-name');
        const heroTitle = $('.hero-title');
        const heroTagline = $('.hero-tagline');
        const heroImage = $('.hero-image');

        if (!heroName && !heroTitle && !heroTagline && !heroImage) return;

        const performParallax = () => {
            const currentScroll = window.scrollY;
            if (currentScroll > window.innerHeight) return;

            const subtleOpacity = Math.max(0, 1 - (currentScroll / (window.innerHeight * 0.75)));

            if (heroName) {
                heroName.style.transform = `translate3d(0, ${currentScroll * 0.15}px, 0)`;
                heroName.style.opacity = subtleOpacity.toFixed(3);
            }
            if (heroTitle) {
                heroTitle.style.transform = `translate3d(0, ${currentScroll * 0.1}px, 0)`;
            }
            if (heroTagline) {
                heroTagline.style.transform = `translate3d(0, ${currentScroll * 0.08}px, 0)`;
            }
            if (heroImage) {
                heroImage.style.transform = `translate3d(0, ${currentScroll * -0.08}px, 0)`;
            }
        };

        window.addEventListener('scroll', rafThrottle(performParallax), { passive: true });
    };


    /* =========================================================================
     * 18. initCardTilt()
     * Interactive 3D perspective tilt effect on project, highlight, service,
     * and achievement cards with smooth spring reset on mouseleave.
     * ========================================================================= */
    const initCardTilt = () => {
        if (window.innerWidth <= 768 || prefersReducedMotion()) return;

        const tiltCards = $$('.project-card, .highlight-card, .achievement-card, .service-card');
        if (!tiltCards.length) return;

        const maxTiltAngle = 4; // Max +/- 4 degrees

        tiltCards.forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const cardX = e.clientX - rect.left;
                const cardY = e.clientY - rect.top;

                const centerX = rect.width / 2;
                const centerY = rect.height / 2;

                const normalX = (cardX - centerX) / centerX;
                const normalY = (cardY - centerY) / centerY;

                const rotateX = -(normalY * maxTiltAngle).toFixed(2);
                const rotateY = (normalX * maxTiltAngle).toFixed(2);

                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translate3d(0, -4px, 0)`;
            });

            card.addEventListener('mouseleave', () => {
                card.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
                card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translate3d(0, 0, 0)';
                setTimeout(() => {
                    card.style.transition = '';
                }, 400);
            });
        });
    };


    /* =========================================================================
     * 19. initCounters()
     * Smooth ease-out cubic animated metric counters driven by performance.now().
     * ========================================================================= */
    const initCounters = () => {
        const counters = $$('.stat-number[data-target]');
        if (!counters.length) return;

        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);

        const animateCounter = (el) => {
            const targetVal = parseFloat(el.getAttribute('data-target')) || 0;
            const suffix = el.getAttribute('data-suffix') || '';
            const animDuration = 2000;
            const startTime = performance.now();

            const updateNumber = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / animDuration, 1);
                const currentVal = Math.floor(easeOutCubic(progress) * targetVal);

                el.textContent = `${currentVal}${progress >= 1 ? suffix : ''}`;

                if (progress < 1) {
                    requestAnimationFrame(updateNumber);
                }
            };

            requestAnimationFrame(updateNumber);
        };

        const counterObserver = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animateCounter(entry.target);
                    obs.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.5
        });

        counters.forEach(c => counterObserver.observe(c));
    };


    /* =========================================================================
     * 20. initGitHub()
     * Asynchronously hydrates public GitHub profile statistics and latest repos
     * via unauthenticated GitHub REST API with sessionStorage caching & timeout.
     * ========================================================================= */
    const initGitHub = () => {
        const username = 'tirthgaikwad';

        const avatarImg = $('#github-avatar-img');
        const nameEl = $('#github-name');
        const bioEl = $('#github-bio');
        const reposCountEl = $('#github-repos-count');
        const followersEl = $('#github-followers');
        const followingEl = $('#github-following');
        const loadingEl = $('#github-loading');
        const reposContainer = $('#github-repos');
        const errorEl = $('#github-error');

        const renderProfile = (profile) => {
            if (avatarImg && profile.avatar_url) avatarImg.src = profile.avatar_url;
            if (nameEl) nameEl.textContent = profile.name || profile.login || 'Tirth Gaikwad';
            if (bioEl) bioEl.textContent = profile.bio || 'AI & Data Science Student';
            if (reposCountEl) reposCountEl.textContent = profile.public_repos ?? '0';
            if (followersEl) followersEl.textContent = profile.followers ?? '0';
            if (followingEl) followingEl.textContent = profile.following ?? '0';
        };

        const renderRepos = (repos) => {
            if (loadingEl) loadingEl.style.display = 'none';
            if (reposContainer && Array.isArray(repos)) {
                reposContainer.innerHTML = repos.slice(0, 6).map(repo => `
                    <div class="github-repo-card">
                        <h4><a href="${repo.html_url}" target="_blank" rel="noopener noreferrer">${repo.name}</a></h4>
                        <p>${repo.description || 'No description'}</p>
                        <div class="github-repo-meta">
                            <span class="github-repo-lang">${repo.language || 'N/A'}</span>
                            <span>⭐ ${repo.stargazers_count ?? 0}</span>
                            <span>🔀 ${repo.forks_count ?? 0}</span>
                        </div>
                    </div>
                `.trim()).join('');
            }
        };

        // Check sessionStorage cache first for instantaneous offline load
        let hasCachedData = false;
        try {
            const cachedProfile = sessionStorage.getItem('github_profile');
            const cachedRepos = sessionStorage.getItem('github_repos');

            if (cachedProfile && cachedRepos) {
                renderProfile(JSON.parse(cachedProfile));
                renderRepos(JSON.parse(cachedRepos));
                hasCachedData = true;
            }
        } catch (e) {
            // Ignore storage read errors
        }

        if (hasCachedData) return;

        // AbortController with 5-second timeout window
        const abortCtrl = new AbortController();
        const timeoutId = setTimeout(() => {
            abortCtrl.abort();
        }, 5000);

        const profilePromise = fetch(`https://api.github.com/users/${username}`, {
            signal: abortCtrl.signal
        }).then(res => {
            if (!res.ok) throw new Error('Profile fetch failed');
            return res.json();
        });

        const reposPromise = fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=6`, {
            signal: abortCtrl.signal
        }).then(res => {
            if (!res.ok) throw new Error('Repos fetch failed');
            return res.json();
        });

        Promise.allSettled([profilePromise, reposPromise])
            .then(([profileResult, reposResult]) => {
                clearTimeout(timeoutId);

                let fetchError = false;

                if (profileResult.status === 'fulfilled' && profileResult.value) {
                    renderProfile(profileResult.value);
                    try {
                        sessionStorage.setItem('github_profile', JSON.stringify(profileResult.value));
                    } catch (e) {}
                } else {
                    fetchError = true;
                }

                if (reposResult.status === 'fulfilled' && Array.isArray(reposResult.value)) {
                    renderRepos(reposResult.value);
                    try {
                        sessionStorage.setItem('github_repos', JSON.stringify(reposResult.value));
                    } catch (e) {}
                } else {
                    fetchError = true;
                }

                if (fetchError) {
                    if (loadingEl) loadingEl.style.display = 'none';
                    if (errorEl) errorEl.style.display = 'block';
                }
            })
            .catch(() => {
                clearTimeout(timeoutId);
                if (loadingEl) loadingEl.style.display = 'none';
                if (errorEl) errorEl.style.display = 'block';
            });
    };


    /* =========================================================================
     * 21. initSectionHeadingReveal()
     * Elegant horizontal clip-path reveal on section titles when entering viewport.
     * ========================================================================= */
    const initSectionHeadingReveal = () => {
        const sectionTitles = $$('.section-title');
        if (!sectionTitles.length) return;

        if (prefersReducedMotion()) {
            sectionTitles.forEach(title => title.classList.add('revealed'));
            return;
        }

        sectionTitles.forEach(title => {
            title.style.clipPath = 'inset(0 100% 0 0)';
            title.style.transition = 'clip-path 1.1s cubic-bezier(0.19, 1, 0.22, 1)';
        });

        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    entry.target.style.clipPath = 'inset(0 0% 0 0)';
                    obs.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.25
        });

        sectionTitles.forEach(title => observer.observe(title));
    };


    /* =========================================================================
     * 22. CALL ALL INITIALIZATION FUNCTIONS
     * Order of execution strictly preserved per architectural specifications.
     * ========================================================================= */
    initPreloader();
    initIntroVideo();
    initNavbar();
    initCursor();
    initTyping();
    initParticles();
    initParticleInteraction();
    initSkillBars();
    initSkillFilters();
    initRadarChart();
    initProjectFilters();
    initScrollReveal();
    initBackToTop();
    initContactForm();
    initScrollIndicator();
    initEasterEgg();
    initParallax();
    initCardTilt();
    initCounters();
    initGitHub();
    initSectionHeadingReveal();

});
