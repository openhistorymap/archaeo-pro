# archaeo·pro — native mobile app (Tauri 2)

The iOS/Android app is the **same Angular PWA** loaded into a [Tauri 2](https://tauri.app)
webview. There is no second codebase: one production build serves the web at
`archaeo.pro` and the native shell. The Rust side only adds the field plugins
the browser can't give us — system-browser OAuth, deep-link return, and GPS.

Project lives in [`frontend/src-tauri/`](../frontend/src-tauri); the web/native
glue is in `frontend/src/app/core/platform.ts` and `frontend/src/app/core/tauri/`.

```
frontend/
  src/                 Angular app (web + native)
    app/core/platform.ts          isTauri(), API base, OAuth redirect URI
    app/core/tauri/
      geolocation-bridge.ts       navigator.geolocation → tauri-plugin-geolocation
      deep-link.ts                catches archaeopro://auth-callback
  src-tauri/           Tauri shell
    Cargo.toml  build.rs  tauri.conf.json
    src/{main,lib}.rs
    capabilities/default.json     plugin permissions
    app-icon.png                  source for `tauri icon`
    icons/                        desktop icon set (generated)
    gen/                          android/ + apple/ projects (after `… init`)
```

## How web vs. native differ at runtime

| Concern | Web (`archaeo.pro`) | Native shell |
| --- | --- | --- |
| API base (`apiBase()`) | `''` — relative; Netlify reverse-proxy | `https://archaeo-pro.vercel.app` (direct) |
| CORS | same-origin, none | backend allowlists `tauri://localhost` + `http://tauri.localhost` |
| OAuth redirect | in-page to `/auth/callback` | system browser → `archaeo.pro/auth/callback` → `archaeopro://` deep link |
| Geolocation | `navigator.geolocation` | `tauri-plugin-geolocation` (bridged) |
| Camera | `<input type=file accept=image/*>` (native picker) | same — works as-is |

`isTauri()` keys off `window.__TAURI_INTERNALS__`. **One** production build works
for both, so CI/Netlify is unchanged.

## OAuth on mobile (deep-link bounce)

GitHub OAuth Apps only redirect to the one registered https callback, which would
open the website, not the app. So the native flow is:

1. App opens GitHub authorize in the **system browser** (`tauri-plugin-opener`),
   with `state` prefixed `m.` and `redirect_uri = https://archaeo.pro/auth/callback`.
2. GitHub returns the browser to `https://archaeo.pro/auth/callback?code&state`.
3. The shared callback page sees the `m.` marker and **bounces** to
   `archaeopro://auth-callback?code&state` (auto-redirect + a manual "Apri
   archaeo·pro" link as fallback).
4. The OS hands that custom-scheme URL to the app; `deep-link.ts` parses it and
   calls `completeLogin(code, state)`, which exchanges the code via the Vercel
   `/auth/github/exchange` relay (the PKCE verifier is held on-device).

**No GitHub OAuth App change is needed** — the callback URL stays
`https://archaeo.pro/auth/callback`.

## Prerequisites (this repo's dev box can't build it)

The container has cargo 1.65 + Node 16; Tauri 2 needs **Rust ≥ 1.77.2** and
Angular 21 needs **Node ≥ 20**. Build on a proper machine:

- **Rust** via [rustup](https://rustup.rs) (stable ≥ 1.77.2)
- **Node ≥ 20**
- **Android**: Android Studio + SDK + NDK; set `ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME`.
  Add Rust targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`
- **iOS** (macOS only): Xcode + command-line tools, CocoaPods.
  Add Rust targets: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`

See Tauri's [mobile prerequisites](https://tauri.app/start/prerequisites/).

## First-time setup

```bash
cd frontend
npm install                      # pulls @tauri-apps/* + the CLI

# 1. Generate the full icon set (desktop + iOS + Android) from the brand mark.
npm run tauri:icon               # = tauri icon ./src-tauri/app-icon.png
                                 # (replace app-icon.png with the real logo first)

# 2. Scaffold the platform projects (creates src-tauri/gen/).
npm run tauri:android:init
npm run tauri:ios:init           # macOS only
```

### Verify the custom-scheme deep link after `init`

`tauri … init` should generate the intent-filter / URL type from
`tauri.conf.json → plugins.deep-link.mobile`. Confirm it landed; if not, add it:

- **Android** — `src-tauri/gen/android/app/src/main/AndroidManifest.xml`, inside
  the main activity:
  ```xml
  <intent-filter android:autoVerify="false">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="archaeopro" android:host="auth-callback" />
  </intent-filter>
  ```
- **iOS** — `src-tauri/gen/apple/<app>_iOS/Info.plist`:
  ```xml
  <key>CFBundleURLTypes</key>
  <array><dict>
    <key>CFBundleURLSchemes</key>
    <array><string>archaeopro</string></array>
  </dict></array>
  ```

## Run & build

```bash
cd frontend
npm run tauri:android:dev        # emulator or USB device (adb)
npm run tauri:ios:dev            # simulator or device (macOS)

npm run tauri:android:build      # .apk / .aab → src-tauri/gen/android/app/build/outputs/
npm run tauri:ios:build          # .ipa via Xcode archive (macOS)
```

`beforeDevCommand`/`beforeBuildCommand` in `tauri.conf.json` run the Angular
build automatically, so you don't `ng build` separately.

## Backend / infra checklist

- [x] **CORS** — `backend/app/config.py` default + `.env.example` now include
      `tauri://localhost` and `http://tauri.localhost`. Set the same on Vercel's
      `CORS_ORIGINS` env var.
- [ ] **GitHub OAuth App** — no change (callback stays `https://archaeo.pro/auth/callback`).
- [ ] **Store identifiers** — bundle id is `pro.archaeo.app` (`tauri.conf.json`).
      Set up signing: Android keystore, iOS provisioning/Team ID.

## Known follow-ups

- **CSP** is `null` for v1 (the app loads from many origins). Tighten to an
  explicit allowlist (GitHub API/uploads, Vercel, OSM/WMS, fonts) in a hardening pass.
- **Native camera/share/filesystem** (save DOCX/PDF to Files, share sheet) are
  not wired yet — photo capture already works through the file input; native
  export is the next increment.
- **App Links / Universal Links** (open the https callback straight into the app,
  no bounce page) can replace the custom-scheme bounce once `.well-known/assetlinks.json`
  + `apple-app-site-association` are hosted on archaeo.pro with the signed app's
  fingerprints.
