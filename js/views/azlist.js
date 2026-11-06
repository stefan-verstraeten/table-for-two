// A long list with a type-in filter and a jump bar (letters, or flags for
// wines), kept at the top of the screen while scrolling.
//
// groups: [{ id, jump: 'A' | '🇫🇷', head: node, rows: [{ el, text }] }]
// Every word typed must appear somewhere in a row's text.

import { h } from '../ui.js';

const typed = {}; // per list, so the filter survives a re-render after a sync
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function azList(key, groups, { placeholder = 'Filter…' } = {}) {
  const sections = groups.map((g) => ({
    g,
    rows: g.rows.map((r) => ({ ...r, key: norm(r.text) })),
    sec: h('section.az-group', { id: `az-${key}-${g.id}` }, g.head, g.rows.map((r) => r.el)),
  }));
  const jumpBar = h('div.az-jump');
  const found = h('small.az-found');
  const apply = (q) => {
    typed[key] = q;
    const words = norm(q).split(/\s+/).filter(Boolean);
    let total = 0;
    const live = [];
    for (const s of sections) {
      let n = 0;
      for (const r of s.rows) { const ok = words.every((w) => r.key.includes(w)); r.el.hidden = !ok; if (ok) n++; }
      s.sec.hidden = !n;
      total += n;
      if (n) live.push(s);
    }
    jumpBar.replaceChildren(...(live.length > 1 ? live : []).map((s) => h('a', { href: '#', onclick: (e) => {
      e.preventDefault();
      const bar = tools.getBoundingClientRect().height;
      window.scrollTo({ top: window.scrollY + s.sec.getBoundingClientRect().top - bar - 12, behavior: 'smooth' });
    } }, s.g.jump)));
    found.textContent = words.length ? (total ? `${total} found` : 'Nothing found') : '';
  };
  const input = h('input.input.az-filter', {
    type: 'search', placeholder, value: typed[key] || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
    'data-az': key, oninput: (e) => apply(e.target.value),
  });
  const wasTyping = document.activeElement?.dataset?.az === key;
  apply(typed[key] || '');
  if (wasTyping) setTimeout(() => { input.focus(); const n = input.value.length; input.setSelectionRange(n, n); }, 0);
  const tools = h('div.az-tools', h('div.az-filter-row', input, found), jumpBar);
  return [tools, sections.map((s) => s.sec)];
}
