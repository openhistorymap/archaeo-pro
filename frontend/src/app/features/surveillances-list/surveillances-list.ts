import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { GitHubAuthService } from '../../core/github/auth.service';
import { IndexRepoService } from '../../core/storage/index-repo';
import { SurveillanceStore } from '../../core/storage/surveillance-store';
import { SurveillanceIndexEntry } from '../../core/types/surveillance';

@Component({
  selector: 'app-surveillances-list',
  imports: [CommonModule, RouterLink],
  templateUrl: './surveillances-list.html',
  styleUrl: './surveillances-list.scss',
})
export class SurveillancesList {
  private readonly index = inject(IndexRepoService);
  private readonly store = inject(SurveillanceStore);
  private readonly auth = inject(GitHubAuthService);
  private readonly router = inject(Router);

  readonly user = this.auth.user;
  readonly items = signal<SurveillanceIndexEntry[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly hasItems = computed(() => this.items().length > 0);

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

  async createQuick(): Promise<void> {
    if (this.busy()) return;
    const title = prompt('Titolo della nuova sorveglianza?');
    if (!title) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { surveillance } = await this.store.createSurveillance({ title });
      await this.refresh();
      this.router.navigate(['/surveillances', surveillance.id]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.busy.set(false);
    }
  }

  signOut(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }
}
