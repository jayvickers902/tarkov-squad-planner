const DB_NAME = 'tsp-rest-cache'
const STORE_NAME = 'datasets'
const DB_VERSION = 1
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const LEGACY_PREFIXES = ['tsp.cache.rest.', 'tsp.cache.']

// Increment this when the adapted REST dataset shape changes. Unlike the old
// localStorage comment, this invalidates values that are already in a browser.
export const CACHE_SCHEMA_VERSION = 2

let dbPromise
let legacyCleanupPromise

function getIndexedDb() {
  return typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined
}

function openDatabase() {
  if (dbPromise) return dbPromise
  const indexedDB = getIndexedDb()
  if (!indexedDB) return Promise.resolve(null)

  dbPromise = new Promise(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
        } catch {
          // A blocked or partially implemented IndexedDB is just a cache miss.
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  }).catch(() => null)
  return dbPromise
}

export function dropLegacyKeys() {
  return Promise.resolve().then(() => {
    try {
      const keys = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key && LEGACY_PREFIXES.some(prefix => key.startsWith(prefix))) keys.push(key)
      }
      keys.forEach(key => localStorage.removeItem(key))
    } catch {
      // Storage is optional, including in private-browsing modes.
    }
  }).catch(() => undefined)
}

function ensureLegacyCleanup() {
  if (!legacyCleanupPromise) legacyCleanupPromise = dropLegacyKeys()
  return legacyCleanupPromise
}

function readFromDb(db, key) {
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
      request.onsuccess = () => {
        const entry = request.result
        if (entry?.v !== 1 || entry.schemaVersion !== CACHE_SCHEMA_VERSION || !Number.isFinite(entry.savedAt) || entry.data == null) {
          resolve(null)
          return
        }
        resolve(Date.now() - entry.savedAt > CACHE_TTL ? null : { data: entry.data, savedAt: entry.savedAt })
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  }).catch(() => null)
}

function writeToDb(db, key, data) {
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({
        v: 1,
        schemaVersion: CACHE_SCHEMA_VERSION,
        savedAt: Date.now(),
        data,
      }, key)
      request.onsuccess = () => resolve(undefined)
      request.onerror = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  }).catch(() => undefined)
}

export async function readCached(key) {
  await ensureLegacyCleanup()
  const db = await openDatabase()
  return db ? readFromDb(db, key) : null
}

export async function writeCached(key, data) {
  await ensureLegacyCleanup()
  const db = await openDatabase()
  if (db) await writeToDb(db, key, data)
}
