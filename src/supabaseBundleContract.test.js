import { describe, expect, it } from 'vitest'
import * as storage from '@supabase/storage-js'
import * as functions from '@supabase/functions-js'

// createClient() constructs a StorageClient eagerly and imports functions-js
// statically, so both packages landed in the entry chunk that gates first paint
// even though this app uses neither. vite.config.js aliases them to the stubs in
// build/, which also drops storage-js's own iceberg-js dependency - an Apache
// Iceberg REST catalog client - from the bundle.
//
// These tests resolve through the same alias the production build uses (see the
// server.deps.inline note in vite.config.js). If someone starts using Supabase
// Storage or Edge Functions the stub throws at the call site and points here,
// rather than the feature quietly working while ~28 KB of unreachable code
// climbs back onto the critical path.
describe('Supabase sub-clients stubbed out of the bundle', () => {
  it('constructs a storage client silently, because SupabaseClient always builds one', () => {
    expect(() => new storage.StorageClient('https://example.test', {}, fetch)).not.toThrow()
  })

  it('throws a signposted error if anything actually uses Storage', () => {
    const client = new storage.StorageClient('https://example.test', {}, fetch)
    expect(() => client.from('bucket')).toThrow(/build\/supabase-storage-stub\.js/)
    expect(() => client.listBuckets()).toThrow(/stubbed out of this bundle/)
  })

  it('throws a signposted error if anything actually invokes an Edge Function', () => {
    const client = new functions.FunctionsClient('https://example.test')
    expect(() => client.invoke('name')).toThrow(/build\/supabase-functions-stub\.js/)
  })

  it('keeps the error subclasses supabase-js re-exports, so its own imports resolve', () => {
    expect(new storage.StorageApiError('nope', 400)).toBeInstanceOf(Error)
    expect(new functions.FunctionsHttpError({})).toBeInstanceOf(functions.FunctionsError)
    expect(functions.FunctionRegion.UsEast1).toBe('us-east-1')
  })
})
