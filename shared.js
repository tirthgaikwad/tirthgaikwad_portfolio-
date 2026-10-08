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
    window.showSystemModal("Log Out", "Are you sure you want to securely log out?", "confirm", async () => {
        try {
            await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
        } catch(e) { /* proceed anyway */ }
        localStorage.removeItem(`c2m:${localStorage.getItem('currentUserId')}:me`);
        localStorage.removeItem('currentUserId');
        window.location.href = "login.html";
    }, "Log Out");
};

// ==========================================
// 3. DYNAMIC HEADER — Profile Avatar & Notifications
// ==========================================
window.applyHeaderProfile = function(profile) {
    // Store profile data globally for other scripts to use
    window.currentUserProfile = profile;
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

// ==========================================
// 6. DYNAMIC NAV HIGHLIGHTING
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    
    // Find all nav links
    const navLinks = document.querySelectorAll('nav a');
    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');
        
        // Remove active styling and ensure inactive styling is present
        link.classList.remove('text-primary', 'border-b-2', 'border-primary');
        link.classList.add('text-slate-500', 'hover:text-slate-900');
        link.removeAttribute('aria-current');
        
        // Add active styling to current link
        if (linkPath === currentPath) {
            link.classList.remove('text-slate-500', 'hover:text-slate-900');
            link.classList.add('text-primary', 'border-b-2', 'border-primary');
            link.setAttribute('aria-current', 'page');
        }
    });
});
