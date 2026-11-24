import { Component, computed, inject } from '@angular/core';

import { SyncService } from './sync.service';

/**
 * One line in the top bar that says whether the field work on this device
 * has reached GitHub. Silent when everything is synced and online; a tap
 * retries the sync now.
 */
@Component({
  selector: 'app-sync-badge',
  template: `
    @if (label(); as text) {
      <button
        type="button"
        class="sync"
        [class.sync--offline]="!sync.online()"
        [class.sync--error]="!!sync.lastError()"
        [title]="sync.lastError() ?? 'Sincronizza ora'"
        (click)="sync.flush()"
        aria-live="polite"
      >
        <span class="sync__dot" aria-hidden="true"></span>
        <span>{{ text }}</span>
      </button>
    }
  `,
  styles: [
    `
      .sync {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        min-height: 44px;
        padding: 0 var(--space-sm);
        border: 1px solid var(--rule);
        border-radius: var(--radius-pill);
        background: var(--surface-warm);
        color: var(--text-soft);
        font: inherit;
        font-size: var(--text-sm);
        cursor: pointer;
      }
      .sync:hover {
        color: var(--text);
        border-color: var(--rule-strong);
      }
      .sync__dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--field-finding);
      }
      .sync--offline .sync__dot {
        background: var(--text-faint);
      }
      .sync--error {
        border-color: var(--accent-rule);
        color: var(--text);
      }
      .sync--error .sync__dot {
        background: var(--accent);
      }
    `,
  ],
})
export class SyncBadge {
  protected readonly sync = inject(SyncService);

  protected readonly label = computed(() => {
    const n = this.sync.pending();
    const queued = n === 1 ? '1 modifica da sincronizzare' : `${n} modifiche da sincronizzare`;
    const kept = this.sync.conflicts();
    const conflicts = kept
      ? ` · ${kept} ${kept === 1 ? 'versione remota conservata' : 'versioni remote conservate'}`
      : '';
    if (!this.sync.online()) return (n ? `Offline · ${queued}` : 'Offline') + conflicts;
    if (this.sync.lastError()) return 'Sincronizzazione sospesa' + conflicts;
    if (this.sync.syncing()) return 'Sincronizzazione…';
    if (n) return queued + conflicts;
    return conflicts ? conflicts.slice(3) : null;
  });
}
