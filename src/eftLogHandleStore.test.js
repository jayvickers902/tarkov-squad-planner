import { describe, expect, it } from 'vitest'
import { CHECKPOINT_VERSION, createEftLogHandleStore, isIndexedDbSupported, sanitiseCheckpoint } from './eftLogHandleStore'

function fakeIndexedDb() {
  const records = new Map()
  const databases = new Map()
  return {
    open() {
      const request = {}
      setTimeout(() => {
        const database = databases.get('test') || {
          objectStoreNames: { names: [], contains(name) { return this.names.includes(name) } },
          createObjectStore(name) { this.objectStoreNames.names.push(name) },
          transaction(name) {
            const transaction = { objectStore: () => ({
              put(value) { return operation(() => records.set(`${name}:${value.key}`, value), transaction) },
              get(key) { return operation(() => records.get(`${name}:${key}`), transaction) },
              delete(key) { return operation(() => records.delete(`${name}:${key}`), transaction) },
            }) }
            return transaction
          },
        }
        databases.set('test', database)
        request.result = database
        request.onupgradeneeded?.()
        request.onsuccess?.()
      }, 0)
      return request
    },
  }
}

function operation(callback, transaction) {
  const request = {}
  setTimeout(() => {
    request.result = callback()
    request.onsuccess?.()
    setTimeout(() => transaction.oncomplete?.(), 0)
  }, 0)
  return request
}

describe('eft log handle store', () => {
  it('reports missing IndexedDB without falling back to another global', () => {
    expect(isIndexedDbSupported({})).toBe(false)
    expect(() => createEftLogHandleStore({ indexedDB: null })).not.toThrow()
  })

  it('persists handles and allowlisted checkpoints through IndexedDB', async () => {
    const store = createEftLogHandleStore({ indexedDB: fakeIndexedDb(), dbName: 'test' })
    const handle = { kind: 'directory', name: 'Logs' }
    await store.saveHandle('account-a', handle)
    expect(await store.loadHandle('account-a')).toBe(handle)

    await store.saveCheckpoint('account-a', {
      gameMode: 'pve',
      files: [{ relativeFilename: 'session/notifications.log', size: 4, lastModified: 3, handle }],
      includedVersions: ['0.16'],
      profileKey: 'profile-local',
      unknownModeTarget: 'pve',
      autoSync: true,
      rawPath: 'C:\\private\\EFT',
    })
    const checkpoint = await store.loadCheckpoint('account-a')
    expect(checkpoint).toMatchObject({ version: CHECKPOINT_VERSION, gameMode: 'pve', autoSync: true })
    expect(checkpoint.files[0]).toEqual({ relativeFilename: 'session/notifications.log', size: 4, lastModified: 3 })
    expect(checkpoint.rawPath).toBeUndefined()
    await store.forget('account-a')
    expect(await store.loadHandle('account-a')).toBeNull()
    expect(await store.loadCheckpoint('account-a')).toBeNull()
  })

  it('sanitises invalid mode and checkpoint metadata', () => {
    expect(sanitiseCheckpoint({ gameMode: 'pvp-season', unknownModeTarget: 'seasonal', files: [{ relativeFilename: '', size: -1 }] }))
      .toMatchObject({ gameMode: null, unknownModeTarget: null, files: [] })
  })

  it('keeps only bounded numeric offsets and file metadata', () => {
    const checkpoint = sanitiseCheckpoint({
      files: [{ relativeFilename: 'notifications.log', size: Number.MAX_VALUE, lastModified: Number.MAX_VALUE, parsedOffset: Number.MAX_SAFE_INTEGER }],
      updatedAt: Number.MAX_VALUE,
      rawFragment: '{private log data}',
    })
    expect(checkpoint.files[0]).toMatchObject({ relativeFilename: 'notifications.log', size: 32 * 1024 * 1024, parsedOffset: 32 * 1024 * 1024 })
    expect(checkpoint.files[0].rawFragment).toBeUndefined()
    expect(checkpoint.updatedAt).toBeLessThan(Number.MAX_VALUE)
    expect(checkpoint.rawFragment).toBeUndefined()
  })

  // The verdict is what lets the next append know which character it is reading
  // when it carries no notifier line of its own. It is persisted beside the byte
  // offset, so an allowlist that dropped it would leave the fix working in
  // memory and failing after a reload.
  it('persists the notifier verdict as a boolean and nothing more', () => {
    const checkpoint = sanitiseCheckpoint({
      files: [
        { relativeFilename: 'notifications.log', parsedOffset: 10, notifierSeasonal: true, notifierHost: 'wsn-pvp-season-01.escapefromtarkov.com' },
        { relativeFilename: 'other.log', parsedOffset: 10, notifierSeasonal: 'pvp-season' },
      ],
    })
    expect(checkpoint.files[0].notifierSeasonal).toBe(true)
    expect(checkpoint.files[0].notifierHost).toBeUndefined()
    expect(checkpoint.files[1].notifierSeasonal).toBeUndefined()
  })

})
