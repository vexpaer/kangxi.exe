# Cloud CI/CD, Signing & Release Guide

All Windows and Android builds are produced automatically in **GitHub Actions** — no local Android Studio, Rust, or JDK setup is required to download installers.

## Workflows Overview

| Workflow | Trigger | Purpose & Outputs |
|---|---|---|
| `.github/workflows/ci.yml` | PR, push `main` | Workspace typecheck, protocol/app-core/Cloudflare E2E loop tests, `cf build` + dry-run, Rust `kangxi-bridge` tests. |
| `.github/workflows/build.yml` | Push `main`, manual | Parallel cloud build of Windows NSIS installer (`*-windows-x64-setup-unsigned.exe`), `kangxi-bridge.exe`, and Android arm64 debug APK (`*-android-arm64-debug.apk`). |
| `.github/workflows/release.yml` | Git tag `v*`, manual | Builds Windows + Android artifacts, signs Android APK if keystore secrets are present (otherwise labels `debug`), computes `SHA256SUMS.txt`, and publishes a GitHub Release. |
| `.github/workflows/deploy-cloudflare.yml` | **Manual `workflow_dispatch` only** | Runs D1 migrations and deploys Worker via `cf deploy --prebuilt`. Never triggered by normal code pushes. |

---

## Configuring Persistent Android Release Signing

Android upgrades fail if the signing key changes between releases. Generate a persistent keystore once on a trusted machine:

```bash
keytool -genkey -v -keystore upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
base64 -w 0 upload-keystore.jks > keystore.b64
```

Add these **GitHub Repository Secrets** (never commit `.jks` files to Git):
- `ANDROID_KEYSTORE_BASE64`: contents of `keystore.b64`
- `ANDROID_KEYSTORE_PASSWORD`: keystore password
- `ANDROID_KEY_ALIAS`: e.g. `upload`
- `ANDROID_KEY_PASSWORD`: key password

When these secrets are absent, `release.yml` explicitly builds and names the artifact `*-android-arm64-debug.apk` so an unsigned/debug build is never mistaken for a stable signed release.

---

## Windows Code Signing Note

Until an Authenticode certificate is configured, Windows installers are explicitly labeled `*-windows-x64-setup-unsigned.exe`. Windows SmartScreen may show an "Unknown publisher" warning on first launch.

---

## Cutting a New Release

1. Update version numbers in `package.json`, `apps/client/src-tauri/tauri.conf.json`, and `apps/client/src-tauri/Cargo.toml`.
2. Commit and push to `main`.
3. Tag and push:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. GitHub Actions automatically builds both platforms and publishes the GitHub Release with `SHA256SUMS.txt`.
