import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService, Surveillance } from '../../core/api.service';

@Component({
  selector: 'app-surveillances-list',
  imports: [CommonModule, RouterLink],
  templateUrl: './surveillances-list.html',
  styleUrl: './surveillances-list.scss',
})
export class SurveillancesList {
  private readonly api = inject(ApiService);

  readonly items = signal<Surveillance[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.api.listSurveillances().subscribe({
      next: (rows) => {
        this.items.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message ?? 'Errore di rete');
        this.loading.set(false);
      },
    });
  }
}
