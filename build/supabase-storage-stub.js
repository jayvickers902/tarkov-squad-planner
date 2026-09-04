// Build-time stub for @supabase/storage-js.
//
// createClient() eagerly constructs a StorageClient in the SupabaseClient
// constructor, so the real package — plus its own dependency on iceberg-js, an
// Apache Iceberg REST catalog client — is pulled into the entry chunk on every
// page load. This app stores no files in Supabase Storage: nothing reads
// `supabase.storage`. Aliasing the package here keeps ~126 KB of unreachable
// source out of the bundle that gates first paint.
//
// The constructor must stay silent (it runs for every visitor). Any *use* of
// the client throws, so reintroducing Storage fails loudly in dev and in the
// vitest suite, which resolves through this same alias.

const MESSAGE =
  'Supabase Storage is stubbed out of this bundle (see build/supabase-storage-stub.js). ' +
  'To use supabase.storage, remove the alias in vite.config.js first.'

export class StorageApiError extends Error {
  constructor(message, status, statusCode) {
    super(message)
    this.name = 'StorageApiError'
    this.status = status
    this.statusCode = statusCode
  }
}

export class StorageClient {
  // Signature mirrors the real client so the SupabaseClient constructor can
  // build one without special-casing. The arguments are deliberately unused.
  constructor() {}

  from() { throw new Error(MESSAGE) }
  listBuckets() { throw new Error(MESSAGE) }
  getBucket() { throw new Error(MESSAGE) }
  createBucket() { throw new Error(MESSAGE) }
  updateBucket() { throw new Error(MESSAGE) }
  emptyBucket() { throw new Error(MESSAGE) }
  deleteBucket() { throw new Error(MESSAGE) }
}
