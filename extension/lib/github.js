// Minimal GitHub REST v3 client for the contents API.

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64DecodeUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHub {
  constructor({ token, owner, repo, branch }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || 'main';
  }

  async request(path, { method = 'GET', body } = {}) {
    const resp = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (resp.status === 404) return { status: 404, json: null };
    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = (json && json.message) || `HTTP ${resp.status}`;
      throw new Error(`GitHub API error: ${msg}`);
    }
    return { status: resp.status, json };
  }

  contentsPath(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `/repos/${this.owner}/${this.repo}/contents/${encoded}`;
  }

  // Returns { sha, text } or null if the file doesn't exist.
  async getFile(path) {
    const { status, json } = await this.request(`${this.contentsPath(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (status === 404 || !json || Array.isArray(json)) return null;
    return { sha: json.sha, text: b64DecodeUtf8(json.content || '') };
  }

  // Creates or updates a file. Pass sha when updating an existing file.
  async putFile(path, text, message, sha) {
    const body = {
      message,
      content: b64EncodeUtf8(text),
      branch: this.branch,
    };
    if (sha) body.sha = sha;
    const { json } = await this.request(this.contentsPath(path), { method: 'PUT', body });
    return json;
  }

  // Create-or-update convenience: fetches the current sha first.
  async upsertFile(path, text, message) {
    const existing = await this.getFile(path);
    if (existing && existing.text === text) return { skipped: true };
    return this.putFile(path, text, message, existing ? existing.sha : undefined);
  }

  async repoInfo() {
    const { status, json } = await this.request(`/repos/${this.owner}/${this.repo}`);
    if (status === 404) throw new Error('Repository not found (check owner/repo and token access).');
    return json;
  }
}
