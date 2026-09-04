// Framework-free sign-in provider contract shared by the browser and companion.
// Keep this module free of React, Tauri, Supabase, and browser-only imports.
//
// One list, two sign-in screens: an account created in the web app has to be
// reachable from the desktop companion, so neither side may offer a provider
// the other does not. The order is the order the UI offers them.
//
// Every entry must be a provider Supabase Auth implements natively, because
// both hosts sign in by handing the id straight to `signInWithOAuth`. Steam is
// absent on purpose - it speaks OpenID 2.0, which Supabase Auth does not
// support, so it would need a backend of ours holding the service-role key to
// mint the session.
export const AUTH_PROVIDERS = ['google', 'discord']

export function isAuthProvider(value) {
  return AUTH_PROVIDERS.includes(value)
}
