import { TestBed } from '@angular/core/testing';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { GitHubAuthService } from '../github/auth.service';
import { GitHubClient, GitHubError, RepoRef } from '../github/client';
import { OFFLINE_DB, OfflineDb, OfflineUnavailableError, fileKey } from './db';
import { RepoFs } from './repo-fs';
import { SyncService } from './sync.service';

/** An in-memory GitHub: just the calls the offline layer makes. */
class FakeGitHub {
  readonly repos = new Map<string, Map<string, { body: string; sha: string }>>();
  readonly calls: string[] = [];
  offline = false;
  private n = 0;

  seed(ref: RepoRef, files: Record<string, string>): void {
    const repo = new Map<string, { body: string; sha: string }>();
    for (const [path, body] of Object.entries(files)) repo.set(path, { body, sha: this.nextSha() });
    this.repos.set(this.key(ref), repo);
  }

  body(ref: RepoRef, path: string): string | undefined {
    return this.repos.get(this.key(ref))?.get(path)?.body;
  }

  /** Someone else edits the file on GitHub. */
  editRemotely(ref: RepoRef, path: string, body: string): void {
    this.repos.get(this.key(ref))!.set(path, { body, sha: this.nextSha() });
  }

  async getTree(ref: RepoRef) {
    this.check('tree');
    const repo = this.repos.get(this.key(ref));
    if (!repo) return null;
    return [...repo].map(([path, f]) => ({ path, type: 'blob' as const, sha: f.sha }));
  }

  async getBlobBySha(ref: RepoRef, sha: string, type = 'application/octet-stream') {
    this.check('blob');
    const f = [...this.repos.get(this.key(ref))!.values()].find((x) => x.sha === sha);
    if (!f) throw new GitHubError(404, 'no blob');
    return new Blob([f.body], { type });
  }

  async getFile(ref: RepoRef, path: string) {
    this.check('get');
    const f = this.repos.get(this.key(ref))?.get(path);
    if (!f) return null;
    return { sha: f.sha, content: btoa(unescape(encodeURIComponent(f.body))) } as never;
  }

  async putFile(ref: RepoRef, path: string, content: string, _m: string, sha?: string) {
    this.check(`put ${path}`);
    const repo = this.repos.get(this.key(ref));
    if (!repo) throw new GitHubError(404, 'no repo');
    const current = repo.get(path);
    if (current && !sha) throw new GitHubError(422, 'sha missing');
    if (current && sha !== current.sha) throw new GitHubError(409, 'sha mismatch');
    const next = { body: content, sha: this.nextSha() };
    repo.set(path, next);
    return { content: { sha: next.sha, path } };
  }

  async putBinaryFile(ref: RepoRef, path: string, blob: Blob, m: string, sha?: string) {
    return this.putFile(ref, path, await blob.text(), m, sha);
  }

  async deleteFile(ref: RepoRef, path: string, sha: string) {
    this.check(`delete ${path}`);
    const repo = this.repos.get(this.key(ref))!;
    const current = repo.get(path);
    if (!current) throw new GitHubError(404, 'gone');
    if (current.sha !== sha) throw new GitHubError(409, 'sha mismatch');
    repo.delete(path);
  }

  async createUserRepo(name: string) {
    this.check(`create ${name}`);
    const key = `me/${name}`;
    if (this.repos.has(key)) throw new GitHubError(422, 'exists');
    this.repos.set(key, new Map());
    return { name, html_url: `https://github.com/${key}` } as never;
  }

  private check(call: string): void {
    if (this.offline) throw new TypeError('Failed to fetch');
    this.calls.push(call);
  }

  private key(ref: RepoRef): string {
    return `${ref.owner}/${ref.name}`;
  }

  private nextSha(): string {
    return `sha${++this.n}`;
  }
}

describe('offline-first storage', () => {
  const ref: RepoRef = { owner: 'me', name: 'archaeo-pro-1' };
  let gh: FakeGitHub;
  let fs: RepoFs;
  let sync: SyncService;
  let db: OfflineDb;

  beforeEach(() => {
    gh = new FakeGitHub();
    db = new OfflineDb(`test-${Math.random()}`, { indexedDB, IDBKeyRange });
    TestBed.configureTestingModule({
      providers: [
        { provide: GitHubClient, useValue: gh },
        { provide: GitHubAuthService, useValue: { token: () => ({ access_token: 't' }) } },
        { provide: OFFLINE_DB, useValue: db },
      ],
    });
    fs = TestBed.inject(RepoFs);
    sync = TestBed.inject(SyncService);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('reads a mirrored repo with no connection', async () => {
    gh.seed(ref, { 'surveillance.json': '{"id":"1"}', 'findings/a.geojson': '{}' });
    await fs.ready(ref);
    gh.offline = true;
    sync.online.set(false);

    expect(await fs.getJson(ref, 'surveillance.json')).toEqual({ id: '1' });
    expect((await fs.listDir(ref, 'findings')).map((f) => f.path)).toEqual(['findings/a.geojson']);
  });

  it('fails clearly for a repo never opened online', async () => {
    gh.offline = true;
    sync.online.set(false);
    await expect(fs.getText(ref, 'surveillance.json')).rejects.toBeInstanceOf(
      OfflineUnavailableError,
    );
  });

  it('keeps offline edits and pushes them once, merged, when back online', async () => {
    gh.seed(ref, { 'daily/2026-11-24.json': '{"v":0}' });
    await fs.ready(ref);
    gh.offline = true;
    sync.online.set(false);

    await fs.putJson(ref, 'daily/2026-11-24.json', { v: 1 }, 'edit 1');
    await fs.putJson(ref, 'daily/2026-11-24.json', { v: 2 }, 'edit 2');
    expect(await fs.getJson(ref, 'daily/2026-11-24.json')).toEqual({ v: 2 });
    expect(sync.pending()).toBe(1);

    gh.offline = false;
    sync.online.set(true);
    await sync.flush();

    expect(JSON.parse(gh.body(ref, 'daily/2026-11-24.json')!)).toEqual({ v: 2 });
    expect(gh.calls.filter((c) => c.startsWith('put'))).toHaveLength(1);
    expect(sync.pending()).toBe(0);
    expect((await db.files.get(fileKey(ref, 'daily/2026-11-24.json')))!.dirty).toBe(false);
  });

  it('creates a surveillance repo offline before pushing its files', async () => {
    const fresh: RepoRef = { owner: 'me', name: 'archaeo-pro-new' };
    gh.offline = true;
    sync.online.set(false);

    await fs.createRepo(fresh, 'new survey');
    await fs.putJson(fresh, 'surveillance.json', { id: 'new' }, 'init');
    expect(await fs.getJson(fresh, 'surveillance.json')).toEqual({ id: 'new' });

    gh.offline = false;
    sync.online.set(true);
    await sync.flush();

    expect(gh.calls[0]).toBe('create archaeo-pro-new');
    expect(JSON.parse(gh.body(fresh, 'surveillance.json')!)).toEqual({ id: 'new' });
  });

  it('keeps the remote version aside when both sides changed, and lets the field edit win', async () => {
    gh.seed(ref, { 'surveillance.json': '{"title":"A"}' });
    await fs.ready(ref);
    gh.offline = true;
    sync.online.set(false);
    await fs.putJson(ref, 'surveillance.json', { title: 'field' }, 'edit');

    gh.offline = false;
    gh.editRemotely(ref, 'surveillance.json', '{"title":"office"}');
    sync.online.set(true);
    await sync.flush();

    expect(JSON.parse(gh.body(ref, 'surveillance.json')!)).toEqual({ title: 'field' });
    const kept = await db.conflicts.toArray();
    expect(kept).toHaveLength(1);
    expect(kept[0].remoteText).toBe('{"title":"office"}');
    expect(sync.conflicts()).toBe(1);
  });

  it('refreshing keeps unpushed edits and drops files deleted on GitHub', async () => {
    gh.seed(ref, { 'a.json': '1', 'b.json': '2' });
    await fs.ready(ref);
    gh.offline = true;
    sync.online.set(false);
    await fs.putText(ref, 'a.json', 'local', 'edit');

    gh.offline = false;
    gh.repos.get('me/archaeo-pro-1')!.delete('b.json');
    await fs.refresh(ref);

    expect((await fs.getText(ref, 'a.json'))!.text).toBe('local');
    expect(await fs.getText(ref, 'b.json')).toBeNull();
  });

  it('forgets a file created and deleted before it ever reached GitHub', async () => {
    gh.seed(ref, {});
    await fs.ready(ref);
    gh.offline = true;
    sync.online.set(false);

    await fs.putText(ref, 'photos/x.json', '{}', 'add');
    await fs.remove(ref, 'photos/x.json', 'remove');
    expect(sync.pending()).toBe(0);
    expect(await fs.exists(ref, 'photos/x.json')).toBe(false);
  });

  it('pushes a delete of a file that exists on GitHub', async () => {
    gh.seed(ref, { 'photos/x.json': '{}' });
    await fs.ready(ref);
    await fs.remove(ref, 'photos/x.json', 'remove');
    await sync.flush();

    expect(gh.body(ref, 'photos/x.json')).toBeUndefined();
    expect(await db.files.get(fileKey(ref, 'photos/x.json'))).toBeUndefined();
  });

  it('fetches a photo once and serves it offline afterwards', async () => {
    gh.seed(ref, { 'photos/p.jpg': 'JPEGBYTES' });
    const blob = await fs.getBlob(ref, 'photos/p.jpg', 'image/jpeg');
    expect(await blob!.text()).toBe('JPEGBYTES');

    gh.offline = true;
    sync.online.set(false);
    const again = await fs.getBlob(ref, 'photos/p.jpg', 'image/jpeg');
    expect(await again!.text()).toBe('JPEGBYTES');
  });
});
