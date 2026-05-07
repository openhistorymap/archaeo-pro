/**
 * On-disk shape of a surveillance, mirroring the JSON files stored in the
 * per-surveillance GitHub repo. Kept as a single TypeScript namespace so the
 * storage layer and the UI agree on types.
 */

export interface StratigraphicUnit {
  number: number;
  type?: string | null;
  definition?: string | null;
  description?: string | null;
  interpretation?: string | null;
  materials?: string | null;
}

export interface Finding {
  id: string;
  name: string;
  description?: string | null;
  interpretation?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  tags: Record<string, string>;
  geometry?: GeoJSON.Geometry | null;
  units: StratigraphicUnit[];
}

export interface Photo {
  id: string;
  filename: string;
  caption?: string | null;
  bearing?: number | null;
  taken_at?: string | null;
  /** GeoJSON Point in EPSG:4326, derived from EXIF when available. */
  location?: GeoJSON.Point | null;
  /** GitHub Release asset ID for the binary; resolved to a download URL on demand. */
  asset_id?: number | null;
  /** Asset URL — public for public repos, requires auth for private repos. */
  asset_url?: string | null;
}

export interface Surveillance {
  id: string;
  title: string;
  protocollo?: string | null;
  committente?: string | null;
  direttore_tecnico?: string | null;
  sabap?: string | null;
  comune?: string | null;
  provincia?: string | null;
  foglio_catastale?: string | null;
  particelle?: string | null;
  normativa?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  premessa?: string | null;
  metodologia?: string | null;
  risultati?: string | null;
  conclusioni?: string | null;
  /** GeoJSON Polygon — the watched area in EPSG:4326. */
  area?: GeoJSON.Polygon | null;

  findings: Finding[];
  photos: Photo[];

  created_at: string;
  updated_at: string;
}

/** Lightweight summary stored in the index repo (one file per surveillance). */
export interface SurveillanceIndexEntry {
  id: string;
  title: string;
  comune?: string | null;
  provincia?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status: 'draft' | 'in-progress' | 'submitted' | 'archived';
  /** Bbox of the area in [west, south, east, north]. */
  bbox?: [number, number, number, number] | null;
  /** Full URL to the per-surveillance repo, e.g. https://github.com/owner/archaeo-pro-{uuid}. */
  repo_url: string;
  /** Owner/name pair for API calls. */
  repo: { owner: string; name: string };
  ohm_published: boolean;
  created_at: string;
  updated_at: string;
}
