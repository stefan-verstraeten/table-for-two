// Country names → two-letter codes (for flags), built from the browser's own
// list of country names in English, Dutch and French.

let index = null;
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

function build() {
  index = new Map();
  const names = ['en', 'nl', 'fr', 'it', 'es', 'de'].map((l) => { try { return new Intl.DisplayNames([l], { type: 'region' }); } catch { return null; } }).filter(Boolean);
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const a of A) for (const b of A) {
    const code = a + b;
    // Skip retired codes the browser maps onto today's (DD → DE, YU, SU…) and private-use ones.
    if (/^(AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN)$/.test(code)) continue;
    try { if (Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) continue; } catch { continue; }
    for (const dn of names) {
      let n; try { n = dn.of(code); } catch { continue; }
      if (n && n !== code && !index.has(norm(n))) index.set(norm(n), code);
    }
  }
  for (const [n, c] of [['usa', 'US'], ['united states of america', 'US'], ['uk', 'GB'], ['england', 'GB'], ['scotland', 'GB'], ['wales', 'GB'], ['holland', 'NL']]) index.set(n, c);
}

export function countryCode(name) {
  if (!name) return '';
  if (!index) build();
  return index.get(norm(name)) || '';
}
