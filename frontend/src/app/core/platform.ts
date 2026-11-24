/**
 * Platform awareness so a *single* production build runs both as the web PWA
 * and inside the Tauri (iOS/Android/desktop) shell.
 *
 * On the web, API calls stay relative — Netlify reverse-proxies them and
 * same-origin keeps CORS out of the picture. Inside the native shell the app
 * is served from `tauri://localhost`, so the same calls must target the real
 * backend origin directly (the backend's CORS allowlist includes the Tauri
 * origins — see backend/app/config.py).
 */
import { environment } from '../../environments/environment';

/** True when running inside the Tauri shell (any platform). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Vercel API origin the native app talks to directly (no Netlify proxy in the
 * shell). Mirror of the `_redirects` reverse-proxy target.
 */
export const NATIVE_API_BASE = 'https://archaeo-pro.vercel.app';

/** Public website hosting the GitHub OAuth callback + the deep-link bounce. */
export const WEB_ORIGIN = 'https://archaeo.pro';

/** Custom URL scheme the OAuth bounce redirects into. Mirrors tauri.conf.json. */
export const DEEP_LINK_SCHEME = 'archaeopro';
export const DEEP_LINK_HOST = 'auth-callback';
/** `archaeopro://auth-callback` — the app's OAuth return address. */
export const DEEP_LINK_CALLBACK = `${DEEP_LINK_SCHEME}://${DEEP_LINK_HOST}`;

/** Base for backend calls: absolute in the native shell, relative on the web. */
export function apiBase(): string {
  return isTauri() ? NATIVE_API_BASE : environment.apiBaseUrl;
}

/**
 * The redirect_uri sent to GitHub. One value is registered on the OAuth App
 * (`https://archaeo.pro/auth/callback`); the web flow returns there in-page,
 * the native flow lets that page bounce into the app via the custom scheme.
 */
export function oauthRedirectUri(): string {
  return isTauri()
    ? `${WEB_ORIGIN}/auth/callback`
    : `${window.location.origin}/auth/callback`;
}
