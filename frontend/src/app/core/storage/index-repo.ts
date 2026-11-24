/**
 * Manages the per-archaeologist `archaeo-pro-index` repository.
 *
 * One file per surveillance under surveillances/<id>.json so concurrent edits
 * across devices don't conflict on the index. README + profile.json round it
 * out so the repo is self-explanatory when browsed on github.com.
 *
 * Reads and writes go through the offline mirror (RepoFs): the index works
 * without a connection once it has been opened online on this device.
 */
import { Injectable, inject } from '@angular/core';

import { SurveillanceIndexEntry } from '../types/surveillance';
import { GitHubAuthService } from '../github/auth.service';
import { GitHubClient, RepoRef } from '../github/client';
import { OfflineUnavailableError } from '../offline/db';
import { RepoFs } from '../offline/repo-fs';

const INDEX_REPO_NAME = 'archaeo-pro-index';
const INDEX_REPO_DESCRIPTION =
  'archaeo-pro — per-user index of archaeological surveillances. Do not delete by hand.';

const INDEX_README = `# archaeo-pro index

This is your **archaeo-pro** index repository. It is auto-managed by the
archaeo-pro app. Each file under \`surveillances/\` is a lightweight summary of
one *sorveglianza archeologica* — title, location, dates, status, and a link
to its dedicated repo where the full data lives.

Treat this as your master ledger. The data itself, photos included, lives in
the per-surveillance repos.
`;

@Injectable({ providedIn: 'root' })
export class IndexRepoService {
  private readonly gh = inject(GitHubClient);
  private readonly auth = inject(GitHubAuthService);
  private readonly fs = inject(RepoFs);

  /**
   * The index repo, created on GitHub if this account has none yet. Creating
   * it needs a connection: offline, a device that has never seen the index
   * can't tell whether it exists, and must not make a second one.
   */
  async bootstrap(): Promise<RepoRef> {
    const me = await this.auth.ensureUser();
    if (!me) throw new Error('Cannot bootstrap index repo: not authenticated.');
    const ref: RepoRef = { owner: me.login, name: INDEX_REPO_NAME };
    if (await this.fs.isMirrored(ref)) return ref;

    let repo;
    try {
      repo = await this.gh.getRepo(ref);
    } catch (e) {
      if (e instanceof TypeError) throw new OfflineUnavailableError("L'elenco delle sorveglianze");
      throw e;
    }
    if (!repo) {
      await this.gh.createUserRepo(INDEX_REPO_NAME, {
        description: INDEX_REPO_DESCRIPTION,
        private: true,
      });
      await this.fs.ready(ref, { force: true });
      // auto_init=true gives us a default README; overwrite with our own.
      await this.fs.putText(ref, 'README.md', INDEX_README, 'archaeo-pro: init index repo');
      await this.fs.putJson(
        ref,
        'profile.json',
        { login: me.login, name: me.name, created_at: new Date().toISOString() },
        'archaeo-pro: write profile',
      );
      await this.fs.putText(ref, '.archaeo-pro/version', '1\n', 'archaeo-pro: pin schema version');
    }
    return ref;
  }

  async getEntry(id: string): Promise<SurveillanceIndexEntry | null> {
    const ref = await this.bootstrap();
    return this.fs.getJson<SurveillanceIndexEntry>(ref, `surveillances/${id}.json`);
  }

  async listEntries(): Promise<SurveillanceIndexEntry[]> {
    const ref = await this.bootstrap();
    const files = (await this.fs.listDir(ref, 'surveillances')).filter((i) =>
      i.name.endsWith('.json'),
    );
    const entries: SurveillanceIndexEntry[] = [];
    for (const f of files) {
      try {
        const entry = await this.fs.getJson<SurveillanceIndexEntry>(ref, f.path);
        if (entry) entries.push(entry);
      } catch {
        // skip malformed entry; surface in UI later if needed
      }
    }
    return entries.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  async putEntry(entry: SurveillanceIndexEntry): Promise<void> {
    const ref = await this.bootstrap();
    const path = `surveillances/${entry.id}.json`;
    const existed = await this.fs.exists(ref, path);
    await this.fs.putJson(
      ref,
      path,
      entry,
      `archaeo-pro: ${existed ? 'update' : 'add'} ${entry.title}`,
    );
  }

  async deleteEntry(id: string): Promise<void> {
    const ref = await this.bootstrap();
    await this.fs.remove(ref, `surveillances/${id}.json`, `archaeo-pro: remove ${id}`);
  }
}
