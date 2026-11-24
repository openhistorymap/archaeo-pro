/**
 * GeoContext descriptor for a surveillance repo.
 *
 * GeoContext (openhistorymap.org/geocontext-front) renders an interactive
 * map from a `geocontext.json` at the root of a *public* GitHub repo, read
 * at runtime through jsDelivr. This module builds that descriptor plus the
 * two GeoJSON files it points to, from what the surveillance already holds:
 *
 *   geocontext.json
 *   geocontext/findings.geojson   one feature per finding (name, dates, description, photo)
 *   geocontext/area.geojson       the watched area
 *
 * Format reference: FORMAT.md in openhistorymap/geocontext-front.
 */
import { RepoRef } from '../github/client';
import { Surveillance } from '../types/surveillance';

export const GEOCONTEXT_FILE = 'geocontext.json';
export const GEOCONTEXT_FINDINGS = 'geocontext/findings.geojson';
export const GEOCONTEXT_AREA = 'geocontext/area.geojson';

export interface GeoContextFiles {
  descriptor: Record<string, unknown>;
  findings: GeoJSON.FeatureCollection;
  area: GeoJSON.FeatureCollection;
}

/** Where the public map is served once the repo is public. */
export function geoContextMapUrl(ref: RepoRef): string {
  return `https://www.openhistorymap.org/geocontext-front/${ref.owner}/${ref.name}/map`;
}

/** [west, south, east, north] of every vertex in the area and the findings. */
function bounds(s: Surveillance): [number, number, number, number] | null {
  let w = Infinity,
    south = Infinity,
    e = -Infinity,
    n = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      w = Math.min(w, x);
      e = Math.max(e, x);
      south = Math.min(south, y);
      n = Math.max(n, y);
    } else if (Array.isArray(c)) {
      c.forEach(visit);
    }
  };
  if (s.area) visit(s.area.coordinates);
  for (const f of s.findings) {
    if (f.geometry && 'coordinates' in f.geometry) visit(f.geometry.coordinates);
  }
  return Number.isFinite(w) ? [w, south, e, n] : null;
}

/** A start zoom that fits the extent, clamped to street scale. */
function fitZoom(b: [number, number, number, number]): number {
  const span = Math.max(b[2] - b[0], (b[3] - b[1]) * 1.4, 1e-5);
  return Math.max(5, Math.min(19, Math.floor(Math.log2(360 / span)) - 1));
}

export function buildGeoContext(s: Surveillance): GeoContextFiles {
  const firstPhoto = new Map<string, string>();
  for (const p of s.photos) {
    if (p.finding_id && p.path && !firstPhoto.has(p.finding_id))
      firstPhoto.set(p.finding_id, p.path);
  }

  const findings: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: s.findings
      .filter((f) => f.geometry)
      .map((f) => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry!,
        properties: {
          ...f.tags,
          id: f.id,
          name: f.name,
          descrizione: f.description ?? null,
          interpretazione: f.interpretation ?? null,
          da: f.start_date ?? null,
          a: f.end_date ?? null,
          registrata_il: f.recorded_on ?? null,
          unita_stratigrafiche: f.units.length,
          foto: firstPhoto.get(f.id) ?? null,
        },
      })),
  };

  const area: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: s.area
      ? [{ type: 'Feature', geometry: s.area, properties: { name: 'Area della sorveglianza' } }]
      : [],
  };

  const b = bounds(s) ?? [12.5, 41.9, 12.5, 41.9]; // Rome, if nothing is drawn yet
  const descriptor = {
    title: s.title,
    type: '2d',
    center: [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2], // [lat, lon]
    minzoom: 5,
    startzoom: fitZoom(b),
    maxzoom: 21,
    background: 'osm',
    datasources: [
      { name: 'evidenze', type: 'geojson+http+remote', conf: { source: GEOCONTEXT_FINDINGS } },
      { name: 'area', type: 'geojson+http+remote', conf: { source: GEOCONTEXT_AREA } },
    ],
    layers: [
      {
        name: 'Evidenze',
        type: 'features',
        datasource: 'evidenze',
        style: {
          mode: 'polygon',
          options: {
            radius: 6,
            fillColor: '#b4532a',
            color: '#5a2410',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 0.55,
          },
        },
        detail: {
          title: 'name',
          media: [{ kind: 'image', src: '{foto}', label: 'Fotografia' }],
        },
      },
      {
        name: 'Area della sorveglianza',
        type: 'features',
        datasource: 'area',
        interactive: false,
        style: {
          mode: 'polygon',
          options: {
            color: '#3f6f3a',
            weight: 2,
            opacity: 1,
            fillColor: '#3f6f3a',
            fillOpacity: 0.08,
          },
        },
      },
    ],
    // Not read by GeoContext: provenance for whoever opens the repo.
    generator: 'archaeo-pro',
    generated_at: new Date().toISOString(),
  };

  return { descriptor, findings, area };
}
