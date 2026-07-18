import { Account, Client, Databases, ID, Query } from "appwrite";

const appwriteEndpoint = import.meta.env.VITE_APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
const appwriteProjectId = import.meta.env.VITE_APPWRITE_PROJECT_ID;
const appwriteDatabaseId = import.meta.env.VITE_APPWRITE_DATABASE_ID || "labtrack";

export const isAppwriteConfigured = Boolean(appwriteEndpoint && appwriteProjectId && appwriteDatabaseId);

// Kept with the old name so the existing App.jsx can stay almost unchanged.
export const isSupabaseConfigured = isAppwriteConfigured;

const COLLECTIONS = {
  profiles: "profiles",
  materials: "materials",
  logs: "logs",
  chats: "chats",
  item_requests: "item_requests",
  material_borrows: "material_borrows",
  suppliers: "suppliers",
  restock_requests: "restock_requests",
  culture_logs: "culture_logs",
  maintenance_requests: "maintenance_requests",
};

const client = isAppwriteConfigured
  ? new Client().setEndpoint(appwriteEndpoint).setProject(appwriteProjectId)
  : null;

const account = client ? new Account(client) : null;
const databases = client ? new Databases(client) : null;

const isoNow = () => new Date().toISOString();
const todayYmd = () => new Date().toISOString().slice(0, 10);

function toError(error, fallback = "Appwrite request failed.") {
  return {
    message:
      error?.message ||
      error?.response?.message ||
      error?.type ||
      fallback,
  };
}

function ok(data = null, extra = {}) {
  return { data, error: null, ...extra };
}

function fail(error) {
  return { data: null, error: toError(error) };
}

function collectionFor(table) {
  const collectionId = COLLECTIONS[table];
  if (!collectionId) throw new Error(`Missing Appwrite collection mapping for ${table}`);
  return collectionId;
}

function cleanPayload(payload) {
  const out = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (key === "id" || key.startsWith("$") || value === undefined) return;
    out[key] = value;
  });
  return out;
}

function mapDocument(document) {
  if (!document) return document;
  const { $id, $createdAt, $updatedAt, $permissions, $databaseId, $collectionId, ...rest } = document;
  return {
    id: rest.id || $id,
    ...rest,
    $id,
    $createdAt,
    $updatedAt,
    $permissions,
    $databaseId,
    $collectionId,
  };
}

function mapUser(user) {
  if (!user) return null;
  return {
    id: user.$id || user.id,
    email: user.email,
    user_metadata: {
      full_name: user.name || user.email,
    },
  };
}

async function getCurrentUser() {
  try {
    const user = await account.get();
    return mapUser(user);
  } catch {
    return null;
  }
}

async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return { user: null, profile: null };
  try {
    const profile = await databases.getDocument(appwriteDatabaseId, COLLECTIONS.profiles, user.id);
    return { user, profile: mapDocument(profile) };
  } catch {
    return { user, profile: null };
  }
}

function compareValues(a, b, ascending = true) {
  const av = a ?? "";
  const bv = b ?? "";
  const an = Number(av);
  const bn = Number(bv);
  let result;
  if (Number.isFinite(an) && Number.isFinite(bn) && String(av).trim() !== "" && String(bv).trim() !== "") {
    result = an - bn;
  } else {
    result = String(av).localeCompare(String(bv));
  }
  return ascending ? result : -result;
}

function ymdToTime(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text;
  const ms = new Date(normalized).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function daysUntil(value) {
  const target = ymdToTime(value);
  if (target === null) return null;
  const today = new Date(`${todayYmd()}T00:00:00`).getTime();
  return Math.ceil((target - today) / 86400000);
}

function expiryKind(material) {
  const days = daysUntil(material?.expires_at);
  if (days === null) return "none";
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "good";
}

function stockKind(material) {
  const qty = Number(material?.qty || 0);
  const threshold = Number(material?.threshold || 0);
  if (threshold > 0 && qty <= threshold * 0.5) return "critical";
  if (threshold > 0 && qty <= threshold) return "warning";
  return "ok";
}

function maintenanceKind(material) {
  const days = daysUntil(material?.maintenance_due_at);
  if (days === null) return "none";
  if (days < 0) return "overdue";
  if (days <= 30) return "due";
  return "good";
}

function isOverdueBorrow(row) {
  const days = daysUntil(row?.due_at);
  return row?.status === "active" && days !== null && days < 0;
}

async function listCollection(table, queries = []) {
  const response = await databases.listDocuments(appwriteDatabaseId, collectionFor(table), queries);
  return (response.documents || []).map(mapDocument);
}

async function getById(table, id) {
  const document = await databases.getDocument(appwriteDatabaseId, collectionFor(table), id);
  return mapDocument(document);
}

async function createRow(table, payload, documentId = ID.unique()) {
  const data = cleanPayload(payload);
  const document = await databases.createDocument(appwriteDatabaseId, collectionFor(table), documentId, data);
  return mapDocument(document);
}

async function updateRow(table, id, payload) {
  const document = await databases.updateDocument(appwriteDatabaseId, collectionFor(table), id, cleanPayload(payload));
  return mapDocument(document);
}

async function deleteRow(table, id) {
  await databases.deleteDocument(appwriteDatabaseId, collectionFor(table), id);
  return null;
}

class AppwriteQueryBuilder {
  constructor(table) {
    this.table = table;
    this.operation = "select";
    this.filters = [];
    this.searchFilters = [];
    this.orFilters = [];
    this.orderBy = null;
    this.rangeStart = null;
    this.rangeEnd = null;
    this.limitValue = null;
    this.payload = null;
    this.wantSingle = false;
    this.wantMaybeSingle = false;
    this.wantCount = false;
    this.headOnly = false;
  }

  select(_columns = "*", options = {}) {
    this.operation = "select";
    this.wantCount = options?.count === "exact";
    this.headOnly = Boolean(options?.head);
    return this;
  }

  eq(field, value) {
    this.filters.push({ type: "eq", field, value });
    return this;
  }

  ilike(field, pattern) {
    this.searchFilters.push({ field, term: String(pattern || "").replaceAll("%", "").toLowerCase() });
    return this;
  }

  or(expression) {
    const parts = String(expression || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    this.orFilters.push(
      ...parts.map((part) => {
        const [field, op, ...rest] = part.split(".");
        return { field, op, term: rest.join(".").replaceAll("%", "").toLowerCase() };
      })
    );
    return this;
  }

  order(field, options = {}) {
    this.orderBy = { field, ascending: options?.ascending !== false };
    return this;
  }

  range(start, end) {
    this.rangeStart = Number(start || 0);
    this.rangeEnd = Number(end || start || 0);
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
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  insert(payload) {
    this.operation = "insert";
    this.payload = payload;
    return this.execute();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  catch(reject) {
    return this.execute().catch(reject);
  }

  getIdFilter() {
    return this.filters.find((filter) => filter.type === "eq" && filter.field === "id");
  }

  applyClientFilters(rows) {
    let filtered = [...rows];

    this.filters.forEach((filter) => {
      filtered = filtered.filter((row) => {
        const rowValue = filter.field === "id" ? row.id : row[filter.field];
        if (filter.value === null) return rowValue === null || rowValue === undefined || rowValue === "";
        return String(rowValue ?? "") === String(filter.value);
      });
    });

    this.searchFilters.forEach((filter) => {
      filtered = filtered.filter((row) => String(row[filter.field] ?? "").toLowerCase().includes(filter.term));
    });

    if (this.orFilters.length) {
      filtered = filtered.filter((row) =>
        this.orFilters.some((filter) => String(row[filter.field] ?? "").toLowerCase().includes(filter.term))
      );
    }

    if (this.orderBy) {
      filtered.sort((a, b) => compareValues(a[this.orderBy.field], b[this.orderBy.field], this.orderBy.ascending));
    }

    return filtered;
  }

  buildAppwriteQueries() {
    const queries = [];

    this.filters.forEach((filter) => {
      if (filter.field === "id") return;
      if (filter.value === null || filter.value === undefined || filter.value === "") return;
      queries.push(Query.equal(filter.field, filter.value));
    });

    if (this.orderBy) {
      queries.push(this.orderBy.ascending ? Query.orderAsc(this.orderBy.field) : Query.orderDesc(this.orderBy.field));
    }

    if (this.rangeStart !== null && this.rangeEnd !== null) {
      queries.push(Query.limit(Math.max(1, this.rangeEnd - this.rangeStart + 1)));
      queries.push(Query.offset(this.rangeStart));
    } else if (this.limitValue) {
      queries.push(Query.limit(Math.max(1, this.limitValue)));
    } else {
      queries.push(Query.limit(100));
    }

    return queries;
  }

  async executeSelect() {
    try {
      const idFilter = this.getIdFilter();
      if ((this.wantSingle || this.wantMaybeSingle) && idFilter) {
        try {
          const doc = await getById(this.table, idFilter.value);
          const filtered = this.applyClientFilters([doc]);
          return ok(filtered[0] || null);
        } catch (error) {
          if (this.wantMaybeSingle) return ok(null);
          throw error;
        }
      }

      const response = await databases.listDocuments(
        appwriteDatabaseId,
        collectionFor(this.table),
        this.buildAppwriteQueries()
      );

      let data = (response.documents || []).map(mapDocument);
      data = this.applyClientFilters(data);

      if (this.wantSingle || this.wantMaybeSingle) {
        return ok(data[0] || null);
      }

      return ok(this.headOnly ? null : data, {
        count: this.orFilters.length || this.searchFilters.length ? data.length : response.total ?? data.length,
      });
    } catch (error) {
      return fail(error);
    }
  }

  async resolveTargetIds() {
    const idFilter = this.getIdFilter();
    if (idFilter) return [idFilter.value];

    const result = await this.executeSelect();
    if (result.error) throw new Error(result.error.message);
    return (result.data || []).map((row) => row.id);
  }

  async executeUpdate() {
    try {
      const ids = await this.resolveTargetIds();
      const updated = [];
      for (const id of ids) {
        updated.push(await updateRow(this.table, id, this.payload));
      }
      return ok(updated);
    } catch (error) {
      return fail(error);
    }
  }

  async executeDelete() {
    try {
      const ids = await this.resolveTargetIds();
      for (const id of ids) {
        await deleteRow(this.table, id);
      }
      return ok(null);
    } catch (error) {
      return fail(error);
    }
  }

  async executeInsert() {
    try {
      const payload = Array.isArray(this.payload) ? this.payload : [this.payload];
      const created = [];
      for (const row of payload) {
        const documentId = row?.id || ID.unique();
        const defaults = {};
        if (["materials", "item_requests", "profiles", "suppliers", "restock_requests"].includes(this.table) && !row.created_at) {
          defaults.created_at = isoNow();
        }
        if (this.table === "logs" && !row.timestamp) defaults.timestamp = isoNow();
        if (this.table === "chats" && !row.timestamp) defaults.timestamp = isoNow();
        if (this.table === "materials" && !row.updated) defaults.updated = isoNow();
        if (this.table === "restock_requests" && !row.updated_at) defaults.updated_at = isoNow();
        created.push(await createRow(this.table, { ...defaults, ...row }, documentId));
      }
      return ok(Array.isArray(this.payload) ? created : created[0]);
    } catch (error) {
      return fail(error);
    }
  }

  async execute() {
    if (!isAppwriteConfigured) return fail(new Error("Appwrite is not configured."));
    if (this.operation === "insert") return this.executeInsert();
    if (this.operation === "update") return this.executeUpdate();
    if (this.operation === "delete") return this.executeDelete();
    return this.executeSelect();
  }
}

class AppwriteChannelBuilder {
  constructor(name) {
    this.name = name;
    this.handlers = [];
    this.unsubscribe = null;
  }

  on(eventName, filter, callback) {
    this.handlers.push({ eventName, filter, callback });
    return this;
  }

  subscribe() {
    if (!client?.subscribe) return this;
    const unsubscribers = this.handlers.map(({ eventName, filter, callback }) => {
      const collection = filter?.table ? collectionFor(filter.table) : "*";
      const channel = `databases.${appwriteDatabaseId}.collections.${collection}.documents`;
      return client.subscribe(channel, (event) => {
        const events = event?.events || [];
        const expectedInsert = filter?.event === "INSERT" || eventName === "INSERT";
        if (expectedInsert && !events.some((name) => name.endsWith(".create"))) return;

        const document = mapDocument(event?.payload || null);
        const departmentFilter = String(filter?.filter || "").match(/^dept=eq\.(.+)$/)?.[1];
        if (departmentFilter && document?.dept !== departmentFilter) return;

        callback({
          eventType: events.some((name) => name.endsWith(".create")) ? "INSERT" : "CHANGE",
          new: document,
          payload: document,
          raw: event,
        });
      });
    });
    this.unsubscribe = () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
    return this;
  }
}

async function makeLog(row) {
  return createRow("logs", {
    timestamp: isoNow(),
    qty: 0,
    ...row,
  });
}

async function getMaterials(limit = 500) {
  return listCollection("materials", [Query.limit(limit)]);
}

async function getLogs(limit = 500) {
  return listCollection("logs", [Query.limit(limit), Query.orderDesc("timestamp")]);
}

async function getBorrows(limit = 500) {
  return listCollection("material_borrows", [Query.limit(limit)]);
}

async function runRpc(name, args = {}) {
  try {
    const { user, profile } = await getCurrentProfile();
    const userId = user?.id || null;
    const displayName = profile?.full_name || user?.email || "Unknown user";
    const userDept = profile?.dept || "Unknown department";

    switch (name) {
      case "approve_user_account": {
        const data = await updateRow("profiles", args.profile_id_param, {
          status: "approved",
          admin_note: args.admin_note_param || "Approved by admin",
          reviewed_by: userId,
          reviewer_name: displayName,
          reviewed_at: isoNow(),
        });
        return ok(data);
      }

      case "reject_user_account": {
        const data = await updateRow("profiles", args.profile_id_param, {
          status: "rejected",
          admin_note: args.admin_note_param || "Rejected by admin",
          reviewed_by: userId,
          reviewer_name: displayName,
          reviewed_at: isoNow(),
        });
        return ok(data);
      }

      case "delete_user_account": {
        await updateRow("profiles", args.profile_id_param, {
          status: "rejected",
          admin_note: args.admin_note_param || "Deleted/disabled by admin",
          reviewed_by: userId,
          reviewer_name: displayName,
          reviewed_at: isoNow(),
        });
        return ok({ disabled: true });
      }

      case "approve_item_request": {
        const request = await getById("item_requests", args.request_id_param);
        const material = await createRow("materials", {
          dept: request.dept,
          name: request.name,
          category: request.category || "Uncategorized",
          material_type: request.material_type || "consumable",
          qty: Number(request.qty || 0),
          unit: request.unit || "",
          threshold: Number(request.threshold || 0),
          expires_at: request.expires_at || null,
          price_per_unit: Number(request.price_per_unit || 0),
          supplier_name: request.supplier_name || null,
          hazard_level: request.hazard_level || "Low",
          storage_instruction: request.storage_instruction || null,
          handling_instruction: request.handling_instruction || null,
          disposal_instruction: request.disposal_instruction || null,
          ppe_required: request.ppe_required || null,
          incompatible_with: request.incompatible_with || null,
          compatibility_notes: request.compatibility_notes || null,
          condition: request.condition || "Good",
          last_maintenance_at: request.last_maintenance_at || null,
          maintenance_due_at: request.maintenance_due_at || null,
          maintenance_note: request.maintenance_note || null,
          material_responsible: args.material_responsible_param || request.material_responsible || request.requester_name || null,
          created_by: request.requested_by || null,
          approved_by: userId,
          approved_by_name: displayName,
          approved_at: isoNow(),
          updated: isoNow(),
          created_at: isoNow(),
        });

        await updateRow("item_requests", request.id, {
          status: "approved",
          admin_note: args.admin_note_param || "Approved by admin",
          reviewed_by: userId,
          reviewer_name: displayName,
          reviewed_at: isoNow(),
          material_responsible: args.material_responsible_param || request.material_responsible || request.requester_name || null,
        });

        await makeLog({
          dept: request.dept,
          material_id: material.id,
          material_name: request.name,
          type: "approved",
          qty: Number(request.qty || 0),
          detail: `${args.admin_note_param || "Approved material request"} · MR: ${args.material_responsible_param || request.material_responsible || request.requester_name || "Not assigned"}`,
          user_id: userId,
          user_name: displayName,
        });

        return ok(material);
      }

      case "reject_item_request": {
        const request = await getById("item_requests", args.request_id_param);
        await updateRow("item_requests", request.id, {
          status: "rejected",
          admin_note: args.admin_note_param || "Rejected by admin",
          reviewed_by: userId,
          reviewer_name: displayName,
          reviewed_at: isoNow(),
        });
        await makeLog({
          dept: request.dept,
          material_id: null,
          material_name: request.name,
          type: "rejected",
          qty: Number(request.qty || 0),
          detail: args.admin_note_param || "Rejected material request",
          user_id: userId,
          user_name: displayName,
        });
        return ok({ rejected: true });
      }

      case "delete_material_admin": {
        const material = await getById("materials", args.material_id_param);
        await deleteRow("materials", material.id);
        await makeLog({
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          type: "deleted",
          qty: Number(material.qty || 0),
          detail: args.admin_note_param || "Deleted by admin",
          user_id: userId,
          user_name: displayName,
        });
        return ok({ deleted: true });
      }

      case "clear_activity_range": {
        const target = args.target_param || "logs";
        const period = args.period_param || "week";
        const days = { week: 7, month: 30, year: 365, all: Infinity }[period] ?? 7;
        const cutoff = Number.isFinite(days) ? Date.now() - days * 86400000 : 0;
        let deletedLogs = 0;
        let deletedApprovalLogs = 0;
        let deletedChats = 0;

        if (target === "logs" || target === "both") {
          const logs = await getLogs(500);
          for (const log of logs) {
            if (ymdToTime(log.timestamp) >= cutoff) {
              await deleteRow("logs", log.id);
              deletedLogs += 1;
            }
          }
        }

        if (target === "approval_logs") {
          const logs = await getLogs(500);
          for (const log of logs) {
            const isMaterialApproval = ["approved", "rejected"].includes(String(log.type || "").toLowerCase());
            if (isMaterialApproval && ymdToTime(log.timestamp) >= cutoff) {
              await deleteRow("logs", log.id);
              deletedApprovalLogs += 1;
            }
          }
        }

        if (target === "chats" || target === "both") {
          const chats = await listCollection("chats", [Query.limit(500)]);
          for (const chat of chats) {
            if (ymdToTime(chat.timestamp) >= cutoff) {
              await deleteRow("chats", chat.id);
              deletedChats += 1;
            }
          }
        }

        return ok([{
          deleted_logs: deletedLogs,
          deleted_approval_logs: deletedApprovalLogs,
          deleted_chats: deletedChats,
        }]);
      }

      case "borrow_material": {
        const material = await getById("materials", args.material_id_param);
        const qty = Number(args.qty_param || 0);
        if (!qty || qty <= 0) throw new Error("Enter a valid quantity.");
        if (qty > Number(material.qty || 0)) throw new Error(`Only ${material.qty} ${material.unit} available.`);

        await updateRow("materials", material.id, {
          qty: Number(material.qty || 0) - qty,
          updated: isoNow(),
        });

        const borrow = await createRow("material_borrows", {
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          borrower_id: userId,
          borrower_name: displayName,
          qty_borrowed: qty,
          qty_returned: 0,
          unit: material.unit,
          purpose: args.purpose_param || "",
          status: "active",
          borrowed_at: isoNow(),
          due_at: args.due_at_param || null,
        });

        await makeLog({
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          type: "borrow",
          qty,
          detail: args.purpose_param || "Borrowed material",
          user_id: userId,
          user_name: displayName,
        });

        return ok(borrow);
      }

      case "return_borrowed_material": {
        const borrow = await getById("material_borrows", args.borrow_id_param);
        const returnedQty = Number(args.returned_qty_param || 0);
        const newReturned = Number(borrow.qty_returned || 0) + returnedQty;
        const status = newReturned >= Number(borrow.qty_borrowed || 0) ? "returned" : "active";

        await updateRow("material_borrows", borrow.id, {
          qty_returned: newReturned,
          status,
          returned_at: status === "returned" ? isoNow() : borrow.returned_at || null,
        });

        try {
          const material = await getById("materials", borrow.material_id);
          await updateRow("materials", material.id, {
            qty: Number(material.qty || 0) + returnedQty,
            updated: isoNow(),
          });
        } catch {
          // Material could have been deleted; still keep the borrow return record.
        }

        await makeLog({
          dept: borrow.dept,
          material_id: borrow.material_id,
          material_name: borrow.material_name,
          type: "return",
          qty: returnedQty,
          detail: args.note_param || "Returned borrowed material",
          user_id: userId,
          user_name: displayName,
        });

        return ok({ returned: returnedQty });
      }

      case "create_restock_request": {
        const material = await getById("materials", args.material_id_param);
        const qty = Number(args.qty_param || 0);
        const restock = await createRow("restock_requests", {
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          qty,
          unit: material.unit,
          estimated_cost: Number(material.price_per_unit || 0) * qty,
          supplier_name: material.supplier_name || null,
          status: "pending",
          reason: args.reason_param || "Restock request",
          created_by: userId,
          created_by_name: displayName,
          updated_by: userId,
          updated_by_name: displayName,
          admin_note: null,
          created_at: isoNow(),
          updated_at: isoNow(),
        });
        return ok(restock);
      }

      case "update_restock_request_status": {
        const request = await getById("restock_requests", args.restock_id_param);
        const status = args.status_param || "pending";
        await updateRow("restock_requests", request.id, {
          status,
          updated_by: userId,
          updated_by_name: displayName,
          admin_note: args.admin_note_param || null,
          updated_at: isoNow(),
        });

        if (status === "received" && request.material_id) {
          const material = await getById("materials", request.material_id);
          await updateRow("materials", material.id, {
            qty: Number(material.qty || 0) + Number(request.qty || 0),
            updated: isoNow(),
          });
          await makeLog({
            dept: material.dept,
            material_id: material.id,
            material_name: material.name,
            type: "add",
            qty: Number(request.qty || 0),
            detail: args.admin_note_param || "Received restock order",
            user_id: userId,
            user_name: displayName,
          });
        }

        return ok({ status });
      }

      case "transfer_material_stock": {
        const material = await getById("materials", args.material_id_param);
        const qty = Number(args.qty_param || 0);
        if (qty <= 0) throw new Error("Enter a transfer quantity greater than zero.");
        if (qty > Number(material.qty || 0)) throw new Error("Transfer quantity is higher than available stock.");

        await updateRow("materials", material.id, {
          qty: Number(material.qty || 0) - qty,
          updated: isoNow(),
        });

        const existing = (await getMaterials()).find(
          (row) =>
            row.dept === args.target_dept_param &&
            row.name === material.name &&
            row.unit === material.unit &&
            row.category === material.category
        );

        if (existing) {
          await updateRow("materials", existing.id, {
            qty: Number(existing.qty || 0) + qty,
            updated: isoNow(),
          });
        } else {
          await createRow("materials", {
            ...cleanPayload(material),
            dept: args.target_dept_param,
            qty,
            created_by: userId,
            approved_by: userId,
            approved_by_name: displayName,
            approved_at: isoNow(),
            created_at: isoNow(),
            updated: isoNow(),
          });
        }

        const detail = `Transferred ${qty} ${material.unit} to ${args.target_dept_param}. ${args.reason_param || ""}`.trim();
        await makeLog({
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          type: "correction",
          qty: -qty,
          detail,
          user_id: userId,
          user_name: displayName,
        });

        return ok({ transferred: qty });
      }

      case "submit_maintenance_request": {
        const material = await getById("materials", args.material_id_param);
        if (material.material_type !== "non_consumable") {
          throw new Error("Maintenance requests can only be created for equipment and other non-consumable materials.");
        }
        if (profile?.role !== "admin" && material.dept !== userDept) {
          throw new Error("You can request maintenance only for equipment in your department.");
        }

        const now = isoNow();
        const request = await createRow("maintenance_requests", {
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          requested_by: userId,
          requester_name: displayName,
          condition: args.condition_param || material.condition || "Needs inspection",
          maintenance_date: args.maintenance_date_param || todayYmd(),
          next_due_at: args.next_due_param || null,
          maintenance_type: args.maintenance_type_param || "Preventive maintenance",
          service_provider: args.service_provider_param || null,
          technician: args.technician_param || null,
          cost: Number(args.cost_param || 0),
          notes: args.notes_param || null,
          status: "pending",
          admin_note: null,
          reviewed_by: null,
          reviewer_name: null,
          reviewed_at: null,
          created_at: now,
          updated_at: now,
        });
        return ok(request);
      }

      case "create_maintenance_record_admin": {
        if (profile?.role !== "admin" || profile?.status !== "approved") {
          throw new Error("Only an approved administrator can add a maintenance record directly.");
        }
        const material = await getById("materials", args.material_id_param);
        if (material.material_type !== "non_consumable") {
          throw new Error("Maintenance records apply only to equipment and other non-consumable materials.");
        }
        const now = isoNow();
        const maintenanceDate = args.maintenance_date_param || todayYmd();
        const summary = [
          args.maintenance_type_param || "Maintenance",
          args.service_provider_param ? `Provider: ${args.service_provider_param}` : "",
          args.technician_param ? `Technician: ${args.technician_param}` : "",
          args.notes_param || "",
        ].filter(Boolean).join(" · ").slice(0, 1000);

        await updateRow("materials", material.id, {
          condition: args.condition_param || material.condition || "Good",
          last_maintenance_at: maintenanceDate,
          maintenance_due_at: args.next_due_param || null,
          maintenance_note: summary || null,
          updated: now,
        });
        const request = await createRow("maintenance_requests", {
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          requested_by: userId,
          requester_name: displayName,
          condition: args.condition_param || material.condition || "Good",
          maintenance_date: maintenanceDate,
          next_due_at: args.next_due_param || null,
          maintenance_type: args.maintenance_type_param || "Maintenance",
          service_provider: args.service_provider_param || null,
          technician: args.technician_param || null,
          cost: Number(args.cost_param || 0),
          notes: args.notes_param || null,
          status: "approved",
          admin_note: args.admin_note_param || "Added directly by administrator",
          reviewed_by: userId,
          reviewer_name: displayName,
          reviewed_at: now,
          created_at: now,
          updated_at: now,
        });
        await makeLog({
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          type: "maintenance",
          qty: 0,
          detail: summary || "Maintenance record added by administrator",
          user_id: userId,
          user_name: displayName,
        });
        return ok(request);
      }

      case "approve_maintenance_request": {
        if (profile?.role !== "admin" || profile?.status !== "approved") {
          throw new Error("Only an approved administrator can approve maintenance requests.");
        }
        const request = await getById("maintenance_requests", args.request_id_param);
        const material = await getById("materials", request.material_id);
        const now = isoNow();
        const summary = [
          request.maintenance_type || "Maintenance",
          request.service_provider ? `Provider: ${request.service_provider}` : "",
          request.technician ? `Technician: ${request.technician}` : "",
          request.notes || "",
        ].filter(Boolean).join(" · ").slice(0, 1000);

        await updateRow("materials", material.id, {
          condition: request.condition || material.condition || "Good",
          last_maintenance_at: request.maintenance_date || todayYmd(),
          maintenance_due_at: request.next_due_at || null,
          maintenance_note: summary || null,
          updated: now,
        });
        await updateRow("maintenance_requests", request.id, {
          status: "approved",
          admin_note: args.admin_note_param || "Approved by admin",
          reviewed_by: userId,
          reviewer_name: displayName,
          reviewed_at: now,
          updated_at: now,
        });
        await makeLog({
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          type: "maintenance",
          qty: 0,
          detail: `${summary || "Maintenance request approved"}${args.admin_note_param ? ` · ${args.admin_note_param}` : ""}`.slice(0, 5000),
          user_id: userId,
          user_name: displayName,
        });
        return ok({ approved: true });
      }

      case "reject_maintenance_request": {
        if (profile?.role !== "admin" || profile?.status !== "approved") {
          throw new Error("Only an approved administrator can reject maintenance requests.");
        }
        const request = await getById("maintenance_requests", args.request_id_param);
        const now = isoNow();
        await updateRow("maintenance_requests", request.id, {
          status: "rejected",
          admin_note: args.admin_note_param || "Rejected by admin",
          reviewed_by: userId,
          reviewer_name: displayName,
          reviewed_at: now,
          updated_at: now,
        });
        return ok({ rejected: true });
      }

      case "update_material_maintenance": {
        const material = await getById("materials", args.material_id_param);
        await updateRow("materials", material.id, {
          condition: args.condition_param || "Good",
          last_maintenance_at: args.last_maintenance_param || null,
          maintenance_due_at: args.maintenance_due_param || null,
          maintenance_note: args.note_param || null,
          updated: isoNow(),
        });
        await makeLog({
          dept: material.dept,
          material_id: material.id,
          material_name: material.name,
          type: "correction",
          qty: 0,
          detail: `Maintenance updated: ${args.condition_param || "Good"}${args.note_param ? ` · ${args.note_param}` : ""}`,
          user_id: userId,
          user_name: displayName,
        });
        return ok({ updated: true });
      }

      case "get_dashboard_summary": {
        const [materials, borrows, restocks, suppliers, logs, maintenanceRequests] = await Promise.all([
          getMaterials(),
          getBorrows(),
          listCollection("restock_requests", [Query.limit(500)]),
          listCollection("suppliers", [Query.limit(500)]),
          getLogs(500),
          listCollection("maintenance_requests", [Query.limit(500)]),
        ]);
        const low = materials.filter((m) => stockKind(m) !== "ok").length;
        const expired = materials.filter((m) => expiryKind(m) === "expired").length;
        const expiring = materials.filter((m) => expiryKind(m) === "expiring").length;
        const activeBorrows = borrows.filter((b) => b.status === "active").length;
        const overdueBorrows = borrows.filter(isOverdueBorrow).length;
        const maintenanceDue = materials.filter((m) => ["overdue", "due"].includes(maintenanceKind(m))).length;
        const totalValue = materials.reduce((sum, m) => sum + Number(m.qty || 0) * Number(m.price_per_unit || 0), 0);
        const monthlyCost = logs
          .filter((log) => log.type === "usage")
          .reduce((sum, log) => {
            const material = materials.find((m) => m.id === log.material_id);
            return sum + Number(log.qty || 0) * Number(material?.price_per_unit || 0);
          }, 0);
        const openRestocks = restocks.filter((r) => ["pending", "ordered"].includes(r.status)).length;
        const supplierCount = suppliers.filter((s) => s.status === "approved").length;
        return ok([{
          total_materials: materials.length,
          low_stock: low,
          expired_materials: expired,
          expiring_soon: expiring,
          active_borrows: activeBorrows,
          overdue_borrows: overdueBorrows,
          maintenance_due: maintenanceDue,
          pending_maintenance_requests: maintenanceRequests.filter((request) => request.status === "pending").length,
          total_inventory_value: totalValue,
          monthly_usage_cost: monthlyCost,
          open_restock_requests: openRestocks,
          supplier_count: supplierCount,
        }]);
      }

      case "get_notification_center": {
        const dept = args.dept_param || null;
        const [materials, borrows, restocks, maintenanceRequests] = await Promise.all([
          getMaterials(),
          getBorrows(),
          listCollection("restock_requests", [Query.limit(500)]),
          listCollection("maintenance_requests", [Query.limit(500)]),
        ]);
        const rows = [];
        materials
          .filter((m) => !dept || m.dept === dept)
          .forEach((m) => {
            const stock = stockKind(m);
            const expiry = expiryKind(m);
            const maintenance = maintenanceKind(m);
            if (stock !== "ok") {
              rows.push({
                kind: "stock",
                dept: m.dept,
                severity: stock === "critical" ? "critical" : "warning",
                title: `${m.name} is low on stock`,
                detail: `${m.qty} ${m.unit} remaining; threshold is ${m.threshold}.`,
              });
            }
            if (expiry === "expired" || expiry === "expiring") {
              rows.push({
                kind: "expiry",
                dept: m.dept,
                severity: expiry === "expired" ? "critical" : "warning",
                title: `${m.name} ${expiry === "expired" ? "is expired" : "expires soon"}`,
                detail: m.expires_at ? `Expiry date: ${m.expires_at}` : "No expiry date recorded.",
              });
            }
            if (maintenance === "overdue" || maintenance === "due") {
              rows.push({
                kind: "maintenance",
                dept: m.dept,
                severity: maintenance === "overdue" ? "critical" : "warning",
                title: `${m.name} maintenance ${maintenance === "overdue" ? "is overdue" : "is due soon"}`,
                detail: m.maintenance_due_at ? `Due date: ${m.maintenance_due_at}` : "No due date recorded.",
              });
            }
          });

        borrows
          .filter((b) => (!dept || b.dept === dept) && isOverdueBorrow(b))
          .forEach((b) => rows.push({
            kind: "borrow",
            dept: b.dept,
            severity: "critical",
            title: `${b.material_name} borrow is overdue`,
            detail: `${b.borrower_name} has ${Number(b.qty_borrowed || 0) - Number(b.qty_returned || 0)} ${b.unit} due ${b.due_at}.`,
          }));


        maintenanceRequests
          .filter((request) => (!dept || request.dept === dept) && request.status === "pending")
          .slice(0, 20)
          .forEach((request) => rows.push({
            kind: "maintenance_request",
            dept: request.dept,
            severity: "info",
            title: `${request.material_name} has a pending maintenance request`,
            detail: `${request.requester_name || "A department user"} requested ${request.maintenance_type || "maintenance"} for ${request.maintenance_date || "an unspecified date"}.`,
          }));

        restocks
          .filter((r) => (!dept || r.dept === dept) && ["pending", "ordered"].includes(r.status))
          .slice(0, 20)
          .forEach((r) => rows.push({
            kind: "restock",
            dept: r.dept,
            severity: "info",
            title: `${r.material_name} restock is ${r.status}`,
            detail: `${r.qty} ${r.unit} requested. ${r.reason || ""}`.trim(),
          }));

        return ok(rows);
      }

      case "get_usage_forecast": {
        const dept = args.dept_param || null;
        const materials = (await getMaterials()).filter((m) => !dept || m.dept === dept);
        const logs = await getLogs(500);
        const days = Number(args.days_history_param || 84);
        const cutoff = Date.now() - days * 86400000;
        const rows = materials.map((m) => {
          const usage = logs
            .filter((log) => log.type === "usage" && log.material_id === m.id && (ymdToTime(log.timestamp) || 0) >= cutoff)
            .reduce((sum, log) => sum + Number(log.qty || 0), 0);
          const weekly = usage / Math.max(1, days / 7);
          const qty = Number(m.qty || 0);
          const threshold = Number(m.threshold || 0);
          const weeks = weekly > 0 ? qty / weekly : 999;
          const suggested = qty <= threshold || weeks <= 4 ? Math.max(threshold * 2 - qty, weekly * 4, 0) : 0;
          let priority = "ok";
          let reason = "Stock level is acceptable.";
          if (expiryKind(m) === "expired") {
            priority = "expired";
            reason = "Material is expired.";
          } else if (qty <= threshold * 0.5 && threshold > 0) {
            priority = "critical";
            reason = "Stock is critically below threshold.";
          } else if (qty <= threshold && threshold > 0) {
            priority = "low";
            reason = "Stock is below threshold.";
          } else if (weeks <= 4) {
            priority = "high_usage";
            reason = "Usage trend may empty stock soon.";
          } else if (expiryKind(m) === "expiring") {
            priority = "expiring";
            reason = "Material expires soon.";
          }
          return {
            material_id: m.id,
            dept: m.dept,
            material_name: m.name,
            category: m.category,
            hazard_level: m.hazard_level || "Low",
            current_qty: qty,
            unit: m.unit,
            weekly_usage_avg: weekly,
            weeks_until_empty: weeks,
            suggested_restock_qty: suggested,
            estimated_restock_cost: suggested * Number(m.price_per_unit || 0),
            supplier_name: m.supplier_name || "",
            priority,
            reason,
          };
        });
        return ok(rows);
      }

      case "get_user_activity_report": {
        const dept = args.dept_param || null;
        const search = String(args.search_param || "").toLowerCase();
        const [profiles, requests, logs, borrows] = await Promise.all([
          listCollection("profiles", [Query.limit(500)]),
          listCollection("item_requests", [Query.limit(500)]),
          getLogs(500),
          getBorrows(),
        ]);
        const rows = profiles
          .filter((p) => !dept || p.dept === dept)
          .map((p) => {
            const userLogs = logs.filter((l) => l.user_id === p.id);
            const userBorrows = borrows.filter((b) => b.borrower_id === p.id);
            const lastActivity = [
              ...userLogs.map((l) => l.timestamp),
              ...userBorrows.map((b) => b.borrowed_at),
            ].filter(Boolean).sort().pop() || p.created_at;
            return {
              user_id: p.id,
              full_name: p.full_name,
              email: p.email,
              dept: p.dept,
              request_count: requests.filter((r) => r.requested_by === p.id).length,
              usage_count: userLogs.filter((l) => l.type === "usage").length,
              borrow_count: userLogs.filter((l) => l.type === "borrow").length,
              return_count: userLogs.filter((l) => l.type === "return").length,
              active_borrows: userBorrows.filter((b) => b.status === "active").length,
              overdue_borrows: userBorrows.filter(isOverdueBorrow).length,
              last_activity_at: lastActivity,
            };
          })
          .filter((row) => !search || `${row.full_name} ${row.email} ${row.dept}`.toLowerCase().includes(search));
        return ok(rows);
      }

      case "get_overdue_borrows": {
        const dept = args.dept_param || null;
        const rows = (await getBorrows()).filter((b) => (!dept || b.dept === dept) && isOverdueBorrow(b));
        return ok(rows);
      }

      default:
        throw new Error(`Appwrite compatibility adapter does not implement RPC "${name}".`);
    }
  } catch (error) {
    return fail(error);
  }
}

const authListeners = new Set();

function notifyAuthListeners(event, session) {
  authListeners.forEach((listener) => {
    try {
      listener(event, session);
    } catch {
      // Ignore listener errors.
    }
  });
}

export const supabase = isAppwriteConfigured
  ? {
      auth: {
        async getSession() {
          const user = await getCurrentUser();
          return ok({ session: user ? { user } : null });
        },

        onAuthStateChange(callback) {
          authListeners.add(callback);
          return {
            data: {
              subscription: {
                unsubscribe: () => authListeners.delete(callback),
              },
            },
          };
        },

        async signInWithPassword({ email, password }) {
          try {
            try {
              await account.deleteSession("current");
            } catch {
              // No active session.
            }
            await account.createEmailPasswordSession(email, password);
            const user = mapUser(await account.get());
            const session = { user };
            notifyAuthListeners("SIGNED_IN", session);
            return ok({ user, session });
          } catch (error) {
            return fail(error);
          }
        },

        async signUp({ email, password, options }) {
          try {
            const fullName = options?.data?.full_name || email;
            const dept = options?.data?.dept || "";
            const newUser = await account.create(ID.unique(), email, password, fullName);
            try {
              await account.createEmailPasswordSession(email, password);
            } catch {
              // Some Appwrite settings require verification before session creation.
            }
            try {
              await createRow("profiles", {
                email,
                full_name: fullName,
                dept,
                role: "user",
                status: "pending",
                admin_note: "",
                reviewer_name: "",
                reviewed_at: "",
                created_at: isoNow(),
              }, newUser.$id);
            } catch (profileError) {
              // Profile may already exist if user retried signup.
              if (!String(profileError?.message || "").toLowerCase().includes("already")) throw profileError;
            }
            const user = mapUser(newUser);
            const session = { user };
            notifyAuthListeners("SIGNED_IN", session);
            return ok({ user, session });
          } catch (error) {
            return fail(error);
          }
        },

        async signOut() {
          try {
            await account.deleteSession("current");
          } catch {
            // Already signed out.
          }
          notifyAuthListeners("SIGNED_OUT", null);
          return ok(null);
        },
      },

      from(table) {
        return new AppwriteQueryBuilder(table);
      },

      rpc(name, args) {
        return runRpc(name, args || {});
      },

      channel(name) {
        return new AppwriteChannelBuilder(name);
      },

      removeChannel(channel) {
        channel?.unsubscribe?.();
      },
    }
  : null;
