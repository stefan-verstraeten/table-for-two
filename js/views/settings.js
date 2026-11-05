import * as store from '../store.js';
import { h, toast, confirmSheet } from '../ui.js';
import { settings } from '../db.js';
import { PEOPLE, APP_VERSION } from '../config.js';
import { connectForm } from './onboarding.js';
import { checkForUpdate } from '../updates.js';
import * as claude from '../claude.js';

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
      h('h3.eyebrow', 'Claude (optional)'),
      h('p.muted', { style: { fontSize: '13px' } }, 'With an Anthropic API key, Claude researches chef bios and wine profiles across the web, and reads menus and wine lists from your photos. The key stays on this phone. A research costs a few cents.'),
      h('div.kv', h('span', 'Key'), h('span', claude.hasKey() ? 'Set on this phone' : 'Not set')),
      h('div.row-buttons',
        h('button.btn.ghost.small', { onclick: () => showClaudeKey(root) }, claude.hasKey() ? 'Change key' : 'Add a key'),
        claude.hasKey() && h('button.btn.ghost.small', { onclick: () => { settings.set('claudeKey', ''); toast('Key removed'); renderSettings(root); } }, 'Remove'),
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

function showClaudeKey(root) {
  const input = h('input.input', { type: 'password', placeholder: 'sk-ant-…', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const err = h('p.error-text');
  const btn = h('button.btn.primary.block', { type: 'button', onclick: async () => {
    const key = input.value.trim();
    if (!key) return;
    btn.disabled = true; btn.textContent = 'Checking…'; err.textContent = '';
    try {
      await claude.checkKey(key);
      settings.set('claudeKey', key);
      toast('Claude is ready'); renderSettings(root);
    } catch (e) {
      err.textContent = e?.status === 401 ? 'That key was not accepted.' : `Could not check the key (${e?.message || 'offline?'}).`;
      btn.disabled = false; btn.textContent = 'Save key';
    }
  } }, 'Save key');
  root.replaceChildren(h('div.page.settings',
    h('div.topbar', h('button.text-btn', { onclick: () => renderSettings(root) }, '‹ Settings')),
    h('h1', 'Claude key'),
    h('ol.steps',
      h('li', 'Go to ', h('a', { href: 'https://platform.claude.com/settings/keys', target: '_blank', rel: 'noopener' }, 'platform.claude.com → API keys'), ' and sign in.'),
      h('li', 'Create a key named “Table for Two” and copy it.'),
      h('li', 'Paste it below. Do this on each phone.')),
    h('form', { onsubmit: (e) => { e.preventDefault(); btn.click(); } }, h('div.field', h('label', 'API key'), input), err, btn),
  ));
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
