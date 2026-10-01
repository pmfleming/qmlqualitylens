#!/usr/bin/env python3
"""Fresh-process static analysis regression; never executes consumer commands.

Live test/profiler measurements are new inputs, not deterministic source analysis.
Only envelope generated_at and provenance generated_at/run_id may differ. Do not
sort result arrays, erase paths, or discard finding/evidence/measurement fields.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

REPOSITORY = Path(__file__).resolve().parents[1]
TOOLS = ("cmake", "ctest", "qmllint", "qmlformat", "qmltestrunner", "runtime", "qml_profiler", "parser_oracle")


def normalize(artifact):
    value = json.loads(json.dumps(artifact))
    value.pop("generated_at", None)
    provenance = value.get("provenance", {})
    provenance.pop("generated_at", None)
    provenance.pop("run_id", None)
    return value


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def compare(expected, actual):
    if expected.keys() != actual.keys():
        raise ValueError("Artifact set changed")
    for name in expected:
        if normalize(expected[name]) != normalize(actual[name]):
            raise ValueError(f"Nonvolatile output changed: {name}")


def fixture(root):
    root.mkdir()
    (root / "Main.qml").write_text('''import QtQuick
Item {
    id: root
    property bool flag: true
    property int source: 10
    width: source
    function decide(value) { return /if|while|catch/.test(value) ? `value ${flag ? 1 : 2}` : ""; }
    Component { Item { id: shared; width: root.width; Component.onCompleted: shared.width = 10 } }
    Component { Item { id: shared; width: 20 } }
    Connections { target: model.target; function onReady() {} }
    Loader { source: "Child.qml" }
}
''')
    (root / "Child.qml").write_text("import QtQuick\nItem { property var answer: 42 }\n")
    # Declared configuration, not a tool to execute. A selected tool must never run.
    config = root / "quality.json"
    config.write_text(json.dumps({"project_root": ".", "source_roots": ["."], "tools": {
        "runtime": {"check": True, "command": "THIS-COMMAND-MUST-NOT-RUN"}
    }}))
    return config


def run(config_file, output, runs=3, node="node", cli=None):
    if runs < 3:
        raise ValueError("At least three fresh-process runs are required")
    output.mkdir(parents=True, exist_ok=False)
    config_file = config_file.resolve() if config_file else fixture(output / "fixture")
    raw = json.loads(config_file.read_text())
    project = (config_file.parent / raw.get("project_root", ".")).resolve()
    raw["project_root"] = str(project)
    raw["output_dir"] = str(output / "artifacts")
    raw["reports"] = {}
    raw.pop("qmllint_command", None)
    raw.pop("qmllint_report", None)
    for tool in TOOLS:
        raw.setdefault("tools", {}).setdefault(tool, {})["check"] = False
    configured = output / "static.config.json"
    configured.write_text(json.dumps(raw, indent=2) + "\n")
    cli = cli or REPOSITORY / "dist/bin/qmlqualitylens.js"
    snapshots = []
    observations = []
    for number in range(1, runs + 1):
        artifacts = output / "artifacts"
        if artifacts.exists():
            shutil.rmtree(artifacts)
        capture = output / f"run-{number}"
        capture.mkdir()
        commands = [
            ["measure", "all"],
            ["audit", "--format", "json"],
            ["audit", "--format", "sarif"],
        ]
        exits = []
        for index, arguments in enumerate(commands):
            command = [node, str(cli), *arguments, "--config", str(configured)]
            result = subprocess.run(command, cwd=REPOSITORY, capture_output=True, text=True, timeout=300)
            (capture / f"command-{index}.stdout").write_text(result.stdout)
            (capture / f"command-{index}.stderr").write_text(result.stderr)
            exits.append(result.returncode)
            if result.returncode not in (0, 1) or (index == 0 and result.returncode != 0):
                raise ValueError(f"CLI failed: {command}: {result.stderr}")
            # Exit 1 is an ordinary failing audit verdict, not a command failure.
            if index:
                value = json.loads(result.stdout)
                (capture / ("audit-json.json" if index == 1 else "audit-sarif.json")).write_text(json.dumps(value))
                if index == 1 and (result.returncode == 1) != (value["summary"]["verdict"] == "fail"):
                    raise ValueError("Audit exit and verdict disagree")
        for source in artifacts.glob("*.json"):
            shutil.copyfile(source, capture / source.name)
        snapshot = {file.name: json.loads(file.read_text()) for file in sorted(capture.glob("*.json"))}
        required = {"qml_quality_report.json", "quality_contract.json", "semantic_rules.json", "audit.json", "audit-json.json", "audit-sarif.json"}
        if not required <= snapshot.keys():
            raise ValueError("Missing required output artifacts")
        identity = snapshot["qml_quality_report.json"]["provenance"]
        if snapshots:
            compare(snapshots[0], snapshot)
            if exits != observations[0]["exits"]:
                raise ValueError("CLI exit codes changed")
            if identity["run_id"] == observations[0]["run_id"]:
                raise ValueError("Fresh analysis reused run identity")
        snapshots.append(snapshot)
        observations.append({"run_id": identity["run_id"], "exits": exits,
                             "normalized_sha256": digest({name: normalize(value) for name, value in snapshot.items()})})
    report = {
        "status": "pass", "profile": "fresh-process static measure-all + JSON/SARIF audit",
        "scope": "Identical source/config/tool profile; consumer execution and imported reports disabled explicitly",
        "source_config": str(config_file), "source_hash": identity["source_hash"],
        "config_hash": identity["config_hash"], "tool_versions": identity["tool_versions"],
        "artifacts_per_run": len(snapshots[0]), "observations": observations,
        "volatile_paths": ["$.generated_at", "$.provenance.generated_at", "$.provenance.run_id"],
    }
    (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--output", type=Path, help="New directory for raw captures (must not exist)")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    output = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix="qml-determinism-")) / "evidence"
    print(json.dumps(run(args.config, output, args.runs, args.node), indent=2))
