/**
 * Reviewing what a merge could not settle on its own.
 *
 * A conflict is either a list of clashing fields in a JSON file (both sides
 * changed the same field; this device's value was kept and pushed), or a
 * whole remote version kept aside for a file that can't be merged. Choosing
 * "theirs" is an ordinary edit, so it syncs and is attributed like any other.
 */
import { Injectable, inject } from '@angular/core';

import { RepoRef } from '../github/client';
import { Conflict, OFFLINE_DB } from './db';
import { setAtPath } from './merge';
import { RepoFs } from './repo-fs';
import { SyncService } from './sync.service';

function refOf(repo: string): RepoRef {
  const [owner, name] = repo.split('/');
  return { owner, name };
}

/** A human name for a file of the surveillance repo. */
export function describePath(path: string): string {
  if (path === 'surveillance.json') return 'Scheda della sorveglianza';
  let m = /^daily\/(\d{4})-(\d{2})-(\d{2})\.json$/.exec(path);
  if (m) return `Giornale del ${m[3]}.${m[2]}.${m[1]}`;
  if (path.startsWith('findings/')) return 'Evidenza';
  if ((m = /^units\/[^/]+\/us-0*(\d+)\.json$/.exec(path))) return `US ${m[1]}`;
  if (path.startsWith('photos/')) return 'Fotografia';
  if (path.startsWith('tavole/')) return 'Tavola';
  if (path.startsWith('surveillances/')) return 'Indice';
  return path;
}

@Injectable({ providedIn: 'root' })
export class ConflictService {
  private readonly db = inject(OFFLINE_DB);
  private readonly fs = inject(RepoFs);
  private readonly sync = inject(SyncService);

  async open(): Promise<Conflict[]> {
    return (await this.db.conflicts.filter((c) => !c.resolved).toArray()).sort(
      (a, b) => b.at - a.at,
    );
  }

  /** Keep this device's value: it is already what GitHub has. */
  async keepMine(c: Conflict, clash?: number): Promise<void> {
    await this.settle(c, clash);
  }

  /** Put the other side's value back, as a normal edit. */
  async useTheirs(c: Conflict, clash?: number): Promise<void> {
    const ref = refOf(c.repo);
    if (clash !== undefined && c.clashes) {
      const current = await this.fs.getJson<unknown>(ref, c.path);
      const next = setAtPath(current ?? {}, c.clashes[clash].path, c.clashes[clash].theirs);
      await this.fs.putJson(ref, c.path, next, 'archaeo-pro: ripristina il valore del collega');
    } else if (c.remoteText !== undefined) {
      await this.fs.putText(
        ref,
        c.path,
        c.remoteText,
        'archaeo-pro: ripristina la versione remota',
      );
    } else if (c.remoteData) {
      await this.fs.putBlob(
        ref,
        c.path,
        new Blob([c.remoteData]),
        'archaeo-pro: ripristina la versione remota',
      );
    }
    await this.settle(c, clash);
  }

  private async settle(c: Conflict, clash?: number): Promise<void> {
    const remaining =
      clash !== undefined && c.clashes ? c.clashes.filter((_, i) => i !== clash) : [];
    if (remaining.length) await this.db.conflicts.update(c.id!, { clashes: remaining });
    else await this.db.conflicts.update(c.id!, { resolved: true });
    await this.sync.refreshConflicts();
  }
}
