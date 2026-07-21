document.addEventListener('DOMContentLoaded', () => {
    // 0. UTILITY HELPERS
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    const debounce = (fn, ms = 200) => {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn.apply(this, args), ms);
        };
    };

    const rafThrottle = (fn) => {
        let ticking = false;
        return function (...args) {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    fn.apply(this, args);
                    ticking = false;
                });
                ticking = true;
            }
        };
    };

    // 1. PRELOADER
    const initPreloader = () => {
        const preloader = $('#preloader');
        if (!preloader) return;

        const startTime = Date.now();
        const minDisplayTime = 1500;

        window.addEventListener('load', () => {
            const elapsedTime = Date.now() - startTime;
            const remainingTime = Math.max(0, minDisplayTime - elapsedTime);

            setTimeout(() => {
                preloader.classList.add('hidden');
                setTimeout(() => {
                    preloader.style.display = 'none';
                }, 500); // Wait for transition
            }, remainingTime);
        });
    };

    // 2. INTRO VIDEO
    const initIntroVideo = () => {
        const overlay = $('#intro-video-overlay');
        const video = $('#intro-video');
        const skipBtn = $('#intro-skip-btn');
        const loading = $('#intro-video-loading');

        if (!overlay || !video) return;

        const closeOverlay = () => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.style.display = 'none';
                if(video) video.pause();
            }, 500);
        };

        if (video) {
            video.addEventListener('canplay', () => {
                if (loading) loading.style.display = 'none';
                video.play().catch(e => {
                    // Autoplay blocked
                    console.log('Autoplay blocked', e);
                });
            });

            video.addEventListener('ended', closeOverlay);
        }
        
        if (skipBtn) {
            skipBtn.addEventListener('click', closeOverlay);
        }
    };

    // 3. NAVBAR
    const initNavbar = () => {
        const navbar = $('#navbar');
        const navToggle = $('#nav-toggle');
        const navLinks = $('.nav-links');
        const sections = $$('section[id]');
        const navItems = $$('.nav-links a');

        // Scroll state
        window.addEventListener('scroll', rafThrottle(() => {
            if (window.scrollY > 50) {
                navbar?.classList.add('scrolled');
            } else {
                navbar?.classList.remove('scrolled');
            }
        }));

        // Active link tracking
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('id');
                    navItems.forEach(link => {
                        link.classList.remove('active');
                        if (link.getAttribute('href') === `#${id}`) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, { threshold: 0.3, rootMargin: "-50px 0px -50px 0px" });

        sections.forEach(sec => observer.observe(sec));

        // Mobile toggle
        if (navToggle && navLinks) {
            navToggle.addEventListener('click', () => {
                navToggle.classList.toggle('active');
                navLinks.classList.toggle('active');
            });
        }

        // Smooth scroll & close mobile nav
        navItems.forEach(link => {
            link.addEventListener('click', (e) => {
                const targetId = link.getAttribute('href');
                if (targetId.startsWith('#')) {
                    e.preventDefault();
                    const targetSection = $(targetId);
                    if (targetSection) {
                        const navHeight = navbar ? navbar.offsetHeight : 0;
                        window.scrollTo({
                            top: targetSection.offsetTop - navHeight,
                            behavior: 'smooth'
                        });
                        
                        // Close mobile nav
                        if (navToggle && navLinks) {
                            navToggle.classList.remove('active');
                            navLinks.classList.remove('active');
                        }
                    }
                }
            });
        });
    };

    // 4. CUSTOM CURSOR
    const initCursor = () => {
        const dot = $('#cursor-dot');
        const ring = $('#cursor-ring');
        if (!dot || !ring) return;

        // Hide on mobile
        const isMobile = window.matchMedia("(max-width: 768px)").matches;
        if (isMobile) {
            dot.style.display = 'none';
            ring.style.display = 'none';
            return;
        }

        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;
        let ringX = mouseX;
        let ringY = mouseY;

        window.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            
            dot.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
        });

        const animateRing = () => {
            // Smooth follow
            ringX += (mouseX - ringX) * 0.15;
            ringY += (mouseY - ringY) * 0.15;
            ring.style.transform = `translate(${ringX}px, ${ringY}px)`;
            requestAnimationFrame(animateRing);
        };
        requestAnimationFrame(animateRing);

        // Hover effect
        const hoverElements = $$('a, button, .filter-btn, .filter-pill, input, textarea, .project-card');
        hoverElements.forEach(el => {
            el.addEventListener('mouseenter', () => {
                ring.classList.add('hover');
            });
            el.addEventListener('mouseleave', () => {
                ring.classList.remove('hover');
            });
        });
    };

    // 5. TYPING ANIMATION
    const initTyping = () => {
        const textElement = $('#typing-text');
        if (!textElement) return;

        const phrases = ["Java Programmer", "AI & DS Student", "Web Project Builder", "Future ML Engineer"];
        let phraseIndex = 0;
        let charIndex = 0;
        let isDeleting = false;
        let typingDelay = 100;
        const color = '#FF0055'; // Crimson
        textElement.style.color = color;

        const type = () => {
            const currentPhrase = phrases[phraseIndex];
            
            if (isDeleting) {
                textElement.textContent = currentPhrase.substring(0, charIndex - 1);
                charIndex--;
                typingDelay = 50;
            } else {
                textElement.textContent = currentPhrase.substring(0, charIndex + 1);
                charIndex++;
                typingDelay = 100;
            }

            if (!isDeleting && charIndex === currentPhrase.length) {
                isDeleting = true;
                typingDelay = 1500; // Pause at end
            } else if (isDeleting && charIndex === 0) {
                isDeleting = false;
                phraseIndex = (phraseIndex + 1) % phrases.length;
                typingDelay = 500; // Pause before new word
            }

            setTimeout(type, typingDelay);
        };

        setTimeout(type, 1000); // Initial delay
    };

    // 6. PARTICLES BACKGROUND
    const initParticles = () => {
        const container = $('#particles') || document.body;
        const particleCount = 50;
        const colors = ['#FF0055', '#9D00FF', '#CCFF00']; // Crimson, Violet, Lime
        
        // Only if there's a dedicated container, otherwise create it
        let partsContainer = $('#particles');
        if (!partsContainer) {
            partsContainer = document.createElement('div');
            partsContainer.id = 'particles';
            partsContainer.style.position = 'absolute';
            partsContainer.style.top = '0';
            partsContainer.style.left = '0';
            partsContainer.style.width = '100%';
            partsContainer.style.height = '100%';
            partsContainer.style.overflow = 'hidden';
            partsContainer.style.zIndex = '0';
            partsContainer.style.pointerEvents = 'none';
            const homeSec = $('#home');
            if(homeSec) {
                homeSec.insertBefore(partsContainer, homeSec.firstChild);
            }
        }

        for (let i = 0; i < particleCount; i++) {
            const p = document.createElement('div');
            const size = Math.random() * 3 + 1; // 1-4px
            const color = colors[Math.floor(Math.random() * colors.length)];
            const left = Math.random() * 100;
            const animDuration = Math.random() * 10 + 5; // 5-15s
            const delay = Math.random() * 5;
            
            p.style.position = 'absolute';
            p.style.width = `${size}px`;
            p.style.height = `${size}px`;
            p.style.backgroundColor = color;
            p.style.borderRadius = '50%';
            p.style.bottom = '-10px';
            p.style.left = `${left}%`;
            p.style.opacity = Math.random() * 0.5 + 0.2;
            
            // basic CSS animation inline
            p.animate([
                { transform: `translate(0, 0)`, opacity: 0 },
                { opacity: Math.random() * 0.5 + 0.2, offset: 0.1 },
                { transform: `translate(${(Math.random() - 0.5) * 200}px, -100vh)`, opacity: 0 }
            ], {
                duration: animDuration * 1000,
                delay: delay * 1000,
                iterations: Infinity,
                easing: 'linear'
            });

            partsContainer.appendChild(p);
        }
    };

    // 7. SKILL BARS
    const initSkillBars = () => {
        const bars = $$('.skill-progress[data-progress]');
        if (!bars.length) return;

        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const bar = entry.target;
                    const val = bar.getAttribute('data-progress');
                    bar.style.width = '0%';
                    setTimeout(() => {
                        bar.style.transition = 'width 1.5s cubic-bezier(0.2, 0.8, 0.2, 1)';
                        bar.style.width = `${val}%`;
                    }, 100);
                    obs.unobserve(bar); // Only once
                }
            });
        }, { threshold: 0.1 });

        bars.forEach(bar => observer.observe(bar));
    };

    // 8. SKILL FILTER PILLS
    const initSkillFilters = () => {
        const pills = $$('.skill-filter-pills .filter-pill');
        const categories = $$('.skill-category[data-skill-category]');
        if (!pills.length || !categories.length) return;

        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                pills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                
                const filter = pill.getAttribute('data-skill-filter');
                
                categories.forEach(cat => {
                    if (filter === 'all' || cat.getAttribute('data-skill-category') === filter) {
                        cat.style.display = 'block';
                        setTimeout(() => cat.style.opacity = '1', 50);
                    } else {
                        cat.style.opacity = '0';
                        setTimeout(() => cat.style.display = 'none', 300);
                    }
                });
            });
        });
    };

    // 9. RADAR CHART
    const initRadarChart = () => {
        const container = $('#radar-chart');
        if (!container) return;

        // Ensure it's empty
        container.innerHTML = '';
        
        const data = [
            { label: 'Java', value: 65 },
            { label: 'Python', value: 40 },
            { label: 'C++', value: 35 },
            { label: 'HTML', value: 75 },
            { label: 'CSS', value: 70 },
            { label: 'JavaScript', value: 45 }
        ];

        const width = 300;
        const height = 300;
        const center = { x: width / 2, y: height / 2 };
        const radius = Math.min(width, height) / 2 - 40; // padding
        const sides = data.length;
        const angleStep = (Math.PI * 2) / sides;
        
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        
        // Grid lines (Violet)
        const levels = 5;
        for (let level = 1; level <= levels; level++) {
            const r = radius * (level / levels);
            const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            let points = "";
            for (let i = 0; i < sides; i++) {
                const angle = i * angleStep - Math.PI / 2;
                const x = center.x + r * Math.cos(angle);
                const y = center.y + r * Math.sin(angle);
                points += `${x},${y} `;
            }
            polygon.setAttribute("points", points.trim());
            polygon.setAttribute("fill", "none");
            polygon.setAttribute("stroke", "rgba(157, 0, 255, 0.2)");
            polygon.setAttribute("stroke-width", "1");
            svg.appendChild(polygon);
        }

        // Axes and Labels
        data.forEach((d, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const x = center.x + radius * Math.cos(angle);
            const y = center.y + radius * Math.sin(angle);
            
            // Axis
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", center.x);
            line.setAttribute("y1", center.y);
            line.setAttribute("x2", x);
            line.setAttribute("y2", y);
            line.setAttribute("stroke", "rgba(157, 0, 255, 0.2)");
            line.setAttribute("stroke-width", "1");
            svg.appendChild(line);

            // Label
            const textX = center.x + (radius + 20) * Math.cos(angle);
            const textY = center.y + (radius + 20) * Math.sin(angle);
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", textX);
            text.setAttribute("y", textY);
            text.setAttribute("fill", "#fff");
            text.setAttribute("font-size", "12px");
            text.setAttribute("text-anchor", "middle");
            text.setAttribute("dominant-baseline", "middle");
            text.textContent = d.label;
            svg.appendChild(text);
        });

        // Data Polygon (Crimson)
        const dataGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const dataPoly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        let dataPoints = "";
        let initialPoints = ""; // For animation

        data.forEach((d, i) => {
            const angle = i * angleStep - Math.PI / 2;
            const val = d.value / 100;
            const x = center.x + radius * val * Math.cos(angle);
            const y = center.y + radius * val * Math.sin(angle);
            dataPoints += `${x},${y} `;
            initialPoints += `${center.x},${center.y} `;
        });

        dataPoly.setAttribute("points", initialPoints.trim());
        dataPoly.setAttribute("fill", "rgba(255, 0, 85, 0.2)");
        dataPoly.setAttribute("stroke", "rgba(255, 0, 85, 0.8)");
        dataPoly.setAttribute("stroke-width", "2");
        dataPoly.style.transition = "all 1.5s cubic-bezier(0.2, 0.8, 0.2, 1)";
        dataGroup.appendChild(dataPoly);
        svg.appendChild(dataGroup);
        container.appendChild(svg);

        // Animate on scroll
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                setTimeout(() => {
                    dataPoly.setAttribute("points", dataPoints.trim());
                }, 200);
                observer.disconnect();
            }
        }, { threshold: 0.1 });
        observer.observe(container);
    };

    // 10. PROJECT FILTERS
    const initProjectFilters = () => {
        const btns = $$('.filter-btn[data-filter]');
        const cards = $$('.project-card[data-category]');
        if (!btns.length || !cards.length) return;

        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const filter = btn.getAttribute('data-filter');
                
                cards.forEach(card => {
                    const categories = card.getAttribute('data-category') || '';
                    if (filter === 'all' || categories.includes(filter)) {
                        card.style.display = 'block';
                        setTimeout(() => {
                            card.style.opacity = '1';
                            card.style.transform = 'scale(1)';
                        }, 50);
                    } else {
                        card.style.opacity = '0';
                        card.style.transform = 'scale(0.9)';
                        setTimeout(() => card.style.display = 'none', 300);
                    }
                });
            });
        });
    };

    // 11. SCROLL REVEAL
    const initScrollReveal = () => {
        const reveals = $$('.reveal');
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    // Optional: unobserve if we only want to reveal once
                    // observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        reveals.forEach(el => observer.observe(el));
    };

    // 12. BACK TO TOP
    const initBackToTop = () => {
        const btn = $('#back-to-top');
        if (!btn) return;

        window.addEventListener('scroll', rafThrottle(() => {
            if (window.scrollY > 300) {
                btn.classList.add('visible');
            } else {
                btn.classList.remove('visible');
            }
        }));

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    };

    // 13. CONTACT FORM
    const initContactForm = () => {
        const form = $('#contact-form');
        if (!form) return;

        const inputs = $$('input, textarea', form);
        
        // Floating labels logic
        inputs.forEach(input => {
            const updateLabel = () => {
                if (input.value.trim() !== '') {
                    input.classList.add('filled');
                } else {
                    input.classList.remove('filled');
                }
            };
            
            input.addEventListener('focus', updateLabel);
            input.addEventListener('blur', updateLabel);
            input.addEventListener('input', updateLabel);
            updateLabel(); // Initial check
        });

        // Form submit
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            // Basic validation
            let valid = true;
            inputs.forEach(input => {
                if (input.hasAttribute('required') && input.value.trim() === '') {
                    valid = false;
                    input.style.borderColor = '#FF0055';
                } else {
                    input.style.borderColor = ''; // reset
                }
            });

            if (valid) {
                const btn = form.querySelector('button[type="submit"]');
                const originalText = btn.textContent;
                btn.textContent = 'Sending...';
                btn.disabled = true;

                // Simulate send
                setTimeout(() => {
                    btn.textContent = 'Message Sent!';
                    btn.style.backgroundColor = '#CCFF00'; // Lime
                    btn.style.color = '#000';
                    form.reset();
                    inputs.forEach(input => input.classList.remove('filled'));
                    
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.backgroundColor = '';
                        btn.style.color = '';
                        btn.disabled = false;
                    }, 3000);
                }, 1500);
            }
        });
    };

    // 14. SCROLL INDICATOR
    const initScrollIndicator = () => {
        const indicator = $('#scroll-indicator');
        const hero = $('#home');
        if (!indicator || !hero) return;

        window.addEventListener('scroll', rafThrottle(() => {
            const heroBottom = hero.offsetTop + hero.offsetHeight;
            if (window.scrollY > heroBottom - 100) {
                indicator.style.opacity = '0';
                indicator.style.pointerEvents = 'none';
            } else {
                indicator.style.opacity = '1';
                indicator.style.pointerEvents = 'auto';
            }
        }));
    };

    // 15. EASTER EGG
    const initEasterEgg = () => {
        const egg = $('#easter-egg');
        if (!egg) return;

        const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
        let konamiIndex = 0;

        window.addEventListener('keydown', (e) => {
            if (e.key === konamiCode[konamiIndex] || e.key.toLowerCase() === konamiCode[konamiIndex].toLowerCase()) {
                konamiIndex++;
                if (konamiIndex === konamiCode.length) {
                    // Activate easter egg
                    egg.classList.add('show');
                    setTimeout(() => {
                        egg.classList.remove('show');
                    }, 3000);
                    konamiIndex = 0;
                }
            } else {
                konamiIndex = 0;
            }
        });
    };

    // 16. FLOATING BADGES ANIMATION
    const initFloatingBadges = () => {
        const badges = $$('.floating-badge');
        if (!badges.length) return;

        badges.forEach((badge, index) => {
            // Apply different animation delays to each badge
            badge.style.animation = `float 3s ease-in-out infinite`;
            badge.style.animationDelay = `${index * 0.5}s`;
        });
    };

    // 17. PARALLAX EFFECTS
    const initParallax = () => {
        const heroElements = $$('.hero-name, .hero-title, .hero-tagline, .hero-status-badge');
        const homeSection = $('#home');
        
        if (!heroElements.length || !homeSection) return;

        window.addEventListener('scroll', rafThrottle(() => {
            const scrollY = window.scrollY;
            if (scrollY > homeSection.offsetHeight) return;

            heroElements.forEach((el, index) => {
                const speed = 1 + (index * 0.1); // slight variation per element
                el.style.transform = `translateY(${scrollY * 0.2 * speed}px)`;
                el.style.opacity = 1 - (scrollY / (homeSection.offsetHeight * 0.6));
            });
        }));
    };

    // 18. INITIALIZATION RUN
    const initAll = () => {
        initPreloader();
        initIntroVideo();
        initNavbar();
        initCursor();
        initTyping();
        initParticles();
        initSkillBars();
        initSkillFilters();
        initRadarChart();
        initProjectFilters();
        initScrollReveal();
        initBackToTop();
        initContactForm();
        initScrollIndicator();
        initEasterEgg();
        initFloatingBadges();
        initParallax();
    };

    // Run everything
    initAll();
});
