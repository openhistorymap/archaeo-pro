/**
 * Tauri webviews don't expose `navigator.geolocation`, so MapLibre's
 * GeolocateControl (and any other web geolocation use) silently fails on the
 * phone. This shim backs `navigator.geolocation` with the native
 * `tauri-plugin-geolocation`, mapping its types to the DOM shapes the rest of
 * the app already expects. On the web it's a no-op — the real API is used.
 *
 * Install this once, before the first component that reads geolocation
 * (we do it in main.ts ahead of bootstrap).
 */
import { isTauri } from '../platform';

type TauriPosition = {
  timestamp: number;
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
    altitude?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
};

function toDomPosition(p: TauriPosition): GeolocationPosition {
  return {
    timestamp: p.timestamp ?? Date.now(),
    coords: {
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      accuracy: p.coords.accuracy ?? 0,
      altitude: p.coords.altitude ?? null,
      altitudeAccuracy: p.coords.altitudeAccuracy ?? null,
      heading: p.coords.heading ?? null,
      speed: p.coords.speed ?? null,
      // Newer DOM lib types add this; harmless if absent at runtime.
      toJSON() {
        return this;
      },
    } as GeolocationCoordinates,
    toJSON() {
      return this;
    },
  } as GeolocationPosition;
}

function domError(code: 1 | 2 | 3, message: string): GeolocationPositionError {
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

export async function installGeolocationBridge(): Promise<void> {
  if (!isTauri()) return;

  const geo = await import('@tauri-apps/plugin-geolocation');

  async function ensurePermission(): Promise<boolean> {
    let status = await geo.checkPermissions();
    if (status.location === 'prompt' || status.location === 'prompt-with-rationale') {
      status = await geo.requestPermissions(['location']);
    }
    return status.location === 'granted';
  }

  // Map DOM watch ids (returned synchronously) to the plugin's channel ids
  // (delivered via a Promise). clearWatch() resolves through this table.
  let nextWatchId = 1;
  const channels = new Map<number, number>();

  const bridge: Geolocation = {
    getCurrentPosition: (success, error, options) => {
      void (async () => {
        try {
          if (!(await ensurePermission())) {
            error?.(domError(1, 'Permesso di geolocalizzazione negato.'));
            return;
          }
          const pos = await geo.getCurrentPosition({
            enableHighAccuracy: options?.enableHighAccuracy ?? true,
            timeout: options?.timeout ?? 10_000,
            maximumAge: options?.maximumAge ?? 0,
          });
          success(toDomPosition(pos));
        } catch (e) {
          error?.(domError(2, e instanceof Error ? e.message : String(e)));
        }
      })();
    },

    watchPosition: (success, error, options) => {
      const watchId = nextWatchId++;
      void (async () => {
        try {
          if (!(await ensurePermission())) {
            error?.(domError(1, 'Permesso di geolocalizzazione negato.'));
            return;
          }
          const channelId = await geo.watchPosition(
            {
              enableHighAccuracy: options?.enableHighAccuracy ?? true,
              timeout: options?.timeout ?? 10_000,
              maximumAge: options?.maximumAge ?? 0,
            },
            (pos) => {
              if (pos) success(toDomPosition(pos));
            },
          );
          channels.set(watchId, channelId);
        } catch (e) {
          error?.(domError(2, e instanceof Error ? e.message : String(e)));
        }
      })();
      return watchId;
    },

    clearWatch: (watchId) => {
      const channelId = channels.get(watchId);
      if (channelId !== undefined) {
        channels.delete(watchId);
        void geo.clearWatch(channelId);
      }
    },
  };

  Object.defineProperty(navigator, 'geolocation', {
    value: bridge,
    configurable: true,
  });
}
