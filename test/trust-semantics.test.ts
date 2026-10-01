import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { confidence } from "../src/provenance.js";
import { GENERIC_RULE_REQUIREMENTS } from "../src/rule-prerequisites.js";
import { measureQualityContract } from "../src/measures/contract.js";
import { measureHotspots } from "../src/measures/hotspots.js";

function fixture(files: Record<string, string>, raw: Record<string, unknown>, run: (context: ReturnType<typeof createAnalysisContext>, root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qml-trust-semantics-"));
  try {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), text);
    }
    const config = path.join(root, "quality.json");
    fs.writeFileSync(config, JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "out", ...raw }));
    run(createAnalysisContext(loadConfig(config)), root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function rule(context: ReturnType<typeof createAnalysisContext>, id: string) {
  const coverage = context.ruleCoverage.find((item) => item.rule === id);
  assert.ok(coverage, id);
  assert.equal(coverage.applicable, coverage.evaluated + coverage.skipped);
  return coverage;
}

const minimal = "import QtQuick\nItem { property int count: 1 }\n";

test("every generic rule declares prerequisites, and unresolved types do not poison independent syntax counts", () => {
  fixture({ "Main.qml": minimal }, {}, (context) => {
    const specialized = new Set(["qml.binding_loss", "qml.binding_cycle", "qml.connections.unknown_target", "qml.connection_signal_mismatch", "qml.side_effect_in_binding", "cleanup.unused_public_property", "cleanup.unused_public_signal"]);
    assert.deepEqual(context.ruleCoverage.filter((item) => !specialized.has(item.rule)).map((item) => item.rule).sort(), Object.keys(GENERIC_RULE_REQUIREMENTS).sort());
    for (const id of Object.keys(GENERIC_RULE_REQUIREMENTS)) assert.equal(rule(context, id).evaluated, 1, id);
    assert.equal(confidence(context).complete, true);
  });
  fixture({ "Main.qml": "import Missing.Module\nUnknownThing { property var value: 42 }\n" }, {}, (context) => {
    assert.equal(confidence(context).complete, false);
    for (const [id, requirements] of Object.entries(GENERIC_RULE_REQUIREMENTS)) {
      if (requirements.includes("resolution")) {
        assert.equal(rule(context, id).evaluated, 0, id);
        assert.equal(rule(context, id).skip_reasons.unresolved_import, 1, id);
      } else assert.equal(rule(context, id).evaluated, 1, id);
    }
  });
});

test("missing, malformed and ambiguous type metadata remain partial through confidence and type-dependent rules", () => {
  for (const content of [undefined, "this is not qmltypes"]) {
    fixture({ "Main.qml": minimal, ...(content ? { "types.qmltypes": content } : {}) }, { tools: { qmllint: { qmltypes: ["types.qmltypes"] } } }, (context) => {
      assert.equal(context.typeEvidence.status, "partial");
      assert.equal(confidence(context).complete, false);
      assert.equal(rule(context, "qml.layout_conflict.anchors_with_layout").skip_reasons.incomplete_type_metadata, 1);
      assert.equal(rule(context, "qml.prefer_typed_property").evaluated, 1);
    });
  }
  fixture({ "Main.qml": 'import QtQuick\nCustomButton { icon.name: "go" }\n' }, { external_types: ["CustomButton"] }, (context) => {
    assert.equal(context.resolution.unresolvedTypes.length, 0, "declared external identity is not type metadata");
    assert.equal(rule(context, "qml.accessibility.icon_only_control").skip_reasons.unmodeled_external_hierarchy, 1);
    assert.equal(confidence(context).complete, false);
  });
  fixture({ "A.qml": "B {}\n", "B.qml": "A {}\n" }, {}, (context) => {
    assert.equal(rule(context, "qml.layout_conflict.anchors_with_layout").skip_reasons.cyclic_type_hierarchy, 2);
    assert.equal(confidence(context).complete, false);
  });
  fixture({ "Main.qml": minimal, "a/Widget.qml": minimal, "b/Widget.qml": minimal }, {}, (context) => {
    assert.equal(context.typeEvidence.status, "partial");
    assert.equal(context.typeEvidence.types.get("Widget")?.ambiguous, true);
    assert.equal(confidence(context).complete, false);
  });
});

test("binding rules abstain on unresolved assignment members, owners and indirect dependencies", () => {
  for (const [source, id, reason] of [
    ["Item { function run() { injected.width = 2 } }", "qml.binding_loss", "unresolved_assignment_owner"],
    ["Item { function run() { width = 2 } }", "qml.binding_loss", "unresolved_assignment_member"],
    ["Item { property int result: calculate(); function calculate() { return result } }", "qml.binding_cycle", "indirect_binding_dependency"],
    ["Item { property int result: parent.width }", "qml.binding_cycle", "unresolved_binding_owner"],
    ["Item { property int result: inheritedValue }", "qml.binding_cycle", "unresolved_binding_member"],
    ["Item { property int result: model[key] }", "qml.binding_cycle", "dynamic_property_access"],
  ]) {
    fixture({ "Main.qml": `import QtQuick\n${source}\n` }, {}, (context) => {
      assert.equal(rule(context, id!).evaluated, 0, source);
      assert.equal(rule(context, id!).skip_reasons[reason!], 1, source);
      assert.ok(!context.findings.some((finding) => finding.kind === id));
      assert.equal(confidence(context).complete, false);
    });
  }
  fixture({ "Main.qml": "import QtQuick\nItem { property int first: second; property int second: first }\n" }, {}, (context) => {
    assert.equal(rule(context, "qml.binding_cycle").evaluated, 1);
    assert.equal(context.findings.filter((item) => item.kind === "qml.binding_cycle").length, 1);
  });
});

test("only resolved Qt side effects block; ambiguous names, shadowed globals and deferred calls abstain", () => {
  fixture({ "Main.qml": 'import QtQuick\nItem { property bool opened: Qt.openUrlExternally("https://example.com") }\n' }, {}, (context) => {
    assert.equal(rule(context, "qml.side_effect_in_binding").evaluated, 1);
    assert.equal(context.findings.filter((item) => item.kind === "qml.side_effect_in_binding" && item.enforcement === "block").length, 1);
  });
  for (const expression of ['exec("command")', 'backend.spawn("command")', 'String(model)', 'Math.max(model, 1)', '{ const Qt = { openUrlExternally: () => true }; return Qt.openUrlExternally("x"); }', '(() => Qt.openUrlExternally("x"))']) {
    fixture({ "Main.qml": `import QtQuick\nItem { property var value: ${expression} }\n` }, { policy: { incomplete: "fail" } }, (context) => {
      assert.equal(rule(context, "qml.side_effect_in_binding").evaluated, 0, expression);
      assert.ok(!context.findings.some((finding) => finding.kind === "qml.side_effect_in_binding"));
      const audit = runAudit(context.config, "trust-test", { base: null, baseline: null, saveBaseline: null });
      assert.equal(audit.summary.verdict, "fail");
      assert.ok(audit.summary.incomplete_checks.some((reason) => reason.includes("qml.side_effect_in_binding")));
      assert.equal(measureQualityContract(context.config, "trust-test", context).summary.verdict, "fail");
    });
  }
  fixture({
    "Main.qml": 'import QtQuick\nimport "fake.js" as Qt\nItem { property bool value: Qt.openUrlExternally("x") }\n',
    "fake.js": '.pragma library\nfunction openUrlExternally(value) { return true; }\n',
  }, {}, (context) => {
    assert.equal(rule(context, "qml.side_effect_in_binding").skip_reasons.unresolved_call_target, 1);
    assert.ok(!context.findings.some((finding) => finding.kind === "qml.side_effect_in_binding"));
  });
  fixture({ "Main.qml": 'import QtQuick\nItem { property int value: Math.max(1, 2); Component.onCompleted: Qt.openUrlExternally("x") }\n' }, {}, (context) => {
    assert.equal(rule(context, "qml.side_effect_in_binding").evaluated, 1);
    assert.ok(!context.findings.some((finding) => finding.kind === "qml.side_effect_in_binding"));
  });
});

test("dynamic consumer reads and opaque calls cannot certify unused public API", () => {
  for (const body of ['return widget[key]', 'return external.read(widget)', 'return eval("widget.needed")']) {
    fixture({
      "qmldir": "module Demo\nWidget 1.0 Widget.qml\n",
      "Widget.qml": "import QtQuick\nItem { property int needed: 1 }\n",
      "Main.qml": `import QtQuick\nItem { Widget { id: widget }; function read(key) { ${body} } }\n`,
    }, {}, (context) => {
      const target = rule(context, "cleanup.unused_public_property").targets?.find((item) => item.file === "Widget.qml");
      assert.equal(target?.status, "skipped", body);
      assert.ok(!context.findings.some((item) => item.file === "Widget.qml" && item.kind === "cleanup.unused_public_property"));
    });
  }
});

test("generic expression prerequisites expose unsupported JavaScript rather than evaluated negative rules", () => {
  fixture({ "Main.qml": "import QtQuick\nItem { property var result: model[key] }\n" }, {}, (context) => {
    for (const [id, requirements] of Object.entries(GENERIC_RULE_REQUIREMENTS)) {
      if (requirements.includes("expressions")) assert.equal(rule(context, id).skip_reasons.dynamic_property_access, 1, id);
    }
    assert.equal(rule(context, "qml.api_surface").evaluated, 1, "declaration counts do not require resolving a computed read");
  });
});

test("missing optional JS parser cannot yield complete aggregate complexity or binding evidence", () => {
  fixture({ "Main.qml": 'import QtQuick\nItem { property int value: flag ? 1 : 2; function decide(s) { return /if|while/.test(s); } }\n' }, { exclude: ["standalone"] }, (context, root) => {
    const install = path.join(root, "standalone");
    fs.cpSync(path.resolve("dist/src"), path.join(install, "src"), { recursive: true });
    fs.writeFileSync(path.join(install, "package.json"), '{"type":"module"}');
    const module = (name: string) => JSON.stringify(pathToFileURL(path.join(install, "src", name)).href);
    const program = `import { createAnalysisContext } from ${module("analyzer.js")};
      import { loadConfig } from ${module("config.js")};
      import { confidence } from ${module("provenance.js")};
      import { measureHotspots } from ${module("measures/hotspots.js")};
      const c = createAnalysisContext(loadConfig(${JSON.stringify(context.config.configPath)}));
      console.log(JSON.stringify({confidence:confidence(c),functions:c.functions,bindings:c.bindings,hotspots:measureHotspots(c.config,"test",c)}));`;
    const execution = spawnSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
    assert.equal(execution.status, 0, execution.stderr);
    const result = JSON.parse(execution.stdout);
    assert.equal(result.confidence.complete, false);
    assert.ok(result.confidence.approximate_function_metrics > 0);
    assert.ok(result.confidence.approximate_binding_metrics > 0);
    assert.ok(result.functions.every((item: { complexityEvidence: { complete: boolean } }) => !item.complexityEvidence.complete));
    assert.equal(result.hotspots.records[0].metrics.complexity_complete, false);
    // The installed-parser control must still produce exact syntax metrics.
    assert.equal(context.functions[0]?.complexityEvidence?.complete, true);
    assert.equal(measureHotspots(context.config, "test", context).records[0]?.metrics.complexity_complete, true);
  });
});
