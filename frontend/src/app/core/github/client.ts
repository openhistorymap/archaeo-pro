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
  url: string;          // API URL — fetch with Accept: application/octet-stream to download
  browser_download_url: string;
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
      throw new Error(`GitHub ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<T>;
  }

  // ---- repos -----------------------------------------------------------

  listUserRepos(prefixFilter?: string): Promise<GitHubRepo[]> {
    return this.paginate<GitHubRepo>(
      `${API_BASE}/user/repos?per_page=100&affiliation=owner&sort=updated`,
    ).then((all) => (prefixFilter ? all.filter((r) => r.name.startsWith(prefixFilter)) : all));
  }

  async createUserRepo(name: string, opts: { description?: string; private?: boolean } = {}): Promise<GitHubRepo> {
    const res = await fetch(`${API_BASE}/user/repos`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        name,
        description: opts.description ?? 'archaeo-pro storage',
        private: opts.private ?? true,
        auto_init: true,
      }),
    });
    return this.json<GitHubRepo>(res);
  }

  async getRepo(ref: RepoRef): Promise<GitHubRepo | null> {
    const res = await fetch(`${API_BASE}/repos/${ref.owner}/${ref.name}`, { headers: this.headers() });
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

  async deleteFile(ref: RepoRef, path: string, sha: string, message: string): Promise<void> {
    const res = await fetch(
      `${API_BASE}/repos/${ref.owner}/${ref.name}/contents/${encodeURI(path)}`,
      { method: 'DELETE', headers: this.headers(), body: JSON.stringify({ message, sha }) },
    );
    if (!res.ok) throw new Error(`Failed to delete ${path}: ${res.status}`);
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
      url = next ? next.match(/<([^>]+)>/)?.[1] ?? null : null;
    }
    return out;
  }
}
