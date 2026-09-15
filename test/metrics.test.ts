import assert from "node:assert/strict";
import test from "node:test";
import { complexityForCode } from "../src/metrics.js";

test("optional access is not a ternary and nullish coalescing is one decision", () => {
  assert.deepEqual(complexityForCode("{ return (item as Item)?.implicitWidth ?? 0; }"), {
    cyclomatic: 2, cognitive: 1, maxNesting: 1,
  });
  assert.equal(complexityForCode("return item?.value?.[key]?.();").cyclomatic, 1);
  assert.equal(complexityForCode("return a ?? b ?? c;").cyclomatic, 3);
  assert.equal(complexityForCode("return a ? b : c;").cyclomatic, 2);
  assert.equal(complexityForCode("if (a && b) {} else if (c || d) {}").cyclomatic, 5);
  assert.equal(complexityForCode('return "?? ?. ?"; /* ?? */').cyclomatic, 1);
});
