// Public-source lookups for chef bios and wine profiles (Wikipedia, CORS-enabled).
// Searches English first, then French and Dutch, which cover most Belgian chefs.

const LANGS = ['en', 'fr', 'nl'];

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
      const j = await api(lang, { action: 'query', list: 'search', srsearch: `${term} ${hint}`.trim(), srlimit: '3' });
      return j.query.search.map((s) => ({ lang, title: s.title, snippet: stripTags(s.snippet) }));
    } catch { return []; }
  }));
  return results.flat();
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
