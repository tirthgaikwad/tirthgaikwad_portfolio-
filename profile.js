// ==========================================
// GLOBAL MODAL SYSTEM (Replaces alerts)
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
// MAIN PROFILE LOGIC
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Choices.js immediately so it's ready before data loads
    let collegeChoice, deptChoice;
    const collegeEl = document.getElementById('editCollege');
    const deptEl = document.getElementById('editDept');
    
    if (collegeEl && deptEl) {
        collegeChoice = new Choices(collegeEl, {
            searchEnabled: true,
            itemSelectText: '',
            shouldSort: false
        });
        deptChoice = new Choices(deptEl, {
            searchEnabled: true,
            itemSelectText: '',
            shouldSort: false
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    let profileIdFromUrl = urlParams.get('id');
    const currentUserId = localStorage.getItem('currentUserId');
    
    let profileId = profileIdFromUrl || currentUserId;
    let isOwnProfile = (!profileIdFromUrl || profileId === currentUserId);

    if (!profileId) {
        const nameEl = document.getElementById('profileName');
        const bioEl = document.getElementById('profileBio');
        if(nameEl) nameEl.textContent = "Error: Please log in.";
        if(bioEl) bioEl.textContent = "Please go to the Log In page first.";
        return;
    }

    const actionBtnsContainer = document.getElementById('actionBtnsContainer');
    if (actionBtnsContainer) {
        if (isOwnProfile) {
            // Render Tailwind styled buttons for own profile
            actionBtnsContainer.innerHTML = `
                <button id="editProfileBtn" class="w-full py-2 px-space-md bg-surface-container-high hover:bg-surface-variant text-primary font-label-md text-label-md rounded-lg transition-colors flex items-center justify-center gap-1.5 font-bold" type="button">
                    <span class="material-symbols-outlined text-[18px]">edit_note</span>
                    <span>Edit Profile</span>
                </button>
                <button id="logoutBtn" class="w-full py-2 px-space-md bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1.5" type="button">
                    <span class="material-symbols-outlined text-[18px]">logout</span>
                    <span>Log Out</span>
                </button>
            `;

            document.getElementById('logoutBtn').addEventListener('click', () => {
                window.showSystemModal("Log Out", "Are you sure you want to securely log out of ProPartner?", "confirm", () => {
                    localStorage.removeItem('currentUserId');
                    window.location.href = "login.html";
                }, "Log Out");
            });

            const editModal = document.getElementById('editModal');
            const editProfileBtn = document.getElementById('editProfileBtn');
            if(editProfileBtn && editModal) {
                editProfileBtn.addEventListener('click', () => editModal.style.display = 'flex');
            }
            const closeModalBtn = document.getElementById('closeModalBtn');
            if(closeModalBtn && editModal) {
                closeModalBtn.addEventListener('click', () => editModal.style.display = 'none');
            }
        } else {
            // Render Tailwind styled buttons for other user's profile
            actionBtnsContainer.innerHTML = `
                <button id="openMessageBtn" class="w-full py-2 px-space-md bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1.5" type="button">
                    <span class="material-symbols-outlined text-[18px]">chat</span>
                    <span>Message</span>
                </button>
                <button id="followBtn" class="w-full py-2 px-space-md bg-surface-container-high hover:bg-surface-variant text-primary font-label-md text-label-md rounded-lg transition-colors flex items-center justify-center gap-1.5 font-bold" type="button">
                    <span class="material-symbols-outlined text-[18px]">person_add</span>
                    <span>Follow Developer</span>
                </button>
            `;

            const messageModal = document.getElementById('messageModal');
            
            document.getElementById('openMessageBtn').addEventListener('click', () => {
                if (!currentUserId) {
                    window.showSystemModal("Authentication Required", "You must be logged in to send messages to other developers.", "alert", () => {
                        window.location.href = "login.html";
                    }, "Go to Login");
                    return;
                }
                const dmReceiverName = document.getElementById('dmReceiverName');
                if(dmReceiverName && currentProfileData) dmReceiverName.textContent = currentProfileData.name;
                if(messageModal) messageModal.style.display = 'flex';
            });

            const closeMessageBtn = document.getElementById('closeMessageBtn');
            if(closeMessageBtn && messageModal) {
                closeMessageBtn.addEventListener('click', () => messageModal.style.display = 'none');
            }

            document.getElementById('followBtn').addEventListener('click', async (e) => {
                if (!currentUserId) {
                    window.showSystemModal("Authentication Required", "You must be logged in to follow developers and expand your network.", "alert", () => {
                        window.location.href = "login.html";
                    }, "Go to Login");
                    return;
                }
                
                e.target.textContent = "Following...";
                try {
                    const res = await fetch('http://127.0.0.1:8000/api/follow', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            follower_id: parseInt(currentUserId),
                            followed_id: parseInt(profileId)
                        })
                    });

                    if (res.ok) {
                        e.target.textContent = "Following ✓";
                        e.target.style.background = "#e2e8f0";
                        e.target.disabled = true;
                        await fetch(`http://127.0.0.1:8000/api/history?action_type=Network Expanded&detail=You followed developer %23${profileId}`, { method: 'POST' });
                    }
                } catch (err) { e.target.textContent = "Error"; }
            });
        }
    }

    // --- FETCH PROFILE DATA ---
    let currentProfileData = {}; 
    try {
        const response = await fetch(`http://127.0.0.1:8000/api/profiles/${profileId}`);
        if (response.ok) {
            currentProfileData = await response.json();
            
            const profileNameEl = document.getElementById('profileName');
            if(profileNameEl) profileNameEl.textContent = currentProfileData.name || "Unknown Developer";
            
            const profileCollegeEl = document.getElementById('profileCollege');
            if(profileCollegeEl) profileCollegeEl.textContent = currentProfileData.college_name || "Unknown College";
            
            const profileCityEl = document.getElementById('profileCity');
            if(profileCityEl) profileCityEl.textContent = currentProfileData.city || "Unknown City";
            
            const profileBioEl = document.getElementById('profileBio');
            if(profileBioEl) profileBioEl.textContent = currentProfileData.bio || "No bio yet.";

            if (currentProfileData.profile_pic) {
                const displayAvatar = document.getElementById('displayAvatar');
                if(displayAvatar) displayAvatar.src = currentProfileData.profile_pic;
                
                const avatarPreviewRender = document.getElementById('avatarPreviewRender');
                if(isOwnProfile && avatarPreviewRender) avatarPreviewRender.src = currentProfileData.profile_pic;
            }
            
            if (currentProfileData.banner_pic) {
                const displayBanner = document.getElementById('displayBanner');
                if(displayBanner) {
                    if (displayBanner.tagName.toLowerCase() === 'img') {
                        displayBanner.src = currentProfileData.banner_pic;
                    } else {
                        displayBanner.style.backgroundImage = `url('${currentProfileData.banner_pic}')`;
                        displayBanner.style.backgroundSize = 'cover';
                    }
                }
                
                const bannerPreviewRender = document.getElementById('bannerPreviewRender');
                if(isOwnProfile && bannerPreviewRender) {
                    bannerPreviewRender.src = currentProfileData.banner_pic;
                    bannerPreviewRender.style.display = 'block';
                }
            }

            const skillsContainer = document.getElementById('profileSkills');
            if(skillsContainer) {
                skillsContainer.innerHTML = '';
                const skillsArray = (currentProfileData.skills || "").split(',').map(s => s.trim()).filter(s => s !== "");
                
                if (skillsArray.length > 0) {
                    skillsArray.forEach(skill => {
                        // Re-create the Tailwind skill pills dynamically
                        const pillDiv = document.createElement('div');
                        pillDiv.className = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-skill-pill text-skill-pill';
                        pillDiv.innerHTML = `<span>${skill}</span>`;
                        skillsContainer.appendChild(pillDiv);
                    });
                } else {
                    skillsContainer.innerHTML = '<span class="inline-flex items-center px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-skill-pill text-skill-pill">No skills listed</span>';
                }
            }

            if (isOwnProfile) {
                const editName = document.getElementById('editName');
                if(editName) editName.value = currentProfileData.name;
                
                const editCity = document.getElementById('editCity');
                if(editCity) editCity.value = currentProfileData.city;
                
                const editDiv = document.getElementById('editDiv');
                if(editDiv) editDiv.value = currentProfileData.division;
                
                const editSkills = document.getElementById('editSkills');
                if(editSkills) editSkills.value = currentProfileData.skills;
                
                const editBio = document.getElementById('editBio');
                if(editBio) editBio.value = currentProfileData.bio;
                
                if (collegeChoice && currentProfileData.college_name) {
                    collegeChoice.setChoiceByValue(currentProfileData.college_name);
                }
                if (deptChoice && currentProfileData.department) {
                    deptChoice.setChoiceByValue(currentProfileData.department);
                }
            }
        }
    } catch (error) { console.error('Error fetching profile:', error); }

    // --- CROPPER.JS IMAGE UPLOAD LOGIC ---
    if (isOwnProfile) {
        let cropper = null;
        let currentCropTarget = '';
        let croppedAvatarBlob = null;
        let croppedBannerBlob = null;

        const cropModal = document.getElementById('cropModal');
        const cropImageTarget = document.getElementById('cropImageTarget');
        
        const triggerAvatar = document.getElementById('triggerAvatarUpload');
        if(triggerAvatar) triggerAvatar.addEventListener('click', () => document.getElementById('editAvatarFile').click());
        
        const triggerBanner = document.getElementById('triggerBannerUpload');
        if(triggerBanner) triggerBanner.addEventListener('click', () => document.getElementById('editBannerFile').click());

        const editAvatarFile = document.getElementById('editAvatarFile');
        if(editAvatarFile) editAvatarFile.addEventListener('change', (e) => handleFileSelect(e, 'avatar'));
        
        const editBannerFile = document.getElementById('editBannerFile');
        if(editBannerFile) editBannerFile.addEventListener('change', (e) => handleFileSelect(e, 'banner'));

        function handleFileSelect(event, type) {
            const file = event.target.files[0];
            if (file) {
                currentCropTarget = type;
                const reader = new FileReader();
                reader.onload = (e) => {
                    if(cropImageTarget) cropImageTarget.src = e.target.result;
                    const title = document.getElementById('cropModalTitle');
                    if(title) title.textContent = type === 'avatar' ? 'Crop Profile Picture' : 'Crop Banner Image';
                    if(cropModal) cropModal.style.display = 'flex';
                    
                    if (cropper) cropper.destroy();
                    
                    if(cropImageTarget) {
                        cropper = new Cropper(cropImageTarget, {
                            aspectRatio: type === 'avatar' ? 1 : 16 / 5,
                            viewMode: 1,
                            autoCropArea: 1,
                            background: false,
                            zoomable: true
                        });
                    }
                };
                reader.readAsDataURL(file);
            }
            event.target.value = '';
        }

        const applyCropBtn = document.getElementById('applyCropBtn');
        if(applyCropBtn) {
            applyCropBtn.addEventListener('click', () => {
                if (cropper) {
                    cropper.getCroppedCanvas().toBlob((blob) => {
                        const objectUrl = URL.createObjectURL(blob);
                        
                        if (currentCropTarget === 'avatar') {
                            const render = document.getElementById('avatarPreviewRender');
                            if(render) render.src = objectUrl;
                            croppedAvatarBlob = blob;
                        } else {
                            const render = document.getElementById('bannerPreviewRender');
                            if(render) {
                                render.src = objectUrl;
                                render.style.display = 'block';
                            }
                            croppedBannerBlob = blob;
                        }
                        
                        if(cropModal) cropModal.style.display = 'none';
                        cropper.destroy();
                        cropper = null;
                    });
                }
            });
        }

        const closeCropBtn = document.getElementById('closeCropBtn');
        if(closeCropBtn) {
            closeCropBtn.addEventListener('click', () => {
                if(cropModal) cropModal.style.display = 'none';
                if(cropper) { cropper.destroy(); cropper = null; }
            });
        }

        // --- SUBMIT FINAL EDITED PROFILE ---
        const editProfileForm = document.getElementById('editProfileForm');
        if(editProfileForm) {
            editProfileForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = e.target.querySelector('button[type="submit"]');
                if(submitBtn) submitBtn.textContent = "Saving...";

                let avatarUrl = currentProfileData.profile_pic || "";
                let bannerUrl = currentProfileData.banner_pic || "";

                if (croppedAvatarBlob) {
                    const fd = new FormData(); 
                    fd.append("file", croppedAvatarBlob, "avatar.png");
                    const res = await fetch('http://127.0.0.1:8000/api/upload', { method: 'POST', body: fd });
                    if (res.ok) avatarUrl = (await res.json()).url;
                }
                
                if (croppedBannerBlob) {
                    const fd = new FormData(); 
                    fd.append("file", croppedBannerBlob, "banner.png");
                    const res = await fetch('http://127.0.0.1:8000/api/upload', { method: 'POST', body: fd });
                    if (res.ok) bannerUrl = (await res.json()).url;
                }

                await fetch(`http://127.0.0.1:8000/api/profiles/${profileId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: document.getElementById('editName') ? document.getElementById('editName').value : currentProfileData.name,
                        college_name: document.getElementById('editCollege') ? document.getElementById('editCollege').value : currentProfileData.college_name,
                        city: document.getElementById('editCity') ? document.getElementById('editCity').value : currentProfileData.city,
                        department: document.getElementById('editDept') ? document.getElementById('editDept').value : currentProfileData.department,
                        division: document.getElementById('editDiv') ? document.getElementById('editDiv').value : currentProfileData.division,
                        skills: document.getElementById('editSkills') ? document.getElementById('editSkills').value : currentProfileData.skills,
                        bio: document.getElementById('editBio') ? document.getElementById('editBio').value : currentProfileData.bio,
                        roll_no: currentProfileData.roll_no,
                        town: currentProfileData.town,
                        profile_pic: avatarUrl,
                        banner_pic: bannerUrl
                    })
                });
                window.location.reload();
            });
        }
    }

    // --- HANDLE SENDING MESSAGES ---
    const sendMessageForm = document.getElementById('sendMessageForm');
    if(sendMessageForm) {
        sendMessageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dmContent = document.getElementById('dmContent').value;
            const statusText = document.getElementById('dmStatus');

            const res = await fetch('http://127.0.0.1:8000/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_id: parseInt(currentUserId),
                    receiver_id: parseInt(profileId),
                    content: dmContent
                })
            });

            if (res.ok) {
                try { await fetch(`http://127.0.0.1:8000/api/history?action_type=Message Sent&detail=You started a conversation with developer %23${profileId}`, { method: 'POST' }); } catch(err){}
                if(statusText) statusText.style.display = 'block';
                setTimeout(() => { 
                    const msgModal = document.getElementById('messageModal');
                    if(msgModal) msgModal.style.display = 'none'; 
                }, 1500);
            }
        });
    }
});