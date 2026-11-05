import * as store from '../store.js';
import { h, formatDate, countryFlag } from '../ui.js';

let map = null;
let filter = 'all';

export function teardownMap() {
  if (map) { map.remove(); map = null; }
}

export function renderMap(root) {
  teardownMap();
  const L = window.L;

  // One marker per restaurant, coloured by the best stars across its visits.
  const byRestaurant = new Map();
  for (const v of store.visits()) {
    const r = store.restaurant(v.restaurantId);
    if (!r) continue;
    if (!byRestaurant.has(r.id)) byRestaurant.set(r.id, { r, visits: [] });
    byRestaurant.get(r.id).visits.push(v);
  }
  const all = [...byRestaurant.values()].map((e) => {
    const mich = e.visits.filter((v) => v.stars?.kind === 'michelin');
    const own = e.visits.filter((v) => v.stars?.kind === 'own');
    e.kind = mich.length ? 'michelin' : own.length ? 'own' : 'none';
    e.count = Math.max(0, ...(mich.length ? mich : own).map((v) => v.stars.count || 0));
    return e;
  });
  const shown = all.filter((e) => filter === 'all' || e.kind === filter);
  const located = shown.filter((e) => e.r.lat != null);

  const countries = new Map();
  for (const e of shown) {
    const key = e.r.country || 'Unknown';
    if (!countries.has(key)) countries.set(key, { code: e.r.countryCode, items: [] });
    countries.get(key).items.push(e);
  }

  const mapEl = h('div#map');
  const chips = h('div.segmented',
    [['all', 'All'], ['michelin', 'Michelin'], ['own', 'Our own']].map(([id, label]) =>
      h(`button${filter === id ? '.on' : ''}`, { onclick: () => { filter = id; renderMap(root); } }, label)));

  const page = h('div.map-page',
    h('div.map-head', h('h1', 'Our Gastronomic Journey'), chips),
    mapEl,
    h('div.map-countries',
      [...countries].sort((a, b) => b[1].items.length - a[1].items.length).map(([name, c]) =>
        h('button', { onclick: () => fit(c.items) },
          h('span', countryFlag(c.code), ' ', name),
          h('span', `${c.items.length} ${c.items.length === 1 ? 'restaurant' : 'restaurants'}`))),
      shown.length > located.length && h('p.hint', `${shown.length - located.length} not on the map yet — open them and tap “Find on map”.`),
    ),
  );
  root.replaceChildren(page);

  if (!L) { mapEl.append(h('p.muted', { style: { padding: '20px' } }, 'The map could not load.')); return; }

  map = L.map(mapEl, { zoomControl: false, attributionControl: true, worldCopyJump: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);

  const styles = {
    michelin: { color: '#fff', weight: 1.5, fillColor: '#BD1F2D', fillOpacity: 1 },
    own: { color: '#fff', weight: 1.5, fillColor: '#A39A8E', fillOpacity: 1 },
    none: { color: '#fff', weight: 1.5, fillColor: '#888C80', fillOpacity: 1 },
  };
  for (const e of located) {
    const last = e.visits[0];
    const pop = h('div.map-pop',
      h('a', { href: `#/visit/${last.id}` },
        h('b', e.r.name),
        h('small', [e.r.city, e.r.country].filter(Boolean).join(', ')),
        h('small', { style: { display: 'block', marginTop: '4px' } },
          e.visits.length > 1 ? `${e.visits.length} visits · last ${formatDate(last.date, { short: true })}` : formatDate(last.date, { short: true }))));
    L.circleMarker([e.r.lat, e.r.lon], { radius: 5 + e.count * 1.5, ...styles[e.kind] }).bindPopup(pop).addTo(map);
  }

  function fit(items) {
    const pts = items.filter((e) => e.r.lat != null).map((e) => [e.r.lat, e.r.lon]);
    if (!pts.length) return;
    if (pts.length === 1) map.setView(pts[0], 12);
    else map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 });
  }

  if (located.length) fit(located);
  else map.setView([48.5, 6], 4);
  setTimeout(() => map && map.invalidateSize(), 50);
}
