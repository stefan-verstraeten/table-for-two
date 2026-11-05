import * as store from '../store.js';
import { h, toast, confirmSheet } from '../ui.js';
import { settings } from '../db.js';
import { PEOPLE, APP_VERSION } from '../config.js';
import { connectForm } from './onboarding.js';
import { checkForUpdate } from '../updates.js';

export function renderSettings(root) {
  const s = store.getStatus();
  const who = settings.get('user');
  const page = h('div.page.settings',
    h('h1', 'Settings'),

    h('div.group',
      h('h3.eyebrow', 'You are'),
      h('div.segmented', PEOPLE.map((p) => h(`button${p === who ? '.on' : ''}`, {
        onclick: () => { settings.set('user', p); toast(`Now writing as ${p}`); renderSettings(root); },
      }, p))),
    ),

    h('div.group',
      h('h3.eyebrow', 'Sync'),
      h('div.kv', h('span', 'Journal'), h('span', settings.get('repo') && s.connected ? settings.get('repo') : 'Not connected')),
      h('div.kv', h('span', 'Status'), h('span', ({ idle: 'In sync', syncing: 'Syncing…', offline: 'Offline', local: 'On this phone only', error: 'Problem' })[s.state])),
      s.message && h('p.error-text', s.message),
      h('div.kv', h('span', 'Waiting to sync'), h('span', String(s.pending))),
      h('div.kv', h('span', 'Last synced'), h('span', s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('en-GB') : '—')),
      h('div.row-buttons',
        h('button.btn.ghost.small', { onclick: async () => { await store.sync(); renderSettings(root); toast('Synced'); } }, 'Sync now'),
        h('button.btn.ghost.small', { onclick: () => showConnect(root) }, s.connected ? 'Change key' : 'Connect'),
      ),
    ),

    h('div.group',
      h('h3.eyebrow', 'App'),
      h('div.kv', h('span', 'Version'), h('span', APP_VERSION)),
      h('div.row-buttons',
        h('button.btn.ghost.small', { onclick: async () => {
          const found = await checkForUpdate();
          if (!found) toast('You have the latest version');
        } }, 'Check for updates'),
      ),
    ),

    h('div.group',
      h('h3.eyebrow', 'Your data'),
      h('p.muted', { style: { fontSize: '13px' } }, 'Everything is stored in your GitHub repository as journal.json plus a photos folder.'),
      h('div.row-buttons',
        h('button.btn.ghost.small', { onclick: () => download() }, 'Download a copy'),
        h('button.btn.ghost.small', { onclick: async () => {
          if (s.pending) { toast('Sync your changes first'); return; }
          if (await confirmSheet('Reload from GitHub?', 'This clears this phone’s copy and downloads the journal again.', 'Reload')) {
            await store.resetLocal(); toast('Reloaded'); renderSettings(root);
          }
        } }, 'Reload from GitHub'),
      ),
    ),
  );
  root.replaceChildren(page);
}

function showConnect(root) {
  root.replaceChildren(h('div.page.settings',
    h('div.topbar', h('button.text-btn', { onclick: () => renderSettings(root) }, '‹ Settings')),
    h('h1', 'Connect'),
    connectForm({ showSkip: false, onDone: async () => { toast('Connected'); await store.sync(); renderSettings(root); } }),
  ));
}

function download() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'table-for-two-journal.json' });
  document.body.append(a); a.click(); a.remove();
}
