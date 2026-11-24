import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { GitHubAuthService } from './core/github/auth.service';
import { SyncBadge } from './core/offline/sync-badge';
import { ThemeService } from './core/theme.service';
import { registerOAuthDeepLink } from './core/tauri/deep-link';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, SyncBadge],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly theme = inject(ThemeService);
  private readonly auth = inject(GitHubAuthService);
  private readonly router = inject(Router);

  constructor() {
    // Native only: finish a GitHub login that returned via the
    // `archaeopro://auth-callback` deep link. No-op on the web.
    void registerOAuthDeepLink((code, state) => {
      this.auth
        .completeLogin(code, state)
        .then((returnTo) => this.router.navigateByUrl(returnTo))
        .catch((err) => {
          console.error('OAuth deep-link login failed', err);
          void this.router.navigate(['/login']);
        });
    });
  }
}
