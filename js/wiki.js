// Public-source lookups for chef bios and wine profiles (Wikipedia, CORS-enabled).
// Searches English and Dutch first, then other languages. An article in another
// language is swapped for the same article in English or Dutch when one exists
// (see inOwnLanguage); otherwise the caller translates it.

const LANGS = ['en', 'nl', 'fr', 'de', 'it', 'es'];
export const OWN_LANGS = ['en', 'nl'];
export const LANG_NAMES = { en: 'English', nl: 'Dutch', fr: 'French', de: 'German', it: 'Italian', es: 'Spanish' };

// The English or Dutch version of an article, if Wikipedia has one: { lang, title } or null.
export async function inOwnLanguage(lang, title) {
  if (OWN_LANGS.includes(lang)) return { lang, title };
  try {
    const j = await api(lang, { action: 'query', prop: 'langlinks', titles: title, redirects: '1', lllimit: '500' });
    const links = Object.values(j.query.pages)[0]?.langlinks || [];
    for (const l of OWN_LANGS) { const hit = links.find((x) => x.lang === l); if (hit) return { lang: l, title: hit['*'] }; }
  } catch { /* fall through */ }
  return null;
}

function api(lang, params) {
  const q = new URLSearchParams({ format: 'json', origin: '*', ...params });
  return fetch(`https://${lang}.wikipedia.org/w/api.php?${q}`).then((r) => {
    if (!r.ok) throw new Error('Wikipedia unavailable');
    return r.json();
  });
}

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");

// Returns [{ lang, title, snippet }]
export async function search(term, hint = '') {
  const results = await Promise.all(LANGS.map(async (lang) => {
    try {
      const j = await api(lang, { action: 'query', list: 'search', srsearch: `${term} ${hint}`.trim(), srlimit: '2' });
      return j.query.search.map((s) => ({ lang, title: s.title, snippet: stripTags(s.snippet) }));
    } catch { return []; }
  }));
  // Keep articles that actually mention the name (the hint words add noise), best first.
  const last = term.trim().split(/\s+/).pop().toLowerCase();
  const all = results.flat();
  const esc = last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const relevant = all.filter((r) => new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, 'iu').test(r.title + ' ' + r.snippet));
  return (relevant.length ? relevant : all)
    .sort((a, b) => (b.title.toLowerCase().includes(term.toLowerCase())) - (a.title.toLowerCase().includes(term.toLowerCase())));
}

// Full text trimmed to a readable one-pager, plus a portrait and the source link.
export async function article(lang, title, maxChars = 2200) {
  const j = await api(lang, {
    action: 'query', prop: 'extracts|pageimages|info', inprop: 'url', explaintext: '1',
    exsectionformat: 'plain', pithumbsize: '600', titles: title, redirects: '1',
  });
  const page = Object.values(j.query.pages)[0];
  const paras = (page.extract || '').split(/\n+/).map((p) => p.trim())
    .filter((p) => p.length > 60); // drop headings and stubs
  let text = '';
  for (const p of paras) {
    if (text && text.length + p.length > maxChars) break;
    text += (text ? '\n\n' : '') + p;
  }
  return {
    text,
    image: page.thumbnail?.source || null,
    source: { title: page.title, url: page.fullurl, lang, site: `${lang}.wikipedia.org` },
  };
}

// Structured facts from Wikidata for the article: birth, education, training,
// workplaces, awards and other occupations (e.g. television presenter).
const P = { born: 'P569', birthplace: 'P19', educated: 'P69', studentOf: 'P1066', employer: 'P108', awards: 'P166', occupation: 'P106' };

export async function facts(lang, title) {
  const j = await api(lang, { action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: title, redirects: '1' });
  const qid = Object.values(j.query.pages)[0]?.pageprops?.wikibase_item;
  if (!qid) return {};
  const wd = (params) => fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`).then((r) => r.json());
  const ent = (await wd({ action: 'wbgetentities', ids: qid, props: 'claims' })).entities[qid];
  const claims = ent?.claims || {};
  const values = (pid) => (claims[pid] || []).map((c) => ({ v: c.mainsnak?.datavalue?.value, q: c.qualifiers || {} })).filter((x) => x.v);
  const ids = new Set();
  for (const pid of [P.birthplace, P.educated, P.studentOf, P.employer, P.awards, P.occupation]) for (const x of values(pid)) ids.add(x.v.id);
  const labels = {};
  const list = [...ids];
  for (let i = 0; i < list.length; i += 45) {
    const r = await wd({ action: 'wbgetentities', ids: list.slice(i, i + 45).join('|'), props: 'labels', languages: `en|${lang}|fr|nl` });
    for (const [id, e] of Object.entries(r.entities || {})) labels[id] = e.labels?.en?.value || e.labels?.[lang]?.value || Object.values(e.labels || {})[0]?.value || '';
  }
  const year = (q, pid) => q[pid]?.[0]?.datavalue?.value?.time?.slice(1, 5);
  const named = (pid, withYears) => values(pid).map(({ v, q }) => {
    const n = labels[v.id]; if (!n) return '';
    const from = year(q, 'P580') || year(q, 'P585'), to = year(q, 'P582');
    return withYears && (from || to) ? `${n} (${[from, to].filter(Boolean).join('–')})` : n;
  }).filter(Boolean).join(', ');
  const bv = values(P.born)[0]?.v;
  let born = '';
  if (bv?.time) {
    const [y, m, d] = bv.time.slice(1, 11).split('-').map(Number);
    const opts = { year: 'numeric', timeZone: 'UTC', ...(bv.precision >= 10 ? { month: 'long' } : {}), ...(bv.precision >= 11 ? { day: 'numeric' } : {}) };
    born = bv.precision >= 10 ? new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString('en-GB', opts) : String(y);
  }
  const place = named(P.birthplace);
  const occ = values(P.occupation).map(({ v }) => labels[v.id]).filter((o) => o && !/^(chef|cook|restaurateur)$/i.test(o));
  return {
    born: [born, place].filter(Boolean).join(', '),
    education: named(P.educated, true),
    trainedWith: named(P.studentOf),
    restaurants: named(P.employer, true),
    awards: named(P.awards, true),
    notable: occ.length ? `Also ${occ.join(', ')}` : '',
  };
}
