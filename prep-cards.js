// ==========================================
// PREP-CARDS.JS — Exam Prep: flashcard decks (a subject's Flashcards tab, one deck's page) and the review screen.
// The server decides when a card comes back (spaced repetition); "Again" brings it back later in the same session.
// ==========================================

let review = null;             // { deck, cards, index, shown, done, xp, last, busy }

// ---------- a subject's Flashcards tab ----------
prepViews.cards = async (box, subject) => {
  const s = subject.syllabus;
  const mine = decksOf(s.id);
  const key = `browse:${s.id}`;
  box.innerHTML = `
    <div class="hm-head"><h2>Your decks for ${escapeHtml(subject.name)}</h2>
      <button class="hm-btn" type="button" data-pp="newDeck" data-syllabus="${s.id}">${ppIcon('add')}New deck</button></div>
    ${mine.length ? `<div class="pp-decks">${mine.map(deckRowHtml).join('')}</div>` : '<p class="hm-note">No decks for this subject yet. Make one per unit: a term or question on the front, the answer on the back.</p>'}
    <div class="st-group">From your class</div>
    <div id="ppClassDecks">${prepCache[key] ? classDecksHtml(prepCache[key], s) : '<div class="skeleton hm-skel"></div>'}</div>`;
  try {
    prepCache[key] = await api(`/api/prep/decks?syllabus_id=${s.id}`);
    const holder = el('ppClassDecks');
    if (holder) holder.innerHTML = classDecksHtml(prepCache[key], s);
  } catch (err) {
    const holder = el('ppClassDecks');
    if (holder) holder.innerHTML = `<p class="hm-note">${escapeHtml(err.message)}</p>`;
  }
};

function classDecksHtml(data, syllabus) {
  const others = data.decks.filter(deck => !deck.mine);
  if (!others.length) return `<p class="hm-note">Nobody in your class has shared a deck for ${escapeHtml(syllabus.subject)} yet. Share yours and classmates can review it too.</p>`;
  return `<div class="pp-decks">${others.map(deck => `
    <div class="pp-deck">
      <span class="hm-icon">${ppIcon('groups')}</span>
      <span class="pp-deck-text"><a href="prep.html?deck=${deck.id}" data-pp-link="deck" data-id="${deck.id}">${escapeHtml(deck.title)}</a>
        <small>${ppPlural(deck.cards, 'card', 'cards')}${deck.followers ? ` · ${ppPlural(deck.followers, 'student follows', 'students follow')} it` : ''}</small></span>
      <span class="pp-deck-actions">${deck.following ? '<span class="pp-chip is-good">Following</span>'
        : `<button class="hm-btn" type="button" data-pp="followDeck" data-id="${deck.id}">Follow</button>`}</span>
    </div>`).join('')}</div>`;
}

// ---------- decks: make, follow ----------
function deckSheet(deck, syllabusId) {
  const linked = prep.subjects.filter(s => s.syllabus);
  const syllabusValue = deck ? (deck.syllabus_id || '') : (syllabusId || '');
  const subject = linked.find(s => s.syllabus.id === Number(syllabusValue));
  openSheet({
    title: deck ? 'Deck settings' : 'New deck',
    fields: [
      { name: 'title', label: 'Name', required: true, maxlength: 120, value: deck ? deck.title : '', placeholder: subject ? `${subject.name}: Unit 1` : 'Operating systems: key terms' },
      { name: 'syllabus_id', label: 'Subject', type: 'select', value: syllabusValue, options: [['', 'No subject'], ...linked.map(s => [s.syllabus.id, s.name])] },
      { name: 'unit_id', label: 'Unit', type: 'select', value: deck ? (deck.unit_id || '') : '',
        options: [['', 'Whole subject'], ...linked.flatMap(s => s.syllabus.units.map(unit => [unit.id, `${s.name}: Unit ${unit.number} ${unit.title}`]))] },
      { name: 'public', label: 'Share with my class (classmates can follow it; they cannot change it)', type: 'checkbox', value: deck ? deck.public : true }
    ],
    submitLabel: deck ? 'Save' : 'Make deck',
    onDelete: deck ? async () => {
      if (!window.confirm(`Delete "${deck.title}"? ${deck.followers ? 'Classmates who follow it lose it too.' : ''}`)) return false;
      await api(`/api/prep/decks/${deck.id}`, { method: 'DELETE' });
      await loadPrep();
      prepGo({});
    } : null,
    deleteLabel: 'Delete deck',
    onSubmit: async (values) => {
      const body = { title: values.title, syllabus_id: values.syllabus_id ? Number(values.syllabus_id) : null, unit_id: values.unit_id ? Number(values.unit_id) : null, public: values.public };
      if (body.unit_id) {                // a unit decides the subject
        const owner = linked.find(s => s.syllabus.units.some(unit => unit.id === body.unit_id));
        body.syllabus_id = owner ? owner.syllabus.id : body.syllabus_id;
      }
      if (deck) {
        await api(`/api/prep/decks/${deck.id}`, { method: 'PUT', body });
        delete prepCache[`deck:${deck.id}`];
        await loadPrep();
      } else {
        const saved = await api('/api/prep/decks', { method: 'POST', body });
        await loadPrep();
        prepGo({ deck: saved.id });
        setTimeout(() => prepActions.addCards({ dataset: { id: saved.id } }), 80);
      }
    }
  });
}

prepActions.newDeck = (button) => deckSheet(null, Number(button.dataset.syllabus) || 0);

prepActions.followDeck = async (button) => {
  button.disabled = true;
  try {
    await api(`/api/prep/decks/${button.dataset.id}/follow`, { method: 'POST' });
    Object.keys(prepCache).forEach(key => { if (key.startsWith('browse:') || key === `deck:${button.dataset.id}`) delete prepCache[key]; });
    await loadPrep();
    showToast('Following. Its cards are in your daily review now.');
  } catch (err) {
    button.disabled = false;
    showToast(err.message);
  }
};

prepActions.unfollowDeck = async (button) => {
  if (!window.confirm('Stop reviewing this deck? Where you are with its cards is forgotten.')) return;
  try {
    await api(`/api/prep/decks/${button.dataset.id}/follow`, { method: 'DELETE' });
    delete prepCache[`deck:${button.dataset.id}`];
    await loadPrep();
  } catch (err) { showToast(err.message); }
};

prepActions.browseDecks = async () => {
  const body = openPrepPanel('Decks from your class', '<div class="pp-pick"><div class="skeleton hm-skel"></div></div>', true);
  try {
    const data = await api('/api/prep/decks');
    const others = data.decks.filter(deck => !deck.mine);
    body.innerHTML = others.length ? `<div class="pp-decks">${others.map(deck => `
      <div class="pp-deck"><span class="pp-deck-text"><a href="prep.html?deck=${deck.id}" data-pp-link="deck" data-id="${deck.id}">${escapeHtml(deck.title)}</a>
        <small>${escapeHtml(deck.subject || 'No subject')} · ${ppPlural(deck.cards, 'card', 'cards')}${deck.followers ? ` · ${deck.followers} following` : ''}</small></span>
        <span class="pp-deck-actions">${deck.following ? '<span class="pp-chip is-good">Following</span>' : `<button class="hm-btn" type="button" data-pp="followDeck" data-id="${deck.id}">Follow</button>`}</span></div>`).join('')}</div>`
      : '<p class="hm-note">No shared decks in your college yet. Make one and share it: classmates who follow it help you climb the weekly league.</p>';
    body.addEventListener('click', (e) => { if (e.target.closest('[data-pp-link]')) closeSheet(); });
  } catch (err) {
    body.innerHTML = `<p class="hm-note">${escapeHtml(err.message)}</p>`;
  }
};

// ---------- one deck ----------
prepViews.deck = async (box, route) => {
  const key = `deck:${route.deck}`;
  if (!prepCache[key]) box.innerHTML = '<div class="hm-card"><div class="hm-list"><div class="skeleton hm-skel"></div><div class="skeleton hm-skel"></div></div></div>';
  let deck;
  try { deck = prepCache[key] = await api(`/api/prep/decks/${route.deck}`); }
  catch (err) { box.innerHTML = `<a class="pp-back" href="prep.html" data-pp-link="home">${ppIcon('arrow_back')}Exam Prep</a><div class="hm-card hm-problem">${ppIcon('style')}<p>${escapeHtml(err.message)}</p></div>`; return; }
  if (prepRoute().deck !== deck.id) return;
  const mineInList = prep.decks.find(d => d.id === deck.id);
  const today = mineInList ? (mineInList.due || 0) + Math.max(0, mineInList.cards - mineInList.seen) : 0;
  const subject = prep.subjects.find(s => s.syllabus && s.syllabus.id === deck.syllabus_id);
  box.innerHTML = `
    <a class="pp-back" href="${subject ? `prep.html?subject=${subject.id}&tab=cards` : 'prep.html'}" data-pp-link="${subject ? 'subject' : 'home'}" data-id="${subject ? subject.id : ''}" data-tab="cards">${ppIcon('arrow_back')}${subject ? escapeHtml(subject.name) : 'Exam Prep'}</a>
    <div class="pp-head">
      <div><h1 class="hm-title">${escapeHtml(deck.title)}</h1>
        <div class="pp-head-meta"><span class="pp-chip is-quiet">${ppPlural(deck.cards, 'card', 'cards')}</span>
          ${deck.public ? '<span class="pp-chip">Shared with your class</span>' : '<span class="pp-chip is-quiet">Only you</span>'}
          ${deck.followers ? `<span class="pp-chip is-quiet">${ppPlural(deck.followers, 'student follows', 'students follow')}</span>` : ''}
          ${deck.made_by_ai ? '<span class="pp-chip is-quiet">Made with the AI tutor</span>' : ''}</div></div>
      <div class="pp-head-actions">
        ${today ? `<button class="hm-btn" type="button" data-pp="startReview" data-deck="${deck.id}">${ppIcon('play_arrow')}Review ${today}</button>` : ''}
        ${deck.mine ? `<button class="pp-small" type="button" data-pp="deckSettings" data-id="${deck.id}">${ppIcon('settings')}Settings</button>`
          : deck.following ? `<button class="pp-small" type="button" data-pp="unfollowDeck" data-id="${deck.id}">Stop following</button>`
          : `<button class="hm-btn" type="button" data-pp="followDeck" data-id="${deck.id}">Follow</button>`}
        ${deck.mine ? '' : `<button class="pp-small" type="button" data-pp="report" data-kind="card_deck" data-id="${deck.id}">${ppIcon('flag')}Report</button>`}
      </div>
    </div>
    <section class="hm-card">
      <div class="hm-head"><h2>Cards</h2>${deck.mine ? `<span class="pp-head-actions"><button class="pp-small" type="button" data-pp="pasteCards" data-id="${deck.id}">${ppIcon('content_paste')}Paste many</button>
        <button class="hm-btn" type="button" data-pp="addCards" data-id="${deck.id}">${ppIcon('add')}Add card</button></span>` : ''}</div>
      ${deck.items.length ? deck.items.map(card => `
        <div class="pp-card-row"><div>${escapeHtml(card.front)}</div><div>${escapeHtml(card.back)}</div>
          ${deck.mine ? `<button class="st-iconbtn" type="button" data-pp="editCard" data-id="${card.id}" data-deck="${deck.id}" aria-label="Edit card">${ppIcon('edit')}</button>` : '<span></span>'}</div>`).join('')
        : `<p class="hm-note">${deck.mine ? 'No cards yet. Add them one by one, or paste a list.' : 'This deck has no cards yet.'}</p>`}
    </section>`;
};

prepActions.deckSettings = (button) => deckSheet(prepCache[`deck:${button.dataset.id}`], 0);

async function afterCardsChanged(deckId) {
  delete prepCache[`deck:${deckId}`];
  await loadPrep();
}

prepActions.addCards = (button) => {
  const deckId = Number(button.dataset.id);
  openSheet({
    title: 'Add a card',
    fields: [
      { name: 'front', label: 'Front: a question or term', type: 'textarea', required: true, maxlength: 600, placeholder: 'What is a deadlock?' },
      { name: 'back', label: 'Back: the answer', type: 'textarea', required: true, maxlength: 2000, placeholder: 'Two or more processes each waiting for a resource another one holds, so none can go on.' },
      { name: 'more', label: 'Add another after this one', type: 'checkbox', value: true }
    ],
    submitLabel: 'Add card',
    onSubmit: async (values) => {
      await api(`/api/prep/decks/${deckId}/cards`, { method: 'POST', body: { cards: [{ front: values.front, back: values.back }] } });
      await afterCardsChanged(deckId);
      if (values.more) setTimeout(() => prepActions.addCards({ dataset: { id: deckId } }), 50);
    }
  });
};

// One card a line: "front | back", "front - back", "front: back" or "front<TAB>back" (a spreadsheet copy)
function parseCardLines(text) {
  const cards = [], bad = [];
  (text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach((line, i) => {
    const match = line.match(/^(.+?)\s*(?:\t|\s\|\s|\|| - | – |: )\s*(.+)$/);
    if (match && match[1].trim() && match[2].trim()) cards.push({ front: match[1].trim().slice(0, 600), back: match[2].trim().slice(0, 2000) });
    else bad.push(i + 1);
  });
  return { cards, bad };
}

prepActions.pasteCards = (button) => {
  const deckId = Number(button.dataset.id);
  openSheet({
    title: 'Paste many cards',
    note: 'One card a line, with | between the front and the back. A copy from a spreadsheet with two columns works too.',
    fields: [{ name: 'lines', label: 'Cards', type: 'textarea', required: true, maxlength: 60000, placeholder: 'Deadlock | Processes waiting on each other forever\nThrashing | Too much paging, too little work' }],
    submitLabel: 'Add cards',
    onOpen: (form) => { form.elements.lines.rows = 10; },
    onSubmit: async (values) => {
      const { cards, bad } = parseCardLines(values.lines);
      if (!cards.length) throw new Error('No cards found. Put | between the front and the back.');
      if (bad.length && !window.confirm(`${ppPlural(bad.length, 'line has', 'lines have')} no | (line ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}). Add the other ${cards.length}?`)) return false;
      await api(`/api/prep/decks/${deckId}/cards`, { method: 'POST', body: { cards } });
      await afterCardsChanged(deckId);
      showToast(`${ppPlural(cards.length, 'card', 'cards')} added`);
    }
  });
};

prepActions.editCard = (button) => {
  const deckId = Number(button.dataset.deck);
  const card = prepCache[`deck:${deckId}`].items.find(c => c.id === Number(button.dataset.id));
  openSheet({
    title: 'Edit card',
    fields: [
      { name: 'front', label: 'Front', type: 'textarea', required: true, maxlength: 600, value: card.front },
      { name: 'back', label: 'Back', type: 'textarea', required: true, maxlength: 2000, value: card.back }
    ],
    onSubmit: async (values) => { await api(`/api/prep/cards/${card.id}`, { method: 'PUT', body: values }); await afterCardsChanged(deckId); },
    onDelete: async () => { await api(`/api/prep/cards/${card.id}`, { method: 'DELETE' }); await afterCardsChanged(deckId); },
    deleteLabel: 'Delete card'
  });
};

// ---------- the review screen ----------
prepActions.startReview = (button) => prepGo({ ...prepRoute(), subject: 0, tab: '', review: 1, deck: button.dataset.deck || '' });

prepViews.review = async (route) => {
  const box = el('prepReview');
  if (review && review.deck === route.deck) return;               // already open (a re-render)
  review = { deck: route.deck, cards: [], index: 0, shown: false, done: 0, xp: 0, last: null, busy: false, repeats: {} };
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  box.innerHTML = `<div class="pp-review-top"><button class="st-iconbtn" type="button" data-pp="closeReview" aria-label="Close">${ppIcon('close')}</button><div class="hm-bar"><i style="width:0"></i></div></div>
    <div class="pp-review-body"><div class="pp-flash"><div class="skeleton hm-skel"></div></div></div>`;
  document.addEventListener('keydown', reviewKeys);
  try {
    const data = await api(`/api/prep/review${route.deck ? `?deck=${route.deck}` : ''}`);
    if (!review) return;
    review.cards = data.cards;
    drawReview();
  } catch (err) {
    box.querySelector('.pp-review-body').innerHTML = `<div class="pp-flash hm-problem">${ppIcon('cloud_off')}<p>${escapeHtml(err.message)}</p></div>`;
  }
};

prepViews.closeReview = () => {
  el('prepReview').hidden = true;
  el('prepReview').innerHTML = '';
  document.body.style.overflow = '';
  document.removeEventListener('keydown', reviewKeys);
  if (review && review.xp) showXpPop({ ...(review.last || {}), xp: review.xp });
  review = null;
};

prepActions.closeReview = () => {
  const route = prepRoute();
  prepGo({ deck: route.deck || '' }, true);
  loadPrep();
};

function drawReview() {
  const box = el('prepReview');
  const total = review.cards.length;
  const left = total - review.index;
  const top = `<div class="pp-review-top"><button class="st-iconbtn" type="button" data-pp="closeReview" aria-label="Close">${ppIcon('close')}</button>
    <div class="hm-bar" aria-hidden="true"><i style="width:${total ? Math.round(review.index * 100 / total) : 100}%"></i></div><span>${Math.max(0, left)} left</span></div>`;
  if (review.index >= total) {
    box.innerHTML = `${top}<div class="pp-review-body"><div class="pp-flash st-empty">${ppIcon(total ? 'celebration' : 'task_alt')}
      <strong>${total ? 'Done for today' : 'Nothing to review right now'}</strong>
      <p>${total ? `${ppPlural(review.done, 'review', 'reviews')}${review.xp ? `, +${review.xp} XP` : ''}. The cards you found hard come back sooner; the easy ones wait longer.` : 'New cards come in tomorrow. You can add more to a deck any time.'}</p>
      <div class="st-empty-actions"><button class="hm-btn" type="button" data-pp="closeReview">Back to Exam Prep</button></div></div></div>`;
    return;
  }
  const card = review.cards[review.index];
  box.innerHTML = `${top}
    <div class="pp-review-body"><div class="pp-flash">
      <div class="pp-flash-deck">${escapeHtml(card.deck)}${card.new ? '<span class="pp-chip">New</span>' : ''}</div>
      <div class="pp-flash-front">${escapeHtml(card.front)}</div>
      ${review.shown ? `<div class="pp-flash-back">${escapeHtml(card.back)}</div>` : ''}
      <p class="pp-keys">${review.shown ? 'Keys: 1 Again · 2 Hard · 3 Good · 4 Easy' : 'Space shows the answer'}</p>
    </div></div>
    <div class="pp-review-foot">${review.shown ? `
      <div class="pp-grades">
        <button class="pp-grade is-again" type="button" data-pp="grade" data-grade="1">Again<small>soon</small></button>
        <button class="pp-grade" type="button" data-pp="grade" data-grade="2">Hard<small>a bit later</small></button>
        <button class="pp-grade is-good" type="button" data-pp="grade" data-grade="3">Good<small>${card.new ? 'tomorrow' : 'later'}</small></button>
        <button class="pp-grade" type="button" data-pp="grade" data-grade="4">Easy<small>much later</small></button>
      </div>` : '<button class="pp-show" type="button" data-pp="showAnswer">Show answer</button>'}</div>`;
  const focus = box.querySelector('.pp-show, .pp-grade.is-good');
  if (focus) focus.focus({ preventScroll: true });
}

prepActions.showAnswer = () => { if (review && !review.shown) { review.shown = true; drawReview(); } };

prepActions.grade = (button) => {
  if (!review || !review.shown) return;
  const card = review.cards[review.index];
  const grade = Number(button.dataset.grade);
  // The next card shows at once; the grade is saved meanwhile
  review.index += 1;
  review.shown = false;
  review.done += 1;
  if (grade === 1 && (review.repeats[card.id] || 0) < 3) {            // "Again": once more at the end of today's session
    review.repeats[card.id] = (review.repeats[card.id] || 0) + 1;
    review.cards.push({ ...card, new: false });
  }
  drawReview();
  // Saved one after another: an "Again" and a later "Good" on the same card must reach the server in that order
  const session = review;
  session.saving = (session.saving || Promise.resolve()).then(() => api('/api/prep/review', { method: 'POST', body: { card_id: card.id, grade } })
    .then(result => { session.xp += (result.xp && result.xp.xp) || 0; session.last = result.xp; })
    .catch(err => showToast(`That review was not saved: ${err.message}`)));
};

function reviewKeys(e) {
  if (!review || e.target.closest('input, textarea, select')) return;
  if (e.key === 'Escape') { e.preventDefault(); prepActions.closeReview(); }
  else if (!review.shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); prepActions.showAnswer(); }
  else if (review.shown && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); prepActions.grade({ dataset: { grade: e.key } }); }
}
