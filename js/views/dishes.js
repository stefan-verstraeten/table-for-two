// Dishes (every course on every menu, A–Z) and ingredients (every ingredient
// on those menus, in English, each listing back to the dishes it was in),
// with the tools to straighten out what menus and photo-reading get wrong.

import * as store from '../store.js';
import { h, icon, toast, confirmSheet, formatDate, sheet } from '../ui.js';
import { backBar, sortName } from './lane.js';
import * as claude from '../claude.js';
import {
  allCourses, termsOf, termIndex, ingredientsOfCourse, coursesWith, displayName, termKey, mergeIngredient,
  catalogueIngredients, renameTerm, splitTerm, unsplit, setHidden, splitRules, translate, suggestCuts,
} from '../ingredients.js';
import { highlightButton } from './highlights.js';
import { azList } from './azlist.js';

let tab = 'dishes';

const whereWhen = (v) => [store.restaurant(v.restaurantId)?.name, formatDate(v.date, { short: true })].filter(Boolean).join(' · ');
const letterOf = (s) => { const l = sortName(s).normalize('NFD')[0]?.toUpperCase() || '#'; return /[A-Z]/.test(l) ? l : '#'; };
const nice = (s) => (s && s === s.toUpperCase() && /[A-Z]{2}/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : s || '');

function azGroups(rows, nameOf) {
  const groups = new Map();
  for (const r of rows.sort((a, b) => sortName(nameOf(a)).localeCompare(sortName(nameOf(b)), 'en', { sensitivity: 'base' }))) {
    const k = letterOf(nameOf(r));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
}

const toCheck = (counts) => store.list('ingredients').filter((i) => i.untranslated && !i.notIngredient && !i.rule && counts.get(i.id));

function ingredientCounts(courses, idx) {
  const counts = new Map();
  for (const { c } of courses) for (const ing of ingredientsOfCourse(c, idx)) counts.set(ing.id, (counts.get(ing.id) || 0) + 1);
  return counts;
}

export function renderDishes(root, which) {
  if (which === 'ingredients' || which === 'dishes') tab = which;
  const courses = allCourses();
  const idx = termIndex();
  const counts = ingredientCounts(courses, idx);
  const ingredients = store.list('ingredients').filter((i) => !i.notIngredient && counts.get(i.id));
  if (courses.some(({ c }) => termsOf(c, idx).some((t) => !idx.has(t.key)))) catalogueIngredients().catch(console.error);
  const check = toCheck(counts);
  const hidden = store.list('ingredients').filter((i) => i.notIngredient && !i.rule);
  const rules = splitRules();

  const seg = h('div.segmented', { style: { margin: '0 0 18px' } },
    [['dishes', `Dishes (${courses.length})`], ['ingredients', `Ingredients (${ingredients.length})`]].map(([id, label]) =>
      h(`button${tab === id ? '.on' : ''}`, { onclick: () => { tab = id; renderDishes(root); } }, label)));

  let body;
  if (!courses.length) {
    body = h('p.muted', 'Dishes appear here once a visit has its courses filled in — typed, pasted, or read from a photo of the menu.');
  } else if (tab === 'dishes') {
    const groups = azGroups(courses, (x) => x.c.dish);
    body = [
      h('p.hint', { style: { marginTop: 0 } }, 'Tap a dish, then “Fix this dish” to correct its name, details or ingredients.'),
      azList('dishes', [...groups].map(([k, list]) => ({
        id: k, jump: k, head: h('div.year-head', h('h2', k)),
        rows: list.map(({ v, c, i }) => ({
          text: [c.dish, c.detail, whereWhen(v), ...ingredientsOfCourse(c, idx).map((x) => x.name)].join(' '),
          el: h('a.az-row', { href: `#/dish/${v.id}/${i}` },
            h('span', h('b.serif', nice(c.dish)), h('small', [c.detail, whereWhen(v)].filter(Boolean).join(' — '))),
            highlightedBadge(v.id, i)),
        })),
      })), { placeholder: 'Find a dish, ingredient or restaurant' }),
    ];
  } else {
    const groups = azGroups(ingredients, displayName);
    body = [
      check.length > 0 && h('div.notice',
        h('p', `${check.length} ingredient${check.length > 1 ? 's are' : ' is'} still in the menu’s own words.`),
        h('div.hl-actions', { style: { marginTop: 0 } },
          h('a.btn.small.accent', { href: '#/ingredient-review' }, 'Go through them'),
          claude.hasKey() && h('button.btn.small.ghost', { onclick: () => translateWithClaude(check) }, icon('sparkle'), 'Translate with Claude'))),
      azList('ingredients', [...groups].map(([k, list]) => ({
        id: k, jump: k, head: h('div.year-head', h('h2', k)),
        rows: list.map((ing) => {
          const orig = originals(ing);
          return {
            text: [ing.name, ...orig].join(' '),
            el: h('a.az-row', { href: `#/ingredient/${ing.id}` },
              h('span', h('b.serif', displayName(ing)), h('small', orig.join(', ') || '—')),
              h('span.az-meta', ing.untranslated && h('span.badge-state.draft', 'Check'), h('small', `${counts.get(ing.id)} dish${counts.get(ing.id) > 1 ? 'es' : ''}`))),
          };
        }),
      })), { placeholder: 'Find an ingredient (English or as on the menu)' }),
      (hidden.length > 0 || rules.length > 0) && h('details.tidy-box',
        h('summary', 'Hidden and split'),
        hidden.length > 0 && h('div',
          h('h4', 'Not ingredients (hidden)'),
          hidden.sort((a, b) => a.name.localeCompare(b.name)).map((ing) => h('div.tidy-row',
            h('span', displayName(ing)),
            h('button.text-btn', { onclick: async () => { await store.save('ingredients', ing.id, { notIngredient: undefined, edited: true }); toast('Shown again'); } }, 'Show again')))),
        rules.length > 0 && h('div',
          h('h4', 'Split into separate ingredients'),
          rules.map((r) => h('div.tidy-row',
            h('span', h('i', r.name), ' → ', (r.splitInto || []).join(' + ')),
            h('button.text-btn', { onclick: async () => { await unsplit(r.id); toast('Joined again'); } }, 'Undo'))))),
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
  const idx = termIndex();
  const shown = new Map();
  for (const { c } of allCourses()) for (const t of termsOf(c, idx)) if (idx.get(t.key)?.id === ing.id && t.key !== name) shown.set(t.key, t.text.toLowerCase());
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
      await renameTerm({ key: termKey(ing.name), text: ing.name }, r.english);
      if (r.note && !ing.note) await store.save('ingredients', ing.id, { note: r.note });
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
    h('div.topbar',
      h('a.text-btn.back-link', { href: '#/dishes' }, '‹ ', 'Dishes'),
      h('a.icon-btn', { href: `#/dish-edit/${v.id}/${i}`, 'aria-label': 'Fix this dish', style: { marginRight: '-10px' } }, icon('edit'))),
    h('div.visit-head', { style: { padding: '6px 0 0' } },
      h('div.eyebrow', `Course ${i + 1} of ${n}`),
      h('h1', nice(c.dish)),
      c.detail && h('div.place', { style: { fontStyle: 'italic' } }, c.detail),
      h('div.when', h('a.link', { href: `#/visit/${v.id}` }, r?.name), ' · ', formatDate(v.date))),
    h('div.ornament', '· · ·'),
    h('h3.section-title', 'Ingredients'),
    ings.length > 0 ? h('div.chip-list', ings.map((ing) => h('a.chip', { href: `#/ingredient/${ing.id}` }, displayName(ing), ing.untranslated && h('span.chip-q', '?'))))
      : h('p.muted', 'None found yet.'),
    h('a.btn.small.ghost', { href: `#/dish-edit/${v.id}/${i}`, style: { marginTop: '14px' } }, icon('edit'), 'Fix this dish'),
    highlightButton({ kind: 'dish', visitId: v.id, course: i, title: c.dish }),
    h('div.dish-nav',
      i > 0 ? h('a.link', { href: `#/dish/${v.id}/${i - 1}` }, '‹ ', nice(v.courses[i - 1].dish)) : h('span'),
      i < n - 1 ? h('a.link', { href: `#/dish/${v.id}/${i + 1}` }, nice(v.courses[i + 1].dish), ' ›') : h('span')),
    same.length > 0 && h('div.other-visits',
      h('h3.section-title', 'Also on these menus'),
      same.map((x) => h('a', { href: `#/dish/${x.v.id}/${x.i}` }, h('span.serif', { style: { fontSize: '19px' } }, whereWhen(x.v))))),
  ));
  window.scrollTo(0, 0);
}

// ---------- fixing a dish ----------
// Every correction is saved the moment it is made, so there is nothing to lose.
export function renderDishEdit(root, visitId, index) {
  const i = Number(index);
  const v0 = store.visit(visitId);
  if (!v0?.courses?.[i]) { location.replace('#/dishes'); return; }
  const c0 = v0.courses[i];
  const draft = { dish: c0.dish || '', detail: c0.detail || '' };

  const saveCourse = async (patch) => {
    const v = store.visit(visitId);
    const courses = JSON.parse(JSON.stringify(v.courses));
    const c = { ...courses[i], ...patch };
    for (const k of ['removed', 'extra']) if (!c[k]?.length) delete c[k];
    courses[i] = c;
    await store.save('visits', visitId, { courses });
    await catalogueIngredients();
  };
  const saveText = async () => {
    const c = store.visit(visitId).courses[i];
    if (draft.dish.trim() && (draft.dish.trim() !== c.dish || draft.detail.trim() !== (c.detail || ''))) {
      await saveCourse({ dish: draft.dish.trim(), detail: draft.detail.trim() });
      return true;
    }
    return false;
  };

  const list = h('div.fix-list');
  const removedBox = h('div');

  function draw() {
    const v = store.visit(visitId);
    const c = v.courses[i];
    const idx = termIndex();
    const terms = termsOf(c, idx);
    list.replaceChildren(...terms.map((t, k) => {
      const ing = idx.get(t.key);
      const name = ing ? displayName(ing) : (translate(t.text) || t.text);
      const state = ing?.notIngredient ? 'hidden' : ing?.untranslated ? 'check' : '';
      return h(`button.fix-row${state ? '.' + state : ''}`, { type: 'button', onclick: () => rowActions(t, terms[k + 1], ing) },
        h('span',
          h('b', name),
          h('small', t.added ? 'added by us' : t.from ? `from “${t.from.toLowerCase()}”` : termKey(name) !== t.key ? `on the menu: ${t.text.toLowerCase()}` : 'as on the menu',
            state === 'hidden' ? ' · hidden, not an ingredient' : state === 'check' ? ' · still to translate' : '')),
        h('span.fix-more', '⋯'));
    }));
    const removed = (c.removed || []);
    removedBox.replaceChildren(removed.length ? h('div.tidy-box.open',
      h('h4', 'Taken out of this dish'),
      removed.map((key) => h('div.tidy-row', h('span', key),
        h('button.text-btn', { type: 'button', onclick: async () => { await saveCourse({ removed: removed.filter((x) => x !== key) }); draw(); } }, 'Put back')))) : '');
  }

  function rowActions(t, next, ing) {
    const c = store.visit(visitId).courses[i];
    const words = t.text.split(/\s+/).filter(Boolean);
    const act = (label, fn, opts = {}) => h(`button${opts.danger ? '.danger' : ''}`, { type: 'button', onclick: async () => { s.close(); await fn(); draw(); } },
      h('span', label, opts.sub && h('small', opts.sub)));
    const s = sheet(h('div.action-sheet',
      h('h3.serif', ing ? displayName(ing) : t.text),
      h('p.muted', t.added ? 'Added by you to this dish.' : `On the menu as “${t.text.toLowerCase()}”.`),
      h('div.place-list',
        ing?.untranslated && act('It’s right as it is', async () => { await store.save('ingredients', ing.id, { untranslated: undefined, edited: true }); toast('Kept as it is'); }, { sub: 'The word is the same in English' }),
        act('Rename', () => renameFlow(t), { sub: 'The English name — changes it on every menu' }),
        words.length > 1 && act('Split into separate ingredients', () => splitFlow(t), { sub: `e.g. ${words.join(' + ')} — on every menu` }),
        next && act(`Join with “${next.text.toLowerCase()}”`, async () => {
          await saveCourse({ removed: [...(c.removed || []), t.key, next.key], extra: [...(c.extra || []).filter((x) => termKey(x) !== t.key && termKey(x) !== next.key), `${t.text} ${next.text}`] });
          toast('Joined in this dish');
        }, { sub: 'They are one ingredient here' }),
        act('Not in this dish', async () => {
          if (t.added) await saveCourse({ extra: (c.extra || []).filter((x) => termKey(x) !== t.key) });
          else await saveCourse({ removed: [...(c.removed || []), t.key] });
          toast('Taken out of this dish');
        }, { sub: 'Only here; other menus keep it' }),
        ing?.notIngredient
          ? act('Show it as an ingredient again', async () => { await setHidden(t, false); toast('Shown again'); })
          : act('Not an ingredient at all', async () => { await setHidden(t, true); toast('Hidden everywhere'); }, { sub: 'A dish name, a technique, a price… hidden on every menu' }),
        ing && !ing.rule && act('Open its ingredient page', () => { location.hash = `#/ingredient/${ing.id}`; }),
      )));
  }

  async function renameFlow(t) {
    const idx = termIndex();
    const ing = idx.get(t.key);
    const name = await ask(`English name for “${t.text.toLowerCase()}”`, ing && !ing.untranslated ? ing.name : (translate(t.text) || ''),
      'If another ingredient already has this name, the two become one.');
    if (name == null) return;
    const rec = await renameTerm(t, name, idx);
    toast(rec && termKey(rec.name) === termKey(name) ? `Now “${displayName(rec)}”` : 'Saved');
    draw();
  }

  async function splitFlow(t) {
    const parts = await splitSheet(t.text);
    if (!parts) return;
    await splitTerm(t, parts);
    toast(`Split into ${parts.length} — on every menu`);
    draw();
  }

  const dishIn = h('input.input.title-input', { value: draft.dish, oninput: (e) => { draft.dish = e.target.value; } });
  const detailIn = h('textarea.textarea.short', { oninput: (e) => { draft.detail = e.target.value; } });
  detailIn.value = draft.detail;
  const addIn = h('input.input', { placeholder: 'e.g. black truffle', enterkeyhint: 'done' });
  const add = async () => {
    const text = addIn.value.trim();
    if (!text) return;
    const c = store.visit(visitId).courses[i];
    if ((c.removed || []).includes(termKey(text))) await saveCourse({ removed: c.removed.filter((x) => x !== termKey(text)) });
    else await saveCourse({ extra: [...(c.extra || []), text] });
    addIn.value = ''; draw(); toast('Added to this dish');
  };
  addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  const done = async () => { if (await saveText()) toast('Saved'); location.hash = `#/dish/${visitId}/${i}`; };

  draw();
  root.replaceChildren(h('div.page',
    h('div.topbar',
      h('a.icon-btn', { href: `#/dish/${visitId}/${i}`, 'aria-label': 'Back' }, icon('close')),
      h('span.eyebrow', 'Fix this dish'),
      h('button.text-btn', { type: 'button', onclick: done }, 'Done')),
    h('div.field', h('label', 'The dish'), dishIn),
    h('div.field', h('label', 'As written on the menu'), detailIn,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '8px' } },
        h('p.hint', { style: { margin: 0 } }, 'Fix typos here. Separate ingredients with commas.'),
        h('button.btn.small.ghost', { type: 'button', onclick: async () => { if (await saveText()) { toast('Menu line saved'); draw(); } else toast('Nothing changed'); } }, 'Save line'))),
    h('h3.section-title', 'Ingredients'),
    h('p.hint', { style: { marginTop: '-6px' } }, 'Tap one to rename, split, join or remove it. Changes are saved straight away.'),
    list,
    h('div.fix-add', addIn, h('button.btn.small.ghost', { type: 'button', onclick: add }, icon('plus'), 'Add')),
    removedBox,
  ));
  window.scrollTo(0, 0);
}

// A one-line question in a sheet. Resolves to the text, or null when cancelled.
function ask(title, value = '', hint = '') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.close(); resolve(v); } };
    const input = h('input.input', { value, enterkeyhint: 'done', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value.trim() || null); } } });
    const s = sheet(h('div.confirm',
      h('h3.serif', title),
      input,
      hint && h('p.hint', hint),
      h('div.row-buttons',
        h('button.btn.ghost', { type: 'button', onclick: () => finish(null) }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onclick: () => finish(input.value.trim() || null) }, 'Save'))),
    { onClose: () => finish(null) });
    setTimeout(() => { input.focus(); input.select(); }, 320);
  });
}

// Choose where to cut "amandel kokosnoot" → ["amandel", "kokosnoot"]: tap the
// gaps between the words. Resolves to the parts, or null when cancelled.
function splitSheet(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const cuts = suggestCuts(text);
  if (!cuts.some(Boolean)) cuts.forEach((_, k) => { cuts[k] = k > 0; });
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.close(); resolve(v); } };
    const parts = () => {
      const out = [];
      words.forEach((w, k) => { if (k === 0 || cuts[k]) out.push(w); else out[out.length - 1] += ' ' + w; });
      return out;
    };
    const row = h('div.split-words');
    const preview = h('p.split-preview');
    const draw = () => {
      row.replaceChildren(...words.flatMap((w, k) => [
        k > 0 && h(`button.split-gap${cuts[k] ? '.on' : ''}`, { type: 'button', 'aria-label': cuts[k] ? 'Keep together' : 'Cut here', onclick: () => { cuts[k] = !cuts[k]; draw(); } }, cuts[k] ? '✂' : '·'),
        h('span.split-word', w.toLowerCase()),
      ].filter(Boolean)));
      const p = parts();
      preview.replaceChildren(...p.flatMap((x, k) => [k ? ' + ' : '', h('b', translate(x) || x.toLowerCase())]));
      ok.disabled = p.length < 2;
    };
    const ok = h('button.btn.primary', { type: 'button', onclick: () => finish(parts()) }, 'Split');
    const s = sheet(h('div.confirm',
      h('h3.serif', 'Split into separate ingredients'),
      h('p.muted', 'Tap between two words to cut there or keep them together. This applies wherever it is on a menu.'),
      row, preview,
      h('div.row-buttons', h('button.btn.ghost', { type: 'button', onclick: () => finish(null) }, 'Cancel'), ok)),
    { onClose: () => finish(null) });
    draw();
  });
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
    ing.untranslated && h('div.notice', h('p', 'This is still the menu’s own word. Tap the pencil to give it its English name, or split it if it is really two ingredients.')),
    ing.notIngredient && h('div.notice', h('p', 'Marked as not an ingredient — hidden from the list.')),
    ing.note && h('div.profile-text', ing.note.split(/\n{2,}/).map((p) => h('p', p))),
    h('h3.section-title', list.length === 1 ? 'In one dish' : `In ${list.length} dishes`),
    list.length ? h('div.other-visits', { style: { marginTop: 0 } }, list.map(({ v, c, i }) => h('a', { href: `#/dish/${v.id}/${i}` },
      h('span', h('span.serif', { style: { fontSize: '19px' } }, nice(c.dish)), h('small', { style: { display: 'block' } }, [c.detail, whereWhen(v)].filter(Boolean).join(' — ')))))) : h('p.muted', 'Not on any menu any more.'),
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
  const others = store.list('ingredients').filter((i) => i.id !== id && !i.notIngredient && !i.rule).sort((a, b) => a.name.localeCompare(b.name));
  const mergeSel = h('select.input', h('option', { value: '' }, 'Choose an ingredient…'), others.map((i) => h('option', { value: i.id }, displayName(i))));
  // Menu words of this ingredient that have more than one word: candidates for a split.
  const idx = termIndex();
  const splittable = new Map();
  for (const { c } of allCourses()) for (const t of termsOf(c, idx)) if (idx.get(t.key)?.id === id && t.text.includes(' ')) splittable.set(t.key, t);
  if (!splittable.size && orig.name.includes(' ')) splittable.set(termKey(orig.name), { key: termKey(orig.name), text: orig.name });

  async function save() {
    const name = x.name.trim();
    if (!name) { toast('Give it a name'); return; }
    const terms = [...new Set(x.terms.split('\n').map(termKey).filter(Boolean))];
    // Another ingredient already called this? Then it is the same one: fold together.
    const twin = store.list('ingredients').find((i) => i.id !== id && !i.rule && termKey(i.name) === termKey(name));
    await store.save('ingredients', id, { name, terms, note: x.note.trim() || undefined, notIngredient: x.notIngredient || undefined, untranslated: undefined, edited: true });
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
  async function split(t) {
    const parts = await splitSheet(t.text);
    if (!parts) return;
    await splitTerm(t, parts);
    toast(`Split into ${parts.length} — on every menu`);
    location.hash = '#/dishes/ingredients';
  }

  root.replaceChildren(h('div.page',
    h('div.topbar',
      h('a.icon-btn', { href: `#/ingredient/${id}`, 'aria-label': 'Cancel' }, icon('close')),
      h('span.eyebrow', 'Edit ingredient'),
      h('button.text-btn', { type: 'button', onclick: save }, 'Save')),
    h('div.field', h('label', 'Name in English'), nameIn,
      h('p.hint', 'Give it the name of an existing ingredient and the two become one.')),
    splittable.size > 0 && h('div.field', h('label', 'Really more than one ingredient?'),
      [...splittable.values()].map((t) => h('button.btn.small.ghost', { type: 'button', style: { margin: '0 8px 8px 0' }, onclick: () => split(t) }, '✂ Split “', t.text.toLowerCase(), '”'))),
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

// ---------- going through the ones to check, one at a time ----------
const skipped = new Set();
export function renderIngredientReview(root) {
  const idx = termIndex();
  const counts = ingredientCounts(allCourses(), idx);
  const queue = toCheck(counts).filter((i) => !skipped.has(i.id)).sort((a, b) => a.name.localeCompare(b.name));
  const ing = queue[0];
  if (!ing) {
    root.replaceChildren(h('div.page', backBar('#/dishes/ingredients', 'Ingredients'),
      h('div.visit-head', h('h1', 'All done'), h('p.muted', skipped.size ? `${skipped.size} skipped for now.` : 'Every ingredient has its English name.')),
      skipped.size > 0 && h('button.btn.ghost.block', { onclick: () => { skipped.clear(); renderIngredientReview(root); } }, 'Go through the skipped ones'),
      h('a.btn.primary.block', { href: '#/dishes/ingredients', style: { marginTop: '10px' } }, 'Back to the ingredients')));
    return;
  }
  const t = { key: termKey(ing.name), text: ing.name };
  const uses = coursesWith(ing.id);
  const nameIn = h('input.input.title-input', { value: translate(ing.name) || '', placeholder: 'English name', enterkeyhint: 'done',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); saveName(); } } });
  const next = () => renderIngredientReview(root);
  const many = ing.name.split(/\s+/).length >= 3 && suggestCuts(ing.name).filter(Boolean).length >= 1;
  const splitNow = async () => {
    const parts = await splitSheet(ing.name);
    if (!parts) return;
    await splitTerm(t, parts); toast(`Split into ${parts.length}`); next();
  };
  async function saveName() {
    const name = nameIn.value.trim();
    if (!name) { toast('Type the English name, or skip'); nameIn.focus(); return; }
    await renameTerm(t, name);
    toast(`“${ing.name}” → ${name}`); next();
  }

  root.replaceChildren(h('div.page',
    h('div.topbar',
      h('a.text-btn.back-link', { href: '#/dishes/ingredients' }, '‹ ', 'Ingredients'),
      h('span.eyebrow', `${queue.length} to go`)),
    h('div.visit-head', { style: { padding: '10px 0 0' } },
      h('div.eyebrow', 'On the menu'),
      h('h1', ing.name)),
    h('div.review-context', uses.slice(0, 3).map(({ v, c }) => h('p', h('b', nice(c.dish)), c.detail ? ` — ${c.detail}` : '', h('small', whereWhen(v))))),
    h('div.field', h('label', 'In English'), nameIn),
    many && h('div.notice', h('p', 'This looks like several ingredients in a row.'),
      h('button.btn.small.accent', { type: 'button', onclick: () => splitNow() }, '✂ Split it up')),
    h('button.btn.primary.block', { type: 'button', onclick: saveName }, 'Save and next'),
    h('div.review-more',
      !many && ing.name.includes(' ') && h('button.btn.small.ghost', { type: 'button', onclick: async () => {
        const parts = await splitSheet(ing.name);
        if (!parts) return;
        await splitTerm(t, parts); toast(`Split into ${parts.length}`); next();
      } }, '✂ It’s more than one'),
      h('button.btn.small.ghost', { type: 'button', onclick: async () => { await setHidden(t, true); toast('Hidden — not an ingredient'); next(); } }, 'Not an ingredient'),
      h('button.btn.small.ghost', { type: 'button', onclick: async () => { await store.save('ingredients', ing.id, { untranslated: undefined, edited: true }); toast('Kept as it is'); next(); } }, 'Keep as it is'),
      h('button.btn.small.ghost', { type: 'button', onclick: () => { skipped.add(ing.id); next(); } }, 'Skip')),
  ));
  window.scrollTo(0, 0);
  setTimeout(() => nameIn.focus(), 200);
}
