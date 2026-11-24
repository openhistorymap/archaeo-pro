/**
 * High-level operations on a single surveillance, mapped onto its dedicated
 * GitHub repo `archaeo-pro-{uuid}` (private by default).
 *
 * Layout (see docs/architecture.md):
 *   surveillance.json
 *   area.geojson
 *   findings/<finding-id>.geojson
 *   units/<finding-id>/us-NNN.json
 *   photos/<photo-id>.json    -> metadata beside photos/<photo-id>.<ext>
 *   exports/...
 *   .archaeo-pro/version
 *
 * Everything goes through the offline mirror (RepoFs): edits are saved on the
 * device at once and pushed to GitHub by SyncService when there is a
 * connection. A surveillance can even be created offline; its repo is created
 * on GitHub by the next sync.
 */
import { Injectable, inject } from '@angular/core';

import {
  DayLog,
  Finding,
  Photo,
  StratigraphicUnit,
  Surveillance,
  SurveillanceIndexEntry,
  SurveillanceStatus,
  Tavola,
} from '../types/surveillance';
import {
  GEOCONTEXT_AREA,
  GEOCONTEXT_FILE,
  GEOCONTEXT_FINDINGS,
  buildGeoContext,
} from '../geocontext/geocontext';
import { GitHubAuthService } from '../github/auth.service';
import { GitHubClient, RepoRef } from '../github/client';
import { isNetworkError } from '../offline/db';
import { RepoFs } from '../offline/repo-fs';
import { resizeImage } from '../utils/image-resize';
import { IndexRepoService } from './index-repo';

const SURVEILLANCE_REPO_PREFIX = 'archaeo-pro-';

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

I dati strutturati sono in \`surveillance.json\`, \`findings/\`, \`units/\`.
Le foto risiedono in \`photos/\` (binario + metadati JSON affiancato).
`;

function uuidv4(): string {
  return crypto.randomUUID();
}

@Injectable({ providedIn: 'root' })
export class SurveillanceStore {
  private readonly fs = inject(RepoFs);
  private readonly gh = inject(GitHubClient);
  private readonly auth = inject(GitHubAuthService);
  private readonly index = inject(IndexRepoService);

  // ---- create / load ---------------------------------------------------

  async createSurveillance(
    input: CreateSurveillanceInput,
  ): Promise<{ ref: RepoRef; surveillance: Surveillance }> {
    const me = await this.auth.ensureUser();
    if (!me) throw new Error('Not authenticated.');

    const id = uuidv4();
    const repoName = `${SURVEILLANCE_REPO_PREFIX}${id}`;
    const ref: RepoRef = { owner: me.login, name: repoName };
    await this.fs.createRepo(ref, `archaeo-pro — ${input.title}`);

    const now = new Date().toISOString();
    const surveillance: Surveillance = {
      id,
      title: input.title,
      status: 'draft',
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
      days: [],
      tavole: [],
      created_at: now,
      updated_at: now,
    };

    await this.fs.putText(ref, 'README.md', SURVEILLANCE_README(surveillance), 'archaeo-pro: init');
    await this.fs.putJson(
      ref,
      'surveillance.json',
      this.toRoot(surveillance),
      'archaeo-pro: init surveillance',
    );
    await this.fs.putText(ref, '.archaeo-pro/version', '1\n', 'archaeo-pro: pin schema version');

    await this.index.putEntry(this.toIndexEntry(surveillance, this.repoUrl(ref), ref));

    return { ref, surveillance };
  }

  async loadSurveillance(ref: RepoRef): Promise<Surveillance> {
    const raw = await this.fs.getJson<Partial<Surveillance>>(ref, 'surveillance.json');
    if (!raw) throw new Error(`surveillance.json missing in ${ref.owner}/${ref.name}`);
    // Pre-status surveys default to 'draft' so the new flow works on legacy data.
    const base = {
      ...(raw as Omit<Surveillance, 'findings' | 'photos' | 'days' | 'tavole'>),
      status: (raw.status as SurveillanceStatus) ?? 'draft',
    };

    const findings: Finding[] = [];
    for (const item of await this.fs.listDir(ref, 'findings')) {
      if (!item.name.endsWith('.geojson')) continue;
      const feature = await this.fs.getJson<GeoJSON.Feature>(ref, item.path);
      if (!feature) continue;
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
        recorded_on: (props.recorded_on as string) ?? null,
        gna: (props.gna as Finding['gna']) ?? null,
      };
      finding.units = await this.loadUnits(ref, finding.id);
      findings.push(finding);
    }

    const photos = await this.loadJsonDir<Photo>(ref, 'photos');

    const days = await this.loadJsonDir<DayLog>(ref, 'daily');
    days.sort((a, b) => (a.date < b.date ? -1 : 1));

    const tavole = await this.loadJsonDir<Tavola>(ref, 'tavole');
    tavole.sort((a, b) => ((a.captured_on ?? '') < (b.captured_on ?? '') ? -1 : 1));

    return { ...base, findings, photos, days, tavole } as Surveillance;
  }

  private async loadUnits(ref: RepoRef, findingId: string): Promise<StratigraphicUnit[]> {
    const out = await this.loadJsonDir<StratigraphicUnit>(ref, `units/${findingId}`);
    return out.sort((a, b) => a.number - b.number);
  }

  /** Every `*.json` in a directory; a malformed file is skipped so the rest still loads. */
  private async loadJsonDir<T>(ref: RepoRef, dir: string): Promise<T[]> {
    const out: T[] = [];
    for (const item of await this.fs.listDir(ref, dir)) {
      if (!item.name.endsWith('.json')) continue;
      try {
        const value = await this.fs.getJson<T>(ref, item.path);
        if (value) out.push(value);
      } catch {
        // skip a malformed file
      }
    }
    return out;
  }

  // ---- mutations -------------------------------------------------------

  /**
   * Promote/demote a surveillance through its lifecycle without touching
   * the rest of the document. Persists both the surveillance.json status
   * field and the matching entry in the index repo.
   */
  async setStatus(ref: RepoRef, status: SurveillanceStatus): Promise<Surveillance> {
    const current = await this.loadSurveillance(ref);
    const updated: Surveillance = { ...current, status };
    await this.saveSurveillance(ref, updated);
    return updated;
  }

  async saveSurveillance(ref: RepoRef, s: Surveillance): Promise<void> {
    const updated: Surveillance = { ...s, updated_at: new Date().toISOString() };
    await this.fs.putJson(
      ref,
      'surveillance.json',
      this.toRoot(updated),
      'archaeo-pro: update surveillance',
    );
    const me = await this.auth.ensureUser();
    if (me) {
      await this.index.putEntry(this.toIndexEntry(updated, this.repoUrl(ref), ref));
    }
  }

  async addFinding(ref: RepoRef, finding: Finding): Promise<void> {
    const path = `findings/${finding.id}.geojson`;
    const existed = await this.fs.exists(ref, path);
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
        recorded_on: finding.recorded_on ?? null,
        gna: finding.gna ?? null,
      },
    };
    await this.fs.putJson(
      ref,
      path,
      feature,
      `archaeo-pro: ${existed ? 'update' : 'add'} finding ${finding.name}`,
    );
  }

  async attachPhoto(
    ref: RepoRef,
    file: File,
    meta: Omit<Photo, 'id' | 'path' | 'content_type'>,
  ): Promise<Photo> {
    const id = uuidv4();
    // Downscale before saving so 10 MB phone photos don't fill the device
    // mirror, hammer mobile data, or blow the Contents API base64 ceiling.
    const optimized = await resizeImage(file);
    const ext = optimized.type === 'image/png' ? 'png' : 'jpg';
    const path = `photos/${id}.${ext}`;
    await this.fs.putBlob(ref, path, optimized, `archaeo-pro: add photo ${optimized.name}`);
    const photo: Photo = {
      ...meta,
      id,
      filename: optimized.name,
      path,
      content_type: optimized.type || 'image/jpeg',
    };
    await this.fs.putJson(
      ref,
      `photos/${id}.json`,
      photo,
      `archaeo-pro: add photo metadata for ${optimized.name}`,
    );
    return photo;
  }

  // ---- tavole grafiche ------------------------------------------------

  async attachTavola(
    ref: RepoRef,
    blob: Blob,
    meta: Omit<Tavola, 'id' | 'path' | 'content_type' | 'filename'>,
  ): Promise<Tavola> {
    const id = uuidv4();
    const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
    const path = `tavole/${id}.${ext}`;
    const dateLabel = meta.captured_on ?? new Date().toISOString().slice(0, 10);
    const filename = `tavola-${meta.kind}-${dateLabel}.${ext}`;
    await this.fs.putBlob(
      ref,
      path,
      blob,
      `archaeo-pro: aggiungi tavola ${meta.kind} (${dateLabel})`,
    );
    const tavola: Tavola = {
      ...meta,
      id,
      filename,
      path,
      content_type: blob.type || 'image/png',
    };
    await this.fs.putJson(
      ref,
      `tavole/${id}.json`,
      tavola,
      `archaeo-pro: metadata tavola ${meta.kind}`,
    );
    return tavola;
  }

  /**
   * Remove a photo: deletes both the binary at photos/<id>.<ext> and the
   * metadata sidecar photos/<id>.json. Each becomes a separate commit on
   * GitHub because the Contents API doesn't support multi-file deletes.
   */
  async deletePhoto(ref: RepoRef, photo: Photo): Promise<void> {
    if (photo.path) {
      await this.fs.remove(
        ref,
        photo.path,
        `archaeo-pro: rimuovi foto ${photo.filename ?? photo.id}`,
      );
    }
    await this.fs.remove(
      ref,
      `photos/${photo.id}.json`,
      `archaeo-pro: rimuovi metadata foto ${photo.id}`,
    );
  }

  async deleteTavola(ref: RepoRef, tavola: Tavola): Promise<void> {
    if (tavola.path) {
      await this.fs.remove(ref, tavola.path, `archaeo-pro: rimuovi tavola ${tavola.kind}`);
    }
    await this.fs.remove(
      ref,
      `tavole/${tavola.id}.json`,
      `archaeo-pro: rimuovi metadata tavola ${tavola.id}`,
    );
  }

  /** A binary in the surveillance repo (photo, tavola, export), from the device when possible. */
  getBinary(ref: RepoRef, path: string, contentType?: string): Promise<Blob | null> {
    return this.fs.getBlob(ref, path, contentType);
  }

  // ---- GeoContext -------------------------------------------------------

  /**
   * Write (or refresh) the GeoContext descriptor and its two GeoJSON files
   * in the surveillance repo. Goes through the offline queue like any edit.
   * The public map only works once the repo itself is public.
   */
  async writeGeoContext(ref: RepoRef, s: Surveillance): Promise<void> {
    const { descriptor, findings, area } = buildGeoContext(s);
    await this.fs.putJson(ref, GEOCONTEXT_FINDINGS, findings, 'archaeo-pro: GeoContext, evidenze');
    await this.fs.putJson(ref, GEOCONTEXT_AREA, area, 'archaeo-pro: GeoContext, area');
    await this.fs.putJson(ref, GEOCONTEXT_FILE, descriptor, 'archaeo-pro: descrittore GeoContext');
  }

  /** Whether GitHub serves the repo publicly; 'unknown' offline or for a repo not yet created. */
  async repoVisibility(ref: RepoRef): Promise<'public' | 'private' | 'unknown'> {
    try {
      const repo = await this.gh.getRepo(ref);
      if (!repo) return 'unknown';
      return repo.private ? 'private' : 'public';
    } catch (e) {
      if (isNetworkError(e)) return 'unknown';
      throw e;
    }
  }

  // ---- giornale di scavo ----------------------------------------------

  async saveDay(ref: RepoRef, day: DayLog): Promise<DayLog> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
      throw new Error(`Day date must be YYYY-MM-DD, got "${day.date}"`);
    }
    const path = `daily/${day.date}.json`;
    const existed = await this.fs.exists(ref, path);
    const now = new Date().toISOString();
    const updated: DayLog = {
      ...day,
      created_at: existed ? day.created_at || now : now,
      updated_at: now,
    };
    await this.fs.putJson(
      ref,
      path,
      updated,
      `archaeo-pro: ${existed ? 'update' : 'add'} giornale ${day.date}`,
    );
    return updated;
  }

  async deleteDay(ref: RepoRef, date: string): Promise<void> {
    await this.fs.remove(ref, `daily/${date}.json`, `archaeo-pro: rimuovi giornale ${date}`);
  }

  getDay(ref: RepoRef, date: string): Promise<DayLog | null> {
    return this.fs.getJson<DayLog>(ref, `daily/${date}.json`);
  }

  // ---- helpers ---------------------------------------------------------

  refForSurveillance(entry: SurveillanceIndexEntry): RepoRef {
    return entry.repo;
  }

  private repoUrl(ref: RepoRef): string {
    return `https://github.com/${ref.owner}/${ref.name}`;
  }

  private toRoot(s: Surveillance): Omit<Surveillance, 'findings' | 'photos' | 'days' | 'tavole'> {
    const { findings: _f, photos: _p, days: _d, tavole: _t, ...root } = s;
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
      status: s.status ?? 'draft',
      bbox: this.bboxOfArea(s.area),
      repo_url: repoUrl,
      repo: ref,
      ohm_published: false,
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  }

  private bboxOfArea(
    area: GeoJSON.Polygon | null | undefined,
  ): [number, number, number, number] | null {
    if (!area || !area.coordinates || area.coordinates.length === 0) return null;
    let west = Infinity,
      south = Infinity,
      east = -Infinity,
      north = -Infinity;
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
}
