// Reads metadata from photos (date taken, GPS, camera) and produces resized
// JPEGs for storage. Uses exifr (vendor/exifr.umd.js, loaded globally).

import { PHOTO_MAX, THUMB_MAX } from './config.js';
import { newId } from './store.js';

const pad = (n) => String(n).padStart(2, '0');

// Wall-clock time as written by the camera, e.g. "2019-03-14T20:15".
function localStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function readMetadata(file) {
  const out = { takenAt: null, lat: null, lon: null, camera: null, source: null };
  try {
    const tags = await window.exifr.parse(file, {
      tiff: true, exif: true, gps: true, ifd1: false, xmp: true, icc: false, iptc: false,
      pick: ['DateTimeOriginal', 'CreateDate', 'DateCreated', 'ModifyDate', 'Make', 'Model',
        'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef', 'latitude', 'longitude'],
    });
    if (tags) {
      const when = tags.DateTimeOriginal || tags.CreateDate || tags.DateCreated;
      if (when instanceof Date && !isNaN(when)) { out.takenAt = localStamp(when); out.source = 'exif'; }
      if (typeof tags.latitude === 'number' && typeof tags.longitude === 'number'
          && !(tags.latitude === 0 && tags.longitude === 0)) {
        out.lat = +tags.latitude.toFixed(6);
        out.lon = +tags.longitude.toFixed(6);
      }
      if (tags.Make || tags.Model) out.camera = [tags.Make, tags.Model].filter(Boolean).join(' ');
    }
  } catch (e) {
    console.warn('No readable metadata in', file.name, e);
  }
  return out;
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function resize(source, max, quality) {
  const w0 = source.width, h0 = source.height;
  const scale = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve({ blob: b, w, h }) : reject(new Error('Could not encode image'))), 'image/jpeg', quality);
  });
}

// Returns { photo, blob, thumbBlob } where photo is the record stored in the journal.
export async function processFile(file, visitId) {
  const metaP = readMetadata(file);
  const bitmap = await decode(file);
  const full = await resize(bitmap, PHOTO_MAX, 0.86);
  const thumb = await resize(bitmap, THUMB_MAX, 0.8);
  if (bitmap.close) bitmap.close();
  const meta = await metaP;
  const id = newId();
  const photo = {
    id,
    path: `photos/${visitId}/${id}.jpg`,
    thumb: `photos/${visitId}/${id}_t.jpg`,
    w: full.w, h: full.h,
    takenAt: meta.takenAt,
    lat: meta.lat, lon: meta.lon,
    camera: meta.camera,
    originalName: file.name,
    kind: 'photo',
  };
  return { photo, blob: full.blob, thumbBlob: thumb.blob };
}

// Summarise what a batch of photos tells us about the visit.
export function summarise(photos) {
  const dated = photos.filter((p) => p.takenAt).map((p) => p.takenAt).sort();
  const located = photos.filter((p) => p.lat != null);
  const days = [...new Set(dated.map((d) => d.slice(0, 10)))];
  let lat = null, lon = null;
  if (located.length) {
    lat = located.reduce((s, p) => s + p.lat, 0) / located.length;
    lon = located.reduce((s, p) => s + p.lon, 0) / located.length;
  }
  return {
    first: dated[0] || null,
    days,
    sameDay: days.length === 1,
    lat, lon,
    countDated: dated.length,
    countLocated: located.length,
    total: photos.length,
  };
}
