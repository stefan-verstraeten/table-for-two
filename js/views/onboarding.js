import { h } from '../ui.js';
import { settings } from '../db.js';
import { PEOPLE, DEFAULT_DATA_REPO } from '../config.js';
import { createClient } from '../github.js';

export const MARK_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="38" cy="50" r="21" fill="none" stroke="#762B35" stroke-width="1.6"/>
  <circle cx="62" cy="50" r="21" fill="none" stroke="#762B35" stroke-width="1.6"/>
  <circle cx="38" cy="50" r="14.5" fill="none" stroke="#C9BBA8" stroke-width="0.8"/>
  <circle cx="62" cy="50" r="14.5" fill="none" stroke="#C9BBA8" stroke-width="0.8"/>
</svg>`;

export function renderWelcome(root, done) {
  const mark = h('div.mark', { html: MARK_SVG });
  const page = h('div.welcome',
    mark,
    h('h1', 'Table for Two'),
    h('p.eyebrow.tagline', 'A shared gastronomic journal'),
    h('h2', 'Who is at the table?'),
    h('div.who', PEOPLE.map((p) => h('button', {
      onclick: () => { settings.set('user', p); renderConnect(root, done); },
    }, p))),
  );
  root.replaceChildren(page);
}

export function connectForm({ onDone, showSkip = true }) {
  const repoInput = h('input.input', { value: settings.get('repo') || DEFAULT_DATA_REPO, autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const tokenInput = h('input.input', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', value: settings.get('token') || '' });
  const msg = h('p.error-text');
  const btn = h('button.btn.primary.block', { type: 'submit' }, 'Connect');

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const repo = repoInput.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
      const token = tokenInput.value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { msg.textContent = 'Use the form owner/name.'; return; }
      if (!token) { msg.textContent = 'Paste your access key first.'; return; }
      btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
      try {
        const info = await createClient({ repo, token }).checkAccess();
        if (!info.canPush) throw new Error('This key can read but not write. Give it “Contents: Read and write”.');
        settings.set('repo', repo);
        settings.set('token', token);
        onDone({ private: info.private });
      } catch (err) {
        msg.textContent = err.status === 401 ? 'GitHub did not accept this key.'
          : err.status === 404 ? 'Repository not found, or the key has no access to it.'
          : err.message || 'Could not connect.';
      } finally {
        btn.disabled = false; btn.textContent = 'Connect';
      }
    },
  },
    h('div.field', h('label', 'Journal repository'), repoInput,
      h('p.hint', 'The private GitHub repository that holds your journal and photos.')),
    h('div.field', h('label', 'GitHub access key'), tokenInput),
    msg,
    btn,
    showSkip && h('button.btn.ghost.block', { type: 'button', style: { marginTop: '10px' }, onclick: () => onDone(null) }, 'Skip for now — keep everything on this phone'),
    h('div.fine', { style: { marginTop: '26px' } },
      h('b', 'Making an access key (once per phone)'),
      h('ol',
        h('li', 'On github.com: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.'),
        h('li', 'Repository access: “Only select repositories” → your journal repository.'),
        h('li', 'Permissions → Repository → Contents: “Read and write”.'),
        h('li', 'Pick the longest expiry, generate, and paste it here. It stays on this phone only.'),
      )),
  );
  return form;
}

function renderConnect(root, done) {
  const who = settings.get('user');
  root.replaceChildren(h('div.welcome', { style: { justifyContent: 'flex-start' } },
    h('div.mark', { html: MARK_SVG, style: { width: '64px', height: '64px', marginBottom: '18px' } }),
    h('h2', `Welcome, ${who}.`),
    h('p.muted', { style: { margin: '-8px 0 30px' } }, 'Connect to your shared journal so both phones stay in step.'),
    connectForm({ onDone: (info) => {
      if (info && !info.private) alert('Note: this repository is public, so anyone can see your photos and notes. Consider making it private on GitHub.');
      done();
    } }),
  ));
}
