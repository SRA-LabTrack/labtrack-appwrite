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

async function createDatabase() {
  await createSafely(`database ${databaseId}`, () =>
    databases.create(databaseId, "LabTrack")
  );
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

  await createDatabase();

  for (const collectionId of Object.keys(collections)) {
    await createCollection(collectionId);
  }

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
