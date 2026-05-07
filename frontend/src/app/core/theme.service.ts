/**
 * Light/dark theme toggle. Persisted to localStorage; falls back to system.
 *
 * The DOM contract: a `data-theme` attribute on <html> (or absent if
 * "system"). All component styles read off CSS custom properties scoped to
 * [data-theme]; nothing references an explicit hex.
 */
import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'archaeo.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly choice$ = signal<Theme>(this.read());
  readonly choice = this.choice$.asReadonly();

  /** Resolved theme — what's actually showing. */
  readonly resolved = signal<'light' | 'dark'>(this.resolve(this.choice$()));

  constructor() {
    this.apply(this.choice$());
    if (typeof window !== 'undefined' && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.choice$() === 'system') this.apply('system');
      });
    }
  }

  set(theme: Theme): void {
    this.choice$.set(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore quota / privacy-mode errors
    }
    this.apply(theme);
  }

  toggle(): void {
    this.set(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  private read(): Theme {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch {
      // ignore
    }
    return 'system';
  }

  private resolve(theme: Theme): 'light' | 'dark' {
    if (theme !== 'system') return theme;
    if (typeof window === 'undefined' || !window.matchMedia) return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private apply(theme: Theme): void {
    if (typeof document === 'undefined') return;
    const resolved = this.resolve(theme);
    this.resolved.set(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
  }
}
