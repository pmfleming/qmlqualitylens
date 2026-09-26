import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { loadQmlParser } from "../src/tree-sitter.js";

const require = createRequire(import.meta.url);

test("missing or malformed optional modules return unavailable evidence", () => {
  assert.equal(loadQmlParser(() => { throw new Error("module unavailable"); }), null);
  for (const value of [null, undefined, 42, {}, { default: null }, () => null])
    assert.equal(loadQmlParser(() => value), null);
  assert.equal(loadQmlParser((name) => name === "tree-sitter" ? require(name) : {}), null);
});
