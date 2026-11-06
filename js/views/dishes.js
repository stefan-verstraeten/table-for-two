// Dishes (every course on every menu, A–Z) and ingredients (every ingredient
// on those menus, in English, each listing back to the dishes it was in).

import * as store from '../store.js';
import { h, icon, toast, confirmSheet, formatDate, sheet } from '../ui.js';
import { backBar, sortName } from './lane.js';
import * as claude from '../claude.js';
import { allCourses, termsOf, termIndex, ingredientsOfCourse, coursesWith, displayName, termKey, mergeIngredient, catalogueIngredients } from '../ingredients.js';
import { highlightButton } from './highlights.js';

let tab = 'dishes';

const whereWhen = (v) => [store.restaurant(v.restaurantId)?.name, formatDate(v.date, { short: true })].filter(Boolean).join(' · ');
const letterOf = (s) => { const l = sortName(s).normalize('NFD')[0]?.toUpperCase() || '#'; return /[A-Z]/.test(l) ? l : '#'; };

function azGroups(rows, nameOf) {
  const groups = new Map();
  for (const r of rows.sort((a, b) => sortName(nameOf(a)).localeCompare(sortName(nameOf(b)), 'en', { sensitivity: 'base' }))) {
    const k = letterOf(nameOf(r));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
}

export function renderDishes(root, which) {
  if (which === 'ingredients' || which === 'dishes') tab = which;
  const courses = allCourses();
  const idx = termIndex();
  const visible = store.list('ingredients').filter((i) => !i.notIngredient);
  const counts = new Map();
  for (const { c } of courses) for (const ing of ingredientsOfCourse(c, idx)) counts.set(ing.id, (counts.get(ing.id) || 0) + 1);
  const ingredients = visible.filter((i) => counts.get(i.id));
  const unknownTerms = courses.some(({ c }) => termsOf(c).some((t) => !idx.has(t.key)));
  if (unknownTerms) catalogueIngredients().catch(console.error);
  const untranslated = ingredients.filter((i) => i.untranslated);

  const seg = h('div.segmented', { style: { margin: '0 0 18px' } },
    [['dishes', `Dishes (${courses.length})`], ['ingredients', `Ingredients (${ingredients.length})`]].map(([id, label]) =>
      h(`button${tab === id ? '.on' : ''}`, { onclick: () => { tab = id; renderDishes(root); } }, label)));

  let body;
  if (!courses.length) {
    body = h('p.muted', 'Dishes appear here once a visit has its courses filled in — typed, pasted, or read from a photo of the menu.');
  } else if (tab === 'dishes') {
    const groups = azGroups(courses, (x) => x.c.dish);
    body = [...groups].map(([k, list]) => h('section.az-group',
      h('div.year-head', h('h2', k)),
      list.map(({ v, c, i }) => h('a.az-row', { href: `#/dish/${v.id}/${i}` },
        h('span', h('b.serif', c.dish), h('small', [c.detail, whereWhen(v)].filter(Boolean).join(' — '))),
        highlightedBadge(v.id, i)))));
  } else {
    const groups = azGroups(ingredients, displayName);
    body = [
      untranslated.length > 0 && h('div.notice',
        h('p', `${untranslated.length} ingredient${untranslated.length > 1 ? 's are' : ' is'} still in the menu’s own language.`),
        claude.hasKey()
          ? h('button.btn.small.accent', { onclick: () => translateWithClaude(untranslated) }, icon('sparkle'), 'Translate with Claude')
          : h('p.hint', 'Tap one to give it its English name, or add a Claude key under You to translate them all at once.')),
      [...groups].map(([k, list]) => h('section.az-group',
        h('div.year-head', h('h2', k)),
        list.map((ing) => h('a.az-row', { href: `#/ingredient/${ing.id}` },
          h('span', h('b.serif', displayName(ing)), h('small', originals(ing).join(', ') || '—')),
          h('span.az-meta', ing.untranslated && h('span.badge-state.draft', 'Check'), h('small', `${counts.get(ing.id)} dish${counts.get(ing.id) > 1 ? 'es' : ''}`)))))),
    ];
  }

  root.replaceChildren(h('div.page',
    backBar('#/lane', 'Memory lane'),
    h('h1.page-title', 'Dishes'),
    seg, body));
}

function highlightedBadge(visitId, i) {
  const n = store.list('highlights').filter((x) => x.kind === 'dish' && x.visitId === visitId && x.course === i).length;
  return n ? h('span.hl-mark', { title: 'Highlighted' }, '★') : null;
}

// The terms as they appeared on menus, when they differ from the English name.
function originals(ing) {
  const name = termKey(ing.name);
  const shown = new Map();
  for (const { c } of allCourses()) for (const t of termsOf(c)) if ((ing.terms || []).includes(t.key) && t.key !== name) shown.set(t.key, t.text.toLowerCase());
  return [...shown.values()];
}

async function translateWithClaude(list) {
  const body = h('div.research-wait', h('div.spinner'), h('h3.serif', 'Translating…'), h('p.muted', `Claude is translating ${list.length} ingredient${list.length > 1 ? 's' : ''}.`));
  const s = sheet(body);
  try {
    const items = list.map((ing) => {
      const ex = coursesWith(ing.id)[0];
      return { id: ing.id, term: ing.name, context: ex ? `${ex.c.dish}: ${ex.c.detail || ''} (${store.restaurant(ex.v.restaurantId)?.country || ''})` : '' };
    });
    const res = await claude.translateIngredients(items);
    let n = 0;
    for (const r of res) {
      const ing = store.get('ingredients', r.id);
      if (!ing || !r.english) continue;
      await store.save('ingredients', ing.id, { name: r.english, untranslated: undefined, terms: [...new Set([...(ing.terms || []), termKey(ing.name)])], ...(r.note && !ing.note ? { note: r.note } : {}) });
      n++;
    }
    s.close();
    toast(`${n} translated — check them`);
  } catch (e) {
    console.error(e);
    body.replaceChildren(h('h3.serif', 'That didn’t work'), h('p.muted', e.message || 'Claude is not reachable right now.'));
  }
}

// ---------- one dish ----------
export function renderDish(root, visitId, index) {
  const v = store.visit(visitId);
  const i = Number(index);
  const c = v?.courses?.[i];
  if (!c) { root.replaceChildren(h('div.page', backBar('#/dishes', 'Dishes'), h('p.muted', 'Not found.'))); return; }
  const r = store.restaurant(v.restaurantId);
  const ings = ingredientsOfCourse(c);
  const same = allCourses().filter((x) => termKey(x.c.dish) === termKey(c.dish) && !(x.v.id === v.id && x.i === i));
  const n = v.courses.length;

  root.replaceChildren(h('div.page',
    backBar('#/dishes', 'Dishes'),
    h('div.visit-head', { style: { padding: '6px 0 0' } },
      h('div.eyebrow', `Course ${i + 1} of ${n}`),
      h('h1', c.dish),
      c.detail && h('div.place', { style: { fontStyle: 'italic' } }, c.detail),
      h('div.when', h('a.link', { href: `#/visit/${v.id}` }, r?.name), ' · ', formatDate(v.date))),
    h('div.ornament', '· · ·'),
    ings.length > 0 && h('div',
      h('h3.section-title', 'Ingredients'),
      h('div.chip-list', ings.map((ing) => h('a.chip', { href: `#/ingredient/${ing.id}` }, displayName(ing))))),
    highlightButton({ kind: 'dish', visitId: v.id, course: i, title: c.dish }),
    h('div.dish-nav',
      i > 0 ? h('a.link', { href: `#/dish/${v.id}/${i - 1}` }, '‹ ', v.courses[i - 1].dish) : h('span'),
      i < n - 1 ? h('a.link', { href: `#/dish/${v.id}/${i + 1}` }, v.courses[i + 1].dish, ' ›') : h('span')),
    same.length > 0 && h('div.other-visits',
      h('h3.section-title', 'Also on these menus'),
      same.map((x) => h('a', { href: `#/dish/${x.v.id}/${x.i}` }, h('span.serif', { style: { fontSize: '19px' } }, whereWhen(x.v))))),
  ));
  window.scrollTo(0, 0);
}

// ---------- one ingredient ----------
export function renderIngredient(root, id) {
  const ing = store.get('ingredients', id);
  if (!ing) { root.replaceChildren(h('div.page', backBar('#/dishes/ingredients', 'Ingredients'), h('p.muted', 'Not found.'))); return; }
  const list = coursesWith(id);
  const orig = originals(ing);
  root.replaceChildren(h('div.page',
    h('div.topbar',
      h('a.text-btn.back-link', { href: '#/dishes/ingredients' }, '‹ ', 'Ingredients'),
      h('a.icon-btn', { href: `#/ingredient-edit/${id}`, 'aria-label': 'Edit', style: { marginRight: '-10px' } }, icon('edit'))),
    h('div.visit-head', { style: { padding: '6px 0 0' } },
      h('div.eyebrow', 'Ingredient'),
      h('h1', displayName(ing)),
      orig.length > 0 && h('div.place', 'On the menu as ', orig.map((o, k) => [k ? ', ' : '', h('i', o)]))),
    ing.untranslated && h('div.notice', h('p', 'This is still the menu’s own word. Tap the pencil to give it its English name.')),
    ing.notIngredient && h('div.notice', h('p', 'Marked as not an ingredient — hidden from the list.')),
    ing.note && h('div.profile-text', ing.note.split(/\n{2,}/).map((p) => h('p', p))),
    h('h3.section-title', list.length === 1 ? 'In one dish' : `In ${list.length} dishes`),
    list.length ? h('div.other-visits', { style: { marginTop: 0 } }, list.map(({ v, c, i }) => h('a', { href: `#/dish/${v.id}/${i}` },
      h('span', h('span.serif', { style: { fontSize: '19px' } }, c.dish), h('small', { style: { display: 'block' } }, [c.detail, whereWhen(v)].filter(Boolean).join(' — ')))))) : h('p.muted', 'Not on any menu any more.'),
  ));
  window.scrollTo(0, 0);
}

export function renderIngredientEdit(root, id) {
  const orig = store.get('ingredients', id);
  if (!orig) { location.replace('#/dishes/ingredients'); return; }
  const x = { name: orig.name || '', terms: (orig.terms || []).join('\n'), note: orig.note || '', notIngredient: !!orig.notIngredient };
  const nameIn = h('input.input.title-input', { value: x.name, placeholder: 'English name', oninput: (e) => { x.name = e.target.value; } });
  const termsIn = h('textarea.textarea.short', { oninput: (e) => { x.terms = e.target.value; } }); termsIn.value = x.terms;
  const noteIn = h('textarea.textarea.short', { placeholder: 'What it is, where it comes from…', oninput: (e) => { x.note = e.target.value; } }); noteIn.value = x.note;
  const hide = h('input', { type: 'checkbox', checked: x.notIngredient, onchange: (e) => { x.notIngredient = e.target.checked; } });
  const others = store.list('ingredients').filter((i) => i.id !== id && !i.notIngredient).sort((a, b) => a.name.localeCompare(b.name));
  const mergeSel = h('select.input', h('option', { value: '' }, 'Choose an ingredient…'), others.map((i) => h('option', { value: i.id }, displayName(i))));

  async function save() {
    const name = x.name.trim();
    if (!name) { toast('Give it a name'); return; }
    const terms = [...new Set(x.terms.split('\n').map(termKey).filter(Boolean))];
    // Another ingredient already called this? Then it is the same one: fold together.
    const twin = store.list('ingredients').find((i) => i.id !== id && termKey(i.name) === termKey(name));
    await store.save('ingredients', id, { name, terms, note: x.note.trim() || undefined, notIngredient: x.notIngredient || undefined, untranslated: undefined });
    if (twin) { await mergeIngredient(id, twin.id); toast(`Joined with ${displayName(twin)}`); location.hash = `#/ingredient/${twin.id}`; return; }
    toast('Saved');
    location.hash = `#/ingredient/${id}`;
  }
  async function merge() {
    const into = store.get('ingredients', mergeSel.value);
    if (!into) { toast('Choose one first'); return; }
    if (!(await confirmSheet(`Join with ${displayName(into)}?`, `“${displayName(orig)}” becomes part of “${displayName(into)}”, with all its dishes.`, 'Join'))) return;
    await mergeIngredient(id, into.id);
    location.hash = `#/ingredient/${into.id}`;
  }

  root.replaceChildren(h('div.page',
    h('div.topbar',
      h('a.icon-btn', { href: `#/ingredient/${id}`, 'aria-label': 'Cancel' }, icon('close')),
      h('span.eyebrow', 'Edit ingredient'),
      h('button.text-btn', { type: 'button', onclick: save }, 'Save')),
    h('div.field', h('label', 'Name in English'), nameIn),
    h('div.field', h('label', 'Written on menus as'), termsIn,
      h('p.hint', 'One per line. Remove a line to split it off into an ingredient of its own; add one to gather it here.')),
    h('div.field', h('label', 'Note'), noteIn),
    h('label.check-row', hide, h('span', 'Not an ingredient (a dish name, a technique…) — hide it')),
    h('div.field', { style: { marginTop: '22px' } }, h('label', 'Same as another ingredient?'), mergeSel,
      h('button.btn.small.ghost', { type: 'button', style: { marginTop: '8px' }, onclick: merge }, 'Join them')),
    h('button.btn.primary.block', { type: 'button', onclick: save, style: { marginTop: '20px' } }, 'Save'),
  ));
  window.scrollTo(0, 0);
}
