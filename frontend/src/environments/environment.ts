/**
 * Build-time environment config. The GitHub Client ID is *public* (PKCE flow
 * uses no client secret), so it's safe to embed in the bundle.
 *
 * To run locally, register a GitHub OAuth App and put its Client ID here:
 *   https://github.com/settings/developers
 *   Authorization callback URL: http://localhost:4200/auth/callback
 */
export const environment = {
  production: false,
  githubClientId: '',
  githubScopes: ['repo', 'user:email'],
  /** Backend used only for WMS proxy + DOCX/PDF rendering. */
  apiBaseUrl: '',
};
