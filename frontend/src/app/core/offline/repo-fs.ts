/**
 * Offline-first file access to the archaeologist's GitHub repos.
 *
 * Same shape as the slice of GitHubClient the stores used (read a file, list
 * a directory, write, delete), but every call is served by the local mirror
 * (see db.ts). Writes land in the mirror immediately and are queued for
 * SyncService; reads refresh the mirror from GitHub when online and the copy
 * is stale, and fall back to the mirror when the network is gone.
 *
 * A repo is refreshed with one tree request plus one request per text file
 * that changed. Binaries (photos, tavole, exports) are fetched on first use
 * and then kept.
 */
import { Injectable, inject } from '@angular/core';

import { GitHubClient, RepoRef } from '../github/client';
import {
  MirrorFile,
  OFFLINE_DB,
  OfflineUnavailableError,
  ReadOnlyError,
  RepoPermission,
  fileKey,
  isNetworkError,
  isTextPath,
  parentDir,
  repoKey,
} from './db';
import { SyncService } from './sync.service';

/** How long a mirrored repo is trusted before the next read refreshes it. */
const STALE_MS = 60_000;
const DOWNLOAD_CONCURRENCY = 6;

export interface FsEntry {
  type: 'file';
  name: string;
  path: string;
}

@Injectable({ providedIn: 'root' })
export class RepoFs {
  private readonly db = inject(OFFLINE_DB);
  private readonly gh = inject(GitHubClient);
  private readonly sync = inject(SyncService);
  private readonly refreshing = new Map<string, Promise<void>>();

  // ---- repos -----------------------------------------------------------

  /** Whether this device already mirrors the repo (or created it offline). */
  async isMirrored(ref: RepoRef): Promise<boolean> {
    return (await this.db.repos.get(repoKey(ref))) !== undefined;
  }

  /** Create a repo locally; it is created on GitHub, empty, by the next sync. */
  async createRepo(ref: RepoRef, description: string): Promise<void> {
    const repo = repoKey(ref);
    await this.db.repos.put({ repo, hydratedAt: Date.now(), pendingCreate: true });
    await this.sync.enqueue({ op: 'create-repo', repo, message: description });
  }

  /**
   * Make sure the repo is mirrored and reasonably fresh. Online and stale:
   * refresh from GitHub. Offline: use the mirror, or fail clearly if there
   * is none.
   */
  async ready(ref: RepoRef, opts: { force?: boolean } = {}): Promise<void> {
    const repo = repoKey(ref);
    const known = await this.db.repos.get(repo);
    if (known?.pendingCreate) return;
    const fresh = known?.hydratedAt && Date.now() - known.hydratedAt < STALE_MS;
    if (fresh && !opts.force) return;
    if (!this.sync.online() && known?.hydratedAt) return;
    try {
      await this.refresh(ref);
    } catch (e) {
      if (isNetworkError(e) && known?.hydratedAt) {
        this.sync.online.set(false);
        return;
      }
      if (isNetworkError(e)) throw new OfflineUnavailableError();
      throw e;
    }
  }

  /** Pull the repo's current tree from GitHub into the mirror, keeping local changes. */
  refresh(ref: RepoRef): Promise<void> {
    const repo = repoKey(ref);
    let running = this.refreshing.get(repo);
    if (!running) {
      running = this.doRefresh(ref).finally(() => this.refreshing.delete(repo));
      this.refreshing.set(repo, running);
    }
    return running;
  }

  private async doRefresh(ref: RepoRef): Promise<void> {
    const repo = repoKey(ref);
    const tree = (await this.gh.getTree(ref)) ?? [];
    const remote = new Map(tree.filter((t) => t.type === 'blob').map((t) => [t.path, t.sha]));
    const local = new Map(
      (await this.db.files.where('repo').equals(repo).toArray()).map((f) => [f.path, f]),
    );

    // Text files that are new or changed on GitHub, and not edited here.
    const toFetch = [...remote].filter(([path, sha]) => {
      const mine = local.get(path);
      return isTextPath(path) && !mine?.dirty && mine?.sha !== sha;
    });
    const texts = new Map<string, string>();
    for (let i = 0; i < toFetch.length; i += DOWNLOAD_CONCURRENCY) {
      await Promise.all(
        toFetch.slice(i, i + DOWNLOAD_CONCURRENCY).map(async ([path, sha]) => {
          texts.set(path, await (await this.gh.getBlobBySha(ref, sha, 'text/plain')).text());
        }),
      );
    }

    await this.db.transaction('rw', this.db.files, this.db.repos, async () => {
      const now = Date.now();
      for (const [path, sha] of remote) {
        const mine = await this.db.files.get(fileKey(ref, path));
        if (
          mine &&
          !mine.dirty &&
          mine.sha === sha &&
          mine.base === undefined &&
          mine.text !== undefined
        ) {
          // Mirrored before merging existed: what we hold is GitHub's version, so it is the base.
          await this.db.files.update(mine.key, { base: mine.text });
        }
        if (mine?.dirty || mine?.sha === sha) continue;
        const binary = !isTextPath(path);
        if (!binary && !texts.has(path)) continue; // changed again mid-refresh; next refresh gets it
        await this.db.files.put({
          key: fileKey(ref, path),
          repo,
          path,
          dir: parentDir(path),
          binary,
          text: binary ? undefined : texts.get(path),
          base: binary ? undefined : texts.get(path),
          data: undefined, // binaries: refetched on next use
          mime: undefined,
          sha,
          dirty: false,
          deleted: false,
          updatedAt: now,
        });
      }
      // Gone from GitHub and not edited here: gone here too.
      for (const [path, mine] of local) {
        if (!remote.has(path) && !mine.dirty) await this.db.files.delete(mine.key);
      }
      const known = await this.db.repos.get(repo);
      await this.db.repos.put({ ...known, repo, hydratedAt: now, pendingCreate: false });
    });
  }

  // ---- access ----------------------------------------------------------

  /** Record this user's access to a repo; 'read' makes every write fail on the device. */
  async setPermission(ref: RepoRef, permission: RepoPermission): Promise<void> {
    const repo = repoKey(ref);
    const known = await this.db.repos.get(repo);
    await this.db.repos.put({ hydratedAt: null, pendingCreate: false, ...known, repo, permission });
  }

  async permission(ref: RepoRef): Promise<RepoPermission | undefined> {
    return (await this.db.repos.get(repoKey(ref)))?.permission;
  }

  private async assertWritable(ref: RepoRef): Promise<void> {
    if ((await this.permission(ref)) === 'read') throw new ReadOnlyError();
  }

  // ---- reads -----------------------------------------------------------

  async getText(ref: RepoRef, path: string): Promise<{ text: string; sha: string | null } | null> {
    await this.ready(ref);
    const row = await this.db.files.get(fileKey(ref, path));
    if (!row || row.deleted || row.text === undefined) return null;
    return { text: row.text, sha: row.sha };
  }

  async getJson<T>(ref: RepoRef, path: string): Promise<T | null> {
    const f = await this.getText(ref, path);
    return f ? (JSON.parse(f.text) as T) : null;
  }

  async exists(ref: RepoRef, path: string): Promise<boolean> {
    await this.ready(ref);
    const row = await this.db.files.get(fileKey(ref, path));
    return !!row && !row.deleted;
  }

  /** Files directly inside `dir` (no subdirectories), like the Contents API listing. */
  async listDir(ref: RepoRef, dir: string): Promise<FsEntry[]> {
    await this.ready(ref);
    const rows = await this.db.files
      .where('[repo+dir]')
      .equals([repoKey(ref), dir])
      .toArray();
    return rows
      .filter((r) => !r.deleted)
      .map((r) => ({
        type: 'file' as const,
        name: r.path.slice(r.path.lastIndexOf('/') + 1),
        path: r.path,
      }));
  }

  /** A binary file, from the mirror or fetched once from GitHub and kept. */
  async getBlob(
    ref: RepoRef,
    path: string,
    contentType = 'application/octet-stream',
  ): Promise<Blob | null> {
    try {
      await this.ready(ref);
    } catch (e) {
      if (!(e instanceof OfflineUnavailableError)) throw e;
    }
    const key = fileKey(ref, path);
    const row = await this.db.files.get(key);
    if (!row || row.deleted) return null;
    if (row.data) return new Blob([row.data], { type: row.mime || contentType });
    if (row.text !== undefined) return new Blob([row.text], { type: contentType });
    if (!row.sha || !this.sync.online()) return null;
    let blob: Blob;
    try {
      blob = await this.gh.getBlobBySha(ref, row.sha, contentType);
    } catch (e) {
      if (isNetworkError(e)) {
        this.sync.online.set(false);
        return null;
      }
      throw e;
    }
    const data = await blob.arrayBuffer();
    await this.db.transaction('rw', this.db.files, async () => {
      const now = await this.db.files.get(key);
      if (now && now.sha === row.sha && !now.dirty)
        await this.db.files.update(key, { data, mime: blob.type });
    });
    return blob;
  }

  // ---- writes ----------------------------------------------------------

  putText(ref: RepoRef, path: string, text: string, message: string): Promise<void> {
    return this.write(
      ref,
      path,
      { binary: false, text, data: undefined, mime: undefined },
      message,
    );
  }

  putJson(ref: RepoRef, path: string, value: unknown, message: string): Promise<void> {
    return this.putText(ref, path, JSON.stringify(value, null, 2) + '\n', message);
  }

  async putBlob(ref: RepoRef, path: string, blob: Blob, message: string): Promise<void> {
    const data = await blob.arrayBuffer();
    return this.write(ref, path, { binary: true, text: undefined, data, mime: blob.type }, message);
  }

  async remove(ref: RepoRef, path: string, message: string): Promise<void> {
    await this.assertWritable(ref);
    const key = fileKey(ref, path);
    const row = await this.db.files.get(key);
    if (!row || row.deleted) return;
    if (row.sha === null) {
      // Never reached GitHub: forget it entirely.
      await this.db.files.delete(key);
      await this.sync.dropKey(key);
      return;
    }
    await this.db.files.update(key, { deleted: true, dirty: true, updatedAt: Date.now() });
    await this.sync.enqueue({ op: 'delete', repo: repoKey(ref), key, path, message });
  }

  private async write(
    ref: RepoRef,
    path: string,
    body: Pick<MirrorFile, 'binary' | 'text' | 'data' | 'mime'>,
    message: string,
  ): Promise<void> {
    await this.assertWritable(ref);
    const key = fileKey(ref, path);
    await this.db.transaction('rw', this.db.files, async () => {
      const row = await this.db.files.get(key);
      await this.db.files.put({
        key,
        repo: repoKey(ref),
        path,
        dir: parentDir(path),
        ...body,
        base: row?.base, // the last GitHub version stays the merge base
        sha: row?.sha ?? null,
        dirty: true,
        deleted: false,
        updatedAt: Date.now(),
      });
    });
    await this.sync.enqueue({ op: 'put', repo: repoKey(ref), key, path, message });
  }
}
