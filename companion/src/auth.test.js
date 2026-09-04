import { describe, expect, it, vi } from 'vitest'
import { AUTH_CALLBACK_URL, AuthBoundaryError, createAuthClient, createSecureStorage, isValidCallbackUrl } from './auth.js'

function fakeAuth() {
  return {
    signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://accounts.example.test/oauth' }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session: { user: { id: 'u' } } }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  }
}

describe('companion auth boundary', () => {
  it('uses async credential storage and never a Web Storage fallback', async () => {
    const calls = []
    const storage = createSecureStorage({
      credentialGet: async key => { calls.push(['get', key]); return 'value' },
      credentialSet: async (key, value) => calls.push(['set', key, value]),
      credentialDelete: async key => calls.push(['delete', key]),
    })
    await expect(storage.getItem('session')).resolves.toBe('value')
    await storage.setItem('session', 'next')
    await storage.removeItem('session')
    await expect(storage.getItem(`bad${String.fromCodePoint(0)}`)).rejects.toMatchObject({ code: 'AUTH_STORAGE_INVALID_KEY' })
    expect(calls).toEqual([['get', 'session'], ['set', 'session', 'next'], ['delete', 'session']])
  })

  it('rejects untrusted callback URLs without exposing their code', async () => {
    expect(isValidCallbackUrl('https://evil.example/auth/callback?code=secret')).toBe(false)
    expect(isValidCallbackUrl(`${AUTH_CALLBACK_URL}?code=secret`)).toBe(true)
    const auth = fakeAuth()
    const service = createAuthClient({
      supabaseUrl: 'https://project.supabase.co', anonKey: 'anon', storage: createSecureStorage({ credentialGet: async () => null, credentialSet: async () => {}, credentialDelete: async () => {} }),
      createClient: () => ({ auth }),
    })
    await expect(service.handleCallbackUrl('https://evil.example/auth/callback?code=secret')).rejects.toMatchObject({ code: 'AUTH_CALLBACK_INVALID' })
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('selects the validated callback from a multi-url delivery', async () => {
    const auth = fakeAuth()
    const service = createAuthClient({
      supabaseUrl: 'https://project.supabase.co', anonKey: 'anon',
      storage: createSecureStorage({ credentialGet: async () => null, credentialSet: async () => {}, credentialDelete: async () => {} }),
      createClient: () => ({ auth }),
    })
    await service.handleCallbackUrls(['https://unrelated.example/', `${AUTH_CALLBACK_URL}?code=secret`])
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('secret')
  })

  it('starts Google OAuth through the injected system browser with PKCE', async () => {
    const auth = fakeAuth()
    const openExternal = vi.fn(async () => {})
    const service = createAuthClient({
      supabaseUrl: 'https://project.supabase.co', anonKey: 'anon', openExternal,
      storage: createSecureStorage({ credentialGet: async () => null, credentialSet: async () => {}, credentialDelete: async () => {} }),
      createClient: () => ({ auth }),
    })
    await service.signIn()
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true } })
    expect(openExternal).toHaveBeenCalledWith('https://accounts.example.test/oauth')
  })

  it('starts Discord OAuth when that provider is chosen', async () => {
    const auth = fakeAuth()
    const openExternal = vi.fn(async () => {})
    const service = createAuthClient({
      supabaseUrl: 'https://project.supabase.co', anonKey: 'anon', openExternal,
      storage: createSecureStorage({ credentialGet: async () => null, credentialSet: async () => {}, credentialDelete: async () => {} }),
      createClient: () => ({ auth }),
    })
    await service.signIn('discord')
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'discord', options: { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true } })
    expect(openExternal).toHaveBeenCalledWith('https://accounts.example.test/oauth')
  })

  it('refuses a provider outside the shared list without reaching Supabase', async () => {
    const auth = fakeAuth()
    const openExternal = vi.fn(async () => {})
    const service = createAuthClient({
      supabaseUrl: 'https://project.supabase.co', anonKey: 'anon', openExternal,
      storage: createSecureStorage({ credentialGet: async () => null, credentialSet: async () => {}, credentialDelete: async () => {} }),
      createClient: () => ({ auth }),
    })
    // Steam is the live example: Supabase cannot mint a session for it, so the
    // companion must not open a browser window that can only dead-end.
    const failure = service.signIn('steam')
    await expect(failure).rejects.toBeInstanceOf(AuthBoundaryError)
    await expect(failure).rejects.toMatchObject({ code: 'AUTH_SIGN_IN_FAILED' })
    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('wraps provider failures in stable errors', async () => {
    const auth = fakeAuth()
    auth.signOut.mockRejectedValueOnce(new Error('secret provider detail'))
    const service = createAuthClient({
      supabaseUrl: 'https://project.supabase.co', anonKey: 'anon',
      storage: createSecureStorage({ credentialGet: async () => null, credentialSet: async () => {}, credentialDelete: async () => {} }),
      createClient: () => ({ auth }),
    })
    const failure = service.signOut()
    await expect(failure).rejects.toBeInstanceOf(AuthBoundaryError)
    await expect(failure).rejects.toMatchObject({ code: 'AUTH_SIGN_OUT_FAILED' })
  })
})
