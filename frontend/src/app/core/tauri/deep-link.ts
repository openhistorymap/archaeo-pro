/**
 * Catches the OAuth return into the native app.
 *
 * Mobile login can't ride the in-webview redirect: GitHub only redirects to
 * the registered https callback, which would load the website, not the app.
 * So the native flow opens GitHub in the *system browser*, GitHub returns to
 * `https://archaeo.pro/auth/callback`, and that page bounces to
 * `archaeopro://auth-callback?code=…&state=…` (see auth-callback.ts). The OS
 * hands that custom-scheme URL to us here, both at cold start (app launched by
 * the link) and warm (app already running in the background).
 *
 * No-op on the web.
 */
import { DEEP_LINK_SCHEME, isTauri } from '../platform';

export async function registerOAuthDeepLink(
  handle: (code: string, state: string) => void,
): Promise<void> {
  if (!isTauri()) return;

  const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link');

  const consume = (urls: string[] | null | undefined): void => {
    for (const raw of urls ?? []) {
      try {
        const u = new URL(raw);
        if (u.protocol.replace(/:$/, '') !== DEEP_LINK_SCHEME) continue;
        const code = u.searchParams.get('code');
        const state = u.searchParams.get('state');
        if (code && state) handle(code, state);
      } catch {
        // Not a URL we understand — ignore.
      }
    }
  };

  // Cold start: the app was launched by the deep link.
  consume(await getCurrent());
  // Warm: the app was already running when the link arrived.
  await onOpenUrl(consume);
}
