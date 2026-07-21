const DB_NAME = "labtrack-offline";
const DB_VERSION = 2;
const TABLE_STORE = "tables";
const QUEUE_STORE = "queue";
const META_STORE = "meta";

const hasWindow = typeof window !== "undefined";
const hasIndexedDb = hasWindow && "indexedDB" in window;

let activeScope = "guest";
let dbPromise = null;
let status = {
  online: hasWindow ? navigator.onLine : true,
  syncing: false,
  pending: 0,
  lastSyncedAt: null,
  error: null,
  preparing: false,
  prepareProgress: 0,
  prepareMessage: "",
  offlineReady: false,
  lastPreparedAt: null,
  preparedRows: 0,
};
const listeners = new Set();

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function scopedTableKey(table) {
  return `${activeScope}:${table}`;
}

export function setOfflineScope(scope) {
  activeScope = String(scope || "guest");
  refreshPendingCount().catch(() => {});
}

export function getOfflineScope() {
  return activeScope;
}

function openDb() {
  if (!hasIndexedDb) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(TABLE_STORE)) {
        db.createObjectStore(TABLE_STORE, { keyPath: "table" });
      }

      let queueStore;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        queueStore = db.createObjectStore(QUEUE_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        queueStore.createIndex("createdAt", "createdAt");
      } else {
        queueStore = request.transaction.objectStore(QUEUE_STORE);
      }

      if (!queueStore.indexNames.contains("scope")) {
        queueStore.createIndex("scope", "scope", { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open offline storage."));
    request.onblocked = () => reject(new Error("Offline storage is blocked by another LabTrack tab."));
  });

  return dbPromise;
}

async function withStore(storeName, mode, operation) {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;

    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      if (!request) resolve(null);
      else resolve(request.result ?? null);
    };
    transaction.onerror = () => reject(transaction.error || request?.error || new Error("Offline storage transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Offline storage transaction was cancelled."));
  });
}

function emitStatus() {
  const snapshot = { ...status };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // A status listener must never break synchronization.
    }
  });

  if (hasWindow) {
    window.dispatchEvent(new CustomEvent("labtrack-sync-status", { detail: snapshot }));
  }
}

export function getSyncStatus() {
  return { ...status };
}

export function subscribeSyncStatus(listener) {
  listeners.add(listener);
  listener({ ...status });
  return () => listeners.delete(listener);
}

export function setSyncStatus(patch) {
  status = { ...status, ...patch };
  emitStatus();
}

export function isOnline() {
  return hasWindow ? navigator.onLine : true;
}

export function isNetworkError(error) {
  if (!isOnline()) return true;
  const text = String(
    error?.message ||
      error?.response?.message ||
      error?.type ||
      error ||
      ""
  ).toLowerCase();

  return (
    error instanceof TypeError ||
    text.includes("failed to fetch") ||
    text.includes("network") ||
    text.includes("offline") ||
    text.includes("connection") ||
    text.includes("load failed") ||
    text.includes("timeout")
  );
}

function rowId(row) {
  return String(row?.id || row?.$id || "");
}

function mergeRows(currentRows, incomingRows) {
  const map = new Map();
  (currentRows || []).forEach((row) => {
    const id = rowId(row);
    if (id) map.set(id, clone(row));
  });
  (incomingRows || []).forEach((row) => {
    const id = rowId(row);
    if (id) map.set(id, clone(row));
  });
  return [...map.values()];
}

export async function cacheRows(table, rows, { replace = false } = {}) {
  if (!hasIndexedDb || !table) return;
  const current = replace ? [] : await getCachedRows(table);
  const merged = replace ? clone(rows || []) : mergeRows(current, rows || []);
  const key = scopedTableKey(table);

  await withStore(TABLE_STORE, "readwrite", (store) =>
    store.put({
      table: key,
      logicalTable: table,
      scope: activeScope,
      rows: merged,
      updatedAt: new Date().toISOString(),
    })
  );
}

export async function getCachedRows(table) {
  if (!hasIndexedDb || !table) return [];
  const record = await withStore(TABLE_STORE, "readonly", (store) =>
    store.get(scopedTableKey(table))
  );
  return clone(record?.rows || []);
}

export async function getCachedRow(table, id) {
  const rows = await getRowsWithPending(table);
  return rows.find((row) => rowId(row) === String(id)) || null;
}

export async function removeCachedRows(table, ids) {
  const idSet = new Set((ids || []).map(String));
  const rows = (await getCachedRows(table)).filter((row) => !idSet.has(rowId(row)));
  await cacheRows(table, rows, { replace: true });
}

export async function enqueueMutation(operation) {
  if (!hasIndexedDb) {
    throw new Error("This browser does not support offline storage.");
  }

  const record = {
    ...clone(operation),
    scope: activeScope,
    createdAt: operation?.createdAt || new Date().toISOString(),
    attempts: Number(operation?.attempts || 0),
    lastError: operation?.lastError || null,
  };

  const id = await withStore(QUEUE_STORE, "readwrite", (store) => store.add(record));
  await refreshPendingCount();
  return { ...record, id };
}

export async function listQueuedMutations() {
  if (!hasIndexedDb) return [];
  const records = await withStore(QUEUE_STORE, "readonly", (store) => store.getAll());
  return (records || [])
    .filter((record) => String(record.scope || "guest") === activeScope)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

export async function deleteQueuedMutation(id) {
  if (!hasIndexedDb) return;
  await withStore(QUEUE_STORE, "readwrite", (store) => store.delete(id));
  await refreshPendingCount();
}

export async function updateQueuedMutation(id, patch) {
  if (!hasIndexedDb) return;
  const current = await withStore(QUEUE_STORE, "readonly", (store) => store.get(id));
  if (!current) return;
  await withStore(QUEUE_STORE, "readwrite", (store) =>
    store.put({ ...current, ...clone(patch), id })
  );
  await refreshPendingCount();
}

export async function refreshPendingCount() {
  if (!hasIndexedDb) {
    setSyncStatus({ pending: 0 });
    return 0;
  }

  const records = await withStore(QUEUE_STORE, "readonly", (store) => store.getAll());
  const count = (records || []).filter(
    (record) => String(record.scope || "guest") === activeScope
  ).length;

  setSyncStatus({ pending: Number(count || 0) });
  return Number(count || 0);
}

function applyDirectMutation(rows, operation) {
  const map = new Map((rows || []).map((row) => [rowId(row), clone(row)]));

  if (operation.kind === "insert") {
    (operation.rows || []).forEach((row) => {
      const id = rowId(row);
      if (id) map.set(id, { ...clone(row), _offlinePending: true });
    });
  }

  if (operation.kind === "update") {
    const ids = new Set((operation.ids || []).map(String));
    ids.forEach((id) => {
      const current = map.get(id);
      if (current) {
        map.set(id, {
          ...current,
          ...clone(operation.payload || {}),
          id: current.id || id,
          $id: current.$id || id,
          _offlinePending: true,
        });
      }
    });
  }

  if (operation.kind === "delete") {
    (operation.ids || []).forEach((id) => map.delete(String(id)));
  }

  return [...map.values()];
}

export async function getRowsWithPending(table) {
  let rows = await getCachedRows(table);
  const queue = await listQueuedMutations();
  queue
    .filter((operation) => operation.table === table)
    .forEach((operation) => {
      rows = applyDirectMutation(rows, operation);
    });
  return rows;
}

export async function setMeta(key, value) {
  if (!hasIndexedDb) return;
  await withStore(META_STORE, "readwrite", (store) =>
    store.put({ key, value: clone(value), updatedAt: new Date().toISOString() })
  );
}

export async function getMeta(key) {
  if (!hasIndexedDb) return null;
  const record = await withStore(META_STORE, "readonly", (store) => store.get(key));
  return clone(record?.value ?? null);
}

export async function deleteMeta(key) {
  if (!hasIndexedDb) return;
  await withStore(META_STORE, "readwrite", (store) => store.delete(key));
}

export async function clearCurrentScopeData() {
  if (!hasIndexedDb) return;
  const db = await openDb();
  if (!db) return;

  await new Promise((resolve, reject) => {
    const tx = db.transaction([TABLE_STORE, QUEUE_STORE], "readwrite");
    const tableStore = tx.objectStore(TABLE_STORE);
    const queueStore = tx.objectStore(QUEUE_STORE);

    const tableRequest = tableStore.getAllKeys();
    tableRequest.onsuccess = () => {
      (tableRequest.result || [])
        .filter((key) => String(key).startsWith(`${activeScope}:`))
        .forEach((key) => tableStore.delete(key));
    };

    const queueRequest = queueStore.getAll();
    queueRequest.onsuccess = () => {
      (queueRequest.result || [])
        .filter((row) => String(row.scope || "guest") === activeScope)
        .forEach((row) => queueStore.delete(row.id));
    };

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  setSyncStatus({ pending: 0, offlineReady: false, lastPreparedAt: null });
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // Persistence is a best-effort browser feature.
  }
  return false;
}

if (hasWindow) {
  window.addEventListener("online", () => {
    setSyncStatus({ online: true, error: null });
  });
  window.addEventListener("offline", () => {
    setSyncStatus({ online: false, syncing: false, preparing: false });
  });

  refreshPendingCount().catch(() => {});
  requestPersistentStorage().catch(() => {});
}
