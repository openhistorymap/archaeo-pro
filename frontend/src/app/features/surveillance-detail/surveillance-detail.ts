import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ApiService } from '../../core/api.service';
import { PhotoThumb } from '../../core/components/photo-thumb';
import { GitHubClient, RepoRef } from '../../core/github/client';
import { IndexRepoService } from '../../core/storage/index-repo';
import { SurveillanceStore } from '../../core/storage/surveillance-store';
import { Surveillance } from '../../core/types/surveillance';

@Component({
  selector: 'app-surveillance-detail',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, PhotoThumb],
  templateUrl: './surveillance-detail.html',
  styleUrl: './surveillance-detail.scss',
})
export class SurveillanceDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly index = inject(IndexRepoService);
  private readonly store = inject(SurveillanceStore);
  private readonly api = inject(ApiService);
  private readonly gh = inject(GitHubClient);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly surveillance = signal<Surveillance | null>(null);
  readonly ref = signal<RepoRef | null>(null);
  readonly repoUrl = signal<string | null>(null);

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    protocollo: new FormControl<string | null>(null),
    committente: new FormControl<string | null>(null),
    direttore_tecnico: new FormControl<string | null>(null),
    sabap: new FormControl<string | null>(null),
    comune: new FormControl<string | null>(null),
    provincia: new FormControl<string | null>(null),
    foglio_catastale: new FormControl<string | null>(null),
    particelle: new FormControl<string | null>(null),
    normativa: new FormControl<string | null>(null),
    start_date: new FormControl<string | null>(null),
    end_date: new FormControl<string | null>(null),
    premessa: new FormControl<string | null>(null),
    metodologia: new FormControl<string | null>(null),
    risultati: new FormControl<string | null>(null),
    conclusioni: new FormControl<string | null>(null),
  });

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set('ID sorveglianza mancante');
      this.loading.set(false);
      return;
    }
    void this.load(id);
  }

  private async load(id: string): Promise<void> {
    try {
      const entry = await this.index.getEntry(id);
      if (!entry) {
        this.error.set('Sorveglianza non trovata nell\'indice.');
        this.loading.set(false);
        return;
      }
      this.ref.set(entry.repo);
      this.repoUrl.set(entry.repo_url);
      const s = await this.store.loadSurveillance(entry.repo);
      this.surveillance.set(s);
      this.form.patchValue({
        title: s.title,
        protocollo: s.protocollo ?? null,
        committente: s.committente ?? null,
        direttore_tecnico: s.direttore_tecnico ?? null,
        sabap: s.sabap ?? null,
        comune: s.comune ?? null,
        provincia: s.provincia ?? null,
        foglio_catastale: s.foglio_catastale ?? null,
        particelle: s.particelle ?? null,
        normativa: s.normativa ?? null,
        start_date: s.start_date ?? null,
        end_date: s.end_date ?? null,
        premessa: s.premessa ?? null,
        metodologia: s.metodologia ?? null,
        risultati: s.risultati ?? null,
        conclusioni: s.conclusioni ?? null,
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    const ref = this.ref();
    const current = this.surveillance();
    if (!ref || !current || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const v = this.form.getRawValue();
      const updated: Surveillance = { ...current, ...v };
      await this.store.saveSurveillance(ref, updated);
      this.surveillance.set(updated);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }

  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    const ref = this.ref();
    if (!files || files.length === 0 || !ref) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const today = this.todayISO();
      for (const f of Array.from(files)) {
        const photo = await this.store.attachPhoto(ref, f, {
          filename: f.name,
          caption: null,
          bearing: null,
          taken_at: null,
          location: null,
          recorded_on: today,
          shot_type: 'intervento',
          finding_id: null,
        });
        const current = this.surveillance();
        if (current) {
          this.surveillance.set({ ...current, photos: [...current.photos, photo] });
        }
      }
      input.value = '';
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }

  async generate(kind: 'docx' | 'pdf'): Promise<void> {
    const s = this.surveillance();
    if (!s || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // Preflight the PDF service before doing anything expensive: rendering
      // the DOCX, fetching every photo blob, etc. would all be wasted work
      // if Gotenberg is asleep / down / misconfigured.
      if (kind === 'pdf') {
        const status = await this.api.pdfServiceAvailable();
        if (!status.available) {
          this.error.set(
            `Servizio PDF non disponibile (${status.reason ?? 'motivo non noto'}). ` +
            `Puoi comunque scaricare il DOCX e convertirlo in locale.`,
          );
          return;
        }
      }
      const ref = this.ref();
      const photoBlobs = new Map<string, Blob>();
      const tavolaBlobs = new Map<string, Blob>();
      let mapImage: Blob | null = null;
      if (ref) {
        for (const p of s.photos) {
          if (!p.path) continue;
          try {
            const blob = await this.gh.getBinaryFile(ref, p.path, p.content_type ?? 'image/jpeg');
            if (blob) photoBlobs.set(p.id, blob);
          } catch {
            // skip — render will surface "[immagine non trasmessa]"
          }
        }
        for (const t of s.tavole) {
          if (!t.path) continue;
          try {
            const blob = await this.gh.getBinaryFile(ref, t.path, t.content_type ?? 'image/png');
            if (blob) tavolaBlobs.set(t.id, blob);
          } catch {
            // skip — render will surface "[tavola non trasmessa]"
          }
        }
        // Legacy fallback: a pre-Tavola survey may still have exports/map.png.
        // Only used by the docgen when no Tavola(kind='insieme') exists.
        try {
          mapImage = await this.gh.getBinaryFile(ref, 'exports/map.png', 'image/png');
        } catch {
          mapImage = null;
        }
      }
      const blob = kind === 'docx'
        ? await this.api.renderDocx(s, photoBlobs, tavolaBlobs, mapImage)
        : await this.api.renderPdf(s, photoBlobs, tavolaBlobs, mapImage);
      this.downloadBlob(blob, `sorveglianza-${s.id}.${kind}`);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }

  todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  openDay(date: string): void {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const id = this.surveillance()?.id;
    if (!id) return;
    void this.router.navigate(['/surveillances', id, 'days', date]);
  }

  formatDay(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
  }

  totalHoursForDay(presenze: { hours_total?: number | null }[] | undefined): number {
    if (!presenze) return 0;
    return presenze.reduce((sum, p) => sum + (p.hours_total ?? 0), 0);
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
