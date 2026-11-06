// Highlights: each of us keeps their own page of the dishes, wines and moments
// that were extra special, each with a note on why.
//
// highlight = { by, kind: 'dish'|'wine'|'moment', visitId, course (index),
//               wineId, photoId, title, note }

import * as store from '../store.js';
import { h, icon, toast, sheet, confirmSheet, formatDate, photo } from '../ui.js';
import { PEOPLE } from '../config.js';
import { backBar } from './lane.js';

const KIND_LABEL = { dish: 'A dish', wine: 'A wine', moment: 'A moment' };

export const highlightsOf = (person) => store.list('highlights').filter((x) => x.by === person)
  .sort((a, b) => sortKeyOf(b) - sortKeyOf(a) || (b.createdAt || '').localeCompare(a.createdAt || ''));
const sortKeyOf = (x) => (x.visitId && store.visit(x.visitId) ? store.sortKey(store.visit(x.visitId)) : 0);

function same(a, b) {
  return a.kind === b.kind && a.visitId === b.visitId
    && (a.kind !== 'dish' || a.course === b.course)
    && (a.kind !== 'wine' || a.wineId === b.wineId)
    && a.kind !== 'moment';
}

// "Highlight this" for a dish or wine; shows both people's highlights of it.
export function highlightButton(target) {
  const me = store.me();
  const all = store.list('highlights').filter((x) => same(x, target));
  const mine = all.find((x) => x.by === me);
  return h('div.hl-box',
    all.map((x) => highlightCard(x, { compact: true })),
    !mine && h('button.btn.small.ghost', { type: 'button', onclick: () => editHighlight({ ...target }) },
      h('span.hl-star', '★'), `Highlight this ${target.kind === 'wine' ? 'wine' : 'dish'}`));
}

export function highlightCard(x, { compact = false, onVisit = false } = {}) {
  const v = x.visitId && store.visit(x.visitId);
  const r = v && store.restaurant(v.restaurantId);
  const wine = x.wineId && store.get('wines', x.wineId);
  const pic = x.kind === 'moment' && x.photoId ? v?.photos?.find((p) => p.id === x.photoId)
    : x.kind === 'wine' && wine?.photo ? { thumb: wine.photo } : null;
  const href = x.kind === 'dish' ? `#/dish/${x.visitId}/${x.course}` : x.kind === 'wine' && wine ? `#/wine/${wine.id}` : v ? `#/visit/${v.id}` : null;
  const mine = x.by === store.me();
  return h('div.hl-card',
    pic && h('a.hl-pic', { href }, photo(pic.thumb || pic.path)),
    h('div.hl-text',
      h('div.eyebrow', compact ? `${x.by}’s highlight` : onVisit ? `${KIND_LABEL[x.kind]} · ${x.by}` : KIND_LABEL[x.kind]),
      !compact && h('a.hl-title.serif', { href }, titleOf(x)),
      x.note && h('p.hl-note', x.note),
      !compact && !onVisit && v && h('small.muted', h('a', { href: `#/visit/${v.id}` }, r?.name), ' · ', formatDate(v.date, { short: true })),
      mine && h('button.text-btn.hl-edit', { type: 'button', onclick: () => editHighlight(x) }, 'Edit')));
}

function titleOf(x) {
  if (x.kind === 'wine') { const w = store.get('wines', x.wineId); return w ? [w.name, w.vintage].filter(Boolean).join(' ') : x.title; }
  if (x.kind === 'dish') return store.visit(x.visitId)?.courses?.[x.course]?.dish || x.title;
  return x.title || 'A moment';
}

// Add or edit one of my highlights.
export function editHighlight(x) {
  const me = store.me();
  const isNew = !x.id;
  const v = x.visitId && store.visit(x.visitId);
  const d = { title: x.title || '', note: x.note || '', photoId: x.photoId || null };
  const titleIn = x.kind === 'moment' && h('input.input', { value: d.title, placeholder: 'e.g. The sunset from our table', oninput: (e) => { d.title = e.target.value; } });
  const noteIn = h('textarea.textarea.short', { placeholder: 'Why it was so special…', oninput: (e) => { d.note = e.target.value; } });
  noteIn.value = d.note;
  const pics = x.kind === 'moment' ? (v?.photos || []).filter((p) => !p.kind || p.kind === 'photo') : [];
  const picRow = h('div.hl-pick');
  const renderPics = () => picRow.replaceChildren(...pics.map((p) => h(`button${d.photoId === p.id ? '.on' : ''}`, { type: 'button', onclick: () => { d.photoId = d.photoId === p.id ? null : p.id; renderPics(); } }, photo(p.thumb || p.path))));
  renderPics();

  const s = sheet(h('div.hl-sheet',
    h('h3.serif', { style: { fontSize: '24px', margin: '0 0 4px' } }, isNew ? 'A highlight' : 'Your highlight'),
    h('p.muted', { style: { marginTop: 0 } }, `${titleOf(x)}${v ? ` — ${store.restaurant(v.restaurantId)?.name}, ${formatDate(v.date, { short: true })}` : ''}`),
    titleIn && h('div.field', h('label', 'The moment'), titleIn),
    h('div.field', h('label', 'Why it stands out'), noteIn),
    pics.length > 0 && h('div.field', h('label', 'A photo of it (optional)'), picRow),
    h('div.row-buttons',
      !isNew && h('button.btn.ghost', { type: 'button', style: { color: 'var(--burgundy)' }, onclick: async () => {
        if (!(await confirmSheet('Remove this highlight?', null, 'Remove', { danger: true }))) return;
        await store.remove('highlights', x.id); s.close(); toast('Removed');
      } }, 'Remove'),
      h('button.btn.primary', { type: 'button', onclick: async () => {
        if (x.kind === 'moment' && !d.title.trim()) { toast('Say what the moment was'); titleIn.focus(); return; }
        const id = x.id || store.newId();
        const rec = { kind: x.kind, visitId: x.visitId, by: x.by || me, title: (d.title || x.title || '').trim() || undefined, note: d.note.trim() || undefined };
        if (x.kind === 'dish') rec.course = x.course;
        if (x.kind === 'wine') rec.wineId = x.wineId;
        if (x.kind === 'moment') rec.photoId = d.photoId || undefined;
        await store.save('highlights', id, rec);
        s.close(); toast(isNew ? `Added to ${me}’s highlights` : 'Saved');
      } }, isNew ? 'Highlight it' : 'Save')),
  ));
  setTimeout(() => (titleIn || noteIn).focus(), 350);
}

export function renderHighlights(root, person) {
  person = PEOPLE.find((p) => p.toLowerCase() === decodeURIComponent(person || '').toLowerCase()) || store.me();
  const list = highlightsOf(person);
  const mine = person === store.me();
  const byKind = (k) => list.filter((x) => x.kind === k).length;
  root.replaceChildren(h('div.page',
    backBar('#/lane', 'Memory lane'),
    h('div.eyebrow', { style: { textAlign: 'center', marginTop: '10px' } }, 'Extra special'),
    h('h1.page-title', { style: { textAlign: 'center' } }, `${person}’s highlights`),
    list.length > 0 && h('p.muted', { style: { textAlign: 'center', marginTop: '-6px' } },
      [['dish', 'dish', 'dishes'], ['wine', 'wine', 'wines'], ['moment', 'moment', 'moments']].map(([k, one, many]) => byKind(k) && `${byKind(k)} ${byKind(k) > 1 ? many : one}`).filter(Boolean).join(' · ')),
    list.length ? h('div.hl-list', list.map((x) => highlightCard(x)))
      : h('p.muted', { style: { textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '19px' } },
          mine ? 'Nothing highlighted yet. Open a dish, a wine or an evening and tap “Highlight”.' : `${person} hasn’t highlighted anything yet.`),
  ));
  window.scrollTo(0, 0);
}
