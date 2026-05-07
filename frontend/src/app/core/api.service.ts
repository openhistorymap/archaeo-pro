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

  /** URL used directly by MapLibre — never fetched via HttpClient. */
  wmsTileUrl(sourceId: string): string {
    return `${this.base}/wms/${sourceId}`;
  }

  /**
   * POST a render-ready surveillance snapshot + photo blobs, get a DOCX back.
   * The caller is responsible for fetching photo bytes from GitHub Releases
   * before calling this endpoint.
   */
  async renderDocx(surveillance: Surveillance, photoBlobs: Map<string, Blob>): Promise<Blob> {
    return this.renderDocument(surveillance, photoBlobs, 'docx');
  }

  async renderPdf(surveillance: Surveillance, photoBlobs: Map<string, Blob>): Promise<Blob> {
    return this.renderDocument(surveillance, photoBlobs, 'pdf');
  }

  private async renderDocument(
    surveillance: Surveillance,
    photoBlobs: Map<string, Blob>,
    kind: 'docx' | 'pdf',
  ): Promise<Blob> {
    const fd = new FormData();
    fd.append('surveillance', JSON.stringify(surveillance));
    for (const [id, blob] of photoBlobs) {
      // Filename equals the photo id by convention; the backend matches them.
      fd.append('photos', blob, id);
    }
    const res = await fetch(`/documents/${kind}`, { method: 'POST', body: fd });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Document render failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    return res.blob();
  }
}
