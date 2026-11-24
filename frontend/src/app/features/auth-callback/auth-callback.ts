import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { GitHubAuthService } from '../../core/github/auth.service';
import { DEEP_LINK_CALLBACK } from '../../core/platform';

@Component({
  selector: 'app-auth-callback',
  imports: [RouterLink],
  template: `
    <section class="callback">
      @if (appLink()) {
        <h1>Ritorno all’app…</h1>
        <p class="callback__msg muted">Apertura di archaeo·pro in corso.</p>
        <a [href]="appLink()!" class="btn">Apri archaeo·pro</a>
      } @else if (error()) {
        <h1>Accesso non riuscito</h1>
        <p class="callback__msg">{{ error() }}</p>
        <a routerLink="/login" class="btn btn--ghost">Torna al login</a>
      } @else {
        <h1>Apertura sessione…</h1>
        <p class="callback__msg muted">Sto scambiando il codice di autorizzazione con GitHub.</p>
        <span class="callback__pulse" aria-hidden="true"></span>
      }
    </section>
  `,
  styles: [`
    .callback {
      flex: 1 1 auto;
      display: grid;
      place-content: center;
      gap: var(--space-md);
      padding: var(--space-3xl) var(--space-lg);
      text-align: center;
    }
    h1 {
      font-family: var(--font-display);
      font-style: italic;
      font-weight: 500;
      font-size: var(--text-2xl);
    }
    .callback__msg { max-width: 32rem; }
    .callback__pulse {
      display: block;
      width: 28px;
      height: 1px;
      margin: var(--space-md) auto 0;
      background: var(--accent);
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scaleX(0.3); opacity: 0.4; }
      50% { transform: scaleX(1); opacity: 1; }
    }
  `],
})
export class AuthCallback {
  private readonly auth = inject(GitHubAuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly error = signal<string | null>(null);
  /** Set when this hit is the system browser returning a *native* login. */
  readonly appLink = signal<string | null>(null);

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error_description') ?? params.get('error');
    if (oauthError) {
      this.error.set(oauthError);
      return;
    }
    if (!code || !state) {
      this.error.set('Parametri OAuth mancanti.');
      return;
    }

    // Native login round-trips through the system browser; GitHub can only
    // return to this https page. A `m.`-prefixed state means "bounce the code
    // back into the app" via the custom scheme — this page never holds the
    // PKCE verifier for that flow, so it must not try to exchange.
    if (state.startsWith('m.')) {
      const link = `${DEEP_LINK_CALLBACK}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      this.appLink.set(link);
      window.location.href = link; // auto-open; the button is the fallback
      return;
    }

    this.auth
      .completeLogin(code, state)
      .then((returnTo) => this.router.navigateByUrl(returnTo))
      .catch((err) => this.error.set(err instanceof Error ? err.message : String(err)));
  }
}
