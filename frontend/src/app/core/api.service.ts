/**
 * Calls the (stateless) backend for things that can't happen browser-side:
 *   - WMS upstream proxying (CORS-blocked at the source)
 *   - DOCX/PDF rendering (LibreOffice + python-docx)
 *
 * All storage operations live in core/storage/* and talk directly to GitHub.
 */
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { apiBase } from './platform';
import { Surveillance } from './types/surveillance';

export interface GnaVocabRow {
  key: string;
  label: string;
  props: Record<string, unknown>;
}

export interface GnaIssue {
  level: 'errore' | 'avviso';
  where: string;
  field: string | null;
  message: string;
}

export interface GnaCheckResult {
  ok: boolean;
  issues: GnaIssue[];
}

/** Vocabularies whose key/label columns don't follow the `<NAME>_key` / `<NAME>_value` rule. */
const GNA_KEY_FIELDS: Record<string, [string, string]> = {
  OGT_MOPR: ['OGT_key', 'OGT_value'],
  Regioni_tb: ['cod_reg', 'nome'],
  Province_tb: ['cod_prov', 'sigla'],
  Comuni_tb: ['pro_com', 'nome'],
  DTR: ['DTR_key', 'etichetta'],
};

export interface WmsSource {
  id: string;
  label: string;
  default_layers: string[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  /**
   * Empty on the web — requests go through the dev-server proxy / Netlify
   * reverse-proxy via same-origin relative URLs. In the native shell this is
   * the Vercel API origin (there's no proxy in front of the app).
   */
  private get base(): string {
    return apiBase();
  }

  wmsSources(): Observable<WmsSource[]> {
    return this.http.get<WmsSource[]>(`${this.base}/wms/sources`);
  }

  /**
   * Liveness check for the PDF rendering service (Gotenberg). Called before
   * a PDF render request so the UI can fail fast with a useful message
   * instead of waiting through the DOCX step.
   */
  async pdfServiceAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      const res = await fetch(`${this.base}/health/pdf`, { method: 'GET' });
      if (!res.ok) return { available: false, reason: `health endpoint ${res.status}` };
      return (await res.json()) as { available: boolean; reason?: string };
    } catch (err) {
      return { available: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Build a MapLibre raster tile URL for a WMS source. MapLibre interpolates
   * `{bbox-epsg-3857}` per tile request — keep that placeholder literal.
   */
  wmsTileUrl(sourceId: string, layers: string[]): string {
    const layersParam = encodeURIComponent(layers.join(','));
    return (
      `${this.base}/wms/${sourceId}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap` +
      `&LAYERS=${layersParam}&STYLES=&FORMAT=image/png&TRANSPARENT=true` +
      `&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`
    );
  }

  /**
   * POST a render-ready surveillance snapshot + photo blobs (+ optional
   * "tavola d'insieme" map snapshot), get a DOCX back. The caller is
   * responsible for fetching photo bytes from GitHub before calling.
   */
  async renderDocx(
    surveillance: Surveillance,
    photoBlobs: Map<string, Blob>,
    tavolaBlobs: Map<string, Blob> = new Map(),
    mapImage?: Blob | null,
  ): Promise<Blob> {
    return this.renderDocument(surveillance, photoBlobs, tavolaBlobs, 'docx', mapImage);
  }

  async renderPdf(
    surveillance: Surveillance,
    photoBlobs: Map<string, Blob>,
    tavolaBlobs: Map<string, Blob> = new Map(),
    mapImage?: Blob | null,
  ): Promise<Blob> {
    return this.renderDocument(surveillance, photoBlobs, tavolaBlobs, 'pdf', mapImage);
  }

  // ---- Template GNA ------------------------------------------------------

  /** A GNA controlled vocabulary, as {key, label, ...extra} rows. Cached by the service worker. */
  async gnaVocab(name: string): Promise<GnaVocabRow[]> {
    const res = await fetch(`${this.base}/gna/vocab/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`Vocabolario GNA ${name} non disponibile (${res.status})`);
    const fc = (await res.json()) as { features: { properties: Record<string, unknown> }[] };
    const keyField = GNA_KEY_FIELDS[name] ?? [`${name}_key`, `${name}_value`];
    return fc.features
      .map((f) => f.properties)
      .filter((p) => p['ATT'] !== false && p['attivo'] !== false)
      .map((p) => ({
        key: String(p[keyField[0]]),
        label: String(p[keyField[1]] ?? p[keyField[0]]),
        props: p,
      }));
  }

  /** What the Template GNA and the GNA plugin would reject. */
  async gnaCheck(surveillance: Surveillance): Promise<GnaCheckResult> {
    const res = await fetch(`${this.base}/gna/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(surveillance),
    });
    if (!res.ok) throw new Error(`Controllo GNA non riuscito (${res.status})`);
    return (await res.json()) as GnaCheckResult;
  }

  /** The official Template GNA, filled; or the blocking issues. */
  async gnaPackage(surveillance: Surveillance): Promise<{ zip: Blob } | GnaCheckResult> {
    const res = await fetch(`${this.base}/gna/package`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(surveillance),
    });
    if (res.status === 422) return (await res.json()) as GnaCheckResult;
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Pacchetto GNA non generato (${res.status}): ${detail.slice(0, 200)}`);
    }
    return { zip: await res.blob() };
  }

  private async renderDocument(
    surveillance: Surveillance,
    photoBlobs: Map<string, Blob>,
    tavolaBlobs: Map<string, Blob>,
    kind: 'docx' | 'pdf',
    mapImage?: Blob | null,
  ): Promise<Blob> {
    const fd = new FormData();
    fd.append('surveillance', JSON.stringify(surveillance));
    for (const [id, blob] of photoBlobs) {
      // Filename equals the photo id by convention; the backend matches them.
      fd.append('photos', blob, id);
    }
    for (const [id, blob] of tavolaBlobs) {
      fd.append('tavole', blob, id);
    }
    if (mapImage) {
      fd.append('map_image', mapImage, 'map.png');
    }
    const res = await fetch(`${this.base}/documents/${kind}`, { method: 'POST', body: fd });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Document render failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return res.blob();
  }
}
