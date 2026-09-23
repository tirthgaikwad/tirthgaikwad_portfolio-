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
    msgEl.textContent = message;
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

            // --- Wire notification bell to show real notifications ---
            const notifBtns = document.querySelectorAll('[data-notif-btn]');
            notifBtns.forEach(btn => {
                btn.onclick = () => {
                    if (notifications.length === 0) {
                        window.showSystemModal('Notifications', 'You have no notifications yet.', 'alert');
                        return;
                    }
                    const recentNotifs = notifications.slice(0, 5);
                    const notifText = recentNotifs.map(n => `• ${n.content}`).join('\n');
                    window.showSystemModal(
                        `Notifications (${unreadCount} unread)`, 
                        notifText, 
                        'alert',
                        async () => {
                            // Mark all shown as read
                            for (const n of recentNotifs) {
                                if (n.is_read === 0) {
                                    try {
                                        await fetch(`${API_BASE}/api/notifications/${n.id}/read`, { method: 'PUT', credentials: 'include' });
                                    } catch(e) {}
                                }
                            }
                            // Update badge
                            const remaining = unreadCount - recentNotifs.filter(n => n.is_read === 0).length;
                            badges.forEach(badge => {
                                if (remaining > 0) { badge.textContent = remaining; badge.style.display = 'flex'; }
                                else { badge.style.display = 'none'; }
                            });
                        },
                        'Dismiss'
                    );
                };
            });
        }
    } catch(err) {
        console.error("Shared.js: Error fetching notifications:", err);
    }
});
