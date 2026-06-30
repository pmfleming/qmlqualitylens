import assert from "node:assert/strict";
import test from "node:test";
import { parseQmlDocument } from "../src/qml-parser.js";

test("parser preserves pragmas, dotted, versioned, and relative imports", () => {
  const document = parseQmlDocument(`pragma Singleton\npragma ComponentBehavior: Bound\nimport QtQuick.Controls 2.15 as C\nimport "./widgets/Foo.qml"\n\nItem { }\n`, "Imports.qml");

  assert.deepEqual(document.imports.map((item) => ({ module: item.module, version: item.version, alias: item.alias })), [
    { module: "QtQuick.Controls", version: "2.15", alias: "C" },
    { module: "./widgets/Foo.qml", version: null, alias: null },
  ]);
});

test("parser tracks nested objects, bindings, and external id references", () => {
  const document = parseQmlDocument(`import QtQuick\n\nItem {\n  id: root\n  width: card.width + 8\n  property alias labelText: label.text\n  Rectangle {\n    id: card\n    color: root.enabled ? \"red\" : \"blue\"\n    Text {\n      id: label\n      text: root.objectName\n    }\n  }\n  onVisibleChanged: {\n    card.visible = root.visible\n  }\n}\n`, "Fixture.qml");

  assert.equal(document.root?.typeName, "Item");
  assert.equal(document.objects.length, 3);
  assert.equal(Math.max(...document.objects.map((object) => object.depth)), 3);
  assert.deepEqual(document.objects.map((object) => object.idName), ["root", "card", "label"]);
  assert.ok(document.bindings.some((binding) => binding.propertyPath === "width"));
  assert.ok(document.bindings.some((binding) => binding.propertyPath === "labelText"));
  assert.ok(document.idReferences.some((reference) => reference.name === "card" && reference.external));
  assert.ok(document.idReferences.some((reference) => reference.name === "root" && reference.external));
});

test("parser handles grouped and attached property scopes without inflating object count", () => {
  const document = parseQmlDocument(`import QtQuick\n\nItem {\n  id: root\n  anchors {\n    fill: parent\n    margins: 8\n  }\n  Keys {\n    onPressed: {\n      root.forceActiveFocus()\n    }\n  }\n  Component.onCompleted: {\n    root.visible = true\n  }\n}\n`, "Groups.qml");

  assert.equal(document.objects.length, 1);
  assert.ok(document.bindings.some((binding) => binding.propertyPath === "anchors.fill"));
  assert.ok(document.bindings.some((binding) => binding.propertyPath === "anchors.margins"));
  assert.ok(document.bindings.some((binding) => binding.propertyPath === "Keys.onPressed"));
  assert.ok(document.bindings.some((binding) => binding.propertyPath === "Component.onCompleted"));
  assert.ok(document.root?.handlers.some((handler) => handler.name === "Keys.onPressed"));
  assert.ok(document.root?.handlers.some((handler) => handler.name === "Component.onCompleted"));
});

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

test("parser tracks bare id references", () => {
  const document = parseQmlDocument(`import QtQuick\n\nItem {\n  QtObject { id: backend }\n  Connections {\n    target: backend\n    function onChanged() { backend.refresh() }\n  }\n}\n`, "BareRefs.qml");

  const backend = document.objects.find((object) => object.idName === "backend");
  assert.ok(backend);
  assert.ok(document.idReferences.some((reference) => reference.name === "backend" && reference.targetObjectId === backend.objectId && reference.external));
});

test("parser surfaces diagnostics", () => {
  const document = parseQmlDocument(`Item {\n  width: (1 + 2\n`, "Broken.qml");
  assert.ok(document.diagnostics.length >= 1);
  assert.equal(document.diagnostics[0]?.file, "Broken.qml");
});
