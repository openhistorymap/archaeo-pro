import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiService, GnaIssue, GnaVocabRow } from '../../core/api.service';
import { RepoRef } from '../../core/github/client';
import { IndexRepoService } from '../../core/storage/index-repo';
import { SurveillanceStore } from '../../core/storage/surveillance-store';
import { Finding, GnaDsc, GnaMosi, GnaProject, Surveillance } from '../../core/types/surveillance';

/** Vocabularies the page needs, loaded once (and cached by the service worker for offline use). */
const VOCABS = [
  'CTG',
  'OGT_MOPR',
  'ENTE',
  'FUR',
  'Regioni_tb',
  'Province_tb',
  'Comuni_tb',
  'GPT',
  'GPM',
  'GPBB',
  'DSCM',
  'OGD',
  'OGT',
  'OGB',
  'DTR',
] as const;
type VocabName = (typeof VOCABS)[number];

interface FindingDraft {
  finding: Finding;
  gna: GnaMosi;
}

function yearOf(iso: string | null | undefined): number | null {
  const m = /^(-?\d{1,4})/.exec(iso ?? '');
  return m ? parseInt(m[1], 10) : null;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLocaleLowerCase('it');
}

/**
 * Template GNA export of one surveillance.
 *
 * A sorveglianza is "assistenza archeologica in corso d'opera" (AMA 2) for
 * GNA: one project area (MOPR), the investigated areas (DSC, also when
 * negative) and one record per finding (MOSI). This page collects what the
 * template needs beyond the rest of the surveillance, saves it with the
 * surveillance, asks the backend what GNA would reject, and downloads the
 * official template already filled in, ready to send with the QGIS plugin.
 */
@Component({
  selector: 'app-gna-export',
  imports: [FormsModule, RouterLink],
  templateUrl: './gna-export.html',
  styleUrl: './gna-export.scss',
})
export class GnaExport {
  private readonly route = inject(ActivatedRoute);
  private readonly index = inject(IndexRepoService);
  private readonly store = inject(SurveillanceStore);
  private readonly api = inject(ApiService);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly saved = signal(false);
  readonly surveillance = signal<Surveillance | null>(null);
  readonly issues = signal<GnaIssue[] | null>(null);
  readonly vocab = signal<Partial<Record<VocabName, GnaVocabRow[]>>>({});

  /** Working copies bound to the form; written back on save. */
  project: GnaProject = {};
  dsc: GnaDsc[] = [];
  findings: FindingDraft[] = [];
  private ref: RepoRef | null = null;

  readonly errorCount = computed(
    () => (this.issues() ?? []).filter((i) => i.level === 'errore').length,
  );

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id')!;
    try {
      const entry = await this.index.getEntry(id);
      if (!entry) throw new Error('Sorveglianza non trovata.');
      this.ref = entry.repo;
      const s = await this.store.loadSurveillance(entry.repo);
      this.surveillance.set(s);
      await this.loadVocab();
      this.initDrafts(s);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadVocab(): Promise<void> {
    const loaded = await Promise.all(
      VOCABS.map(async (n) => [n, await this.api.gnaVocab(n)] as const),
    );
    this.vocab.set(Object.fromEntries(loaded));
  }

  /** Start from what was saved; otherwise prefill from the rest of the surveillance. */
  private initDrafts(s: Surveillance): void {
    const v = this.vocab();
    const comune = (v.Comuni_tb ?? []).find((c) => norm(c.label) === norm(s.comune));
    const provincia = (v.Province_tb ?? []).find((p) => norm(p.label) === norm(s.provincia));
    this.project = {
      OGN: s.title,
      DES: s.premessa ?? null,
      LCR: comune
        ? Number(comune.props['cod_reg'])
        : provincia
          ? Number(provincia.props['cod_reg'])
          : null,
      LCP: comune ? Number(comune.props['cod_prov']) : provincia ? Number(provincia.key) : null,
      LCC: comune ? Number(comune.key) : null,
      FUR: [],
      presa_visione: false,
      ...(s.gna ?? {}),
    };
    this.dsc = (s.gna_dsc ?? []).map((d) => ({ ...d }));
    if (this.dsc.length === 0) {
      this.dsc.push({
        id: crypto.randomUUID(),
        DSCV: 'Area sorvegliata',
        DSCY: yearOf(s.start_date),
      });
    }
    this.findings = s.findings.map((f) => ({
      finding: f,
      gna: {
        FNTP: '1',
        OGM: '12',
        OGT: [],
        DTSI: yearOf(f.start_date),
        DTSF: yearOf(f.end_date),
        ...(f.gna ?? {}),
      },
    }));
  }

  // ---- filtered vocabularies (the template's cascading choices) ----------

  list(name: VocabName): GnaVocabRow[] {
    return this.vocab()[name] ?? [];
  }

  where(name: VocabName, prop: string, value: unknown): GnaVocabRow[] {
    if (value === null || value === undefined || value === '') return [];
    return this.list(name).filter((r) => String(r.props[prop]) === String(value));
  }

  dtrRange(key: string | null | undefined): string {
    const row = this.list('DTR').find((r) => r.key === key);
    if (!row || row.props['DTSI'] === null) return '';
    return `da ${row.props['DTSI']} a ${row.props['DTSF']}`;
  }

  /** Changing a parent choice clears the children that depended on it. */
  onRegion(): void {
    this.project.LCP = null;
    this.project.LCC = null;
    this.project.ENTE = null;
    this.project.FUR = [];
  }
  onProvince(): void {
    this.project.LCC = null;
  }
  onEnte(): void {
    this.project.FUR = [];
  }
  onCategory(): void {
    this.project.OGT = null;
  }
  onDefinition(d: FindingDraft): void {
    d.gna.OGT = [];
  }

  toggleFur(key: string, on: boolean): void {
    const set = new Set(this.project.FUR ?? []);
    if (on) set.add(key);
    else set.delete(key);
    this.project.FUR = [...set];
  }

  addDsc(): void {
    const s = this.surveillance();
    this.dsc.push({
      id: crypto.randomUUID(),
      DSCV: `Area ${this.dsc.length + 1}`,
      DSCY: yearOf(s?.start_date),
    });
  }

  removeDsc(d: GnaDsc): void {
    this.dsc = this.dsc.filter((x) => x !== d);
  }

  // ---- actions ------------------------------------------------------------

  /** The surveillance with the form's GNA data applied. */
  private snapshot(): Surveillance {
    const s = this.surveillance()!;
    return {
      ...s,
      gna: { ...this.project },
      gna_dsc: this.dsc.map((d) => ({ ...d })),
      findings: this.findings.map(({ finding, gna }) => ({ ...finding, gna: { ...gna } })),
    };
  }

  async save(): Promise<void> {
    if (!this.ref) return;
    await this.run(async () => {
      const next = this.snapshot();
      await this.store.saveSurveillance(this.ref!, next);
      for (const f of next.findings) await this.store.addFinding(this.ref!, f);
      this.surveillance.set(next);
      this.saved.set(true);
    });
  }

  async check(): Promise<void> {
    await this.run(async () => {
      const result = await this.api.gnaCheck(this.snapshot());
      this.issues.set(result.issues);
    });
  }

  async download(): Promise<void> {
    await this.save();
    await this.run(async () => {
      const s = this.snapshot();
      const result = await this.api.gnaPackage(s);
      if ('zip' in result) {
        this.issues.set([]);
        const url = URL.createObjectURL(result.zip);
        const a = document.createElement('a');
        a.href = url;
        a.download = `GNA_${s.gna?.CPR ?? s.id}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        this.issues.set(result.issues);
      }
    });
  }

  private async run(task: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    try {
      await task();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
