/**
 * Thin typed wrapper around the bits of the GitHub REST API we use.
 *
 * Auth is read from GitHubAuthService on every call so a logout takes effect
 * immediately. All requests go directly to api.github.com (CORS-allowed) —
 * the only reason the backend is involved is the OAuth code-for-token relay.
 */
import { Injectable, inject } from '@angular/core';

import { GitHubAuthService } from './auth.service';

const API_BASE = 'https://api.github.com';
const UPLOAD_BASE = 'https://uploads.github.com';

export interface RepoRef {
  owner: string;
  name: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  owner?: { login: string };
  /** The authenticated user's access, present when listed or fetched with a token. */
  permissions?: {
    admin: boolean;
    maintain?: boolean;
    push: boolean;
    triage?: boolean;
    pull: boolean;
  };
}

/** GitHub's repository roles, as the collaborators API names them. */
export type GitHubRole = 'pull' | 'triage' | 'push' | 'maintain' | 'admin';

export interface GitHubCollaborator {
  login: string;
  avatar_url: string;
  /** e.g. "admin", "write", "read". */
  role_name?: string;
  permissions?: { admin: boolean; push: boolean; pull: boolean };
}

export interface GitHubRepoInvitation {
  id: number;
  invitee?: { login: string } | null;
  inviter?: { login: string } | null;
  /** "read" | "triage" | "write" | "maintain" | "admin" */
  permissions: string;
  repository: { name: string; full_name: string; owner: { login: string }; private: boolean };
  created_at: string;
}

export interface GitHubContentItem {
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  name: string;
  path: string;
  sha: string;
  size: number;
  download_url: string | null;
}

export interface GitHubFileContent extends GitHubContentItem {
  type: 'file';
  /** base64-encoded; may include newlines. */
  content: string;
  encoding: 'base64';
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  upload_url: string; // template: https://uploads.github.com/.../assets{?name,label}
  assets: GitHubReleaseAsset[];
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  content_type: string;
  url: string; // API URL — fetch with Accept: application/octet-stream to download
  browser_download_url: string;
}

export interface GitHubTreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

/** An HTTP error from the GitHub API, carrying the status for callers that branch on it. */
export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

@Injectable({ providedIn: 'root' })
export class GitHubClient {
  private readonly auth = inject(GitHubAuthService);

  private headers(extra: Record<string, string> = {}): HeadersInit {
    const t = this.auth.token();
    if (!t) throw new Error('Not authenticated with GitHub.');
    return {
      Authorization: `Bearer ${t.access_token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    };
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GitHubError(
        res.status,
        `GitHub ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
      );
    }
    return res.json() as Promise<T>;
  }

  // ---- repos -----------------------------------------------------------

  listUserRepos(
    prefixFilter?: string,
    affiliation: 'owner' | 'collaborator' | 'organization_member' = 'owner',
  ): Promise<GitHubRepo[]> {
    return this.paginate<GitHubRepo>(
      `${API_BASE}/user/repos?per_page=100&affiliation=${affiliation}&sort=updated`,
    ).then((all) => (prefixFilter ? all.filter((r) => r.name.startsWith(prefixFilter)) : all));
  }

  // ---- collaborators and invitations -------------------------------------

  /** People with direct access to the repo (the owner included). */
  listCollaborators(ref: RepoRef): Promise<GitHubCollaborator[]> {
    return this.paginate<GitHubCollaborator>(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/collaborators?affiliation=direct&per_page=100`,
    );
  }

  /** Invite someone (or change their role). GitHub sends them an invitation to accept. */
  async addCollaborator(ref: RepoRef, login: string, permission: GitHubRole): Promise<void> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/collaborators/${encodeURIComponent(login)}`,
      { method: 'PUT', headers: this.headers(), body: JSON.stringify({ permission }) },
    );
    if (res.status === 201 || res.status === 204) return;
    await this.json(res);
  }

  async removeCollaborator(ref: RepoRef, login: string): Promise<void> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/collaborators/${encodeURIComponent(login)}`,
      { method: 'DELETE', headers: this.headers() },
    );
    if (!res.ok && res.status !== 404) await this.json(res);
  }

  /** Invitations sent for this repo and not accepted yet. */
  listRepoInvitations(ref: RepoRef): Promise<GitHubRepoInvitation[]> {
    return this.paginate<GitHubRepoInvitation>(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/invitations?per_page=100`,
    );
  }

  async cancelRepoInvitation(ref: RepoRef, id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/repos/${ref.owner}/${ref.name}/invitations/${id}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) await this.json(res);
  }

  /** Invitations addressed to the signed-in user. */
  listMyInvitations(): Promise<GitHubRepoInvitation[]> {
    return this.paginate<GitHubRepoInvitation>(
      `${API_BASE}/user/repository_invitations?per_page=100`,
    );
  }

  async answerInvitation(id: number, accept: boolean): Promise<void> {
    const res = await fetch(`${API_BASE}/user/repository_invitations/${id}`, {
      method: accept ? 'PATCH' : 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) await this.json(res);
  }

  async createUserRepo(
    name: string,
    opts: { description?: string; private?: boolean; autoInit?: boolean } = {},
  ): Promise<GitHubRepo> {
    const res = await fetch(`${API_BASE}/user/repos`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        name,
        description: opts.description ?? 'archaeo-pro storage',
        private: opts.private ?? true,
        auto_init: opts.autoInit ?? true,
      }),
    });
    return this.json<GitHubRepo>(res);
  }

  async getRepo(ref: RepoRef): Promise<GitHubRepo | null> {
    const res = await fetch(`${API_BASE}/repos/${ref.owner}/${ref.name}`, {
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    return this.json<GitHubRepo>(res);
  }

  async deleteRepo(ref: RepoRef): Promise<void> {
    const res = await fetch(`${API_BASE}/repos/${ref.owner}/${ref.name}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete ${ref.owner}/${ref.name}: ${res.status}`);
    }
  }

  // ---- contents --------------------------------------------------------

  async getFile(ref: RepoRef, path: string): Promise<GitHubFileContent | null> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/contents/${encodeURI(path)}`,
      { headers: this.headers() },
    );
    if (res.status === 404) return null;
    return this.json<GitHubFileContent>(res);
  }

  async listDir(ref: RepoRef, path: string): Promise<GitHubContentItem[]> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/contents/${encodeURI(path)}`,
      { headers: this.headers() },
    );
    if (res.status === 404) return [];
    const body = await this.json<GitHubContentItem | GitHubContentItem[]>(res);
    return Array.isArray(body) ? body : [body];
  }

  /**
   * Create or update a file. Pass `sha` to update an existing file; omit it to create.
   * `content` is the raw UTF-8 string; we base64-encode here.
   */
  async putFile(
    ref: RepoRef,
    path: string,
    content: string,
    message: string,
    sha?: string,
  ): Promise<{ content: { sha: string; path: string } }> {
    const body: Record<string, unknown> = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
    };
    if (sha) body['sha'] = sha;
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/contents/${encodeURI(path)}`,
      { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) },
    );
    return this.json(res);
  }

  /**
   * Create or update a binary file (photo, doc, etc.) via the Contents API.
   * Same shape as putFile but base64-encodes the bytes safely without going
   * through unescape/encodeURIComponent.
   */
  async putBinaryFile(
    ref: RepoRef,
    path: string,
    blob: Blob,
    message: string,
    sha?: string,
  ): Promise<{ content: { sha: string; path: string } }> {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Chunked btoa avoids "Maximum call stack size exceeded" on large files.
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    const body: Record<string, unknown> = { message, content: btoa(binary) };
    if (sha) body['sha'] = sha;
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/contents/${encodeURI(path)}`,
      { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) },
    );
    return this.json(res);
  }

  /**
   * Fetch a binary file by repo path. Decodes the Contents-API base64
   * response into a Blob with the given content type.
   *
   * Files larger than ~1 MB return without inline content; we then fall
   * back to download_url + auth header for the actual bytes.
   */
  async getBinaryFile(
    ref: RepoRef,
    path: string,
    contentType = 'image/jpeg',
  ): Promise<Blob | null> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/contents/${encodeURI(path)}`,
      { headers: this.headers() },
    );
    if (res.status === 404) return null;
    const meta = await this.json<GitHubFileContent & { download_url?: string }>(res);
    if (meta.content) {
      const binary = atob(meta.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: contentType });
    }
    if (meta.download_url) {
      const blobRes = await fetch(meta.download_url, {
        headers: { Authorization: this.headers()['Authorization' as keyof HeadersInit] as string },
      });
      if (!blobRes.ok) return null;
      return blobRes.blob();
    }
    return null;
  }

  async deleteFile(ref: RepoRef, path: string, sha: string, message: string): Promise<void> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/contents/${encodeURI(path)}`,
      { method: 'DELETE', headers: this.headers(), body: JSON.stringify({ message, sha }) },
    );
    if (!res.ok) throw new GitHubError(res.status, `Failed to delete ${path}: ${res.status}`);
  }

  // ---- git data (used by the offline mirror) ---------------------------

  /**
   * The whole file tree of the default branch in one request. Blob shas are
   * the same shas the Contents API returns, so they tell the offline mirror
   * which files changed. Returns null for an empty or missing repo.
   */
  async getTree(ref: RepoRef): Promise<GitHubTreeEntry[] | null> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/git/trees/HEAD?recursive=1`,
      { headers: this.headers() },
    );
    if (res.status === 404 || res.status === 409) return null;
    const body = await this.json<{ tree: GitHubTreeEntry[]; truncated: boolean }>(res);
    if (body.truncated) {
      throw new GitHubError(
        413,
        `Tree of ${ref.owner}/${ref.name} is too large to mirror in one request.`,
      );
    }
    return body.tree;
  }

  /** A blob's bytes by sha, any size up to 100 MB. */
  async getBlobBySha(
    ref: RepoRef,
    sha: string,
    contentType = 'application/octet-stream',
  ): Promise<Blob> {
    const res = await fetch(`${API_BASE}/repos/${ref.owner}/${ref.name}/git/blobs/${sha}`, {
      headers: this.headers({ Accept: 'application/vnd.github.raw+json' }),
    });
    if (!res.ok) throw new GitHubError(res.status, `Blob ${sha} download failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    return new Blob([buf], { type: contentType });
  }

  // ---- releases (used for photo binaries) ------------------------------

  async getReleaseByTag(ref: RepoRef, tag: string): Promise<GitHubRelease | null> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/releases/tags/${encodeURIComponent(tag)}`,
      { headers: this.headers() },
    );
    if (res.status === 404) return null;
    return this.json<GitHubRelease>(res);
  }

  async ensureRelease(ref: RepoRef, tag: string, name: string): Promise<GitHubRelease> {
    const existing = await this.getReleaseByTag(ref, tag);
    if (existing) return existing;
    const res = await fetch(`${API_BASE}/repos/${ref.owner}/${ref.name}/releases`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ tag_name: tag, name, body: 'archaeo-pro photo binaries.' }),
    });
    return this.json<GitHubRelease>(res);
  }

  async uploadReleaseAsset(
    ref: RepoRef,
    releaseId: number,
    filename: string,
    contentType: string,
    blob: Blob,
  ): Promise<GitHubReleaseAsset> {
    const url = `${UPLOAD_BASE}/repos/${ref.owner}/${ref.name}/releases/${releaseId}/assets?name=${encodeURIComponent(filename)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': contentType }),
      body: blob,
    });
    return this.json<GitHubReleaseAsset>(res);
  }

  /** Fetch a release asset's bytes using its API URL (works for private repos with auth). */
  async downloadReleaseAsset(assetUrl: string): Promise<Blob> {
    const res = await fetch(assetUrl, {
      headers: this.headers({ Accept: 'application/octet-stream' }),
    });
    if (!res.ok) throw new Error(`Asset download failed: ${res.status}`);
    return res.blob();
  }

  // ---- pagination helper ----------------------------------------------

  private async paginate<T>(initialUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = initialUrl;
    while (url) {
      const res: Response = await fetch(url, { headers: this.headers() });
      const items = await this.json<T[]>(res);
      out.push(...items);
      const link = res.headers.get('link') ?? '';
      const next = link.split(',').find((p) => p.includes('rel="next"'));
      url = next ? (next.match(/<([^>]+)>/)?.[1] ?? null) : null;
    }
    return out;
  }
}
