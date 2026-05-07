import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { GitHubAuthService } from '../../core/github/auth.service';

@Component({
  selector: 'app-auth-callback',
  imports: [RouterLink],
  template: `
    <section class="callback">
      @if (error()) {
        <p class="callback__error">Errore di accesso: {{ error() }}</p>
        <a routerLink="/login">Torna al login</a>
      } @else {
        <p>Completamento accesso a GitHub…</p>
      }
    </section>
  `,
  styles: [`
    .callback { padding: 3rem 1rem; text-align: center; }
    .callback__error { color: #b00020; font-weight: 600; }
  `],
})
export class AuthCallback {
  private readonly auth = inject(GitHubAuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly error = signal<string | null>(null);

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
    this.auth
      .completeLogin(code, state)
      .then((returnTo) => this.router.navigateByUrl(returnTo))
      .catch((err) => this.error.set(err instanceof Error ? err.message : String(err)));
  }
}
