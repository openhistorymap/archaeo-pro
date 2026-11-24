import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { installGeolocationBridge } from './app/core/tauri/geolocation-bridge';

// Patch navigator.geolocation with the native plugin *before* the map can read
// it. No-op (and no plugin import) on the web. Never blocks bootstrap.
installGeolocationBridge()
  .catch((err) => console.error('geolocation bridge', err))
  .finally(() => {
    bootstrapApplication(App, appConfig).catch((err) => console.error(err));
  });
