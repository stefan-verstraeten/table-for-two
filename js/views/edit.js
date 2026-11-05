import * as store from '../store.js';
import { h, icon, toast, sheet, confirmSheet, photo, monthName, formatDate, ratingLabel } from '../ui.js';
import { RATINGS, DATE_PRECISIONS, STAR_KINDS, PEOPLE } from '../config.js';
import { processFile, summarise } from '../photos.js';
import * as places from '../places.js';
import { ensureByName } from './profiles.js';

const VISIT_FIELDS = ['restaurantId', 'date', 'meal', 'occasion', 'stars', 'chef', 'chefId', 'menu', 'wine', 'wineIds',
  'companions', 'memorableDish', 'memories', 'memoriesBy', 'photos', 'coverPhotoId'];
const REST_FIELDS = ['name', 'city', 'country', 'countryCode', 'lat', 'lon', 'currentStars'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));

export function renderEdit(root, id, prefill = '') {
  const me = store.me();
  const existing = id ? store.visit(id) : null;
  if (id && !existing) { location.hash = '#/'; return; }
  const visitId = existing?.id || store.newId();
  const origVisit = clone(existing) || {};
  const origRest = clone(existing ? store.restaurant(existing.restaurantId) : null) || {};

  const v = clone(existing) || {
    date: { precision: 'day' },
    stars: { kind: 'michelin', count: 1, uncertain: false },
    photos: [],
    ratings: {},
  };
  v.ratings ||= {};
  v.photos ||= [];
  v.date ||= { precision: 'unknown' };
  v.stars ||= { kind: 'none' };
  const r = clone(origRest) || {};
  let restaurantId = existing?.restaurantId || null;
  v.wineIds ||= [];
  // Prefill: "r:<restaurantId>" (another evening at a known restaurant) or "w:<wishId>" (from the wish list)
  const [pKind, pId] = (prefill || '').split(':');
  const wish = pKind === 'w' ? store.get('wishes', pId) : null;
  if (pKind === 'r' && store.restaurant(pId)) {
    restaurantId = pId;
    Object.assign(r, clone(store.restaurant(pId)));
  }
  if (wish) {
    const known = store.restaurants().find((x) => x.name.toLowerCase() === (wish.name || '').toLowerCase());
    if (known) { restaurantId = known.id; Object.assign(r, clone(known)); }
    else Object.assign(r, { name: wish.name, city: wish.city, country: wish.country });
    if (wish.stars?.kind === 'michelin') v.stars = { ...wish.stars, uncertain: false };
  }
  const newBlobs = new Map(); // path -> blob, saved only when the visit is saved
  const removedPhotoIds = new Set();
  let processing = 0;
  const suggestState = { dismissed: new Set(), places: null, placesFor: null, loadingPlaces: false };

  // ---------- helpers ----------
  const input = (value, onInput, attrs = {}) => h('input.input', { value: value ?? '', oninput: (e) => onInput(e.target.value), ...attrs });
  const field = (label, control, hint) => h('div.field', h('label', label), control, hint && h('p.hint', hint));
  const segmented = (options, current, onPick, cls = '') => h(`div.segmented${cls ? '.' + cls : ''}`,
    options.map((o) => h(`button${same(o.id, current) ? '.on' : ''}`, { type: 'button', onclick: () => onPick(o.id) }, o.label)));

  // ---------- restaurant ----------
  const nameInput = h('input.input.title-input', { value: r.name || '', placeholder: 'Restaurant', autocomplete: 'off' });
  const cityInput = input(r.city, (val) => { r.city = val; });
  const countryInput = input(r.country, (val) => { r.country = val; r.countryCode = ''; });
  const acBox = h('div');
  const locNote = h('p.hint');

  function setRestaurantFields(src) {
    if (src.name != null) { r.name = src.name; nameInput.value = src.name; }
    if (src.city != null) { r.city = src.city; cityInput.value = src.city; }
    if (src.country != null) { r.country = src.country; countryInput.value = src.country; }
    if (src.countryCode != null) r.countryCode = src.countryCode;
    if (src.lat != null) { r.lat = src.lat; r.lon = src.lon; }
    renderLocNote();
  }
  function renderLocNote() {
    locNote.textContent = r.lat != null ? `On the map at ${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}` : 'Not on the map yet.';
  }

  nameInput.addEventListener('input', () => {
    r.name = nameInput.value;
    if (restaurantId && store.restaurant(restaurantId)?.name !== r.name) {
      // Typing a different name detaches from the previously chosen restaurant.
      restaurantId = existing?.restaurantId === restaurantId ? restaurantId : null;
    }
    const q = r.name.trim().toLowerCase();
    const matches = q.length < 2 ? [] : store.restaurants()
      .filter((x) => x.name.toLowerCase().includes(q) && x.id !== restaurantId).slice(0, 5);
    acBox.replaceChildren(matches.length ? h('div.autocomplete', matches.map((m) => h('button', {
      type: 'button',
      onclick: () => {
        restaurantId = m.id;
        Object.assign(r, clone(m));
        setRestaurantFields(m);
        acBox.replaceChildren();
        renderStarsToday();
      },
    }, m.name, h('small', [m.city, m.country].filter(Boolean).join(', ') + ' · visited before')))) : '');
  });
  nameInput.addEventListener('blur', () => setTimeout(() => acBox.replaceChildren(), 200));

  async function lookUpPlace() {
    const q = [r.name, r.city, r.country].filter(Boolean).join(', ');
    if (!r.name) { toast('Type the restaurant name first'); return; }
    const body = h('div', h('h3.serif', { style: { fontSize: '24px', margin: '0 0 6px' } }, 'Find on the map'), h('p.muted', `Searching for “${q}”…`));
    const s = sheet(body);
    try {
      let results = await places.search(q);
      if (!results.length && r.city) results = await places.search(r.name);
      body.replaceChildren(
        h('h3.serif', { style: { fontSize: '24px', margin: '0 0 6px' } }, 'Which one?'),
        results.length ? h('div.place-list', results.map((p) => h('button', {
          onclick: () => { setRestaurantFields({ city: p.city, country: p.country, countryCode: p.countryCode, lat: p.lat, lon: p.lon }); s.close(); toast('Location set'); },
        }, h('span', p.name, h('small', { style: { display: 'block' } }, p.label)), ''))) : h('p.muted', 'Nothing found. Try adding the city.'),
      );
    } catch {
      body.replaceChildren(h('p.muted', 'The lookup is not available right now (are you offline?).'));
    }
  }

  // ---------- date ----------
  const dateBox = h('div');
  function renderDate() {
    const d = v.date;
    const yearIn = h('input.input', { type: 'number', inputmode: 'numeric', placeholder: 'Year', value: d.y ?? '', oninput: (e) => { d.y = +e.target.value || undefined; } });
    const monthSel = h('select.input', { onchange: (e) => { d.m = +e.target.value || undefined; } },
      h('option', { value: '' }, 'Month'),
      Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1, selected: d.m === i + 1 }, monthName(i + 1))));
    const dayIn = h('input.input', { type: 'number', inputmode: 'numeric', placeholder: 'Day', min: 1, max: 31, value: d.d ?? '', oninput: (e) => { d.d = +e.target.value || undefined; } });
    const p = d.precision;
    dateBox.replaceChildren(
      segmented(DATE_PRECISIONS, p, (id) => { d.precision = id; renderDate(); }),
      h('div', { style: { marginTop: '10px' } },
        p === 'day' ? h('div.grid-3', dayIn, monthSel, yearIn)
          : p === 'month' ? h('div.grid-2', monthSel, yearIn)
          : p === 'year' || p === 'circa' ? yearIn
          : h('p.hint', 'That’s fine — it will be listed under “Undated”. You can add it later.')),
    );
  }

  // ---------- stars ----------
  const starsBox = h('div');
  const starsTodayBox = h('div');
  function renderStars() {
    const s = v.stars;
    starsBox.replaceChildren(
      segmented(STAR_KINDS, s.kind, (k) => { s.kind = k; if (k !== 'none' && !s.count) s.count = 1; renderStars(); renderStarsToday(); }),
      s.kind !== 'none' && h('div', { style: { marginTop: '10px' } },
        segmented([1, 2, 3].map((n) => ({ id: n, label: '★'.repeat(n) })), s.count, (n) => { s.count = n; renderStars(); }, s.kind),
        h('label.check', h('input', { type: 'checkbox', checked: !!s.uncertain, onchange: (e) => { s.uncertain = e.target.checked; } }), 'Not sure how many it had then'),
        h('p.hint', s.kind === 'michelin' ? 'The stars it had on the evening you went.' : 'Our own stars, for places Michelin doesn’t cover. Shown in grey.'),
      ),
    );
  }
  function renderStarsToday() {
    starsTodayBox.replaceChildren(v.stars.kind === 'michelin'
      ? field('Michelin stars today (optional)', segmented(
          [{ id: null, label: 'Don’t know' }, { id: 0, label: 'None' }, { id: 1, label: '1' }, { id: 2, label: '2' }, { id: 3, label: '3' }],
          r.currentStars ?? null, (n) => { r.currentStars = n; renderStarsToday(); }))
      : '');
  }

  // ---------- ratings ----------
  const ratingBox = h('div');
  function renderRatings() {
    const other = PEOPLE.find((p) => p !== me);
    ratingBox.replaceChildren(
      field(`${me}’s verdict`, segmented(RATINGS, v.ratings[me] || null, (id) => {
        v.ratings[me] = v.ratings[me] === id ? undefined : id; renderRatings();
      })),
      other && h('p.hint', `${other}: ${ratingLabel(v.ratings[other]) || 'not rated yet'}`),
    );
  }

  // ---------- photos ----------
  const photoBox = h('div');
  const suggestBox = h('div');
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' },
    onchange: (e) => { handleFiles([...e.target.files]); e.target.value = ''; },
  });

  async function handleFiles(files) {
    if (!files.length) return;
    processing += files.length; renderPhotos();
    const added = [];
    for (const f of files) {
      try {
        const { photo: p, blob, thumbBlob } = await processFile(f, visitId);
        newBlobs.set(p.path, blob);
        newBlobs.set(p.thumb, thumbBlob);
        v.photos.push(p);
        added.push(p);
        if (!v.coverPhotoId) v.coverPhotoId = p.id;
      } catch (err) {
        console.error(err);
        toast(`Could not read ${f.name}`);
      }
      processing--; renderPhotos();
    }
    if (added.length) { suggestState.dismissed.clear(); renderSuggestions(added); }
  }

  function thumbFor(p) {
    if (newBlobs.has(p.thumb)) {
      const img = h('img', { alt: '' });
      img.src = URL.createObjectURL(newBlobs.get(p.thumb));
      return img;
    }
    return photo(p.thumb || p.path);
  }

  function renderPhotos() {
    photoBox.replaceChildren(h('div.photo-grid',
      v.photos.map((p) => h('button.ph', { type: 'button', onclick: () => photoActions(p) },
        thumbFor(p),
        p.id === v.coverPhotoId && h('span.badge', 'Cover'),
        p.kind === 'menu' && h('span.badge', { style: p.id === v.coverPhotoId ? { top: '26px' } : {} }, 'Menu'))),
      Array.from({ length: processing }, () => h('div.ph.processing', 'Reading…')),
      h('button.add-photo', { type: 'button', onclick: () => fileInput.click() }, icon('camera'), 'Add photos'),
    ));
  }

  function photoActions(p) {
    const s = sheet(h('div.photo-actions',
      h('div', { style: { maxHeight: '40vh', overflow: 'hidden', marginBottom: '8px' } }, thumbFor(p)),
      p.takenAt && h('p.hint', `Taken ${new Date(p.takenAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}${p.lat != null ? ' · has location' : ''}`),
      h('button', { onclick: () => { v.coverPhotoId = p.id; renderPhotos(); s.close(); } }, icon('cover'), 'Use as cover photo'),
      h('button', { onclick: () => { p.kind = p.kind === 'menu' ? 'photo' : 'menu'; renderPhotos(); s.close(); } }, icon('menu'),
        p.kind === 'menu' ? 'This is a photo, not the menu' : 'This is the menu (keep as souvenir)'),
      h('button', { style: { color: 'var(--burgundy)' }, onclick: () => {
        v.photos = v.photos.filter((x) => x.id !== p.id);
        newBlobs.delete(p.path); newBlobs.delete(p.thumb);
        if (origVisit.photos?.some((x) => x.id === p.id)) removedPhotoIds.add(p.id);
        if (v.coverPhotoId === p.id) v.coverPhotoId = v.photos.find((x) => x.kind !== 'menu')?.id || v.photos[0]?.id;
        renderPhotos(); s.close();
      } }, icon('trash'), 'Remove photo'),
    ));
  }

  // ---------- suggestions from photo metadata ----------
  function renderSuggestions(batch) {
    const sum = summarise(batch);
    const rows = [];

    if (!sum.countDated && !sum.countLocated) {
      suggestBox.replaceChildren(h('div.suggest',
        h('div.eyebrow', icon('sparkle'), 'From your photos'),
        h('p.hint', { style: { margin: 0 } }, 'These photos carry no date or location. That happens with screenshots, photos received via WhatsApp, or when iPhone leaves the location out — just fill in what you remember.'),
      ));
      return;
    }

    // Date
    if (sum.first && !suggestState.dismissed.has('date')) {
      const [y, m, d] = sum.first.slice(0, 10).split('-').map(Number);
      const proposed = { precision: 'day', y, m, d };
      const isSame = same({ ...v.date }, proposed);
      const label = formatDate(proposed);
      const extra = sum.days.length > 1 ? `Photos span ${sum.days.length} days; this is the earliest.` : `Taken at ${sum.first.slice(11, 16)}.`;
      rows.push(h(`div.suggest-row${isSame ? '.done' : ''}`,
        icon('clock'),
        h('div.what', isSame ? 'Date set to ' : 'Taken on ', h('b', label), h('small', extra)),
        !isSame && h('div.actions',
          h('button.btn.small.primary', { type: 'button', onclick: () => {
            v.date = proposed;
            const hour = +sum.first.slice(11, 13);
            if (!v.meal) v.meal = hour < 16 ? 'lunch' : 'dinner';
            renderDate(); renderMeal(); renderSuggestions(batch);
          } }, 'Use'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => { suggestState.dismissed.add('date'); renderSuggestions(batch); } }, 'No'),
        )));
    }

    // Location
    if (sum.lat != null && !suggestState.dismissed.has('place')) {
      const here = { lat: sum.lat, lon: sum.lon };
      const hasCoords = r.lat != null;
      const dist = hasCoords ? places.distanceKm(here, r) : null;

      if (r.name && hasCoords && dist < 0.5) {
        rows.push(h('div.suggest-row.done', icon('pin'), h('div.what', 'Taken at ', h('b', r.name), h('small', `${places.formatDistance(dist)} from its location`))));
      } else if (r.name && (restaurantId || r.lat != null) && hasCoords) {
        rows.push(h('div.suggest-row', icon('pin'),
          h('div.what', 'Taken ', h('b', places.formatDistance(dist)), ` from ${r.name}`, h('small', 'Is the restaurant’s location wrong, or are these photos from elsewhere?')),
          h('div.actions',
            h('button.btn.small.primary', { type: 'button', onclick: () => { setRestaurantFields(here); fillCityFromCoords(here, true); renderSuggestions(batch); } }, 'Move pin'),
            h('button.btn.small.ghost', { type: 'button', onclick: () => { suggestState.dismissed.add('place'); renderSuggestions(batch); } }, 'Keep'))));
      } else {
        // Offer nearby restaurants.
        const key = `${here.lat.toFixed(4)},${here.lon.toFixed(4)}`;
        if (suggestState.placesFor !== key && !suggestState.loadingPlaces) {
          suggestState.loadingPlaces = true;
          places.nearby(here.lat, here.lon)
            .then((list) => { suggestState.places = list; })
            .catch(() => { suggestState.places = []; })
            .finally(() => { suggestState.loadingPlaces = false; suggestState.placesFor = key; renderSuggestions(batch); });
        }
        const list = suggestState.placesFor === key ? suggestState.places : null;
        rows.push(h('div.suggest-row', { style: { alignItems: 'flex-start' } }, icon('pin'),
          h('div.what',
            r.name ? h('span', 'Where these were taken — is this ', h('b', r.name), '?') : 'Where were these taken?',
            h('small', list == null ? 'Looking for restaurants nearby…' : list.length ? 'Restaurants near the photo location:' : 'No restaurants found nearby.'),
            list && h('div.place-list',
              list.map((p) => h('button', { type: 'button', onclick: () => {
                if (!restaurantId || !r.name) setRestaurantFields({ name: p.name });
                setRestaurantFields({
                  lat: p.lat, lon: p.lon,
                  ...(p.city ? { city: p.city } : {}),
                  ...(p.country ? { country: p.country, countryCode: p.countryCode } : {}),
                });
                fillCityFromCoords(p, false);
                renderSuggestions(batch);
                toast(`${p.name} — check the details below`);
              } }, h('span', p.name, p.cuisine && h('small', { style: { display: 'block' } }, p.cuisine)), h('small', places.formatDistance(p.distanceKm)))),
              h('button', { type: 'button', onclick: () => {
                setRestaurantFields(here); fillCityFromCoords(here, false);
                suggestState.dismissed.add('place'); renderSuggestions(batch);
              } }, h('span', r.name ? `Use the photo location for ${r.name}` : 'None of these — just use the photo location'), h('small', '')),
            ),
          )));
      }
    }

    suggestBox.replaceChildren(rows.length ? h('div.suggest',
      h('div.eyebrow', icon('sparkle'), 'From your photos'),
      rows,
      h('p.hint', { style: { marginBottom: 0 } }, 'Everything stays editable below.')) : '');
  }

  async function fillCityFromCoords(pt, overwrite) {
    if (!overwrite && r.city && r.country) return;
    try {
      const info = await places.reverse(pt.lat, pt.lon);
      setRestaurantFields({
        ...(overwrite || !r.city ? { city: info.city } : {}),
        ...(overwrite || !r.country ? { country: info.country, countryCode: info.countryCode } : {}),
      });
    } catch {}
  }

  // ---------- meal ----------
  const mealBox = h('div');
  function renderMeal() {
    mealBox.replaceChildren(segmented([{ id: 'lunch', label: 'Lunch' }, { id: 'dinner', label: 'Dinner' }], v.meal || null,
      (id) => { v.meal = v.meal === id ? undefined : id; renderMeal(); }));
  }

  // ---------- chef ----------
  const chefInput = h('input.input', { value: v.chef || '', autocomplete: 'off', placeholder: 'Who was in the kitchen' });
  const chefAc = h('div');
  chefInput.addEventListener('input', () => {
    v.chef = chefInput.value;
    const q = v.chef.trim().toLowerCase();
    const m = q.length < 2 ? [] : store.list('chefs').filter((c) => c.name.toLowerCase().includes(q) && c.name.toLowerCase() !== q).slice(0, 5);
    chefAc.replaceChildren(m.length ? h('div.autocomplete', m.map((c) => h('button', { type: 'button', onclick: () => {
      v.chef = c.name; chefInput.value = c.name; chefAc.replaceChildren();
    } }, c.name))) : '');
  });
  chefInput.addEventListener('blur', () => setTimeout(() => chefAc.replaceChildren(), 200));

  // ---------- wines ----------
  const newWineNames = [];
  const winesBox = h('div');
  function renderWines() {
    const chips = [
      ...v.wineIds.map((wid) => ({ label: store.get('wines', wid)?.name || '…', remove: () => { v.wineIds = v.wineIds.filter((x) => x !== wid); } })),
      ...newWineNames.map((n) => ({ label: n, remove: () => newWineNames.splice(newWineNames.indexOf(n), 1) })),
    ];
    const wineIn = h('input.input', { placeholder: 'Add a wine…', autocomplete: 'off' });
    const ac = h('div');
    const add = (fn) => { fn(); renderWines(); winesBox.querySelector('input')?.focus(); };
    wineIn.addEventListener('input', () => {
      const q = wineIn.value.trim().toLowerCase();
      if (q.length < 2) { ac.replaceChildren(); return; }
      const m = store.list('wines').filter((w) => w.name.toLowerCase().includes(q) && !v.wineIds.includes(w.id)).slice(0, 5);
      const exact = m.some((w) => w.name.toLowerCase() === q) || newWineNames.some((n) => n.toLowerCase() === q);
      ac.replaceChildren(h('div.autocomplete',
        m.map((w) => h('button', { type: 'button', onclick: () => add(() => v.wineIds.push(w.id)) }, w.name, h('small', [w.vintage, w.producer].filter(Boolean).join(' · ')))),
        !exact && h('button', { type: 'button', onclick: () => add(() => newWineNames.push(wineIn.value.trim())) }, `Add “${wineIn.value.trim()}” as a new wine`)));
    });
    wineIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); ac.querySelector('button')?.click(); }
    });
    wineIn.addEventListener('blur', () => setTimeout(() => ac.replaceChildren(), 200));
    winesBox.replaceChildren(
      chips.length > 0 && h('div.chips', chips.map((c) => h('span.chip', c.label,
        h('button', { type: 'button', 'aria-label': 'Remove', onclick: () => { c.remove(); renderWines(); } }, '×')))),
      h('div', { style: { position: 'relative' } }, wineIn, ac),
    );
  }

  // ---------- save ----------
  async function save() {
    if (processing) { toast('Still reading photos…'); return; }
    r.name = nameInput.value.trim();
    if (!r.name) { toast('Give the restaurant a name'); nameInput.focus(); return; }

    // Restaurant: new, or changes to an existing one.
    const rid = restaurantId || store.newId();
    const base = restaurantId ? (store.restaurant(restaurantId) || {}) : {};
    const rPatch = {};
    for (const f of REST_FIELDS) if (!same(r[f], base[f]) && !(r[f] === undefined && !restaurantId)) rPatch[f] = r[f];
    if (!restaurantId || Object.keys(rPatch).length) await store.save('restaurants', rid, rPatch);

    // Photos first, so they upload before the journal references them.
    for (const [path, blob] of newBlobs) await store.addPhotoBlob(path, blob);
    for (const pid of removedPhotoIds) await store.forgetPhoto(visitId, pid);

    v.restaurantId = rid;
    v.chef = (chefInput.value || '').trim() || undefined;
    v.chefId = v.chef ? await ensureByName('chefs', v.chef) : undefined;
    for (const n of newWineNames) {
      const wid = await ensureByName('wines', n);
      if (wid && !v.wineIds.includes(wid)) v.wineIds.push(wid);
    }
    if (!same(v.memories, origVisit.memories)) v.memoriesBy = me;
    const vPatch = {};
    for (const f of VISIT_FIELDS) if (!same(v[f], origVisit[f])) vPatch[f] = v[f];
    for (const p of PEOPLE) if (!same(v.ratings[p], origVisit.ratings?.[p])) vPatch[`ratings.${p}`] = v.ratings[p];
    if (!existing || Object.keys(vPatch).length) await store.save('visits', visitId, vPatch);

    if (wish && !existing) await store.save('wishes', wish.id, { doneVisitId: visitId });
    toast(existing ? 'Saved' : wish ? 'A wish come true — added to your journey' : 'Added to your journey');
    location.hash = `#/visit/${visitId}`;
  }

  async function del() {
    if (await confirmSheet('Remove this visit?', 'It disappears from both phones. The photos stay in the repository’s history.', 'Remove', { danger: true })) {
      await store.remove('visits', visitId);
      toast('Removed');
      location.hash = '#/';
    }
  }

  // ---------- layout ----------
  const memories = h('textarea.textarea.memories', {
    placeholder: 'What made the evening? The dish you still talk about, the room, the service, what you celebrated…',
    oninput: (e) => { v.memories = e.target.value; },
  });
  memories.value = v.memories || '';

  const page = h('div.page',
    h('div.topbar',
      h('a.icon-btn', { href: existing ? `#/visit/${visitId}` : '#/', 'aria-label': 'Cancel' }, icon('close')),
      h('span.eyebrow', existing ? 'Edit visit' : 'New visit'),
      h('button.text-btn', { type: 'button', onclick: save }, 'Save'),
    ),

    fileInput,
    field('Photos of the evening', photoBox, !existing && 'Start here: the date and place are read from your photos.'),
    suggestBox,

    h('div.field', { style: { position: 'relative' } }, h('label', 'Restaurant'), nameInput, acBox),
    h('div.grid-2', field('City', cityInput), field('Country', countryInput)),
    h('div.field', { style: { marginTop: '-8px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
        locNote, h('button.btn.small.ghost', { type: 'button', onclick: lookUpPlace }, icon('pin'), 'Find on map'))),

    h('h3.section-title', 'The visit'),
    field('When', dateBox),
    field('Lunch or dinner', mealBox),
    field('Occasion', input(v.occasion, (val) => { v.occasion = val; }, { placeholder: 'Anniversary, a birthday, just because…' })),
    field('Stars at the time', starsBox),
    starsTodayBox,

    h('h3.section-title', 'The table'),
    h('div.field', { style: { position: 'relative' } }, h('label', 'Chef'), chefInput, chefAc),
    field('Menu', input(v.menu, (val) => { v.menu = val; }, { placeholder: 'e.g. Menu Prestige, 9 courses' })),
    field('Wines we drank', winesBox, 'Each wine gets its own profile page under Memory lane.'),
    field('Wine notes', input(v.wine, (val) => { v.wine = val; }, { placeholder: 'The pairing, or how it was served' })),
    field('With', input(v.companions, (val) => { v.companions = val; }, { placeholder: 'Just the two of us' })),
    field('The dish we remember', input(v.memorableDish, (val) => { v.memorableDish = val; })),

    h('h3.section-title', 'Our memories'),
    field('Shared notes', memories, v.memoriesBy && `Last written by ${v.memoriesBy}`),
    ratingBox,

    h('div', { style: { marginTop: '30px' } },
      h('button.btn.primary.block', { type: 'button', onclick: save }, existing ? 'Save changes' : 'Add to our journey'),
      existing && h('button.btn.ghost.block', { type: 'button', style: { marginTop: '10px', color: 'var(--burgundy)' }, onclick: del }, 'Remove this visit')),
  );

  renderWines(); renderLocNote(); renderDate(); renderStars(); renderStarsToday(); renderRatings(); renderPhotos(); renderMeal();
  root.replaceChildren(page);
  window.scrollTo(0, 0);
}
