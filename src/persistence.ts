import { LEGACY_DOCS_KEY, normalizeDocs, seedDocs, type Doc, type StoredDoc } from './store'

const DATABASE = 'writer'
const STORE = 'docs'

export interface Library {
  kind: 'indexeddb' | 'localStorage'
  docs: Doc[]
  save(changed: Doc[], removed: string[], all: Doc[]): Promise<void>
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function completion(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('The save was cancelled.', 'AbortError'))
  })
}

function openDatabase() {
  const req = indexedDB.open(DATABASE, 1)
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
  return request(req)
}

function readLegacy(): Doc[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_DOCS_KEY)
    return raw ? normalizeDocs(JSON.parse(raw) as StoredDoc[]) : null
  } catch {
    return null
  }
}

async function indexedLibrary(): Promise<Library> {
  const db = await openDatabase()
  const put = async (changed: Doc[], removed: string[]) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const doc of changed) store.put(doc)
    for (const id of removed) store.delete(id)
    await completion(tx)
  }

  let docs = normalizeDocs(await request(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<StoredDoc[]>))
  if (!docs.length) {
    const legacy = readLegacy()
    docs = legacy ?? seedDocs()
    await put(docs, [])
    if (legacy) localStorage.removeItem(LEGACY_DOCS_KEY)
  }
  navigator.storage?.persist?.().catch(() => {})
  return { kind: 'indexeddb', docs, save: (changed, removed) => put(changed, removed) }
}

function localLibrary(): Library {
  return {
    kind: 'localStorage',
    docs: readLegacy() ?? seedDocs(),
    async save(_changed, _removed, all) {
      localStorage.setItem(LEGACY_DOCS_KEY, JSON.stringify(all))
    },
  }
}

export async function openLibrary(): Promise<Library> {
  try {
    return await indexedLibrary()
  } catch {
    return localLibrary()
  }
}

export function describeSaveError(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'QuotaExceededError') return 'The browser’s storage for this site is full.'
  if (name === 'InvalidStateError' || name === 'SecurityError') return 'The browser isn’t allowing this site to store data.'
  return 'The browser refused to store the latest changes.'
}
