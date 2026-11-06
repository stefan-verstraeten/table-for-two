import * as store from '../store.js';
import { h, icon, toast, sheet, confirmSheet, photo, monthName, formatDate, ratingLabel } from '../ui.js';
import { RATINGS, DATE_PRECISIONS, STAR_KINDS, PEOPLE } from '../config.js';
import { processFile, summarise } from '../photos.js';
import * as places from '../places.js';
import { ensureByName, WINE_STYLES } from './profiles.js';
import * as claude from '../claude.js';
import { findExisting } from '../tidy.js';

const VISIT_FIELDS = ['restaurantId', 'date', 'meal', 'occasion', 'stars', 'gaultMillau', 'chef', 'chefId', 'menu', 'wine', 'wineIds',
  'companions', 'memorableDish', 'memories', 'memoriesBy', 'photos', 'coverPhotoId', 'courses'];
const REST_FIELDS = ['name', 'city', 'country', 'countryCode', 'lat', 'lon', 'currentStars', 'address'];
const PHOTO_KINDS = { photo: 'Photo', menu: 'Menu', winelist: 'Wine list', bottle: 'Wine' };

// "16,5" or "16.5/20" → 16.5; anything else → undefined.
export function parseGM(text) {
  const n = parseFloat(String(text || '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 20 ? Math.round(n * 2) / 2 : undefined;
}

// "10.30, -84.81", 10°18'05"N 84°48'30"W, or a Google / Apple Maps link.
export function parseCoords(text) {
  const t = (text || '').trim();
  if (!t) return null;
  const ok = (lat, lon) => (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { lat, lon } : null);
  let m = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    || t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    || t.match(/[?&](?:q|ll|query|sll|daddr|destination)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return ok(+m[1], +m[2]);
  m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (m) return ok(+m[1], +m[2]);
  const dms = [...t.matchAll(/(\d{1,3})\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|”|'')\s*)?([NSEWO])/gi)];
  if (dms.length === 2) {
    const val = (x) => { const v = +x[1] + (+(x[2] || '0').replace(',', '.')) / 60 + (+(x[3] || '0').replace(',', '.')) / 3600; return /[SW]/i.test(x[4]) ? -v : v; };
    const [a, b] = /[NS]/i.test(dms[0][4]) ? dms : [dms[1], dms[0]];
    return ok(val(a), val(b));
  }
  return null;
}

// Pasted menu text (e.g. copied with Live Text): blocks separated by blank lines,
// first line the dish, the rest its details. Without blank lines: alternate lines.
export function parseMenuText(text) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  if (blocks.length > 1) return blocks.map((b) => ({ dish: b[0], detail: b.slice(1).join(', ') }));
  const lines = blocks[0] || [];
  const out = [];
  for (let i = 0; i < lines.length; i += 2) out.push({ dish: lines[i], detail: lines[i + 1] || '' });
  return out;
}

// Pasted wine list text: blocks of "Name 2023 / Producer / grapes / region".
export function parseWineText(text) {
  return text.split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length).map((b) => {
    const m = b[0].match(/^(.*?)\s*\b((?:19|20)\d{2})\b\s*(.*)$/);
    const name = m ? [m[1], m[3]].filter(Boolean).join(' ').trim() : b[0];
    return { name: name || b[0], vintage: m ? m[2] : '', producer: b[1] || '', grapes: b[2] || '', region: b.slice(3).join(', ') };
  });
}

const coursesToText = (cs) => (cs || []).map((c) => [c.dish, c.detail].filter(Boolean).join(' — ')).join('\n');
const textToCourses = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [dish, ...rest] = l.split(/\s+[—–-]\s+/);
  return { dish: dish.trim(), detail: rest.join(' — ').trim() };
});

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));

export function renderEdit(root, rawId, prefill = '') {
  const [id, editQuery] = (rawId || '').split('?');
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
  const addrInput = h('input.input', { value: r.address || '', placeholder: 'Street address, GPS (10.30, -84.81) or a maps link', autocomplete: 'off', autocapitalize: 'off' });
  addrInput.addEventListener('input', () => { const t = addrInput.value.trim(); if (!parseCoords(t)) r.address = t || undefined; });
  addrInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); locateAddress(); } });

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
        }, h('span', p.name, h('small', { style: { display: 'block' } }, p.label)), ''))) : h('p.muted', 'Nothing found. Not every restaurant is on OpenStreetMap — type its address or paste GPS coordinates in the field below the map button.'),
      );
    } catch {
      body.replaceChildren(h('p.muted', 'The lookup is not available right now (are you offline?).'));
    }
  }

  async function locateAddress() {
    const text = addrInput.value.trim();
    if (!text) { toast('Type an address or GPS coordinates'); addrInput.focus(); return; }
    const pt = parseCoords(text);
    if (pt) {
      r.address = r.address && !parseCoords(r.address) ? r.address : undefined;
      setRestaurantFields(pt);
      fillCityFromCoords(pt, false);
      toast('Pinned at those coordinates');
      return;
    }
    if (/goo\.gl|maps\.app/i.test(text)) { toast('Short links can’t be read — open it and copy the coordinates instead'); return; }
    r.address = text;
    const body = h('div', h('h3.serif', { style: { fontSize: '24px', margin: '0 0 6px' } }, 'Find the address'), h('p.muted', `Looking up “${text}”…`));
    const s = sheet(body);
    try {
      let results = await places.search(text);
      if (!results.length && r.country && !text.toLowerCase().includes(r.country.toLowerCase())) results = await places.search(`${text}, ${r.country}`);
      body.replaceChildren(
        h('h3.serif', { style: { fontSize: '24px', margin: '0 0 6px' } }, results.length ? 'Is it here?' : 'Not found'),
        results.length ? h('div.place-list', results.map((p) => h('button', {
          onclick: () => {
            setRestaurantFields({ lat: p.lat, lon: p.lon, ...(!r.city ? { city: p.city } : {}), ...(!r.country ? { country: p.country, countryCode: p.countryCode } : {}) });
            s.close(); toast('Location set');
          },
        }, h('span', p.name, h('small', { style: { display: 'block' } }, p.label)), ''))) : h('p.muted', 'Try a simpler address (street and town), or paste GPS coordinates: in Google Maps, long-press the spot and copy the numbers at the top.'),
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
    if (added.length) { suggestState.dismissed.clear(); renderSuggestions(added); if (claude.hasKey()) scanPhotos({ auto: true }); }
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
        p.kind && p.kind !== 'photo' && h('span.badge', { style: p.id === v.coverPhotoId ? { top: '26px' } : {} }, PHOTO_KINDS[p.kind]))),
      Array.from({ length: processing }, () => h('div.ph.processing', 'Reading…')),
      h('button.add-photo', { type: 'button', onclick: () => fileInput.click() }, icon('camera'), 'Add photos'),
    ), v.photos.length > 0 && h('div.photo-tools',
      h('button.main-photo', { type: 'button', onclick: chooseCover },
        h('span.mp-thumb', v.photos.find((x) => x.id === v.coverPhotoId) ? thumbFor(v.photos.find((x) => x.id === v.coverPhotoId)) : ''),
        h('span', h('b', 'Main photo'), h('small', 'Tap to choose another'))),
      h('button.btn.small.ghost', { type: 'button', onclick: () => scanPhotos({ auto: false }) }, icon('sparkle'), 'Find menu & wines')),
    scanBox);
  }

  function chooseCover() {
    const s = sheet(h('div',
      h('h3.serif', { style: { fontSize: '24px', margin: '0 0 12px' } }, 'Choose the main photo'),
      h('div.photo-grid.pick', v.photos.map((p) => h(`button.ph${p.id === v.coverPhotoId ? '.chosen' : ''}`, { type: 'button', onclick: () => {
        v.coverPhotoId = p.id; renderPhotos(); s.close(); toast('Main photo chosen — save to keep it');
      } }, thumbFor(p)))),
    ));
  }

  // ---------- finding menus and wines among the photos (Claude) ----------
  const scanBox = h('div');
  let scanning = false;
  async function thumbBlobOf(p) {
    if (newBlobs.has(p.thumb)) return newBlobs.get(p.thumb);
    return (await fetch(await store.photoURL(p.thumb || p.path))).blob();
  }
  async function scanPhotos({ auto }) {
    if (scanning) return;
    if (!claude.hasKey()) {
      sheet(h('div.confirm', h('h3.serif', 'Needs a Claude key'),
        h('p.muted', 'Recognising menus, wine lists and bottle labels in your photos is done by Claude. Add a key under You → Claude (once per phone). Without a key you can still tap a photo, mark it as the menu or wine list, and paste its text.')));
      return;
    }
    scanning = true;
    const setRow = (...c) => scanBox.replaceChildren(h('div.suggest', h('div.eyebrow', icon('sparkle'), 'Menu & wines'), ...c));
    setRow(h('div.scan-row', h('div.spinner.small'), h('span', `Looking through ${v.photos.length} photo${v.photos.length > 1 ? 's' : ''} for the menu and the wines…`)));
    try {
      const photos = [...v.photos];
      const kinds = new Map();
      for (let i = 0; i < photos.length; i += 20) {
        const batch = photos.slice(i, i + 20);
        const res = await claude.classifyPhotos(await Promise.all(batch.map(thumbBlobOf)));
        for (const r of res) if (batch[r.index] && PHOTO_KINDS[r.kind]) kinds.set(batch[r.index].id, r.kind);
      }
      for (const p of photos) if (p.kind && p.kind !== 'photo') kinds.set(p.id, p.kind); // what you marked yourselves wins
      const found = photos.filter((p) => ['menu', 'winelist', 'bottle'].includes(kinds.get(p.id)));
      if (!found.length) {
        setRow(h('p.hint', { style: { margin: 0 } }, 'No menu, wine list or bottle found in these photos.'));
        if (auto) setTimeout(() => scanBox.replaceChildren(), 6000);
        return;
      }
      setRow(h('div.scan-row', h('div.spinner.small'), h('span', `Reading ${found.length} photo${found.length > 1 ? 's' : ''} (menu, wine list, labels)…`)));
      const items = await Promise.all(found.slice(0, 12).map(async (p) => ({ p, kind: kinds.get(p.id), blob: await blobOf(p) })));
      const meal = await claude.readMeal(items);
      const courses = (meal.courses || []).filter((c) => c.dish);
      const wines = (meal.wines || []).filter((w) => w.name).map((w) => ({ ...w, photoRef: Number.isInteger(w.photo) ? items[w.photo]?.p : null }));
      const summary = [courses.length && `${courses.length} course${courses.length > 1 ? 's' : ''}`, wines.length && `${wines.length} wine${wines.length > 1 ? 's' : ''}`].filter(Boolean).join(' and ');
      const apply = () => reviewMeal({ title: meal.title, courses, wines, kinds });
      setRow(h('div.suggest-row', icon('menu'),
        h('div.what', 'Found ', h('b', summary || 'nothing readable'), h('small', `in ${found.length} photo${found.length > 1 ? 's' : ''}`)),
        (courses.length || wines.length) ? h('div.actions', h('button.btn.small.primary', { type: 'button', onclick: apply }, 'Review')) : ''));
      if (!auto) apply();
    } catch (e) {
      console.error(e);
      setRow(h('p.hint', { style: { margin: 0 } }, `Couldn’t look through the photos: ${e.message || 'Claude is not reachable right now'}.`));
    } finally { scanning = false; }
  }

  function reviewMeal({ title, courses, wines, kinds }) {
    let useCourses = courses.length > 0 && !(v.courses || []).length;
    const picked = new Set(wines.map((_, i) => i));
    const s = sheet(h('div',
      h('h3.serif', { style: { fontSize: '24px', margin: '0 0 6px' } }, 'From your photos'),
      courses.length > 0 && h('div',
        h('label.check', h('input', { type: 'checkbox', checked: useCourses, onchange: (e) => { useCourses = e.target.checked; } }),
          `The menu: ${courses.length} courses${(v.courses || []).length ? ' (replaces the ones you have)' : ''}`),
        h('ol.course-list', courses.map((c) => h('li', h('b', c.dish), c.detail && h('small', c.detail))))),
      wines.length > 0 && h('div',
        h('p.hint', 'The wines — each gets its own wine page, linked to this evening:'),
        h('div.wine-picks', wines.map((w, i) => h('label.wine-pick',
          h('input', { type: 'checkbox', checked: true, onchange: (e) => { e.target.checked ? picked.add(i) : picked.delete(i); } }),
          w.photoRef ? h('span.wp-thumb', thumbFor(w.photoRef)) : '',
          h('span', h('b.serif', [w.name, w.vintage].filter(Boolean).join(' ')),
            h('small', [w.producer, w.grapes, w.region].filter(Boolean).join(' · '))))))),
      h('div.row-buttons',
        h('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: async (e) => {
          e.target.disabled = true;
          for (const p of v.photos) if (kinds.has(p.id) && (!p.kind || p.kind === 'photo')) p.kind = kinds.get(p.id);
          if (useCourses) {
            v.courses = courses.map((c) => ({ dish: c.dish.trim(), detail: (c.detail || '').trim() }));
            coursesInput.value = coursesToText(v.courses);
            if (title && !v.menu) { v.menu = title; menuInput.value = title; }
          }
          let n = 0;
          for (const i of picked) {
            const w = wines[i];
            const wid = await ensureByName('wines', w.name, {
              vintage: w.vintage ? String(w.vintage) : '', producer: w.producer, grapes: w.grapes, region: w.region,
              country: w.country, style: WINE_STYLES.includes(w.style) ? w.style : '',
              photo: w.photoRef && !newBlobs.has(w.photoRef.path) ? w.photoRef.path : '',
            });
            if (wid && w.photoRef) w.photoRef.wineId = wid;
            if (wid && !v.wineIds.includes(wid)) { v.wineIds.push(wid); n++; }
          }
          // A main photo that turned out to be the menu or a label: prefer a real photo.
          const cover = v.photos.find((x) => x.id === v.coverPhotoId);
          if (cover && cover.kind && cover.kind !== 'photo') v.coverPhotoId = v.photos.find((x) => !x.kind || x.kind === 'photo')?.id || v.coverPhotoId;
          s.close(); renderPhotos(); renderWines();
          scanBox.replaceChildren();
          toast(`${[useCourses && 'Menu added', n && `${n} wine page${n > 1 ? 's' : ''} created`].filter(Boolean).join(' · ') || 'Done'} — save the visit to keep it`);
        } }, 'Add to this evening'))));
  }

  function photoActions(p) {
    const s = sheet(h('div.photo-actions',
      h('div', { style: { maxHeight: '40vh', overflow: 'hidden', marginBottom: '8px' } }, thumbFor(p)),
      p.takenAt && h('p.hint', `Taken ${new Date(p.takenAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}${p.lat != null ? ' · has location' : ''}`),
      p.id !== v.coverPhotoId && h('button', { onclick: () => { v.coverPhotoId = p.id; renderPhotos(); s.close(); } }, icon('cover'), 'Make this the main photo'),
      p.kind !== 'menu' && h('button', { onclick: () => { p.kind = 'menu'; renderPhotos(); s.close(); offerRead(p); } }, icon('menu'), 'This is the menu'),
      p.kind !== 'winelist' && h('button', { onclick: () => { p.kind = 'winelist'; renderPhotos(); s.close(); offerRead(p); } }, icon('wine'), 'This is the wine list or pairing'),
      p.kind !== 'bottle' && claude.hasKey() && h('button', { onclick: () => { p.kind = 'bottle'; renderPhotos(); s.close(); scanPhotos({ auto: false }); } }, icon('wine'), 'This is a wine bottle or label'),
      p.kind && p.kind !== 'photo' && h('button', { onclick: () => { p.kind = 'photo'; renderPhotos(); s.close(); } }, icon('camera'), 'Just a photo of the evening'),
      p.kind === 'menu' && h('button', { onclick: () => { s.close(); readPhoto(p); } }, icon('sparkle'), 'Read the courses from this photo'),
      p.kind === 'winelist' && h('button', { onclick: () => { s.close(); readPhoto(p); } }, icon('sparkle'), 'Read the wines from this photo'),
      h('button', { style: { color: 'var(--burgundy)' }, onclick: () => {
        v.photos = v.photos.filter((x) => x.id !== p.id);
        newBlobs.delete(p.path); newBlobs.delete(p.thumb);
        if (origVisit.photos?.some((x) => x.id === p.id)) removedPhotoIds.add(p.id);
        if (v.coverPhotoId === p.id) v.coverPhotoId = v.photos.find((x) => !x.kind || x.kind === 'photo')?.id || v.photos[0]?.id;
        renderPhotos(); s.close();
      } }, icon('trash'), 'Remove photo'),
    ));
  }

  // ---------- reading menus and wine lists ----------
  async function blobOf(p) {
    if (newBlobs.has(p.path)) return newBlobs.get(p.path);
    return (await fetch(await store.photoURL(p.path))).blob();
  }

  function offerRead(p) {
    const what = p.kind === 'menu' ? 'courses' : 'wines';
    const already = p.kind === 'menu' ? (v.courses || []).length : v.wineIds.length;
    if (already) { toast(`Marked as ${PHOTO_KINDS[p.kind].toLowerCase()}`); return; }
    const s = sheet(h('div.confirm',
      h('h3.serif', p.kind === 'menu' ? 'Read the menu?' : 'Read the wine list?'),
      h('p.muted', claude.hasKey()
        ? `Claude can read the ${what} from the photo${p.kind === 'winelist' ? ' and give each wine its own page' : ''}. You check the result before anything is added.`
        : `Copy the text from the photo (in Photos, press and hold the text, then Copy) and paste it here${p.kind === 'winelist' ? ' — each wine then gets its own page' : ''}.`),
      h('div.row-buttons',
        h('button.btn.ghost', { onclick: () => s.close() }, 'Not now'),
        h('button.btn.primary', { onclick: () => { s.close(); readPhoto(p); } }, claude.hasKey() ? 'Read it' : 'Paste text'))));
  }

  async function readPhoto(p) {
    const isMenu = p.kind === 'menu';
    if (!claude.hasKey()) { pasteText(isMenu); return; }
    const body = h('div.research-wait', h('div.spinner'), h('h3.serif', 'Reading the photo…'), h('p.muted', 'This takes a few seconds.'));
    const s = sheet(body);
    try {
      const blob = await blobOf(p);
      if (isMenu) {
        const res = await claude.readMenu(blob);
        s.close();
        reviewCourses(res.courses || [], res.title);
      } else {
        const wines = await claude.readWineList(blob);
        s.close();
        reviewWines(wines);
      }
    } catch (e) {
      console.error(e);
      body.replaceChildren(h('h3.serif', 'Couldn’t read it'), h('p.muted', e.message || 'Claude is not reachable right now.'),
        h('button.btn.ghost.block', { onclick: () => { s.close(); pasteText(isMenu); } }, 'Paste the text instead'));
    }
  }

  function pasteText(isMenu) {
    const ta = h('textarea.textarea', { placeholder: isMenu ? 'Pompoen\nZoommeer paling, tsukudani, gember\n\nArtisjok\nansjovis, olijvencake…' : 'Inter-Val 2023\nChâteau de Bonnezeaux\nchenin blanc\nVallée de la Loire\n\nL’Iris 2023\n…', style: { minHeight: '220px' } });
    const s = sheet(h('div',
      h('h3.serif', { style: { fontSize: '24px', margin: '0 0 6px' } }, isMenu ? 'Paste the menu' : 'Paste the wine list'),
      h('p.hint', 'Leave an empty line between courses or wines.'),
      ta,
      h('div.row-buttons',
        h('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: () => {
          const t = ta.value.trim(); if (!t) return;
          s.close();
          if (isMenu) reviewCourses(parseMenuText(t)); else reviewWines(parseWineText(t));
        } }, 'Next'))));
    setTimeout(() => ta.focus(), 350);
  }

  function reviewCourses(courses, title) {
    if (!courses.length) { toast('No courses found'); return; }
    const s = sheet(h('div',
      h('h3.serif', { style: { fontSize: '24px', margin: '0 0 10px' } }, `${courses.length} courses`),
      h('ol.course-list', courses.map((c) => h('li', h('b', c.dish), c.detail && h('small', c.detail)))),
      h('div.row-buttons',
        h('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: () => {
          v.courses = courses.map((c) => ({ dish: (c.dish || '').trim(), detail: (c.detail || '').trim() })).filter((c) => c.dish);
          if (title && !v.menu) { v.menu = title; menuInput.value = title; }
          coursesInput.value = coursesToText(v.courses);
          s.close(); toast('Courses added — edit them under “The menu”');
        } }, 'Use these'))));
  }

  function reviewWines(wines) {
    wines = wines.filter((w) => (w.name || '').trim());
    if (!wines.length) { toast('No wines found'); return; }
    const picked = new Set(wines.map((_, i) => i));
    const s = sheet(h('div',
      h('h3.serif', { style: { fontSize: '24px', margin: '0 0 4px' } }, `${wines.length} wine${wines.length > 1 ? 's' : ''}`),
      h('p.hint', 'Each one gets its own wine page, linked to this evening.'),
      h('div.wine-picks', wines.map((w, i) => h('label.wine-pick',
        h('input', { type: 'checkbox', checked: true, onchange: (e) => { e.target.checked ? picked.add(i) : picked.delete(i); } }),
        h('span', h('b.serif', [w.name, w.vintage].filter(Boolean).join(' ')),
          h('small', [w.producer, w.grapes, w.region].filter(Boolean).join(' · ')))))),
      h('div.row-buttons',
        h('button.btn.ghost', { onclick: () => s.close() }, 'Cancel'),
        h('button.btn.primary', { onclick: async (e) => {
          e.target.disabled = true;
          for (const i of picked) {
            const w = wines[i];
            const wid = await ensureByName('wines', w.name, {
              vintage: w.vintage ? String(w.vintage) : '', producer: w.producer, grapes: w.grapes,
              region: w.region, country: w.country, style: WINE_STYLES.includes(w.style) ? w.style : '',
            });
            if (wid && !v.wineIds.includes(wid)) v.wineIds.push(wid);
          }
          s.close(); renderWines();
          toast(`${picked.size} wine page${picked.size === 1 ? '' : 's'} created — save the visit to keep the link`);
        } }, 'Add these wines'))));
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
  const winesBox = h('div');
  function renderWines() {
    const chips = v.wineIds.map((wid) => {
      const w = store.get('wines', wid);
      return { label: w ? [w.name, w.vintage].filter(Boolean).join(' ') : '…', remove: () => { v.wineIds = v.wineIds.filter((x) => x !== wid); } };
    });
    const wineIn = h('input.input', { placeholder: 'Add a wine…', autocomplete: 'off' });
    const ac = h('div');
    const add = async (fn) => { await fn(); renderWines(); winesBox.querySelector('input')?.focus(); };
    wineIn.addEventListener('input', () => {
      const q = wineIn.value.trim().toLowerCase();
      if (q.length < 2) { ac.replaceChildren(); return; }
      const m = store.list('wines').filter((w) => w.name.toLowerCase().includes(q) && !v.wineIds.includes(w.id)).slice(0, 5);
      const exact = m.some((w) => w.name.toLowerCase() === q);
      ac.replaceChildren(h('div.autocomplete',
        m.map((w) => h('button', { type: 'button', onclick: () => add(() => v.wineIds.push(w.id)) }, w.name, h('small', [w.vintage, w.producer].filter(Boolean).join(' · ')))),
        !exact && h('button', { type: 'button', onclick: () => add(async () => {
          const wid = await ensureByName('wines', wineIn.value.trim());
          if (wid && !v.wineIds.includes(wid)) v.wineIds.push(wid);
          toast('Wine page created');
        }) }, `Add “${wineIn.value.trim()}” as a new wine`)));
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
    // Typed the name of a restaurant we already have, without picking it from the suggestions? Use that one.
    if (!restaurantId) {
      const known = findExisting(r);
      if (known) {
        restaurantId = known.id;
        for (const f of REST_FIELDS) if ((r[f] == null || r[f] === '') && known[f] != null) r[f] = known[f];
        r.name = known.name;
      }
    }
    const rid = restaurantId || store.newId();
    const base = restaurantId ? (store.restaurant(restaurantId) || {}) : {};
    const rPatch = {};
    for (const f of REST_FIELDS) if (!same(r[f], base[f]) && !(r[f] === undefined && !restaurantId)) rPatch[f] = r[f];
    if (!restaurantId || Object.keys(rPatch).length) await store.save('restaurants', rid, rPatch);

    // Photos first, so they upload before the journal references them.
    for (const [path, blob] of newBlobs) await store.addPhotoBlob(path, blob);
    for (const pid of removedPhotoIds) await store.forgetPhoto(visitId, pid);
    // Bottle photos become the picture on their wine's page.
    for (const p of v.photos) {
      const w = p.wineId && store.get('wines', p.wineId);
      if (w && !w.photo) await store.save('wines', w.id, { photo: p.path });
    }

    v.restaurantId = rid;
    v.chef = (chefInput.value || '').trim() || undefined;
    v.chefId = v.chef ? await ensureByName('chefs', v.chef) : undefined;
    v.courses = textToCourses(coursesInput.value);
    if (!v.courses.length) v.courses = undefined;
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

  const menuInput = input(v.menu, (val) => { v.menu = val; }, { placeholder: 'e.g. Menu Prestige, 9 courses' });
  const coursesInput = h('textarea.textarea.short', { placeholder: 'One course per line:  Dish — details' });
  coursesInput.value = coursesToText(v.courses);
  const readBtn = (kind, label) => h('button.btn.small.ghost', { type: 'button', onclick: () => {
    const p = v.photos.find((x) => x.kind === kind);
    if (p) readPhoto(p);
    else if (claude.hasKey()) toast(`Add a photo of the ${kind === 'menu' ? 'menu' : 'wine list'} first, then tap it and mark it`);
    else pasteText(kind === 'menu');
  } }, icon('sparkle'), label);

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
    h('div.field', h('label', 'Address or GPS (if the map can’t find it)'),
      h('div.input-row', addrInput, h('button.btn.small.ghost', { type: 'button', onclick: locateAddress }, 'Locate'))),

    h('h3.section-title', 'The visit'),
    field('When', dateBox),
    field('Lunch or dinner', mealBox),
    field('Occasion', input(v.occasion, (val) => { v.occasion = val; }, { placeholder: 'Anniversary, a birthday, just because…' })),
    field('Stars at the time', starsBox),
    starsTodayBox,
    field('Gault&Millau at the time', input(v.gaultMillau, (val) => { v.gaultMillau = parseGM(val); },
      { inputmode: 'decimal', placeholder: 'Score out of 20, e.g. 16.5', style: { maxWidth: '220px' } }),
      'Leave empty if you don’t know.'),

    h('h3.section-title', 'The table'),
    h('div.field', { style: { position: 'relative' } }, h('label', 'Chef'), chefInput, chefAc),
    field('Menu', menuInput),
    h('div.field',
      h('div.label-row', h('label', 'The courses'), readBtn('menu', claude.hasKey() ? 'Read from photo' : 'Paste')),
      coursesInput),
    h('div.field',
      h('div.label-row', h('label', 'Wines we drank'), readBtn('winelist', claude.hasKey() ? 'Read wine list' : 'Paste list')),
      winesBox, h('p.hint', 'Each wine gets its own page under Memory lane as soon as you add it.')),
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

  if (editQuery === 'scan') setTimeout(() => scanPhotos({ auto: false }), 300);
  renderWines(); renderLocNote(); renderDate(); renderStars(); renderStarsToday(); renderRatings(); renderPhotos(); renderMeal();
  root.replaceChildren(page);
  window.scrollTo(0, 0);
}
