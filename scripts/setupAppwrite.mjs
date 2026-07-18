import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Client, Databases, Permission, Query, Role } from "node-appwrite";

const collections = JSON.parse(
  await readFile(new URL("../appwrite/collections.json", import.meta.url), "utf8")
);

const endpoint = process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1";
const projectId = process.env.APPWRITE_PROJECT_ID;
const databaseId = process.env.APPWRITE_DATABASE_ID || "labtrack";
const apiKey = process.env.APPWRITE_API_KEY;

if (!projectId || !apiKey) {
  console.error(`
Missing Appwrite setup values.

Create a .env file in this project folder and add:
APPWRITE_ENDPOINT=https://<YOUR-REGION>.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=your_project_id
APPWRITE_DATABASE_ID=labtrack
APPWRITE_API_KEY=your_server_api_key
`);
  process.exit(1);
}

const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(apiKey);

const databases = new Databases(client);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlreadyExists(error) {
  const message = String(error?.message || "").toLowerCase();
  return Number(error?.code || 0) === 409 || message.includes("already exists");
}

function isRetryable(error) {
  const code = Number(error?.code || 0);
  const message = String(error?.message || "").toLowerCase();
  return (
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    message.includes("rate limit") ||
    message.includes("processing") ||
    message.includes("not available") ||
    message.includes("attribute") && message.includes("ready")
  );
}

async function createSafely(label, fn, maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await fn();
      console.log(`✓ ${label}`);
      return result;
    } catch (error) {
      if (isAlreadyExists(error)) {
        console.log(`• ${label} already exists`);
        return null;
      }

      if (attempt < maxAttempts && isRetryable(error)) {
        const delay = Math.min(1500 * attempt, 8000);
        console.log(`↻ ${label} is not ready yet; retrying...`);
        await sleep(delay);
        continue;
      }

      console.error(`✗ ${label}`);
      throw error;
    }
  }

  return null;
}

async function verifyExistingDatabase() {
  try {
    await databases.get(databaseId);
    console.log(`• Using existing database ${databaseId}`);
  } catch (error) {
    throw new Error(
      `The existing Appwrite database "${databaseId}" could not be opened. ` +
      `Create or select that one database in Appwrite, verify APPWRITE_DATABASE_ID, and run setup again. ` +
      `This updater will never create a second database, so it cannot trigger the Free-plan database-count limit. ` +
      `Original error: ${error?.message || error}`
    );
  }
}

async function createCollection(collectionId) {
  await createSafely(`collection ${collectionId}`, () =>
    databases.createCollection(
      databaseId,
      collectionId,
      collectionId.replaceAll("_", " "),
      [
        Permission.read(Role.users()),
        Permission.create(Role.users()),
        Permission.update(Role.users()),
        Permission.delete(Role.users()),
      ],
      false,
      true
    )
  );
}

async function createStringAttribute(collectionId, key, size) {
  await createSafely(`${collectionId}.${key}`, () =>
    databases.createStringAttribute(
      databaseId,
      collectionId,
      key,
      Number(size || 255),
      false
    )
  );
}

async function createFloatAttribute(collectionId, key) {
  await createSafely(`${collectionId}.${key}`, () =>
    databases.createFloatAttribute(databaseId, collectionId, key, false)
  );
}


function validateSchemaBudgets() {
  const maxDocumentBytes = 65535;
  const safetyLimit = 56000;

  for (const [collectionId, schema] of Object.entries(collections)) {
    const stringBytes = (schema.strings || []).reduce((sum, item) => {
      const [, size] = item.split(":");
      return sum + Number(size || 255) * 4;
    }, 0);
    const numericBytes = (schema.floats || []).length * 8;
    const estimatedBytes = stringBytes + numericBytes;

    if (estimatedBytes > safetyLimit) {
      throw new Error(
        `${collectionId} schema is estimated at ${estimatedBytes.toLocaleString()} bytes, which is too close to Appwrite's ${maxDocumentBytes.toLocaleString()}-byte collection document limit. Reduce string sizes before running setup.`
      );
    }

    console.log(`• ${collectionId} schema budget: about ${estimatedBytes.toLocaleString()} / ${maxDocumentBytes.toLocaleString()} bytes`);
  }
}

async function repairExistingAttributes(collectionId, schema) {
  const desiredStringSizes = new Map(
    (schema.strings || []).map((item) => {
      const [key, size] = item.split(":");
      return [key, Number(size || 255)];
    })
  );

  const result = await databases.listAttributes(
    databaseId,
    collectionId,
    [Query.limit(100)]
  );

  for (const attribute of result.attributes || []) {
    if (!desiredStringSizes.has(attribute.key)) continue;

    if (["failed", "stuck"].includes(attribute.status)) {
      console.log(`↻ Removing failed attribute ${collectionId}.${attribute.key} so it can be recreated`);
      await databases.deleteAttribute(databaseId, collectionId, attribute.key);
      await sleep(1200);
      continue;
    }

    const desiredSize = desiredStringSizes.get(attribute.key);
    const currentSize = Number(attribute.size || 0);
    if (attribute.type !== "string" || !currentSize || currentSize <= desiredSize) continue;

    console.log(`↘ Resizing ${collectionId}.${attribute.key} from ${currentSize} to ${desiredSize}`);
    try {
      await databases.updateStringAttribute({
        databaseId,
        collectionId,
        key: attribute.key,
        required: Boolean(attribute.required),
        default: attribute.required ? undefined : (attribute.default ?? null),
        size: desiredSize,
      });
      await sleep(900);
    } catch (error) {
      throw new Error(
        `Could not resize ${collectionId}.${attribute.key} from ${currentSize} to ${desiredSize}. ` +
        `Check whether an existing document contains text longer than ${desiredSize} characters, shorten that value in Appwrite, then run setup again. Original error: ${error?.message || error}`
      );
    }
  }
}

async function waitForAttributes(collectionId, expectedKeys, timeoutMs = 180000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await databases.listAttributes(
      databaseId,
      collectionId,
      [Query.limit(100)]
    );

    const byKey = new Map((result.attributes || []).map((attribute) => [attribute.key, attribute]));
    const failed = expectedKeys
      .map((key) => byKey.get(key))
      .filter((attribute) => attribute && ["failed", "stuck"].includes(attribute.status));

    if (failed.length) {
      throw new Error(
        `Appwrite could not create these attributes in ${collectionId}: ${failed
          .map((attribute) => attribute.key)
          .join(", ")}`
      );
    }

    const ready = expectedKeys.every((key) => byKey.get(key)?.status === "available");
    if (ready) {
      console.log(`✓ ${collectionId} attributes are available`);
      return;
    }

    await sleep(2500);
  }

  throw new Error(
    `Timed out while waiting for Appwrite attributes in ${collectionId}. Re-run npm run setup:appwrite; existing items will be skipped.`
  );
}

async function createIndex(collectionId, key, type, attributes, orders = []) {
  await createSafely(`${collectionId} index ${key}`, () =>
    databases.createIndex(
      databaseId,
      collectionId,
      key,
      type,
      attributes,
      orders
    )
  );
}

async function main() {
  console.log("Setting up Appwrite for LabTrack...");
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}\n`);

  validateSchemaBudgets();
  await verifyExistingDatabase();

  for (const collectionId of Object.keys(collections)) {
    await createCollection(collectionId);
  }

  console.log("\nChecking existing attributes and reducing oversized fields...");
  for (const [collectionId, schema] of Object.entries(collections)) {
    await repairExistingAttributes(collectionId, schema);
  }

  console.log("\nCreating missing attributes...");
  for (const [collectionId, schema] of Object.entries(collections)) {
    for (const item of schema.strings || []) {
      const [key, size] = item.split(":");
      await createStringAttribute(collectionId, key, size);
    }
    for (const key of schema.floats || []) {
      await createFloatAttribute(collectionId, key);
    }
  }

  console.log("\nWaiting for Appwrite attributes before creating indexes...");
  for (const [collectionId, schema] of Object.entries(collections)) {
    const keys = [
      ...(schema.strings || []).map((item) => item.split(":")[0]),
      ...(schema.floats || []),
    ];
    await waitForAttributes(collectionId, keys);
  }

  const indexes = {
    profiles: [
      ["idx_status", "key", ["status"]],
      ["idx_dept", "key", ["dept"]],
      ["idx_created_at", "key", ["created_at"], ["DESC"]],
    ],
    materials: [
      ["idx_dept", "key", ["dept"]],
      ["idx_updated", "key", ["updated"], ["DESC"]],
      ["idx_maintenance_due", "key", ["maintenance_due_at"], ["ASC"]],
      ["idx_material_type", "key", ["material_type"]],
    ],
    logs: [
      ["idx_dept", "key", ["dept"]],
      ["idx_timestamp", "key", ["timestamp"], ["DESC"]],
      ["idx_user", "key", ["user_id"]],
      ["idx_material", "key", ["material_id"]],
    ],
    chats: [
      ["idx_dept", "key", ["dept"]],
      ["idx_timestamp", "key", ["timestamp"], ["DESC"]],
    ],
    item_requests: [
      ["idx_status", "key", ["status"]],
      ["idx_dept", "key", ["dept"]],
      ["idx_requested_by", "key", ["requested_by"]],
      ["idx_created_at", "key", ["created_at"], ["DESC"]],
    ],
    material_borrows: [
      ["idx_dept", "key", ["dept"]],
      ["idx_status", "key", ["status"]],
      ["idx_borrower", "key", ["borrower_id"]],
      ["idx_due", "key", ["due_at"], ["ASC"]],
    ],
    suppliers: [
      ["idx_status", "key", ["status"]],
      ["idx_dept", "key", ["dept"]],
      ["idx_created_at", "key", ["created_at"], ["DESC"]],
    ],
    restock_requests: [
      ["idx_dept", "key", ["dept"]],
      ["idx_status", "key", ["status"]],
      ["idx_updated_at", "key", ["updated_at"], ["DESC"]],
    ],
    culture_logs: [
      ["idx_dept", "key", ["dept"]],
      ["idx_type", "key", ["organism_type"]],
      ["idx_status", "key", ["status"]],
      ["idx_ready_at", "key", ["ready_at"], ["ASC"]],
      ["idx_updated_at", "key", ["updated_at"], ["DESC"]],
    ],
  };

  for (const [collectionId, items] of Object.entries(indexes)) {
    for (const [key, type, attributes, orders] of items) {
      await createIndex(collectionId, key, type, attributes, orders || []);
    }
  }

  console.log(`
Done.

Add these Vercel environment variables:
VITE_APPWRITE_ENDPOINT=${endpoint}
VITE_APPWRITE_PROJECT_ID=${projectId}
VITE_APPWRITE_DATABASE_ID=${databaseId}

Do not put APPWRITE_API_KEY in Vercel or GitHub.
You can delete the temporary setup API key from Appwrite after this script succeeds.
`);
}

main().catch((error) => {
  console.error("\nAppwrite setup failed:");
  console.error(error?.message || error);
  process.exit(1);
});
