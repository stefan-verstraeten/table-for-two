// Housekeeping that runs after each sync: one restaurant record per restaurant.
// A second "Boury" can appear when a new visit is typed without picking the
// existing restaurant from the suggestions; its visits move to the original.

import * as store from './store.js';
import { distanceKm } from './places.js';
import { countryCode } from './countries.js';

export const normName = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/^(restaurant|ristorante|chez)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Is b the same restaurant as a? Same name, and not clearly somewhere else.
export function sameRestaurant(a, b) {
  if (!a || !b || normName(a.name) !== normName(b.name)) return false;
  if (a.lat != null && b.lat != null) return distanceKm(a, b) < 2;
  if (a.city && b.city) return normName(a.city) === normName(b.city);
  return true;
}

export function findExisting(r, exceptId) {
  return store.restaurants().find((x) => x.id !== exceptId && sameRestaurant(x, r)) || null;
}

const FIELDS = ['city', 'country', 'countryCode', 'lat', 'lon', 'currentStars', 'address'];

export async function mergeDuplicateRestaurants() {
  const all = store.restaurants().sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const gone = new Set();
  for (const keep of all) {
    if (gone.has(keep.id)) continue;
    for (const dup of all) {
      if (dup === keep || gone.has(dup.id) || !sameRestaurant(keep, dup)) continue;
      const fill = {};
      for (const f of FIELDS) if (keep[f] == null && dup[f] != null && dup[f] !== '') fill[f] = dup[f];
      if (fill.lat != null && fill.lon == null) delete fill.lat;
      if (Object.keys(fill).length) await store.save('restaurants', keep.id, fill);
      for (const v of store.visitsOf(dup.id)) await store.save('visits', v.id, { restaurantId: keep.id });
      for (const w of store.list('wishes').filter((x) => x.restaurantId === dup.id)) await store.save('wishes', w.id, { restaurantId: keep.id });
      await store.remove('restaurants', dup.id);
      gone.add(dup.id);
    }
  }
  return gone.size;
}

// Restaurants saved without a country code (typed by hand) get one from the name.
export async function fillCountryCodes() {
  for (const r of store.restaurants()) {
    if (r.country && !r.countryCode) {
      const code = countryCode(r.country);
      if (code) await store.save('restaurants', r.id, { countryCode: code });
    }
  }
}
