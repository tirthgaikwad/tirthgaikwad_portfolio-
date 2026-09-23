
  let currentTab = 'followers';
  let followersData = [];
  let followingData = [];
  let mutualData = [];
  let profileUrl = '';

  document.addEventListener('DOMContentLoaded', async () => {
    if (!currentUserId || !localStorage.getItem('authToken')) {
       window.location.href = 'login.html';
       return;
    }

    try {
        const userRes = await fetch(`${API_BASE}/api/profiles/${currentUserId}`, { credentials: 'include' });
        if(userRes.ok) {
            const user = await userRes.json();
            document.getElementById('collegeBadge').innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span>${user.college_name || 'Campus Node'}`;
            document.getElementById('userDept').innerText = user.department || 'Department';
            document.getElementById('userRoll').innerText = `Student ID: #${user.roll_no || 'Unknown'}`;
            document.getElementById('collegeHubText').innerText = `${user.college_name || 'Campus'} Peer Hub`;
            
            const handle = user.name ? user.name.replace(/\s+/g, '-').toLowerCase() : 'user';
            profileUrl = `https://propartner.edu/@${handle}`;
            
            document.getElementById('shareHandleText').innerText = `propartner.edu/@${handle}`;
            document.getElementById('footerHandle').innerText = handle;
            
            document.getElementById('suggestedTitle').innerText = `Suggested Collaborators from ${user.college_name || 'Campus'}`;
        }

        await loadNetworkData();
        loadSuggestedPeers();

    } catch (e) {
        console.error("Error init:", e);
    }

    // Tab Listeners
    document.querySelectorAll('#networkTabs button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.currentTarget.dataset.tab;
            switchTab(tab);
        });
    });

    document.getElementById('networkSearch').addEventListener('input', (e) => {
        renderGrid(e.target.value.toLowerCase());
    });
    
    document.getElementById('refreshSuggestedBtn').addEventListener('click', () => {
        loadSuggestedPeers();
    });

    // Copy setups
    setupCopy('copyProfileBtn', profileUrl, 'Link Copied!');
    setupCopy('quickCopyTrigger', profileUrl, 'Link Copied!');
    setupCopy('bannerCopyBtn', profileUrl, 'Copied!');
  });

  async function loadNetworkData() {
      try {
          const [followersRes, followingRes] = await Promise.all([
              fetch(`${API_BASE}/api/users/${currentUserId}/followers`, { credentials: 'include' }),
              fetch(`${API_BASE}/api/users/${currentUserId}/following`, { credentials: 'include' })
          ]);

          if (followersRes.ok) followersData = await followersRes.json();
          if (followingRes.ok) followingData = await followingRes.json();

          // Mutuals = intersection
          const followingIds = new Set(followingData.map(u => u.id));
          mutualData = followersData.filter(u => followingIds.has(u.id));

          document.getElementById('followersCount').innerText = followersData.length;
          document.getElementById('followingCount').innerText = followingData.length;
          document.getElementById('mutualCount').innerText = mutualData.length;

          switchTab('followers');
      } catch (err) {
          console.error(err);
      }
  }

  function switchTab(tab) {
      currentTab = tab;
      
      // Update UI Tabs
      document.querySelectorAll('#networkTabs button').forEach(btn => {
          if (btn.dataset.tab === tab) {
              btn.classList.add('text-primary', 'border-primary', 'font-semibold');
              btn.classList.remove('text-on-surface-variant', 'border-transparent', 'font-medium');
              const badge = btn.querySelector('span:last-child');
              badge.classList.remove('bg-surface-container', 'text-on-surface-variant');
              badge.classList.add('bg-primary/10', 'text-primary');
          } else {
              btn.classList.remove('text-primary', 'border-primary', 'font-semibold');
              btn.classList.add('text-on-surface-variant', 'border-transparent', 'font-medium');
              const badge = btn.querySelector('span:last-child');
              badge.classList.add('bg-surface-container', 'text-on-surface-variant');
              badge.classList.remove('bg-primary/10', 'text-primary');
          }
      });
      
      let tabName = "Followers";
      if(tab === "following") tabName = "Following";
      if(tab === "mutual") tabName = "Mutual Collaborators";
      document.getElementById('breadcrumbActiveTab').innerText = tabName;

      renderGrid();
  }

  function renderGrid(query = "") {
      let data = [];
      if (currentTab === 'followers') data = followersData;
      else if (currentTab === 'following') data = followingData;
      else if (currentTab === 'mutual') data = mutualData;

      if (query) {
          data = data.filter(u => 
              (u.name && u.name.toLowerCase().includes(query)) ||
              (u.skills && u.skills.toLowerCase().includes(query)) ||
              (u.department && u.department.toLowerCase().includes(query)) ||
              (u.college_name && u.college_name.toLowerCase().includes(query))
          );
      }

      const grid = document.getElementById('dynamicNetworkGrid');
      const zero = document.getElementById('zeroStateContainer');
      document.getElementById('filteredCount').innerText = `Filtered (${data.length})`;

      if (data.length === 0 && !query) {
          grid.classList.add('hidden');
          zero.classList.remove('hidden');
          
          if (currentTab === 'followers') {
              document.getElementById('zeroStateTitle').innerText = "Awaiting First Follower";
              document.getElementById('zeroStateHeading').innerText = "You don't have any followers yet";
              document.getElementById('zeroStateBody').innerText = "When classmates, department professors, or teammates follow your profile, their updates will populate here.";
          } else if (currentTab === 'following') {
              document.getElementById('zeroStateTitle').innerText = "Start Connecting";
              document.getElementById('zeroStateHeading').innerText = "You aren't following anyone yet";
              document.getElementById('zeroStateBody').innerText = "Follow developers from your college to see their updates and repositories.";
          } else {
              document.getElementById('zeroStateTitle').innerText = "No Mutual Connections";
              document.getElementById('zeroStateHeading').innerText = "You don't have mutual collaborators";
              document.getElementById('zeroStateBody').innerText = "When you follow someone and they follow you back, they will appear here.";
          }
      } else {
          zero.classList.add('hidden');
          grid.classList.remove('hidden');
          grid.innerHTML = '';

          data.forEach(user => {
              grid.appendChild(createPeerCard(user));
          });
      }
  }

  async function loadSuggestedPeers() {
      try {
          const res = await fetch(`${API_BASE}/api/profiles`, { credentials: 'include' });
          if(res.ok) {
              const allUsers = await res.json();
              // Filter out current user and already followed
              const followingIds = new Set(followingData.map(u => u.id));
              const suggestions = allUsers.filter(u => u.id != currentUserId && !followingIds.has(u.id));
              
              // Shuffle
              suggestions.sort(() => 0.5 - Math.random());
              const toShow = suggestions.slice(0, 4);
              
              const sGrid = document.getElementById('suggestedGrid');
              sGrid.innerHTML = '';
              if (toShow.length === 0) {
                  sGrid.innerHTML = '<div class="col-span-full py-8 text-center text-on-surface-variant">No new suggestions at the moment.</div>';
              } else {
                  toShow.forEach(u => sGrid.appendChild(createPeerCard(u)));
              }
          }
      } catch (err) {}
  }

  function createPeerCard(user) {
      const skillsList = user.skills ? user.skills.split(',').map(s => s.trim()).filter(s => s) : [];
      const skillsHtml = skillsList.slice(0, 3).map(s => `<span class="px-2 py-0.5 rounded-md bg-surface-container text-on-surface-variant font-skill-pill text-skill-pill truncate max-w-[80px]">${s}</span>`).join('');
      
      let initials = user.name ? user.name.substring(0,2).toUpperCase() : "U";
      
      // Check if following
      const isFollowing = followingData.some(u => u.id == user.id);
      
      const div = document.createElement('div');
      div.className = "bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-space-md flex flex-col justify-between hover:shadow-md hover:-translate-y-0.5 transition-all group";
      div.innerHTML = `
        <div>
          <div class="flex items-start justify-between gap-2 mb-space-sm cursor-pointer" onclick="window.location.href='profile.html?id=${user.id}'">
            <div class="relative">
              <div class="w-14 h-14 rounded-full bg-primary-fixed text-on-primary-fixed flex items-center justify-center font-headline-sm text-headline-sm font-bold shadow-inner">
                ${initials}
              </div>
            </div>
            ${user.cgpa ? `<span class="px-2 py-0.5 rounded-full bg-tertiary-container/10 text-tertiary font-label-sm text-[11px] font-bold">${user.cgpa} CGPA</span>` : ''}
          </div>
          <div class="mb-space-sm cursor-pointer" onclick="window.location.href='profile.html?id=${user.id}'">
            <h4 class="font-headline-sm text-headline-sm font-bold text-on-surface group-hover:text-primary transition-colors truncate">
              ${user.name}
            </h4>
            <p class="font-body-sm text-body-sm text-on-surface-variant truncate">${user.department || 'Unknown Dept'} • ${user.college_name || ''}</p>
          </div>
          <div class="flex flex-wrap gap-1.5 mb-space-md">
            ${skillsHtml}
          </div>
        </div>
        <div class="flex items-center gap-2 pt-space-xs border-t border-outline-variant/30">
          <button class="flex-1 py-2 px-3 rounded-lg ${isFollowing ? 'bg-surface-container-low text-on-surface border border-outline-variant/50' : 'bg-primary hover:bg-primary-container text-on-primary'} font-label-md text-label-md flex items-center justify-center gap-1.5 transition-colors shadow-sm" type="button" onclick="toggleFollow(this, ${user.id})">
            <span class="material-symbols-outlined text-[16px]">${isFollowing ? 'person_remove' : 'person_add'}</span>
            <span>${isFollowing ? 'Unfollow' : 'Connect'}</span>
          </button>
          <button class="p-2 rounded-lg border border-outline-variant/50 text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors" title="Quick Message" type="button" onclick="window.location.href='inbox.html?user=${user.id}'">
            <span class="material-symbols-outlined text-[18px]">chat</span>
          </button>
        </div>
      `;
      return div;
  }

  async function toggleFollow(btn, userId) {
      try {
          const res = await fetch(`${API_BASE}/api/follow/${userId}`, { method: 'POST', credentials: 'include' });
          if(res.ok) {
              await loadNetworkData();
              loadSuggestedPeers();
          }
      } catch (err) { console.error(err); }
  }

  function setupCopy(buttonId, textToCopy, successLabel) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      let t = profileUrl || textToCopy;
      navigator.clipboard.writeText(t).then(() => {
        const originalContent = btn.innerHTML;
        btn.innerHTML = `<span class="material-symbols-outlined text-[16px]">check_circle</span><span>${successLabel}</span>`;
        btn.classList.add('bg-tertiary-container', 'text-white');
        setTimeout(() => {
          btn.innerHTML = originalContent;
          btn.classList.remove('bg-tertiary-container', 'text-white');
        }, 2200);
      }).catch(() => {
        alert('Copied link to clipboard: ' + t);
      });
    });
  }
