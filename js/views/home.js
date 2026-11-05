import * as store from '../store.js';
import { h, photo, formatDate, stars, yearOf, icon, STAR_SVG } from '../ui.js';

function coverOf(v) {
  const ps = v.photos || [];
  return ps.find((p) => p.id === v.coverPhotoId) || ps.find((p) => !p.kind || p.kind === 'photo') || ps[0] || null;
}
export { coverOf };

export function renderHome(root) {
  const visits = store.visits();
  const restIds = new Set(visits.map((v) => v.restaurantId));
  const countries = new Set(visits.map((v) => store.restaurant(v.restaurantId)?.country).filter(Boolean));
  // Each restaurant counts once, with the most Michelin stars it had on any of our visits.
  const bestStars = new Map();
  for (const v of visits) {
    if (v.stars?.kind !== 'michelin') continue;
    bestStars.set(v.restaurantId, Math.max(bestStars.get(v.restaurantId) || 0, v.stars.count || 0));
  }
  const michelinStars = [...bestStars.values()].reduce((a, b) => a + b, 0);

  const heroVisit = visits.find((v) => coverOf(v));
  const heroPhoto = heroVisit && coverOf(heroVisit);
  const hero = h(`div.hero${heroPhoto ? '' : '.empty'}`,
    heroPhoto && photo(heroPhoto.path, { alt: '' }),
    h('div.hero-title', h('div.eyebrow', 'Table for Two')),
  );
  if (heroVisit) {
    hero.style.cursor = 'pointer';
    hero.addEventListener('click', () => (location.hash = `#/visit/${heroVisit.id}`));
  }

  const status = store.getStatus();
  const page = h('div.page.flush',
    hero,
    h('div.masthead',
      h('div.watermark', { html: STAR_SVG.repeat(3), 'aria-hidden': 'true' }),
      h('h1', 'Gastronomical Memories'),
      h('div.eyebrow', 'Simply lovely'),
      visits.length > 0 && h('div.tally',
        h('div', h('b', restIds.size), h('span', restIds.size === 1 ? 'Restaurant' : 'Restaurants')),
        h('div', h('b', michelinStars), h('span', 'Stars')),
        h('div', h('b', countries.size), h('span', countries.size === 1 ? 'Country' : 'Countries')),
      ),
      h('div', { style: { marginTop: '10px' } }, syncPill(status)),
    ),
    h('div', { style: { padding: '0 22px' } }, visits.length ? timeline(visits) : emptyState()),
  );
  root.replaceChildren(page);
}

export function syncPill(s) {
  const text = {
    idle: s.lastSyncAt ? 'In sync' : 'Ready',
    syncing: 'Syncing…',
    offline: s.pending ? `Offline · ${s.pending} to sync` : 'Offline',
    local: 'On this phone only',
    error: 'Sync problem',
  }[s.state] || '';
  return h(`a.sync-pill.${s.state}`, { href: '#/settings', style: { textDecoration: 'none' } }, text);
}

function emptyState() {
  return h('div.empty-state',
    h('p', 'Every great table begins with a first evening.'),
    h('a.btn.accent', { href: '#/new' }, icon('plus'), 'Add your first visit'),
  );
}

function timeline(visits) {
  const groups = new Map();
  for (const v of visits) {
    const y = yearOf(v);
    const key = y ? String(y) : 'Undated';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  return [...groups].map(([year, list]) => h('section.year-group',
    h('div.year-head', h('h2', year)),
    list.map(entry),
  ));
}

function entry(v) {
  const r = store.restaurant(v.restaurantId);
  const cover = coverOf(v);
  return h('a.entry', { href: `#/visit/${v.id}` },
    h('div',
      h('h3', r.name),
      h('div.meta', [r.city, r.country].filter(Boolean).join(', ')),
      h('div.date', formatDate(v.date, { short: true }), stars(v.stars)),
    ),
    cover ? h('div.thumb', photo(cover.thumb || cover.path)) : h('div.thumb.none', { html: STAR_SVG }),
  );
}
