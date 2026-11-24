import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { isTauri } from './core/platform';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(routes, withComponentInputBinding()),
    // Caches the app shell (and WMS tiles already viewed) so the PWA opens in
    // the field with no connection. The native shell bundles its own assets.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !isTauri(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
