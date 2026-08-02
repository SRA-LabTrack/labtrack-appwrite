import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  Client,
  Databases,
  ID,
  Permission,
  Query,
  Role,
} from "node-appwrite";

const collections = JSON.parse(
  await readFile(new URL("../appwrite/collections.json", import.meta.url), "utf8")
);

const endpoint =
  process.env.APPWRITE_ENDPOINT ||
  process.env.VITE_APPWRITE_ENDPOINT ||
  "https://fra.cloud.appwrite.io/v1";

const projectId =
  process.env.APPWRITE_PROJECT_ID ||
  process.env.VITE_APPWRITE_PROJECT_ID ||
  "6a595e1200207471ab14";

const databaseId =
  process.env.APPWRITE_DATABASE_ID ||
  process.env.VITE_APPWRITE_DATABASE_ID ||
  "labtrack";

const apiKey = process.env.APPWRITE_API_KEY;

if (!apiKey) {
  console.error(
    "APPWRITE_API_KEY is missing. Create a temporary server key with databases.read and databases.write scopes."
  );
  process.exit(1);
}

const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(apiKey);

const databases = new Databases(client);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const signedInPermissions = [
  Permission.read(Role.users()),
  Permission.create(Role.users()),
  Permission.update(Role.users()),
  Permission.delete(Role.users()),
];

function messageOf(error) {
  return String(
    error?.message ||
      error?.response?.message ||
      error?.type ||
      error ||
      "Unknown Appwrite error"
  );
}

function isNotFound(error) {
  return Number(error?.code || 0) === 404 || /not found/i.test(messageOf(error));
}

function isExists(error) {
  return Number(error?.code || 0) === 409 || /already exists|duplicate/i.test(messageOf(error));
}

async function ensureCollection(collectionId) {
  let collection;

  try {
    collection = await databases.getCollection({ databaseId, collectionId });
    console.log(`• ${collectionId} exists`);
  } catch (error) {
    if (!isNotFound(error)) throw error;

    collection = await databases.createCollection({
      databaseId,
      collectionId,
      name: collectionId.replaceAll("_", " "),
      permissions: signedInPermissions,
      documentSecurity: false,
      enabled: true,
    });

    console.log(`+ Created ${collectionId}`);
  }

  await databases.updateCollection({
    databaseId,
    collectionId,
    name: collection.name || collectionId.replaceAll("_", " "),
    permissions: signedInPermissions,
    documentSecurity: false,
    enabled: true,
  });

  const updated = await databases.getCollection({ databaseId, collectionId });
  const missing = signedInPermissions.filter(
    (permission) => !(updated.$permissions || []).includes(permission)
  );

  if (missing.length) {
    throw new Error(
      `${collectionId} permissions were not applied: ${missing.join(", ")}`
    );
  }

  console.log(`✓ ${collectionId} allows signed-in browser reads and writes`);
}

async function listAttributes(collectionId) {
  const result = await databases.listAttributes({
    databaseId,
    collectionId,
    queries: [Query.limit(100)],
    total: true,
  });

  return result.attributes || [];
}

async function ensureAttributes(collectionId) {
  const definition = collections[collectionId];

  if (!definition) {
    throw new Error(`Missing schema definition for ${collectionId}`);
  }

  let byKey = new Map(
    (await listAttributes(collectionId)).map((attribute) => [
      attribute.key,
      attribute,
    ])
  );

  for (const encoded of definition.strings || []) {
    const [key, sizeText] = String(encoded).split(":");
    const size = Number(sizeText || 255);
    const existing = byKey.get(key);

    if (existing?.status === "available") continue;
    if (existing && ["processing", "deleting"].includes(existing.status)) continue;

    if (existing && ["failed", "stuck"].includes(existing.status)) {
      await databases.deleteAttribute({ databaseId, collectionId, key });
      await sleep(1200);
    } else if (existing) {
      continue;
    }

    try {
      await databases.createStringAttribute({
        databaseId,
        collectionId,
        key,
        size,
        required: false,
        xdefault: null,
        array: false,
        encrypt: false,
      });
      console.log(`+ ${collectionId}.${key}`);
    } catch (error) {
      if (!isExists(error)) throw error;
    }
  }

  byKey = new Map(
    (await listAttributes(collectionId)).map((attribute) => [
      attribute.key,
      attribute,
    ])
  );

  for (const key of definition.floats || []) {
    const existing = byKey.get(key);

    if (existing?.status === "available") continue;
    if (existing && ["processing", "deleting"].includes(existing.status)) continue;

    if (existing && ["failed", "stuck"].includes(existing.status)) {
      await databases.deleteAttribute({ databaseId, collectionId, key });
      await sleep(1200);
    } else if (existing) {
      continue;
    }

    try {
      await databases.createFloatAttribute({
        databaseId,
        collectionId,
        key,
        required: false,
        min: null,
        max: null,
        xdefault: null,
        array: false,
      });
      console.log(`+ ${collectionId}.${key}`);
    } catch (error) {
      if (!isExists(error)) throw error;
    }
  }
}

async function waitForSchema(collectionId, timeoutMs = 240000) {
  const expected = [
    ...(collections[collectionId]?.strings || []).map((item) =>
      String(item).split(":")[0]
    ),
    ...(collections[collectionId]?.floats || []),
  ];

  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const byKey = new Map(
      (await listAttributes(collectionId)).map((attribute) => [
        attribute.key,
        attribute,
      ])
    );

    const failed = expected.filter((key) =>
      ["failed", "stuck"].includes(byKey.get(key)?.status)
    );

    if (failed.length) {
      throw new Error(
        `${collectionId} has failed Appwrite attributes: ${failed.join(", ")}`
      );
    }

    if (expected.every((key) => byKey.get(key)?.status === "available")) {
      console.log(`✓ ${collectionId} attributes are available`);
      return;
    }

    await sleep(2500);
  }

  throw new Error(`Timed out waiting for ${collectionId} attributes.`);
}

async function ensureIndex(collectionId, key, attributes, orders = []) {
  try {
    await databases.createIndex({
      databaseId,
      collectionId,
      key,
      type: "key",
      attributes,
      orders,
    });
    console.log(`+ ${collectionId} index ${key}`);
  } catch (error) {
    if (!isExists(error)) throw error;
  }
}

async function createDocument(collectionId, data) {
  return databases.createDocument({
    databaseId,
    collectionId,
    documentId: ID.unique(),
    data,
  });
}

async function deleteDocument(collectionId, documentId) {
  await databases.deleteDocument({
    databaseId,
    collectionId,
    documentId,
  });
}

async function runSmokeTests() {
  console.log("\nRunning real server-side create/delete smoke tests...");

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const created = [];

  try {
    const material = await createDocument("materials", {
      dept: "BMO Laboratory",
      name: "__LabTrack diagnostic material__",
      category: "Consumable",
      material_type: "consumable",
      qty: 1,
      unit: "test unit",
      threshold: 0,
      updated: now,
      created_at: now,
      price_per_unit: 0,
      hazard_level: "Low",
      condition: "Good",
      material_responsible: "LabTrack repair",
    });
    created.push(["materials", material.$id]);

    const log = await createDocument("logs", {
      dept: "BMO Laboratory",
      material_id: material.$id,
      material_name: "__LabTrack diagnostic material__",
      type: "diagnostic",
      detail: "Automatic repair write test",
      user_id: "repair-script",
      user_name: "LabTrack repair",
      timestamp: now,
      qty: 0,
    });
    created.push(["logs", log.$id]);

    const culture = await createDocument("culture_logs", {
      dept: "Variety Improvement and Pest Management (VIPM)",
      organism_type: "other",
      specimen_type: "Diagnostic specimen",
      culture_name: "__LabTrack diagnostic growth log__",
      strain: "",
      stored_at: today,
      ready_at: today,
      status: "incubating",
      storage_location: "",
      notes: "Automatic repair write test",
      recorded_by: "repair-script",
      recorded_by_name: "LabTrack repair",
      created_at: now,
      updated_at: now,
    });
    created.push(["culture_logs", culture.$id]);

    console.log("✓ materials create test passed");
    console.log("✓ logs create test passed");
    console.log("✓ culture_logs create test passed");
  } finally {
    for (const [collectionId, documentId] of created.reverse()) {
      try {
        await deleteDocument(collectionId, documentId);
      } catch (error) {
        console.warn(
          `Warning: could not remove diagnostic ${collectionId}/${documentId}: ${messageOf(error)}`
        );
      }
    }
  }

  console.log("✓ Diagnostic records were removed");
}

async function main() {
  console.log("LabTrack Appwrite SDK 26 live repair");
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}\n`);

  await databases.get({ databaseId });

  for (const collectionId of Object.keys(collections)) {
    await ensureCollection(collectionId);
  }

  for (const collectionId of Object.keys(collections)) {
    await ensureAttributes(collectionId);
  }

  for (const collectionId of Object.keys(collections)) {
    await waitForSchema(collectionId);
  }

  const indexes = {
    materials: [
      ["idx_dept", ["dept"]],
      ["idx_updated", ["updated"], ["DESC"]],
    ],
    logs: [
      ["idx_dept", ["dept"]],
      ["idx_timestamp", ["timestamp"], ["DESC"]],
    ],
    culture_logs: [
      ["idx_dept", ["dept"]],
      ["idx_type", ["organism_type"]],
      ["idx_status", ["status"]],
      ["idx_ready_at", ["ready_at"], ["ASC"]],
      ["idx_updated_at", ["updated_at"], ["DESC"]],
    ],
  };

  for (const [collectionId, definitions] of Object.entries(indexes)) {
    for (const [key, attributes, orders] of definitions) {
      await ensureIndex(collectionId, key, attributes, orders || []);
    }
  }

  await runSmokeTests();

  console.log(
    "\nSUCCESS: Live Appwrite schema, permissions, and server writes passed."
  );
}

main().catch((error) => {
  console.error("\nLIVE APPWRITE REPAIR FAILED");
  console.error(messageOf(error));
  process.exit(1);
});
