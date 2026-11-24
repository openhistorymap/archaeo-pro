/**
 * Team work on a surveillance, through GitHub's own collaborators.
 *
 * Each surveillance is already a private repo, so sharing it means inviting
 * GitHub users to that repo. Roles are GitHub permission levels:
 *
 *   amministratore → admin  (direttore tecnico: invites people, owns visibility)
 *   collaboratore  → push   (records in the field and in the office)
 *   lettura        → pull   (reviewers: can open and read, cannot change)
 *
 * No server keeps any of this: GitHub is the list of who may do what, the
 * commit history says who changed what. The app only adds:
 * - invitations shown and answered inside the app;
 * - a "Condivise con me" list, built from the repos where the user is a
 *   collaborator and cached for offline use;
 * - the user's role recorded per repo, so a read-only user can't queue edits.
 */
import { Injectable, inject } from '@angular/core';

import {
  GitHubClient,
  GitHubCollaborator,
  GitHubRepo,
  GitHubRepoInvitation,
  GitHubRole,
  RepoRef,
} from '../github/client';
import { OFFLINE_DB, RepoPermission, isNetworkError, repoKey } from '../offline/db';
import { RepoFs } from '../offline/repo-fs';
import { Surveillance, SurveillanceIndexEntry, SurveillanceStatus } from '../types/surveillance';

const SURVEILLANCE_PREFIX = 'archaeo-pro-';
const INDEX_REPO = 'archaeo-pro-index';

export type ShareRole = 'admin' | 'push' | 'pull';

export const SHARE_ROLES: { value: ShareRole; label: string; hint: string }[] = [
  { value: 'push', label: 'Collaboratore', hint: 'registra e modifica' },
  { value: 'pull', label: 'Lettura', hint: 'consulta, non modifica' },
  { value: 'admin', label: 'Amministratore', hint: 'invita altre persone' },
];

export interface Member {
  login: string;
  avatarUrl?: string;
  role: RepoPermission;
  /** Invited, not accepted yet. */
  pending: boolean;
  invitationId?: number;
}

export function permissionOf(repo: Pick<GitHubRepo, 'permissions'>): RepoPermission {
  const p = repo.permissions;
  if (p?.admin) return 'admin';
  if (p?.push || p?.maintain) return 'write';
  return 'read';
}

function roleOf(
  name: string | undefined,
  perms?: GitHubCollaborator['permissions'],
): RepoPermission {
  if (name === 'admin' || perms?.admin) return 'admin';
  if (name === 'write' || name === 'maintain' || perms?.push) return 'write';
  return 'read';
}

function isSurveillanceRepo(name: string): boolean {
  return name.startsWith(SURVEILLANCE_PREFIX) && name !== INDEX_REPO;
}

@Injectable({ providedIn: 'root' })
export class SharingService {
  private readonly gh = inject(GitHubClient);
  private readonly fs = inject(RepoFs);
  private readonly db = inject(OFFLINE_DB);

  // ---- the signed-in user's side ------------------------------------------

  /** Invitations to archaeo-pro surveillances waiting for this user. */
  async myInvitations(): Promise<GitHubRepoInvitation[]> {
    try {
      const all = await this.gh.listMyInvitations();
      return all.filter((i) => isSurveillanceRepo(i.repository.name));
    } catch (e) {
      if (isNetworkError(e)) return [];
      throw e;
    }
  }

  async answer(invitation: GitHubRepoInvitation, accept: boolean): Promise<void> {
    await this.gh.answerInvitation(invitation.id, accept);
  }

  /**
   * Surveillances other people shared with this user. Online: read from
   * GitHub and cached; offline: the cached list.
   */
  async listShared(): Promise<SurveillanceIndexEntry[]> {
    let repos: GitHubRepo[];
    try {
      repos = (await this.gh.listUserRepos(SURVEILLANCE_PREFIX, 'collaborator')).filter((r) =>
        isSurveillanceRepo(r.name),
      );
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      return (await this.db.shared.toArray()).map((s) => s.entry as SurveillanceIndexEntry);
    }

    const entries: SurveillanceIndexEntry[] = [];
    for (const repo of repos) {
      const ref: RepoRef = {
        owner: repo.owner?.login ?? repo.full_name.split('/')[0],
        name: repo.name,
      };
      const permission = permissionOf(repo);
      await this.fs.setPermission(ref, permission);
      try {
        const s = await this.fs.getJson<Partial<Surveillance>>(ref, 'surveillance.json');
        if (!s?.id) continue;
        entries.push(this.entryFor(s, ref, repo.html_url, permission));
      } catch {
        // an empty or foreign repo with our prefix: not a surveillance
      }
    }
    await this.db.transaction('rw', this.db.shared, async () => {
      await this.db.shared.clear();
      await this.db.shared.bulkPut(
        entries.map((e) => ({
          id: e.id,
          repo: repoKey(e.repo),
          permission: e.permission!,
          entry: e,
        })),
      );
    });
    return entries.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  /** A shared surveillance by id, from the cache filled by listShared. */
  async getShared(id: string): Promise<SurveillanceIndexEntry | null> {
    const hit = await this.db.shared.get(id);
    if (hit) return hit.entry as SurveillanceIndexEntry;
    const fresh = await this.listShared();
    return fresh.find((e) => e.id === id) ?? null;
  }

  /** This user's access to a repo, refreshed from GitHub when online. */
  async permission(ref: RepoRef): Promise<RepoPermission | undefined> {
    try {
      const repo = await this.gh.getRepo(ref);
      if (repo) {
        const p = permissionOf(repo);
        await this.fs.setPermission(ref, p);
        return p;
      }
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
    return this.fs.permission(ref);
  }

  // ---- the owner's side -----------------------------------------------------

  /** Everyone with access, and everyone invited. Online only. */
  async members(ref: RepoRef): Promise<Member[]> {
    const [collaborators, invitations] = await Promise.all([
      this.gh.listCollaborators(ref),
      this.gh.listRepoInvitations(ref),
    ]);
    return [
      ...collaborators.map((c) => ({
        login: c.login,
        avatarUrl: c.avatar_url,
        role: roleOf(c.role_name, c.permissions),
        pending: false,
      })),
      ...invitations
        .filter((i) => i.invitee?.login)
        .map((i) => ({
          login: i.invitee!.login,
          role: roleOf(i.permissions),
          pending: true,
          invitationId: i.id,
        })),
    ];
  }

  async invite(ref: RepoRef, login: string, role: ShareRole): Promise<void> {
    const clean = login.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(clean)) {
      throw new Error(`«${login}» non è un nome utente GitHub valido.`);
    }
    await this.gh.addCollaborator(ref, clean, role as GitHubRole);
  }

  async remove(ref: RepoRef, member: Member): Promise<void> {
    if (member.pending && member.invitationId)
      await this.gh.cancelRepoInvitation(ref, member.invitationId);
    else await this.gh.removeCollaborator(ref, member.login);
  }

  private entryFor(
    s: Partial<Surveillance>,
    ref: RepoRef,
    url: string,
    permission: RepoPermission,
  ): SurveillanceIndexEntry {
    return {
      id: s.id!,
      title: s.title ?? ref.name,
      comune: s.comune ?? null,
      provincia: s.provincia ?? null,
      start_date: s.start_date ?? null,
      end_date: s.end_date ?? null,
      status: (s.status as SurveillanceStatus) ?? 'draft',
      bbox: null,
      repo_url: url,
      repo: ref,
      ohm_published: false,
      created_at: s.created_at ?? '',
      updated_at: s.updated_at ?? '',
      shared: true,
      permission,
    };
  }
}
