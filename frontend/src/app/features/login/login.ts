import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { environment } from '../../../environments/environment';
import { GitHubAuthService } from '../../core/github/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(GitHubAuthService);
  private readonly route = inject(ActivatedRoute);

  readonly clientIdMissing = !environment.githubClientId;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async signIn(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const returnTo = this.route.snapshot.queryParamMap.get('return_to') ?? '/';
      await this.auth.login(returnTo);
    } catch (err) {
      this.busy.set(false);
      this.error.set(err instanceof Error ? err.message : String(err));
    }
  }
}
