import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { GitHubAuthService } from '../../core/github/auth.service';
import { IndexRepoService } from '../../core/storage/index-repo';
import { SurveillanceIndexEntry } from '../../core/types/surveillance';

type RegistryFilter = 'active' | 'archived' | 'all';

const STATUS_LABELS: Record<SurveillanceIndexEntry['status'], string> = {
  draft: 'bozza',
  'in-progress': 'in lavorazione',
  submitted: 'consegnata',
  archived: 'archiviata',
};

@Component({
  selector: 'app-surveillances-list',
  imports: [CommonModule, RouterLink],
  templateUrl: './surveillances-list.html',
  styleUrl: './surveillances-list.scss',
})
export class SurveillancesList {
  private readonly index = inject(IndexRepoService);
  private readonly auth = inject(GitHubAuthService);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly items = signal<SurveillanceIndexEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly filter = signal<RegistryFilter>('active');
  readonly visibleItems = computed<SurveillanceIndexEntry[]>(() => {
    const all = this.items();
    switch (this.filter()) {
      case 'all': return all;
      case 'archived': return all.filter((s) => s.status === 'archived');
      case 'active': return all.filter((s) => s.status !== 'archived');
    }
  });
  readonly archivedCount = computed(() => this.items().filter((s) => s.status === 'archived').length);
  readonly activeCount = computed(() => this.items().filter((s) => s.status !== 'archived').length);
  readonly hasItems = computed(() => this.visibleItems().length > 0);

  constructor() {
    this.refresh();
    this.auth.ensureUser();
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.items.set(await this.index.listEntries());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }

  signOut(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  setFilter(f: RegistryFilter): void {
    this.filter.set(f);
  }

  formatNumber(n: number): string {
    return n.toString().padStart(3, '0');
  }

  formatRange(s: SurveillanceIndexEntry): string {
    if (!s.start_date && !s.end_date) return '—';
    const fmt = (d: string | null | undefined) => (d ? this.formatDate(d) : '—');
    return `${fmt(s.start_date)} → ${fmt(s.end_date)}`;
  }

  private formatDate(iso: string): string {
    // Italian short form: dd · mm · yyyy
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return iso;
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  statusLabel(s: SurveillanceIndexEntry['status']): string {
    return STATUS_LABELS[s] ?? s;
  }
}
