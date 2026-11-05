import * as store from './store.js';
import { settings } from './db.js';
import { h, icon } from './ui.js';
import { renderWelcome } from './views/onboarding.js';
import { renderHome, syncPill } from './views/home.js';
import { renderVisit } from './views/visit.js';
import { renderEdit } from './views/edit.js';
import { renderMap, teardownMap } from './views/map.js';
import { renderSettings } from './views/settings.js';
import { registerUpdates } from './updates.js';
import { renderLane, renderRestaurants, renderRestaurant, goRandom } from './views/lane.js';
import { renderList, renderDetail, renderProfileEdit } from './views/profiles.js';
import { renderWishes } from './views/wishes.js';

const app = document.getElementById('app');
const view = h('main');
const tabs = h('nav.tabbar',
  h('a', { href: '#/', 'data-tab': 'home' }, icon('journal'), 'Journey'),
  h('a', { href: '#/lane', 'data-tab': 'lane' }, icon('lane'), 'Memory lane'),
  h('a.add', { href: '#/new', 'data-tab': 'new', 'aria-label': 'Add a visit' }, icon('plus')),
  h('a', { href: '#/map', 'data-tab': 'map' }, icon('map'), 'Map'),
  h('a', { href: '#/settings', 'data-tab': 'settings' }, icon('settings'), 'You'),
);

let current = '';
const EDITORS = ['edit', 'new', 'chef-edit', 'wine-edit'];

function route() {
  const hash = location.hash || '#/';
  const [, name = '', id] = hash.slice(1).split('/');
  if (current === 'map' && name !== 'map') teardownMap();
  current = name || 'home';
  const LANE = ['lane', 'restaurants', 'restaurant', 'chefs', 'chef', 'wines', 'wine', 'wishes'];
  const tab = LANE.includes(current) ? 'lane' : current;
  for (const a of tabs.querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === tab);
  tabs.style.display = EDITORS.includes(name) ? 'none' : '';

  switch (name) {
    case 'visit': return renderVisit(view, id);
    case 'edit': return renderEdit(view, id);
    case 'new': return renderEdit(view, null, id);
    case 'lane': return renderLane(view);
    case 'random': return goRandom();
    case 'restaurants': return renderRestaurants(view);
    case 'restaurant': return renderRestaurant(view, id);
    case 'chefs': return renderList(view, 'chefs');
    case 'chef': return renderDetail(view, 'chefs', id);
    case 'chef-edit': return renderProfileEdit(view, 'chefs', id);
    case 'wines': return renderList(view, 'wines');
    case 'wine': return renderDetail(view, 'wines', id);
    case 'wine-edit': return renderProfileEdit(view, 'wines', id);
    case 'wishes': return renderWishes(view);
    case 'map': return renderMap(view);
    case 'settings': return renderSettings(view);
    default: return renderHome(view);
  }
}

// Re-render read-only screens when data arrives from the other phone.
// Never re-render the editor: that would throw away what is being typed.
store.subscribe((kind) => {
  if (kind === 'status') {
    const pill = view.querySelector('.sync-pill');
    if (pill) pill.replaceWith(syncPill(store.getStatus()));
    if (current === 'settings' && !view.querySelector('form')) route();
    return;
  }
  if (!EDITORS.includes(current) && current !== 'random' && !(current === 'settings' && view.querySelector('form'))) {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }
});

function start() {
  app.replaceChildren(view, tabs);
  window.addEventListener('hashchange', route);
  route();
  store.sync();
  window.addEventListener('online', () => store.sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.sync();
  });
}

(async function boot() {
  await store.load();
  registerUpdates();
  if (!settings.get('user')) renderWelcome(app, start);
  else start();
})();
