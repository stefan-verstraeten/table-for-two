// Minimal GitHub REST client for reading/writing files in the data repo.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  return bytesToBase64(bytes);
}

export function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function blobToBase64(blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

export function createClient({ repo, token }) {
  const headers = (accept = 'application/vnd.github+json') => ({
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  });

  async function request(method, path, { body, accept } = {}) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { ...headers(accept), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch {}
      throw new GitHubError(res.status, msg);
    }
    return res;
  }

  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

  return {
    repo,

    async checkAccess() {
      const res = await request('GET', `/repos/${repo}`);
      const info = await res.json();
      return { private: info.private, canPush: !!info.permissions?.push, defaultBranch: info.default_branch };
    },

    // Returns { text, sha } or null when the file does not exist.
    async readText(path) {
      try {
        const res = await request('GET', `/repos/${repo}/contents/${enc(path)}`);
        const json = await res.json();
        if (json.encoding === 'base64' && json.content) {
          return { text: base64ToUtf8(json.content), sha: json.sha };
        }
        // Files > 1 MB come back without content: fetch the blob instead.
        const blob = await request('GET', `/repos/${repo}/git/blobs/${json.sha}`);
        const bj = await blob.json();
        return { text: base64ToUtf8(bj.content), sha: json.sha };
      } catch (e) {
        if (e.status === 404) return null;
        // An empty repository answers 404 too, but some endpoints say 409.
        if (e.status === 409) return null;
        throw e;
      }
    },

    async readBlob(path) {
      const res = await request('GET', `/repos/${repo}/contents/${enc(path)}`, {
        accept: 'application/vnd.github.raw+json',
      });
      const blob = await res.blob();
      const type = /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : blob.type;
      return type === blob.type ? blob : new Blob([blob], { type });
    },

    // Creates or updates a file. `sha` must be given when updating.
    async writeFile(path, base64Content, message, sha) {
      const res = await request('PUT', `/repos/${repo}/contents/${enc(path)}`, {
        body: { message, content: base64Content, ...(sha ? { sha } : {}) },
      });
      const json = await res.json();
      return json.content.sha;
    },

    async fileSha(path) {
      try {
        const res = await request('GET', `/repos/${repo}/contents/${enc(path)}`);
        return (await res.json()).sha;
      } catch (e) {
        if (e.status === 404 || e.status === 409) return null;
        throw e;
      }
    },
  };
}
