/**
 * Manages the per-archaeologist `archaeo-pro-index` repository.
 *
 * One file per surveillance under surveillances/<id>.json so concurrent edits
 * across devices don't conflict on the index. README + profile.json round it
 * out so the repo is self-explanatory when browsed on github.com.
 */
import { Injectable, inject } from '@angular/core';

import { SurveillanceIndexEntry } from '../types/surveillance';
import { GitHubAuthService } from '../github/auth.service';
import { GitHubClient, RepoRef } from '../github/client';

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

  /** Create the index repo if it doesn't exist; populate the README + profile.json. */
  async bootstrap(): Promise<RepoRef> {
    const me = await this.auth.ensureUser();
    if (!me) throw new Error('Cannot bootstrap index repo: not authenticated.');
    const ref: RepoRef = { owner: me.login, name: INDEX_REPO_NAME };

    let repo = await this.gh.getRepo(ref);
    if (!repo) {
      repo = await this.gh.createUserRepo(INDEX_REPO_NAME, {
        description: INDEX_REPO_DESCRIPTION,
        private: true,
      });
      // auto_init=true gives us a default README; overwrite with our own.
      const readme = await this.gh.getFile(ref, 'README.md');
      await this.gh.putFile(ref, 'README.md', INDEX_README, 'archaeo-pro: init index repo', readme?.sha);
      await this.gh.putFile(
        ref,
        'profile.json',
        JSON.stringify({ login: me.login, name: me.name, created_at: new Date().toISOString() }, null, 2),
        'archaeo-pro: write profile',
      );
      await this.gh.putFile(
        ref,
        '.archaeo-pro/version',
        '1\n',
        'archaeo-pro: pin schema version',
      );
    }
    return ref;
  }

  async listEntries(): Promise<SurveillanceIndexEntry[]> {
    const ref = await this.bootstrap();
    const items = await this.gh.listDir(ref, 'surveillances');
    const files = items.filter((i) => i.type === 'file' && i.name.endsWith('.json'));
    const entries: SurveillanceIndexEntry[] = [];
    for (const f of files) {
      const blob = await this.gh.getFile(ref, f.path);
      if (!blob) continue;
      try {
        entries.push(JSON.parse(this.decode(blob.content)) as SurveillanceIndexEntry);
      } catch {
        // skip malformed entry; surface in UI later if needed
      }
    }
    return entries.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  async putEntry(entry: SurveillanceIndexEntry): Promise<void> {
    const ref = await this.bootstrap();
    const path = `surveillances/${entry.id}.json`;
    const existing = await this.gh.getFile(ref, path);
    await this.gh.putFile(
      ref,
      path,
      JSON.stringify(entry, null, 2) + '\n',
      `archaeo-pro: ${existing ? 'update' : 'add'} ${entry.title}`,
      existing?.sha,
    );
  }

  async deleteEntry(id: string): Promise<void> {
    const ref = await this.bootstrap();
    const path = `surveillances/${id}.json`;
    const existing = await this.gh.getFile(ref, path);
    if (!existing) return;
    await this.gh.deleteFile(ref, path, existing.sha, `archaeo-pro: remove ${id}`);
  }

  private decode(b64: string): string {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
  }
}
