// ==========================================
// REGISTER.JS — The sign-up page (register.html): four steps, the live profile preview,
// college and department suggestions, the ID photo, skills, and creating the account
// Loaded after auth.js, which provides postJson, setFieldError, showNotice and setBusy,
// and after professions.js, which holds the list of professions and their typical skills.
// ==========================================
(function () {
  const byId = (id) => document.getElementById(id);

  // ==========================================
  // 1. LISTS AND WORDING
  // ==========================================
  // Engineering and diploma colleges in Maharashtra, suggested while a student types
  const COLLEGES = [
    "Amrutvahini College of Engineering, Sangamner",
    "Amrutvahini Polytechnic, Sangamner",
    "Indian Institute of Technology (IIT), Bombay",
    "Veermata Jijabai Technological Institute (VJTI), Mumbai",
    "College of Engineering Pune (COEP)",
    "Pune Institute of Computer Technology (PICT), Pune",
    "Sardar Patel Institute of Technology (SPIT), Mumbai",
    "Vishwakarma Institute of Technology (VIT), Pune",
    "MIT World Peace University (MIT-WPU), Pune",
    "K. J. Somaiya College of Engineering, Mumbai",
    "Dwarkadas J. Sanghvi College of Engineering (DJSCE), Mumbai",
    "Thadomal Shahani Engineering College (TSEC), Mumbai",
    "Pimpri Chinchwad College of Engineering (PCCOE), Pune",
    "Cummins College of Engineering for Women, Pune",
    "Walchand College of Engineering, Sangli",
    "Shri Ramdeobaba College of Engineering and Management (RCOEM), Nagpur",
    "Visvesvaraya National Institute of Technology (VNIT), Nagpur",
    "Sanjivani College of Engineering, Kopargaon",
    "K. K. Wagh Institute of Engineering Education & Research, Nashik",
    "Government College of Engineering, Amravati",
    "Government College of Engineering, Aurangabad",
    "Government College of Engineering, Karad",
    "Government College of Engineering, Jalgaon",
    "Government College of Engineering, Nagpur",
    "Government Polytechnic, Pune",
    "Government Polytechnic, Mumbai",
    "Government Polytechnic, Nashik",
    "Government Polytechnic, Nagpur",
    "Government Polytechnic, Amravati",
    "Government Polytechnic, Aurangabad",
    "Government Polytechnic, Kolhapur",
    "Government Polytechnic, Ahmednagar",
    "Fr. Conceicao Rodrigues College of Engineering, Mumbai",
    "Ramrao Adik Institute of Technology (RAIT), Navi Mumbai",
    "Vidyalankar Institute of Technology (VIT), Mumbai",
    "Don Bosco Institute of Technology, Mumbai",
    "Vivekanand Education Society's Institute of Technology (VESIT), Mumbai",
    "Rajiv Gandhi Institute of Technology, Mumbai",
    "Atharva College of Engineering, Mumbai",
    "Terna Engineering College, Navi Mumbai",
    "Datta Meghe College of Engineering, Navi Mumbai",
    "Army Institute of Technology (AIT), Pune",
    "Bhartiya Vidyapeeth College of Engineering, Pune",
    "Sinhgad College of Engineering, Pune",
    "D. Y. Patil College of Engineering, Akurdi, Pune",
    "Rajarshi Shahu College of Engineering (RSCOE), Pune",
    "AISSMS College of Engineering, Pune",
    "Vishwakarma Institute of Information Technology (VIIT), Pune",
    "JSPM's Rajarshi Shahu College of Engineering, Pune",
    "Shri Guru Gobind Singhji Institute of Engineering and Technology (SGGSIE&T), Nanded",
    "DKTE Society's Textile and Engineering Institute, Ichalkaranji",
    "K. I. T.'s College of Engineering, Kolhapur",
    "Yeshwantrao Chavan College of Engineering (YCCE), Nagpur",
    "G. H. Raisoni College of Engineering, Nagpur",
    "Shri Sant Gajanan Maharaj College of Engineering (SSGMCE), Shegaon",
    "MET's Institute of Engineering, Nashik",
    "Sandip Foundation's Sandip Institute of Technology and Research Centre, Nashik",
    "NDMVP Samaj's Karmaveer Adv. Baburao Ganpatrao Thakare College of Engineering, Nashik",
    "Matoshri College of Engineering and Research Centre, Nashik",
    "Pravara Rural Engineering College, Loni",
    "SRES's Sanjivani K.B.P. Polytechnic, Kopargaon",
    "K.K. Wagh Polytechnic, Nashik",
    "Cusrow Wadia Institute of Technology, Pune",
    "VPM's Polytechnic, Thane",
    "K.J. Somaiya Polytechnic, Mumbai",
    "L&T Institute of Technology, Mumbai",
    "M.H. Saboo Siddik Polytechnic, Mumbai",
    "P.R. Pote Patil College of Engineering & Management, Amravati",
    "Prof. Ram Meghe Institute of Technology & Research, Amravati",
    "Sipna College of Engineering and Technology, Amravati",
    "Deogiri Institute of Engineering and Management Studies, Aurangabad",
    "CSMSS Chhatrapati Shahu College of Engineering, Aurangabad",
    "MGM's Jawaharlal Nehru Engineering College, Aurangabad"
  ];

  // Engineering and diploma departments
  const DEPARTMENTS = [
    "Computer Engineering",
    "Information Technology",
    "Artificial Intelligence & Data Science",
    "Artificial Intelligence & Machine Learning",
    "Electronics & Telecommunication Engineering (ENTC)",
    "Electronics Engineering",
    "Mechanical Engineering",
    "Civil Engineering",
    "Electrical Engineering",
    "Chemical Engineering",
    "Instrumentation & Control Engineering",
    "Robotics & Automation",
    "Mechatronics Engineering",
    "Cyber Security",
    "Internet of Things (IoT)",
    "Automobile Engineering",
    "Production Engineering",
    "Aeronautical Engineering",
    "Aerospace Engineering",
    "Biomedical Engineering",
    "Biotechnology",
    "Metallurgical Engineering",
    "Textile Engineering",
    "Mining Engineering",
    "Agricultural Engineering",
    "Polymer Engineering",
    "Petrochemical Engineering",
    "Plastics Engineering"
  ];

  const SKILL_IDEAS = ['Python', 'JavaScript', 'React', 'Node.js', 'Java', 'C++', 'SQL', 'Machine learning', 'Figma', 'UI/UX', 'Flutter', 'IoT'];
  const MAX_SKILLS = 15;
  const SKILL_IDEA_COUNT = 12;
  const MAX_EXPERIENCE_YEARS = 70;
  const PROFESSION_RESULTS = 8;
  const MIN_PASSWORD = 8;
  const ID_PHOTO_SIDE = 1000;       // the ID photo is shrunk to fit this many pixels, so sign-up stays a small request
  const ID_PHOTO_QUALITY = 0.72;
  const ID_PHOTO_MAX_BYTES = 15 * 1024 * 1024;
  const STRENGTH_WORDS = ['', 'Weak', 'Fair', 'Good', 'Strong'];

  // Words that differ between a student and a professional. data-text and data-ph in the page point at these.
  const TYPE_TEXT = {
    student: {
      emailPh: 'name@college.edu.in',
      rollLabel: 'Roll or enrollment number', rollPh: 'Your roll number',
      backgroundTitle: 'Where you study', backgroundLead: 'People search and filter by these.',
      collegeLabel: 'College or institution', collegePh: 'Start typing your college name',
      deptLabel: 'Department', deptPh: 'e.g. Computer Engineering',
      verifyLead: 'Give at least one of the two. A campus ambassador from your college or an admin checks it.',
      previewPlace: 'Your college', previewField: 'Department'
    },
    professional: {
      emailPh: 'you@example.com',
      rollLabel: 'Username or professional ID', rollPh: 'e.g. your handle',
      backgroundTitle: 'Where you work', backgroundLead: 'People search and filter by these.',
      collegeLabel: 'Company or organisation', collegePh: 'e.g. TCS, a studio, Freelance',
      deptLabel: 'Industry or field', deptPh: 'e.g. Video production, Data science',
      verifyLead: 'Give at least one of the two.',
      previewPlace: 'Your company', previewField: 'Field'
    }
  };

  const form = byId('registerForm');
  const notice = byId('registerNotice');
  const steps = [...form.querySelectorAll('.step')];
  const stepItems = [...byId('stepper').children];
  const nextBtn = byId('nextBtn');
  const backBtn = byId('backBtn');
  const input = {
    name: byId('fullName'), email: byId('emailAddress'), roll: byId('rollNumber'), password: byId('password'),
    profession: byId('professionInput'), experience: byId('experienceYears'),
    college: byId('collegeInput'), dept: byId('deptInput'), city: byId('location'),
    barcode: byId('idBarcode'), idFile: byId('idImageUpload'), portfolio: byId('portfolioLink'), invite: byId('inviteCode'),
    skill: byId('skillInput'), bio: byId('bio'), consent: byId('consentBox')
  };

  let step = 0;
  let reached = 0;        // the furthest step opened so far; the stepper lets you jump back to any of them
  let skills = [];
  let idPhoto = '';       // the shrunk ID photo as a data: address, or '' when there is none
  let openTo = [];        // what the person welcomes, as the keys of OPEN_TO_OPTIONS

  const accountType = () => form.elements.accountType.value;
  const isStudent = () => accountType() === 'student';
  // The server verifies an account at once when its email ends like this
  const isCollegeEmail = (email) => /\.(edu|ac)\.in$/i.test(email.trim());
  // The profession a professional has picked, exactly as the list spells it. '' until one is picked.
  const chosenProfession = () => (findProfession(input.profession.value) || { name: '' }).name;

  // ==========================================
  // 2. THE LIVE PREVIEW (picture side)
  // ==========================================
  function setPreviewText(el, text, placeholder) {
    el.textContent = text || placeholder;
    el.classList.toggle('ghost', !text);
  }

  function syncPreview() {
    const words = TYPE_TEXT[accountType()];
    const name = input.name.value.trim();
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
    byId('pvAvatar').textContent = initials || '?';
    setPreviewText(byId('pvName'), name, 'Your name');

    const dept = input.dept.value.trim(), city = input.city.value.trim();
    const profession = isStudent() ? '' : chosenProfession();
    setPreviewText(byId('pvMeta'), [profession, dept, city].filter(Boolean).join(' · '), `${isStudent() ? '' : 'Profession · '}${words.previewField} · City`);
    const place = byId('pvCollege');
    place.classList.toggle('ghost', !input.college.value.trim());
    place.lastElementChild.textContent = input.college.value.trim() || words.previewPlace;
    place.querySelector('use').setAttribute('href', isStudent() ? '#i-cap' : '#i-building');

    const verified = isCollegeEmail(input.email.value) || (!isStudent() && Boolean(input.invite.value.trim()));
    const status = byId('pvStatus');
    status.classList.toggle('verified', verified);
    status.querySelector('use').setAttribute('href', verified ? '#i-check' : '#i-clock');
    status.lastElementChild.textContent = verified ? 'Verified on sign-up' : 'Checked after sign-up';

    const chips = byId('pvSkills');
    const shown = skills.slice(0, 6);
    const label = (skill, n) => (n === 5 && skills.length > 6 ? `+${skills.length - 5} more` : skill);
    const wanted = skills.length ? shown.map(label) : ['Skill', 'Skill', 'Skill'];
    chips.classList.toggle('ghost', !skills.length);
    // Only redraw when the list changed, so chips do not replay their entrance on every keystroke
    if (wanted.join('\n') !== [...chips.children].map(chip => chip.textContent).join('\n')) {
      chips.replaceChildren(...wanted.map(text => Object.assign(document.createElement('span'), { textContent: text })));
    }

    setPreviewText(byId('pvBio'), input.bio.value.trim(), 'A few lines about what you build and who you are looking for.');
  }

  // ==========================================
  // 3. STUDENT OR PROFESSIONAL
  // ==========================================
  function syncAccountType() {
    const words = TYPE_TEXT[accountType()];
    document.querySelectorAll('[data-text]').forEach(el => { el.textContent = words[el.dataset.text]; });
    document.querySelectorAll('[data-ph]').forEach(el => { el.placeholder = words[el.dataset.ph]; });
    byId('studentVerification').hidden = !isStudent();
    byId('proVerification').hidden = isStudent();
    byId('professionField').hidden = isStudent();
    byId('experienceField').hidden = isStudent();
    [input.barcode, input.portfolio, input.profession, input.experience].forEach(field => setFieldError(field, ''));
    renderSkillIdeas();
    syncEmailHint();
    syncPreview();
  }

  function syncEmailHint() {
    const hint = byId('emailHint');
    const college = isCollegeEmail(input.email.value);
    hint.hidden = !college && !isStudent();
    hint.classList.toggle('good', college);
    hint.textContent = college
      ? 'College email: this account will be verified on sign-up.'
      : 'A college address ending in .edu.in or .ac.in is verified automatically.';
  }

  // ==========================================
  // 4. PASSWORD STRENGTH
  // ==========================================
  function passwordScore(password) {
    if (password.length < MIN_PASSWORD) return 0;
    let kinds = 0;
    [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].forEach(kind => { if (kind.test(password)) kinds++; });
    let score = 1;
    if (kinds >= 2) score++;
    if (kinds >= 3 && password.length >= 10) score++;
    if (kinds >= 3 && password.length >= 14) score++;
    return score;
  }

  function syncPassword() {
    const password = input.password.value;
    const score = passwordScore(password);
    byId('passwordMeter').dataset.score = String(score);
    const hint = byId('passwordHint');
    if (!password || score === 0) hint.textContent = `At least ${MIN_PASSWORD} characters.`;
    else hint.textContent = score >= 3 ? `${STRENGTH_WORDS[score]} password.` : `${STRENGTH_WORDS[score]}. Mix in capitals, numbers or symbols to make it stronger.`;
    hint.classList.toggle('good', score >= 3);
  }

  // ==========================================
  // 5. SUGGESTIONS UNDER THE COLLEGE AND DEPARTMENT FIELDS
  // ==========================================
  function bindSuggestions(field, list, items) {
    let active = -1;

    function close() {
      list.hidden = true;
      list.replaceChildren();
      active = -1;
      field.setAttribute('aria-expanded', 'false');
      field.removeAttribute('aria-activedescendant');
    }

    function choose(option) {
      field.value = option.dataset.value;
      close();
      syncPreview();
    }

    function setActive(index) {
      const options = [...list.children];
      if (!options.length) return;
      active = (index + options.length) % options.length;
      options.forEach((option, n) => {
        option.classList.toggle('active', n === active);
        option.setAttribute('aria-selected', String(n === active));
      });
      options[active].scrollIntoView({ block: 'nearest' });
      field.setAttribute('aria-activedescendant', options[active].id);
    }

    field.addEventListener('input', () => {
      const typed = field.value.trim().toLowerCase();
      // The lists are colleges and engineering departments, so they only help students
      const matches = typed && isStudent() ? items.filter(item => item.toLowerCase().includes(typed)).slice(0, 8) : [];
      if (!matches.length) { close(); return; }
      list.replaceChildren(...matches.map((item, n) => {
        const option = document.createElement('li');
        option.id = `${list.id}-${n}`;
        option.setAttribute('role', 'option');
        option.dataset.value = item;
        const at = item.toLowerCase().indexOf(typed);
        const hit = document.createElement('b');
        hit.textContent = item.slice(at, at + typed.length);
        option.append(item.slice(0, at), hit, item.slice(at + typed.length));
        return option;
      }));
      active = -1;
      list.hidden = false;
      field.setAttribute('aria-expanded', 'true');
    });

    field.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter') {
        if (active >= 0) { e.preventDefault(); choose(list.children[active]); }
        else close();
      }
    });
    // mousedown, not click: the choice has to land before the field loses focus and the list closes
    list.addEventListener('mousedown', (e) => {
      const option = e.target.closest('li');
      if (!option) return;
      e.preventDefault();
      choose(option);
    });
    field.addEventListener('blur', close);
  }

  // The profession field: type to search the list in professions.js. Only a name from the list is accepted.
  function bindProfessionPicker() {
    const field = input.profession;
    const list = byId('professionList');
    let active = -1;

    function close() {
      list.hidden = true;
      list.replaceChildren();
      active = -1;
      field.setAttribute('aria-expanded', 'false');
      field.removeAttribute('aria-activedescendant');
    }

    function choose(name) {
      field.value = name;
      close();
      setFieldError(field, '');
      renderSkillIdeas();
      syncPreview();
    }

    function setActive(index) {
      const options = [...list.querySelectorAll('[data-value]')];
      if (!options.length) return;
      active = (index + options.length) % options.length;
      options.forEach((option, n) => {
        option.classList.toggle('active', n === active);
        option.setAttribute('aria-selected', String(n === active));
      });
      options[active].scrollIntoView({ block: 'nearest' });
      field.setAttribute('aria-activedescendant', options[active].id);
    }

    field.addEventListener('input', () => {
      const typed = field.value.trim();
      renderSkillIdeas();
      if (!typed) { close(); return; }
      const matches = searchProfessions(typed, PROFESSION_RESULTS).filter(profession => profession.name !== STUDENT_PROFESSION);
      if (matches.length) {
        list.replaceChildren(...matches.map((profession, n) => {
          const option = document.createElement('li');
          option.id = `professionList-${n}`;
          option.setAttribute('role', 'option');
          option.dataset.value = profession.name;
          const group = document.createElement('small');
          group.textContent = profession.group;
          option.append(group, profession.name);
          return option;
        }));
      } else {
        const none = document.createElement('li');
        none.className = 'none';
        none.textContent = 'Nothing by that name. Try another word, or type "Other".';
        list.replaceChildren(none);
      }
      active = -1;
      list.hidden = false;
      field.setAttribute('aria-expanded', 'true');
    });

    field.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      const options = list.querySelectorAll('[data-value]');
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Enter' && options.length) {
        e.preventDefault();   // Enter picks the highlighted profession, or the first match, instead of sending the step
        choose(options[Math.max(0, active)].dataset.value);
      }
    });
    list.addEventListener('mousedown', (e) => {
      const option = e.target.closest('[data-value]');
      if (!option) return;
      e.preventDefault();
      choose(option.dataset.value);
    });
    // Leaving the field: a name typed in full is tidied to the list's spelling
    field.addEventListener('blur', () => {
      close();
      if (chosenProfession()) field.value = chosenProfession();
    });
  }

  // ==========================================
  // 6. THE ID PHOTO
  // ==========================================

  // Reads the chosen picture and shrinks it. Resolves to a data: address, rejects with a message to show.
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) { reject(new Error('Choose an image file, such as a JPG or PNG.')); return; }
      if (file.size > ID_PHOTO_MAX_BYTES) { reject(new Error('That image is too large. Choose one under 15 MB.')); return; }
      const address = URL.createObjectURL(file);
      const picture = new Image();
      picture.onload = () => {
        const scale = Math.min(1, ID_PHOTO_SIDE / Math.max(picture.naturalWidth, picture.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';   // JPEG has no transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(address);
        resolve(canvas.toDataURL('image/jpeg', ID_PHOTO_QUALITY));
      };
      picture.onerror = () => {
        URL.revokeObjectURL(address);
        reject(new Error('That image could not be read. Try a JPG or PNG.'));
      };
      picture.src = address;
    });
  }

  function setIdPhoto(address, fileName) {
    idPhoto = address;
    byId('idEmpty').hidden = Boolean(address);
    byId('idFile').hidden = !address;
    byId('idRemove').hidden = !address;
    byId('idThumb').src = address;
    byId('idName').textContent = fileName;
    if (!address) input.idFile.value = '';
  }

  async function takeIdPhoto(file) {
    if (!file) return;
    try {
      setIdPhoto(await shrinkPhoto(file), file.name);
      setFieldError(input.idFile, '');
      setFieldError(input.barcode, '');
    } catch (err) {
      setIdPhoto('', '');
      setFieldError(input.idFile, err.message);
    }
  }

  function bindIdPhoto() {
    const drop = byId('idDrop');
    input.idFile.addEventListener('change', () => takeIdPhoto(input.idFile.files[0]));
    byId('idRemove').addEventListener('click', () => { setIdPhoto('', ''); input.idFile.focus(); });
    ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => takeIdPhoto(e.dataTransfer.files[0]));
  }

  // ==========================================
  // 7. SKILLS
  // ==========================================
  function renderSkills() {
    const box = byId('skillsBox');
    box.querySelectorAll('.tag').forEach(tag => tag.remove());
    skills.forEach(skill => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = skill;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.skill = skill;
      remove.setAttribute('aria-label', `Remove ${skill}`);
      remove.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-x"/></svg>';
      tag.appendChild(remove);
      box.insertBefore(tag, input.skill);
    });
    syncSkillIdeas();
    input.skill.placeholder = skills.length ? 'Add another' : 'Type a skill and press Enter';
    syncPreview();
  }

  // Adds what was typed (several at once when it holds commas). Skips repeats, whatever their capitals.
  function addSkills(text) {
    text.split(',').map(part => part.trim().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean).forEach(skill => {
      if (skills.length >= MAX_SKILLS) return;
      if (!skills.some(have => have.toLowerCase() === skill.toLowerCase())) skills.push(skill);
    });
    setFieldError(input.skill, '');
    renderSkills();
  }

  function removeSkill(skill) {
    skills = skills.filter(have => have.toLowerCase() !== skill.toLowerCase());
    renderSkills();
  }

  function commitTypedSkill() {
    if (!input.skill.value.trim()) return;
    addSkills(input.skill.value);
    input.skill.value = '';
  }

  // The quick-add buttons: a professional gets the skills typical for their profession, a student the general list
  function renderSkillIdeas() {
    const ideas = byId('skillSuggest');
    const typical = isStudent() ? [] : professionSkills(chosenProfession());
    const wanted = (typical.length ? typical : SKILL_IDEAS).slice(0, SKILL_IDEA_COUNT);
    const shown = [...ideas.querySelectorAll('button')].map(button => button.textContent);
    if (wanted.join('|') !== shown.join('|')) {
      ideas.querySelectorAll('button').forEach(button => button.remove());
      wanted.forEach(idea => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = idea;
        ideas.appendChild(button);
      });
    }
    syncSkillIdeas();
  }

  function syncSkillIdeas() {
    byId('skillSuggest').querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(skills.some(skill => skill.toLowerCase() === button.textContent.toLowerCase())));
    });
  }

  // What the person welcomes: any number of the choices, or none
  function bindOpenTo() {
    const box = byId('openToBox');
    OPEN_TO_OPTIONS.forEach(([key, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.key = key;
      button.textContent = label;
      button.setAttribute('aria-pressed', 'false');
      box.appendChild(button);
    });
    box.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      openTo = [...box.querySelectorAll('[aria-pressed="true"]')].map(pressed => pressed.dataset.key);
    });
  }

  function bindSkills() {
    const box = byId('skillsBox');
    const ideas = byId('skillSuggest');
    renderSkillIdeas();
    ideas.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      if (button.getAttribute('aria-pressed') === 'true') removeSkill(button.textContent);
      else addSkills(button.textContent);
    });
    box.addEventListener('click', (e) => {
      const remove = e.target.closest('.tag button');
      if (remove) removeSkill(remove.dataset.skill);
      input.skill.focus();
    });
    input.skill.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && input.skill.value.trim()) {
        e.preventDefault();   // Enter adds the skill here instead of sending the form
        commitTypedSkill();
      } else if (e.key === ',') {
        e.preventDefault();
      } else if (e.key === 'Backspace' && !input.skill.value && skills.length) {
        removeSkill(skills[skills.length - 1]);
      }
    });
    // Covers pasting "a, b, c" and phone keyboards that send no key name for the comma
    input.skill.addEventListener('input', () => {
      if (!input.skill.value.includes(',')) return;
      const parts = input.skill.value.split(',');
      const rest = parts.pop();
      addSkills(parts.join(','));
      input.skill.value = rest.trimStart();
    });
    input.skill.addEventListener('blur', commitTypedSkill);
  }

  // ==========================================
  // 8. CHECKING A STEP
  // ==========================================

  // Each check returns the fields that are wrong as [input, message] pairs
  const CHECKS = [
    () => {
      const wrong = [];
      if (input.name.value.trim().length < 2) wrong.push([input.name, 'Enter your full name.']);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.value.trim())) wrong.push([input.email, 'Enter a valid email address.']);
      if (!input.roll.value.trim()) wrong.push([input.roll, isStudent() ? 'Enter your roll or enrollment number.' : 'Enter a username or ID.']);
      if (input.password.value.length < MIN_PASSWORD) wrong.push([input.password, `Use at least ${MIN_PASSWORD} characters.`]);
      return wrong;
    },
    () => {
      const wrong = [];
      if (!isStudent()) {
        if (!chosenProfession()) wrong.push([input.profession, 'Pick your profession from the list.']);
        const years = input.experience.value.trim();
        if (years && !(/^\d+$/.test(years) && Number(years) <= MAX_EXPERIENCE_YEARS)) wrong.push([input.experience, `Enter a whole number from 0 to ${MAX_EXPERIENCE_YEARS}, or leave it empty.`]);
      }
      if (!input.college.value.trim()) wrong.push([input.college, isStudent() ? 'Enter your college.' : 'Enter where you work. "Freelance" is fine.']);
      if (!input.dept.value.trim()) wrong.push([input.dept, isStudent() ? 'Enter your department.' : 'Enter your industry or field.']);
      if (!input.city.value.trim()) wrong.push([input.city, 'Enter your city.']);
      return wrong;
    },
    () => {
      if (isStudent()) {
        return input.barcode.value.trim() || idPhoto ? [] : [[input.barcode, 'Enter the barcode number or add a photo of your ID.']];
      }
      const link = input.portfolio.value.trim();
      if (!link && !input.invite.value.trim()) return [[input.portfolio, 'Enter a link to your work or an invite code.']];
      if (link) {
        // "mysite.com" is accepted and sent as https://mysite.com
        const full = /^https?:\/\//i.test(link) ? link : `https://${link}`;
        let valid = false;
        try { valid = new URL(full).hostname.includes('.'); } catch (err) { /* not an address */ }
        if (!valid) return [[input.portfolio, 'That does not look like a web address.']];
        input.portfolio.value = full;
      }
      return [];
    },
    () => {
      commitTypedSkill();
      const wrong = [];
      if (!skills.length) wrong.push([input.skill, 'Add at least one skill.']);
      if (!input.bio.value.trim()) wrong.push([input.bio, 'Write a line or two about yourself.']);
      if (!input.consent.checked) wrong.push([input.consent, 'Tick the box to agree to the privacy notice (DPDP Act 2023).']);
      return wrong;
    }
  ];

  // Marks what is wrong on a step and puts the cursor in the first wrong field. True when the step is fine.
  function checkStep(index) {
    steps[index].querySelectorAll('.field.invalid input, .field.invalid textarea').forEach(field => setFieldError(field, ''));
    const wrong = CHECKS[index]();
    wrong.forEach(([field, message]) => setFieldError(field, message));
    if (wrong.length) wrong[0][0].focus();
    return !wrong.length;
  }

  // ==========================================
  // 9. MOVING BETWEEN STEPS
  // ==========================================
  function showStep(index, focus) {
    const goingBack = index < step;
    step = index;
    reached = Math.max(reached, index);
    steps.forEach((section, n) => {
      section.hidden = n !== index;
      section.classList.toggle('enter', n === index);
      section.classList.toggle('back', n === index && goingBack);
    });
    stepItems.forEach((item, n) => {
      item.classList.toggle('reached', n <= reached);
      item.classList.toggle('done', n < index);
      item.classList.toggle('current', n === index);
      const button = item.querySelector('button');
      button.disabled = n > reached;
      if (n === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      item.querySelector('i').innerHTML = n < index ? '<svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>' : String(n + 1);
    });
    backBtn.hidden = index === 0;
    nextBtn.firstElementChild.textContent = index === steps.length - 1 ? 'Create account' : 'Continue';
    if (!focus) return;
    // The verification step holds a student half and a professional half; only one of them is on screen
    const first = [...steps[index].querySelectorAll('input:not([type="radio"]):not([type="file"]), textarea')].find(field => field.offsetParent !== null);
    first.focus({ preventScroll: true });
    byId('signupPanel').scrollIntoView({ block: 'start', behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  }

  byId('stepper').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const target = Number(button.dataset.step);
    // Going forward again still passes through the check of the step being left
    if (target > step && !checkStep(step)) return;
    showNotice(notice, '');
    showStep(target, true);
  });
  backBtn.addEventListener('click', () => { showNotice(notice, ''); showStep(step - 1, true); });

  // ==========================================
  // 10. CREATING THE ACCOUNT
  // ==========================================
  function showDone(name, status) {
    byId('signupPanel').hidden = true;
    const done = byId('donePanel');
    byId('doneTitle').textContent = `You are in, ${name.split(/\s+/)[0]}.`;
    byId('doneText').textContent = status === 'verified'
      ? 'Your account is created and verified. Start by finding people with the skills you are missing.'
      : 'Your account is created. The details you gave will be checked, and you can start using Connect2Minds right away.';
    done.hidden = false;
    done.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  }

  async function createAccount() {
    const student = isStudent();
    const payload = {
      name: input.name.value.trim(),
      email: input.email.value.trim(),
      roll_no: input.roll.value.trim(),
      password: input.password.value,
      college_name: input.college.value.trim(),
      department: input.dept.value.trim(),
      city: input.city.value.trim(),
      division: 'A',
      skills: skills.join(', '),
      bio: input.bio.value.trim(),
      consent: input.consent.checked,
      account_type: accountType(),
      id_barcode: student ? (input.barcode.value.trim() || null) : null,
      id_card_image: student ? idPhoto : '',
      portfolio_link: student ? null : input.portfolio.value.trim(),
      invite_code: student ? null : input.invite.value.trim(),
      profession: student ? STUDENT_PROFESSION : chosenProfession(),
      open_to: openTo.join(','),
      experience_years: !student && input.experience.value.trim() ? Number(input.experience.value) : null
    };

    showNotice(notice, '');
    setBusy(nextBtn, true);
    backBtn.disabled = true;
    const result = await postJson('/api/register', payload);
    backBtn.disabled = false;
    setBusy(nextBtn, false);

    if (!result.ok) {
      // The two refusals the server gives by name each belong to an earlier step
      if (/already registered\.$/i.test(result.message) && /roll number or email/i.test(result.message)) {
        showStep(0, false);
        showNotice(notice, 'That roll number or email already has an account. Log in instead, or use different details.');
        input.roll.focus();
      } else if (/barcode/i.test(result.message)) {
        showStep(2, false);
        showNotice(notice, 'That ID barcode is already used by another account.');
        input.barcode.focus();
      } else {
        showNotice(notice, result.message || 'Sign up did not go through. Try again.');
      }
      return;
    }

    // The server has already set the login cookie, so the new member goes straight in
    localStorage.setItem('currentUserId', result.data.user_id);
    localStorage.setItem('userRole', 'user');
    showDone(payload.name, result.data.status);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (nextBtn.disabled || !checkStep(step)) return;
    showNotice(notice, '');
    if (step < steps.length - 1) showStep(step + 1, true);
    else createAccount();
  });

  // ==========================================
  // 11. START
  // ==========================================
  bindSuggestions(input.college, byId('collegeList'), COLLEGES);
  bindSuggestions(input.dept, byId('deptList'), DEPARTMENTS);
  bindProfessionPicker();
  bindIdPhoto();
  bindSkills();
  bindOpenTo();

  form.addEventListener('input', (e) => {
    if (e.target === input.password) syncPassword();
    if (e.target === input.email) syncEmailHint();
    // One of the two verification answers is enough, so filling either clears the error on the other
    if (e.target === input.invite) setFieldError(input.portfolio, '');
    syncPreview();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'accountType') syncAccountType();
    if (e.target === input.consent && input.consent.checked) setFieldError(input.consent, '');
  });

  // Sent here from a members-only page (login.html?next=): keep it, and open it once the account is made
  byId('loginLink').href = withNext('login.html');
  if (NEXT_PAGE) {
    byId('doneGo').href = NEXT_PAGE;
    byId('doneGo').firstElementChild.textContent = `Continue to ${nextPageName().replace(/^the /, '')}`;
  }

  syncAccountType();
  syncPassword();
  renderSkills();
  showStep(0, false);
})();
