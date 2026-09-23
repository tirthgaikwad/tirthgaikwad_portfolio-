import re

filepath = r'c:\Users\omkar\OneDrive\Desktop\Connect2Minds\saved.html'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the existing script tag with a new one
script_start = content.find('<script>')
script_end = content.find('</script>', script_start) + len('</script>')

new_script = """
<script>
  document.addEventListener('DOMContentLoaded', async () => {
    const grid = document.getElementById('profilesGrid');
    const searchInput = document.getElementById('profileSearchInput');
    let allProfiles = [];

    // Initialize team modal logic if it exists globally
    // We will assume window.showTeamModal or similar doesn't exist, we'll make a generic alert

    async function loadSavedProfiles() {
      try {
        const res = await fetch('/api/saved_profiles');
        if (!res.ok) throw new Error('Failed to fetch');
        allProfiles = await res.json();
        renderProfiles(allProfiles);
      } catch (err) {
        console.error(err);
        grid.innerHTML = '<div class="col-span-full text-center py-10 text-on-surface-variant">Failed to load saved profiles.</div>';
      }
    }

    function renderProfiles(profiles) {
      grid.innerHTML = '';
      if (profiles.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-10 text-on-surface-variant font-medium">No saved profiles found.</div>';
        updateCount(0, 0);
        return;
      }
      
      profiles.forEach(p => {
        const skillsList = p.skills ? p.skills.split(',').map(s => s.trim()).filter(s => s) : [];
        const skillsHtml = skillsList.slice(0, 4).map(s => `<span class="px-2.5 py-0.5 rounded-md bg-surface-container-low text-on-surface font-skill-pill text-skill-pill border border-outline-variant/30">${s}</span>`).join('');
        
        // Use default images if null
        const bannerImg = p.banner_pic || 'https://lh3.googleusercontent.com/aida-public/AB6AXuBHptu7BEWRhV6skNtm_fg5EyqEVyaouXrMxQ1OYLnNuUPkCUzvOCU-suQqiztjwaySQ17qZp7mT8lUL7apOARuNYVz8-CYnXc8vxDF2lIwKF9fEEENmNYe4APlyF4bRoeEaSdzex3cUuKAVGBd2TntTVuSXs8Pw3hUTtdGy_HzB8hpG9uZsksWTxEaad_yghyaMREiSJlHnmj1qxdQv8kaUDtaVrk8-yrGJmxbz3tmlg8n9ai7pNZt';
        const profileImg = p.profile_pic || 'https://lh3.googleusercontent.com/aida-public/AB6AXuCxP_X06Uai69kkypdqmsOGG78aOgE1CTy-AVljtmXilnkzCFCjRgoM1F7uhRl1gA1NJtVLp8IFgEBIlTPFfjrTzuPUM2RXJ2_xf0yNxCw5ZCAMqJnXFen9FIK9Fm3tUdExndNAAfJYLr3tq1B1eT1znWUHa9hlNtdoyqg-7h-h8Cr6Ulu57yMx7eiXHO2XlOGUfqLsuPT57eUIat8I8Wx9dk83kgCk5jZGbSIMc2lpcv9hDEhGXXJg';

        const card = document.createElement('div');
        card.className = 'candidate-card bg-surface-container-lowest rounded-2xl border border-outline-variant/50 overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)] hover:shadow-[0_10px_25px_-5px_rgba(79,70,229,0.08)] transition-all flex flex-col justify-between group';
        
        // Set searchable text
        card.dataset.search = `${p.name} ${p.department} ${p.college_name} ${p.skills}`.toLowerCase();
        
        card.innerHTML = `
          <div>
            <div class="relative h-24 w-full bg-cover bg-center overflow-hidden" style="background-image: url('${bannerImg}')">
              <div class="absolute inset-0 bg-gradient-to-t from-surface-container-lowest via-transparent to-black/30"></div>
              <div class="absolute top-2.5 left-3 flex items-center">
                <input class="profile-select-box w-4 h-4 rounded text-primary focus:ring-primary border-surface-container-lowest bg-surface-container-lowest/90" type="checkbox"/>
              </div>
              <button aria-label="Remove Bookmark" class="bookmark-btn absolute top-2.5 right-3 w-8 h-8 rounded-full bg-surface-container-lowest/90 backdrop-blur-sm flex items-center justify-center hover:scale-105 transition-transform shadow-sm text-primary" type="button" data-id="${p.id}">
                <span class="material-symbols-outlined text-[18px]" style="font-variation-settings: 'FILL' 1;">bookmark</span>
              </button>
            </div>
            
            <div class="px-space-md -mt-10 flex flex-col items-center text-center">
              <div class="relative mb-2">
                <div class="w-16 h-16 rounded-full ring-4 ring-surface-container-lowest overflow-hidden bg-surface-container shadow-md">
                  <img class="w-full h-full object-cover" src="${profileImg}"/>
                </div>
              </div>
              <div class="flex items-center gap-1.5 mb-0.5">
                <h2 class="font-headline-md text-headline-md text-on-surface font-bold">${p.name}</h2>
              </div>
              <p class="font-body-sm text-body-sm text-on-surface-variant flex items-center justify-center gap-1 line-clamp-1 max-w-full">
                <span class="material-symbols-outlined text-[15px] shrink-0 text-primary">school</span>
                ${p.college_name}
              </p>
              <p class="font-label-sm text-label-sm font-semibold text-primary mt-0.5">
                ${p.department}
              </p>
              
              <div class="flex flex-wrap items-center justify-center gap-1.5 mt-3">
                ${skillsHtml}
              </div>
            </div>
          </div>
          
          <div class="p-space-md pt-3 mt-3 border-t border-outline-variant/20 flex items-center gap-2">
            <button class="view-btn flex-1 py-2 rounded-lg border border-outline-variant/50 hover:bg-surface-container-low text-on-surface font-label-md text-label-md text-center transition-colors" type="button" data-id="${p.id}">
              View Profile
            </button>
            <button aria-label="Send direct message" class="msg-btn w-9 h-9 rounded-lg border border-outline-variant/50 flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low hover:text-primary transition-colors shrink-0" type="button" data-id="${p.id}">
              <span class="material-symbols-outlined text-[18px]">chat</span>
            </button>
            <button class="team-btn flex-1 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md text-center transition-colors shadow-sm flex items-center justify-center gap-1" type="button" data-id="${p.id}">
              <span class="material-symbols-outlined text-[16px]">add</span>
              Add to Team
            </button>
          </div>
        `;
        
        grid.appendChild(card);
      });
      
      updateCount(profiles.length, profiles.length);
      attachListeners();
    }
    
    function updateCount(showing, total) {
      const countEl = document.querySelector('.font-semibold.text-on-surface');
      if (countEl && countEl.parentElement && countEl.parentElement.innerHTML.includes('Showing')) {
        countEl.parentElement.innerHTML = `Showing <span class="font-semibold text-on-surface">1 - ${showing}</span> of <span class="font-semibold text-on-surface">${total}</span> saved developers`;
      }
      
      // Update filter tags
      const allSavedBtn = document.querySelector('#filterTagGroup button:first-child');
      if(allSavedBtn) allSavedBtn.innerText = `All Saved (${total})`;
    }
    
    function attachListeners() {
      // Remove Bookmark
      document.querySelectorAll('.bookmark-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          const userId = btn.dataset.id;
          try {
             // In backend, following/saving a profile might be via /api/save/{user_id}
             // Wait, looking at the main.py snippet: @app.post("/api/follow/{user_id}") has save logic? No, wait... 
             // "Target name ... unsaved" it was under /api/save/{user_id}?
             const res = await fetch(`/api/save/${userId}`, { method: 'POST' });
             if (res.ok) {
                 btn.closest('.candidate-card').remove();
                 allProfiles = allProfiles.filter(p => p.id != userId);
                 updateCount(allProfiles.length, allProfiles.length);
             }
          } catch(err) { console.error(err); }
        });
      });
      
      // View Profile
      document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          window.location.href = `/profile.html?id=${btn.dataset.id}`;
        });
      });
      
      // Direct Message
      document.querySelectorAll('.msg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          window.location.href = `/inbox.html?user=${btn.dataset.id}`;
        });
      });
      
      // Add to Team
      document.querySelectorAll('.team-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (window.showSystemModal) {
            window.showSystemModal("Add to Team", "Select a team to add this user to. (Coming Soon)", "info");
          } else {
            alert("Add to team functionality coming soon.");
          }
        });
      });
      
      // Checkbox Logic
      const selectAllCheckbox = document.getElementById('selectAllCheckbox');
      const cardCheckboxes = document.querySelectorAll('.profile-select-box');
      const countDisplay = document.getElementById('selectedCountText');

      function updateSelectedCount() {
        const checked = document.querySelectorAll('.profile-select-box:checked').length;
        if (countDisplay) {
          countDisplay.textContent = checked + ' candidate' + (checked === 1 ? '' : 's') + ' selected';
        }
        if (selectAllCheckbox) {
          selectAllCheckbox.checked = (checked > 0 && checked === cardCheckboxes.length);
          selectAllCheckbox.indeterminate = (checked > 0 && checked < cardCheckboxes.length);
        }
      }

      if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', function() {
          document.querySelectorAll('.profile-select-box').forEach(cb => cb.checked = selectAllCheckbox.checked);
          updateSelectedCount();
        });
      }

      document.querySelectorAll('.profile-select-box').forEach(cb => {
        cb.addEventListener('change', updateSelectedCount);
      });
    }
    
    // Search input
    if (searchInput) {
      searchInput.addEventListener('input', function(e) {
        const query = e.target.value.toLowerCase().trim();
        const cards = document.querySelectorAll('.candidate-card');
        let showing = 0;
        cards.forEach(card => {
          if (!query || card.dataset.search.includes(query)) {
            card.style.display = 'flex';
            showing++;
          } else {
            card.style.display = 'none';
          }
        });
        updateCount(showing, allProfiles.length);
      });
    }

    // Filter chip toggle
    const filterChips = document.querySelectorAll('#filterTagGroup .filter-chip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', function() {
        filterChips.forEach(c => {
          c.classList.remove('bg-primary', 'text-on-primary');
          c.classList.add('bg-surface-container', 'text-on-surface-variant');
        });
        chip.classList.remove('bg-surface-container', 'text-on-surface-variant');
        chip.classList.add('bg-primary', 'text-on-primary');
        // Custom filter logic could go here
      });
    });

    loadSavedProfiles();
  });
</script>
"""

new_content = content[:script_start] + new_script + content[script_end:]
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(new_content)

print("Injected dynamic script.")
