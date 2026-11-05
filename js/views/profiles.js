// Chefs and wines: one-page profiles drafted from public sources (Claude web
// research when a key is set, otherwise Wikipedia + Wikidata), edited by
// either of us, and only "agreed" once both have accepted the content.

import * as store from '../store.js';
import { h, icon, toast, sheet, confirmSheet, formatDate, stars, photo } from '../ui.js';
import { PEOPLE } from '../config.js';
import * as wiki from '../wiki.js';
import * as claude from '../claude.js';
import { backBar, sortName } from './lane.js';

export const WINE_STYLES = ['Red', 'White', 'Rosé', 'Sparkling', 'Sweet', 'Fortified', 'Orange'];

export const KINDS = {
  chefs: {
    coll: 'chefs', one: 'chef', title: 'Chefs', textLabel: 'Chef’s bio', route: 'chef',
    searchHint: 'chef',
    fields: [
      { key: 'born', label: 'Born', ph: 'Date and place of birth' },
      { key: 'education', label: 'Culinary education', multiline: true },
      { key: 'trainedWith', label: 'Trained with', multiline: true, ph: 'Chefs and restaurants they learned under' },
      { key: 'restaurants', label: 'Restaurants', multiline: true },
      { key: 'awards', label: 'Awards & accolades', multiline: true },
      { key: 'notable', label: 'Also noteworthy', multiline: true, ph: 'TV shows, books, signature dishes…' },
    ],
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

const CONTENT_KEYS = (K) => ['text', 'style', ...K.fields.map((f) => f.key)];
const CHEF_KEYS = KINDS.chefs.fields.map((f) => f.key);

function restaurantsOfChef(chefId) {
  const ids = new Set(store.visits().filter((v) => v.chefId === chefId).map((v) => v.restaurantId));
  return [...ids].map((id) => store.restaurant(id)).filter(Boolean);
}

// A wine with only label facts (from a wine list) is still a placeholder;
// a chef with researched facts is a draft to agree on.
const hasContent = (x) => !!x.text || CHEF_KEYS.some((k) => x[k]);

export function needsMyApproval(x) {
  return hasContent(x) && !x.approvals?.[store.me()];
}

function approvalState(x) {
  if (!hasContent(x)) return { cls: 'empty', label: 'Placeholder — no profile yet' };
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
        h(`span.badge-state.${st.cls}`, st.cls === 'agreed' ? '✓' : needsMyApproval(x) ? 'Your turn' : st.cls === 'draft' ? 'Draft' : 'To write'));
    })) : h('p.muted', kindKey === 'chefs'
      ? 'Chefs appear here when you fill in “Chef” on a visit. You can also add one yourself.'
      : 'Wines appear here when you add them to a visit. You can also add one yourself.'),
    h('a.btn.ghost.block', { href: `#/${K.route}-edit/new`, style: { marginTop: '24px' } }, icon('plus'), `Add a ${K.one}`),
  ));
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function sourceLine(x) {
  if (!x.source) return null;
  if (x.source.kind === 'web') {
    const urls = x.source.urls || [];
    return h('p.byline', 'Researched on the web',
      urls.length ? [': ', urls.map((u, i) => [i ? ', ' : '', h('a', { href: u, target: '_blank', rel: 'noopener' }, hostOf(u))])] : '',
      x.edited ? ' · edited by us' : '');
  }
  return h('p.byline', 'Based on ', h('a', { href: x.source.url, target: '_blank', rel: 'noopener' }, `${x.source.title} — Wikipedia (${x.source.lang})`), x.edited ? ', edited by us' : '');
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
  const empty = !hasContent(x);

  root.replaceChildren(h('div.page',
    h('div.topbar',
      h('a.text-btn.back-link', { href: `#/${K.coll}` }, '‹ ', K.title),
      h('a.icon-btn', { href: `#/${K.route}-edit/${id}`, 'aria-label': 'Edit', style: { marginRight: '-10px' } }, icon('edit'))),
    x.image && h('div.profile-portrait', h('img', { src: x.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })),
    !x.image && x.photo && h('div.bottle-photo', photo(x.photo)),
    h('div.visit-head', { style: { padding: '6px 0 0' } },
      h('div.eyebrow', K.textLabel),
      h('h1', x.name),
      K.subtitle(x) && h('div.place', K.subtitle(x))),

    facts.length > 0 && h('dl.facts.profile-facts', facts.map(([k, v]) => h('div', h('dt', k), h('dd', v)))),

    h('div.ornament', '· · ·'),
    x.text
      ? h('div.profile-text', x.text.split(/\n{2,}/).map((p) => h('p', p)))
      : h('div', { style: { textAlign: 'center' } },
          h('p.muted', { style: { fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '19px' } },
            `A placeholder for now — the ${K.textLabel.toLowerCase()} is still to be written.`),
          h('a.btn.small.ghost', { href: `#/${K.route}-edit/${id}?research` }, icon('sparkle'), claude.hasKey() ? 'Research it on the web' : 'Look it up')),
    sourceLine(x),

    !empty && h(`div.approval.${st.cls}`,
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
export function renderProfileEdit(root, kindKey, rawId) {
  const K = KINDS[kindKey];
  const me = store.me();
  const [id, query] = (rawId || '').split('?');
  const isNew = !id || id === 'new';
  const orig = isNew ? {} : (store.get(K.coll, id) || {});
  const x = JSON.parse(JSON.stringify(orig));
  const recId = isNew ? store.newId() : id;

  const nameIn = h('input.input.title-input', { value: x.name || '', placeholder: kindKey === 'chefs' ? 'Chef’s name' : 'Wine name', oninput: (e) => { x.name = e.target.value; } });
  const inputs = {};
  const fieldEls = K.fields.map((f) => {
    const el = f.multiline
      ? h('textarea.textarea.short', { placeholder: f.ph || '', oninput: (e) => { x[f.key] = e.target.value; } })
      : h('input.input', { value: x[f.key] || '', placeholder: f.ph || '', inputmode: f.inputmode, oninput: (e) => { x[f.key] = e.target.value; } });
    if (f.multiline) el.value = x[f.key] || '';
    inputs[f.key] = el;
    return h('div.field', h('label', f.label), el);
  });
  const setField = (k, v) => { x[k] = v; if (inputs[k]) inputs[k].value = v || ''; };
  const styleBox = h('div');
  const renderStyle = () => styleBox.replaceChildren(kindKey === 'wines' ? h('div.field', h('label', 'Style'),
    h('div.segmented.wrap', WINE_STYLES.map((s) => h(`button${x.style === s ? '.on' : ''}`, { type: 'button', onclick: () => { x.style = x.style === s ? undefined : s; renderStyle(); } }, s)))) : '');
  const text = h('textarea.textarea.memories', { placeholder: `The ${K.textLabel.toLowerCase()}, in a page or less.`, oninput: (e) => { x.text = e.target.value; x.edited = true; } });
  text.value = x.text || '';
  const sourceNote = h('p.hint');
  const renderSource = () => {
    sourceNote.textContent = !x.source ? ''
      : x.source.kind === 'web' ? `Researched on the web (${(x.source.urls || []).map(hostOf).join(', ') || 'no sources listed'}). Check and edit freely.`
      : `Source: ${x.source.title} (Wikipedia ${x.source.lang}). Edit freely.`;
  };
  const anyContent = () => !!x.text || CHEF_KEYS.some((k) => x[k]);
  const linksIn = h('textarea.textarea.short', {
    placeholder: 'https://www.gaultmillau.be/…\nhttps://www.restaurant.be/about\n\n…or paste text copied from a page',
    oninput: (e) => { x.links = e.target.value; },
  });
  linksIn.value = x.links || '';

  async function buildFromSources() {
    const raw = (linksIn.value || '').trim();
    const term = (nameIn.value || '').trim();
    if (!term) { toast('Type a name first'); return; }
    if (!raw) { toast('Paste one or more web addresses first'); linksIn.focus(); return; }
    const urls = [...raw.matchAll(/https?:\/\/[^\s<>"]+/g)].map((m) => m[0].replace(/[).,;]+$/, ''));
    const pasted = raw.replace(/https?:\/\/[^\s<>"]+/g, '').trim();
    if (!claude.hasKey()) {
      if (pasted && !urls.length) {
        if (x.text && !(await confirmSheet('Use the pasted text as the bio?', 'It replaces the current text; edit it down afterwards.', 'Use it'))) return;
        x.text = pasted; text.value = pasted; x.edited = true; x.source = null; renderSource();
        toast('Pasted into the bio — edit it down');
        return;
      }
      sheet(h('div.confirm', h('h3.serif', 'Needs a Claude key'),
        h('p.muted', 'Reading web pages and writing the bio from them is done by Claude. Add a key under You → Claude (once per phone). Without a key you can paste the text of a page here instead, and edit it yourselves.')));
      return;
    }
    if (anyContent() && !(await confirmSheet('Rebuild from these sources?', 'What Claude writes replaces what is in the fields now.', 'Build'))) return;
    const body = h('div.research-wait', h('div.spinner'), h('h3.serif', 'Reading your sources…'),
      h('p.muted', `Claude is reading ${urls.length ? `${urls.length} page${urls.length > 1 ? 's' : ''}` : 'your text'} about ${term}. Keep the app open.`));
    const s = sheet(body);
    try {
      const ctx = restaurantsOfChef(recId).map((r) => [r.name, r.city, r.country].filter(Boolean).join(', ')).join('; ');
      const r = await claude.researchChefFrom(term, urls, pasted, ctx && `chef of ${ctx}`);
      for (const f of K.fields) if (r[f.key]) setField(f.key, r[f.key]);
      if (r.bio) { x.text = r.bio; text.value = r.bio; }
      x.source = { kind: 'web', urls: (r.sources?.length ? r.sources : urls).slice(0, 6) };
      x.edited = false; renderSource(); s.close();
      toast('Bio built from your sources — check it, then save');
    } catch (e) {
      console.error(e);
      body.replaceChildren(h('h3.serif', 'That didn’t work'), h('p.muted', e.message || 'Claude is not reachable right now.'));
    }
  }

  // Claude: web research filling the facts and the text.
  async function research() {
    const term = (nameIn.value || '').trim();
    if (!term) { toast('Type a name first'); return; }
    if (anyContent() && !(await confirmSheet('Replace with fresh research?', 'What the research finds replaces what is in the fields now.', 'Research'))) return;
    const body = h('div.research-wait', h('div.spinner'), h('h3.serif', 'Researching…'),
      h('p.muted', `Claude is reading up on ${term} across the web. This takes a minute or two — keep the app open.`));
    const s = sheet(body);
    try {
      if (kindKey === 'chefs') {
        const ctx = restaurantsOfChef(recId).map((r) => [r.name, r.city, r.country].filter(Boolean).join(', ')).join('; ');
        const r = await claude.researchChef(term, ctx && `chef of ${ctx}`);
        for (const f of K.fields) if (r[f.key]) setField(f.key, r[f.key]);
        if (r.bio) { x.text = r.bio; text.value = r.bio; }
        x.source = { kind: 'web', urls: (r.sources || []).slice(0, 5) };
      } else {
        const r = await claude.researchWine({ ...x, name: term });
        for (const k of ['producer', 'region', 'country', 'grapes']) if (r[k]) setField(k, r[k]);
        if (r.style && WINE_STYLES.includes(r.style)) { x.style = r.style; renderStyle(); }
        if (r.profile) { x.text = r.profile; text.value = r.profile; }
        x.source = { kind: 'web', urls: (r.sources || []).slice(0, 5) };
      }
      x.edited = false;
      renderSource(); s.close();
      toast('Draft filled in — check it, then save');
    } catch (e) {
      console.error(e);
      body.replaceChildren(h('h3.serif', 'That didn’t work'), h('p.muted', e.message || 'Claude is not reachable right now.'),
        h('button.btn.ghost.block', { onclick: () => { s.close(); lookUp(); } }, 'Try Wikipedia instead'));
    }
  }

  // Wikipedia (+ Wikidata facts for chefs).
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
            const [a, f] = await Promise.all([wiki.article(r.lang, r.title), kindKey === 'chefs' ? wiki.facts(r.lang, r.title).catch(() => ({})) : {}]);
            if (x.text && !(await confirmSheet('Replace the current text?', 'The text you have now will be replaced by the Wikipedia version.', 'Replace'))) { s.close(); return; }
            x.text = a.text; text.value = a.text; x.edited = false;
            for (const [k, v] of Object.entries(f)) if (v && !x[k]) setField(k, v);
            x.source = a.source;
            if (a.image) x.image = a.image;
            renderSource(); s.close();
            toast(r.lang === 'en' ? 'Draft filled in — edit as you like' : `Filled in from the ${r.lang === 'fr' ? 'French' : 'Dutch'} Wikipedia — edit as you like`);
          } catch { body.replaceChildren(h('p.muted', 'Could not fetch the article.')); }
        } }, h('span', r.title, h('small', { style: { display: 'block' } }, r.snippet.slice(0, 140) + '…')), h('small', r.lang.toUpperCase())))) : h('p.muted', 'Nothing on Wikipedia. You can write it yourselves.'),
        !claude.hasKey() && h('p.hint', 'Tip: add a Claude key under You to research the whole web instead — much richer, especially for chefs without a Wikipedia page.'),
      );
    } catch { body.replaceChildren(h('p.muted', 'Wikipedia is not reachable right now.')); }
  }

  async function save() {
    x.name = (nameIn.value || '').trim();
    if (!x.name) { toast('Give it a name'); return; }
    const patch = {};
    for (const k of ['name', 'image', 'source', 'edited', 'links', ...CONTENT_KEYS(K)]) {
      if (JSON.stringify(x[k] || null) !== JSON.stringify(orig[k] || null)) patch[k] = x[k] || undefined;
    }
    const contentChanged = CONTENT_KEYS(K).some((k) => k in patch);
    if (contentChanged) {
      patch.textBy = me;
      patch.approvals = { [me]: true }; // changed content needs the other's OK again
    }
    if (isNew || Object.keys(patch).length) await store.save(K.coll, recId, patch);
    toast(contentChanged && hasContent(x) ? `Saved — waiting for ${PEOPLE.filter((p) => p !== me).join(' & ')}` : 'Saved');
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
    h('div.research-bar',
      claude.hasKey() && h('button.btn.small.accent', { type: 'button', onclick: research }, icon('sparkle'), 'Research on the web'),
      h('button.btn.small.ghost', { type: 'button', onclick: lookUp }, 'Find on Wikipedia')),
    styleBox,
    fieldEls,
    kindKey === 'chefs' && h('div.field.sources-box',
      h('label', 'Build the bio from these websites'),
      linksIn,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '8px' } },
        h('p.hint', { style: { margin: 0 } }, 'One address per line — the restaurant’s site, Gault&Millau, an interview…'),
        h('button.btn.small.accent', { type: 'button', onclick: buildFromSources }, icon('sparkle'), 'Build bio'))),
    h('div.field',
      h('label', K.textLabel),
      text, sourceNote,
      h('p.hint', 'Saving changes asks the other one of you to accept them.')),
    x.image && h('div.field', h('label', 'Portrait'),
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
        h('img', { src: x.image, alt: '', style: { width: '64px', height: '64px', objectFit: 'cover', borderRadius: '2px' }, referrerpolicy: 'no-referrer' }),
        h('button.btn.small.ghost', { type: 'button', onclick: (e) => { x.image = null; e.target.closest('.field').remove(); } }, 'Remove picture'))),
    h('button.btn.primary.block', { type: 'button', onclick: save, style: { marginTop: '20px' } }, 'Save'),
    !isNew && h('button.btn.ghost.block', { type: 'button', style: { marginTop: '10px', color: 'var(--burgundy)' }, onclick: del }, `Remove this ${K.one}`),
  ));
  window.scrollTo(0, 0);
  if (query === 'research') setTimeout(() => (claude.hasKey() ? research() : lookUp()), 50);
}

// Find a chef/wine by name, or create it (a placeholder page). Used by the visit editor.
export async function ensureByName(coll, name, extra = {}) {
  const n = (name || '').trim();
  if (!n) return null;
  const key = (s) => String(s || '').trim().toLowerCase();
  const found = store.list(coll).find((x) => key(x.name) === key(n)
    && (!extra.producer || !x.producer || key(x.producer) === key(extra.producer))
    && (!extra.vintage || !x.vintage || key(x.vintage) === key(extra.vintage)));
  if (found) {
    const fill = {};
    for (const [k, v] of Object.entries(extra)) if (v && !found[k]) fill[k] = v;
    if (Object.keys(fill).length) await store.save(coll, found.id, fill);
    return found.id;
  }
  const id = store.newId();
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v));
  await store.save(coll, id, { name: n, ...clean });
  return id;
}

// Visits that name a chef but aren't linked to a chef page yet (e.g. entered
// before chef pages existed): link them, creating the placeholder page.
export async function linkChefs() {
  for (const v of store.visits()) {
    if (v.chef && (!v.chefId || !store.get('chefs', v.chefId))) {
      const cid = await ensureByName('chefs', v.chef);
      if (cid) await store.save('visits', v.id, { chefId: cid });
    }
  }
}
