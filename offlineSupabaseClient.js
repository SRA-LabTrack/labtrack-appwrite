import {
  isSupabaseConfigured,
  supabase as onlineSupabase,
} from "./supabaseClient";

export { isSupabaseConfigured };

const DB_NAME = "labtrack-offline-v1";
const DB_VERSION = 1;
const RECORD_STORE = "records";
const QUEUE_STORE = "queue";
const META_STORE = "meta";
const SYNC_EVENT = "labtrack-offline-sync";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let databasePromise = null;
let syncPromise = null;

const listeners = new Set();
let state = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  lastSyncedAt: null,
  lastError: "",
};

function emitState(patch = {}) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => {
    try {
      listener({ ...state });
    } catch {
      // A status listener must never stop syncing.
    }
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SYNC_EVENT, { detail: { ...state } })
    );
  }
}

function openOfflineDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(RECORD_STORE)) {
        db.createObjectStore(RECORD_STORE, { keyPath: "table" });
      }

      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const queue = db.createObjectStore(QUEUE_STORE, {
          keyPath: "queueId",
          autoIncrement: true,
        });
        queue.createIndex("createdAt", "createdAt");
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

async function useStore(storeName, mode, callback) {
  const db = await openOfflineDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    let result;
    try {
      result = callback(store, tx);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRecordCache(table) {
  try {
    const db = await openOfflineDatabase();
    const tx = db.transaction(RECORD_STORE, "readonly");
    const value = await requestResult(tx.objectStore(RECORD_STORE).get(table));
    return value || { table, rows: [], updatedAt: null };
  } catch {
    return { table, rows: [], updatedAt: null };
  }
}

async function writeRecordCache(table, rows) {
  const unique = new Map();

  (rows || []).forEach((row) => {
    const id = row?.id || row?.$id;
    if (id) unique.set(String(id), row);
  });

  const value = {
    table,
    rows: [...unique.values()],
    updatedAt: new Date().toISOString(),
  };

  await useStore(RECORD_STORE, "readwrite", (store) => store.put(value));
  return value.rows;
}

async function mergeRecordCache(table, rows) {
  const cached = await readRecordCache(table);
  const merged = new Map();

  cached.rows.forEach((row) => {
    const id = row?.id || row?.$id;
    if (id) merged.set(String(id), row);
  });

  (rows || []).forEach((row) => {
    const id = row?.id || row?.$id;
    if (id) merged.set(String(id), { ...merged.get(String(id)), ...row });
  });

  return writeRecordCache(table, [...merged.values()]);
}

async function deleteCachedRows(table, ids) {
  const idSet = new Set((ids || []).map(String));
  const cached = await readRecordCache(table);
  const remaining = cached.rows.filter(
    (row) => !idSet.has(String(row?.id || row?.$id))
  );
  await writeRecordCache(table, remaining);
}

async function countQueue() {
  try {
    const db = await openOfflineDatabase();
    const tx = db.transaction(QUEUE_STORE, "readonly");
    return await requestResult(tx.objectStore(QUEUE_STORE).count());
  } catch {
    return 0;
  }
}

async function addQueueItem(item) {
  await useStore(QUEUE_STORE, "readwrite", (store) =>
    store.add({
      ...item,
      createdAt: new Date().toISOString(),
      attempts: 0,
    })
  );
  emitState({ pending: await countQueue() });
}

async function listQueue() {
  const db = await openOfflineDatabase();
  const tx = db.transaction(QUEUE_STORE, "readonly");
  return (await requestResult(tx.objectStore(QUEUE_STORE).getAll())).sort(
    (a, b) => Number(a.queueId) - Number(b.queueId)
  );
}

async function removeQueueItem(queueId) {
  await useStore(QUEUE_STORE, "readwrite", (store) => store.delete(queueId));
}

async function updateQueueItem(item) {
  await useStore(QUEUE_STORE, "readwrite", (store) => store.put(item));
}

function makeOfflineId() {
  const random =
    globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 24) ||
    `${Date.now()}${Math.random().toString(16).slice(2)}`.slice(0, 24);

  return `offline_${random}`;
}

function onlineNow() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function networkFailure(error) {
  if (!onlineNow()) return true;

  const text = String(
    error?.message || error?.response?.message || error?.type || error || ""
  ).toLowerCase();

  return [
    "failed to fetch",
    "network",
    "offline",
    "load failed",
    "timeout",
    "connection",
    "internet",
  ].some((part) => text.includes(part));
}

function successful(result) {
  return result && !result.error;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getRowValue(row, field) {
  return field === "id" ? row?.id || row?.$id : row?.[field];
}

function compareValues(a, b, ascending = true) {
  const av = a ?? "";
  const bv = b ?? "";
  const an = Number(av);
  const bn = Number(bv);

  const result =
    Number.isFinite(an) &&
    Number.isFinite(bn) &&
    String(av).trim() !== "" &&
    String(bv).trim() !== ""
      ? an - bn
      : String(av).localeCompare(String(bv));

  return ascending ? result : -result;
}

function applyLocalQuery(rows, query) {
  let result = [...(rows || [])];

  query.filters.forEach(({ field, value }) => {
    result = result.filter((row) => {
      const rowValue = getRowValue(row, field);

      if (value === null) {
        return rowValue === null || rowValue === undefined || rowValue === "";
      }

      return String(rowValue ?? "") === String(value);
    });
  });

  query.searchFilters.forEach(({ field, term }) => {
    result = result.filter((row) =>
      String(getRowValue(row, field) ?? "")
        .toLowerCase()
        .includes(term)
    );
  });

  if (query.orFilters.length) {
    result = result.filter((row) =>
      query.orFilters.some(({ field, term }) =>
        String(getRowValue(row, field) ?? "")
          .toLowerCase()
          .includes(term)
      )
    );
  }

  if (query.orderBy) {
    result.sort((a, b) =>
      compareValues(
        getRowValue(a, query.orderBy.field),
        getRowValue(b, query.orderBy.field),
        query.orderBy.ascending
      )
    );
  }

  const fullCount = result.length;

  if (query.rangeStart !== null && query.rangeEnd !== null) {
    result = result.slice(query.rangeStart, query.rangeEnd + 1);
  } else if (query.limitValue) {
    result = result.slice(0, query.limitValue);
  }

  return { rows: result, count: fullCount };
}

function applyCalls(builder, query, includeMutation = true) {
  builder = builder.select("*", query.selectOptions);

  query.filters.forEach(({ field, value }) => {
    builder = builder.eq(field, value);
  });

  query.searchFilters.forEach(({ field, original }) => {
    builder = builder.ilike(field, original);
  });

  if (query.orExpression) builder = builder.or(query.orExpression);
  if (query.orderBy) {
    builder = builder.order(query.orderBy.field, {
      ascending: query.orderBy.ascending,
    });
  }
  if (query.rangeStart !== null && query.rangeEnd !== null) {
    builder = builder.range(query.rangeStart, query.rangeEnd);
  } else if (query.limitValue) {
    builder = builder.limit(query.limitValue);
  }
  if (query.wantSingle) builder = builder.single();
  if (query.wantMaybeSingle) builder = builder.maybeSingle();

  if (!includeMutation) return builder;
  if (query.operation === "update") return builder.update(query.payload);
  if (query.operation === "delete") return builder.delete();
  if (query.operation === "insert") return builder.insert(query.payload);
  return builder;
}

async function executeOnlineQuery(table, query) {
  const builder = applyCalls(onlineSupabase.from(table), query);
  return await builder;
}

async function optimisticInsert(table, payload) {
  const items = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
    ...clone(row),
    id: row?.id || makeOfflineId(),
    $offline: true,
    $syncStatus: "pending",
    $createdAt: row?.$createdAt || new Date().toISOString(),
  }));

  await mergeRecordCache(table, items);
  return Array.isArray(payload) ? items : items[0];
}

async function optimisticUpdate(table, query) {
  const cached = await readRecordCache(table);
  const selected = applyLocalQuery(cached.rows, {
    ...query,
    rangeStart: null,
    rangeEnd: null,
    limitValue: null,
  }).rows;

  const ids = new Set(selected.map((row) => String(row.id || row.$id)));
  const updated = cached.rows.map((row) =>
    ids.has(String(row.id || row.$id))
      ? {
          ...row,
          ...clone(query.payload),
          $offline: true,
          $syncStatus: "pending",
        }
      : row
  );

  await writeRecordCache(table, updated);
  return updated.filter((row) => ids.has(String(row.id || row.$id)));
}

async function optimisticDelete(table, query) {
  const cached = await readRecordCache(table);
  const selected = applyLocalQuery(cached.rows, {
    ...query,
    rangeStart: null,
    rangeEnd: null,
    limitValue: null,
  }).rows;

  await deleteCachedRows(
    table,
    selected.map((row) => row.id || row.$id)
  );

  return selected;
}

class OfflineQueryBuilder {
  constructor(table) {
    this.table = table;
    this.operation = "select";
    this.payload = null;
    this.filters = [];
    this.searchFilters = [];
    this.orFilters = [];
    this.orExpression = "";
    this.orderBy = null;
    this.rangeStart = null;
    this.rangeEnd = null;
    this.limitValue = null;
    this.wantSingle = false;
    this.wantMaybeSingle = false;
    this.selectOptions = {};
    this.headOnly = false;
  }

  select(_columns = "*", options = {}) {
    this.selectOptions = options || {};
    this.headOnly = Boolean(options?.head);
    return this;
  }

  eq(field, value) {
    this.filters.push({ field, value });
    return this;
  }

  ilike(field, pattern) {
    this.searchFilters.push({
      field,
      original: pattern,
      term: String(pattern || "").replaceAll("%", "").toLowerCase(),
    });
    return this;
  }

  or(expression) {
    this.orExpression = String(expression || "");
    this.orFilters = this.orExpression
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [field, _op, ...rest] = part.split(".");
        return {
          field,
          term: rest.join(".").replaceAll("%", "").toLowerCase(),
        };
      });
    return this;
  }

  order(field, options = {}) {
    this.orderBy = {
      field,
      ascending: options?.ascending !== false,
    };
    return this;
  }

  range(start, end) {
    this.rangeStart = Number(start || 0);
    this.rangeEnd = Number(end ?? start ?? 0);
    return this;
  }

  limit(value) {
    this.limitValue = Number(value || 0);
    return this;
  }

  single() {
    this.wantSingle = true;
    return this;
  }

  maybeSingle() {
    this.wantMaybeSingle = true;
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.payload = clone(payload);
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  insert(payload) {
    this.operation = "insert";
    this.payload = clone(payload);
    return this.execute();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  catch(reject) {
    return this.execute().catch(reject);
  }

  serializable() {
    return {
      operation: this.operation,
      payload: clone(this.payload),
      filters: clone(this.filters),
      searchFilters: clone(this.searchFilters),
      orFilters: clone(this.orFilters),
      orExpression: this.orExpression,
      orderBy: clone(this.orderBy),
      rangeStart: this.rangeStart,
      rangeEnd: this.rangeEnd,
      limitValue: this.limitValue,
      wantSingle: this.wantSingle,
      wantMaybeSingle: this.wantMaybeSingle,
      selectOptions: clone(this.selectOptions),
      headOnly: this.headOnly,
    };
  }

  async executeSelect() {
    const query = this.serializable();

    if (onlineNow()) {
      try {
        const result = await executeOnlineQuery(this.table, query);

        if (successful(result)) {
          const data = result.data;
          const rows = Array.isArray(data)
            ? data
            : data
              ? [data]
              : [];

          if (rows.length) await mergeRecordCache(this.table, rows);
          emitState({ online: true, lastError: "" });
          return result;
        }

        if (!networkFailure(result?.error)) return result;
      } catch (error) {
        if (!networkFailure(error)) {
          return {
            data: null,
            error: { message: error?.message || "Appwrite request failed." },
          };
        }
      }
    }

    const cached = await readRecordCache(this.table);
    const local = applyLocalQuery(cached.rows, query);
    const selected =
      this.wantSingle || this.wantMaybeSingle
        ? local.rows[0] || null
        : this.headOnly
          ? null
          : local.rows;

    emitState({
      online: false,
      lastError: "Offline. Showing saved data.",
    });

    return {
      data: selected,
      error: null,
      count: local.count,
      offline: true,
      cachedAt: cached.updatedAt,
    };
  }

  async executeMutation() {
    const query = this.serializable();

    if (onlineNow()) {
      try {
        const result = await executeOnlineQuery(this.table, query);

        if (successful(result)) {
          if (this.operation === "insert") {
            const rows = Array.isArray(result.data)
              ? result.data
              : result.data
                ? [result.data]
                : [];
            await mergeRecordCache(this.table, rows);
          } else if (this.operation === "update") {
            const rows = Array.isArray(result.data)
              ? result.data
              : result.data
                ? [result.data]
                : [];
            if (rows.length) await mergeRecordCache(this.table, rows);
          } else if (this.operation === "delete") {
            const selected = await optimisticDelete(this.table, query);
            await deleteCachedRows(
              this.table,
              selected.map((row) => row.id || row.$id)
            );
          }

          return result;
        }

        if (!networkFailure(result?.error)) return result;
      } catch (error) {
        if (!networkFailure(error)) {
          return {
            data: null,
            error: { message: error?.message || "Appwrite request failed." },
          };
        }
      }
    }

    let optimisticData = null;

    if (this.operation === "insert") {
      optimisticData = await optimisticInsert(this.table, this.payload);
      query.payload = clone(optimisticData);
    } else if (this.operation === "update") {
      optimisticData = await optimisticUpdate(this.table, query);
    } else if (this.operation === "delete") {
      optimisticData = await optimisticDelete(this.table, query);
    }

    await addQueueItem({
      kind: "query",
      table: this.table,
      query,
    });

    emitState({
      online: false,
      lastError: "Saved on this device. Waiting to sync.",
    });

    return {
      data: optimisticData,
      error: null,
      offline: true,
      queued: true,
    };
  }

  async execute() {
    if (!isSupabaseConfigured) {
      return {
        data: null,
        error: { message: "Appwrite is not configured." },
      };
    }

    return this.operation === "select"
      ? this.executeSelect()
      : this.executeMutation();
  }
}

async function replayQuery(item) {
  const result = await executeOnlineQuery(item.table, item.query);
  if (!successful(result)) {
    throw new Error(result?.error?.message || "Unable to synchronize a saved change.");
  }

  const data = result.data;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length) await mergeRecordCache(item.table, rows);
}

async function replayRpc(item) {
  const result = await onlineSupabase.rpc(item.name, item.args || {});
  if (!successful(result)) {
    throw new Error(result?.error?.message || "Unable to synchronize a saved action.");
  }
}

async function flushQueue() {
  if (syncPromise) return syncPromise;
  if (!onlineNow() || !onlineSupabase) return { synced: 0, pending: await countQueue() };

  syncPromise = (async () => {
    emitState({ syncing: true, online: true, lastError: "" });

    let synced = 0;
    const items = await listQueue();

    for (const item of items) {
      try {
        if (item.kind === "query") await replayQuery(item);
        if (item.kind === "rpc") await replayRpc(item);

        await removeQueueItem(item.queueId);
        synced += 1;
      } catch (error) {
        const updated = {
          ...item,
          attempts: Number(item.attempts || 0) + 1,
          lastError: error?.message || "Synchronization failed.",
        };
        await updateQueueItem(updated);

        if (networkFailure(error)) break;

        // Keep the failed item so the user can retry after resolving a
        // permission or validation issue, but continue with later items.
      }
    }

    const pending = await countQueue();
    const lastSyncedAt = new Date().toISOString();

    await useStore(META_STORE, "readwrite", (store) =>
      store.put({ key: "lastSync", value: lastSyncedAt })
    );

    emitState({
      syncing: false,
      online: onlineNow(),
      pending,
      lastSyncedAt,
      lastError: pending
        ? "Some saved changes still need attention."
        : "",
    });

    return { synced, pending };
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

async function cachedSession() {
  try {
    const db = await openOfflineDatabase();
    const tx = db.transaction(META_STORE, "readonly");
    return (await requestResult(tx.objectStore(META_STORE).get("session")))?.value || null;
  } catch {
    return null;
  }
}

async function saveSession(session) {
  await useStore(META_STORE, "readwrite", (store) =>
    store.put({ key: "session", value: clone(session) })
  );
}

const auth = {
  ...onlineSupabase?.auth,

  async getSession() {
    if (onlineNow()) {
      try {
        const result = await onlineSupabase.auth.getSession();
        const session = result?.data?.session || result?.data?.data?.session || null;
        if (session) await saveSession(session);
        if (successful(result)) return result;
      } catch {
        // Fall back to the last successful local session.
      }
    }

    const session = await cachedSession();
    return {
      data: { session },
      error: null,
      offline: true,
    };
  },

  async signInWithPassword(credentials) {
    if (!onlineNow()) {
      return {
        data: null,
        error: {
          message:
            "The first login on a device requires internet. Reconnect and sign in once, then cached data can be opened offline.",
        },
      };
    }

    const result = await onlineSupabase.auth.signInWithPassword(credentials);
    const session = result?.data?.session || null;
    if (session) await saveSession(session);
    return result;
  },

  async signUp(details) {
    if (!onlineNow()) {
      return {
        data: null,
        error: { message: "Creating an account requires internet." },
      };
    }

    const result = await onlineSupabase.auth.signUp(details);
    const session = result?.data?.session || null;
    if (session) await saveSession(session);
    return result;
  },

  async signOut() {
    const result = onlineNow()
      ? await onlineSupabase.auth.signOut()
      : { data: null, error: null, offline: true };

    await useStore(META_STORE, "readwrite", (store) =>
      store.delete("session")
    );

    return result;
  },
};

export const supabase = isSupabaseConfigured
  ? {
      auth,

      from(table) {
        return new OfflineQueryBuilder(table);
      },

      async rpc(name, args = {}) {
        if (onlineNow()) {
          try {
            const result = await onlineSupabase.rpc(name, args);
            if (successful(result)) return result;
            if (!networkFailure(result?.error)) return result;
          } catch (error) {
            if (!networkFailure(error)) {
              return {
                data: null,
                error: { message: error?.message || "Appwrite action failed." },
              };
            }
          }
        }

        await addQueueItem({
          kind: "rpc",
          name,
          args: clone(args),
        });

        emitState({
          online: false,
          lastError: "Action saved on this device. Waiting to sync.",
        });

        return {
          data: { queued: true },
          error: null,
          offline: true,
          queued: true,
        };
      },

      channel(name) {
        return onlineSupabase.channel(name);
      },

      removeChannel(channel) {
        return onlineSupabase.removeChannel(channel);
      },
    }
  : null;

export const offlineSync = {
  getSnapshot() {
    return { ...state };
  },

  subscribe(listener) {
    listeners.add(listener);
    listener({ ...state });
    return () => listeners.delete(listener);
  },

  syncNow() {
    return flushQueue();
  },

  async clearLocalData() {
    const db = await openOfflineDatabase();

    await Promise.all(
      [RECORD_STORE, QUEUE_STORE, META_STORE].map(
        (storeName) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).clear();
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
          })
      )
    );

    emitState({
      pending: 0,
      lastSyncedAt: null,
      lastError: "",
    });
  },
};

async function initializeOfflineSync() {
  emitState({
    online: onlineNow(),
    pending: await countQueue(),
  });

  if (typeof window === "undefined") return;

  window.addEventListener("online", () => {
    emitState({ online: true, lastError: "" });
    flushQueue();
  });

  window.addEventListener("offline", () => {
    emitState({
      online: false,
      syncing: false,
      lastError: "Offline. Changes will be saved on this device.",
    });
  });

  window.addEventListener("focus", () => {
    if (onlineNow()) flushQueue();
  });

  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "LABTRACK_CONNECTIVITY_RESTORED") {
      flushQueue();
    }
  });

  if (onlineNow()) flushQueue();
}

initializeOfflineSync();
