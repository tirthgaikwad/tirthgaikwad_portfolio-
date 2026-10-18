// ==========================================
// PROFILE.JS — Viewing and editing a profile, projects, GitHub, followers, resume
// Loaded after shared.js and chat-common.js (api, caches, toast, el, getInitials).
// ==========================================

const viewedUserId = parseInt(new URLSearchParams(window.location.search).get('id')) || currentUserId;
const isOwnProfile = viewedUserId === currentUserId;
const CROPPER_VERSION = '1.5.13';

let profile = null;            // the profile on screen, as returned by /api/profiles/{id}/page
let previewingPublic = false;  // owner looking at their page the way visitors see it
let githubStats = null;

// Picture cropping
let cropper = null;
let cropKind = null;           // 'profile' or 'banner'
let cropperLoading = null;

// Project being added or edited
let editingProjectId = null;
let projectImageUrl = '';

// ==========================================
// 1. LOADING
// ==========================================
async function initProfile() {
  document.body.classList.toggle('is-own', isOwnProfile);
  el('breadcrumbKind').textContent = isOwnProfile ? 'My Profile' : 'Profile';
  el('editProfileForm').addEventListener('submit', saveProfile);
  el('projectForm').addEventListener('submit', saveProject);
  el('githubForm').addEventListener('submit', connectGithub);
  el('pictureFileInput').addEventListener('change', onPictureChosen);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProfileModals(); });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && overlay.id !== 'cropModal' && overlay.id !== 'systemModal') overlay.classList.remove('active'); });
  });

  // 1. The copy saved on the last visit, so the page is never blank
  const cached = cacheGet(`profile:${viewedUserId}`);
  if (cached) {
    profile = cached;
    renderProfile();
  }

  // 2. The real thing (already requested from the page head)
  await loadProfile();
}

async function loadProfile() {
  let data;
  try {
    const prefetched = window.__profilePrefetch ? await window.__profilePrefetch : null;
    window.__profilePrefetch = null;
    if (prefetched && prefetched.status === 200) {
      data = prefetched.data;
    } else if (prefetched && prefetched.status === 401) {
      return handleLoggedOut();
    } else {
      data = await api(`/api/profiles/${viewedUserId}/page`);
    }
  } catch (err) {
    if (err.status === 404) {
      return showProblem('person_off', 'Profile not found', 'This account does not exist or has been removed.', '<a href="search.html" class="btn-primary-modal">Discover people</a>');
    }
    if (!profile) {
      showProblem('cloud_off', 'Could not load this profile', err.message, '<button type="button" class="btn-primary-modal" onclick="retryLoadProfile()">Try again</button>');
    }
    return;
  }

  profile = data;
  cacheSet(`profile:${viewedUserId}`, profile);
  hideProblem();
  renderProfile();
  loadGithub();
}

function retryLoadProfile() {
  hideProblem();
  loadProfile();
}

function showProblem(icon, title, text, actionsHtml) {
  el('profileContent').classList.add('hidden');
  el('profileProblemIcon').textContent = icon;
  el('profileProblemTitle').textContent = title;
  el('profileProblemText').textContent = text;
  el('profileProblemActions').innerHTML = actionsHtml || '';
  el('profileProblem').classList.remove('hidden');
  el('breadcrumbName').textContent = title;
}

function hideProblem() {
  el('profileProblem').classList.add('hidden');
  el('profileContent').classList.remove('hidden');
}

// Keep the cached copy, and the site header if this is our own profile, in step with what is on screen
function profileChanged() {
  cacheSet(`profile:${viewedUserId}`, profile);
  if (isOwnProfile && typeof window.applyHeaderProfile === 'function') {
    const card = Object.assign({}, profile);
    delete card.projects;
    window.applyHeaderProfile(card);
    try { localStorage.setItem(`c2m:${currentUserId}:me`, JSON.stringify(card)); } catch (e) { /* storage unavailable */ }
  }
}

// ==========================================
// 2. RENDERING
// ==========================================
function showsOwnerControls() {
  return isOwnProfile && !previewingPublic;
}

function splitList(text) {
  return String(text || '').split(',').map(s => s.trim()).filter(Boolean);
}

function pillsHtml(items, emptyText) {
  if (items.length === 0) return `<span class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(emptyText)}</span>`;
  return items.map(item => `<span class="inline-flex items-center px-3 py-1.5 rounded-lg bg-surface-container text-on-surface font-skill-pill text-skill-pill">${escapeHtml(item)}</span>`).join('');
}

function renderProfile() {
  if (!profile) return;
  document.title = `${profile.name || 'Profile'} | Connect2Minds`;
  el('breadcrumbName').textContent = profile.name || 'Developer';

  // Identity
  el('profileName').textContent = profile.name || 'Unknown Developer';
  el('profileBio').textContent = profile.bio || (showsOwnerControls() ? 'Add a short bio so people know what you are working on.' : 'No bio yet.');
  el('profileRoll').textContent = profile.roll_no || 'N/A';
  el('followersCount').textContent = profile.followers_count || 0;
  el('followingCount').textContent = profile.following_count || 0;

  const avatar = el('displayAvatar');
  const placeholder = el('avatarPlaceholder');
  placeholder.textContent = getInitials(profile.name || '?');
  if (profile.profile_pic) {
    avatar.src = profile.profile_pic;
    avatar.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    avatar.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
  avatar.onerror = () => { avatar.classList.add('hidden'); placeholder.classList.remove('hidden'); };

  const banner = el('displayBanner');
  if (profile.banner_pic) {
    banner.src = profile.banner_pic;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
  banner.onerror = () => banner.classList.add('hidden');

  // Badges come from the account itself, not decoration
  const verified = profile.account_status === 'verified';
  el('verifiedTick').classList.toggle('hidden', !verified);
  const badges = [];
  if (profile.account_type && profile.account_type !== 'standard') {
    badges.push(`<span class="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm font-bold uppercase">${escapeHtml(profile.account_type)}</span>`);
  }
  // What the person does, how long they have done it and what they welcome
  badges.push(`<span class="px-2 py-0.5 rounded-full bg-surface-container-high text-primary font-label-sm text-label-sm font-bold">${escapeHtml(professionOf(profile))}</span>`);
  if (profile.experience_years > 0) {
    badges.push(`<span class="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm font-semibold">${profile.experience_years} ${profile.experience_years === 1 ? 'yr' : 'yrs'} experience</span>`);
  }
  openToLabels(profile.open_to).forEach(label => {
    badges.push(`<span class="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm font-semibold">Open to ${escapeHtml(label.toLowerCase())}</span>`);
  });
  badges.unshift(roleBadgesHtml(profile));
  if (verified) {
    badges.push('<span class="px-2 py-0.5 rounded-full bg-tertiary-fixed/40 text-tertiary font-label-sm text-label-sm font-bold">Verified student</span>');
  } else if (showsOwnerControls() && profile.account_status) {
    const label = { pending: 'Verification pending', rejected: 'Verification rejected', appealed: 'Appeal under review', needs_info: 'Verification needs a new ID photo' }[profile.account_status] || profile.account_status;
    badges.push(`<span class="px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant font-label-sm text-label-sm font-semibold">${escapeHtml(label)}</span>`);
    // An admin asked for a better photo, or rejected it: let the person send a new one from here
    if (profile.account_status === 'needs_info' || profile.account_status === 'rejected') {
      badges.push(`<button type="button" onclick="uploadNewIdCard()" class="px-2.5 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-label-sm font-bold">Upload a new ID photo</button>`);
    }
  }
  el('profileBadges').innerHTML = badges.join('');
  addLeagueBadge(viewedUserId);

  // Academics and skills
  el('profileCollege').textContent = profile.college_name || 'Not listed';
  el('profileDept').textContent = profile.department || 'Not listed';
  el('profileDiv').textContent = profile.division || '—';
  el('profileCity').textContent = profile.city || 'Not listed';
  el('profileSkills').innerHTML = pillsHtml(splitList(profile.skills), 'No skills listed yet.');

  renderActions();
  renderProjects();
  renderGithub();
}

function actionButton(id, icon, label, handler, primary, extra) {
  const style = primary
    ? 'bg-primary hover:bg-primary-container text-on-primary shadow-sm'
    : 'bg-surface-container-high hover:bg-surface-variant text-primary font-bold';
  return `<button id="${id}" type="button" onclick="${handler}" ${extra || ''} class="w-full py-2 px-space-md ${style} font-label-md text-label-md rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60">
      <span class="material-symbols-outlined text-[18px]">${icon}</span><span>${label}</span>
    </button>`;
}

function renderActions() {
  const container = el('actionBtnsContainer');
  if (showsOwnerControls()) {
    container.innerHTML =
      actionButton('editProfileBtn', 'edit_note', 'Edit Profile', 'openEditModal()', false) +
      actionButton('logoutBtn', 'logout', 'Log Out', 'window.logout()', true);
    return;
  }
  // What a visitor gets. In the owner's preview the buttons are shown but do nothing.
  const inert = previewingPublic ? 'disabled' : '';
  container.innerHTML =
    actionButton('openMessageBtn', 'chat', 'Message', `window.location.href='inbox.html?user=${viewedUserId}'`, true, inert) +
    actionButton('followBtn', profile.is_following ? 'person_remove' : 'person_add', profile.is_following ? 'Following' : 'Follow', 'toggleFollow()', false, inert) +
    actionButton('saveProfileBtn', profile.is_saved ? 'bookmark_added' : 'bookmark_add', profile.is_saved ? 'Saved' : 'Save Profile', 'toggleSave()', false, inert) +
    (previewingPublic ? '' : `<button type="button" id="reportProfileBtn" data-report-kind="user" data-report-id="${viewedUserId}" data-report-name="${escapeHtml(profile.name || '')}"
      class="w-full py-1.5 font-label-sm text-label-sm text-on-surface-variant hover:text-error flex items-center justify-center gap-1 rounded-lg">
      <span class="material-symbols-outlined text-[16px]">flag</span><span>Report profile</span></button>`);
}

// ==========================================
// 3. FOLLOW, SAVE, FOLLOWER LISTS
// ==========================================
async function toggleFollow() {
  const button = el('followBtn');
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/follow/${viewedUserId}`, { method: 'POST' });
    const nowFollowing = result.status === 'followed';
    if (nowFollowing !== profile.is_following) profile.followers_count = Math.max(0, (profile.followers_count || 0) + (nowFollowing ? 1 : -1));
    profile.is_following = nowFollowing;
    profileChanged();
    el('followersCount').textContent = profile.followers_count;
    showToast(nowFollowing ? `You are now following ${profile.name}.` : `You unfollowed ${profile.name}.`);
  } catch (err) {
    showToast(err.message);
  }
  renderActions();
}

async function toggleSave() {
  const button = el('saveProfileBtn');
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/save/${viewedUserId}`, { method: 'POST' });
    profile.is_saved = result.status === 'saved';
    profileChanged();
    showToast(profile.is_saved ? 'Saved. Find it under Saved Profiles.' : 'Removed from Saved Profiles.');
  } catch (err) {
    showToast(err.message);
  }
  renderActions();
}

let connectionsKind = 'followers';
let connectionsPeople = [];

async function openConnections(kind) {
  connectionsKind = kind;
  el('connectionsTitle').textContent = kind === 'followers' ? 'Followers' : 'Following';
  el('connectionsList').innerHTML = '<p class="text-center text-on-surface-variant py-6" style="margin:0;">Loading...</p>';
  el('connectionsModal').classList.add('active');
  try {
    connectionsPeople = await api(`/api/users/${viewedUserId}/${kind}`);
    renderConnections();
  } catch (err) {
    el('connectionsList').innerHTML = `<p class="text-center py-6" style="margin:0; color:#ba1a1a;">${escapeHtml(err.message)}</p>`;
  }
}

function renderConnections() {
  const list = el('connectionsList');
  if (connectionsPeople.length === 0) {
    const who = isOwnProfile ? 'You' : (profile ? profile.name : 'They');
    const text = connectionsKind === 'followers'
      ? `${isOwnProfile ? 'Nobody follows you yet.' : 'Nobody follows ' + who + ' yet.'}`
      : `${isOwnProfile ? 'You are not following anyone yet.' : who + ' is not following anyone yet.'}`;
    list.innerHTML = `<p class="text-center text-on-surface-variant py-6" style="margin:0;">${escapeHtml(text)}</p>`;
    return;
  }
  list.innerHTML = connectionsPeople.map(person => {
    const picture = person.profile_pic
      ? `<img src="${escapeHtml(person.profile_pic)}" alt="" class="w-full h-full object-cover">`
      : `<span class="text-sm font-bold">${escapeHtml(getInitials(person.name || '?'))}</span>`;
    const followButton = person.id === currentUserId ? '' :
      `<button type="button" onclick="toggleFollowInList(${person.id})" class="px-3 py-1 rounded-lg font-label-sm text-label-sm font-semibold shrink-0 ${person.is_following ? 'bg-surface-container text-on-surface-variant' : 'bg-primary text-on-primary'}">${person.is_following ? 'Following' : 'Follow'}</button>`;
    return `
      <div class="flex items-center gap-3 p-2 rounded-xl hover:bg-surface-container-low" data-person-id="${person.id}">
        <a href="profile.html?id=${person.id}" class="w-10 h-10 rounded-full overflow-hidden bg-primary text-on-primary flex items-center justify-center shrink-0">${picture}</a>
        <a href="profile.html?id=${person.id}" class="flex-1 min-w-0">
          <span class="block font-label-md text-label-md font-semibold text-on-surface truncate">${escapeHtml(person.name)}${person.id === currentUserId ? ' (You)' : ''}</span>
          <span class="block font-body-sm text-body-sm text-on-surface-variant truncate">${escapeHtml([person.college_name, person.department].filter(Boolean).join(' • '))}</span>
        </a>
        ${followButton}
      </div>`;
  }).join('');
}

async function toggleFollowInList(personId) {
  const person = connectionsPeople.find(p => p.id === personId);
  if (!person) return;
  try {
    const result = await api(`/api/follow/${personId}`, { method: 'POST' });
    person.is_following = result.status === 'followed';
    // On our own profile, the "Following" number is ours
    if (isOwnProfile && profile) {
      profile.following_count = Math.max(0, (profile.following_count || 0) + (person.is_following ? 1 : -1));
      el('followingCount').textContent = profile.following_count;
      profileChanged();
    }
    renderConnections();
  } catch (err) {
    showToast(err.message);
  }
}

// ==========================================
// 4. HEADER BAR: SHARE, PUBLIC VIEW, RESUME
// ==========================================
async function shareProfile() {
  const link = `${window.location.origin}${window.location.pathname}?id=${viewedUserId}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast('Profile link copied.');
  } catch (err) {
    // Clipboard access can be blocked: show the link so it can be copied by hand
    window.showSystemModal('Share Profile', `Copy this link:\n${escapeHtml(link)}`, 'alert');
  }
}

function togglePublicView() {
  if (!isOwnProfile) return;
  previewingPublic = !previewingPublic;
  document.body.classList.toggle('is-own', !previewingPublic);
  el('previewBanner').classList.toggle('hidden', !previewingPublic);
  renderProfile();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildResumeSheet() {
  const skills = splitList(profile.skills);
  const facts = [profile.college_name, profile.department, profile.division ? `Division ${profile.division}` : '', profile.city].filter(Boolean);
  const link = `${window.location.origin}${window.location.pathname}?id=${viewedUserId}`;
  const github = profile.github_username ? `<p>GitHub: github.com/${escapeHtml(profile.github_username)}</p>` : '';
  const projects = (profile.projects || []).map(p => `
    <div class="project">
      <h3>${escapeHtml(p.title)}</h3>
      ${p.tech_stack ? `<p class="muted">${escapeHtml(p.tech_stack)}</p>` : ''}
      ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
      ${[p.github_link, p.live_link].filter(Boolean).map(l => `<p class="muted">${escapeHtml(l)}</p>`).join('')}
    </div>`).join('');

  el('resumeSheet').innerHTML = `
    <h1>${escapeHtml(profile.name || '')}</h1>
    <p class="muted">${escapeHtml(facts.join(' · '))}</p>
    <p class="muted">${escapeHtml(link)}</p>
    ${github}
    ${profile.bio ? `<h2>About</h2><p>${escapeHtml(profile.bio)}</p>` : ''}
    <h2>Education</h2>
    <p><strong>${escapeHtml(profile.college_name || 'Not listed')}</strong></p>
    <p>${escapeHtml([profile.department, profile.roll_no ? 'Roll no. ' + profile.roll_no : ''].filter(Boolean).join(' · '))}</p>
    ${skills.length ? `<h2>Skills</h2><p>${escapeHtml(skills.join(', '))}</p>` : ''}
    ${projects ? `<h2>Projects</h2>${projects}` : ''}`;
}

function exportResume() {
  if (!profile) return;
  buildResumeSheet();
  // The browser's print dialog offers "Save as PDF"
  window.print();
}

// ==========================================
// 5. EDITING THE PROFILE
// ==========================================
function closeProfileModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => { if (m.id !== 'systemModal') m.classList.remove('active'); });
  destroyCropper();
}

function showFormError(id, message) {
  const node = el(id);
  node.textContent = message || '';
  node.classList.toggle('hidden', !message);
}

function renderSkillPreview() {
  el('editSkillsPreview').innerHTML = splitList(el('editSkills').value)
    .map(s => `<span class="px-2 py-0.5 rounded bg-surface-container text-on-surface font-skill-pill text-skill-pill">${escapeHtml(s)}</span>`).join('');
}

function updateBioCount() {
  el('editBioCount').textContent = `${el('editBio').value.length} / 500`;
}

function renderEditPreviews() {
  el('editAvatarPreview').innerHTML = profile.profile_pic
    ? `<img src="${escapeHtml(profile.profile_pic)}" alt="" class="w-full h-full object-cover">`
    : escapeHtml(getInitials(profile.name || '?'));
  el('editBannerPreview').innerHTML = profile.banner_pic
    ? `<img src="${escapeHtml(profile.banner_pic)}" alt="" class="w-full h-full object-cover">`
    : '';
}

let profileOptionsLoaded = false;
async function loadProfileOptions() {
  if (profileOptionsLoaded) return;
  profileOptionsLoaded = true;
  try {
    const options = await api('/api/profile-options');
    el('collegeOptions').innerHTML = options.colleges.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
    el('departmentOptions').innerHTML = options.departments.map(d => `<option value="${escapeHtml(d)}"></option>`).join('');
  } catch (err) {
    profileOptionsLoaded = false;   // suggestions are a convenience; try again next time
  }
}

function openEditModal(focusId) {
  if (!isOwnProfile || !profile) return;
  el('editName').value = profile.name || '';
  el('editCollege').value = profile.college_name || '';
  el('editCity').value = profile.city || '';
  el('editDept').value = profile.department || '';
  el('editDiv').value = profile.division || '';
  el('editSkills').value = profile.skills || '';
  el('editBio').value = profile.bio || '';
  el('editProfession').value = profile.profession || '';
  el('editExperience').value = profile.experience_years > 0 ? profile.experience_years : '';
  // The choices come from professions.js, the same list sign-up uses
  if (!el('professionOptions').children.length) {
    el('professionOptions').innerHTML = PROFESSIONS.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.group)}</option>`).join('');
  }
  const openNow = new Set(String(profile.open_to || '').split(','));
  el('editRecruiterOk').checked = Number(profile.recruiter_contact_ok) === 1;
  el('editOpenTo').innerHTML = OPEN_TO_OPTIONS.map(([key, label]) =>
    `<label class="inline-flex items-center gap-1.5 font-body-md text-body-md text-on-surface cursor-pointer"><input type="checkbox" value="${key}" ${openNow.has(key) ? 'checked' : ''} class="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary"/>${label}</label>`).join('');
  showFormError('editError', '');
  renderSkillPreview();
  updateBioCount();
  renderEditPreviews();
  loadProfileOptions();
  el('editModal').classList.add('active');
  setTimeout(() => el(focusId || 'editName').focus(), 50);
}

async function saveProfile(e) {
  e.preventDefault();
  const button = el('editSaveBtn');
  // A profession has to be one from the list; an empty field leaves it unset
  const typedProfession = el('editProfession').value.trim();
  const profession = findProfession(typedProfession);
  if (typedProfession && !profession) {
    showFormError('editError', 'Pick a profession from the list. Choose Other if yours is not there.');
    el('editProfession').focus();
    return;
  }
  const years = el('editExperience').value.trim();
  if (years && !(/^\d+$/.test(years) && Number(years) <= 70)) {
    showFormError('editError', 'Years of experience must be a whole number from 0 to 70.');
    el('editExperience').focus();
    return;
  }
  button.disabled = true;
  button.textContent = 'Saving...';
  showFormError('editError', '');
  try {
    const result = await api(`/api/profiles/${currentUserId}`, {
      method: 'PUT',
      body: {
        name: el('editName').value,
        college_name: el('editCollege').value,
        city: el('editCity').value,
        department: el('editDept').value,
        division: el('editDiv').value,
        skills: el('editSkills').value,
        bio: el('editBio').value,
        profession: profession ? profession.name : '',
        experience_years: years ? Number(years) : 0,
        open_to: [...el('editOpenTo').querySelectorAll('input:checked')].map(box => box.value).join(','),
        recruiter_contact_ok: el('editRecruiterOk').checked
      }
    });
    Object.assign(profile, result.profile);
    profileChanged();
    renderProfile();
    el('editModal').classList.remove('active');
    showToast('Profile updated.');
  } catch (err) {
    showFormError('editError', err.message);
  }
  button.disabled = false;
  button.textContent = 'Save Changes';
}

// ===== PICTURES =====
function loadCropper() {
  if (window.Cropper) return Promise.resolve();
  if (!cropperLoading) {
    cropperLoading = new Promise((resolve, reject) => {
      const base = `https://cdnjs.cloudflare.com/ajax/libs/cropperjs/${CROPPER_VERSION}`;
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${base}/cropper.min.css`;
      document.head.appendChild(css);
      const script = document.createElement('script');
      script.src = `${base}/cropper.min.js`;
      script.onload = resolve;
      script.onerror = () => { cropperLoading = null; reject(new Error('The picture editor could not be loaded. Check your connection.')); };
      document.head.appendChild(script);
    });
  }
  return cropperLoading;
}

function choosePicture(kind) {
  if (!isOwnProfile) return;
  cropKind = kind;
  el('pictureFileInput').click();
}

function onPictureChosen(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) return showToast('Please choose an image file.');
  if (file.size > 15 * 1024 * 1024) return showToast('That image is too large to edit. Please choose one under 15 MB.');

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      await loadCropper();
    } catch (err) {
      return showToast(err.message);
    }
    const target = el('cropImageTarget');
    destroyCropper();
    el('cropModalTitle').textContent = cropKind === 'profile' ? 'Crop Profile Picture' : 'Crop Banner';
    el('cropModal').classList.add('active');
    target.onload = () => {
      destroyCropper();
      cropper = new Cropper(target, {
        aspectRatio: cropKind === 'profile' ? 1 : 16 / 5,
        viewMode: 1,
        autoCropArea: 1,
        background: false
      });
    };
    target.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function destroyCropper() {
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
}

function cancelCrop() {
  el('cropModal').classList.remove('active');
  destroyCropper();
}

async function uploadPicture(path, blob, filename) {
  const form = new FormData();
  form.append('file', blob, filename);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form, credentials: 'include' });
  } catch (err) {
    throw new Error('Could not reach the server.');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (res.status === 401) { handleLoggedOut(); throw new Error('Please log in again.'); }
  if (!res.ok) throw new Error(data && typeof data.detail === 'string' ? data.detail : 'Upload failed. Please try again.');
  return data.url;
}

async function applyCrop() {
  if (!cropper) return;
  const kind = cropKind;
  const button = el('applyCropBtn');
  button.disabled = true;
  button.textContent = 'Saving...';
  try {
    // Keep uploads small: these sizes are plenty for how the pictures are shown
    const canvas = cropper.getCroppedCanvas(kind === 'profile' ? { width: 512, height: 512 } : { width: 1600, height: 500 });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('That image could not be processed.');
    const url = await uploadPicture(kind === 'profile' ? '/api/upload/profile-pic' : '/api/upload/banner-pic', blob, `${kind}.jpg`);
    profile[kind === 'profile' ? 'profile_pic' : 'banner_pic'] = url;
    profileChanged();
    renderProfile();
    if (el('editModal').classList.contains('active')) renderEditPreviews();
    cancelCrop();
    showToast(kind === 'profile' ? 'Profile picture updated.' : 'Banner updated.');
  } catch (err) {
    showToast(err.message);
  }
  button.disabled = false;
  button.textContent = 'Save Picture';
}

// ==========================================
// 6. PROJECTS
// ==========================================
function renderProjects() {
  const list = el('projectList');
  const projects = profile.projects || [];
  if (projects.length === 0) {
    list.innerHTML = `
      <div class="col-span-full py-8 text-center text-on-surface-variant">
        <span class="material-symbols-outlined text-[32px] text-outline">folder_open</span>
        <p class="mt-1">${showsOwnerControls() ? 'No projects yet. Add one to show what you have built.' : 'No projects yet.'}</p>
      </div>`;
    return;
  }

  list.innerHTML = projects.map(p => {
    const links = [
      p.github_link ? `<a href="${escapeHtml(safeUrl(p.github_link))}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-primary font-label-md text-label-md font-semibold hover:underline"><span class="material-symbols-outlined text-[16px]">code</span>Code</a>` : '',
      p.live_link ? `<a href="${escapeHtml(safeUrl(p.live_link))}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-primary font-label-md text-label-md font-semibold hover:underline"><span class="material-symbols-outlined text-[16px]">open_in_new</span>Live</a>` : ''
    ].join('');
    const ownerButtons = showsOwnerControls() ? `
        <span class="ml-auto flex items-center gap-1">
          <button type="button" onclick="openProjectModal(${p.id})" class="p-1 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-low" title="Edit project"><span class="material-symbols-outlined text-[18px]">edit</span></button>
          <button type="button" onclick="deleteProject(${p.id})" class="p-1 rounded text-on-surface-variant hover:text-error hover:bg-surface-container-low" title="Delete project"><span class="material-symbols-outlined text-[18px]">delete</span></button>
        </span>` : '';
    return `
      <article class="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest flex flex-col" data-project-id="${p.id}">
        ${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="" loading="lazy" class="w-full h-36 object-cover bg-surface-container-low" onerror="this.remove()">` : ''}
        <div class="p-space-md flex flex-col gap-2 flex-1">
          <h3 class="font-headline-sm text-headline-sm font-bold text-on-surface break-words">${escapeHtml(p.title)}</h3>
          ${p.description ? `<p class="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-line break-words line-clamp-3">${escapeHtml(p.description)}</p>` : ''}
          <div class="flex flex-wrap gap-1.5">${splitList(p.tech_stack).map(t => `<span class="px-2 py-0.5 rounded bg-surface-container text-on-surface font-skill-pill text-skill-pill">${escapeHtml(t)}</span>`).join('')}</div>
          <div class="flex items-center gap-3 mt-auto pt-2">${links}${ownerButtons}</div>
        </div>
      </article>`;
  }).join('');
}

function setProjectImage(url) {
  projectImageUrl = url || '';
  el('projectImagePreview').innerHTML = projectImageUrl
    ? `<img src="${escapeHtml(projectImageUrl)}" alt="" class="w-full h-full object-cover">`
    : '<span class="material-symbols-outlined">image</span>';
  el('projectImageRemove').classList.toggle('hidden', !projectImageUrl);
}

function openProjectModal(projectId) {
  if (!isOwnProfile) return;
  const existing = projectId ? (profile.projects || []).find(p => p.id === projectId) : null;
  editingProjectId = existing ? existing.id : null;
  el('projectModalTitle').textContent = existing ? 'Edit Project' : 'Add Project';
  el('projectTitle').value = existing ? existing.title : '';
  el('projectDescription').value = existing ? existing.description : '';
  el('projectTech').value = existing ? existing.tech_stack : '';
  el('projectGithub').value = existing ? existing.github_link : '';
  el('projectLive').value = existing ? existing.live_link : '';
  setProjectImage(existing ? existing.image_url : '');
  showFormError('projectError', '');
  el('projectModal').classList.add('active');
  setTimeout(() => el('projectTitle').focus(), 50);
}

async function uploadProjectImage(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  showFormError('projectError', '');
  el('projectImagePreview').innerHTML = '<span class="material-symbols-outlined animate-spin">progress_activity</span>';
  try {
    setProjectImage(await uploadPicture('/api/upload/project-pic', file, file.name));
  } catch (err) {
    setProjectImage(projectImageUrl);
    showFormError('projectError', err.message);
  }
}

async function saveProject(e) {
  e.preventDefault();
  const button = el('projectSaveBtn');
  button.disabled = true;
  button.textContent = 'Saving...';
  showFormError('projectError', '');
  const body = {
    title: el('projectTitle').value,
    description: el('projectDescription').value,
    tech_stack: el('projectTech').value,
    github_link: el('projectGithub').value,
    live_link: el('projectLive').value,
    image_url: projectImageUrl
  };
  try {
    if (editingProjectId) {
      const saved = await api(`/api/projects/${editingProjectId}`, { method: 'PUT', body });
      profile.projects = profile.projects.map(p => p.id === saved.id ? saved : p);
    } else {
      const saved = await api('/api/projects', { method: 'POST', body });
      profile.projects = [saved].concat(profile.projects || []);
    }
    profileChanged();
    renderProjects();
    el('projectModal').classList.remove('active');
    showToast(editingProjectId ? 'Project updated.' : 'Project added.');
  } catch (err) {
    showFormError('projectError', err.message);
  }
  button.disabled = false;
  button.textContent = 'Save Project';
}

function deleteProject(projectId) {
  const project = (profile.projects || []).find(p => p.id === projectId);
  if (!project) return;
  window.showSystemModal('Delete Project', `Delete ${escapeHtml(project.title)} from your portfolio? This cannot be undone.`, 'confirm', async () => {
    try {
      await api(`/api/projects/${projectId}`, { method: 'DELETE' });
      profile.projects = profile.projects.filter(p => p.id !== projectId);
      profileChanged();
      renderProjects();
      showToast('Project deleted.');
    } catch (err) {
      showToast(err.message);
    }
  }, 'Delete');
}

// ==========================================
// 7. GITHUB
// ==========================================
let githubState = 'idle';   // idle | loading | ready | error
let githubErrorText = '';

function renderGithub() {
  const body = el('githubBody');
  const action = el('githubHeaderAction');
  const username = profile.github_username;

  if (!username) {
    action.innerHTML = '';
    body.innerHTML = showsOwnerControls()
      ? `<div class="py-6 text-center">
           <p class="font-body-md text-body-md text-on-surface-variant mb-3">Connect your GitHub account to show your repositories and contribution chart.</p>
           <button type="button" id="githubConnectBtn" onclick="openGithubModal()" class="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-on-primary font-label-md text-label-md rounded-lg">Connect GitHub</button>
         </div>`
      : `<p class="py-4 font-body-md text-body-md text-on-surface-variant">${escapeHtml(profile.name || 'This person')} has not connected a GitHub account.</p>`;
    return;
  }

  action.innerHTML = `
    <span class="flex items-center gap-2">
      <a href="https://github.com/${encodeURIComponent(username)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md rounded-lg"><span class="w-2 h-2 rounded-full bg-tertiary"></span>@${escapeHtml(username)}</a>
      <button type="button" onclick="disconnectGithub()" class="own-only p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-low" title="Disconnect GitHub"><span class="material-symbols-outlined text-[18px]">link_off</span></button>
    </span>`;

  if (githubState === 'loading' || githubState === 'idle') {
    body.innerHTML = '<p class="py-6 text-center text-on-surface-variant">Loading GitHub activity...</p>';
    return;
  }
  if (githubState === 'error') {
    body.innerHTML = `<div class="py-6 text-center">
        <p class="font-body-md text-body-md text-on-surface-variant mb-3">${escapeHtml(githubErrorText)}</p>
        <button type="button" onclick="loadGithub(true)" class="px-4 py-2 bg-surface-container-low hover:bg-surface-container text-primary font-label-md text-label-md rounded-lg">Try again</button>
      </div>`;
    return;
  }

  const g = githubStats;
  const stat = (value, label) => `<div class="p-space-sm bg-surface-container-low rounded-lg text-center"><span class="font-headline-sm text-headline-sm text-on-surface font-bold block">${value}</span><span class="font-label-sm text-label-sm text-on-surface-variant">${label}</span></div>`;
  const languages = Object.keys(g.languages || {});
  body.innerHTML = `
    <div class="grid grid-cols-3 gap-space-sm mb-space-md">
      ${stat(g.public_repos, 'Repositories')}${stat(g.total_stars, 'Stars')}${stat(g.followers, 'Followers')}
    </div>
    ${languages.length ? `<div class="flex flex-wrap gap-1.5 mb-space-md">${languages.map(l => `<span class="px-2 py-0.5 rounded bg-surface-container text-on-surface font-skill-pill text-skill-pill">${escapeHtml(l)}</span>`).join('')}</div>` : ''}
    <div class="overflow-x-auto mb-space-md"><img src="${escapeHtml(g.heatmap_url)}" alt="GitHub contribution chart for ${escapeHtml(g.username)}" class="max-w-none" style="min-width: 640px; width: 100%;" loading="lazy" onerror="this.parentNode.remove()"></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
      ${(g.top_repos || []).map(r => `
        <a href="${escapeHtml(safeUrl(r.html_url))}" target="_blank" rel="noopener" class="block p-space-sm rounded-lg border border-outline-variant/30 hover:border-primary/50 transition-colors">
          <span class="flex items-center justify-between gap-2">
            <span class="font-label-md text-label-md font-bold text-primary truncate">${escapeHtml(r.name)}</span>
            <span class="flex items-center gap-0.5 font-label-sm text-label-sm text-on-surface-variant shrink-0"><span class="material-symbols-outlined text-[14px]">star</span>${r.stargazers_count}</span>
          </span>
          <span class="block font-body-sm text-body-sm text-on-surface-variant line-clamp-3 mt-0.5">${escapeHtml(r.description)}</span>
          <span class="block font-label-sm text-label-sm text-on-surface-variant mt-1">${escapeHtml(r.language)}</span>
        </a>`).join('') || '<p class="text-on-surface-variant">No public repositories yet.</p>'}
    </div>`;
}

// Loaded after the rest of the page so a slow GitHub never holds the profile up
async function loadGithub(force) {
  const username = profile && profile.github_username;
  if (!username) {
    githubState = 'idle';
    githubStats = null;
    return renderGithub();
  }
  if (!force && githubState === 'ready' && githubStats && githubStats.username.toLowerCase() === username.toLowerCase()) return renderGithub();

  githubState = 'loading';
  renderGithub();
  try {
    githubStats = await api(`/api/github/${encodeURIComponent(username)}`);
    githubState = 'ready';
  } catch (err) {
    githubState = 'error';
    githubErrorText = err.message;
  }
  if (profile.github_username === username) renderGithub();
}

function openGithubModal() {
  el('githubUsernameInput').value = '';
  showFormError('githubError', '');
  el('githubModal').classList.add('active');
  setTimeout(() => el('githubUsernameInput').focus(), 50);
}

async function connectGithub(e) {
  e.preventDefault();
  const username = el('githubUsernameInput').value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  const button = el('githubSaveBtn');
  button.disabled = true;
  button.textContent = 'Checking...';
  showFormError('githubError', '');
  try {
    // Make sure the account exists before saving it to the profile
    const stats = await api(`/api/github/${encodeURIComponent(username)}`);
    const saved = await api(`/api/user/github?github_username=${encodeURIComponent(stats.username || username)}`, { method: 'PUT' });
    profile.github_username = saved.github_username;
    githubStats = stats;
    githubState = 'ready';
    profileChanged();
    renderGithub();
    el('githubModal').classList.remove('active');
    showToast('GitHub connected.');
  } catch (err) {
    showFormError('githubError', err.message);
  }
  button.disabled = false;
  button.textContent = 'Connect';
}

function disconnectGithub() {
  window.showSystemModal('Disconnect GitHub', 'Remove GitHub from your profile? You can connect it again at any time.', 'confirm', async () => {
    try {
      await api('/api/user/github?github_username=', { method: 'PUT' });
      profile.github_username = '';
      githubStats = null;
      githubState = 'idle';
      profileChanged();
      renderGithub();
      showToast('GitHub disconnected.');
    } catch (err) {
      showToast(err.message);
    }
  }, 'Disconnect');
}

// ===== INIT =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProfile);
} else {
  initProfile();
}

// A new ID photo for verification, shrunk in the browser like at sign-up (JPEG, at most 1000 px)
function uploadNewIdCard() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const image = new Image();
    image.onload = async () => {
      const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      try {
        const result = await api('/api/me/id-card', { method: 'POST', body: { image: canvas.toDataURL('image/jpeg', 0.85) } });
        profile.account_status = result.account_status;
        profileChanged();
        renderProfile();
        showToast('New ID photo sent. Your verification is back in the queue.');
      } catch (err) {
        showToast(err.message);
      }
    };
    image.onerror = () => showToast('That file is not a picture we can read.');
    image.src = URL.createObjectURL(file);
  };
  input.click();
}

// Weekly league finishes (top three of their college), added once the profile is drawn
async function addLeagueBadge(userId) {
  if (!userId) return;
  try {
    const league = await api(`/api/league/badges/${userId}`);
    const box = el('profileBadges');
    if (!league.count || !box || box.querySelector('[data-league]')) return;
    const title = league.best === 1 ? 'Won the weekly league of their college' : 'Finished in the top three of the weekly league at their college';
    box.insertAdjacentHTML('beforeend', `<a data-league href="progress.html" title="${title}" class="px-2 py-0.5 rounded-full bg-primary text-on-primary font-label-sm text-label-sm font-bold" style="text-decoration:none">🏆 ${league.count === 1 ? (league.best === 1 ? 'Weekly league winner' : 'Weekly league top 3') : `${league.count}× weekly top 3`}</a>`);
  } catch (e) { /* the badge is a nice extra */ }
}
