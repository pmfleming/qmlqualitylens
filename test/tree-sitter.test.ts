import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { loadQmlParser } from "../src/tree-sitter.js";

const require = createRequire(import.meta.url);

test("optional parser loader accepts CommonJS/default exports and isolates parser state", () => {
  const first = loadQmlParser();
  const second = loadQmlParser((name) => ({ default: require(name) }));
  assert.ok(first && second);
  assert.notEqual(first.parser, second.parser);
  first.parser.reset();
  const tree = second.parser.parse("Item {}");
  assert.ok(tree && !tree.rootNode.hasError);
  assert.equal(second.createQuery("(ui_object_definition) @object").captures(tree.rootNode).length, 1);
});

test("missing or malformed optional modules return unavailable evidence", () => {
  assert.equal(loadQmlParser(() => { throw new Error("module unavailable"); }), null);
  for (const value of [null, undefined, 42, {}, { default: null }, () => null])
    assert.equal(loadQmlParser(() => value), null);
  assert.equal(loadQmlParser((name) => name === "tree-sitter" ? require(name) : {}), null);
});
