import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { SurveillanceStore } from '../../core/storage/surveillance-store';

@Component({
  selector: 'app-surveillance-new',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './surveillance-new.html',
  styleUrl: './surveillance-new.scss',
})
export class SurveillanceNew {
  private readonly store = inject(SurveillanceStore);
  private readonly router = inject(Router);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(3)] }),
    protocollo: new FormControl<string | null>(null),
    comune: new FormControl<string | null>(null),
    provincia: new FormControl<string | null>(null),
  });

  async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    try {
      const { surveillance } = await this.store.createSurveillance({
        title: v.title,
        protocollo: v.protocollo,
        comune: v.comune,
        provincia: v.provincia,
      });
      this.router.navigate(['/surveillances', surveillance.id]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      this.busy.set(false);
    }
  }
}
