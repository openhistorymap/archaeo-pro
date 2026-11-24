import { Surveillance } from '../types/surveillance';
import {
  GEOCONTEXT_AREA,
  GEOCONTEXT_FINDINGS,
  buildGeoContext,
  geoContextMapUrl,
} from './geocontext';

function surveillance(): Surveillance {
  return {
    id: 's1',
    title: 'Via Irnerio',
    status: 'in-progress',
    area: {
      type: 'Polygon',
      coordinates: [
        [
          [11.3, 44.49],
          [11.32, 44.49],
          [11.32, 44.51],
          [11.3, 44.51],
          [11.3, 44.49],
        ],
      ],
    },
    findings: [
      {
        id: 'f1',
        name: 'Muro',
        description: 'Muro in laterizi',
        tags: { historic: 'wall', name: 'should not win' },
        geometry: { type: 'Point', coordinates: [11.31, 44.5] },
        units: [{ number: 1 }, { number: 2 }],
      },
      { id: 'f2', name: 'Senza geometria', tags: {}, units: [] },
    ],
    photos: [{ id: 'p1', filename: 'a.jpg', path: 'photos/p1.jpg', finding_id: 'f1' }],
    days: [],
    tavole: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

describe('GeoContext descriptor', () => {
  it('points at its two GeoJSON files and centres on the surveillance, lat first', () => {
    const { descriptor } = buildGeoContext(surveillance());
    const sources = (descriptor['datasources'] as { conf: { source: string } }[]).map(
      (d) => d.conf.source,
    );
    expect(sources).toEqual([GEOCONTEXT_FINDINGS, GEOCONTEXT_AREA]);
    expect(descriptor['center']).toEqual([44.5, 11.31]);
    expect(descriptor['title']).toBe('Via Irnerio');
  });

  it('exports drawn findings with their photo and keeps archaeo-pro fields over tags', () => {
    const { findings } = buildGeoContext(surveillance());
    expect(findings.features).toHaveLength(1);
    const props = findings.features[0].properties!;
    expect(props['name']).toBe('Muro');
    expect(props['historic']).toBe('wall');
    expect(props['foto']).toBe('photos/p1.jpg');
    expect(props['unita_stratigrafiche']).toBe(2);
  });

  it('builds the public map address from the repo', () => {
    expect(geoContextMapUrl({ owner: 'me', name: 'archaeo-pro-1' })).toBe(
      'https://www.openhistorymap.org/geocontext-front/me/archaeo-pro-1/map',
    );
  });
});
