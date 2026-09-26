import assert from "node:assert/strict";
import test from "node:test";
import { parseQmlDocument } from "../src/qml-parser.js";

// Basic syntax, scope and malformed-input behavior is exercised through the
// calibration corpus, consumer regressions and rule-coverage tests. Keep the
// parser boundary cases which those behavioral fixtures do not distinguish.
test("parser handles qualified object type paths and multiline JavaScript bindings", () => {
  const document = parseQmlDocument(`import QtQuick\n\nNs.RootItem {\n  id: root\n  property var computed: root.enabled\n    ? Math.max(1, 2)\n    : helper.value\n  Ns.ChildItem {\n    id: child\n    value: root.computed\n  }\n}\n`, "Qualified.qml");
  assert.equal(document.root?.typeName, "Ns.RootItem");
  assert.equal(document.objects[1]?.typeName, "Ns.ChildItem");
  const binding = document.bindings.find((item) => item.propertyPath === "computed");
  assert.ok(binding);
  assert.match(binding.expression, /Math\.max/);
  assert.match(binding.expression, /helper\.value/);
  assert.ok(document.idReferences.some((reference) => reference.name === "root" && reference.external));
});

test("inline signal declarations do not consume the enclosing object brace", () => {
  const document = parseQmlDocument("Item { Item { signal ready() } Item {} }", "Main.qml");
  assert.deepEqual(document.diagnostics, []);
  assert.equal(document.root?.children.length, 2);
  assert.equal(document.root?.children[0]?.signals[0]?.name, "ready");
});

test("postfix increment and decrement end handlers without breaking binary continuations", () => {
  for (const operation of ["++", "--"]) {
    const document = parseQmlDocument(`Item {
      onWidthChanged: count${operation} // finished expression
      onHeightChanged: function() { count = 0 }
      width: base +
        extra
      height: base -
        extra
      x: count${operation}
        + extra
      y: 0
    }`, "Postfix.qml");
    assert.deepEqual(document.diagnostics, []);
    assert.deepEqual(document.root?.handlers.map((handler) => handler.name), ["onWidthChanged", "onHeightChanged"]);
    assert.equal(document.bindings.length, 6);
    assert.match(document.bindings.find((binding) => binding.propertyPath === "width")!.expression, /base \+\s+extra/);
    assert.match(document.bindings.find((binding) => binding.propertyPath === "height")!.expression, /base -\s+extra/);
    assert.match(document.bindings.find((binding) => binding.propertyPath === "x")!.expression, /\+ extra$/);
  }
});
