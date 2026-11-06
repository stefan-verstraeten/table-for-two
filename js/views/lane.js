import * as store from '../store.js';
import { h, icon, photo, stars, formatDate, countryFlag, STAR_SVG } from '../ui.js';
import { coverOf } from './home.js';
import { PEOPLE } from '../config.js';
import { allCourses } from '../ingredients.js';
import { highlightsOf } from './highlights.js';
import { azList } from './azlist.js';

export function renderLane(root) {
  const visits = store.visits();
  const restaurants = new Set(visits.map((v) => v.restaurantId));
  const chefs = store.list('chefs');
  const wines = store.list('wines');
  const wishes = store.list('wishes').filter((w) => !w.doneVisitId);

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
    h('div.eyebrow.lane-sub', 'Highlights'),
    h('nav.lane-list.hl-lanes', PEOPLE.map((p) => {
      const n = highlightsOf(p).length;
      return card(`#/highlights/${encodeURIComponent(p)}`, `${p}’s highlights`, n, n ? 'The extra special ones' : 'Nothing highlighted yet', 'star');
    })),
    h('div.eyebrow.lane-sub', 'The archive'),
    h('nav.lane-list',
      card('#/restaurants', 'Restaurants A–Z', restaurants.size, 'Every table, alphabetically', 'journal'),
      card('#/scores', 'Restaurants by score', restaurants.size, 'Michelin and Gault&Millau, highest first', 'podium'),
      card('#/chefs', 'Chefs', chefs.length, 'Who cooked for us', 'chef'),
      card('#/wines', 'Wines', wines.length, 'What we drank', 'wine'),
      card('#/dishes', 'Dishes', allCourses().length, 'Every course, every ingredient', 'menu'),
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

const ARTICLES = /^((le|la|les|de|het|il|el|the)\s+|l['’]\s*|['’]t\s+|t['’]\s*)/i;
export const sortName = (n) => (n || '').replace(ARTICLES, '').trim();

const v0chef = (vs) => vs.map((v) => (v.chefId && store.get('chefs', v.chefId)?.name) || v.chef).filter(Boolean).join(' ');

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
    rows.length ? azList('restaurants', [...groups].map(([k, list]) => ({
      id: k, jump: k, head: h('div.year-head', h('h2', k)),
      rows: list.map(({ r, vs }) => {
        const best = vs.map((v) => v.stars).filter((s) => s && s.kind !== 'none')
          .sort((a, b) => (b.kind === 'michelin') - (a.kind === 'michelin') || b.count - a.count)[0];
        return {
          text: [r.name, r.city, r.country, v0chef(vs)].join(' '),
          el: h('a.az-row', { href: `#/restaurant/${r.id}` },
            h('span', h('b.serif', r.name), h('small', [r.city, r.country].filter(Boolean).join(', '))),
            h('span.az-meta', stars(best), h('small', vs.length > 1 ? `${vs.length} visits` : formatDate(vs[0].date, { short: true })))),
        };
      }),
    })), { placeholder: 'Find a restaurant, town or country' }) : h('p.muted', 'No restaurants yet.'),
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

// ---------- ranking ----------
// One entry per restaurant per distinct score: a restaurant that had 1 star on
// one visit and 2 on the next appears twice, with the dates in brackets.
// Our own stars are left out; the other guide breaks ties.
let scoreView = 'michelin';
const STAR_WORDS = ['Not starred', 'One star', 'Two stars', 'Three stars'];

export function renderScores(root, which) {
  if (which === 'michelin' || which === 'gm') scoreView = which;
  const mich = (v) => (v.stars?.kind === 'michelin' ? v.stars.count || 0 : 0);
  const entries = new Map();
  for (const v of store.visits()) { // newest first
    const r = store.restaurant(v.restaurantId);
    if (!r) continue;
    const key = `${r.id}|${mich(v)}|${v.gaultMillau || 0}`;
    if (!entries.has(key)) entries.set(key, { r, stars: mich(v), uncertain: v.stars?.kind === 'michelin' && v.stars.uncertain, gm: v.gaultMillau || 0, visits: [] });
    entries.get(key).visits.push(v);
  }
  const list = [...entries.values()];
  const perRestaurant = new Map();
  for (const e of list) perRestaurant.set(e.r.id, (perRestaurant.get(e.r.id) || 0) + 1);
  const byName = (a, b) => sortName(a.r.name).localeCompare(sortName(b.r.name), 'en', { sensitivity: 'base' });
  const byDate = (a, b) => store.sortKey(b.visits[0]) - store.sortKey(a.visits[0]);

  const isMich = scoreView === 'michelin';
  const primary = (e) => (isMich ? e.stars : e.gm);
  const secondary = (e) => (isMich ? e.gm : e.stars);
  list.sort((a, b) => primary(b) - primary(a) || secondary(b) - secondary(a) || byName(a, b) || byDate(a, b));

  const groups = new Map();
  for (const e of list) {
    const k = primary(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const headOf = (k) => (isMich ? STAR_WORDS[k] || `${k} stars` : k ? `${k}/20` : 'No score known');

  const row = (e) => {
    const v = e.visits[0];
    const dates = perRestaurant.get(e.r.id) > 1 ? ` (${e.visits.map((x) => formatDate(x.date, { short: true })).join(', ')})` : '';
    const michEl = e.stars ? stars({ kind: 'michelin', count: e.stars, uncertain: e.uncertain }) : null;
    const gmEl = e.gm ? h('span.gm-pill', `${e.gm}/20`) : null;
    return h('a.az-row', { href: `#/visit/${v.id}` },
      h('span', h('b.serif', e.r.name, dates && h('span.score-dates', dates)),
        h('small', [e.r.city, e.r.country].filter(Boolean).join(', '))),
      h('span.az-meta', isMich ? [gmEl, michEl] : [michEl, gmEl]));
  };

  const seg = h('div.segmented', { style: { margin: '0 0 6px' } },
    [['michelin', 'Michelin'], ['gm', 'Gault&Millau']].map(([id, label]) =>
      h(`button${scoreView === id ? '.on' : ''}`, { onclick: () => { scoreView = id; renderScores(root); } }, label)));

  root.replaceChildren(h('div.page',
    backBar('#/lane', 'Memory lane'),
    h('h1.page-title', 'Restaurants by score'),
    seg,
    h('p.hint', isMich
      ? 'Stars on the evening we went. Gault&Millau breaks ties; our own stars don’t count.'
      : 'Gault&Millau score on the evening we went. Michelin stars break ties.'),
    list.length ? [...groups].map(([k, rows]) => h('section.az-group',
      h('div.year-head', h('h2', headOf(k)), h('small.muted', `${rows.length}`)),
      rows.map(row))) : h('p.muted', 'No restaurants yet.'),
  ));
  window.scrollTo(0, 0);
}
