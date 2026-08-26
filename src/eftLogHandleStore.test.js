import { describe, expect, it } from 'vitest'
import { createEftLogHandleStore, isIndexedDbSupported, sanitiseCheckpoint } from './eftLogHandleStore'

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
    expect(checkpoint).toMatchObject({ gameMode: 'pve', autoSync: true })
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
})
