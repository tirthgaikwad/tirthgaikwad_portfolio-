document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('historyContainer');

    const emptyStateHTML = `
        <div class="empty-state">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <h4>No Recent Activity</h4>
            <p>Your platform interactions, searches, and profile updates will be logged and displayed here.</p>
            <a href="search.html" class="btn-home">Start Exploring</a>
        </div>
    `;

    try {
        // SECURE FETCH: Cookie handled automatically
        const response = await fetch('http://127.0.0.1:8000/api/history', {
            credentials: 'include'
        });
        
        if (response.status === 401) {
            localStorage.removeItem('currentUserId');
            window.location.href = 'login.html';
            return;
        }
        
        const historyData = await response.json();

        if (historyData.length === 0) {
            container.innerHTML = emptyStateHTML;
            return;
        }

        let timelineHTML = `<div class="timeline">`;

        historyData.forEach(log => {
            const dateObj = new Date(log.time); 
            const timeString = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateString = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

            timelineHTML += `
                <div class="timeline-item">
                    <div class="timeline-dot"></div>
                    <div class="timeline-content">
                        <div class="log-header">
                            <span class="log-type">${log.action || "System Action"}</span>
                            <span class="log-time">${dateString} at ${timeString}</span>
                        </div>
                        <div class="log-detail">
                            ${log.detail}
                        </div>
                    </div>
                </div>
            `;
        });

        timelineHTML += `</div>`;
        container.innerHTML = timelineHTML;

    } catch (err) {
        console.error("History Error:", err);
        container.innerHTML = `
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                </svg>
                <h4>Connection Error</h4>
                <p>Could not load the activity dashboard. Please ensure your FastAPI backend is currently running.</p>
            </div>
        `;
    }
});