// Dishes and ingredients, derived from the menus (visit.courses).
//
// A course is { dish: 'Parelhoen', detail: 'daslook, aligot, groene olijf' }.
// Its ingredients are the dish name plus each comma-separated part of the
// detail, as written on the menu ("terms"). Ingredient records hold the
// English name and the terms that mean it, so one ingredient page gathers
// "parelhoen", "pintade" and "guinea fowl" alike. Terms nobody has catalogued
// yet get a record automatically, translated with the built-in dictionary when
// it knows the words; the rest is fixed by hand or by Claude.

import * as store from './store.js';

export const termKey = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();

// "witte asperge 'Dikker'" → "witte asperge"; "Intens ember 81%" → "Intens ember".
function cleanTerm(s) {
  return (s || '')
    .replace(/['‘’"“”][^'‘’"“”]*['‘’"“”]/g, ' ')
    .replace(/^[*•·\-–\s]+/, '')
    .replace(/\b\d+\s*(%|g|gr|cl|ml|weken|dagen|maanden|jaar|days|weeks|months|years)?(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function termsOf(course) {
  const parts = [course.dish, ...String(course.detail || '').split(/\s*[,;\/]\s*|\s+\+\s+/)];
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const text = cleanTerm(p);
    const key = termKey(text);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, key });
  }
  return out;
}

// Every course of every visit, newest visit first.
export function allCourses() {
  const out = [];
  for (const v of store.visits()) {
    (v.courses || []).forEach((c, i) => { if (c?.dish) out.push({ v, c, i }); });
  }
  return out;
}

// term key → ingredient record (hidden "not an ingredient" ones included).
export function termIndex() {
  const idx = new Map();
  for (const ing of store.list('ingredients')) {
    for (const t of ing.terms || []) if (!idx.has(t)) idx.set(t, ing);
    const own = termKey(ing.name);
    if (own && !idx.has(own)) idx.set(own, ing);
  }
  return idx;
}

export function ingredientsOfCourse(c, idx = termIndex()) {
  const out = [];
  for (const t of termsOf(c)) {
    const ing = idx.get(t.key);
    if (ing && !ing.notIngredient && !out.includes(ing)) out.push(ing);
  }
  return out;
}

export function coursesWith(ingId) {
  const idx = termIndex();
  return allCourses().filter(({ c }) => termsOf(c).some((t) => idx.get(t.key)?.id === ingId));
}

// ---------- translation ----------

// Dutch, French, Italian and Spanish kitchen words → English.
const DICT = {
  // poultry, game & meat
  parelhoen: 'guinea fowl', pintade: 'guinea fowl', faraona: 'guinea fowl', kip: 'chicken', poulet: 'chicken', hoen: 'chicken',
  volaille: 'poultry', gevogelte: 'poultry', poularde: 'poularde', duif: 'pigeon', duifje: 'pigeon', pigeon: 'pigeon', pigeonneau: 'squab',
  eend: 'duck', canard: 'duck', anatra: 'duck', eendenlever: 'duck liver', gans: 'goose', kwartel: 'quail', caille: 'quail',
  fazant: 'pheasant', faisan: 'pheasant', patrijs: 'partridge', perdrix: 'partridge', haas: 'hare', lievre: 'hare', konijn: 'rabbit', lapin: 'rabbit',
  hert: 'venison', ree: 'roe deer', reebok: 'roe deer', chevreuil: 'roe deer', everzwijn: 'wild boar', wildzwijn: 'wild boar', sanglier: 'wild boar',
  rund: 'beef', rundvlees: 'beef', boeuf: 'beef', manzo: 'beef', kalf: 'veal', kalfsvlees: 'veal', veau: 'veal', vitello: 'veal',
  lam: 'lamb', lamsvlees: 'lamb', agneau: 'lamb', agnello: 'lamb', varken: 'pork', varkensvlees: 'pork', porc: 'pork', maiale: 'pork',
  speenvarken: 'suckling pig', zwezerik: 'sweetbread', zwezeriken: 'sweetbreads', 'ris de veau': 'veal sweetbread', lever: 'liver', foie: 'liver',
  tong: 'tongue', rundstong: 'beef tongue', spek: 'bacon', lard: 'lardo', ham: 'ham', jambon: 'ham', prosciutto: 'prosciutto', worst: 'sausage',
  merg: 'bone marrow', mergpijp: 'marrow bone', rundsvet: 'beef fat', vet: 'fat', jus: 'jus', bouillon: 'stock', fond: 'stock', consomme: 'consommé',
  wagyu: 'wagyu', tartaar: 'tartare', carpaccio: 'carpaccio', dubbeldoel: 'Dubbeldoel beef',
  // fish & seafood
  vis: 'fish', poisson: 'fish', paling: 'eel', aal: 'eel', anguille: 'eel', zalm: 'salmon', saumon: 'salmon', forel: 'trout', truite: 'trout',
  beekridder: 'brook char', zeebaars: 'sea bass', bar: 'sea bass', loup: 'sea bass', branzino: 'sea bass', kabeljauw: 'cod', cabillaud: 'cod',
  tarbot: 'turbot', turbot: 'turbot', griet: 'brill', barbue: 'brill', tong_fish: 'sole', zeetong: 'sole', sole: 'sole', schol: 'plaice',
  makreel: 'mackerel', maquereau: 'mackerel', haring: 'herring', hareng: 'herring', sardine: 'sardine', sardines: 'sardines', ansjovis: 'anchovy', anchois: 'anchovy', acciughe: 'anchovies',
  tonijn: 'tuna', thon: 'tuna', tonno: 'tuna', balfego: 'Balfegó bluefin tuna', zeeduivel: 'monkfish', lotte: 'monkfish', rog: 'skate', raie: 'skate',
  heilbot: 'halibut', zeebrasem: 'sea bream', dorade: 'sea bream', poon: 'gurnard', rouget: 'red mullet', mul: 'red mullet', snoekbaars: 'pike-perch', snoek: 'pike',
  kreeft: 'lobster', homard: 'lobster', langoest: 'spiny lobster', langouste: 'spiny lobster', langoustine: 'langoustine', langoustines: 'langoustines', scampi: 'langoustine',
  krab: 'crab', crabe: 'crab', 'king crab': 'king crab', koningskrab: 'king crab', garnaal: 'shrimp', garnalen: 'shrimps', grijze: 'brown', 'grijze garnalen': 'brown shrimps', crevette: 'prawn', crevettes: 'prawns',
  oester: 'oyster', oesters: 'oysters', huitre: 'oyster', huitres: 'oysters', mossel: 'mussel', mosselen: 'mussels', moules: 'mussels',
  'sint-jakobsvrucht': 'scallop', 'sint jakobsvrucht': 'scallop', 'sint-jakobsvruchten': 'scallops', 'coquille saint-jacques': 'scallop', 'saint-jacques': 'scallop', jakobsschelp: 'scallop', coquilles: 'scallops',
  scheermes: 'razor clam', scheermessen: 'razor clams', couteau: 'razor clam', couteaux: 'razor clams', kokkel: 'cockle', kokkels: 'cockles', venusschelp: 'clam', palourde: 'clam', vongole: 'clams',
  inktvis: 'squid', calamar: 'squid', pijlinktvis: 'squid', octopus: 'octopus', poulpe: 'octopus', zeekat: 'cuttlefish', seiche: 'cuttlefish',
  zee_egel: 'sea urchin', zeeegel: 'sea urchin', 'zee-egel': 'sea urchin', oursin: 'sea urchin', ricci: 'sea urchin', kaviaar: 'caviar', caviar: 'caviar', oscietra: 'Oscietra caviar',
  kuit: 'roe', eitjes: 'roe', foreleitjes: 'trout roe', zalmeitjes: 'salmon roe', bottarga: 'bottarga', poutargue: 'bottarga',
  // vegetables
  groente: 'vegetable', groenten: 'vegetables', legumes: 'vegetables', asperge: 'asparagus', asperges: 'asparagus', 'witte asperge': 'white asparagus', 'groene asperge': 'green asparagus',
  artisjok: 'artichoke', artichaut: 'artichoke', carciofo: 'artichoke', pompoen: 'pumpkin', potiron: 'pumpkin', courge: 'squash', zucca: 'pumpkin', butternut: 'butternut squash',
  knolselder: 'celeriac', 'celeri-rave': 'celeriac', celeri: 'celery', selder: 'celery', bleekselder: 'celery', wortel: 'carrot', wortelen: 'carrots', worteltjes: 'carrots', carotte: 'carrot', carottes: 'carrots',
  biet: 'beetroot', rode_biet: 'beetroot', 'rode biet': 'beetroot', bietjes: 'beetroot', betterave: 'beetroot', pastinaak: 'parsnip', panais: 'parsnip', koolrabi: 'kohlrabi', raap: 'turnip', navet: 'turnip', rapen: 'turnips',
  radijs: 'radish', radijsjes: 'radishes', radis: 'radish', ui: 'onion', uien: 'onions', ajuin: 'onion', oignon: 'onion', cipolla: 'onion', sjalot: 'shallot', echalote: 'shallot',
  lente_ui: 'spring onion', 'lente-ui': 'spring onion', prei: 'leek', poireau: 'leek', knoflook: 'garlic', ail: 'garlic', aglio: 'garlic', daslook: 'wild garlic', 'ail des ours': 'wild garlic',
  bloemkool: 'cauliflower', 'chou-fleur': 'cauliflower', broccoli: 'broccoli', kool: 'cabbage', chou: 'cabbage', spitskool: 'pointed cabbage', savooi: 'savoy cabbage', rodekool: 'red cabbage', spruitjes: 'Brussels sprouts',
  witloof: 'chicory', chicon: 'chicory', endive: 'endive', andijvie: 'endive', spinazie: 'spinach', epinard: 'spinach', epinards: 'spinach', sla: 'lettuce', salade: 'salad', rucola: 'rocket', roquette: 'rocket',
  waterkers: 'watercress', cresson: 'watercress', tuinkers: 'cress', postelein: 'purslane', zuring: 'sorrel', oseille: 'sorrel', venkel: 'fennel', fenouil: 'fennel', finocchio: 'fennel',
  tomaat: 'tomato', tomaten: 'tomatoes', tomate: 'tomato', tomates: 'tomatoes', pomodoro: 'tomato', paprika: 'bell pepper', poivron: 'bell pepper', aubergine: 'aubergine', courgette: 'courgette', komkommer: 'cucumber', concombre: 'cucumber',
  erwt: 'pea', erwten: 'peas', erwtjes: 'peas', doperwten: 'peas', petits_pois: 'peas', 'petits pois': 'peas', boon: 'bean', bonen: 'beans', haricot: 'bean', haricots: 'beans', tuinboon: 'broad bean', tuinbonen: 'broad beans', 'feves': 'broad beans',
  mais: 'corn', aardappel: 'potato', aardappelen: 'potatoes', aardappels: 'potatoes', 'pomme de terre': 'potato', 'pommes de terre': 'potatoes', patata: 'potato', zoete_aardappel: 'sweet potato', 'zoete aardappel': 'sweet potato', topinamboer: 'Jerusalem artichoke', aardpeer: 'Jerusalem artichoke', topinambour: 'Jerusalem artichoke',
  champignon: 'mushroom', champignons: 'mushrooms', paddenstoel: 'mushroom', paddenstoelen: 'mushrooms', cantharel: 'chanterelle', cantharellen: 'chanterelles', girolles: 'girolles', eekhoorntjesbrood: 'porcini', cepes: 'porcini', cepe: 'porcini', porcini: 'porcini', morielje: 'morel', morieljes: 'morels', morilles: 'morels', shiitake: 'shiitake',
  truffel: 'truffle', truffels: 'truffles', truffe: 'truffle', tartufo: 'truffle', 'zwarte truffel': 'black truffle', 'witte truffel': 'white truffle',
  zeekraal: 'samphire', salicorne: 'samphire', zeegroenten: 'sea vegetables', zeewier: 'seaweed', algues: 'seaweed', zeelavas: 'sea lettuce', lamsoor: 'sea lavender', 'zee-aster': 'sea aster', zeeaster: 'sea aster', codium: 'codium seaweed', kombu: 'kombu', nori: 'nori', wakame: 'wakame',
  olijf: 'olive', olijven: 'olives', olive: 'olive', olives: 'olives', oliva: 'olive', 'groene olijf': 'green olive', 'zwarte olijf': 'black olive', kappertjes: 'capers', kapper: 'caper', capres: 'capers',
  mierikswortel: 'horseradish', raifort: 'horseradish', peen: 'carrot', kervelknol: 'chervil root', schorseneer: 'salsify', schorseneren: 'salsify', salsifis: 'salsify', hop: 'hop', hopscheuten: 'hop shoots',
  // fruit & nuts
  appel: 'apple', appels: 'apples', pomme: 'apple', mela: 'apple', 'groene appel': 'green apple', peer: 'pear', peren: 'pears', poire: 'pear', pera: 'pear', kweepeer: 'quince', coing: 'quince',
  aardbei: 'strawberry', aardbeien: 'strawberries', fraise: 'strawberry', fraises: 'strawberries', fragola: 'strawberry', framboos: 'raspberry', frambozen: 'raspberries', framboise: 'raspberry',
  braam: 'blackberry', bramen: 'blackberries', mure: 'blackberry', bosbes: 'blueberry', bosbessen: 'blueberries', myrtille: 'blueberry', blauwe_bes: 'blueberry', aalbes: 'redcurrant', aalbessen: 'redcurrants', 'rode bes': 'redcurrant', cassis: 'blackcurrant', 'zwarte bes': 'blackcurrant',
  kers: 'cherry', kersen: 'cherries', cerise: 'cherry', cerises: 'cherries', ciliegia: 'cherry', pruim: 'plum', pruimen: 'plums', prune: 'plum', mirabel: 'mirabelle', mirabelle: 'mirabelle', abrikoos: 'apricot', abricot: 'apricot', perzik: 'peach', peche: 'peach', nectarine: 'nectarine',
  rabarber: 'rhubarb', rhubarbe: 'rhubarb', vijg: 'fig', vijgen: 'figs', figue: 'fig', druif: 'grape', druiven: 'grapes', raisin: 'grape', meloen: 'melon', melon: 'melon', watermeloen: 'watermelon',
  citroen: 'lemon', citron: 'lemon', limone: 'lemon', limoen: 'lime', 'citron vert': 'lime', sinaasappel: 'orange', appelsien: 'orange', orange: 'orange', mandarijn: 'mandarin', pompelmoes: 'grapefruit', pamplemousse: 'grapefruit', yuzu: 'yuzu', bergamot: 'bergamot', bergamote: 'bergamot', citrus: 'citrus', agrumes: 'citrus',
  ananas: 'pineapple', mango: 'mango', mangue: 'mango', passievrucht: 'passion fruit', 'fruit de la passion': 'passion fruit', banaan: 'banana', banane: 'banana', kokos: 'coconut', 'noix de coco': 'coconut', lychee: 'lychee', granaatappel: 'pomegranate', grenade: 'pomegranate',
  amandel: 'almond', amandelen: 'almonds', amande: 'almond', amandes: 'almonds', mandorla: 'almond', hazelnoot: 'hazelnut', hazelnoten: 'hazelnuts', noisette: 'hazelnut', noisettes: 'hazelnuts', nocciola: 'hazelnut', walnoot: 'walnut', walnoten: 'walnuts', noix: 'walnut', noot: 'nut', noten: 'nuts',
  pistache: 'pistachio', pistachenoot: 'pistachio', pinda: 'peanut', pindas: 'peanuts', cacahuete: 'peanut', pecannoot: 'pecan', kastanje: 'chestnut', kastanjes: 'chestnuts', marron: 'chestnut', chataigne: 'chestnut', pijnboompitten: 'pine nuts', pignons: 'pine nuts',
  // herbs & spices
  dille: 'dill', aneth: 'dill', bieslook: 'chives', ciboulette: 'chives', peterselie: 'parsley', persil: 'parsley', prezzemolo: 'parsley', kervel: 'chervil', cerfeuil: 'chervil', dragon: 'tarragon', estragon: 'tarragon',
  basilicum: 'basil', basilic: 'basil', basilico: 'basil', munt: 'mint', menthe: 'mint', tijm: 'thyme', thym: 'thyme', rozemarijn: 'rosemary', romarin: 'rosemary', salie: 'sage', sauge: 'sage', laurier: 'bay leaf',
  koriander: 'coriander', coriandre: 'coriander', citroengras: 'lemongrass', citronnelle: 'lemongrass', lavendel: 'lavender', lavande: 'lavender', vlierbloesem: 'elderflower', sureau: 'elderberry', venkelzaad: 'fennel seed',
  gember: 'ginger', gingembre: 'ginger', zenzero: 'ginger', kurkuma: 'turmeric', kaneel: 'cinnamon', cannelle: 'cinnamon', nootmuskaat: 'nutmeg', muscade: 'nutmeg', kardemom: 'cardamom', cardamome: 'cardamom', kruidnagel: 'clove', steranijs: 'star anise', anijs: 'anise',
  saffraan: 'saffron', safran: 'saffron', zafferano: 'saffron', peper: 'pepper', poivre: 'pepper', pepe: 'pepper', piment: 'chilli', chili: 'chilli', 'piment d\'espelette': 'Espelette pepper', jalapeno: 'jalapeño', mosterd: 'mustard', moutarde: 'mustard', senape: 'mustard', tierenteyn: 'Tierenteyn mustard',
  vanille: 'vanilla', vaniglia: 'vanilla', zout: 'salt', sel: 'salt', sale: 'salt', zeezout: 'sea salt', 'fleur de sel': 'fleur de sel', suiker: 'sugar', sucre: 'sugar', zucchero: 'sugar', honing: 'honey', miel: 'honey', miele: 'honey',
  sesam: 'sesame', sesame: 'sesame', 'zwarte sesam': 'black sesame', 'witte sesam': 'white sesame', zwarte_knoflook: 'black garlic', 'zwarte knoflook': 'black garlic', 'ail noir': 'black garlic', azijn: 'vinegar', vinaigre: 'vinegar', aceto: 'vinegar', balsamico: 'balsamic vinegar',
  // dairy, eggs, grains
  boter: 'butter', beurre: 'butter', burro: 'butter', 'beurre blanc': 'beurre blanc', 'beurre noisette': 'brown butter', bruine_boter: 'brown butter', 'bruine boter': 'brown butter', room: 'cream', creme: 'cream', crema: 'cream', panna: 'cream',
  'zure room': 'sour cream', 'creme fraiche': 'crème fraîche', 'creme cru': 'raw cream', 'creme crue': 'raw cream', melk: 'milk', lait: 'milk', latte: 'milk', karnemelk: 'buttermilk', babeurre: 'buttermilk', yoghurt: 'yoghurt', yaourt: 'yoghurt', schapenyoghurt: "sheep's yoghurt", geitenyoghurt: "goat's yoghurt",
  kaas: 'cheese', fromage: 'cheese', formaggio: 'cheese', geitenkaas: "goat's cheese", 'chevre': "goat's cheese", parmezaan: 'Parmesan', parmigiano: 'Parmesan', comte: 'Comté', ricotta: 'ricotta', burrata: 'burrata', mozzarella: 'mozzarella', mascarpone: 'mascarpone',
  ei: 'egg', eieren: 'eggs', oeuf: 'egg', oeufs: 'eggs', uovo: 'egg', eigeel: 'egg yolk', eidooier: 'egg yolk', dooier: 'egg yolk', jaune: 'egg yolk', kwartelei: 'quail egg', kwarteleitjes: 'quail eggs',
  brood: 'bread', pain: 'bread', pane: 'bread', zuurdesem: 'sourdough', brioche: 'brioche', rijst: 'rice', riz: 'rice', riso: 'rice', risotto: 'risotto', koshihikari: 'Koshihikari rice', pasta: 'pasta', gnocchi: 'gnocchi', polenta: 'polenta',
  boekweit: 'buckwheat', sarrasin: 'buckwheat', gerst: 'barley', orge: 'barley', haver: 'oats', spelt: 'spelt', quinoa: 'quinoa', linzen: 'lentils', lentilles: 'lentils', kikkererwten: 'chickpeas', pois_chiches: 'chickpeas',
  meel: 'flour', bloem: 'flour', farine: 'flour',
  // sweets & other
  chocolade: 'chocolate', chocolat: 'chocolate', cioccolato: 'chocolate', 'witte chocolade': 'white chocolate', 'pure chocolade': 'dark chocolate', cacao: 'cocoa', koffie: 'coffee', cafe: 'coffee', caffe: 'coffee', thee: 'tea', the: 'tea', matcha: 'matcha',
  karamel: 'caramel', caramel: 'caramel', praline: 'praline', nougat: 'nougat', meringue: 'meringue', schuim: 'foam', ijs: 'ice cream', roomijs: 'ice cream', glace: 'ice cream', gelato: 'gelato', sorbet: 'sorbet', granite: 'granita', granita: 'granita',
  olijfolie: 'olive oil', 'huile d\'olive': 'olive oil', olio: 'oil', olie: 'oil', huile: 'oil', miso: 'miso', broodmiso: 'bread miso', soja: 'soy', sojasaus: 'soy sauce', ponzu: 'ponzu', 'ajuin ponzu': 'onion ponzu', dashi: 'dashi', 'gerookte dashi': 'smoked dashi', tsukudani: 'tsukudani', yuba: 'yuba', tofu: 'tofu', sake: 'sake', mirin: 'mirin',
  'foie gras': 'foie gras', ganzenlever: 'foie gras', aligot: 'aligot', 'creme brulee': 'crème brûlée', gazpacho: 'gazpacho', 'frozen gazpacho': 'frozen gazpacho', chawanmushi: 'chawanmushi', chawanmushee: 'chawanmushi', 'gravad lax': 'gravad lax', crudo: 'crudo', 'crudo d\'ete': 'crudo', tartelette: 'tartlet', taartje: 'tartlet',
  'vin jaune': 'vin jaune', wijn: 'wine', vin: 'wine', bier: 'beer', biere: 'beer', cider: 'cider', cidre: 'cider', jenever: 'genever',
  olijvencake: 'olive cake', 'lente- en zeegroenten': 'spring and sea vegetables', 'bbq kers': 'barbecued cherry',
};
// Words that only describe: translated, but never an ingredient on their own.
const ADJ = {
  groene: 'green', groen: 'green', witte: 'white', wit: 'white', zwarte: 'black', zwart: 'black', rode: 'red', rood: 'red', gele: 'yellow', paarse: 'purple', bruine: 'brown',
  gerookte: 'smoked', gerookt: 'smoked', fume: 'smoked', fumee: 'smoked', affumicato: 'smoked', gegrilde: 'grilled', gegrild: 'grilled', grille: 'grilled', bbq: 'barbecued', gebrande: 'burnt', gebrand: 'burnt', brule: 'burnt',
  gefermenteerde: 'fermented', gefermenteerd: 'fermented', fermente: 'fermented', gepekelde: 'brined', gezouten: 'salted', gekonfijte: 'candied', gekonfijt: 'confit', confit: 'confit', gepofte: 'baked', gebakken: 'fried', gefrituurde: 'fried', krokante: 'crispy', krokant: 'crispy',
  zure: 'sour', zuur: 'sour', zoete: 'sweet', zoet: 'sweet', bittere: 'bitter', zilte: 'briny', verse: 'fresh', vers: 'fresh', frais: 'fresh', fraiche: 'fresh', jonge: 'young', jong: 'young', oude: 'aged', wilde: 'wild', wild: 'wild', sauvage: 'wild', rauwe: 'raw', rauw: 'raw', cru: 'raw', crue: 'raw',
  europese: 'European', noordzee: 'North Sea', zeeuwse: 'Zeeland', belgische: 'Belgian', ijslandse: 'Icelandic', japanse: 'Japanese', intens: 'intense', intense: 'intense', lente: 'spring', zomer: 'summer', herfst: 'autumn', winter: 'winter',
};

// English name for a term as written on a menu, or null when some word is unknown.
export function translate(text) {
  const key = termKey(text);
  if (DICT[key]) return DICT[key];
  const words = text.split(/\s+/);
  const out = [];
  for (const w of words) {
    const k = termKey(w);
    if (!k) continue;
    if (DICT[k]) out.push(DICT[k]);
    else if (ADJ[k]) out.push(ADJ[k]);
    else if (/^[A-ZÀ-Ý]/.test(w) && words.length > 1) out.push(w); // a proper name: Zoommeer, Gariguette
    else if (/^(en|et|and|e|y|met|avec|with|di|de|du|des|van|la|le|les|au|aux|a|à|x)$/i.test(k)) out.push(k === 'met' || k === 'avec' ? 'with' : k === 'x' ? '×' : /^(en|et|e|y)$/.test(k) ? 'and' : k);
    else return null;
  }
  return out.join(' ').trim() || null;
}

// ---------- catalogue ----------

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const displayName = (ing) => ing ? titleCase(ing.name || '') : '';

// Make sure every term on every menu belongs to an ingredient record.
let running = null;
export function catalogueIngredients() {
  running ||= (async () => {
    try {
      const idx = termIndex();
      const byName = new Map(store.list('ingredients').map((i) => [termKey(i.name), i]));
      for (const { c } of allCourses()) {
        for (const t of termsOf(c)) {
          if (idx.has(t.key)) continue;
          const en = translate(t.text);
          const name = en || t.text.toLowerCase();
          const existing = byName.get(termKey(name));
          if (existing) {
            await store.save('ingredients', existing.id, { terms: [...(existing.terms || []), t.key] });
            idx.set(t.key, existing);
            continue;
          }
          const id = store.newId();
          const rec = await store.save('ingredients', id, { name, terms: [t.key], ...(en ? {} : { untranslated: true }) });
          idx.set(t.key, rec); byName.set(termKey(name), rec);
        }
      }
      await mergeDuplicateIngredients();
    } finally { running = null; }
  })();
  return running;
}

// Two phones cataloguing the same new menu create two records: fold them together.
export async function mergeDuplicateIngredients() {
  const all = store.list('ingredients').sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  const keep = new Map();
  for (const ing of all) {
    const k = termKey(ing.name);
    const first = keep.get(k);
    if (!first) { keep.set(k, ing); continue; }
    await mergeIngredient(ing.id, first.id);
  }
}

export async function mergeIngredient(fromId, intoId) {
  const from = store.get('ingredients', fromId), into = store.get('ingredients', intoId);
  if (!from || !into || from === into) return;
  const terms = [...new Set([...(into.terms || []), ...(from.terms || []), termKey(from.name)])];
  const patch = { terms };
  if (!into.note && from.note) patch.note = from.note;
  await store.save('ingredients', into.id, patch);
  await store.save('ingredients', from.id, { deleted: true, terms: [] });
}
