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
        document.getElementById('profileName').textContent = "Error: Please log in.";
        document.getElementById('profileBio').textContent = "Please go to the Log In page first.";
        return;
    }

    const actionBtnsContainer = document.getElementById('actionBtnsContainer');
    if (isOwnProfile) {
        actionBtnsContainer.innerHTML = `
            <button id="editProfileBtn" class="btn btn-primary">Edit Profile</button>
            <button id="logoutBtn" class="btn btn-secondary">Log Out</button>
        `;

        document.getElementById('logoutBtn').addEventListener('click', () => {
            localStorage.removeItem('currentUserId');
            window.location.href = "login.html";
        });

        const editModal = document.getElementById('editModal');
        document.getElementById('editProfileBtn').addEventListener('click', () => editModal.style.display = 'flex');
        document.getElementById('closeModalBtn').addEventListener('click', () => editModal.style.display = 'none');
    } else {
        actionBtnsContainer.innerHTML = `
            <button id="openMessageBtn" class="btn btn-primary">Message</button>
            <button id="followBtn" class="btn btn-secondary">Follow Developer</button>
        `;

        const messageModal = document.getElementById('messageModal');
        document.getElementById('openMessageBtn').addEventListener('click', () => {
            if (!currentUserId) {
                alert("You must be logged in to send messages!");
                window.location.href = "login.html";
                return;
            }
            document.getElementById('dmReceiverName').textContent = currentProfileData.name;
            messageModal.style.display = 'flex';
        });

        document.getElementById('closeMessageBtn').addEventListener('click', () => messageModal.style.display = 'none');

        document.getElementById('followBtn').addEventListener('click', async (e) => {
            if (!currentUserId) {
                alert("Please log in to follow developers.");
                window.location.href = "login.html";
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

    // --- FETCH PROFILE DATA ---
    let currentProfileData = {}; 
    try {
        const response = await fetch(`http://127.0.0.1:8000/api/profiles/${profileId}`);
        if (response.ok) {
            currentProfileData = await response.json();
            
            document.getElementById('profileName').textContent = currentProfileData.name || "Unknown Developer";
            document.getElementById('profileCollege').textContent = currentProfileData.college_name || "Unknown College";
            document.getElementById('profileCity').textContent = currentProfileData.city || "Unknown City";
            document.getElementById('profileBio').textContent = currentProfileData.bio || "No bio yet.";

            if (currentProfileData.profile_pic) {
                document.getElementById('displayAvatar').src = currentProfileData.profile_pic;
                if(isOwnProfile) document.getElementById('avatarPreviewRender').src = currentProfileData.profile_pic;
            }
            if (currentProfileData.banner_pic) {
                document.getElementById('displayBanner').style.backgroundImage = `url('${currentProfileData.banner_pic}')`;
                document.getElementById('displayBanner').style.backgroundSize = 'cover';
                
                if(isOwnProfile) {
                    document.getElementById('bannerPreviewRender').src = currentProfileData.banner_pic;
                    document.getElementById('bannerPreviewRender').style.display = 'block';
                }
            }

            const skillsContainer = document.getElementById('profileSkills');
            skillsContainer.innerHTML = '';
            const skillsArray = (currentProfileData.skills || "").split(',').map(s => s.trim()).filter(s => s !== "");
            
            if (skillsArray.length > 0) {
                skillsArray.forEach(skill => {
                    const span = document.createElement('span');
                    span.className = 'skill-tag';
                    span.textContent = skill;
                    skillsContainer.appendChild(span);
                });
            } else {
                skillsContainer.innerHTML = '<span class="skill-tag">No skills listed</span>';
            }

            if (isOwnProfile) {
                document.getElementById('editName').value = currentProfileData.name;
                document.getElementById('editCity').value = currentProfileData.city;
                document.getElementById('editDiv').value = currentProfileData.division;
                document.getElementById('editSkills').value = currentProfileData.skills;
                document.getElementById('editBio').value = currentProfileData.bio;
                
                // Use Choices.js API to correctly set the selected options
                if (collegeChoice && currentProfileData.college_name) {
                    collegeChoice.setChoiceByValue(currentProfileData.college_name);
                }
                if (deptChoice && currentProfileData.department) {
                    deptChoice.setChoiceByValue(currentProfileData.department);
                }
            }
        }
    } catch (error) { console.error('Error:', error); }

    // --- CROPPER.JS IMAGE UPLOAD LOGIC ---
    if (isOwnProfile) {
        let cropper = null;
        let currentCropTarget = '';
        let croppedAvatarBlob = null;
        let croppedBannerBlob = null;

        const cropModal = document.getElementById('cropModal');
        const cropImageTarget = document.getElementById('cropImageTarget');
        
        document.getElementById('triggerAvatarUpload').addEventListener('click', () => document.getElementById('editAvatarFile').click());
        document.getElementById('triggerBannerUpload').addEventListener('click', () => document.getElementById('editBannerFile').click());

        document.getElementById('editAvatarFile').addEventListener('change', (e) => handleFileSelect(e, 'avatar'));
        document.getElementById('editBannerFile').addEventListener('change', (e) => handleFileSelect(e, 'banner'));

        function handleFileSelect(event, type) {
            const file = event.target.files[0];
            if (file) {
                currentCropTarget = type;
                const reader = new FileReader();
                reader.onload = (e) => {
                    cropImageTarget.src = e.target.result;
                    document.getElementById('cropModalTitle').textContent = type === 'avatar' ? 'Crop Profile Picture' : 'Crop Banner Image';
                    cropModal.style.display = 'flex';
                    
                    if (cropper) cropper.destroy();
                    
                    cropper = new Cropper(cropImageTarget, {
                        aspectRatio: type === 'avatar' ? 1 : 16 / 5,
                        viewMode: 1,
                        autoCropArea: 1,
                        background: false,
                        zoomable: true
                    });
                };
                reader.readAsDataURL(file);
            }
            event.target.value = '';
        }

        document.getElementById('applyCropBtn').addEventListener('click', () => {
            if (cropper) {
                cropper.getCroppedCanvas().toBlob((blob) => {
                    const objectUrl = URL.createObjectURL(blob);
                    
                    if (currentCropTarget === 'avatar') {
                        document.getElementById('avatarPreviewRender').src = objectUrl;
                        croppedAvatarBlob = blob;
                    } else {
                        document.getElementById('bannerPreviewRender').src = objectUrl;
                        document.getElementById('bannerPreviewRender').style.display = 'block';
                        croppedBannerBlob = blob;
                    }
                    
                    cropModal.style.display = 'none';
                    cropper.destroy();
                    cropper = null;
                });
            }
        });

        document.getElementById('closeCropBtn').addEventListener('click', () => {
            cropModal.style.display = 'none';
            if(cropper) { cropper.destroy(); cropper = null; }
        });

        // --- SUBMIT FINAL EDITED PROFILE ---
        document.getElementById('editProfileForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.textContent = "Saving...";

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

            // Note: Use .value to grab the current state of the select elements
            await fetch(`http://127.0.0.1:8000/api/profiles/${profileId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('editName').value,
                    college_name: document.getElementById('editCollege').value,
                    city: document.getElementById('editCity').value,
                    department: document.getElementById('editDept').value,
                    division: document.getElementById('editDiv').value,
                    skills: document.getElementById('editSkills').value,
                    bio: document.getElementById('editBio').value,
                    roll_no: currentProfileData.roll_no,
                    town: currentProfileData.town,
                    profile_pic: avatarUrl,
                    banner_pic: bannerUrl
                })
            });
            window.location.reload();
        });
    }

    // --- HANDLE SENDING MESSAGES ---
    document.getElementById('sendMessageForm').addEventListener('submit', async (e) => {
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
            try { await fetch(`http://127.0.0.1:8000/api/history?action_type=Message Sent&detail=You started a conversation with developer %23${profileId}`, { method: 'POST' }); } catch(e){}
            statusText.style.display = 'block';
            setTimeout(() => { document.getElementById('messageModal').style.display = 'none'; }, 1500);
        }
    });
});