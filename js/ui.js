import { photoURL } from './store.js';
import { RATINGS } from './config.js';

// h('div.class#id', {attrs}, ...children)
export function h(tag, attrs, ...children) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = {};
  }
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const part of rest) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
export const monthName = (m) => MONTHS[m - 1];

export function formatDate(date, { short = false } = {}) {
  const d = date || {};
  const mon = (m) => (short ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]);
  switch (d.precision) {
    case 'day': return d.y && d.m && d.d ? `${d.d} ${mon(d.m)} ${d.y}` : d.y ? String(d.y) : 'Date unknown';
    case 'month': return d.y && d.m ? `${mon(d.m)} ${d.y}` : d.y ? String(d.y) : 'Date unknown';
    case 'year': return d.y ? String(d.y) : 'Date unknown';
    case 'circa': return d.y ? `Around ${d.y}` : 'Date unknown';
    default: return 'Date unknown';
  }
}

export function yearOf(v) {
  return v.date?.precision !== 'unknown' && v.date?.y ? v.date.y : null;
}

// The star symbol itself is defined once in index.html (<symbol id="mstar">).
export const STAR_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#mstar"/></svg>';
export const STAR_PATH = document.getElementById('mstar')?.querySelector('path')?.getAttribute('d') || '';

export function stars(s, { withLabel = false } = {}) {
  if (!s || s.kind === 'none' || !s.count) return null;
  const el = h(`span.stars.stars-${s.kind}`, {
    title: s.kind === 'michelin' ? `${s.count} Michelin star${s.count > 1 ? 's' : ''} at the time` : `${s.count} of our own stars`,
  });
  el.innerHTML = STAR_SVG.repeat(s.count);
  if (s.uncertain) el.append(h('span.stars-q', '?'));
  if (withLabel) el.append(h('span.stars-label', s.kind === 'michelin' ? 'Michelin' : 'Our stars'));
  return el;
}

export function ratingLabel(id) {
  return RATINGS.find((r) => r.id === id)?.label || '';
}

// <img> that loads from the local cache / GitHub on demand.
export function photo(path, { alt = '', cls = '' } = {}) {
  const img = h('img', { alt, class: cls, loading: 'lazy', decoding: 'async' });
  if (path) {
    photoURL(path).then((url) => {
      if (url) { img.src = url; img.onload = () => img.classList.add('loaded'); }
      else img.classList.add('missing');
    });
  } else img.classList.add('missing');
  return img;
}

export function toast(message, ms = 2600) {
  const el = h('div.toast', message);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, ms);
}

// Bottom sheet. content: Node. Returns { close }.
export function sheet(content, { onClose } = {}) {
  const backdrop = h('div.sheet-backdrop');
  const panel = h('div.sheet', h('div.sheet-grip'), content);
  const close = () => {
    backdrop.classList.remove('show');
    panel.classList.remove('show');
    setTimeout(() => { backdrop.remove(); panel.remove(); onClose?.(); }, 300);
  };
  backdrop.addEventListener('click', close);
  document.body.append(backdrop, panel);
  requestAnimationFrame(() => { backdrop.classList.add('show'); panel.classList.add('show'); });
  return { close };
}

export function confirmSheet(title, message, okLabel = 'Confirm', { danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.close(); resolve(v); } };
    const s = sheet(h('div.confirm',
      h('h3.serif', title),
      message && h('p.muted', message),
      h('div.row-buttons',
        h('button.btn.ghost', { onclick: () => finish(false) }, 'Cancel'),
        h(`button.btn${danger ? '.danger' : '.primary'}`, { onclick: () => finish(true) }, okLabel)),
    ), { onClose: () => finish(false) });
  });
}

export function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const icons = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  journal: '<svg viewBox="0 0 24 24"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3z"/><path d="M5 17a3 3 0 013-3h11"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6-5.6-6-11a6 6 0 0112 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M7 3h10v18H7z"/><path d="M10 8h4M10 12h4M10 16h2"/></svg>',
  lane: '<svg viewBox="0 0 24 24"><path d="M4 20c4-1 5-5 8-8s5-4 8-4"/><circle cx="4" cy="20" r="1.2"/><circle cx="20" cy="8" r="1.2"/><path d="M14 4h6v6"/></svg>',
  chef: '<svg viewBox="0 0 24 24"><path d="M7 14a4 4 0 01-.6-7.9A5 5 0 0117.6 6.1 4 4 0 0117 14"/><path d="M7 13v7h10v-7M7 17h10"/></svg>',
  wine: '<svg viewBox="0 0 24 24"><path d="M8 3h8l-.4 5a3.6 3.6 0 01-7.2 0z"/><path d="M12 12v8M8.5 20.5h7"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/></svg>',
  cover: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M3.5 16l5-5 4 4 3-3 5 5"/></svg>',
};

export function icon(name, cls = '') {
  const s = h(`span.icon${cls ? '.' + cls : ''}`);
  s.innerHTML = icons[name];
  return s;
}
