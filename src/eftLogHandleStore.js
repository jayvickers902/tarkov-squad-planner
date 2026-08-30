const DB_NAME = 'tsp-eft-log-import'
// Bumped to 2 to add the import-job store. onupgradeneeded creates whichever
// stores are missing, so a browser holding a v1 database gains the new store
// without losing its directory handle or checkpoint.
const DB_VERSION = 2
const HANDLE_STORE = 'directory-handles'
const CHECKPOINT_STORE = 'checkpoints'
const JOB_STORE = 'import-jobs'
const DEFAULT_KEY = 'default'
const MAX_CHECKPOINT_FILES = 4096
const MAX_CHECKPOINT_FILENAME_LENGTH = 512
const MAX_CHECKPOINT_OFFSET = 32 * 1024 * 1024
const MAX_CHECKPOINT_FILE_BYTES = 32 * 1024 * 1024
const MAX_CHECKPOINT_TIMESTAMP = 8640000000000000

const VALID_MODES = new Set(['regular', 'pve'])

function getIndexedDb(indexedDBOverride) {
  if (indexedDBOverride !== undefined) return indexedDBOverride
  return typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined
}

function normaliseKey(key) {
  if (key === null || key === undefined || key === '') return DEFAULT_KEY
  return String(key).slice(0, 128)
}

function unsupportedError() {
  const error = new Error('Persistent folder access is not available in this browser.')
  error.code = 'INDEXED_DB_UNSUPPORTED'
  return error
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Local folder storage failed.'))
  })
}

function transactionToPromise(transaction, resultPromise) {
  return new Promise((resolve, reject) => {
    let result
    transaction.oncomplete = () => resolve(result)
    transaction.onerror = () => reject(transaction.error || new Error('Local folder storage failed.'))
    transaction.onabort = () => reject(transaction.error || new Error('Local folder storage was interrupted.'))
    resultPromise.then(value => { result = value }, reject)
  })
}

function sanitiseCheckpoint(checkpoint) {
  const input = checkpoint && typeof checkpoint === 'object' ? checkpoint : {}
  const files = Array.isArray(input.files)
    ? input.files.slice(0, MAX_CHECKPOINT_FILES).map(file => ({
      relativeFilename: String(file?.relativeFilename || '').slice(0, MAX_CHECKPOINT_FILENAME_LENGTH),
      size: Number.isFinite(file?.size) && file.size >= 0 ? Math.min(file.size, MAX_CHECKPOINT_FILE_BYTES) : 0,
      lastModified: Number.isFinite(file?.lastModified) && file.lastModified >= 0
        ? Math.min(file.lastModified, MAX_CHECKPOINT_TIMESTAMP)
        : 0,
      // parsedOffset is the last complete UTF-8 byte boundary. It is numeric
      // metadata only; unfinished JSON stays in memory and is never persisted.
      ...(Number.isSafeInteger(file?.parsedOffset) && file.parsedOffset >= 0
        ? { parsedOffset: Math.min(file.parsedOffset, MAX_CHECKPOINT_OFFSET) }
        : {}),
    })).filter(file => file.relativeFilename)
    : []

  const includedVersions = Array.isArray(input.includedVersions)
    ? [...new Set(input.includedVersions.map(version => String(version).slice(0, 64)).filter(Boolean))].slice(0, 64)
    : []

  const profileKey = input.profileKey == null ? null : String(input.profileKey).slice(0, 128)
  const unknownModeTarget = VALID_MODES.has(input.unknownModeTarget) ? input.unknownModeTarget : null
  const unknownModeTargets = input.unknownModeTargets && typeof input.unknownModeTargets === 'object'
    ? Object.fromEntries(Object.entries(input.unknownModeTargets)
      .slice(0, 4096)
      .filter(([, mode]) => VALID_MODES.has(mode))
      .map(([sessionKey, mode]) => [String(sessionKey).slice(0, 160), mode]))
    : {}
  const gameMode = VALID_MODES.has(input.gameMode) ? input.gameMode : null

  return {
    version: 1,
    files,
    includedVersions,
    profileKey,
    unknownModeTarget,
    unknownModeTargets,
    gameMode,
    autoSync: input.autoSync === true,
    ...(input.watchSessionKey == null ? {} : { watchSessionKey: String(input.watchSessionKey).slice(0, 160) }),
    ...(input.watchMap == null ? {} : { watchMap: String(input.watchMap).slice(0, 64) }),
    updatedAt: Number.isFinite(input.updatedAt)
      ? Math.min(Math.max(input.updatedAt, 0), MAX_CHECKPOINT_TIMESTAMP)
      : Date.now(),
  }
}

export function isIndexedDbSupported(environment = globalThis) {
  return Boolean(environment && environment.indexedDB)
}

export function createEftLogHandleStore({
  indexedDB: indexedDBOverride,
  dbName = DB_NAME,
} = {}) {
  const indexedDB = getIndexedDb(indexedDBOverride)
  let databasePromise

  function openDatabase() {
    if (!indexedDB) return Promise.reject(unsupportedError())
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        let request
        try {
          request = indexedDB.open(dbName, DB_VERSION)
        } catch (error) {
          reject(new Error('Local folder storage is unavailable.'))
          return
        }
        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(HANDLE_STORE)) database.createObjectStore(HANDLE_STORE, { keyPath: 'key' })
          if (!database.objectStoreNames.contains(CHECKPOINT_STORE)) database.createObjectStore(CHECKPOINT_STORE, { keyPath: 'key' })
          if (!database.objectStoreNames.contains(JOB_STORE)) database.createObjectStore(JOB_STORE, { keyPath: 'jobId' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error || new Error('Local folder storage is unavailable.'))
        request.onblocked = () => reject(new Error('Local folder storage is busy.'))
      }).catch(error => {
        databasePromise = undefined
        throw error
      })
    }
    return databasePromise
  }

  async function withStore(storeName, mode, callback) {
    const database = await openDatabase()
    const transaction = database.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    return transactionToPromise(transaction, Promise.resolve(callback(store)))
  }

  return {
    async saveHandle(key, handle) {
      if (!handle) throw new Error('A folder handle is required.')
      const item = { key: normaliseKey(key), handle }
      await withStore(HANDLE_STORE, 'readwrite', store => requestToPromise(store.put(item)))
    },

    async loadHandle(key) {
      const item = await withStore(HANDLE_STORE, 'readonly', store => requestToPromise(store.get(normaliseKey(key))))
      return item?.handle || null
    },

    async deleteHandle(key) {
      await withStore(HANDLE_STORE, 'readwrite', store => requestToPromise(store.delete(normaliseKey(key))))
    },

    async saveCheckpoint(key, checkpoint) {
      const item = { key: normaliseKey(key), checkpoint: sanitiseCheckpoint(checkpoint) }
      await withStore(CHECKPOINT_STORE, 'readwrite', store => requestToPromise(store.put(item)))
    },

    async loadCheckpoint(key) {
      const item = await withStore(CHECKPOINT_STORE, 'readonly', store => requestToPromise(store.get(normaliseKey(key))))
      return item?.checkpoint || null
    },

    async deleteCheckpoint(key) {
      await withStore(CHECKPOINT_STORE, 'readwrite', store => requestToPromise(store.delete(normaliseKey(key))))
    },

    // Job persistence is what lets an interrupted import resume. The names below
    // are the ones createQuestLogImportJob's storage lookup accepts, so this
    // object can be handed to it directly as its store.
    async saveJob(job) {
      if (!job || typeof job !== 'object' || !job.jobId) throw new Error('A quest log import job is required.')
      await withStore(JOB_STORE, 'readwrite', store => requestToPromise(store.put(job)))
    },

    async listJobs() {
      const items = await withStore(JOB_STORE, 'readonly', store => requestToPromise(store.getAll()))
      return Array.isArray(items) ? items : []
    },

    async deleteJob(jobId) {
      await withStore(JOB_STORE, 'readwrite', store => requestToPromise(store.delete(String(jobId))))
    },

    async forget(key) {
      await Promise.all([this.deleteHandle(key), this.deleteCheckpoint(key)])
    },
  }
}

const defaultStore = createEftLogHandleStore()

export function saveEftLogDirectoryHandle(handle, key) {
  return defaultStore.saveHandle(key, handle)
}

export function loadEftLogDirectoryHandle(key) {
  return defaultStore.loadHandle(key)
}

export function deleteEftLogDirectoryHandle(key) {
  return defaultStore.deleteHandle(key)
}

export function saveEftLogCheckpoint(checkpoint, key) {
  return defaultStore.saveCheckpoint(key, checkpoint)
}

export function loadEftLogCheckpoint(key) {
  return defaultStore.loadCheckpoint(key)
}

export function deleteEftLogCheckpoint(key) {
  return defaultStore.deleteCheckpoint(key)
}

export {
  CHECKPOINT_STORE,
  DB_NAME,
  HANDLE_STORE,
  MAX_CHECKPOINT_FILES,
  MAX_CHECKPOINT_FILENAME_LENGTH,
  MAX_CHECKPOINT_OFFSET,
  MAX_CHECKPOINT_FILE_BYTES,
  MAX_CHECKPOINT_TIMESTAMP,
  sanitiseCheckpoint,
}
