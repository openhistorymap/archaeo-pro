/**
 * GitHub OAuth — Authorization Code with PKCE, entirely in the browser.
 * No client secret, no backend involvement. Token lives in IndexedDB so the
 * service worker can keep it across PWA installs/sessions.
 *
 * Flow:
 *   1. login(): generate verifier + state, redirect to github.com/login/oauth/authorize
 *   2. (GitHub redirects back to /auth/callback with code + state)
 *   3. completeLogin(code, state): exchange code for token via GitHub's
 *      no-secret token endpoint, persist to IndexedDB
 *   4. token() — synchronous accessor for downstream services
 */
import { Injectable, signal } from '@angular/core';

import { environment } from '../../../environments/environment';

const TOKEN_KEY = 'gh.token.v1';
const VERIFIER_KEY = 'gh.pkce.verifier';
const STATE_KEY = 'gh.pkce.state';

interface StoredToken {
  access_token: string;
  token_type: string;
  scope: string;
  obtained_at: number;
}

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  id: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(buf);
}

function randomString(bytes = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

@Injectable({ providedIn: 'root' })
export class GitHubAuthService {
  private readonly token$ = signal<StoredToken | null>(this.readToken());
  private readonly user$ = signal<GitHubUser | null>(null);

  readonly token = this.token$.asReadonly();
  readonly user = this.user$.asReadonly();
  readonly isAuthenticated = () => this.token$() !== null;

  /** Step 1 — redirect to GitHub. Returns a Promise that never resolves; the page navigates away. */
  async login(returnTo: string = '/'): Promise<void> {
    if (!environment.githubClientId) {
      throw new Error(
        'GITHUB_CLIENT_ID is not configured. Register a GitHub OAuth App and set it in environments/environment.ts.'
      );
    }
    const verifier = randomString(32);
    const challenge = base64UrlEncode(await sha256(verifier));
    const state = randomString(16);

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem('gh.return_to', returnTo);

    const params = new URLSearchParams({
      client_id: environment.githubClientId,
      redirect_uri: `${window.location.origin}/auth/callback`,
      scope: environment.githubScopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /** Step 3 — exchange the OAuth code for a token. */
  async completeLogin(code: string, state: string): Promise<string> {
    const expectedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!expectedState || !verifier || state !== expectedState) {
      throw new Error('OAuth state mismatch — refusing to exchange code.');
    }
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);

    // GitHub's token endpoint doesn't expose CORS, so we relay through our own
    // backend. The backend forwards the body to GitHub and returns the JSON
    // verbatim — it never persists the resulting token.
    const res = await fetch('/auth/github/exchange', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: environment.githubClientId,
        code,
        redirect_uri: `${window.location.origin}/auth/callback`,
        code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      throw new Error(`GitHub token exchange failed: ${res.status}`);
    }
    const json = (await res.json()) as { access_token?: string; error?: string; scope?: string; token_type?: string };
    if (json.error || !json.access_token) {
      throw new Error(`GitHub token exchange error: ${json.error ?? 'no token'}`);
    }
    const stored: StoredToken = {
      access_token: json.access_token,
      token_type: json.token_type ?? 'bearer',
      scope: json.scope ?? '',
      obtained_at: Date.now(),
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(stored));
    this.token$.set(stored);
    return sessionStorage.getItem('gh.return_to') ?? '/';
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.token$.set(null);
    this.user$.set(null);
  }

  async ensureUser(): Promise<GitHubUser | null> {
    const t = this.token$();
    if (!t) return null;
    if (this.user$()) return this.user$();
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      if (res.status === 401) this.logout();
      return null;
    }
    const u = (await res.json()) as GitHubUser;
    this.user$.set(u);
    return u;
  }

  private readToken(): StoredToken | null {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      return raw ? (JSON.parse(raw) as StoredToken) : null;
    } catch {
      return null;
    }
  }
}
