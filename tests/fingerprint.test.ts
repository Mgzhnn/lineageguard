import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  fingerprintValue,
  sha256Hex,
} from "../lib/fingerprint.ts";

test("implements the published SHA-256 test vectors", () => {
  assert.equal(
    sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("canonical fingerprints are stable across object key order", () => {
  assert.equal(
    canonicalJson({ second: 2, first: 1 }),
    canonicalJson({ first: 1, second: 2 }),
  );
  assert.equal(
    fingerprintValue({ nested: { beta: true, alpha: false } }),
    fingerprintValue({ nested: { alpha: false, beta: true } }),
  );
});

test("fails closed for ambiguous or circular input types", () => {
  assert.throws(() => fingerprintValue(new Map([["key", "value"]])), /unsupported/i);
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.throws(() => fingerprintValue(circular), /circular/i);
});
