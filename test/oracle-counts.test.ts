import assert from "node:assert/strict";
import test from "node:test";
import { qmlDomCounts } from "../src/measures/parser-oracle.js";
import { parseQmlDocument } from "../src/qml-parser.js";

test("Qt oracle normalizes grouped scopes and property initializers without double counting", () => {
  const counts = qmlDomCounts(`<UiProgram>
    <UiObjectDefinition><Node><UiQualifiedId name="Item"/></Node></UiObjectDefinition>
    <UiObjectDefinition><Node><UiQualifiedId name="anchors"/></Node></UiObjectDefinition>
    <UiObjectDefinition><Node><UiQualifiedId name="Layout"/></Node></UiObjectDefinition>
    <UiPublicMember type="Property" colonToken="off:10 len:1"/>
    <UiPublicMember type="Property" colonToken="off:20 len:1"/>
    <UiObjectBinding colonToken="off:20 len:1" hasOnToken="false"/>
    <UiPublicMember type="Property" colonToken=""/>
    <UiArrayBinding colonToken="off:30 len:1"/>
    <UiScriptBinding colonToken="off:40 len:1"/>
    <UiObjectBinding colonToken="off:50 len:2" hasOnToken="true"/>
  </UiProgram>`);
  assert.deepEqual(counts, { imports: 0, objects: 3, properties: 3, bindings: 4 });
});

test("Component factories are objects and animation property assignments are not declarations", () => {
  const document = parseQmlDocument(`import QtQuick
Item {
  property Component factory: Component { Item { width: 10 } }
  PropertyAnimation { property: "opacity"; to: 1 }
}`, "Factory.qml");
  assert.deepEqual(document.diagnostics, []);
  assert.deepEqual(document.objects.map((object) => object.typeName), ["Item", "Component", "Item", "PropertyAnimation"]);
  assert.equal(document.objects.flatMap((object) => object.properties).length, 1);
  assert.ok(document.objects[3]?.bindings.some((binding) => binding.propertyPath === "property"));
});

test("value-source and interceptor objects own their bindings and nested animations", () => {
  const document = parseQmlDocument(`import QtQuick
Item {
  Behavior on opacity { enabled: true; NumberAnimation { duration: 100 } }
  NumberAnimation on x { from: 0; to: 100 }
  width: 40
}`, "Animated.qml");
  assert.deepEqual(document.diagnostics, []);
  assert.deepEqual(document.objects.map((object) => object.typeName), ["Item", "Behavior", "NumberAnimation", "NumberAnimation"]);
  assert.equal(document.objects[1]?.bindings[0]?.propertyPath, "enabled");
  assert.equal(document.objects[2]?.parentObjectId, document.objects[1]?.objectId);
  assert.deepEqual(document.root?.bindings.map((binding) => binding.propertyPath), ["width"]);
});
