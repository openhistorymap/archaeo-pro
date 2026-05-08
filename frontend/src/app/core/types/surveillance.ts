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
  /** Date range of the *finding itself* — e.g. Roman = -0050 to 0200. */
  start_date?: string | null;
  end_date?: string | null;
  tags: Record<string, string>;
  geometry?: GeoJSON.Geometry | null;
  units: StratigraphicUnit[];
  /** ISO date (YYYY-MM-DD) when the archaeologist recorded the finding.
   * Links this evidenza to a giornale-di-scavo day. */
  recorded_on?: string | null;
}

export interface Photo {
  id: string;
  filename: string;
  caption?: string | null;
  bearing?: number | null;
  /** EXIF datetime of capture (camera clock). */
  taken_at?: string | null;
  /** GeoJSON Point in EPSG:4326, derived from EXIF when available. */
  location?: GeoJSON.Point | null;
  /** Path of the binary inside the surveillance repo, e.g. "photos/<id>.jpg". */
  path: string;
  /** Recorded MIME type of the binary. */
  content_type?: string | null;
  /** ISO date (YYYY-MM-DD) of the giornale day this photo belongs to. */
  recorded_on?: string | null;
  /** intervento (panoramica giornaliera) vs dettaglio (post-pulizia). */
  shot_type?: 'intervento' | 'dettaglio' | null;
  /** Optional link to a Finding when shot_type === 'dettaglio'. */
  finding_id?: string | null;
}

export type SurveillanceStatus = 'draft' | 'in-progress' | 'submitted' | 'archived';

export interface Surveillance {
  id: string;
  title: string;
  status: SurveillanceStatus;
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
  days: DayLog[];
  tavole: Tavola[];

  created_at: string;
  updated_at: string;
}

/**
 * Giornale di scavo / assistenza — one entry per site day.
 *
 * The Sovrintendenza requires: dates, hourly presences, names of personnel,
 * brief description of operations and their location. Stored as
 * `daily/<YYYY-MM-DD>.json` in the per-surveillance repo.
 */
export interface Presence {
  name: string;
  /** direttore tecnico · archeologo · operatore · operaio · altro */
  role?: string | null;
  hours_start?: string | null;   // "08:00"
  hours_end?: string | null;     // "17:30"
  /** Total hours on site for the day. Optional manual override (covers breaks). */
  hours_total?: number | null;
}

/**
 * A "Tavola grafica" — a rendered map snapshot saved into the surveillance.
 * Distinct from Photo because the Sovrintendenza spec lists "Tavole grafiche"
 * as its own deliverable and the DOCX places them in separate sections.
 *
 * Stored as `tavole/<id>.<ext>` (binary, usually PNG) + `tavole/<id>.json`.
 */
export interface Tavola {
  id: string;
  /** Display filename used in the GitHub UI and DOCX caption fallback. */
  filename: string;
  caption?: string | null;
  /** ISO date YYYY-MM-DD when the snapshot was captured. */
  captured_on?: string | null;
  /**
   * Drives DOCX placement:
   *   insieme   → §2.1 Tavola d'insieme di posizionamento topografico
   *   storica   → §2 historical-orto comparison
   *   dettaglio → §7.1.X under the corresponding evidenza
   */
  kind: 'insieme' | 'dettaglio' | 'storica';
  /** Required when kind === 'dettaglio'. */
  finding_id?: string | null;
  /** Path in the surveillance repo (tavole/<id>.png). */
  path: string;
  content_type?: string | null;
  /** Map state at capture, for later reproduction. */
  map_state?: {
    center?: [number, number];
    zoom?: number;
    layers?: string[];
  } | null;
}

export interface DayLog {
  /** ISO date YYYY-MM-DD; also the storage filename. */
  date: string;
  presenze: Presence[];
  operazioni?: string | null;
  /** Local descriptor for where the day's work was concentrated. */
  localizzazione?: string | null;
  weather?: string | null;
  notes?: string | null;
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
  // Re-stated here even though the interface already has `status` above —
  // this is the index-side mirror, kept in sync by SurveillanceStore.
  created_at: string;
  updated_at: string;
}
