/**
 * The device-local mirror that makes archaeo-pro offline-first.
 *
 * GitHub stays the system of record, but every read and write goes through
 * this IndexedDB (Dexie) copy first:
 *
 *   files      one row per repo file: text inline, binaries as bytes (fetched
 *              lazily), the sha last seen on GitHub, and dirty/deleted flags
 *              for changes not yet pushed
 *   outbox     ordered queue of pending GitHub operations (create repo, put,
 *              delete); SyncService drains it whenever the device is online
 *   repos      which repos are mirrored, when they were last refreshed, and
 *              whether the repo itself still has to be created on GitHub
 *   conflicts  the remote version of a file that changed on GitHub while a
 *              local edit was pending; the local edit wins, nothing is lost
 */
import { InjectionToken } from '@angular/core';
import Dexie, { Table } from 'dexie';

export interface MirrorFile {
  /** `${owner}/${repo}:${path}` */
  key: string;
  /** `${owner}/${repo}` */
  repo: string;
  path: string;
  /** Parent directory of `path`, '' for the repo root. */
  dir: string;
  binary: boolean;
  /** Body of a text file. */
  text?: string;
  /**
   * Body of a binary file; undefined until first fetched. Kept as raw bytes
   * rather than a Blob: bytes survive IndexedDB in every engine.
   */
  data?: ArrayBuffer;
  /** Media type of `data`. */
  mime?: string;
  /** Blob sha of the version last seen on GitHub; null if never pushed. */
  sha: string | null;
  /** A local change not yet pushed. */
  dirty: boolean;
  /** Deleted locally; the delete is not yet pushed. */
  deleted: boolean;
  updatedAt: number;
}

export type OutboxOp = 'create-repo' | 'put' | 'delete';

export interface OutboxEntry {
  seq?: number;
  op: OutboxOp;
  /** `${owner}/${repo}` */
  repo: string;
  /** File key for put/delete; absent for create-repo. */
  key?: string;
  path?: string;
  /** Commit message (put/delete) or repo description (create-repo). */
  message: string;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

export interface MirrorRepo {
  repo: string;
  /** Last successful refresh from GitHub; null if never mirrored. */
  hydratedAt: number | null;
  /** Created on this device, not yet on GitHub. */
  pendingCreate: boolean;
}

export interface Conflict {
  id?: number;
  repo: string;
  path: string;
  remoteSha: string;
  remoteText?: string;
  remoteData?: ArrayBuffer;
  at: number;
}

export class OfflineDb extends Dexie {
  files!: Table<MirrorFile, string>;
  outbox!: Table<OutboxEntry, number>;
  repos!: Table<MirrorRepo, string>;
  conflicts!: Table<Conflict, number>;

  /** `deps` lets tests supply an in-memory IndexedDB. */
  constructor(
    name = 'archaeo-pro',
    deps?: { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange },
  ) {
    super(name, deps);
    this.version(1).stores({
      files: '&key, repo, [repo+dir]',
      outbox: '++seq, repo, key',
      repos: '&repo',
      conflicts: '++id, repo',
    });
  }
}

export const OFFLINE_DB = new InjectionToken<OfflineDb>('OFFLINE_DB', {
  providedIn: 'root',
  factory: () => new OfflineDb(),
});

export function repoKey(ref: { owner: string; name: string }): string {
  return `${ref.owner}/${ref.name}`;
}

export function fileKey(ref: { owner: string; name: string }, path: string): string {
  return `${repoKey(ref)}:${path}`;
}

export function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Text files are mirrored eagerly; everything else (photos, tavole, exports) lazily. */
export function isTextPath(path: string): boolean {
  if (/\.(json|geojson|md|txt|csv)$/i.test(path)) return true;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return !name.includes('.') || path.startsWith('.archaeo-pro/');
}

/** A fetch that never reached the server: the device is offline or the network dropped. */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError;
}

/** Thrown when data has never been mirrored and the device is offline. */
export class OfflineUnavailableError extends Error {
  constructor(what = 'Questi dati') {
    super(
      `${what} non sono ancora disponibili offline: aprili una volta con la connessione attiva.`,
    );
    this.name = 'OfflineUnavailableError';
  }
}
