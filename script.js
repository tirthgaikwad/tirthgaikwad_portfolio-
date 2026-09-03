document.addEventListener('DOMContentLoaded', async () => {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    const resultsContainer = document.getElementById('resultsContainer');
    const filterPills = document.querySelectorAll('.filter-pill');
    const suggestionsDropdown = document.getElementById('suggestionsDropdown');
    
    const currentUserId = localStorage.getItem('currentUserId');

    let currentUserCollege = "";
    let currentUserDept = "";
    let activeFilter = "global"; 

    if (currentUserId) {
        try {
            // SECURE FETCH: Cookie handled automatically by credentials: 'include'
            const res = await fetch(`http://127.0.0.1:8000/api/profiles/${currentUserId}`, {
                credentials: 'include'
            });
            
            if (res.status === 401) {
                localStorage.removeItem('currentUserId');
                window.location.href = 'login.html';
                return;
            }

            if (res.ok) {
                const profile = await res.json();
                currentUserCollege = profile.college_name;
                currentUserDept = profile.department;
            }
        } catch (err) {
            console.error("Could not fetch user details for filtering.");
        }
    }

    searchInput.addEventListener('input', async (e) => {
        const query = e.target.value.trim();
        
        if (query.length === 0) {
            suggestionsDropdown.style.display = 'none';
            return;
        }

        try {
            const response = await fetch(`http://127.0.0.1:8000/api/tags?q=${encodeURIComponent(query)}`, {
                credentials: 'include'
            });
            if (response.ok) {
                const suggestions = await response.json();
                
                if (suggestions.length > 0) {
                    suggestionsDropdown.innerHTML = '';
                    suggestions.forEach(tag => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.innerHTML = tag; 
                        
                        div.addEventListener('click', () => {
                            searchInput.value = tag;
                            suggestionsDropdown.style.display = 'none';
                            searchBtn.click(); 
                        });
                        suggestionsDropdown.appendChild(div);
                    });
                    suggestionsDropdown.style.display = 'flex';
                } else {
                    suggestionsDropdown.style.display = 'none';
                }
            }
        } catch (err) {
            console.error("Error fetching suggestions:", err);
        }
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsDropdown.contains(e.target)) {
            suggestionsDropdown.style.display = 'none';
        }
    });

    filterPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            const pillText = e.target.textContent.trim();
            
            if ((pillText === "My Department" || pillText === "My College") && !currentUserId) {
                alert("You must be logged in to use personal network filters!");
                return;
            }

            filterPills.forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');
            
            if (pillText === "My Department") activeFilter = "department";
            else if (pillText === "My College") activeFilter = "college";
            else activeFilter = "global";
        });
    });

    searchBtn.addEventListener('click', async () => {
        const skill = searchInput.value.trim();
        if (!skill) return;

        searchBtn.textContent = "Searching...";
        suggestionsDropdown.style.display = 'none'; 

        let url = `http://127.0.0.1:8000/api/search?skill=${encodeURIComponent(skill)}`;
        
        if (activeFilter === "college" && currentUserCollege) {
            url += `&college=${encodeURIComponent(currentUserCollege)}`;
        } else if (activeFilter === "department" && currentUserDept) {
            url += `&college=${encodeURIComponent(currentUserCollege)}&department=${encodeURIComponent(currentUserDept)}`;
        }

        try {
            // SECURE FETCH: Cookie handled automatically
            const response = await fetch(url, {
                credentials: 'include'
            });
            
            if (response.status === 401) {
                localStorage.removeItem('currentUserId');
                window.location.href = 'login.html';
                return;
            }

            if (response.ok) {
                const profiles = await response.json();
                resultsContainer.innerHTML = ''; 
                
                profiles.forEach(dev => {
                    resultsContainer.innerHTML += `
                        <div class="dev-card">
                            <div class="dev-name">${dev.name}</div>
                            <div class="dev-college">🎓 ${dev.college_name} (${dev.department})</div>
                            <div class="dev-skills">${dev.skills}</div>
                            <a href="profile.html?id=${dev.id}" class="btn-view">View Profile</a>
                        </div>
                    `;
                });
            } else {
                resultsContainer.innerHTML = `
                    <div class="empty-state">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <h4>No Developers Found</h4>
                        <p>Try adjusting your search query or expanding your filter to the Global Network.</p>
                    </div>
                `;
            }
        } catch (error) {
            console.error("Search Error:", error);
            resultsContainer.innerHTML = `<p style="color: red; text-align: center;">Network error occurred.</p>`;
        } finally {
            searchBtn.textContent = "Execute Search";
        }
    });

    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchBtn.click();
        }
    });
});