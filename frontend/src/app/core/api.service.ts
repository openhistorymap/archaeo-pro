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

import { Surveillance } from './types/surveillance';

export interface WmsSource {
  id: string;
  label: string;
  default_layers: string[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  /** Empty base — requests go through the dev-server proxy in proxy.conf.json. */
  private readonly base = '';

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
    const res = await fetch(`/documents/${kind}`, { method: 'POST', body: fd });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Document render failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return res.blob();
  }
}
