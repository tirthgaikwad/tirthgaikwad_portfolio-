// ==========================================
// SHARED.JS — Dynamic Header, Notifications & Auth
// Loaded on every page to make user data appear in real-time
// ==========================================

const API_BASE = 'http://127.0.0.1:8000';

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
                    ${teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
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
                    window.showSystemModal("Failed", data.detail || "Failed to add user to team.", "alert");
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
        localStorage.removeItem('currentUserId');
        window.location.href = "login.html";
    }, "Log Out");
};

// ==========================================
// 3. DYNAMIC HEADER — Profile Avatar & Notifications
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    const currentUserId = localStorage.getItem('currentUserId');
    if (!currentUserId) return; // Not logged in, leave header defaults

    try {
        const res = await fetch(`${API_BASE}/api/profiles/${currentUserId}`, { credentials: 'include' });
        
        if (res.status === 401) {
            // Token expired or invalid — force re-login
            localStorage.removeItem('currentUserId');
            // Only redirect if not already on login/join page
            const page = window.location.pathname.split('/').pop();
            if (page !== 'login.html' && page !== 'join.html' && page !== 'index.html' && page !== '') {
                window.location.href = 'login.html';
            }
            return;
        }

        if (res.ok) {
            const profile = await res.json();
            
            // Store profile data globally for other scripts to use
            window.currentUserProfile = profile;

            // --- Update ALL header avatars on the page ---
            const headerAvatars = document.querySelectorAll('[data-header-avatar]');
            headerAvatars.forEach(container => {
                if (profile.profile_pic) {
                    container.innerHTML = `<img src="${profile.profile_pic}" alt="${profile.name}" class="w-8 h-8 rounded-full object-cover">`;
                } else {
                    const initials = profile.name ? profile.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '?';
                    container.innerHTML = `<div class="w-8 h-8 rounded-full bg-primary flex items-center justify-center"><span class="text-on-primary text-xs font-bold">${initials}</span></div>`;
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
                    sidebarAvatar.innerHTML = `<img src="${profile.profile_pic}" alt="${profile.name}" class="w-full h-full rounded-full object-cover">`;
                } else {
                    const initials = profile.name ? profile.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '?';
                    sidebarAvatar.innerHTML = `<div class="w-full h-full rounded-full bg-primary flex items-center justify-center"><span class="text-on-primary font-bold">${initials}</span></div>`;
                }
            }

            const sidebarSkills = document.getElementById('sidebarUserSkills');
            if (sidebarSkills && profile.skills) {
                const skills = profile.skills.split(',').map(s => s.trim()).filter(s => s);
                sidebarSkills.innerHTML = skills.map(s => 
                    `<span class="px-2 py-0.5 rounded bg-surface-container text-on-surface font-skill-pill text-skill-pill">${s}</span>`
                ).join('');
            }
        }
    } catch (err) {
        console.error("Shared.js: Error fetching user profile for header:", err);
    }

    // --- Fetch Real Notification Count ---
    try {
        const notifRes = await fetch(`${API_BASE}/api/notifications/${currentUserId}`, { credentials: 'include' });
        if (notifRes.ok) {
            const notifications = await notifRes.json();
            const unreadCount = notifications.filter(n => n.is_read === 0).length;
            
            const badges = document.querySelectorAll('[data-notif-badge]');
            badges.forEach(badge => {
                if (unreadCount > 0) {
                    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            });

            // --- Wire notification bell to show premium slide-over panel ---
            const notifBtns = document.querySelectorAll('[data-notif-btn]');
            notifBtns.forEach(btn => {
                btn.onclick = async () => {
                    let panel = document.getElementById('global-notif-panel');
                    let overlay = document.getElementById('global-notif-overlay');
                    
                    if (!panel) {
                        // Create Overlay
                        overlay = document.createElement('div');
                        overlay.id = 'global-notif-overlay';
                        overlay.className = 'fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[99] opacity-0 transition-opacity duration-300 pointer-events-none';
                        document.body.appendChild(overlay);

                        // Create Panel
                        panel = document.createElement('div');
                        panel.id = 'global-notif-panel';
                        panel.className = 'fixed inset-y-0 right-0 w-80 sm:w-96 bg-white shadow-2xl z-[100] transform transition-transform duration-300 translate-x-full flex flex-col border-l border-slate-200';
                        document.body.appendChild(panel);

                        // Close behavior
                        window.closeNotifPanel = () => {
                            panel.classList.add('translate-x-full');
                            overlay.classList.remove('opacity-100');
                            overlay.classList.add('pointer-events-none');
                            setTimeout(() => { if (panel.parentNode) panel.parentNode.removeChild(panel); if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
                        };
                        overlay.onclick = window.closeNotifPanel;
                    }

                    // Dynamically fetch latest notifications on click
                    let latestNotifications = [];
                    let latestUnread = 0;
                    try {
                        const freshRes = await fetch(`${API_BASE}/api/notifications/${currentUserId}`, { credentials: 'include' });
                        if (freshRes.ok) {
                            latestNotifications = await freshRes.json();
                            latestUnread = latestNotifications.filter(n => n.is_read === 0).length;
                            
                            // Update badges globally
                            badges.forEach(badge => {
                                if (latestUnread > 0) {
                                    badge.textContent = latestUnread > 99 ? '99+' : latestUnread;
                                    badge.style.display = 'flex';
                                } else {
                                    badge.style.display = 'none';
                                }
                            });
                        }
                    } catch (e) {
                        console.error("Failed to fetch fresh notifications:", e);
                    }

                    // Build Panel HTML
                    let notifHtml = '';
                    if (latestNotifications.length === 0) {
                        notifHtml = `
                            <div class="flex flex-col items-center justify-center flex-1 p-8 text-center text-slate-500">
                                <span class="material-symbols-outlined text-5xl mb-4 text-slate-200">notifications_off</span>
                                <h3 class="text-sm font-semibold text-slate-900 mb-1">All caught up!</h3>
                                <p class="text-xs">You have no new notifications.</p>
                            </div>
                        `;
                    } else {
                        notifHtml = `<div class="flex-1 overflow-y-auto p-4 space-y-3">`;
                        latestNotifications.forEach(n => {
                            let icon = 'notifications';
                            let iconColor = 'text-primary bg-primary/10';
                            if (n.type === 'message') { icon = 'chat_bubble'; iconColor = 'text-emerald-600 bg-emerald-100'; }
                            if (n.type === 'follow') { icon = 'person_add'; iconColor = 'text-blue-600 bg-blue-100'; }
                            if (n.type === 'board_reply') { icon = 'forum'; iconColor = 'text-purple-600 bg-purple-100'; }
                            
                            const isUnread = n.is_read === 0;
                            const timeString = n.timestamp ? new Date(n.timestamp + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';

                            notifHtml += `
                                <div class="flex gap-3 p-3 rounded-xl transition-colors cursor-pointer ${isUnread ? 'bg-slate-50 hover:bg-slate-100' : 'hover:bg-slate-50'}" onclick="window.markReadAndGo(${n.id})">
                                    <div class="w-10 h-10 rounded-full flex shrink-0 items-center justify-center ${iconColor}">
                                        <span class="material-symbols-outlined text-[20px]">${icon}</span>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <p class="text-[13px] text-slate-900 ${isUnread ? 'font-semibold' : 'font-medium'} leading-snug">${n.content}</p>
                                        <p class="text-[11px] text-slate-500 mt-1">${timeString}</p>
                                    </div>
                                    ${isUnread ? '<div class="w-2 h-2 rounded-full bg-primary mt-1 shrink-0"></div>' : ''}
                                </div>
                            `;
                        });
                        notifHtml += `</div>`;
                    }

                    panel.innerHTML = `
                        <div class="flex items-center justify-between p-4 border-b border-slate-100">
                            <h2 class="text-base font-bold text-slate-900">Notifications</h2>
                            <div class="flex items-center gap-2">
                                ${latestUnread > 0 ? `<button onclick="window.markAllRead()" class="text-xs font-semibold text-primary hover:text-primary-hover transition-colors px-2 py-1 rounded-md hover:bg-primary/5">Mark all read</button>` : ''}
                                <button onclick="window.closeNotifPanel()" class="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                                    <span class="material-symbols-outlined text-[20px]">close</span>
                                </button>
                            </div>
                        </div>
                        ${notifHtml}
                    `;

                    // Helper to mark single as read
                    window.markReadAndGo = async (notifId) => {
                        try {
                            await fetch(`${API_BASE}/api/notifications/${notifId}/read`, { method: 'PUT', credentials: 'include' });
                            window.closeNotifPanel();
                        } catch(e) {}
                    };

                    // Helper to mark all as read
                    window.markAllRead = async () => {
                        try {
                            for (const n of latestNotifications) {
                                if (n.is_read === 0) {
                                    await fetch(`${API_BASE}/api/notifications/${n.id}/read`, { method: 'PUT', credentials: 'include' });
                                }
                            }
                            window.closeNotifPanel();
                            badges.forEach(b => b.style.display = 'none');
                        } catch(e) {}
                    };

                    // Animate In
                    void panel.offsetWidth;
                    panel.classList.remove('translate-x-full');
                    overlay.classList.remove('pointer-events-none');
                    overlay.classList.add('opacity-100');
                };
            });
        }
    } catch(err) {
        console.error("Shared.js: Error fetching notifications:", err);
    }
});

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
