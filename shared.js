// ==========================================
// SHARED.JS — Dynamic Header, Notifications & Auth
// Loaded on every page to make user data appear in real-time
// ==========================================

const API_BASE = `${window.location.protocol}//${window.location.hostname || '127.0.0.1'}:8000`;

// Escape user-supplied text before placing it in innerHTML or an HTML attribute
window.escapeHtml = function(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Only allow web, relative and inline-media URLs in href/src (blocks javascript: links)
window.safeUrl = function(url) {
    const value = String(url || '').trim();
    return /^(https?:\/\/|\/|blob:|data:(image|audio|video)\/)/i.test(value) ? value : '#';
};

// Encode a value as an argument for an inline handler, e.g. onclick="fn(${escapeJsArg(name)})"
window.escapeJsArg = function(value) {
    return window.escapeHtml(JSON.stringify(String(value === null || value === undefined ? '' : value)));
};

// ==========================================
// 0. THE TOP NAVIGATION BAR (every app page; styled by header.css)
// A page holds an empty <header class="app-header" id="appHeader"> and calls renderAppHeader() right after it.
// ==========================================
const HEADER_ICONS = {
    chevron: '<path d="M6 9l6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    bell: '<path d="M6 9.5a6 6 0 0112 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7zM10 19.5a2 2 0 004 0"/>',
    chat: '<path d="M20 12a7.5 7.5 0 01-11 6.6L4 20l1.4-4.6A7.5 7.5 0 1120 12z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    person: '<circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/>',
    history: '<path d="M4 12a8 8 0 108-8 8 8 0 00-6.3 3M4 4.5V8h3.5M12 8v4.5l3 1.8"/>',
    shield: '<path d="M12 3.5l7 2.5v5.5c0 4.3-2.8 7.6-7 9-4.2-1.4-7-4.7-7-9V6z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
    logout: '<path d="M14 4.5h3.5a2 2 0 012 2v11a2 2 0 01-2 2H14M10 16l-4-4 4-4M6 12h9.5"/>',
    board: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M8 9h8M8 13h5"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.3 8.7l-1.9 4.7-4.7 1.9 1.9-4.7z"/>',
    teams: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.6-3.2 3.2-5 6.5-5s5.9 1.8 6.5 5M16 5.3a3.5 3.5 0 010 6.4M18.5 14.9c1.7.8 2.7 2.4 3 4.6"/>',
    kanban: '<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="16.5" y="4" width="4" height="13" rx="1.5"/>',
    book: '<path d="M12 6.5C10.3 5.2 8 4.5 4 4.5v13c4 0 6.3.7 8 2 1.7-1.3 4-2 8-2v-13c-4 0-6.3.7-8 2zM12 6.5v13"/>',
    campus: '<path d="M2.5 9.5L12 4.5l9.5 5-9.5 5z"/><path d="M6.5 12v4.5c1.5 1.3 3.3 2 5.5 2s4-.7 5.5-2V12M21.5 9.5V15"/>',
    network: '<circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="17.5" r="2.5"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M10.8 7.7L6.7 15.3M13.2 7.7l4.1 7.6M8 17.5h8"/>',
    bookmark: '<path d="M7 4.5h10a1 1 0 011 1V20l-6-3.8L6 20V5.5a1 1 0 011-1z"/>',
    briefcase: '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M9 7.5V6a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0115 6v1.5M3 13h18"/>'
};
const headerIcon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${HEADER_ICONS[name]}</svg>`;

// The pages behind each item of the bar. A group is shown as current when one of its pages is open.
const HEADER_NAV = [
    { label: 'Discover', href: 'search.html', icon: 'compass', text: 'Find people by skill' },
    { label: 'Professionals', href: 'professionals.html', icon: 'briefcase', text: 'Everyone, by profession' },
    { label: 'Opportunities', href: 'board.html', icon: 'board', text: 'Open roles and project ideas' },
    { label: 'Workspace', pages: [
        { label: 'My Teams', href: 'team.html', icon: 'teams', text: 'Channels, chat and calls' },
        { label: 'Project Hub', href: 'project_management.html', icon: 'kanban', text: 'Task board and planning canvas' },
        { label: 'Research Collab', href: 'research.html', icon: 'book', text: 'Collect sources for a topic' }
    ] },
    { label: 'Network', pages: [
        { label: 'Campus Network', href: 'college.html', icon: 'campus', text: 'People at your college' },
        { label: 'My Network', href: 'network.html', icon: 'network', text: 'Followers and following' },
        { label: 'Saved Profiles', href: 'saved.html', icon: 'bookmark', text: 'People you bookmarked' }
    ] }
];
const HEADER_LOGO = 'https://lh3.googleusercontent.com/aida-public/AB6AXuDLYIVUTWgawVVcDf_AfO3osE5aQelSrQ-BiqZCvpbzadGqYt7RtjKuzKYtNzfOW-oW-6uJ8eSUDVEMDSBc_fUiLQjgWl837nw2mEMwiXz5c0mKkUYfQE2dbsmzbhRVZOjIy3Ds3vVzS319wCOCj9COqFm303zTmlcG9IfKWC6GtY75OxB_hkdbyS0D1vDdI1OkWuXELojjbtqR_tKJu-Q9_B0SX5XmdV9oiZSqvej275TiiIHhxGQD';

window.renderAppHeader = function() {
    const header = document.getElementById('appHeader');
    if (!header || header.dataset.rendered) return;
    header.dataset.rendered = '1';

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const current = (href) => href === currentPage ? ' is-current' : '';
    const ariaCurrent = (href) => href === currentPage ? ' aria-current="page"' : '';
    const pageRow = (page) => `
        <a class="app-panel-row${current(page.href)}" href="${page.href}"${ariaCurrent(page.href)}>
            <span class="app-panel-icon">${headerIcon(page.icon)}</span>
            <span><strong>${page.label}</strong><small>${page.text}</small></span>
        </a>`;

    const nav = HEADER_NAV.map(item => {
        if (!item.pages) return `<a class="app-nav-link${current(item.href)}" href="${item.href}"${ariaCurrent(item.href)}>${item.label}</a>`;
        const inGroup = item.pages.some(page => page.href === currentPage);
        return `
            <div class="app-nav-item" data-menu>
                <button class="app-nav-link${inGroup ? ' is-current' : ''}" type="button" aria-haspopup="true" aria-expanded="false" data-menu-btn>${item.label}${headerIcon('chevron')}</button>
                <div class="app-panel" data-menu-panel>${item.pages.map(pageRow).join('')}</div>
            </div>`;
    }).join('');

    // Phones get every page in one list, under the same group names
    const mobile = HEADER_NAV.map(item => item.pages
        ? `<h4>${item.label}</h4>${item.pages.map(pageRow).join('')}`
        : pageRow(item)).join('');

    const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
    header.innerHTML = `
        <div class="app-header-inner">
            <a class="app-brand" href="index.html" aria-label="Connect2Minds home"><img alt="" src="${HEADER_LOGO}"><span>Connect2Minds</span></a>
            <nav class="app-nav" aria-label="Main">${nav}</nav>
            <div class="app-actions">
                <button class="app-search" type="button" data-header-search aria-label="Search people">${headerIcon('search')}<span>Search people</span><kbd>${shortcut}</kbd></button>
                <button class="app-icon-btn" type="button" aria-label="Notifications" data-notif-btn>${headerIcon('bell')}<span class="app-badge" data-notif-badge style="display:none;"></span></button>
                <a class="app-icon-btn" href="inbox.html" aria-label="Messages" title="Messages">${headerIcon('chat')}</a>
                <div class="app-user" data-menu>
                    <button class="app-user-btn" type="button" aria-label="Account menu" aria-haspopup="true" aria-expanded="false" data-menu-btn>
                        <span class="app-avatar" data-header-avatar>${headerIcon('person')}</span>${headerIcon('chevron')}
                    </button>
                    <div class="app-panel app-panel-right" data-menu-panel>
                        <div class="app-user-head"><strong data-header-name>Your account</strong><span data-header-sub></span></div>
                        <a class="app-menu-row" href="profile.html">${headerIcon('person')}Your profile</a>
                        <a class="app-menu-row" href="history.html">${headerIcon('history')}Activity history</a>
                        <a class="app-menu-row" href="admin_dashboard.html" data-admin-only hidden>${headerIcon('shield')}Admin dashboard</a>
                        <div class="app-menu-sep"></div>
                        <button class="app-menu-row is-danger" type="button" data-logout>${headerIcon('logout')}Log out</button>
                    </div>
                </div>
                <button class="app-icon-btn app-menu-btn" type="button" aria-label="Menu" aria-expanded="false" aria-controls="appHeaderMobile" data-mobile-btn>${headerIcon('menu')}</button>
            </div>
        </div>
        <div class="app-mobile" id="appHeaderMobile" data-mobile-panel hidden>${mobile}</div>`;

    bindAppHeader(header);
};

// The search field focuses the page's own search box where there is one; elsewhere it opens Discover
function runHeaderSearch() {
    if (typeof focusDiscoverSearch === 'function') return focusDiscoverSearch();
    if (typeof focusBoardSearch === 'function') return focusBoardSearch();
    window.focusHeaderSearch();
}

function bindAppHeader(header) {
    const menus = [...header.querySelectorAll('[data-menu]')];
    const mobileBtn = header.querySelector('[data-mobile-btn]');
    const mobilePanel = header.querySelector('[data-mobile-panel]');
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    function setMenu(menu, open, pinned) {
        if (open) menu.setAttribute('data-open', pinned ? 'pinned' : 'hover'); else menu.removeAttribute('data-open');
        menu.querySelector('[data-menu-btn]').setAttribute('aria-expanded', String(open));
    }
    function closeMenus(except) {
        menus.forEach(menu => { if (menu !== except) setMenu(menu, false); });
    }
    function setMobile(open) {
        if (mobilePanel.hidden === !open) return;
        mobilePanel.hidden = !open;
        mobileBtn.setAttribute('aria-expanded', String(open));
        mobileBtn.innerHTML = headerIcon(open ? 'close' : 'menu');
    }

    menus.forEach(menu => {
        let closing = null;
        // A click pins the panel open; pointing at it only shows it while the pointer stays
        menu.querySelector('[data-menu-btn]').addEventListener('click', () => {
            const pinned = menu.getAttribute('data-open') === 'pinned';
            closeMenus(menu);
            setMobile(false);
            setMenu(menu, !pinned, true);
        });
        if (!canHover) return;
        menu.addEventListener('mouseenter', () => {
            clearTimeout(closing);
            if (menu.hasAttribute('data-open')) return;
            closeMenus(menu);
            setMenu(menu, true, false);
        });
        menu.addEventListener('mouseleave', () => {
            closing = setTimeout(() => { if (menu.getAttribute('data-open') === 'hover') setMenu(menu, false); }, 160);
        });
    });

    mobileBtn.addEventListener('click', () => { closeMenus(); setMobile(mobilePanel.hidden); });
    header.querySelector('[data-header-search]').addEventListener('click', () => { closeMenus(); setMobile(false); runHeaderSearch(); });
    header.querySelector('[data-logout]').addEventListener('click', () => { closeMenus(); window.logout(); });
    header.querySelector('[data-notif-btn]').addEventListener('click', () => { closeMenus(); setMobile(false); });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#appHeader [data-menu]')) closeMenus();
        if (!e.target.closest('#appHeader')) setMobile(false);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = menus.find(menu => menu.hasAttribute('data-open'));
        if (open) { setMenu(open, false); open.querySelector('[data-menu-btn]').focus(); }
        setMobile(false);
    });
    // Ctrl/⌘+K, unless the page has already handled it for its own search box
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !e.defaultPrevented) { e.preventDefault(); runHeaderSearch(); }
    });
}

// ==========================================
// 1. GLOBAL MODAL SYSTEM (Shared across all pages)
// ==========================================
window.showSystemModal = function(title, message, type = 'alert', onConfirm = null, confirmText = 'OK') {
    const modal = document.getElementById('systemModal');
    const titleEl = document.getElementById('systemModalTitle');
    const msgEl = document.getElementById('systemModalMessage');
    const cancelBtn = document.getElementById('systemModalCancel');
    const confirmBtn = document.getElementById('systemModalConfirm');

    if (!modal) return console.error("System modal HTML is missing!");

    titleEl.textContent = title;
    msgEl.innerHTML = message;
    confirmBtn.textContent = confirmText;

    if (type === 'confirm') {
        cancelBtn.style.display = 'block';
        cancelBtn.onclick = () => window.closeSystemModal();
        confirmBtn.onclick = () => {
            window.closeSystemModal();
            if (onConfirm) onConfirm();
        };
    } else {
        cancelBtn.style.display = 'none';
        confirmBtn.onclick = () => {
            window.closeSystemModal();
            if (onConfirm) onConfirm();
        };
    }

    modal.classList.add('active');
};

window.closeSystemModal = function() {
    const modal = document.getElementById('systemModal');
    if (modal) modal.classList.remove('active');
};

// ==========================================
// 1.5 ADD TO TEAM MODAL LOGIC
// ==========================================
window.openAddToTeamModal = async function(targetUserId) {
    try {
        const res = await fetch(`${API_BASE}/api/teams`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch teams');
        const teams = await res.json();
        
        if (teams.length === 0) {
            window.showSystemModal("Add to Team", "You don't have any teams. Please create a team first in the My Teams page.", "alert");
            return;
        }

        let selectHtml = `
            <div class="mt-2 text-left">
                <label class="block text-sm font-medium text-on-surface-variant mb-1">Select a Team</label>
                <select id="addTeamSelect" class="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
                    ${teams.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
                </select>
                <label class="block text-sm font-medium text-on-surface-variant mt-3 mb-1">Role</label>
                <select id="addTeamRole" class="w-full bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="Member">Member</option>
                    <option value="Admin">Admin</option>
                </select>
            </div>
        `;

        window.showSystemModal("Add to Team", selectHtml, "confirm", async () => {
            const teamId = document.getElementById('addTeamSelect').value;
            const role = document.getElementById('addTeamRole').value;
            
            try {
                const addRes = await fetch(`${API_BASE}/api/teams/${teamId}/members`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ user_id: parseInt(targetUserId), role: role })
                });
                
                if (addRes.ok) {
                    window.showSystemModal("Success", "User successfully added to the team!", "alert");
                } else {
                    const data = await addRes.json();
                    window.showSystemModal("Failed", escapeHtml(data.detail) || "Failed to add user to team.", "alert");
                }
            } catch (err) {
                console.error(err);
                window.showSystemModal("Error", "An error occurred while adding to team.", "alert");
            }
        }, "Add");

    } catch (e) {
        console.error(e);
        window.showSystemModal("Error", "Failed to load your teams.", "alert");
    }
};

// ==========================================
// 2. SECURE LOGOUT (calls backend to clear httpOnly cookie)
// ==========================================
window.logout = function() {
    const leave = async () => {
        try {
            await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
        } catch(e) { /* proceed anyway */ }
        localStorage.removeItem(`c2m:${localStorage.getItem('currentUserId')}:me`);
        localStorage.removeItem('currentUserId');
        window.location.href = "login.html";
    };
    // A few older pages do not carry the modal markup
    if (!document.getElementById('systemModal')) {
        if (window.confirm("Are you sure you want to securely log out?")) leave();
        return;
    }
    window.showSystemModal("Log Out", "Are you sure you want to securely log out?", "confirm", leave, "Log Out");
};

// ==========================================
// 3. DYNAMIC HEADER — Profile Avatar & Notifications
// ==========================================
window.applyHeaderProfile = function(profile) {
    // Store profile data globally for other scripts to use
    window.currentUserProfile = profile;

    // --- The account menu in the top bar ---
    document.querySelectorAll('[data-header-name]').forEach(node => { node.textContent = profile.name || 'Your account'; });
    document.querySelectorAll('[data-header-sub]').forEach(node => { node.textContent = profile.college_name || ''; });
    document.querySelectorAll('[data-admin-only]').forEach(node => { node.hidden = !profile.is_admin; });
    const initials = profile.name ? profile.name.split(' ').filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase() : '?';

    // --- Update ALL header avatars on the page ---
    document.querySelectorAll('[data-header-avatar]').forEach(container => {
        if (profile.profile_pic) {
            container.innerHTML = `<img src="${escapeHtml(profile.profile_pic)}" alt="${escapeHtml(profile.name)}" class="w-8 h-8 rounded-full object-cover">`;
        } else {
            container.innerHTML = `<div class="w-8 h-8 rounded-full bg-primary flex items-center justify-center"><span class="text-on-primary text-xs font-bold">${escapeHtml(initials)}</span></div>`;
        }
    });

    // --- Update sidebar profile if it exists ---
    const sidebarName = document.getElementById('sidebarUserName');
    if (sidebarName) sidebarName.textContent = profile.name || 'User';

    const sidebarCollege = document.getElementById('sidebarUserCollege');
    if (sidebarCollege) sidebarCollege.textContent = profile.college_name || '';

    const sidebarDept = document.getElementById('sidebarUserDept');
    if (sidebarDept) sidebarDept.textContent = profile.department || '';

    const sidebarAvatar = document.getElementById('sidebarUserAvatar');
    if (sidebarAvatar) {
        if (profile.profile_pic) {
            sidebarAvatar.innerHTML = `<img src="${escapeHtml(profile.profile_pic)}" alt="${escapeHtml(profile.name)}" class="w-full h-full rounded-full object-cover">`;
        } else {
            sidebarAvatar.innerHTML = `<div class="w-full h-full rounded-full bg-primary flex items-center justify-center"><span class="text-on-primary font-bold">${escapeHtml(initials)}</span></div>`;
        }
    }

    const sidebarSkills = document.getElementById('sidebarUserSkills');
    if (sidebarSkills && profile.skills) {
        const skills = profile.skills.split(',').map(s => s.trim()).filter(s => s);
        sidebarSkills.innerHTML = skills.map(s =>
            `<span class="px-2 py-0.5 rounded bg-surface-container text-on-surface font-skill-pill text-skill-pill">${escapeHtml(s)}</span>`
        ).join('');
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId) return; // Not logged in, leave header defaults

    // Paint the header from the copy saved on the last visit, then refresh it in the background
    const headerCacheKey = `c2m:${currentUserId}:me`;
    try {
        const cached = JSON.parse(localStorage.getItem(headerCacheKey));
        if (cached && cached.id) window.applyHeaderProfile(cached);
    } catch (e) { /* no usable cache */ }

    try {
        const res = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });

        if (res.status === 401) {
            // Token expired or invalid — force re-login
            localStorage.removeItem('currentUserId');
            localStorage.removeItem(headerCacheKey);
            // Only redirect if not already on login/join page
            const page = window.location.pathname.split('/').pop();
            if (page !== 'login.html' && page !== 'join.html' && page !== 'index.html' && page !== '') {
                window.location.href = 'login.html';
            }
            return;
        }

        if (res.ok) {
            const profile = await res.json();
            window.applyHeaderProfile(profile);
            try { localStorage.setItem(headerCacheKey, JSON.stringify(profile)); } catch (e) { /* storage unavailable */ }
        }
    } catch (err) {
        console.error("Shared.js: Error fetching user profile for header:", err);
    }

    initNotifications(currentUserId);
});

// ==========================================
// 4. NOTIFICATION BELL (the header bell and its slide-over panel, on every page)
// ==========================================
function timeAgo(timestamp) {
    const then = Date.parse(timestamp);
    if (!then) return 'recently';
    const minutes = Math.floor((Date.now() - then) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
    if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / (60 * 24))}d ago`;
    return new Date(then).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

// The "Search network" box in the site header. Pages with their own search box replace this.
window.focusHeaderSearch = function() {
    window.location.href = 'search.html';
};

// version goes up whenever something is changed here, so a list that was requested before the change is not
// applied over it; saving is the request that is carrying the latest change to the server.
const bell = { items: [], unread: 0, loaded: false, unreadOnly: false, userId: null, version: 0, saving: null };
const BELL_ICONS = {
    message: ['chat_bubble', 'text-emerald-600 bg-emerald-100'],
    follow: ['person_add', 'text-blue-600 bg-blue-100'],
    board_reply: ['forum', 'text-purple-600 bg-purple-100'],
    team_invite: ['group_add', 'text-amber-600 bg-amber-100'],
    view: ['visibility', 'text-slate-600 bg-slate-100'],
    announcement: ['campaign', 'text-rose-600 bg-rose-100'],
    account: ['verified_user', 'text-indigo-600 bg-indigo-100']
};
// A notification may only open one of our own pages
const BELL_LINK_PATTERN = /^[a-z_-]+\.html(\?[\w=&%.-]*)?$/i;

async function bellRequest(path, method, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: method || 'GET',
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error('Request failed');
    return res.json();
}

function setBellBadge() {
    document.querySelectorAll('[data-notif-badge]').forEach(badge => {
        badge.textContent = bell.unread > 99 ? '99+' : bell.unread;
        badge.style.display = bell.unread > 0 ? 'flex' : 'none';
    });
}

async function loadBell() {
    const version = bell.version;
    try {
        const data = await bellRequest('/api/notifications');
        if (version !== bell.version) {
            // Something changed while we waited: ask again once that change has reached the server
            try { await bell.saving; } catch (err) { /* the change failed; the fresh list will show that */ }
            return loadBell();
        }
        bell.items = data.items || [];
        bell.unread = data.unread_count || 0;
        bell.loaded = true;
    } catch (err) {
        console.error('Shared.js: Error fetching notifications:', err);
    }
    setBellBadge();
    renderBellPanel();
}

function bellItemHtml(n) {
    const [icon, iconColor] = BELL_ICONS[n.type] || ['notifications', 'text-primary bg-primary/10'];
    const unread = !n.is_read;
    return `
        <div class="group flex gap-3 p-3 rounded-xl transition-colors cursor-pointer ${unread ? 'bg-slate-50 hover:bg-slate-100' : 'hover:bg-slate-50'}" data-bell-item="${n.id || 0}" role="button" tabindex="0">
            <div class="w-10 h-10 rounded-full flex shrink-0 items-center justify-center ${iconColor}">
                <span class="material-symbols-outlined text-[20px]">${icon}</span>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-[13px] text-slate-900 ${unread ? 'font-semibold' : 'font-medium'} leading-snug break-words">${escapeHtml(n.content)}</p>
                <p class="text-[11px] text-slate-500 mt-1">${escapeHtml(timeAgo(n.timestamp))}</p>
            </div>
            <div class="flex flex-col items-center gap-1 shrink-0">
                ${unread ? '<span class="w-2 h-2 rounded-full bg-primary mt-1"></span>' : ''}
                ${n.id ? `<button type="button" data-bell-delete="${n.id}" title="Remove" aria-label="Remove notification" class="p-0.5 rounded text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"><span class="material-symbols-outlined text-[16px] block">close</span></button>` : ''}
            </div>
        </div>`;
}

function renderBellPanel() {
    const panel = document.getElementById('global-notif-panel');
    if (!panel) return;
    const shown = bell.unreadOnly ? bell.items.filter(n => !n.is_read) : bell.items;
    let body;
    if (!bell.loaded) {
        body = '<div class="flex-1 flex items-center justify-center text-xs text-slate-400">Loading notifications...</div>';
    } else if (shown.length === 0) {
        body = `
            <div class="flex flex-col items-center justify-center flex-1 p-8 text-center text-slate-500">
                <span class="material-symbols-outlined text-5xl mb-4 text-slate-200">notifications_off</span>
                <h3 class="text-sm font-semibold text-slate-900 mb-1">All caught up!</h3>
                <p class="text-xs">${bell.unreadOnly && bell.items.length ? 'You have no unread notifications.' : 'You have no notifications yet.'}</p>
            </div>`;
    } else {
        body = `<div class="flex-1 overflow-y-auto p-4 space-y-2">${shown.map(bellItemHtml).join('')}</div>`;
    }
    const tab = (unreadOnly, label) => `<button type="button" data-bell-filter="${unreadOnly ? 'unread' : 'all'}" class="px-3 py-1 rounded-full text-xs font-semibold transition-colors ${bell.unreadOnly === unreadOnly ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}">${label}</button>`;
    panel.innerHTML = `
        <div class="flex items-center justify-between p-4 border-b border-slate-100">
            <h2 class="text-base font-bold text-slate-900">Notifications</h2>
            <div class="flex items-center gap-2">
                ${bell.unread > 0 ? '<button type="button" data-bell-all class="text-xs font-semibold text-primary transition-colors px-2 py-1 rounded-md hover:bg-primary/5">Mark all read</button>' : ''}
                <button type="button" data-bell-close aria-label="Close notifications" class="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                    <span class="material-symbols-outlined text-[20px] block">close</span>
                </button>
            </div>
        </div>
        <div class="flex items-center gap-1 px-4 py-2 border-b border-slate-100">
            ${tab(false, 'All')}${tab(true, `Unread${bell.unread ? ` (${bell.unread > 99 ? '99+' : bell.unread})` : ''}`)}
        </div>
        ${body}`;
}

function openBellPanel() {
    let panel = document.getElementById('global-notif-panel');
    if (panel) return window.closeNotifPanel();

    const overlay = document.createElement('div');
    overlay.id = 'global-notif-overlay';
    overlay.className = 'fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[99] opacity-0 transition-opacity duration-300';
    overlay.onclick = () => window.closeNotifPanel();
    document.body.appendChild(overlay);

    panel = document.createElement('div');
    panel.id = 'global-notif-panel';
    panel.className = 'fixed inset-y-0 right-0 w-80 sm:w-96 max-w-full bg-white shadow-2xl z-[100] transform transition-transform duration-300 translate-x-full flex flex-col border-l border-slate-200';
    panel.addEventListener('click', onBellPanelClick);
    document.body.appendChild(panel);

    renderBellPanel();   // what we already know, at once
    void panel.offsetWidth;
    panel.classList.remove('translate-x-full');
    overlay.classList.add('opacity-100');
    loadBell();          // then the latest
}

window.closeNotifPanel = function() {
    const panel = document.getElementById('global-notif-panel');
    const overlay = document.getElementById('global-notif-overlay');
    if (!panel) return;
    panel.id = '';
    panel.classList.add('translate-x-full');
    if (overlay) { overlay.id = ''; overlay.classList.remove('opacity-100'); }
    setTimeout(() => { panel.remove(); if (overlay) overlay.remove(); }, 300);
};

function markBellRead(ids) {
    const wanted = new Set(ids);
    let changed = 0;
    bell.items.forEach(n => { if (wanted.has(n.id) && !n.is_read) { n.is_read = 1; changed++; } });
    if (!changed) return null;
    bell.version++;
    bell.unread = Math.max(0, bell.unread - changed);
    setBellBadge();
    bell.saving = bellRequest('/api/notifications/read', 'POST', { ids }).catch(() => {});
    return bell.saving;
}

async function onBellPanelClick(e) {
    if (e.target.closest('[data-bell-close]')) return window.closeNotifPanel();

    const filter = e.target.closest('[data-bell-filter]');
    if (filter) { bell.unreadOnly = filter.dataset.bellFilter === 'unread'; return renderBellPanel(); }

    if (e.target.closest('[data-bell-all]')) {
        bell.version++;
        bell.items.forEach(n => { n.is_read = 1; });
        bell.unread = 0;
        setBellBadge();
        renderBellPanel();
        bell.saving = bellRequest('/api/notifications/read', 'POST', { all: true });
        try { await bell.saving; } catch (err) { loadBell(); }
        return;
    }

    const remove = e.target.closest('[data-bell-delete]');
    if (remove) {
        const id = parseInt(remove.dataset.bellDelete);
        const item = bell.items.find(n => n.id === id);
        bell.version++;
        if (item && !item.is_read) bell.unread = Math.max(0, bell.unread - 1);
        bell.items = bell.items.filter(n => n.id !== id);
        setBellBadge();
        renderBellPanel();
        bell.saving = bellRequest(`/api/notifications/${id}`, 'DELETE');
        try { await bell.saving; } catch (err) { loadBell(); }
        return;
    }

    const row = e.target.closest('[data-bell-item]');
    if (!row) return;
    const id = parseInt(row.dataset.bellItem);
    const item = bell.items.find(n => n.id === id);
    const marking = id ? markBellRead([id]) : null;
    const link = item && BELL_LINK_PATTERN.test(item.link || '') ? item.link : '';
    if (link) {
        if (marking) await marking;   // the request would be dropped if we left the page first
        window.location.href = link;
    } else {
        renderBellPanel();
    }
}

function showBellToast(message) {
    document.querySelectorAll('.chat-toast').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = 'chat-toast';
    toast.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#0b1c30;color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;z-index:10002;box-shadow:0 8px 24px rgba(0,0,0,0.25);max-width:90vw;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// A notification that has just arrived over a socket (this page's own, or the one chat-common.js opened)
window.onBellNotification = function(n) {
    bell.version++;
    bell.unread++;
    if (bell.loaded) bell.items.unshift({ id: n.id || 0, type: n.type || '', content: n.content, timestamp: n.timestamp || new Date().toISOString(), link: n.link || '', is_read: 0 });
    setBellBadge();
    renderBellPanel();
    showBellToast(n.content);
};

function openBellSocket() {
    let retries = 0;
    const open = () => {
        let socket;
        try {
            socket = new WebSocket(`${API_BASE.replace(/^http/, 'ws')}/api/ws/notifications/${bell.userId}`);
        } catch (e) { return; }
        socket.onopen = () => {
            if (retries > 0) loadBell();   // anything sent while we were disconnected was missed
            retries = 0;
        };
        socket.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }
            if (data && data.content) window.onBellNotification(data);
        };
        socket.onclose = () => setTimeout(open, Math.min(30000, 1000 * 2 ** retries++));
    };
    open();
}

function initNotifications(userId) {
    bell.userId = userId;
    document.addEventListener('click', (e) => {
        if (e.target.closest('[data-notif-btn]')) openBellPanel();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') window.closeNotifPanel();
        if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-bell-item]')) { e.preventDefault(); e.target.click(); }
    });
    loadBell();
    // Pages that use connectNotifications (chat-common.js) already have this socket and pass bell events on
    if (!window.__bellSocketOwned) openBellSocket();
}
