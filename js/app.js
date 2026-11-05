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

const app = document.getElementById('app');
const view = h('main');
const tabs = h('nav.tabbar',
  h('a', { href: '#/', 'data-tab': 'home' }, icon('journal'), 'Journey'),
  h('a.add', { href: '#/new', 'data-tab': 'new', 'aria-label': 'Add a visit' }, icon('plus')),
  h('a', { href: '#/map', 'data-tab': 'map' }, icon('map'), 'Map'),
  h('a', { href: '#/settings', 'data-tab': 'settings' }, icon('settings'), 'You'),
);

let current = '';

function route() {
  const hash = location.hash || '#/';
  const [, name = '', id] = hash.slice(1).split('/');
  if (current === 'map' && name !== 'map') teardownMap();
  current = name || 'home';
  for (const a of tabs.querySelectorAll('a')) a.classList.toggle('active', a.dataset.tab === current);
  tabs.style.display = name === 'edit' || name === 'new' ? 'none' : '';

  switch (name) {
    case 'visit': return renderVisit(view, id);
    case 'edit': return renderEdit(view, id);
    case 'new': return renderEdit(view, null);
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
  if (['home', 'visit', 'map'].includes(current)) {
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
