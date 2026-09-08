import assert from "node:assert/strict";
import test from "node:test";
import { analyzeAssignments } from "../src/expression-analysis.js";

function targets(expression: string, parameters: string[] = []) {
  const result = analyzeAssignments(expression, parameters);
  assert.equal(result.reason, undefined);
  return result.assignments.map(({ owner, property }) => owner ? `${owner}.${property}` : property);
}

test("assignment analysis respects block scope, function parameters, and var hoisting", () => {
  assert.deepEqual(targets(`{
    { let width = 0; width = 1; }
    width = 2;
    { const card = {}; card.width = 3; }
    card.width = 4;
    (() => { count = 1; var count; })();
    ((width) => { width = 5; })();
    (function(card) { card.width = 6; })({});
  }`), ["width", "card.width"]);
  assert.deepEqual(targets("{ width = 3; card.width = 2 }", ["width", "card"]), []);
});

test("assignment analysis ignores comments, strings, regexes, comparisons, and deliberate rebinding", () => {
  assert.deepEqual(targets(`{
    // width = 1;
    const message = "width = 2";
    const regex = /width = 3/;
    if (width === 4) width = Qt.binding(() => height);
    width += 1;
    card.width++;
  }`), ["width", "card.width"]);
});

test("assignment analysis supports destructuring locals and catch parameters", () => {
  assert.deepEqual(targets(`{
    const { width, source: card } = model;
    width = 1; card.width = 2;
    try {} catch (error) { error.width = 3; }
    error.width = 4;
  }`), ["error.width"]);
});

test("nested member reads retain their root dependency without broadening assignment targets", () => {
  const reads = analyzeAssignments("{ return controller.state.value + state.value.deep; }");
  assert.equal(reads.reason, undefined);
  assert.deepEqual(reads.references, [
    { owner: "controller", property: "state" },
    { owner: "state", property: "value" },
  ]);
  assert.deepEqual(analyzeAssignments("{ return controller.state.value; }", ["controller"]).references, []);
  const write = analyzeAssignments("{ controller.state.value = 1; }");
  assert.equal(write.reason, "dynamic_assignment_target");
  assert.deepEqual(write.assignments, []);
});

test("dynamic writes are explicitly unsupported and fallback never guesses lexical scope", () => {
  assert.equal(analyzeAssignments("{ card[key] = 1 }").reason, "dynamic_assignment_target");
  assert.equal(analyzeAssignments("{ let width = 0; width = 1 }", [], false).reason, "javascript_parser_unavailable");
  const fallback = analyzeAssignments('{ card.width = 1; "width = 2"; width = Qt.binding(foo) }', [], false);
  assert.equal(fallback.reason, undefined);
  assert.deepEqual(fallback.assignments.map(({ owner, property }) => [owner, property]), [["card", "width"]]);
});
