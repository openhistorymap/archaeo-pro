/**
 * High-level operations on a single surveillance, mapped onto its dedicated
 * GitHub repo `archaeo-pro-{uuid}` (private by default).
 *
 * Layout (see docs/architecture.md):
 *   surveillance.json
 *   area.geojson
 *   findings/<finding-id>.geojson
 *   units/<finding-id>/us-NNN.json
 *   photos/<photo-id>.json    -> references a Release asset on tag "data"
 *   exports/...
 *   .archaeo-pro/version
 */
import { Injectable, inject } from '@angular/core';

import {
  Finding,
  Photo,
  StratigraphicUnit,
  Surveillance,
  SurveillanceIndexEntry,
} from '../types/surveillance';
import { GitHubAuthService } from '../github/auth.service';
import { GitHubClient, RepoRef } from '../github/client';
import { IndexRepoService } from './index-repo';

const SURVEILLANCE_REPO_PREFIX = 'archaeo-pro-';
const PHOTOS_RELEASE_TAG = 'data';

interface CreateSurveillanceInput {
  title: string;
  protocollo?: string | null;
  comune?: string | null;
  provincia?: string | null;
}

const SURVEILLANCE_README = (s: Surveillance) => `# ${s.title}

Sorveglianza archeologica gestita da **archaeo-pro**.

| | |
| --- | --- |
| Protocollo | ${s.protocollo ?? '—'} |
| Committente | ${s.committente ?? '—'} |
| Comune | ${s.comune ?? '—'} (${s.provincia ?? '—'}) |
| Periodo | ${s.start_date ?? '—'} → ${s.end_date ?? '—'} |

I dati strutturati sono in \`surveillance.json\`, \`findings/\`, \`units/\`,
\`photos/\`. I binari delle foto sono asset della Release \`${PHOTOS_RELEASE_TAG}\`.
`;

function uuidv4(): string {
  if (crypto && 'randomUUID' in crypto) return (crypto as Crypto).randomUUID();
  // RFC 4122 v4 fallback — only used in environments without crypto.randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

@Injectable({ providedIn: 'root' })
export class SurveillanceStore {
  private readonly gh = inject(GitHubClient);
  private readonly auth = inject(GitHubAuthService);
  private readonly index = inject(IndexRepoService);

  // ---- create / load ---------------------------------------------------

  async createSurveillance(input: CreateSurveillanceInput): Promise<{ ref: RepoRef; surveillance: Surveillance }> {
    const me = await this.auth.ensureUser();
    if (!me) throw new Error('Not authenticated.');

    const id = uuidv4();
    const repoName = `${SURVEILLANCE_REPO_PREFIX}${id}`;
    const repo = await this.gh.createUserRepo(repoName, {
      description: `archaeo-pro — ${input.title}`,
      private: true,
    });
    const ref: RepoRef = { owner: me.login, name: repoName };

    const now = new Date().toISOString();
    const surveillance: Surveillance = {
      id,
      title: input.title,
      protocollo: input.protocollo ?? null,
      committente: null,
      direttore_tecnico: null,
      sabap: null,
      comune: input.comune ?? null,
      provincia: input.provincia ?? null,
      foglio_catastale: null,
      particelle: null,
      normativa: null,
      start_date: null,
      end_date: null,
      premessa: null,
      metodologia: null,
      risultati: null,
      conclusioni: null,
      area: null,
      findings: [],
      photos: [],
      created_at: now,
      updated_at: now,
    };

    // Overwrite the auto-init README with our own.
    const readme = await this.gh.getFile(ref, 'README.md');
    await this.gh.putFile(ref, 'README.md', SURVEILLANCE_README(surveillance), 'archaeo-pro: init', readme?.sha);

    await this.gh.putFile(
      ref,
      'surveillance.json',
      JSON.stringify(this.toRoot(surveillance), null, 2) + '\n',
      'archaeo-pro: init surveillance',
    );
    await this.gh.putFile(ref, '.archaeo-pro/version', '1\n', 'archaeo-pro: pin schema version');
    await this.gh.ensureRelease(ref, PHOTOS_RELEASE_TAG, 'archaeo-pro photo binaries');

    await this.index.putEntry(this.toIndexEntry(surveillance, repo.html_url, ref));

    return { ref, surveillance };
  }

  async loadSurveillance(ref: RepoRef): Promise<Surveillance> {
    const root = await this.gh.getFile(ref, 'surveillance.json');
    if (!root) throw new Error(`surveillance.json missing in ${ref.owner}/${ref.name}`);
    const base = JSON.parse(this.decode(root.content)) as Omit<Surveillance, 'findings' | 'photos'>;

    const findings: Finding[] = [];
    for (const item of await this.gh.listDir(ref, 'findings')) {
      if (item.type !== 'file' || !item.name.endsWith('.geojson')) continue;
      const f = await this.gh.getFile(ref, item.path);
      if (!f) continue;
      const feature = JSON.parse(this.decode(f.content)) as GeoJSON.Feature;
      const props = (feature.properties ?? {}) as Partial<Finding>;
      const finding: Finding = {
        id: (props.id as string) ?? item.name.replace(/\.geojson$/, ''),
        name: (props.name as string) ?? '(senza nome)',
        description: (props.description as string) ?? null,
        interpretation: (props.interpretation as string) ?? null,
        start_date: (props.start_date as string) ?? null,
        end_date: (props.end_date as string) ?? null,
        tags: (props.tags as Record<string, string>) ?? {},
        geometry: feature.geometry ?? null,
        units: [],
      };
      finding.units = await this.loadUnits(ref, finding.id);
      findings.push(finding);
    }

    const photos: Photo[] = [];
    for (const item of await this.gh.listDir(ref, 'photos')) {
      if (item.type !== 'file' || !item.name.endsWith('.json')) continue;
      const f = await this.gh.getFile(ref, item.path);
      if (!f) continue;
      photos.push(JSON.parse(this.decode(f.content)) as Photo);
    }

    return { ...base, findings, photos } as Surveillance;
  }

  private async loadUnits(ref: RepoRef, findingId: string): Promise<StratigraphicUnit[]> {
    const out: StratigraphicUnit[] = [];
    for (const item of await this.gh.listDir(ref, `units/${findingId}`)) {
      if (item.type !== 'file' || !item.name.endsWith('.json')) continue;
      const f = await this.gh.getFile(ref, item.path);
      if (!f) continue;
      out.push(JSON.parse(this.decode(f.content)) as StratigraphicUnit);
    }
    return out.sort((a, b) => a.number - b.number);
  }

  // ---- mutations -------------------------------------------------------

  async saveSurveillance(ref: RepoRef, s: Surveillance): Promise<void> {
    const existing = await this.gh.getFile(ref, 'surveillance.json');
    const updated: Surveillance = { ...s, updated_at: new Date().toISOString() };
    await this.gh.putFile(
      ref,
      'surveillance.json',
      JSON.stringify(this.toRoot(updated), null, 2) + '\n',
      'archaeo-pro: update surveillance',
      existing?.sha,
    );
    const me = await this.auth.ensureUser();
    if (me) {
      await this.index.putEntry(
        this.toIndexEntry(updated, `https://github.com/${ref.owner}/${ref.name}`, ref),
      );
    }
  }

  async addFinding(ref: RepoRef, finding: Finding): Promise<void> {
    const path = `findings/${finding.id}.geojson`;
    const existing = await this.gh.getFile(ref, path);
    const feature: GeoJSON.Feature = {
      type: 'Feature',
      id: finding.id,
      geometry: finding.geometry ?? ({ type: 'Point', coordinates: [0, 0] } as GeoJSON.Point),
      properties: {
        id: finding.id,
        name: finding.name,
        description: finding.description ?? null,
        interpretation: finding.interpretation ?? null,
        start_date: finding.start_date ?? null,
        end_date: finding.end_date ?? null,
        tags: finding.tags ?? {},
      },
    };
    await this.gh.putFile(
      ref,
      path,
      JSON.stringify(feature, null, 2) + '\n',
      `archaeo-pro: ${existing ? 'update' : 'add'} finding ${finding.name}`,
      existing?.sha,
    );
  }

  async attachPhoto(ref: RepoRef, file: File, meta: Omit<Photo, 'id' | 'asset_id' | 'asset_url'>): Promise<Photo> {
    const id = uuidv4();
    const release = await this.gh.ensureRelease(ref, PHOTOS_RELEASE_TAG, 'archaeo-pro photo binaries');
    const asset = await this.gh.uploadReleaseAsset(ref, release.id, `${id}-${file.name}`, file.type || 'image/jpeg', file);
    const photo: Photo = {
      ...meta,
      id,
      asset_id: asset.id,
      asset_url: asset.url,
    };
    await this.gh.putFile(
      ref,
      `photos/${id}.json`,
      JSON.stringify(photo, null, 2) + '\n',
      `archaeo-pro: add photo ${file.name}`,
    );
    return photo;
  }

  // ---- helpers ---------------------------------------------------------

  refForSurveillance(entry: SurveillanceIndexEntry): RepoRef {
    return entry.repo;
  }

  private toRoot(s: Surveillance): Omit<Surveillance, 'findings' | 'photos'> {
    const { findings: _f, photos: _p, ...root } = s;
    return root;
  }

  private toIndexEntry(s: Surveillance, repoUrl: string, ref: RepoRef): SurveillanceIndexEntry {
    return {
      id: s.id,
      title: s.title,
      comune: s.comune ?? null,
      provincia: s.provincia ?? null,
      start_date: s.start_date ?? null,
      end_date: s.end_date ?? null,
      status: 'draft',
      bbox: this.bboxOfArea(s.area),
      repo_url: repoUrl,
      repo: ref,
      ohm_published: false,
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  }

  private bboxOfArea(area: GeoJSON.Polygon | null | undefined): [number, number, number, number] | null {
    if (!area || !area.coordinates || area.coordinates.length === 0) return null;
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const ring of area.coordinates) {
      for (const [x, y] of ring) {
        if (x < west) west = x;
        if (x > east) east = x;
        if (y < south) south = y;
        if (y > north) north = y;
      }
    }
    return [west, south, east, north];
  }

  private decode(b64: string): string {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
  }
}
