const currentUserId = parseInt(localStorage.getItem('currentUserId'));

if (!currentUserId) {
    window.location.href = 'login.html';
}

let contacts = {}; 
let messages = []; 
let activeContactId = null;
let ws = null;

// Map to store all network profiles so we can grab names/pictures easily
let globalProfiles = {}; 

async function initInbox() {
    await fetchAllProfiles(); // Fetch everyone's profile data first
    await fetchMessages();
    await buildContacts();
    renderContacts();
    setupWebSocket();
}

// Fetch all profiles at once to safely get names and images
async function fetchAllProfiles() {
    try {
        const res = await fetch(`http://127.0.0.1:8000/api/profiles`, { 
            credentials: 'include' 
        });
        
        if (res.ok) {
            const profiles = await res.json();
            profiles.forEach(p => {
                globalProfiles[p.id] = p;
            });
        }
    } catch (e) { 
        console.error("Error fetching profiles:", e); 
    }
}

async function fetchMessages() {
    try {
        const res = await fetch(`http://127.0.0.1:8000/api/messages/${currentUserId}`, { 
            credentials: 'include' 
        });
        
        if (res.ok) {
            messages = await res.json();
        }
    } catch (e) { 
        console.error(e); 
    }
}

async function buildContacts() {
    const contactIds = new Set();
    
    messages.forEach(m => {
        if (m.sender_id !== currentUserId) {
            contactIds.add(m.sender_id);
        }
        if (m.receiver_id !== currentUserId) {
            contactIds.add(m.receiver_id);
        }
    });

    const urlParams = new URLSearchParams(window.location.search);
    const newContactId = urlParams.get('user');
    
    if (newContactId && parseInt(newContactId) !== currentUserId) {
        contactIds.add(parseInt(newContactId));
    }

    for (let id of contactIds) {
        if (!contacts[id]) {
            // Grab their details from our pre-fetched global dictionary
            const profile = globalProfiles[id]; 
            
            contacts[id] = {
                id: id,
                name: profile ? profile.name : `Developer #${id}`,
                profile_pic: profile ? profile.profile_pic : "",
                lastMessage: "",
                timestamp: ""
            };
        }
    }

    messages.forEach(m => {
        const otherId = m.sender_id === currentUserId ? m.receiver_id : m.sender_id;
        
        if (contacts[otherId]) {
            if (!contacts[otherId].timestamp || new Date(m.timestamp) > new Date(contacts[otherId].timestamp)) {
                contacts[otherId].lastMessage = m.sender_id === currentUserId ? `You: ${m.content}` : m.content;
                contacts[otherId].timestamp = m.timestamp;
            }
        }
    });
}

// Dynamic fallback: Get initials if they don't have a profile picture
function getInitials(name) {
    if (!name || name.startsWith('Developer #')) {
        return name ? name.split('#')[1] : "?";
    }
    
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
}

function renderContacts() {
    const list = document.getElementById('contactList');
    list.innerHTML = '';
    
    const sortedContacts = Object.values(contacts).sort((a, b) => {
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    if (sortedContacts.length === 0) {
        list.innerHTML = `<div style="padding: 25px; color: var(--text-dim); text-align:center;">No conversations yet.</div>`;
        return;
    }

    sortedContacts.forEach(c => {
        const div = document.createElement('div');
        div.className = `contact-item ${activeContactId === c.id ? 'active' : ''}`;
        div.onclick = () => selectContact(c.id);

        let timeStr = "";
        if (c.timestamp) {
            const d = new Date(c.timestamp);
            timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        }

        // Render Actual Avatar OR Initials Fallback
        const avatarHtml = c.profile_pic 
            ? `<img src="${c.profile_pic}" alt="avatar">` 
            : `${getInitials(c.name)}`;

        div.innerHTML = `
            <div class="avatar" onclick="event.stopPropagation(); window.location.href='profile.html?id=${c.id}'" title="View Profile" style="cursor: pointer;">
                ${avatarHtml}
            </div>
            <div class="contact-info">
                <div class="contact-top-row">
                    <div class="contact-name" onclick="event.stopPropagation(); window.location.href='profile.html?id=${c.id}'" title="View Profile" style="cursor: pointer;">${c.name}</div>
                    <div class="contact-time">${timeStr}</div>
                </div>
                <div class="contact-preview">${c.lastMessage || 'New connection'}</div>
            </div>
        `;
        list.appendChild(div);
    });
}

function selectContact(id) {
    activeContactId = id;
    renderContacts();
    renderChat();
}

function renderChat() {
    const chatMain = document.getElementById('chatMain');
    
    if (!activeContactId) {
        return;
    }

    const c = contacts[activeContactId];
    
    const chatMsgs = messages.filter(m => 
        (m.sender_id === currentUserId && m.receiver_id === activeContactId) ||
        (m.receiver_id === currentUserId && m.sender_id === activeContactId)
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Render Actual Avatar OR Initials Fallback for the Chat Header
    const avatarHtml = c.profile_pic 
        ? `<img src="${c.profile_pic}" alt="avatar">` 
        : `${getInitials(c.name)}`;

    let msgHtml = chatMsgs.map(m => {
        const isSent = m.sender_id === currentUserId;
        const timeStr = new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        return `
            <div class="bubble ${isSent ? 'sent' : 'received'}">
                ${m.content}
                <span class="bubble-time">${timeStr}</span>
            </div>
        `;
    }).join('');

    chatMain.innerHTML = `
        <div class="chat-header">
            <div class="avatar" onclick="window.location.href='profile.html?id=${c.id}'" title="View Profile" style="cursor: pointer;">
                ${avatarHtml}
            </div>
            <div class="chat-header-info">
                <div class="chat-header-name" onclick="window.location.href='profile.html?id=${c.id}'" title="View Profile" style="cursor: pointer;">${c.name}</div>
                <div class="chat-header-status">Online</div>
            </div>
        </div>
        
        <div class="chat-messages" id="chatMessages">
            ${msgHtml}
        </div>
        
        <div class="chat-input-wrapper">
            <form class="chat-input-area" id="chatForm">
                <div class="input-wrapper">
                    <input type="text" id="msgInput" placeholder="Type your message..." required autocomplete="off">
                </div>
                <button type="submit" class="send-btn">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="20" height="20">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                    </svg>
                </button>
            </form>
        </div>
    `;

    const msgContainer = document.getElementById('chatMessages');
    msgContainer.scrollTop = msgContainer.scrollHeight;

    document.getElementById('chatForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const input = document.getElementById('msgInput');
        const content = input.value.trim();
        
        if (!content) {
            return;
        }
        
        input.value = '';
        
        try {
            const res = await fetch('http://127.0.0.1:8000/api/messages', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sender_id: currentUserId,
                    receiver_id: activeContactId,
                    content: content
                })
            });
            
            if (res.ok) {
                const newMsg = await res.json();
                messages.push(newMsg);
                
                contacts[activeContactId].lastMessage = `You: ${content}`;
                contacts[activeContactId].timestamp = newMsg.timestamp;
                
                renderContacts();
                renderChat();
            }
        } catch(e) { 
            console.error(e); 
        }
    });
}

function setupWebSocket() {
    ws = new WebSocket(`ws://127.0.0.1:8000/api/ws/${currentUserId}`);
    
    ws.onmessage = async (event) => {
        const newMsg = JSON.parse(event.data);
        messages.push(newMsg);
        
        const otherId = newMsg.sender_id === currentUserId ? newMsg.receiver_id : newMsg.sender_id;
        
        if (!contacts[otherId]) {
            const profile = globalProfiles[otherId];
            
            contacts[otherId] = {
                id: otherId,
                name: profile ? profile.name : `Developer #${otherId}`,
                profile_pic: profile ? profile.profile_pic : "",
                lastMessage: "",
                timestamp: ""
            };
        }
        
        contacts[otherId].lastMessage = newMsg.sender_id === currentUserId ? `You: ${newMsg.content}` : newMsg.content;
        contacts[otherId].timestamp = newMsg.timestamp;
        
        renderContacts();
        
        if (activeContactId === otherId) {
            renderChat();
        }
    };
}

document.addEventListener('DOMContentLoaded', () => {
    initInbox();
    
    const urlParams = new URLSearchParams(window.location.search);
    const autoSelectUser = urlParams.get('user');
    
    if (autoSelectUser) {
        setTimeout(() => {
            if(contacts[autoSelectUser]) {
                selectContact(parseInt(autoSelectUser));
            }
        }, 500);
    }
});