// Optional: Claude, for researching chef bios and wine profiles on the web and
// for reading menus and wine lists from photos. Needs an Anthropic API key,
// stored only on this phone (like the GitHub key). Without one, the app falls
// back to Wikipedia/Wikidata and to text you paste in yourselves.

import { settings } from './db.js';
import { blobToBase64 } from './github.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.0.0/+esm';
const MODEL = 'claude-opus-5-5';

export const hasKey = () => !!settings.get('claudeKey');

let sdk = null;
async function client() {
  const apiKey = settings.get('claudeKey');
  if (!apiKey) throw new Error('No Claude key on this phone');
  sdk ||= (await import(SDK_URL)).default;
  return new sdk({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

// One request; resumes server-tool turns that pause, returns the final text.
async function ask({ system, content, tools, effort = 'medium', maxTokens = 16000 }) {
  const c = await client();
  const messages = [{ role: 'user', content }];
  let withFallback = true;
  const send = () => c.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    thinking: { type: 'adaptive' },
    output_config: { effort },
    ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    ...(tools ? { tools } : {}),
    messages,
  });
  for (let i = 0; i < 5; i++) {
    let res;
    try {
      res = await send();
    } catch (e) {
      // If the fallback option is ever rejected for this request shape, go without it.
      if (withFallback && e?.status === 400 && /fallback/i.test(e.message || '')) { withFallback = false; res = await send(); }
      else throw e;
    }
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
    if (res.stop_reason === 'pause_turn') {
      messages.splice(1, messages.length - 1, { role: 'assistant', content: res.content });
      continue;
    }
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }
  throw new Error('Claude took too long');
}

// The last ```json … ``` block (or bare {...}) in a reply.
function lastJSON(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop();
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

const WEB_TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 },
];

const CHEF_SYSTEM = `You research chefs for a private, beautifully typeset journal kept by a couple who love fine dining.
Search the web (Michelin Guide, Gault&Millau, the restaurant's own site, reputable press in any language) and report only facts you found in sources. Never guess a date or a name; leave a field empty when the sources don't say.
Write in English, in a warm but factual magazine tone.`;

export async function researchChef(name, context = '') {
  const text = await ask({
    system: CHEF_SYSTEM,
    tools: WEB_TOOLS,
    content: `Research the chef ${name}${context ? ` (${context})` : ''}.

Finish your reply with one JSON object in a \`\`\`json block, with these string fields:
- "born": date and place of birth, e.g. "14 March 1983, Antwerp, Belgium" (or just the year if that is all you find)
- "education": culinary school(s) and years
- "trainedWith": the chefs and restaurants they trained or worked under, in order, e.g. "Sergio Herman (Oud Sluis), …"
- "restaurants": the restaurants they lead or led, with years
- "awards": Michelin stars (with years gained), Gault&Millau scores and titles, World's 50 Best, other prizes
- "notable": other noteworthy things — TV shows, books, signature style or dishes, family ties
- "bio": a short narrative bio of 120–200 words in two or three paragraphs separated by a blank line
- "sources": array of up to 5 URLs you relied on`,
  });
  return lastJSON(text);
}

const WINE_SYSTEM = `You research wines for a private journal kept by a couple who love fine dining.
Search the web (the producer's own site, importers, reputable wine press) and report only facts you found. Leave a field empty when unsure.
Write in English, in a warm but factual tone.`;

export async function researchWine(w) {
  const desc = [w.name, w.vintage, w.producer, w.region, w.country, w.grapes].filter(Boolean).join(', ');
  const text = await ask({
    system: WINE_SYSTEM,
    tools: WEB_TOOLS,
    content: `Research this wine: ${desc}.

Finish your reply with one JSON object in a \`\`\`json block, with these string fields:
- "producer", "region" (appellation), "country", "grapes", "style" (one of Red, White, Rosé, Sparkling, Sweet, Fortified, Orange)
- "profile": a one-page wine profile of 120–220 words in two or three paragraphs separated by a blank line: the producer and their philosophy, the vineyard and terroir, how the wine is made, and how it typically tastes
- "sources": array of up to 5 URLs you relied on`,
  });
  return lastJSON(text);
}

async function imageBlock(blob) {
  return { type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data: await blobToBase64(blob) } };
}

// Reads a photographed menu → [{ dish, detail }]
export async function readMenu(blob) {
  const text = await ask({
    effort: 'low',
    content: [await imageBlock(blob), { type: 'text', text: `This is a photo of a restaurant tasting menu. Transcribe the courses in the order they were served (for a two-column menu: the left column top to bottom, then the right column). Keep the original language and spelling. Leave out headings, dates and the guests' names.

Reply with only a \`\`\`json block: {"title": "menu title if printed, else empty", "courses": [{"dish": "Pompoen", "detail": "Zoommeer paling, tsukudani, gember"}]}` }],
  });
  return lastJSON(text);
}

// Reads a photographed wine list or pairing card → [{ name, vintage, producer, grapes, region, country, style }]
export async function readWineList(blob) {
  const text = await ask({
    effort: 'low',
    content: [await imageBlock(blob), { type: 'text', text: `This is a photo of the wines served with a restaurant meal (a pairing card, a wine list or a label). List every wine, in order.

For each: "name" (the cuvée or wine name, without the vintage; if the wine has no cuvée name use the appellation), "vintage" (year or empty), "producer", "grapes", "region" (appellation as printed), "country" (infer from the region when obvious), "style" (Red, White, Rosé, Sparkling, Sweet, Fortified or Orange — infer from grapes and region when reasonably sure, else empty).

Reply with only a \`\`\`json block: {"wines": [...]}` }],
  });
  return lastJSON(text).wines || [];
}

// A quick, cheap call to check a key works.
export async function checkKey(key) {
  sdk ||= (await import(SDK_URL)).default;
  const c = new sdk({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 0 });
  await c.models.retrieve(MODEL);
}
