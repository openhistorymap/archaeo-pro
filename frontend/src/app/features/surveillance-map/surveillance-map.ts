import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import maplibregl, {
  GeoJSONSource,
  LngLatLike,
  Map as MapLibreMap,
  MapMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';

import { ApiService, WmsSource } from '../../core/api.service';
import { RepoRef } from '../../core/github/client';
import { IndexRepoService } from '../../core/storage/index-repo';
import { SurveillanceStore } from '../../core/storage/surveillance-store';
import { Finding, Surveillance } from '../../core/types/surveillance';

type Mode = 'view' | 'draw-area' | 'add-finding';

/** OSM-style tag presets — match what the OHM exporter emits. */
const SITE_TYPES: { value: string; label: string }[] = [
  { value: '', label: '— non specificato —' },
  { value: 'settlement', label: 'Insediamento' },
  { value: 'fortification', label: 'Fortificazione' },
  { value: 'religious', label: 'Edificio religioso' },
  { value: 'tomb', label: 'Sepoltura' },
  { value: 'road', label: 'Strada o infrastruttura' },
  { value: 'artefact', label: 'Frammento mobile' },
  { value: 'unknown', label: 'Altro / non determinato' },
];

const PERIODS: { value: string; label: string }[] = [
  { value: '', label: '— non specificato —' },
  { value: 'prehistoric', label: 'Preistorico' },
  { value: 'bronze_age', label: 'Età del bronzo' },
  { value: 'iron_age', label: 'Età del ferro' },
  { value: 'etruscan', label: 'Etrusco' },
  { value: 'roman', label: 'Romano' },
  { value: 'late_antique', label: 'Tardo-antico' },
  { value: 'early_medieval', label: 'Alto-medievale' },
  { value: 'medieval', label: 'Medievale' },
  { value: 'modern', label: 'Moderno' },
  { value: 'unknown', label: 'Non determinato' },
];

function uuidv4(): string {
  return crypto.randomUUID();
}

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
};

const ITALY_CENTER: LngLatLike = [12.5, 42.0];

@Component({
  selector: 'app-surveillance-map',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './surveillance-map.html',
  styleUrl: './surveillance-map.scss',
})
export class SurveillanceMap implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly index = inject(IndexRepoService);
  private readonly store = inject(SurveillanceStore);
  private readonly api = inject(ApiService);

  readonly mapContainer = viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly surveillance = signal<Surveillance | null>(null);
  readonly ref = signal<RepoRef | null>(null);

  readonly wmsSources = signal<WmsSource[]>([]);
  readonly enabledSources = signal<Set<string>>(new Set());
  readonly mode = signal<Mode>('view');
  readonly drawingPoints = signal<[number, number][]>([]);
  readonly pendingFinding = signal<[number, number] | null>(null);
  readonly panelCollapsed = signal(false);

  readonly hasUnsavedDrawing = computed(() => this.drawingPoints().length >= 3);

  readonly siteTypes = SITE_TYPES;
  readonly periods = PERIODS;

  readonly findingForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl<string | null>(null),
    site_type: new FormControl<string>('', { nonNullable: true }),
    period: new FormControl<string>('', { nonNullable: true }),
    start_date: new FormControl<string | null>(null),
    end_date: new FormControl<string | null>(null),
  });

  private map?: MapLibreMap;

  // ---- lifecycle -------------------------------------------------------

  async ngAfterViewInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('ID sorveglianza mancante');
      this.loading.set(false);
      return;
    }
    try {
      const entry = await this.index.getEntry(id);
      if (!entry) throw new Error('Sorveglianza non trovata.');
      this.ref.set(entry.repo);
      const s = await this.store.loadSurveillance(entry.repo);
      this.surveillance.set(s);

      this.api.wmsSources().subscribe({
        next: (sources) => this.wmsSources.set(sources),
        error: () => this.wmsSources.set([]),
      });

      this.initMap(s);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  // ---- map setup -------------------------------------------------------

  private initMap(s: Surveillance): void {
    const center = this.surveillanceCenter(s);
    this.map = new maplibregl.Map({
      container: this.mapContainer().nativeElement,
      style: structuredClone(OSM_STYLE),
      center,
      zoom: s.area ? 16 : 6,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    this.map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        showUserLocation: true,
        trackUserLocation: false,
      }),
      'top-left',
    );

    this.map.on('load', () => this.onMapLoad(s));
    this.map.on('click', (e) => this.onMapClick(e));
    this.map.on('dblclick', (e) => this.onMapDoubleClick(e));
  }

  private onMapLoad(s: Surveillance): void {
    if (!this.map) return;

    // Empty area + findings sources for live updates.
    this.map.addSource('area', {
      type: 'geojson',
      data: this.areaFeature(s.area),
    });
    // Match the --field-area token so the map agrees with the rest of the UI.
    const areaColor = this.cssVar('--field-area', 'oklch(0.50 0.090 145)');
    this.map.addLayer({
      id: 'area-fill',
      type: 'fill',
      source: 'area',
      paint: { 'fill-color': areaColor, 'fill-opacity': 0.18 },
    });
    this.map.addLayer({
      id: 'area-outline',
      type: 'line',
      source: 'area',
      paint: { 'line-color': areaColor, 'line-width': 2 },
    });

    this.map.addSource('findings', {
      type: 'geojson',
      data: this.findingsCollection(s),
    });
    const findingColor = this.cssVar('--field-finding', 'oklch(0.62 0.130 60)');
    const surfaceColor = this.cssVar('--surface', 'oklch(0.985 0.012 80)');
    this.map.addLayer({
      id: 'findings-points',
      type: 'circle',
      source: 'findings',
      paint: {
        'circle-radius': 6,
        'circle-color': findingColor,
        'circle-stroke-color': surfaceColor,
        'circle-stroke-width': 2,
      },
    });

    this.map.addSource('drawing', {
      type: 'geojson',
      data: this.drawingFeature(),
    });
    const accent = this.cssVar('--accent', 'oklch(0.52 0.155 32)');
    this.map.addLayer({
      id: 'drawing-line',
      type: 'line',
      source: 'drawing',
      paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 2] },
    });
    this.map.addLayer({
      id: 'drawing-points',
      type: 'circle',
      source: 'drawing',
      filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 5, 'circle-color': accent, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
    });

    // Pending-finding pin (visible only while filling the form).
    this.map.addSource('pending-finding', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    this.map.addLayer({
      id: 'pending-finding-halo',
      type: 'circle',
      source: 'pending-finding',
      paint: {
        'circle-radius': 14,
        'circle-color': accent,
        'circle-opacity': 0.18,
      },
    });
    this.map.addLayer({
      id: 'pending-finding-dot',
      type: 'circle',
      source: 'pending-finding',
      paint: {
        'circle-radius': 7,
        'circle-color': accent,
        'circle-stroke-color': surfaceColor,
        'circle-stroke-width': 2,
      },
    });
  }

  /**
   * Read a CSS custom property from the document root. MapLibre paint
   * properties want a literal colour string, so we resolve once at layer
   * creation and don't try to make them reactive.
   */
  private cssVar(name: string, fallback: string): string {
    if (typeof getComputedStyle === 'undefined') return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  // ---- WMS layer toggle ------------------------------------------------

  toggleSource(source: WmsSource): void {
    if (!this.map) return;
    const id = `wms-${source.id}`;
    const next = new Set(this.enabledSources());
    if (next.has(source.id)) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
      if (this.map.getSource(id)) this.map.removeSource(id);
      next.delete(source.id);
    } else {
      this.map.addSource(id, {
        type: 'raster',
        tiles: [this.api.wmsTileUrl(source.id, source.default_layers)],
        tileSize: 256,
      });
      // Place WMS layers under the area/findings overlays.
      const before = this.map.getLayer('area-fill') ? 'area-fill' : undefined;
      this.map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.7 } }, before);
      next.add(source.id);
    }
    this.enabledSources.set(next);
  }

  isEnabled(source: WmsSource): boolean {
    return this.enabledSources().has(source.id);
  }

  // ---- drawing the area ------------------------------------------------

  startDrawing(): void {
    this.drawingPoints.set([]);
    this.mode.set('draw-area');
    this.refreshDrawing();
  }

  cancelDrawing(): void {
    this.drawingPoints.set([]);
    this.mode.set('view');
    this.refreshDrawing();
  }

  // ---- adding a finding -----------------------------------------------

  startAddingFinding(): void {
    this.mode.set('add-finding');
    this.pendingFinding.set(null);
    this.findingForm.reset({ name: '', description: null, site_type: '', period: '', start_date: null, end_date: null });
    this.refreshPendingFinding();
  }

  cancelAddingFinding(): void {
    this.mode.set('view');
    this.pendingFinding.set(null);
    this.findingForm.reset({ name: '', description: null, site_type: '', period: '', start_date: null, end_date: null });
    this.refreshPendingFinding();
  }

  async saveFinding(): Promise<void> {
    const ref = this.ref();
    const current = this.surveillance();
    const pending = this.pendingFinding();
    if (!ref || !current || !pending || this.busy()) return;
    if (this.findingForm.invalid) {
      this.findingForm.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const v = this.findingForm.getRawValue();
      const tags: Record<string, string> = { historic: 'archaeological_site' };
      if (v.site_type) tags['site_type'] = v.site_type;
      if (v.period) tags['period'] = v.period;
      const finding: Finding = {
        id: uuidv4(),
        name: v.name,
        description: v.description ?? null,
        interpretation: null,
        start_date: v.start_date ?? null,
        end_date: v.end_date ?? null,
        tags,
        geometry: { type: 'Point', coordinates: [pending[0], pending[1]] },
        units: [],
      };
      await this.store.addFinding(ref, finding);
      this.surveillance.set({ ...current, findings: [...current.findings, finding] });
      this.refreshFindings();
      this.cancelAddingFinding();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }

  async finalizeDrawing(): Promise<void> {
    const ref = this.ref();
    const current = this.surveillance();
    if (!ref || !current || this.busy()) return;
    const pts = this.drawingPoints();
    if (pts.length < 3) {
      this.error.set('Almeno 3 punti per chiudere il poligono.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const ring: GeoJSON.Position[] = pts.map(([lng, lat]) => [lng, lat]);
      ring.push(ring[0]);
      const polygon: GeoJSON.Polygon = { type: 'Polygon', coordinates: [ring] };
      const updated: Surveillance = { ...current, area: polygon };
      await this.store.saveSurveillance(ref, updated);
      this.surveillance.set(updated);
      this.drawingPoints.set([]);
      this.mode.set('view');
      this.refreshArea(updated.area);
      this.refreshDrawing();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }

  private onMapClick(e: MapMouseEvent): void {
    const m = this.mode();
    if (m === 'draw-area') {
      const next = [...this.drawingPoints(), [e.lngLat.lng, e.lngLat.lat] as [number, number]];
      this.drawingPoints.set(next);
      this.refreshDrawing();
    } else if (m === 'add-finding') {
      this.pendingFinding.set([e.lngLat.lng, e.lngLat.lat]);
      this.refreshPendingFinding();
    }
  }

  private onMapDoubleClick(e: MapMouseEvent): void {
    if (this.mode() !== 'draw-area') return;
    e.preventDefault();
    void this.finalizeDrawing();
  }

  // ---- helpers ---------------------------------------------------------

  private surveillanceCenter(s: Surveillance): LngLatLike {
    if (s.area && s.area.coordinates[0]?.length) {
      const ring = s.area.coordinates[0];
      const lons = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      return [
        (Math.min(...lons) + Math.max(...lons)) / 2,
        (Math.min(...lats) + Math.max(...lats)) / 2,
      ];
    }
    for (const f of s.findings) {
      if (f.geometry?.type === 'Point') return f.geometry.coordinates as LngLatLike;
    }
    return ITALY_CENTER;
  }

  private areaFeature(area: GeoJSON.Polygon | null | undefined): GeoJSON.FeatureCollection {
    if (!area) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: area, properties: {} }],
    };
  }

  private findingsCollection(s: Surveillance): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: s.findings
        .filter((f): f is typeof f & { geometry: GeoJSON.Geometry } => !!f.geometry)
        .map((f) => ({
          type: 'Feature',
          id: f.id,
          geometry: f.geometry,
          properties: { id: f.id, name: f.name },
        })),
    };
  }

  private drawingFeature(): GeoJSON.FeatureCollection {
    const pts = this.drawingPoints();
    const features: GeoJSON.Feature[] = pts.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: { i },
    }));
    if (pts.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [...pts, pts[0]] },
        properties: {},
      });
    }
    return { type: 'FeatureCollection', features };
  }

  private refreshArea(area: GeoJSON.Polygon | null | undefined): void {
    const src = this.map?.getSource('area') as GeoJSONSource | undefined;
    src?.setData(this.areaFeature(area));
  }

  private refreshDrawing(): void {
    const src = this.map?.getSource('drawing') as GeoJSONSource | undefined;
    src?.setData(this.drawingFeature());
  }

  private refreshPendingFinding(): void {
    const src = this.map?.getSource('pending-finding') as GeoJSONSource | undefined;
    if (!src) return;
    const p = this.pendingFinding();
    src.setData(
      p
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }],
          }
        : { type: 'FeatureCollection', features: [] },
    );
  }

  private refreshFindings(): void {
    const src = this.map?.getSource('findings') as GeoJSONSource | undefined;
    const s = this.surveillance();
    if (!src || !s) return;
    src.setData(this.findingsCollection(s));
  }
}
