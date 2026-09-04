import { createClient as defaultCreateClient } from '@supabase/supabase-js'
import { containsAsciiControlCharacter } from './textValidation.js'

export const AUTH_CALLBACK_URL = 'tarkov-squad-planner://auth/callback'
const AUTH_CALLBACK_PROTOCOL = 'tarkov-squad-planner:'

export class AuthBoundaryError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'AuthBoundaryError'
    this.code = code
  }
}

function authError(code) {
  return new AuthBoundaryError(code)
}

function assertStorageKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 256 || containsAsciiControlCharacter(key)) {
    throw authError('AUTH_STORAGE_INVALID_KEY')
  }
}

/**
 * Adapt the Tauri credential commands to the asynchronous Storage interface
 * expected by supabase-js. This is deliberately not a Web Storage adapter:
 * credentials never fall back to localStorage, sessionStorage, or cookies.
 */
export function createSecureStorage({ credentialGet, credentialSet, credentialDelete }) {
  if (typeof credentialGet !== 'function' || typeof credentialSet !== 'function' || typeof credentialDelete !== 'function') {
    throw authError('AUTH_STORAGE_UNAVAILABLE')
  }
  return {
    async getItem(key) {
      try {
        assertStorageKey(key)
        const value = await credentialGet(key)
        return value == null ? null : typeof value === 'string' ? value : String(value)
      } catch (error) {
        if (error instanceof AuthBoundaryError) throw error
        throw authError('AUTH_STORAGE_FAILED')
      }
    },
    async setItem(key, value) {
      try {
        assertStorageKey(key)
        // Keep this aligned with the native keyring command's hard bound.
        if (typeof value !== 'string' || value.length > 64 * 1024) throw authError('AUTH_STORAGE_INVALID_VALUE')
        await credentialSet(key, value)
      } catch (error) {
        if (error instanceof AuthBoundaryError) throw error
        throw authError('AUTH_STORAGE_FAILED')
      }
    },
    async removeItem(key) {
      try {
        assertStorageKey(key)
        await credentialDelete(key)
      } catch (error) {
        if (error instanceof AuthBoundaryError) throw error
        throw authError('AUTH_STORAGE_FAILED')
      }
    },
  }
}

function callbackObject(value) {
  if (value instanceof URL) return value
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) throw authError('AUTH_CALLBACK_INVALID')
  try {
    return new URL(value)
  } catch {
    throw authError('AUTH_CALLBACK_INVALID')
  }
}

/** Validate without returning query values (which may contain OAuth secrets). */
export function isValidCallbackUrl(value) {
  try {
    const url = callbackObject(value)
    return url.protocol === AUTH_CALLBACK_PROTOCOL
      && url.hostname === 'auth'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && url.pathname === '/callback'
      && !url.hash.toLowerCase().includes('access_token')
      && !url.hash.toLowerCase().includes('refresh_token')
      && !url.searchParams.has('access_token')
      && !url.searchParams.has('refresh_token')
      && (url.searchParams.has('code') || url.searchParams.has('error'))
  } catch {
    return false
  }
}

function validateCallbackUrl(value) {
  const url = callbackObject(value)
  if (!isValidCallbackUrl(url)) throw authError('AUTH_CALLBACK_INVALID')
  return url
}

function normalizeOAuthUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) throw authError('AUTH_SIGN_IN_FAILED')
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('invalid')
  } catch {
    throw authError('AUTH_SIGN_IN_FAILED')
  }
  return value
}

/**
 * Build the companion auth boundary. All platform behavior (secure commands,
 * system browser, and deep-link registration) is injected by the Tauri shell.
 */
export function createAuthClient({
  supabaseUrl,
  url,
  anonKey,
  supabaseKey,
  key,
  credentialGet,
  credentialSet,
  credentialDelete,
  storage,
  secureStorage,
  createClient = defaultCreateClient,
  openExternal,
  browserOpen,
  redirectTo = AUTH_CALLBACK_URL,
  initialUrl,
  initialUrls,
} = {}) {
  const effectiveUrl = supabaseUrl ?? url
  const effectiveKey = anonKey ?? supabaseKey ?? key
  let parsedSupabaseUrl
  try { parsedSupabaseUrl = new URL(effectiveUrl) } catch { parsedSupabaseUrl = null }
  if (!parsedSupabaseUrl || parsedSupabaseUrl.protocol !== 'https:' || !parsedSupabaseUrl.hostname
    || parsedSupabaseUrl.username || parsedSupabaseUrl.password
    || typeof effectiveKey !== 'string' || !effectiveKey.trim() || effectiveKey.length > 8192) {
    throw authError('AUTH_CONFIG_INVALID')
  }
  if (typeof redirectTo !== 'string' || redirectTo !== AUTH_CALLBACK_URL) throw authError('AUTH_CONFIG_INVALID')

  const authStorage = storage || secureStorage || createSecureStorage({ credentialGet, credentialSet, credentialDelete })
  let client
  try {
    client = createClient(effectiveUrl, effectiveKey, {
      auth: {
        storage: authStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  } catch {
    throw authError('AUTH_CLIENT_UNAVAILABLE')
  }
  if (!client?.auth) throw authError('AUTH_CLIENT_UNAVAILABLE')

  const handleCallbackUrl = async (value) => {
    const url = validateCallbackUrl(value)
    if (url.searchParams.has('error')) throw authError('AUTH_CALLBACK_REJECTED')
    const code = url.searchParams.get('code')
    if (!code || code.length > 2048) throw authError('AUTH_CALLBACK_INVALID')
    try {
      const result = await client.auth.exchangeCodeForSession(code)
      if (result?.error) throw result.error
      return { session: result?.data?.session ?? null }
    } catch (error) {
      if (error instanceof AuthBoundaryError) throw error
      throw authError('AUTH_CALLBACK_FAILED')
    }
  }

  const handleCallbackUrls = async (values) => {
    const urls = Array.isArray(values) ? values : [values]
    if (!urls.length) throw authError('AUTH_CALLBACK_INVALID')
    const callback = urls.find(isValidCallbackUrl)
    if (!callback) throw authError('AUTH_CALLBACK_INVALID')
    // Only a validated callback URL is handed to this private exchange path;
    // callers receive a status/session, never URL/query contents.
    return handleCallbackUrl(callback)
  }

  const api = {
    client,
    auth: client.auth,
    async signIn() {
      try {
        const result = await client.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: true },
        })
        if (result?.error || !result?.data?.url) throw result?.error || new Error('no oauth url')
        const open = openExternal ?? browserOpen
        if (typeof open !== 'function') throw authError('AUTH_BROWSER_UNAVAILABLE')
        await open(normalizeOAuthUrl(result.data.url))
        return { started: true }
      } catch (error) {
        if (error instanceof AuthBoundaryError) throw error
        throw authError('AUTH_SIGN_IN_FAILED')
      }
    },
    async signOut() {
      try {
        const result = await client.auth.signOut()
        if (result?.error) throw result.error
      } catch (error) {
        if (error instanceof AuthBoundaryError) throw error
        throw authError('AUTH_SIGN_OUT_FAILED')
      }
    },
    async currentSession() {
      try {
        const result = await client.auth.getSession()
        if (result?.error) throw result.error
        return result?.data?.session ?? null
      } catch (error) {
        if (error instanceof AuthBoundaryError) throw error
        throw authError('AUTH_SESSION_FAILED')
      }
    },
    getSession() { return api.currentSession() },
    subscribe(callback) {
      if (typeof callback !== 'function') throw authError('AUTH_SUBSCRIPTION_INVALID')
      try {
        const result = client.auth.onAuthStateChange(callback)
        const subscription = result?.data?.subscription
        return () => subscription?.unsubscribe?.()
      } catch {
        throw authError('AUTH_SUBSCRIPTION_FAILED')
      }
    },
    handleCallbackUrl,
    handleCallbackUrls,
    async initialize(value = initialUrl ?? initialUrls) {
      if (value == null) return api.currentSession()
      return handleCallbackUrls(value)
    },
  }

  // Expose a promise for cold-start callers that supplied the URL at creation.
  const coldStartUrl = initialUrl ?? initialUrls
  api.ready = coldStartUrl == null ? Promise.resolve(null) : handleCallbackUrls(coldStartUrl)
    .catch((error) => { throw error instanceof AuthBoundaryError ? error : authError('AUTH_CALLBACK_FAILED') })
  return api
}

export const createAuthBoundary = createAuthClient
export const createSupabaseAuth = createAuthClient
export { validateCallbackUrl }
