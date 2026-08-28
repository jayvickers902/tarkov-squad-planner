# Tarkov Squad Planner Companion

Windows-first Tauri 2 tray companion for Tarkov Squad Planner. Once signed in
and pointed at the local EFT folders, it watches quest logs and screenshot
metadata, reconciles quest state through Supabase, and publishes the same
party position pings as the website without requiring a browser tab.

## Development

The companion reuses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the
repository root `.env` via Vite's `envDir`. From this directory:

```bash
npm install
npm test
npm run build
npm run tauri:dev
```

Closing the window hides it in the system tray. A normal launch opens the
window; Windows autostart passes `--background` and starts hidden. Only one
instance runs at a time.

The first run requires:

1. Apply `supabase/10_19_desktop_sync_context.sql` to the target Supabase
   project (after the earlier numbered migrations).
2. Add `tarkov-squad-planner://auth/callback` to the Supabase Auth redirect
   allowlist.
3. Sign in with Google from the companion.
4. Choose the EFT `Logs` and `Screenshots` folders.

Auth uses PKCE in the system browser. The session is stored through the OS
credential manager, not Web Storage. Child file identifiers stay relative;
log reads are confined to the configured root. Screenshot image bytes are
never opened. Checkpoints are bounded, versioned, and namespaced per user.

## Verification and release

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --debug --no-bundle
```

NSIS and MSI bundle targets are configured. Before distributing builds,
replace the updater public-key placeholder and add signed updater endpoints in
`src-tauri/tauri.conf.json`, then configure Windows code signing. The current
opener/CSP allowlists assume the standard `*.supabase.co` project domain; a
custom Supabase domain must be added explicitly.
