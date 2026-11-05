import * as store from '../store.js';
import { h, photo, formatDate, stars, icon, ratingLabel, countryFlag, toast } from '../ui.js';
import { PEOPLE } from '../config.js';
import { coverOf } from './home.js';

export function renderVisit(root, id) {
  const v = store.visit(id);
  if (!v) { root.replaceChildren(h('div.page', h('p.muted', 'This visit could not be found.'), h('a.btn.ghost', { href: '#/' }, 'Back'))); return; }
  const r = store.restaurant(v.restaurantId);
  const cover = coverOf(v);
  const photos = (v.photos || []).filter((p) => !p.kind || p.kind === 'photo' || p.kind === 'bottle');
  const menus = (v.photos || []).filter((p) => p.kind === 'menu');
  const wineLists = (v.photos || []).filter((p) => p.kind === 'winelist');
  const wines = (v.wineIds || []).map((wid) => store.get('wines', wid)).filter(Boolean);
  // The evening's photos, main photo first, for the swipeable header.
  const slides = photos.includes(cover) ? [cover, ...photos.filter((p) => p !== cover)] : photos;

  const facts = [
    ['Meal', v.meal && v.meal[0].toUpperCase() + v.meal.slice(1)],
    ['Chef', v.chefId && store.get('chefs', v.chefId)
      ? h('a.link', { href: `#/chef/${v.chefId}` }, store.get('chefs', v.chefId).name)
      : v.chef || r.chef],
    ['Menu', v.menu],
    ['Wine notes', v.wine],
    ['With', v.companions],
    ['Remembered dish', v.memorableDish],
  ].filter(([, val]) => val);

  const today = r.currentStars;
  const showToday = v.stars?.kind === 'michelin' && today != null && today !== v.stars.count;
  const others = store.visitsOf(r.id).filter((o) => o.id !== v.id);

  const page = h('div.page.flush',
    h('a.float-btn.left', { href: '#/', 'aria-label': 'Back' }, icon('back')),
    h('a.float-btn.right', { href: `#/edit/${v.id}`, 'aria-label': 'Edit' }, icon('edit')),
    slides.length ? carousel(slides, v) : cover ? h('div.visit-hero', { onclick: () => lightbox([cover], 0, v) }, photo(cover.path)) : h('div.visit-hero.none'),

    h('div.visit-head',
      v.stars?.kind && v.stars.kind !== 'none' ? h('div', stars(v.stars, { withLabel: true }) ) : null,
      h('h1', h('a', { href: `#/restaurant/${r.id}`, style: { textDecoration: 'none' } }, r.name)),
      h('div.place', [r.city, r.country].filter(Boolean).join(', '), r.countryCode ? ' ' + countryFlag(r.countryCode) : ''),
      h('div.when', formatDate(v.date)),
      v.occasion && h('div.occasion', v.occasion),
      showToday && h('div.now-stars', today === 0 ? 'No longer starred today' : `Today: ${today} Michelin star${today > 1 ? 's' : ''}`),
    ),

    h('div.ornament', '· · ·'),

    h('div.visit-body',
      v.memories
        ? [h('p.memories-block', v.memories), h('div.byline', `Last written by ${v.memoriesBy || v.updatedBy || '—'}`)]
        : h('p.muted', { style: { textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '19px' } },
            h('a', { href: `#/edit/${v.id}` }, 'Write down what you remember of this evening…')),

      h('div.ratings', PEOPLE.map((p) => h('div.r',
        h('div.who-name', p),
        h(`div.verdict${v.ratings?.[p] ? '' : '.none'}`, ratingLabel(v.ratings?.[p]) || '—'),
      ))),

      facts.length > 0 && h('dl.facts', facts.map(([k, val]) => h('div', h('dt', k), h('dd', val)))),


      !(v.courses?.length) && !wines.length && (v.photos || []).length > 0 && h('a.btn.small.ghost.find-meal', { href: `#/edit/${v.id}?scan` },
        icon('sparkle'), 'Find the menu and wines in these photos'),

      (menus.length > 0 || v.courses?.length > 0) && h('div.menu-souvenir',
        h('h3.section-title', 'The menu'),
        v.courses?.length > 0 && h('ol.menu-card', v.courses.map((c) => h('li', h('span.dish', c.dish), c.detail && h('span.detail', c.detail)))),
        menus.length > 0 && h('div.souvenir-thumbs', menus.map((p, i) => h('button', { onclick: () => lightbox(menus, i, v) }, photo(p.thumb || p.path))))),

      (wines.length > 0 || wineLists.length > 0) && h('div.menu-souvenir',
        h('h3.section-title', 'In our glasses'),
        wines.length > 0 && h('ol.menu-card.wines', wines.map((w) => h('li', h('a', { href: `#/wine/${w.id}` },
          h('span.dish', [w.name, w.vintage].filter(Boolean).join(' ')),
          h('span.detail', [w.producer, w.grapes, w.region].filter(Boolean).join(' · ')))))),
        wineLists.length > 0 && h('div.souvenir-thumbs', wineLists.map((p, i) => h('button', { onclick: () => lightbox(wineLists, i, v) }, photo(p.thumb || p.path))))),

      others.length > 0 && h('div.other-visits',
        h('h3.section-title', `Other evenings at ${r.name}`),
        others.map((o) => h('a', { href: `#/visit/${o.id}` }, h('span.serif', { style: { fontSize: '19px' } }, formatDate(o.date)), stars(o.stars)))),
    ),
  );
  root.replaceChildren(page);
  window.scrollTo(0, 0);
}

function carousel(slides, v) {
  const counter = h('div.carousel-count', `1 / ${slides.length}`);
  // Slides start as thumbnails; the full photo loads when a slide comes near.
  const upgraded = new Set();
  const els = slides.map((p, i) => h('div.carousel-slide', { onclick: () => lightbox(slides, i, v) },
    photo(i === 0 ? p.path : (p.thumb || p.path))));
  const upgrade = (i) => {
    const p = slides[i];
    if (!p || i === 0 || upgraded.has(i) || !p.thumb) return;
    upgraded.add(i);
    const full = photo(p.path);
    full.addEventListener('load', () => els[i].replaceChildren(full), { once: true });
  };
  const track = h('div.carousel-track', els);
  track.addEventListener('scroll', () => {
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    counter.textContent = `${i + 1} / ${slides.length}`;
    upgrade(i); upgrade(i + 1);
  }, { passive: true });
  setTimeout(() => upgrade(1), 600);
  return h('div.visit-hero.carousel', track, slides.length > 1 && counter);
}

// Full-screen photos, swipeable, with the option to make one the main photo.
function lightbox(list, start, v) {
  const track = h('div.lb-track', list.map((p) => h('div.lb-slide', photo(p.path))));
  const cap = h('div.cap');
  const count = h('div.lb-count');
  const mainBtn = h('button.lb-main', { onclick: async (e) => {
    e.stopPropagation();
    const p = list[current()];
    await store.save('visits', v.id, { coverPhotoId: p.id });
    toast('Main photo changed'); update();
  } }, icon('cover'), 'Make this the main photo');
  const current = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const update = () => {
    const p = list[current()];
    if (!p) return;
    cap.textContent = p.takenAt ? new Date(p.takenAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }) : '';
    count.textContent = list.length > 1 ? `${current() + 1} / ${list.length}` : '';
    const isMain = store.visit(v.id)?.coverPhotoId === p.id;
    mainBtn.style.visibility = isMain || (p.kind && p.kind !== 'photo' && p.kind !== 'bottle') ? 'hidden' : 'visible';
  };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') track.scrollBy({ left: track.clientWidth, behavior: 'smooth' });
    if (e.key === 'ArrowLeft') track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' });
  };
  const box = h('div.lightbox.lb-carousel',
    track,
    h('button.lb-close', { 'aria-label': 'Close', onclick: close }, icon('close')),
    count, cap, mainBtn);
  track.addEventListener('scroll', update, { passive: true });
  track.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(box);
  const place = () => { track.scrollLeft = start * track.clientWidth; update(); };
  place();
  requestAnimationFrame(place);
}
