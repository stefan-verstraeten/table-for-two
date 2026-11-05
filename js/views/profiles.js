// Chefs and wines: one-page profiles drafted from public sources (Wikipedia),
// edited by either of us, and only "agreed" once both have accepted the text.

import * as store from '../store.js';
import { h, icon, toast, sheet, confirmSheet, formatDate, stars } from '../ui.js';
import { PEOPLE } from '../config.js';
import * as wiki from '../wiki.js';
import { backBar, sortName } from './lane.js';

const WINE_STYLES = ['Red', 'White', 'Rosé', 'Sparkling', 'Sweet', 'Fortified'];

export const KINDS = {
  chefs: {
    coll: 'chefs', one: 'chef', title: 'Chefs', textLabel: 'Chef’s bio', route: 'chef',
    searchHint: 'chef',
    fields: [],
    subtitle: (x) => restaurantsOfChef(x.id).map((r) => r.name).join(', '),
    visits: (id) => store.visits().filter((v) => v.chefId === id),
  },
  wines: {
    coll: 'wines', one: 'wine', title: 'Wines', textLabel: 'Wine profile', route: 'wine',
    searchHint: 'wine',
    fields: [
      { key: 'producer', label: 'Producer' },
      { key: 'region', label: 'Region / appellation' },
      { key: 'country', label: 'Country' },
      { key: 'grapes', label: 'Grapes' },
      { key: 'vintage', label: 'Vintage', inputmode: 'numeric' },
    ],
    subtitle: (x) => [x.style, x.vintage, x.producer, x.region].filter(Boolean).join(' · '),
    visits: (id) => store.visits().filter((v) => (v.wineIds || []).includes(id)),
  },
};

function restaurantsOfChef(chefId) {
  const ids = new Set(store.visits().filter((v) => v.chefId === chefId).map((v) => v.restaurantId));
  return [...ids].map((id) => store.restaurant(id)).filter(Boolean);
}

export function needsMyApproval(x) {
  return !!x.text && !x.approvals?.[store.me()];
}

function approvalState(x) {
  if (!x.text) return { cls: 'empty', label: 'No profile yet' };
  const yes = PEOPLE.filter((p) => x.approvals?.[p]);
  if (yes.length === PEOPLE.length) return { cls: 'agreed', label: `Agreed by ${PEOPLE.join(' & ')}` };
  const waiting = PEOPLE.filter((p) => !x.approvals?.[p]);
  return { cls: 'draft', label: `Draft${x.textBy ? ` by ${x.textBy}` : ''} · waiting for ${waiting.join(' & ')}` };
}

// ---------- list ----------
export function renderList(root, kindKey) {
  const K = KINDS[kindKey];
  const items = store.list(K.coll).sort((a, b) => sortName(a.name).localeCompare(sortName(b.name), 'en', { sensitivity: 'base' }));
  root.replaceChildren(h('div.page',
    backBar('#/lane', 'Memory lane'),
    h('h1.page-title', K.title),
    items.length ? h('div', items.map((x) => {
      const st = approvalState(x);
      return h('a.az-row', { href: `#/${K.route}/${x.id}` },
        h('span', h('b.serif', x.name), h('small', K.subtitle(x) || '—')),
        h(`span.badge-state.${st.cls}`, st.cls === 'agreed' ? '✓' : needsMyApproval(x) ? 'Your turn' : st.cls === 'draft' ? 'Draft' : ''));
    })) : h('p.muted', kindKey === 'chefs'
      ? 'Chefs appear here when you fill in “Chef” on a visit. You can also add one yourself.'
      : 'Wines appear here when you add them to a visit. You can also add one yourself.'),
    h('a.btn.ghost.block', { href: `#/${K.route}-edit/new`, style: { marginTop: '24px' } }, icon('plus'), `Add a ${K.one}`),
  ));
}

// ---------- detail ----------
export function renderDetail(root, kindKey, id) {
  const K = KINDS[kindKey];
  const x = store.get(K.coll, id);
  if (!x) { root.replaceChildren(h('div.page', backBar(`#/${K.coll}`, K.title), h('p.muted', 'Not found.'))); return; }
  const me = store.me();
  const st = approvalState(x);
  const visits = K.visits(id);
  const facts = K.fields.map((f) => [f.label, x[f.key]]).filter(([, v]) => v);
  if (x.style) facts.unshift(['Style', x.style]);

  root.replaceChildren(h('div.page',
    h('div.topbar',
      h('a.text-btn.back-link', { href: `#/${K.coll}` }, '‹ ', K.title),
      h('a.icon-btn', { href: `#/${K.route}-edit/${id}`, 'aria-label': 'Edit', style: { marginRight: '-10px' } }, icon('edit'))),
    x.image && h('div.profile-portrait', h('img', { src: x.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })),
    h('div.visit-head', { style: { padding: '6px 0 0' } },
      h('div.eyebrow', K.textLabel),
      h('h1', x.name),
      K.subtitle(x) && h('div.place', K.subtitle(x))),

    facts.length > 0 && h('dl.facts', facts.map(([k, v]) => h('div', h('dt', k), h('dd', v)))),

    h('div.ornament', '· · ·'),
    x.text
      ? h('div.profile-text', x.text.split(/\n{2,}/).map((p) => h('p', p)))
      : h('p.muted', { style: { textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '19px' } },
          h('a', { href: `#/${K.route}-edit/${id}` }, `Write the ${K.textLabel.toLowerCase()}, or look it up…`)),
    x.source && h('p.byline', 'Based on ', h('a', { href: x.source.url, target: '_blank', rel: 'noopener' }, `${x.source.title} — Wikipedia (${x.source.lang})`), x.edited ? ', edited by us' : ''),

    x.text && h(`div.approval.${st.cls}`,
      h('div', h('div.eyebrow', 'Status'), h('div', st.label)),
      needsMyApproval(x) && h('button.btn.small.accent', { onclick: async () => {
        await store.save(K.coll, id, { [`approvals.${me}`]: true });
        toast('Accepted');
      } }, 'Accept'),
    ),

    visits.length > 0 && h('div.other-visits',
      h('h3.section-title', kindKey === 'chefs' ? 'Cooked for us' : 'We drank it at'),
      visits.map((v) => h('a', { href: `#/visit/${v.id}` },
        h('span', h('span.serif', { style: { fontSize: '19px' } }, store.restaurant(v.restaurantId)?.name), ' ',
          h('small.muted', formatDate(v.date, { short: true }))),
        stars(v.stars)))),
  ));
}

// ---------- edit ----------
export function renderProfileEdit(root, kindKey, id) {
  const K = KINDS[kindKey];
  const me = store.me();
  const isNew = !id || id === 'new';
  const orig = isNew ? {} : (store.get(K.coll, id) || {});
  const x = JSON.parse(JSON.stringify(orig));
  const recId = isNew ? store.newId() : id;

  const nameIn = h('input.input.title-input', { value: x.name || '', placeholder: kindKey === 'chefs' ? 'Chef’s name' : 'Wine name', oninput: (e) => { x.name = e.target.value; } });
  const fieldEls = K.fields.map((f) => h('div.field', h('label', f.label),
    h('input.input', { value: x[f.key] || '', inputmode: f.inputmode, oninput: (e) => { x[f.key] = e.target.value; } })));
  const styleBox = h('div');
  const renderStyle = () => styleBox.replaceChildren(kindKey === 'wines' ? h('div.field', h('label', 'Style'),
    h('div.segmented', WINE_STYLES.map((s) => h(`button${x.style === s ? '.on' : ''}`, { type: 'button', onclick: () => { x.style = x.style === s ? undefined : s; renderStyle(); } }, s)))) : '');
  const text = h('textarea.textarea.memories', { placeholder: `The ${K.textLabel.toLowerCase()}, in a page or less.`, oninput: (e) => { x.text = e.target.value; x.edited = true; } });
  text.value = x.text || '';
  const sourceNote = h('p.hint');
  const renderSource = () => { sourceNote.textContent = x.source ? `Source: ${x.source.title} (Wikipedia ${x.source.lang}). Edit freely.` : ''; };

  async function lookUp() {
    const term = (nameIn.value || '').trim();
    if (!term) { toast('Type a name first'); return; }
    const body = h('div', h('h3.serif', { style: { fontSize: '24px', margin: '0 0 6px' } }, 'Public sources'), h('p.muted', `Searching Wikipedia for “${term}”…`));
    const s = sheet(body);
    try {
      const hint = kindKey === 'chefs'
        ? [K.searchHint, restaurantsOfChef(recId)[0]?.name].filter(Boolean).join(' ')
        : [x.producer, x.region].filter(Boolean).join(' ') || K.searchHint;
      let results = await wiki.search(term, hint);
      if (!results.length) results = await wiki.search(term);
      body.replaceChildren(
        h('h3.serif', { style: { fontSize: '24px', margin: '0 0 6px' } }, 'Which one?'),
        results.length ? h('div.place-list', results.map((r) => h('button', { onclick: async () => {
          body.replaceChildren(h('p.muted', 'Fetching the article…'));
          try {
            const a = await wiki.article(r.lang, r.title);
            if (x.text && !(await confirmSheet('Replace the current text?', 'The text you have now will be replaced by the Wikipedia version.', 'Replace'))) { s.close(); return; }
            x.text = a.text; text.value = a.text; x.edited = false;
            x.source = a.source;
            if (a.image) x.image = a.image;
            renderSource(); s.close();
            toast(r.lang === 'en' ? 'Draft filled in — edit as you like' : `Draft filled in from the ${r.lang === 'fr' ? 'French' : 'Dutch'} Wikipedia`);
          } catch { body.replaceChildren(h('p.muted', 'Could not fetch the article.')); }
        } }, h('span', r.title, h('small', { style: { display: 'block' } }, r.snippet.slice(0, 140) + '…')), h('small', r.lang.toUpperCase())))) : h('p.muted', 'Nothing found. You can write it yourselves.'),
      );
    } catch { body.replaceChildren(h('p.muted', 'Wikipedia is not reachable right now.')); }
  }

  async function save() {
    x.name = (nameIn.value || '').trim();
    if (!x.name) { toast('Give it a name'); return; }
    const patch = {};
    for (const k of ['name', 'style', 'image', 'source', 'edited', ...K.fields.map((f) => f.key)]) {
      if (JSON.stringify(x[k] ?? null) !== JSON.stringify(orig[k] ?? null)) patch[k] = x[k];
    }
    if ((x.text || '') !== (orig.text || '')) {
      patch.text = x.text;
      patch.textBy = me;
      patch.approvals = { [me]: true }; // a changed text needs the other's OK again
    }
    if (isNew || Object.keys(patch).length) await store.save(K.coll, recId, patch);
    toast(patch.approvals ? `Saved — waiting for ${PEOPLE.filter((p) => p !== me).join(' & ')}` : 'Saved');
    location.hash = `#/${K.route}/${recId}`;
  }

  async function del() {
    if (await confirmSheet(`Remove this ${K.one}?`, 'Visits keep their text; only the profile goes.', 'Remove', { danger: true })) {
      await store.remove(K.coll, recId);
      location.hash = `#/${K.coll}`;
    }
  }

  renderStyle(); renderSource();
  root.replaceChildren(h('div.page',
    h('div.topbar',
      h('a.icon-btn', { href: isNew ? `#/${K.coll}` : `#/${K.route}/${recId}`, 'aria-label': 'Cancel' }, icon('close')),
      h('span.eyebrow', isNew ? `New ${K.one}` : `Edit ${K.one}`),
      h('button.text-btn', { type: 'button', onclick: save }, 'Save')),
    h('div.field', h('label', 'Name'), nameIn),
    styleBox,
    fieldEls,
    h('div.field',
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '7px' } },
        h('label.field-label', { style: { margin: 0 } }, K.textLabel),
        h('button.btn.small.ghost', { type: 'button', onclick: lookUp }, icon('sparkle'), 'Find on Wikipedia')),
      text, sourceNote,
      h('p.hint', 'Saving a changed text asks the other one of you to accept it.')),
    x.image && h('div.field', h('label', 'Portrait'),
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        h('img', { src: x.image, alt: '', style: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '2px' }, referrerpolicy: 'no-referrer' }),
        h('button.btn.small.ghost', { type: 'button', onclick: (e) => { x.image = null; e.target.closest('.field').remove(); } }, 'Remove picture'))),
    h('button.btn.primary.block', { type: 'button', onclick: save, style: { marginTop: '20px' } }, 'Save'),
    !isNew && h('button.btn.ghost.block', { type: 'button', style: { marginTop: '10px', color: 'var(--burgundy)' }, onclick: del }, `Remove this ${K.one}`),
  ));
  window.scrollTo(0, 0);
}

// Find a chef/wine by name, or create it. Used by the visit editor.
export async function ensureByName(coll, name, extra = {}) {
  const n = (name || '').trim();
  if (!n) return null;
  const found = store.list(coll).find((x) => x.name.trim().toLowerCase() === n.toLowerCase());
  if (found) return found.id;
  const id = store.newId();
  await store.save(coll, id, { name: n, ...extra });
  return id;
}
