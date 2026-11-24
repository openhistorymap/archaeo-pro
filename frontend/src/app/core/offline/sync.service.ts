/**
 * Drains the offline outbox into GitHub.
 *
 * Operations run strictly in the order they were made, so a repo created
 * offline exists before its first file is pushed. Repeated edits to the same
 * file collapse into one push: the queue holds *which* file to push, and the
 * push sends whatever the mirror holds at that moment.
 *
 * Conflicts: if the file changed on GitHub while a local edit was pending,
 * the remote version is saved to the `conflicts` table and the local edit
 * wins. Nothing is discarded silently.
 */
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

import { GitHubAuthService } from '../github/auth.service';
import { GitHubClient, GitHubError, RepoRef } from '../github/client';
import { OFFLINE_DB, OutboxEntry, isNetworkError, isTextPath } from './db';

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_DEBOUNCE_MS = 1_500;

function refOf(repo: string): RepoRef {
  const [owner, name] = repo.split('/');
  return { owner, name };
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly db = inject(OFFLINE_DB);
  private readonly gh = inject(GitHubClient);
  private readonly auth = inject(GitHubAuthService);

  /** Whether the browser believes it is online (refined by failed requests). */
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  /** Operations waiting to reach GitHub. */
  readonly pending = signal(0);
  readonly syncing = signal(false);
  /** Last error that stopped the queue, in plain words. */
  readonly lastError = signal<string | null>(null);
  /** Remote versions kept aside after a conflict. */
  readonly conflicts = signal(0);

  private flushing: Promise<void> | null = null;
  private inFlight: number | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    const goOnline = () => {
      this.online.set(true);
      void this.flush();
    };
    const goOffline = () => this.online.set(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.flush();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
      if (this.debounce) clearTimeout(this.debounce);
    });
    void this.refreshCounts().then(() => this.flush());
  }

  /** Queue an operation; edits to a file already waiting in the queue are merged into it. */
  async enqueue(entry: Omit<OutboxEntry, 'attempts' | 'createdAt'>): Promise<void> {
    await this.db.transaction('rw', this.db.outbox, async () => {
      if (entry.key) {
        const waiting = await this.db.outbox
          .where('key')
          .equals(entry.key)
          .filter((e) => e.seq !== this.inFlight)
          .first();
        if (waiting) {
          await this.db.outbox.update(waiting.seq!, { op: entry.op, message: entry.message });
          return;
        }
      }
      await this.db.outbox.add({ ...entry, attempts: 0, createdAt: Date.now() });
    });
    await this.refreshCounts();
    this.scheduleFlush();
  }

  /** Forget queued operations on a file (it was created and deleted before ever being pushed). */
  async dropKey(key: string): Promise<void> {
    await this.db.outbox
      .where('key')
      .equals(key)
      .filter((e) => e.seq !== this.inFlight)
      .delete();
    await this.refreshCounts();
  }

  /** Whether a repo still has operations waiting (its mirror must not be refreshed over them). */
  async hasPending(repo: string): Promise<boolean> {
    return (await this.db.outbox.where('repo').equals(repo).count()) > 0;
  }

  /** Push everything that is waiting. Safe to call at any time; concurrent calls share one run. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.drain()
        .catch((e) => this.lastError.set(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          this.flushing = null;
          this.inFlight = null;
          this.syncing.set(false);
          void this.refreshCounts();
        });
    }
    return this.flushing;
  }

  private scheduleFlush(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.flush(), FLUSH_DEBOUNCE_MS);
  }

  private async drain(): Promise<void> {
    if (!this.auth.token()) return;
    for (;;) {
      const entry = await this.db.outbox.orderBy('seq').first();
      if (!entry) {
        this.lastError.set(null);
        return;
      }
      this.syncing.set(true);
      this.inFlight = entry.seq!;
      try {
        await this.run(entry);
        await this.db.outbox.delete(entry.seq!);
        this.online.set(true);
        this.lastError.set(null);
        await this.refreshCounts();
      } catch (e) {
        if (isNetworkError(e)) {
          this.online.set(false);
          return;
        }
        if (e instanceof GitHubError && e.status === 401) {
          this.lastError.set('Accesso a GitHub scaduto: rientra per sincronizzare.');
          return;
        }
        const message = e instanceof Error ? e.message : String(e);
        await this.db.outbox.update(entry.seq!, {
          attempts: entry.attempts + 1,
          lastError: message,
        });
        this.lastError.set(`${entry.path ?? entry.repo}: ${message}`);
        // Stop here: later operations may depend on this one. Retried on the next flush.
        return;
      }
    }
  }

  private async run(entry: OutboxEntry): Promise<void> {
    const ref = refOf(entry.repo);
    switch (entry.op) {
      case 'create-repo':
        try {
          await this.gh.createUserRepo(ref.name, {
            description: entry.message,
            private: true,
            autoInit: false,
          });
        } catch (e) {
          // 422: the name is taken, i.e. an earlier attempt already created it.
          if (!(e instanceof GitHubError && e.status === 422)) throw e;
        }
        await this.db.repos.update(entry.repo, { pendingCreate: false });
        return;
      case 'put':
        return this.push(ref, entry);
      case 'delete':
        return this.remove(ref, entry);
    }
  }

  private async push(ref: RepoRef, entry: OutboxEntry): Promise<void> {
    const row = await this.db.files.get(entry.key!);
    if (!row || row.deleted) return; // superseded by a later delete
    const send = (sha: string | undefined) =>
      row.binary
        ? this.gh.putBinaryFile(
            ref,
            row.path,
            new Blob(row.data ? [row.data] : [], { type: row.mime ?? '' }),
            entry.message,
            sha,
          )
        : this.gh.putFile(ref, row.path, row.text ?? '', entry.message, sha);

    let res: { content: { sha: string } };
    try {
      res = await send(row.sha ?? undefined);
    } catch (e) {
      if (!this.isShaMismatch(e)) throw e;
      const remoteSha = await this.keepRemoteCopy(ref, entry.repo, row.path);
      res = await send(remoteSha ?? undefined);
    }
    await this.db.transaction('rw', this.db.files, async () => {
      const now = await this.db.files.get(row.key);
      if (!now) return;
      // If it was edited again while we pushed, a newer put is queued: keep it dirty.
      const unchanged = now.updatedAt === row.updatedAt;
      await this.db.files.update(row.key, { sha: res.content.sha, dirty: !unchanged });
    });
  }

  private async remove(ref: RepoRef, entry: OutboxEntry): Promise<void> {
    const row = await this.db.files.get(entry.key!);
    if (!row) return;
    if (!row.deleted) return; // re-created after the delete was queued
    if (row.sha) {
      try {
        await this.gh.deleteFile(ref, row.path, row.sha, entry.message);
      } catch (e) {
        if (e instanceof GitHubError && e.status === 404) {
          // already gone on GitHub
        } else if (this.isShaMismatch(e)) {
          const remoteSha = await this.keepRemoteCopy(ref, entry.repo, row.path);
          if (remoteSha) await this.gh.deleteFile(ref, row.path, remoteSha, entry.message);
        } else {
          throw e;
        }
      }
    }
    await this.db.files.delete(row.key);
  }

  /** GitHub refuses a write whose base sha is not the current one with 409, or 422 when the sha is missing. */
  private isShaMismatch(e: unknown): boolean {
    return e instanceof GitHubError && (e.status === 409 || e.status === 422);
  }

  /** Save the current GitHub version of a file aside before overwriting it; returns its sha. */
  private async keepRemoteCopy(ref: RepoRef, repo: string, path: string): Promise<string | null> {
    const remote = await this.gh.getFile(ref, path);
    if (!remote) return null;
    const conflict = { repo, path, remoteSha: remote.sha, at: Date.now() } as const;
    if (isTextPath(path)) {
      const text = new TextDecoder().decode(
        Uint8Array.from(atob(remote.content.replace(/\n/g, '')), (c) => c.charCodeAt(0)),
      );
      await this.db.conflicts.add({ ...conflict, remoteText: text });
    } else {
      const blob = await this.gh.getBlobBySha(ref, remote.sha);
      await this.db.conflicts.add({ ...conflict, remoteData: await blob.arrayBuffer() });
    }
    return remote.sha;
  }

  private async refreshCounts(): Promise<void> {
    try {
      this.pending.set(await this.db.outbox.count());
      this.conflicts.set(await this.db.conflicts.count());
    } catch {
      // database closed (logout, tests): counts stay as they were
    }
  }
}
