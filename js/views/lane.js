import * as store from '../store.js';
import { h, icon, photo, stars, formatDate, countryFlag, STAR_SVG } from '../ui.js';
import { coverOf } from './home.js';
import { needsMyApproval } from './profiles.js';

export function renderLane(root) {
  const visits = store.visits();
  const restaurants = new Set(visits.map((v) => v.restaurantId));
  const chefs = store.list('chefs');
  const wines = store.list('wines');
  const wishes = store.list('wishes').filter((w) => !w.doneVisitId);
  const pendingChefs = chefs.filter(needsMyApproval).length;
  const pendingWines = wines.filter(needsMyApproval).length;

  const card = (href, title, count, sub, ic) => h('a.lane-card', { href },
    h('span.lane-icon', icon(ic)),
    h('span.lane-text', h('b', title), sub && h('small', sub)),
    h('span.lane-count', count));

  root.replaceChildren(h('div.page.lane',
    h('div.lane-head',
      h('div.watermark', { html: STAR_SVG, 'aria-hidden': 'true' }),
      h('div.eyebrow', 'Table for Two'),
      h('h1', 'A trip down memory lane'),
    ),
    visits.length > 0 && h('a.random-card', { href: '#/random' },
      h('span.eyebrow', 'Surprise us'),
      h('span.serif', 'A random memory'),
      icon('sparkle')),
    h('nav.lane-list',
      card('#/restaurants', 'Restaurants A–Z', restaurants.size, 'Every table, alphabetically', 'journal'),
      card('#/chefs', 'Chefs', chefs.length, pendingChefs ? `${pendingChefs} bio${pendingChefs > 1 ? 's' : ''} waiting for you` : 'Who cooked for us', 'chef'),
      card('#/wines', 'Wines', wines.length, pendingWines ? `${pendingWines} profile${pendingWines > 1 ? 's' : ''} waiting for you` : 'What we drank', 'wine'),
      card('#/wishes', 'Wish list', wishes.length, 'Tables still to come', 'heart'),
      card('#/map', 'The map', countries(), 'Our gastronomic journey', 'map'),
    ),
  ));
}

function countries() {
  return new Set(store.visits().map((v) => store.restaurant(v.restaurantId)?.country).filter(Boolean)).size;
}

export function goRandom() {
  const vs = store.visits();
  if (!vs.length) { location.replace('#/lane'); return; }
  const v = vs[Math.floor(Math.random() * vs.length)];
  location.replace(`#/visit/${v.id}`);
}

const ARTICLES = /^(le|la|les|l'|de|het|'t|t'|il|el|the)\s*/i;
export const sortName = (n) => (n || '').replace(ARTICLES, '').trim();

export function renderRestaurants(root) {
  const byId = new Map();
  for (const v of store.visits()) {
    if (!byId.has(v.restaurantId)) byId.set(v.restaurantId, []);
    byId.get(v.restaurantId).push(v);
  }
  const rows = [...byId].map(([id, vs]) => ({ r: store.restaurant(id), vs }))
    .filter((x) => x.r)
    .sort((a, b) => sortName(a.r.name).localeCompare(sortName(b.r.name), 'en', { sensitivity: 'base' }));

  const groups = new Map();
  for (const row of rows) {
    const letter = sortName(row.r.name)[0]?.toUpperCase() || '#';
    const key = /[A-Z]/.test(letter) ? letter : '#';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  root.replaceChildren(h('div.page',
    backBar('#/lane', 'Memory lane'),
    h('h1.page-title', 'Restaurants A–Z'),
    groups.size > 1 && h('div.az-jump', [...groups.keys()].map((k) => h('a', { href: `#az-${k}`, onclick: (e) => {
      e.preventDefault(); document.getElementById(`az-${k}`)?.scrollIntoView({ behavior: 'smooth' });
    } }, k))),
    rows.length ? [...groups].map(([k, list]) => h('section.az-group', { id: `az-${k}` },
      h('div.year-head', h('h2', k)),
      list.map(({ r, vs }) => {
        const best = vs.map((v) => v.stars).filter((s) => s && s.kind !== 'none')
          .sort((a, b) => (b.kind === 'michelin') - (a.kind === 'michelin') || b.count - a.count)[0];
        return h('a.az-row', { href: `#/restaurant/${r.id}` },
          h('span', h('b.serif', r.name), h('small', [r.city, r.country].filter(Boolean).join(', '))),
          h('span.az-meta', stars(best), h('small', vs.length > 1 ? `${vs.length} visits` : formatDate(vs[0].date, { short: true }))));
      }),
    )) : h('p.muted', 'No restaurants yet.'),
  ));
}

export function renderRestaurant(root, id) {
  const r = store.restaurant(id);
  if (!r) { root.replaceChildren(h('div.page', backBar('#/restaurants', 'Restaurants'), h('p.muted', 'Not found.'))); return; }
  const vs = store.visitsOf(id);
  const chefs = [...new Set(vs.map((v) => v.chefId).filter(Boolean))].map((cid) => store.get('chefs', cid)).filter(Boolean);
  root.replaceChildren(h('div.page',
    backBar('#/restaurants', 'Restaurants'),
    h('div.visit-head', { style: { padding: '10px 0 0' } },
      h('h1', r.name),
      h('div.place', [r.city, r.country].filter(Boolean).join(', '), r.countryCode ? ' ' + countryFlag(r.countryCode) : ''),
      r.currentStars != null && h('div.now-stars', r.currentStars ? `Today: ${r.currentStars} Michelin star${r.currentStars > 1 ? 's' : ''}` : 'Not starred today'),
    ),
    chefs.length > 0 && h('p', { style: { textAlign: 'center', marginTop: '14px' } },
      chefs.map((c, i) => [i ? ', ' : '', h('a.link', { href: `#/chef/${c.id}` }, c.name)])),
    h('h3.section-title', vs.length > 1 ? `Our ${vs.length} evenings here` : 'Our evening here'),
    vs.map((v) => {
      const cover = coverOf(v);
      return h('a.entry', { href: `#/visit/${v.id}` },
        h('div', h('h3', formatDate(v.date)), h('div.meta', v.occasion || ''), h('div.date', stars(v.stars))),
        cover ? h('div.thumb', photo(cover.thumb || cover.path)) : h('div.thumb.none', { html: STAR_SVG }));
    }),
    h('a.btn.ghost.block', { href: `#/new/r:${r.id}`, style: { marginTop: '24px' } }, icon('plus'), 'Add another evening here'),
  ));
}

export function backBar(href, label) {
  return h('div.topbar', h('a.text-btn.back-link', { href }, '‹ ', label));
}
