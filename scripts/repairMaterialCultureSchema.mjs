import "dotenv/config";
import { readFile } from "node:fs/promises";
import { Client, Databases, Permission, Query, Role } from "node-appwrite";

const projectRoot = new URL("../", import.meta.url);
const schema = JSON.parse(
  await readFile(new URL("../appwrite/collections.json", import.meta.url), "utf8")
);

const endpoint = process.env.APPWRITE_ENDPOINT || "https://fra.cloud.appwrite.io/v1";
const projectId = process.env.APPWRITE_PROJECT_ID || "6a595e1200207471ab14";
const databaseId = process.env.APPWRITE_DATABASE_ID || "labtrack";
const apiKey = process.env.APPWRITE_API_KEY;

if (!apiKey) {
  console.error("APPWRITE_API_KEY is missing. Use a temporary server API key with databases.read and databases.write scopes.");
  process.exit(1);
}

const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setKey(apiKey);

const databases = new Databases(client);
const targets = ["materials", "logs", "culture_logs"];
const permissions = [
  Permission.read(Role.users()),
  Permission.create(Role.users()),
  Permission.update(Role.users()),
  Permission.delete(Role.users()),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function messageOf(error) {
  return String(error?.message || error || "Unknown Appwrite error");
}

function isMissing(error) {
  return Number(error?.code || 0) === 404 || /not found|could not be found/i.test(messageOf(error));
}

function isExists(error) {
  return Number(error?.code || 0) === 409 || /already exists|duplicate/i.test(messageOf(error));
}

function isSignatureError(error) {
  return /missing required parameter|cannot destructure|must be of type object|undefined.*database/i.test(messageOf(error));
}

async function updateCollectionCompat(collectionId) {
  const name = collectionId.replaceAll("_", " ");
  try {
    return await databases.updateCollection(
      databaseId,
      collectionId,
      name,
      permissions,
      false,
      true
    );
  } catch (error) {
    if (!isSignatureError(error)) throw error;
    return databases.updateCollection({
      databaseId,
      collectionId,
      name,
      permissions,
      documentSecurity: false,
      enabled: true,
      purge: true,
    });
  }
}

async function ensureCollection(collectionId) {
  try {
    await databases.getCollection(databaseId, collectionId);
    console.log(`• ${collectionId} collection exists`);
  } catch (error) {
    if (!isMissing(error)) throw error;
    console.log(`+ Creating ${collectionId} collection`);
    await databases.createCollection(
      databaseId,
      collectionId,
      collectionId.replaceAll("_", " "),
      permissions,
      false,
      true
    );
  }

  await updateCollectionCompat(collectionId);
  console.log(`✓ ${collectionId} permissions allow signed-in users to create, read, update, and delete`);
}

async function existingAttributes(collectionId) {
  const result = await databases.listAttributes(
    databaseId,
    collectionId,
    [Query.limit(100)]
  );
  return new Map((result.attributes || []).map((attribute) => [attribute.key, attribute]));
}

async function createMissingAttributes(collectionId) {
  const collectionSchema = schema[collectionId];
  if (!collectionSchema) {
    throw new Error(`No schema definition exists for ${collectionId}.`);
  }

  let attributes = await existingAttributes(collectionId);

  for (const definition of collectionSchema.strings || []) {
    const [key, sizeText] = definition.split(":");
    const size = Number(sizeText || 255);
    const current = attributes.get(key);

    if (current?.status === "available") continue;
    if (current && ["processing", "deleting"].includes(current.status)) continue;
    if (current && ["failed", "stuck"].includes(current.status)) {
      console.log(`↻ Removing failed attribute ${collectionId}.${key}`);
      await databases.deleteAttribute(databaseId, collectionId, key);
      await sleep(1000);
    }

    try {
      await databases.createStringAttribute(
        databaseId,
        collectionId,
        key,
        size,
        false
      );
      console.log(`+ ${collectionId}.${key}`);
    } catch (error) {
      if (!isExists(error)) throw error;
    }
  }

  attributes = await existingAttributes(collectionId);

  for (const key of collectionSchema.floats || []) {
    const current = attributes.get(key);
    if (current?.status === "available") continue;
    if (current && ["processing", "deleting"].includes(current.status)) continue;
    if (current && ["failed", "stuck"].includes(current.status)) {
      console.log(`↻ Removing failed attribute ${collectionId}.${key}`);
      await databases.deleteAttribute(databaseId, collectionId, key);
      await sleep(1000);
    }

    try {
      await databases.createFloatAttribute(
        databaseId,
        collectionId,
        key,
        false
      );
      console.log(`+ ${collectionId}.${key}`);
    } catch (error) {
      if (!isExists(error)) throw error;
    }
  }
}

async function waitForAttributes(collectionId, timeoutMs = 180000) {
  const wanted = [
    ...(schema[collectionId]?.strings || []).map((item) => item.split(":")[0]),
    ...(schema[collectionId]?.floats || []),
  ];
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const attributes = await existingAttributes(collectionId);
    const failed = wanted.filter((key) => ["failed", "stuck"].includes(attributes.get(key)?.status));
    if (failed.length) {
      throw new Error(`Appwrite failed to create ${collectionId}: ${failed.join(", ")}`);
    }
    if (wanted.every((key) => attributes.get(key)?.status === "available")) {
      console.log(`✓ ${collectionId} schema is ready`);
      return;
    }
    await sleep(2500);
  }

  throw new Error(`Timed out waiting for ${collectionId} attributes. Run the repair again; available attributes will be skipped.`);
}

async function ensureIndex(collectionId, key, attributes, orders = []) {
  try {
    await databases.createIndex(
      databaseId,
      collectionId,
      key,
      "key",
      attributes,
      orders
    );
    console.log(`+ ${collectionId} index ${key}`);
  } catch (error) {
    if (!isExists(error)) throw error;
  }
}

async function main() {
  console.log("LabTrack Appwrite material and growth-log repair");
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Project: ${projectId}`);
  console.log(`Database: ${databaseId}\n`);

  await databases.get(databaseId);

  for (const collectionId of targets) {
    await ensureCollection(collectionId);
    await createMissingAttributes(collectionId);
    await waitForAttributes(collectionId);
  }

  await ensureIndex("materials", "idx_dept", ["dept"]);
  await ensureIndex("materials", "idx_updated", ["updated"], ["DESC"]);
  await ensureIndex("logs", "idx_dept", ["dept"]);
  await ensureIndex("logs", "idx_timestamp", ["timestamp"], ["DESC"]);
  await ensureIndex("culture_logs", "idx_dept", ["dept"]);
  await ensureIndex("culture_logs", "idx_type", ["organism_type"]);
  await ensureIndex("culture_logs", "idx_status", ["status"]);
  await ensureIndex("culture_logs", "idx_ready_at", ["ready_at"], ["ASC"]);
  await ensureIndex("culture_logs", "idx_updated_at", ["updated_at"], ["DESC"]);

  console.log("\nSUCCESS: materials, logs, and culture_logs are ready for browser writes.");
}

main().catch((error) => {
  console.error("\nAppwrite repair failed:");
  console.error(messageOf(error));
  process.exit(1);
});
