import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { CACHE_SCHEMA_VERSION, dropLegacyKeys, readCached, writeCached } from './idbCache'

const DB_NAME = 'tsp-rest-cache'
const STORE_NAME = 'datasets'

function updateEntry(key, patch) {
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const get = store.get(key)
      get.onsuccess = () => store.put({ ...get.result, ...patch }, key)
      tx.oncomplete = () => { db.close(); resolve() }
    }
  })
}

describe('idb cache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a fresh entry and expires it after seven days', async () => {
    await writeCached('ttl', { value: 1 })
    expect(await readCached('ttl')).toMatchObject({ data: { value: 1 } })
    await updateEntry('ttl', { savedAt: Date.now() - 7 * 24 * 60 * 60 * 1000 - 1 })
    expect(await readCached('ttl')).toBeNull()
  })

  it('rejects a value with the wrong entry version', async () => {
    await writeCached('version', { value: 1 })
    await updateEntry('version', { v: 99 })
    expect(await readCached('version')).toBeNull()
  })

  it('rejects an entry from an older cache schema', async () => {
    await writeCached('schema', { value: 1 })
    await updateEntry('schema', { schemaVersion: CACHE_SCHEMA_VERSION - 1 })
    expect(await readCached('schema')).toBeNull()
  })

  it('degrades to a cache miss when IndexedDB is unavailable', async () => {
    const indexedDb = globalThis.indexedDB
    globalThis.indexedDB = undefined
    await expect(readCached('unavailable')).resolves.toBeNull()
    globalThis.indexedDB = indexedDb
  })

  it('removes only the two legacy cache prefixes', async () => {
    localStorage.setItem('tsp.cache.rest.regular.tasks', 'old')
    localStorage.setItem('tsp.cache.tasks.regular', 'old')
    localStorage.setItem('tsp.cachey.keep', 'keep')
    localStorage.setItem('tsp.user-settings.keep', 'keep')
    await dropLegacyKeys()
    expect(localStorage.getItem('tsp.cache.rest.regular.tasks')).toBeNull()
    expect(localStorage.getItem('tsp.cache.tasks.regular')).toBeNull()
    expect(localStorage.getItem('tsp.cachey.keep')).toBe('keep')
    expect(localStorage.getItem('tsp.user-settings.keep')).toBe('keep')
  })
})
