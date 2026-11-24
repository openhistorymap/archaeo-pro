import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ConflictService, describePath } from '../../core/offline/conflicts';
import { Conflict } from '../../core/offline/db';

/**
 * The few edits a merge could not settle: the same field changed here and by
 * someone else. This device's value is the one on GitHub now; each row lets
 * the person keep it or put the other value back.
 */
@Component({
  selector: 'app-conflicts',
  imports: [RouterLink],
  template: `
    <section class="page">
      <nav class="crumbs"><a routerLink="/">← Registro</a></nav>
      <header class="head">
        <p class="eyebrow">sincronizzazione</p>
        <h1 class="title">Conflitti</h1>
        <p class="sub">
          Qui finiscono solo i campi modificati sia da te sia da un collaboratore (o da un altro
          dispositivo) prima che le due versioni si incontrassero. Tutto il resto è stato unito da
          solo. Ora vale la tua versione: scegli, campo per campo, se tenerla.
        </p>
      </header>

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      @if (items(); as list) {
        @if (list.length === 0) {
          <p class="empty">Nessun conflitto aperto.</p>
        }
        @for (c of list; track c.id) {
          <article class="conflict">
            <h2 class="conflict__title">{{ describe(c.path) }}</h2>
            <p class="conflict__meta">{{ c.repo }} · {{ c.path }}</p>
            @if (c.clashes?.length) {
              @for (x of c.clashes!; track x.path; let i = $index) {
                <div class="clash">
                  <p class="clash__field">{{ x.path }}</p>
                  <div class="clash__sides">
                    <div>
                      <span class="clash__label">tua (in uso)</span>
                      <p class="clash__value">{{ show(x.mine) }}</p>
                    </div>
                    <div>
                      <span class="clash__label">del collaboratore</span>
                      <p class="clash__value">{{ show(x.theirs) }}</p>
                    </div>
                  </div>
                  <div class="clash__actions">
                    <button
                      type="button"
                      class="btn btn--ghost"
                      [disabled]="busy()"
                      (click)="keep(c, i)"
                    >
                      Tieni la mia
                    </button>
                    <button
                      type="button"
                      class="btn btn--ghost"
                      [disabled]="busy()"
                      (click)="theirs(c, i)"
                    >
                      Usa la sua
                    </button>
                  </div>
                </div>
              }
            } @else {
              <p>
                Il file è stato modificato su GitHub mentre avevi una modifica in attesa e non si
                può unire campo per campo: vale la tua versione, quella remota è conservata qui.
              </p>
              <div class="clash__actions">
                <button type="button" class="btn btn--ghost" [disabled]="busy()" (click)="keep(c)">
                  Tieni la mia
                </button>
                <button
                  type="button"
                  class="btn btn--ghost"
                  [disabled]="busy()"
                  (click)="theirs(c)"
                >
                  Ripristina la remota
                </button>
              </div>
            }
          </article>
        }
      }
    </section>
  `,
  styles: [
    `
      .page {
        width: 100%;
        max-width: 56rem;
        margin: 0 auto;
        padding: var(--space-xl) var(--space-lg);
        display: grid;
        gap: var(--space-lg);
      }
      .crumbs a {
        color: var(--text-soft);
        text-decoration: none;
        font-size: var(--text-sm);
      }
      .eyebrow {
        font-size: var(--text-xs);
        letter-spacing: 0.18em;
        text-transform: uppercase;
        font-weight: 600;
        color: var(--text-soft);
        margin: 0;
      }
      .title {
        font-family: var(--font-display);
        font-weight: 600;
        font-size: clamp(2rem, 4vw, 3rem);
        margin: 0;
      }
      .sub {
        font-size: var(--text-md);
        line-height: var(--leading-normal);
        margin: var(--space-sm) 0 0;
        max-width: 44rem;
      }
      .empty {
        font-family: var(--font-display);
        font-style: italic;
        font-size: var(--text-lg);
        padding: var(--space-md);
        background: var(--surface-warm);
        border-radius: var(--radius-md);
        margin: 0;
      }
      .error {
        color: var(--accent-strong);
        margin: 0;
      }
      .conflict {
        border: 1px solid var(--rule);
        border-radius: var(--radius-lg);
        padding: var(--space-md);
        display: grid;
        gap: var(--space-sm);
        background: var(--surface-elev);
      }
      .conflict__title {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-lg);
      }
      .conflict__meta {
        margin: 0;
        font-size: var(--text-xs);
        color: var(--text-faint);
        font-family: var(--font-mono);
      }
      .clash {
        border-top: 1px solid var(--rule);
        padding-top: var(--space-sm);
        display: grid;
        gap: var(--space-xs);
      }
      .clash__field {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-sm);
      }
      .clash__sides {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-md);
      }
      .clash__label {
        font-size: var(--text-xs);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-soft);
        font-weight: 600;
      }
      .clash__value {
        margin: var(--space-2xs) 0 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: var(--text-base);
      }
      .clash__actions {
        display: flex;
        gap: var(--space-xs);
        flex-wrap: wrap;
      }
      @media (max-width: 640px) {
        .clash__sides {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class ConflictsPage {
  private readonly conflicts = inject(ConflictService);

  readonly items = signal<Conflict[] | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly describe = describePath;

  constructor() {
    void this.reload();
  }

  show(v: unknown): string {
    if (v === undefined || v === null || v === '') return '(vuoto)';
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  }

  keep(c: Conflict, clash?: number): Promise<void> {
    return this.act(() => this.conflicts.keepMine(c, clash));
  }

  theirs(c: Conflict, clash?: number): Promise<void> {
    return this.act(() => this.conflicts.useTheirs(c, clash));
  }

  private async act(task: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await task();
      await this.reload();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  private async reload(): Promise<void> {
    this.items.set(await this.conflicts.open());
  }
}
