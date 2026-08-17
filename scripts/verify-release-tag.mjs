import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tag = process.argv[2];
assert.match(tag ?? "", /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
const sdkPackage = JSON.parse(await readFile("sdk/package.json", "utf8"));
const expectedVersion = tag.slice(1);

assert.equal(rootPackage.version, expectedVersion, "Root version must match tag.");
assert.equal(sdkPackage.version, expectedVersion, "SDK version must match tag.");

const versionSource = await readFile("lib/version.ts", "utf8");
assert.match(
  versionSource,
  new RegExp(`PRODUCT_VERSION\\s*=\\s*["']${expectedVersion.replaceAll(".", "\\.")}["']`),
  "PRODUCT_VERSION must match tag.",
);

console.log(`Release tag ${tag} matches all package versions.`);
