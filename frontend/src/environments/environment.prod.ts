/**
 * Production environment.
 *
 * GitHub Client ID is *public* (PKCE has no client secret) so it's safe to
 * embed. It does have to match the Authorization callback URL set on the
 * GitHub OAuth App: https://archaeo.pro/auth/callback
 *
 * `apiBaseUrl` stays empty: in production, Netlify proxies /wms, /documents,
 * /auth, /health to the Vercel backend (see netlify.toml). The PWA always
 * uses relative URLs, so there's no CORS in prod either.
 */
export const environment = {
  production: true,
  githubClientId: '__GITHUB_CLIENT_ID_PROD__',
  githubScopes: ['repo', 'user:email'],
  apiBaseUrl: '',
};
