#!/usr/bin/env python3
"""Run every declared native CI command in a clean checkout and exact tool profile.

Does not provision or impersonate tools. A missing Qt tool, skipped live oracle,
failed command, wrong profile or changed tracked source prevents a pass report.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time

HERE = Path(__file__).resolve().parent


def capture(command, root):
    return subprocess.check_output(command, cwd=root, text=True, stderr=subprocess.STDOUT, timeout=30).strip()


def validate_environment(expected, observed):
    for key, value in expected.items():
        if observed.get(key) != value:
            raise ValueError(f"Wrong native profile: {key}: expected {value!r}, got {observed.get(key)!r}")


def check_live_reports(root, output):
    oracle = (output / "03.log").read_text()
    # npm includes banners before the report; the live oracle is always a JSON object.
    start = oracle.find('{\n  "skipped"')
    if start < 0:
        raise ValueError("Missing live oracle JSON")
    report = json.loads(oracle[start:])
    qt = report.get("qmllint_oracle", {})
    if qt.get("skipped") or not qt.get("version") or qt.get("missing_expected") or qt.get("error"):
        raise ValueError("Qt oracle did not establish live expected diagnostics")
    integration = json.loads((root / "target/integration-qt/summary.json").read_text())
    expected = {"release", "multi-config", "configure-failure", "build-failure", "test-failure"}
    results = integration.get("results", [])
    if integration.get("status") != "pass" or {item.get("scenario") for item in results} != expected or any(item.get("status") != "pass" for item in results):
        raise ValueError("Native integration scenarios are missing or failed")
    return {"oracle_qt": qt["version"], "oracle_missing_expected": qt["missing_expected"], "integration": results}


def run(profile, root, output):
    plan = json.loads((HERE / "native-profiles.json").read_text())
    expected = plan["profiles"][profile]
    if platform.system() != "Linux" or platform.machine() != plan["architecture"]:
        raise ValueError("This native validation matrix declares Linux x86_64 only")
    if capture(["git", "status", "--porcelain"], root):
        raise ValueError("Native acceptance requires a clean checkout")
    revision = capture(["git", "rev-parse", "HEAD"], root)
    versions = {name: capture([name, "--version"], root).splitlines()[0] for name in ["node", "npm", "qmllint", "qmlformat", "cmake", "ctest", "ninja"]}
    os_release = platform.freedesktop_os_release()
    observed = {"node": versions["node"].removeprefix("v"), "qt": versions["qmllint"].split()[-1],
                "os_id": os_release["ID"], "os_version": os_release["VERSION_ID"]}
    validate_environment(expected, observed)
    output.mkdir(parents=True, exist_ok=False)
    if not (HERE / "test_native_profile.py").is_file():
        raise ValueError("Missing native-profile gate regressions")
    with (output / "runner-tests.log").open("w") as stream:
        subprocess.run(["python3", "-m", "unittest", "discover", "-s", str(HERE), "-p", "test_native_profile.py"],
                       cwd=root, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=60)
    results = []
    for index, command in enumerate(plan["commands"]):
        log = output / f"{index:02d}.log"
        started = time.monotonic()
        with log.open("w") as stream:
            result = subprocess.run(command, cwd=root, stdout=stream, stderr=subprocess.STDOUT, timeout=900)
        record = {"command": command, "exit": result.returncode, "duration_seconds": round(time.monotonic() - started, 3),
                  "log": log.name, "sha256": hashlib.sha256(log.read_bytes()).hexdigest()}
        results.append(record)
        print(json.dumps(record), flush=True)
        if result.returncode:
            raise ValueError(f"Native command failed; see {log}")
    live = check_live_reports(root, output)
    if capture(["git", "status", "--porcelain"], root) or capture(["git", "rev-parse", "HEAD"], root) != revision:
        raise ValueError("Native validation changed tracked source")
    report = {
        "status": "pass", "profile": profile, "revision": revision,
        "source_tree": capture(["git", "rev-parse", "HEAD:src"], root),
        "test_tree": capture(["git", "rev-parse", "HEAD:test"], root),
        "environment": observed, "versions": versions, "platform": platform.platform(),
        "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "plan_sha256": hashlib.sha256((HERE / "native-profiles.json").read_bytes()).hexdigest(),
        "runner_tests_sha256": hashlib.sha256((output / "runner-tests.log").read_bytes()).hexdigest(),
        "commands": results, "live_evidence": live,
    }
    (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, choices=json.loads((HERE / "native-profiles.json").read_text())["profiles"])
    parser.add_argument("--repository", type=Path, default=HERE.parent)
    parser.add_argument("--output", type=Path, required=True, help="New directory outside tracked source")
    args = parser.parse_args()
    print(json.dumps(run(args.profile, args.repository.resolve(), args.output.resolve()), indent=2))
