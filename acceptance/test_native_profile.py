import json
from pathlib import Path
import tempfile
import unittest

from native_profile import check_live_reports, validate_environment


class NativeProfileGate(unittest.TestCase):
    def test_versions_and_distribution_cannot_be_substituted(self):
        expected = {"node": "24.4.0", "qt": "6.4.2", "os_id": "ubuntu", "os_version": "24.04"}
        validate_environment(expected, dict(expected))
        for key in expected:
            wrong = {**expected, key: "different"}
            with self.assertRaisesRegex(ValueError, "Wrong native profile"):
                validate_environment(expected, wrong)

    def test_live_reports_require_all_scenarios_and_a_real_oracle(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "target/integration-qt"
            evidence.mkdir(parents=True)
            oracle = {"skipped": False, "qmllint_oracle": {"version": "6.4.2", "missing_expected": [], "error": None}}
            scenarios = ["release", "multi-config", "configure-failure", "build-failure", "test-failure"]
            integration = {"status": "pass", "results": [{"scenario": name, "status": "pass"} for name in scenarios]}
            (root / "03.log").write_text("npm banner\n" + json.dumps(oracle, indent=2))
            (evidence / "summary.json").write_text(json.dumps(integration))
            self.assertEqual(check_live_reports(root, root)["oracle_qt"], "6.4.2")
            oracle["qmllint_oracle"] = {"skipped": True, "reason": "not installed"}
            (root / "03.log").write_text(json.dumps(oracle, indent=2))
            with self.assertRaisesRegex(ValueError, "Qt oracle"):
                check_live_reports(root, root)
            oracle["qmllint_oracle"] = {"version": "6.4.2", "missing_expected": [], "error": None}
            (root / "03.log").write_text(json.dumps(oracle, indent=2))
            integration["results"].pop()
            (evidence / "summary.json").write_text(json.dumps(integration))
            with self.assertRaisesRegex(ValueError, "scenarios"):
                check_live_reports(root, root)
