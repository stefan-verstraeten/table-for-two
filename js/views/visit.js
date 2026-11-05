import * as store from '../store.js';
import { h, photo, formatDate, stars, icon, ratingLabel, countryFlag } from '../ui.js';
import { PEOPLE } from '../config.js';
import { coverOf } from './home.js';

export function renderVisit(root, id) {
  const v = store.visit(id);
  if (!v) { root.replaceChildren(h('div.page', h('p.muted', 'This visit could not be found.'), h('a.btn.ghost', { href: '#/' }, 'Back'))); return; }
  const r = store.restaurant(v.restaurantId);
  const cover = coverOf(v);
  const photos = (v.photos || []).filter((p) => p.kind !== 'menu');
  const menus = (v.photos || []).filter((p) => p.kind === 'menu');

  const facts = [
    ['Meal', v.meal && v.meal[0].toUpperCase() + v.meal.slice(1)],
    ['Chef', v.chefId && store.get('chefs', v.chefId)
      ? h('a.link', { href: `#/chef/${v.chefId}` }, store.get('chefs', v.chefId).name)
      : v.chef || r.chef],
    ['Menu', v.menu],
    ['Wines', (v.wineIds || []).map((id) => store.get('wines', id)).filter(Boolean).length
      ? h('span', (v.wineIds || []).map((id) => store.get('wines', id)).filter(Boolean)
          .map((w, i) => [i ? h('br') : '', h('a.link', { href: `#/wine/${w.id}` }, w.name)]))
      : null],
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
    cover ? h('div.visit-hero', { onclick: () => lightbox(cover) }, photo(cover.path)) : h('div.visit-hero.none'),

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

      photos.length > (cover && cover.kind !== 'menu' ? 1 : 0) && h('div.gallery',
        photos.filter((p) => p !== cover).map((p) => h('button', { onclick: () => lightbox(p) }, photo(p.thumb || p.path)))),

      menus.length > 0 && h('div.menu-souvenir',
        h('h3.section-title', 'The menu'),
        menus.map((p) => h('button', { onclick: () => lightbox(p), style: { display: 'block', width: '100%', marginBottom: '14px' } }, photo(p.path)))),

      others.length > 0 && h('div.other-visits',
        h('h3.section-title', `Other evenings at ${r.name}`),
        others.map((o) => h('a', { href: `#/visit/${o.id}` }, h('span.serif', { style: { fontSize: '19px' } }, formatDate(o.date)), stars(o.stars)))),
    ),
  );
  root.replaceChildren(page);
  window.scrollTo(0, 0);
}

function lightbox(p) {
  const img = photo(p.path);
  const box = h('div.lightbox', { onclick: () => box.remove() }, img,
    p.takenAt && h('div.cap', new Date(p.takenAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })));
  document.body.append(box);
}
