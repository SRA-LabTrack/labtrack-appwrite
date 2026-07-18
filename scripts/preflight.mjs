import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

const packageJson = await readJson("package.json");
const packageLock = await readFile(resolve(root, "package-lock.json"), "utf8");
const collections = await readJson("appwrite/collections.json");

const failures = [];
const checks = [];
const record = (ok, label) => {
  checks.push({ ok, label });
  if (!ok) failures.push(label);
};

record(packageJson?.engines?.node === "24.x", "package.json uses Node.js 24.x");
record(!packageLock.includes("applied-caas"), "package-lock.json does not contain the inaccessible internal registry");
record(packageLock.includes("https://registry.npmjs.org/"), "package-lock.json uses the public npm registry");
record(Boolean(collections.materials), "materials collection exists in schema");
record(Boolean(collections.item_requests), "item_requests collection exists in schema");
record(Boolean(collections.culture_logs), "culture_logs collection exists in schema");
record(collections.materials?.strings?.some((item) => item.startsWith("material_responsible:")), "materials includes material_responsible");
record(collections.item_requests?.strings?.some((item) => item.startsWith("material_responsible:")), "item_requests includes material_responsible");

const maxDocumentBytes = 65535;
const safetyLimit = 56000;
console.log("\nAppwrite schema budget check");
for (const [collectionId, schema] of Object.entries(collections)) {
  const stringBytes = (schema.strings || []).reduce((sum, item) => {
    const [, size] = item.split(":");
    return sum + Number(size || 255) * 4;
  }, 0);
  const numberBytes = (schema.floats || []).length * 8;
  const estimatedBytes = stringBytes + numberBytes;
  const ok = estimatedBytes <= safetyLimit;
  record(ok, `${collectionId} stays below the ${safetyLimit.toLocaleString()}-byte safety budget`);
  console.log(`${ok ? "✓" : "✗"} ${collectionId.padEnd(20)} ${estimatedBytes.toLocaleString().padStart(7)} / ${maxDocumentBytes.toLocaleString()} estimated bytes`);
}

const importantFiles = [
  "App.jsx",
  "supabaseClient.js",
  "main.jsx",
  "index.html",
  "vite.config.js",
  "vercel.json",
  "appwrite/collections.json",
  "scripts/setupAppwrite.mjs",
];
let sourceBytes = 0;
for (const file of importantFiles) {
  try {
    const info = await stat(resolve(root, file));
    sourceBytes += info.size;
    record(true, `${file} is present`);
  } catch {
    record(false, `${file} is present`);
  }
}

console.log("\nProject checks");
for (const check of checks.filter((item) => !item.label.includes("stays below"))) {
  console.log(`${check.ok ? "✓" : "✗"} ${check.label}`);
}
console.log(`\nCore source size: ${(sourceBytes / 1024).toFixed(1)} KB`);

if (failures.length) {
  console.error(`\nPreflight failed with ${failures.length} problem(s).`);
  process.exit(1);
}

console.log("\nPreflight passed. The project is ready for Appwrite setup and Vercel deployment.\n");
