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
import { apiBase, isTauri, oauthRedirectUri } from '../platform';

const TOKEN_KEY = 'gh.token.v1';
const VERIFIER_KEY = 'gh.pkce.verifier';
const STATE_KEY = 'gh.pkce.state';
const RETURN_KEY = 'gh.return_to';

/** Marker prefix on `state` so the web callback page knows to bounce into the app. */
const MOBILE_STATE_PREFIX = 'm.';

/**
 * PKCE scratch (verifier/state/return) outlives a browser hop on the web via
 * sessionStorage. On native, the system browser owns the GitHub hop and the
 * app may be backgrounded, so we persist to localStorage to survive that.
 */
function pkceStore(): Storage {
  return isTauri() ? localStorage : sessionStorage;
}

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

  /**
   * Step 1 — send the user to GitHub.
   *
   * Web: navigates the page away (Promise effectively never resolves).
   * Native: opens GitHub in the *system browser* and resolves immediately;
   * the return arrives later via the `archaeopro://` deep link (see
   * registerOAuthDeepLink + completeLogin). The `state` carries a marker so
   * the shared web callback page knows to bounce back into the app.
   */
  async login(returnTo: string = '/'): Promise<void> {
    if (!environment.githubClientId) {
      throw new Error(
        'GITHUB_CLIENT_ID is not configured. Register a GitHub OAuth App and set it in environments/environment.ts.'
      );
    }
    const native = isTauri();
    const verifier = randomString(32);
    const challenge = base64UrlEncode(await sha256(verifier));
    const state = (native ? MOBILE_STATE_PREFIX : '') + randomString(16);

    const store = pkceStore();
    store.setItem(VERIFIER_KEY, verifier);
    store.setItem(STATE_KEY, state);
    store.setItem(RETURN_KEY, returnTo);

    const params = new URLSearchParams({
      client_id: environment.githubClientId,
      redirect_uri: oauthRedirectUri(),
      scope: environment.githubScopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const authorizeUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

    if (native) {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(authorizeUrl);
      return;
    }
    window.location.href = authorizeUrl;
  }

  /** Step 3 — exchange the OAuth code for a token. */
  async completeLogin(code: string, state: string): Promise<string> {
    const store = pkceStore();
    const expectedState = store.getItem(STATE_KEY);
    const verifier = store.getItem(VERIFIER_KEY);
    if (!expectedState || !verifier || state !== expectedState) {
      throw new Error('OAuth state mismatch — refusing to exchange code.');
    }
    store.removeItem(STATE_KEY);
    store.removeItem(VERIFIER_KEY);

    // GitHub's token endpoint doesn't expose CORS, so we relay through our own
    // backend. The backend forwards the body to GitHub and returns the JSON
    // verbatim — it never persists the resulting token. `apiBase()` is empty on
    // the web (Netlify proxy) and the Vercel origin in the native shell.
    // redirect_uri must match the one used in login() (GitHub validates it).
    const res = await fetch(`${apiBase()}/auth/github/exchange`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: environment.githubClientId,
        code,
        redirect_uri: oauthRedirectUri(),
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
    const returnTo = store.getItem(RETURN_KEY) ?? '/';
    store.removeItem(RETURN_KEY);
    return returnTo;
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
