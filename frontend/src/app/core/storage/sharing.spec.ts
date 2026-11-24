import { TestBed } from '@angular/core/testing';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';

import { GitHubAuthService } from '../github/auth.service';
import { GitHubClient, RepoRef } from '../github/client';
import { OFFLINE_DB, OfflineDb } from '../offline/db';
import { SharingService, permissionOf } from './sharing';

describe('sharing a surveillance', () => {
  const ref: RepoRef = { owner: 'rossi', name: 'archaeo-pro-1' };
  let db: OfflineDb;
  let calls: string[];
  let sharing: SharingService;
  let online: boolean;

  beforeEach(() => {
    calls = [];
    online = true;
    db = new OfflineDb(`test-${Math.random()}`, { indexedDB, IDBKeyRange });
    const gh = {
      listUserRepos: async () => {
        if (!online) throw new TypeError('Failed to fetch');
        return [
          {
            name: 'archaeo-pro-1',
            full_name: 'rossi/archaeo-pro-1',
            html_url: 'u',
            owner: { login: 'rossi' },
            permissions: { admin: false, push: false, pull: true },
          },
          {
            name: 'archaeo-pro-index',
            full_name: 'rossi/archaeo-pro-index',
            html_url: 'u',
            owner: { login: 'rossi' },
          },
        ];
      },
      getTree: async () => [{ path: 'surveillance.json', type: 'blob', sha: 's1' }],
      getBlobBySha: async () =>
        new Blob([JSON.stringify({ id: 's-1', title: 'Via Irnerio', updated_at: '2026-11-24' })]),
      addCollaborator: async (_r: RepoRef, login: string, role: string) =>
        void calls.push(`add ${login} ${role}`),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: GitHubClient, useValue: gh },
        { provide: GitHubAuthService, useValue: { token: () => ({ access_token: 't' }) } },
        { provide: OFFLINE_DB, useValue: db },
      ],
    });
    sharing = TestBed.inject(SharingService);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('maps GitHub permissions onto the three roles', () => {
    expect(permissionOf({ permissions: { admin: true, push: true, pull: true } })).toBe('admin');
    expect(permissionOf({ permissions: { admin: false, push: true, pull: true } })).toBe('write');
    expect(permissionOf({ permissions: { admin: false, push: false, pull: true } })).toBe('read');
  });

  it('lists shared surveillances, skips the index, and keeps them for offline use', async () => {
    const list = await sharing.listShared();
    expect(list.map((e) => [e.id, e.title, e.permission, e.shared])).toEqual([
      ['s-1', 'Via Irnerio', 'read', true],
    ]);

    online = false;
    expect((await sharing.listShared()).map((e) => e.id)).toEqual(['s-1']);
    expect((await sharing.getShared('s-1'))?.repo).toEqual(ref);
  });

  it('invites by GitHub username and refuses anything that is not one', async () => {
    await sharing.invite(ref, '@verdi', 'push');
    expect(calls).toEqual(['add verdi push']);
    await expect(sharing.invite(ref, 'mario rossi', 'push')).rejects.toThrow(/nome utente GitHub/);
  });
});
