import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Surveillance {
  id: string;
  title: string;
  protocollo: string | null;
  committente: string | null;
  comune: string | null;
  provincia: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface WmsSource {
  id: string;
  label: string;
  default_layers: string[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  /** Base path is empty so requests go through the dev-server proxy. */
  private readonly base = '';

  listSurveillances(): Observable<Surveillance[]> {
    return this.http.get<Surveillance[]>(`${this.base}/surveillances`);
  }

  getSurveillance(id: string): Observable<Surveillance> {
    return this.http.get<Surveillance>(`${this.base}/surveillances/${id}`);
  }

  createSurveillance(payload: Partial<Surveillance>): Observable<Surveillance> {
    return this.http.post<Surveillance>(`${this.base}/surveillances`, payload);
  }

  wmsSources(): Observable<WmsSource[]> {
    return this.http.get<WmsSource[]>(`${this.base}/wms/sources`);
  }

  /** URL used directly by MapLibre — never fetched via HttpClient. */
  wmsTileUrl(sourceId: string): string {
    return `${this.base}/wms/${sourceId}`;
  }
}
