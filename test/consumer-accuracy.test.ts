import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { parseQmlDocument } from "../src/qml-parser.js";

// Each case reproduces a false positive observed while analyzing Shelllist.
function analyzeProject(t: TestContext, files: Record<string, string>, config: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-consumer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  }
  const configFile = path.join(root, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", ...config }));
  return createAnalysisContext(loadConfig(configFile));
}

function kinds<T extends { kind: string; file?: string }>(findings: T[], kind: string, file?: string): T[] {
  return findings.filter((finding) => finding.kind === kind && (file === undefined || finding.file === file));
}

test("object-valued and handler bindings are not scored as expression binding complexity", (t) => {
  const context = analyzeProject(t, {
    "Main.qml": `import QtQuick
Item {
  ListView {
    delegate: Rectangle {
      width: a && b && c ? 1 : 2
      height: d || e || f || g ? 1 : 2
      MouseArea { onClicked: Qt.openUrlExternally(url) }
    }
  }
  Timer { onTriggered: a && b && c && d && e && f ? run() : stop() }
}`,
  });
  assert.equal(context.bindings.find((binding) => binding.property === "delegate")?.complexity, 1);
  const flagged = kinds(context.findings, "complexity.binding").map((finding) => finding.message.split(" ")[0]);
  assert.ok(!flagged.includes("delegate"));
  assert.ok(!flagged.includes("onTriggered"));
  assert.equal(kinds(context.findings, "qml.side_effect_in_binding").length, 0);
});

test("Qt Quick tests deriving from a project TestCase wrapper and ShellRoot smoke files are entrypoints", (t) => {
  const context = analyzeProject(t, {
    "tests/DaemonTestCase.qml": "import QtQuick\nimport QtTest\nTestCase { property int daemon: 1 }",
    "tests/tst_displays.qml": "import QtQuick\nDaemonTestCase {\n  function test_layout() { compare(daemon, 1) }\n}",
    "tests/smoke.qml": "import Quickshell\nShellRoot {}",
    "tests/imports/Process.qml": "import QtQuick\nQtObject { property bool running }",
    "Orphan.qml": "import QtQuick\nItem {}",
  }, { external_modules: ["QtTest"] });
  assert.ok(context.resolution.testCaseFiles.has("tests/tst_displays.qml"));
  assert.ok(context.resolution.entrypoints.has("tests/tst_displays.qml"));
  assert.ok(context.resolution.entrypoints.has("tests/smoke.qml"));
  const unused = kinds(context.findings, "cleanup.unused_component").map((finding) => finding.file);
  assert.deepEqual(unused.sort(), ["Orphan.qml", "tests/imports/Process.qml"]);
});

test("public API reads through typed properties, ids, Connections, and inheritance count as uses", (t) => {
  const context = analyzeProject(t, {
    "ui/qmldir": "module Demo.Ui\nBaseController 1.0 BaseController.qml\nController 1.0 Controller.qml\n",
    "ui/BaseController.qml": "import QtQuick\nItem {\n  property int inheritedRead: 1\n  property int unusedBase: 1\n  signal handledRequested\n}",
    "ui/Controller.qml": "import QtQuick\nBaseController {\n  readonly property int derived: inheritedRead\n  property int typedRead: 1\n  property int idRead: 1\n  property int optionalRead: 1\n  property int unused: 1\n}",
    "Main.qml": `import QtQuick
import Demo.Ui
Item {
  Controller { id: shared }
  Pane { controller: shared }
  property int fromId: shared.idRead
}`,
    "Pane.qml": `import QtQuick
import Demo.Ui
Item {
  id: pane
  required property Controller controller
  width: pane.controller.typedRead + controller?.optionalRead + controller.derived
  Connections {
    target: pane.controller
    function onHandledRequested() {}
  }
}`,
  }, { entrypoints: ["Main.qml"] });
  const unused = [...kinds(context.findings, "cleanup.unused_public_property"), ...kinds(context.findings, "cleanup.unused_public_signal")]
    .map((finding) => `${finding.file}:${finding.message.match(/'([^']+)'/)?.[1]}`);
  assert.deepEqual(unused.sort(), ["ui/BaseController.qml:unusedBase", "ui/Controller.qml:unused"]);
});

test("public API cleanup skips unknown reads and propagates uncertainty to bases", (t) => {
  const context = analyzeProject(t, {
    "qmldir": "module Demo\nBase 1.0 Base.qml\nDerived 1.0 Derived.qml\n",
    "Base.qml": "import QtQuick\nItem { property int observed: 1; signal requested }",
    "Derived.qml": `import QtQuick
Base {
  function read(name) { return this[name] }
}`,
    "Main.qml": "import QtQuick\nItem { Derived {} }",
  });
  assert.equal(context.findings.filter((finding) => finding.kind.startsWith("cleanup.unused_public_")).length, 0);
  for (const rule of ["cleanup.unused_public_property", "cleanup.unused_public_signal"]) {
    const targets = context.ruleCoverage.find((record) => record.rule === rule)?.targets;
    for (const file of ["Base.qml", "Derived.qml"]) assert.equal(targets?.find((target) => target.file === file)?.reason, "dynamic_property_access");
  }
});

test("QML casts preserve public members read through local variables", (t) => {
  const context = analyzeProject(t, {
    "ui/qmldir": "module Demo.Ui\nAction 1.0 Action.qml\n",
    "ui/Action.qml": 'import QtQuick\nQtObject {\n property string keys: "Ctrl+J"\n property int unused: 1\n}',
    "Main.qml": `import QtQuick
import Demo.Ui as Ui
Item {
  Ui.Action {}
  function help() {
    const shortcut = resources[0] as Ui.Action;
    return shortcut.keys;
  }
}`,
  });
  assert.deepEqual(kinds(context.findings, "cleanup.unused_public_property").map((finding) => finding.message.match(/'([^']+)'/)?.[1]), ["unused"]);
});

test("binding loss ignores dependency-free initializers but keeps reactive bindings", (t) => {
  const context = analyzeProject(t, {
    "Main.qml": `import QtQuick
Item {
  id: card
  property double nowMs: Date.now()
  property int doubled: card.width * 2
  Timer { onTriggered: { card.nowMs = Date.now(); card.doubled = 3 } }
}`,
  });
  const lost = kinds(context.findings, "qml.binding_loss").map((finding) => finding.message);
  assert.equal(lost.length, 1);
  assert.match(lost[0] ?? "", /card\.doubled/);
});

test("inline components are local types with their own id scope", (t) => {
  const document = parseQmlDocument(`import QtQuick
Item {
  property var groups: [{
    name: "a" }]
  component ToastGroup: Item { property int n: outer.width }
  Repeater { delegate: ToastGroup {} }
  Item { id: outer }
}`, "Main.qml");
  assert.deepEqual(document.inlineComponents.map((component) => component.name), ["ToastGroup"]);
  assert.equal(document.bindings.find((binding) => binding.propertyPath === "groups")?.expression, '[{\n    name: "a" }]');
  assert.equal(document.bindings.some((binding) => binding.propertyPath === "ToastGroup"), false);
  assert.equal(document.idReferences.find((reference) => reference.name === "outer")?.targetObjectId, null);

  const context = analyzeProject(t, {
    "Main.qml": "import QtQuick\nItem {\n  component ToastGroup: Item {}\n  ToastGroup {}\n  Cards.Card {}\n}",
    "Cards.qml": "import QtQuick\nItem {\n  component Card: Rectangle {}\n}",
  });
  assert.equal(kinds(context.findings, "resolution.unknown_type").length, 0);
  assert.ok(context.resolution.componentUses.some((use) => use.from === "Main.qml" && use.typeName === "Cards.Card" && use.target === "Cards.qml"));
});

test("bound inline components capture outer ids without leaking their own ids", (t) => {
  const source = `pragma ComponentBehavior: Bound
import QtQuick
Item {
  id: outer
  component First: Item {
    id: local
    width: outer.width
  }
  component Second: Item {
    width: local.width
  }
  component Shadow: Item {
    id: outer
    property real captured: outer.width
  }
  First {}
  Second {}
  Shadow {}
  height: local.height
}`;
  const context = analyzeProject(t, { "Main.qml": source });
  const document = context.qmlDocuments[0]!.document;
  const first = document.objects.find((object) => object.idName === "local")!;
  const shadow = document.objects.find((object) => object.idName === "outer" && object !== document.root)!;
  assert.equal(first.references.find((reference) => reference.name === "outer")?.targetObjectId, document.root?.objectId);
  assert.equal(shadow.references.find((reference) => reference.name === "outer")?.targetObjectId, shadow.objectId);
  const localReferences = document.idReferences.filter((reference) => reference.name === "local");
  assert.equal(localReferences.length, 2);
  assert.ok(localReferences.every((reference) => reference.targetObjectId === null));
  assert.deepEqual(kinds(context.findings, "cleanup.unused_id").map((finding) => finding.message.match(/'([^']+)'/)?.[1]), ["local"]);
});

test("same-named typed properties and ids retain all candidate member uses", (t) => {
  for (const throughProperty of [true, false]) {
    const consumers = ["First", "Second"].map((type) => {
      const name = type.toLowerCase();
      return throughProperty ? `Item {
        property ${type} controller: ${type} {}
        width: controller.${name}Value
        Connections { target: controller; function on${type}Requested() {} }
      }` : `Component {
        ${type} {
          id: controller
          width: controller.${name}Value
          Connections { target: controller; function on${type}Requested() {} }
        }
      }`;
    });
    for (const ordered of [consumers, [...consumers].reverse()]) {
      const context = analyzeProject(t, {
        "qmldir": "module Demo\nFirst 1.0 First.qml\nSecond 1.0 Second.qml\n",
        "First.qml": "import QtQuick\nItem {\n  property int firstValue: 1\n  signal firstRequested\n  property int unused: 1\n}",
        "Second.qml": "import QtQuick\nItem {\n  property int secondValue: 1\n  signal secondRequested\n  property int unused: 1\n}",
        "Main.qml": `import QtQuick\nItem {\n${ordered.join("\n")}\n}`,
      });
      const unused = [...kinds(context.findings, "cleanup.unused_public_property"), ...kinds(context.findings, "cleanup.unused_public_signal")]
        .map((finding) => `${finding.file}:${finding.message.match(/'([^']+)'/)?.[1]}`);
      assert.deepEqual(unused.sort(), ["First.qml:unused", "Second.qml:unused"]);
      for (const type of ["First", "Second"]) {
        const members = context.resolution.typedMemberUses.find((use) => use.target === `${type}.qml`)?.memberNames ?? [];
        assert.ok(members.includes(`${type.toLowerCase()}Value`));
        assert.ok(members.includes(`${type.toLowerCase()}Requested`));
      }
    }
  }
});

test("test doubles are exempt from process-boundary and Qt Test callback typing findings", (t) => {
  const context = analyzeProject(t, {
    "tests/tst_wifi.qml": `import QtQuick
import QtTest
TestCase {
  function test_protocol(data) {
    const response = { protocol: "nm-api" };
    verify(response);
    compare(data.value, 1);
  }
  function helper(value) {
    const a = value;
    const b = a;
    return b;
  }
}`,
    "Presenter.qml": "import QtQuick\nItem { property string command: \"nm-api status\" }",
  }, { external_modules: ["QtTest"] });
  assert.deepEqual(kinds(context.findings, "boundary.process_calls_in_qml").map((finding) => finding.file), ["Presenter.qml"]);
  assert.deepEqual(kinds(context.findings, "qml.function_missing_types").map((finding) => finding.message.match(/'([^']+)'/)?.[1]), ["helper"]);
});

test("color literals are counted only as quoted colors outside design-token files", (t) => {
  const context = analyzeProject(t, {
    "Theme.qml": `pragma Singleton\nimport QtQuick\nQtObject {\n${["#111", "#222", "#333", "#444", "#555"].map((color, index) => `  property color c${index}: "${color}"`).join("\n")}\n}`,
    "Card.qml": `import QtQuick
Rectangle {
  property string issue: "Fixes #123 and #4567"
  color: "#ff0000"
  border.color: "#00ff00cc"
  Text { color: Qt.rgba(1, 0, 0, 1) }
}`,
  });
  assert.equal(context.components.find((component) => component.file === "Theme.qml")?.hardcodedColors, 0);
  assert.equal(context.components.find((component) => component.file === "Card.qml")?.hardcodedColors, 3);
  assert.equal(kinds(context.findings, "styling.hardcoded_colors").length, 0);
});
