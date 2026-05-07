import { Component, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';

import { GitHubClient, RepoRef } from '../github/client';
import { Photo } from '../types/surveillance';

/**
 * Renders a photo thumbnail by fetching the binary from a GitHub Release
 * asset (with the user's token) and serving it via a blob URL. Cleans up
 * the URL on destroy.
 */
@Component({
  selector: 'app-photo-thumb',
  template: `
    @if (src(); as s) {
      <img [src]="s" [alt]="alt()" loading="lazy" />
    } @else if (error()) {
      <div class="ph ph--err" [title]="alt()">×</div>
    } @else {
      <div class="ph" [title]="alt()" aria-hidden="true"></div>
    }
  `,
  styles: [`
    :host {
      display: block;
      aspect-ratio: 4/3;
      background: var(--surface-warm);
      border-radius: var(--radius-md);
      overflow: hidden;
      position: relative;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .ph {
      width: 100%;
      height: 100%;
      display: grid;
      place-content: center;
      color: var(--text-faint);
      background: linear-gradient(120deg, var(--surface-warm), var(--surface-sunk));
    }
    .ph::after {
      content: "";
      width: 24px;
      height: 1px;
      background: var(--rule-strong);
      animation: pulse 1.4s ease-in-out infinite;
    }
    .ph--err::after { display: none; }
    .ph--err {
      color: var(--accent-strong);
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--text-2xl);
    }
    @keyframes pulse {
      0%, 100% { transform: scaleX(0.3); opacity: 0.4; }
      50% { transform: scaleX(1); opacity: 1; }
    }
  `],
})
export class PhotoThumb implements OnInit, OnDestroy {
  private readonly gh = inject(GitHubClient);

  readonly photo = input.required<Photo>();
  readonly repo = input.required<RepoRef>();
  readonly alt = computed(() => this.photo().caption ?? this.photo().filename ?? 'fotografia');

  readonly src = signal<string | null>(null);
  readonly error = signal(false);

  private blobUrl: string | null = null;

  async ngOnInit(): Promise<void> {
    const path = this.photo().path;
    if (!path) {
      this.error.set(true);
      return;
    }
    try {
      const blob = await this.gh.getBinaryFile(this.repo(), path, this.photo().content_type ?? 'image/jpeg');
      if (!blob) {
        this.error.set(true);
        return;
      }
      this.blobUrl = URL.createObjectURL(blob);
      this.src.set(this.blobUrl);
    } catch {
      this.error.set(true);
    }
  }

  ngOnDestroy(): void {
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
  }
}
