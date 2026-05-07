import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { PhotoThumb } from '../../core/components/photo-thumb';
import { GitHubAuthService } from '../../core/github/auth.service';
import { RepoRef } from '../../core/github/client';
import { IndexRepoService } from '../../core/storage/index-repo';
import { SurveillanceStore } from '../../core/storage/surveillance-store';
import { DayLog, Finding, Photo, Presence, Surveillance } from '../../core/types/surveillance';

const ROLE_OPTIONS = [
  { value: '', label: '— ruolo —' },
  { value: 'direttore_tecnico', label: 'Direttore tecnico' },
  { value: 'archeologo', label: 'Archeologo' },
  { value: 'collaboratore', label: 'Collaboratore' },
  { value: 'operatore', label: 'Operatore' },
  { value: 'rilevatore', label: 'Rilevatore' },
  { value: 'altro', label: 'Altro' },
];

function presenceForm(p?: Partial<Presence>): FormGroup {
  return new FormGroup({
    name: new FormControl(p?.name ?? '', { nonNullable: true, validators: [Validators.required] }),
    role: new FormControl<string>(p?.role ?? '', { nonNullable: true }),
    hours_start: new FormControl<string | null>(p?.hours_start ?? null),
    hours_end: new FormControl<string | null>(p?.hours_end ?? null),
    hours_total: new FormControl<number | null>(p?.hours_total ?? null),
  });
}

@Component({
  selector: 'app-day-editor',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, PhotoThumb],
  templateUrl: './day-editor.html',
  styleUrl: './day-editor.scss',
})
export class DayEditor {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly index = inject(IndexRepoService);
  private readonly store = inject(SurveillanceStore);
  private readonly auth = inject(GitHubAuthService);

  readonly roles = ROLE_OPTIONS;

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly date = signal<string>('');
  readonly surveillanceId = signal<string>('');
  readonly surveillance = signal<Surveillance | null>(null);
  readonly ref = signal<RepoRef | null>(null);
  readonly day = signal<DayLog | null>(null);

  readonly findingsOfDay = computed<Finding[]>(() => {
    const s = this.surveillance();
    const d = this.date();
    if (!s || !d) return [];
    return s.findings.filter((f) => f.recorded_on === d);
  });

  readonly photosOfDay = computed<Photo[]>(() => {
    const s = this.surveillance();
    const d = this.date();
    if (!s || !d) return [];
    return s.photos.filter((p) => p.recorded_on === d);
  });

  readonly form = new FormGroup({
    operazioni: new FormControl<string | null>(null),
    localizzazione: new FormControl<string | null>(null),
    weather: new FormControl<string | null>(null),
    notes: new FormControl<string | null>(null),
    presenze: new FormArray<FormGroup>([]),
  });

  get presenzeArray(): FormArray<FormGroup> {
    return this.form.get('presenze') as FormArray<FormGroup>;
  }

  constructor() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const date = this.route.snapshot.paramMap.get('date') ?? '';
    this.surveillanceId.set(id);
    this.date.set(date);
    if (!id || !date) {
      this.error.set('Parametri mancanti');
      this.loading.set(false);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.error.set(`Data non valida: ${date}`);
      this.loading.set(false);
      return;
    }
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const entry = await this.index.getEntry(this.surveillanceId());
      if (!entry) throw new Error('Sorveglianza non trovata.');
      this.ref.set(entry.repo);
      const s = await this.store.loadSurveillance(entry.repo);
      this.surveillance.set(s);

      const existing = s.days.find((d) => d.date === this.date()) ?? null;
      this.day.set(existing);
      this.populate(existing);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  private populate(day: DayLog | null): void {
    this.presenzeArray.clear();
    const presenze = day?.presenze ?? [];
    if (presenze.length === 0) {
      // Seed with the user's own login as direttore tecnico for convenience.
      const me = this.auth.user();
      this.presenzeArray.push(
        presenceForm({ name: me?.name ?? me?.login ?? '', role: 'direttore_tecnico' }),
      );
    } else {
      for (const p of presenze) this.presenzeArray.push(presenceForm(p));
    }
    this.form.patchValue({
      operazioni: day?.operazioni ?? null,
      localizzazione: day?.localizzazione ?? null,
      weather: day?.weather ?? null,
      notes: day?.notes ?? null,
    });
  }

  addPresence(): void {
    this.presenzeArray.push(presenceForm());
  }

  removePresence(i: number): void {
    if (this.presenzeArray.length <= 1) return;
    this.presenzeArray.removeAt(i);
  }

  computeHours(i: number): void {
    const g = this.presenzeArray.at(i);
    const start = g.get('hours_start')?.value as string | null;
    const end = g.get('hours_end')?.value as string | null;
    if (!start || !end) return;
    const ms = (s: string) => {
      const [h, m] = s.split(':').map((n) => parseInt(n, 10));
      return (h * 60 + m) * 60 * 1000;
    };
    const total = (ms(end) - ms(start)) / 3_600_000;
    if (total > 0 && total < 24) {
      g.patchValue({ hours_total: Math.round(total * 4) / 4 }); // nearest 15 min
    }
  }

  async save(): Promise<void> {
    const ref = this.ref();
    if (!ref || this.busy()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const v = this.form.getRawValue();
      const presenze: Presence[] = v.presenze
        .map((p) => p as Partial<Presence>)
        .filter((p): p is Presence => !!p.name?.trim());
      const day: DayLog = {
        date: this.date(),
        presenze,
        operazioni: v.operazioni ?? null,
        localizzazione: v.localizzazione ?? null,
        weather: v.weather ?? null,
        notes: v.notes ?? null,
        created_at: this.day()?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const saved = await this.store.saveDay(ref, day);
      this.day.set(saved);
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
      for (const f of Array.from(files)) {
        const photo = await this.store.attachPhoto(ref, f, {
          filename: f.name,
          caption: null,
          bearing: null,
          taken_at: null,
          location: null,
          recorded_on: this.date(),
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

  goToMap(): void {
    void this.router.navigate(['/surveillances', this.surveillanceId(), 'map']);
  }

  formatDate(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]} · ${m[2]} · ${m[1]}` : iso;
  }

  weekdayLabel(iso: string): string {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('it-IT', { weekday: 'long' });
  }
}
