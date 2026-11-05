// Place lookups using free OpenStreetMap-based services (Photon + Nominatim).

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export function distanceKm(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000 / 10) * 10} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function withTimeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

const PHOTON = 'https://photon.komoot.io';
const PLACE_TAGS = ['amenity:restaurant', 'amenity:cafe', 'amenity:bar', 'amenity:pub',
  'tourism:hotel', 'tourism:guest_house', 'tourism:chalet', 'tourism:resort'];

// Restaurants (and hotels, which often house starred restaurants) near a point.
export async function nearby(lat, lon, radiusKm = 0.25) {
  const here = { lat, lon };
  let results = [];
  try {
    const tags = PLACE_TAGS.map((t) => `&osm_tag=${t}`).join('');
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=12&radius=${radiusKm}&lang=en${tags}`,
      { signal: withTimeout(10000) });
    if (!res.ok) throw new Error('photon ' + res.status);
    const json = await res.json();
    results = json.features.map((f) => {
      const p = f.properties || {};
      const [plon, plat] = f.geometry.coordinates;
      return {
        name: p.name, kind: p.osm_value, lat: plat, lon: plon,
        city: p.city || p.town || p.village || p.district || p.county || '',
        country: p.country || '', countryCode: (p.countrycode || '').toUpperCase(),
        distanceKm: distanceKm(here, { lat: plat, lon: plon }),
      };
    });
  } catch (e) {
    // Fallback: Nominatim, restaurants inside a small box around the point.
    const d = radiusKm / 111;
    const box = [lon - d * 1.6, lat + d, lon + d * 1.6, lat - d].join(',');
    const res = await fetch(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=10&accept-language=en&bounded=1&viewbox=${box}&q=restaurant`,
      { signal: withTimeout(10000) });
    if (!res.ok) throw e;
    results = (await res.json()).map((j) => ({
      name: j.name, kind: j.type, lat: +j.lat, lon: +j.lon,
      city: pickCity(j.address), country: j.address?.country || '',
      countryCode: (j.address?.country_code || '').toUpperCase(),
      distanceKm: distanceKm(here, { lat: +j.lat, lon: +j.lon }),
    }));
  }
  const seen = new Set();
  results = results
    .filter((r) => r.name && !seen.has(r.name) && seen.add(r.name))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  if (!results.length && radiusKm < 1) return nearby(lat, lon, radiusKm * 3);
  return results.slice(0, 8);
}

function pickCity(a = {}) {
  return a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.county || a.state || '';
}

export async function reverse(lat, lon) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Reverse lookup failed');
  const j = await res.json();
  return {
    city: pickCity(j.address),
    country: j.address?.country || '',
    countryCode: (j.address?.country_code || '').toUpperCase(),
  };
}

// Free-text search, used to locate past restaurants that have no photo GPS.
export async function search(query) {
  const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=6&accept-language=en&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Search failed');
  const list = await res.json();
  return list.map((j) => ({
    name: j.name || j.display_name.split(',')[0],
    label: j.display_name,
    lat: +j.lat, lon: +j.lon,
    city: pickCity(j.address),
    country: j.address?.country || '',
    countryCode: (j.address?.country_code || '').toUpperCase(),
    kind: j.type,
  }));
}
