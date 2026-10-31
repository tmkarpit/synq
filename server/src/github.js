import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// "Push to GitHub": saves a room's files to one of the user's GitHub repositories.
//
// The user connects once with a personal access token (classic, "repo" scope, or a
// fine-grained token with Contents + Administration write). It is checked with GitHub,
// then stored on the account ENCRYPTED (AES-256-GCM, key derived from JWT_SECRET) and
// never sent back to the browser.
//
// A push is one commit through GitHub's REST API (no git needed on the server): the
// tree is exactly the room's files, so files deleted in the room are deleted on GitHub.
// A repository that does not exist yet is created (private by default).

const API_VERSION = '2022-11-28';
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH = /^(?!\/|.*\/\/|.*\.\.|.*\/$)[A-Za-z0-9._/-]{1,100}$/;
const MAX_FILES = 2000;

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class GitHub {
  /**
   * users: the MongoDB users collection; secret: JWT_SECRET (the encryption key is
   * derived from it); apiBase / fetchImpl: GitHub's API (tests use a fake one).
   */
  constructor({ users, secret, apiBase = 'https://api.github.com', fetchImpl = fetch }) {
    this.users = users;
    this.key = createHash('sha256').update(`synq-github-token:${secret}`).digest();
    this.apiBase = apiBase.replace(/\/$/, '');
    this.fetch = fetchImpl;
  }

  encrypt(text) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }

  decrypt(box) {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  }

  async api(token, method, path, body) {
    let res;
    try {
      res = await this.fetch(`${this.apiBase}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': API_VERSION,
          'user-agent': 'SYNQ',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError(502, "Can't reach GitHub. Check the internet connection.");
    }
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new GitHubError(res.status, data.message || `GitHub answered ${res.status}.`);
      error.github = data;
      throw error;
    }
    return data;
  }

  /** Checks a token with GitHub and stores it (encrypted). Resolves { login }. */
  async connect(userId, rawToken) {
    const token = String(rawToken || '').trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) throw new GitHubError(400, 'That does not look like a GitHub token.');
    let me;
    try {
      me = await this.api(token, 'GET', '/user');
    } catch (err) {
      if (err.status === 401) throw new GitHubError(400, 'GitHub did not accept this token. Check it and try again.');
      throw err;
    }
    await this.users.updateOne({ _id: userId }, { $set: { github: { login: me.login, token: this.encrypt(token), connectedAt: new Date() } } });
    return { login: me.login };
  }

  async status(userId) {
    const user = await this.users.findOne({ _id: userId }, { projection: { 'github.login': 1 } });
    return { connected: !!user?.github?.login, login: user?.github?.login ?? null };
  }

  async disconnect(userId) {
    await this.users.updateOne({ _id: userId }, { $unset: { github: '' } });
  }

  async tokenOf(userId) {
    const user = await this.users.findOne({ _id: userId }, { projection: { github: 1 } });
    if (!user?.github?.token) throw new GitHubError(400, 'Connect your GitHub account first.');
    try {
      return { token: this.decrypt(user.github.token), login: user.github.login };
    } catch {
      throw new GitHubError(400, 'Your GitHub connection needs to be set up again.');
    }
  }

  /**
   * Pushes files [{ path, content }] as one commit. repo is "name" (your account) or
   * "owner/name". Resolves { repo, branch, url, commitUrl, created, files }.
   */
  async push(userId, { repo, isPrivate = true, branch = '', message = '', files = [] }) {
    const { token, login } = await this.tokenOf(userId);
    const [owner, name] = String(repo || '').includes('/') ? String(repo).split('/', 2) : [login, String(repo || '')];
    if (!REPO_NAME.test(name) || !REPO_NAME.test(owner)) throw new GitHubError(400, 'Use letters, numbers, dots, dashes or underscores for the repository name.');
    if (branch && !BRANCH.test(branch)) throw new GitHubError(400, 'That is not a valid branch name.');
    if (!files.length) throw new GitHubError(400, 'This room has no files to push yet.');
    if (files.length > MAX_FILES) throw new GitHubError(400, `A push can hold at most ${MAX_FILES} files.`);
    const full = `${owner}/${name}`;
    const commitMessage = String(message || '').trim().slice(0, 1000) || 'Update from SYNQ';

    let info;
    let created = false;
    try {
      info = await this.api(token, 'GET', `/repos/${full}`);
    } catch (err) {
      if (err.status !== 404) throw this.friendly(err);
      if (owner.toLowerCase() !== login.toLowerCase()) throw new GitHubError(404, `Repository ${full} was not found (or your token cannot see it).`);
      info = await this.api(token, 'POST', '/user/repos', { name, private: !!isPrivate, description: 'Made with SYNQ', auto_init: true }).catch((e) => {
        throw this.friendly(e);
      });
      created = true;
    }
    const target = branch || info.default_branch || 'main';

    // The commit to build on: the branch, else the default branch (new branch), else none
    // (an empty repository: the first commit is made through the contents API).
    let parent = await this.headOf(token, full, target);
    let branchExists = !!parent;
    if (!parent) parent = await this.headOf(token, full, info.default_branch);
    if (!parent) {
      const first = files[0];
      await this.api(token, 'PUT', `/repos/${full}/contents/${first.path.split('/').map(encodeURIComponent).join('/')}`, {
        message: commitMessage,
        content: Buffer.from(first.content, 'utf8').toString('base64'),
        branch: target,
      }).catch((e) => {
        throw this.friendly(e);
      });
      parent = await this.headOf(token, full, target);
      branchExists = true;
    }

    const tree = await this.api(token, 'POST', `/repos/${full}/git/trees`, {
      tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
    }).catch((e) => {
      throw this.friendly(e);
    });
    const commit = await this.api(token, 'POST', `/repos/${full}/git/commits`, { message: commitMessage, tree: tree.sha, parents: [parent] });
    if (branchExists) await this.api(token, 'PATCH', `/repos/${full}/git/refs/heads/${target}`, { sha: commit.sha, force: false });
    else await this.api(token, 'POST', `/repos/${full}/git/refs`, { ref: `refs/heads/${target}`, sha: commit.sha });

    const web = info.html_url || `https://github.com/${full}`;
    return { repo: full, branch: target, url: target === info.default_branch ? web : `${web}/tree/${target}`, commitUrl: `${web}/commit/${commit.sha}`, created, files: files.length };
  }

  /** The commit a branch points at, or null (no such branch, or an empty repository). */
  async headOf(token, full, branch) {
    if (!branch) return null;
    try {
      return (await this.api(token, 'GET', `/repos/${full}/git/ref/heads/${branch}`)).object.sha;
    } catch (err) {
      if (err.status === 404 || err.status === 409) return null;
      throw this.friendly(err);
    }
  }

  friendly(err) {
    if (err.status === 401) return new GitHubError(400, 'GitHub no longer accepts your token. Connect GitHub again.');
    if (err.status === 403 || err.status === 404) {
      return new GitHubError(err.status, "Your GitHub token can't do that. It needs the \"repo\" permission (or Contents and Administration: write).");
    }
    if (err.status === 422) return new GitHubError(422, err.message || 'GitHub refused the change.');
    return err;
  }
}
