import * as store from '../store.js';
import { h, icon, toast, sheet, confirmSheet, stars, formatDate } from '../ui.js';
import { backBar } from './lane.js';

export function renderWishes(root) {
  const all = store.list('wishes').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const open = all.filter((w) => !w.doneVisitId);
  const done = all.filter((w) => w.doneVisitId);

  root.replaceChildren(h('div.page',
    backBar('#/lane', 'Memory lane'),
    h('h1.page-title', 'Wish list'),
    h('p.muted', { style: { marginTop: '-10px', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '19px' } }, 'Tables still to come.'),
    h('button.btn.accent.block', { onclick: () => editWish(null), style: { margin: '8px 0 22px' } }, icon('plus'), 'Add to the wish list'),
    open.length ? open.map(wishRow) : h('p.muted', 'Nothing on the list yet.'),
    done.length > 0 && [h('h3.section-title', 'Wishes come true'), done.map(wishRow)],
  ));
}

function wishRow(w) {
  const v = w.doneVisitId && store.visit(w.doneVisitId);
  return h(`div.wish${w.doneVisitId ? '.done' : ''}`,
    h('button.wish-main', { onclick: () => (v ? (location.hash = `#/visit/${v.id}`) : editWish(w)) },
      h('b.serif', w.name),
      h('small', [w.city, w.country].filter(Boolean).join(', ')),
      w.note && h('p', w.note),
      h('span.wish-meta', stars(w.stars), h('small', v ? `Visited ${formatDate(v.date, { short: true })}` : `Added by ${w.createdBy || '—'}`))),
    !w.doneVisitId && h('a.btn.small.ghost', { href: `#/new/w:${w.id}` }, 'We went!'),
  );
}

function editWish(w) {
  const isNew = !w;
  const x = w ? JSON.parse(JSON.stringify(w)) : { stars: { kind: 'michelin', count: 1 } };
  const id = w?.id || store.newId();
  const inp = (key, label, ph) => h('div.field', h('label', label),
    h('input.input', { value: x[key] || '', placeholder: ph || '', oninput: (e) => { x[key] = e.target.value; } }));
  const starBox = h('div');
  const renderStars = () => starBox.replaceChildren(h('div.field', h('label', 'Stars'),
    h('div.segmented.michelin', [0, 1, 2, 3].map((n) => h(`button${(x.stars?.count || 0) === n ? '.on' : ''}`, {
      type: 'button', onclick: () => { x.stars = n ? { kind: 'michelin', count: n } : { kind: 'none' }; renderStars(); },
    }, n ? '★'.repeat(n) : 'None')))));
  renderStars();
  const note = h('textarea.textarea', { placeholder: 'Why we want to go, who recommended it…', oninput: (e) => { x.note = e.target.value; } });
  note.value = x.note || '';

  const s = sheet(h('div',
    h('h3.serif', { style: { fontSize: '26px', margin: '0 0 16px' } }, isNew ? 'A table we dream of' : 'Edit wish'),
    inp('name', 'Restaurant'),
    h('div.grid-2', inp('city', 'City'), inp('country', 'Country')),
    starBox,
    h('div.field', h('label', 'Note'), note),
    h('div.row-buttons',
      !isNew && h('button.btn.ghost', { onclick: async () => {
        if (await confirmSheet('Remove from the wish list?', '', 'Remove', { danger: true })) { await store.remove('wishes', id); s.close(); }
      } }, 'Remove'),
      h('button.btn.primary', { onclick: async () => {
        if (!(x.name || '').trim()) { toast('Name the restaurant'); return; }
        const patch = {};
        for (const k of ['name', 'city', 'country', 'stars', 'note']) {
          if (JSON.stringify(x[k] ?? null) !== JSON.stringify(w?.[k] ?? null)) patch[k] = x[k];
        }
        if (isNew || Object.keys(patch).length) await store.save('wishes', id, patch);
        s.close(); toast(isNew ? 'Added to the wish list' : 'Saved');
      } }, 'Save')),
  ));
}
