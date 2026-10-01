import copy
from pathlib import Path
import tempfile
import unittest

from determinism import compare, run


class DeterminismContract(unittest.TestCase):
    def test_only_declared_envelope_identity_is_volatile(self):
        original = {"sample.json": {"generated_at": "old", "provenance": {
            "generated_at": "old", "run_id": "one", "source_hash": "source"
        }, "findings": [{"id": "one"}, {"id": "two"}], "measurement": {"generated_at": "input-time"}}}
        repeated = copy.deepcopy(original)
        repeated["sample.json"]["generated_at"] = "new"
        repeated["sample.json"]["provenance"].update(generated_at="new", run_id="two")
        compare(original, repeated)
        for mutate in (
            lambda value: value["provenance"].update(source_hash="different"),
            lambda value: value["findings"].reverse(),
            lambda value: value["measurement"].update(generated_at="different input"),
            lambda value: value.update(extra="unexpected"),
        ):
            changed = copy.deepcopy(repeated)
            mutate(changed["sample.json"])
            with self.assertRaisesRegex(ValueError, "Nonvolatile output"):
                compare(original, changed)
        with self.assertRaisesRegex(ValueError, "Artifact set"):
            compare(original, {})

    def test_fresh_process_cli_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            result = run(None, Path(directory) / "captures")
            self.assertEqual(result["status"], "pass")
            self.assertEqual(len(result["observations"]), 3)
            self.assertEqual(len({item["normalized_sha256"] for item in result["observations"]}), 1)
            self.assertEqual(len({item["run_id"] for item in result["observations"]}), 3)
            self.assertGreaterEqual(result["artifacts_per_run"], 26)

    def test_one_run_is_not_determinism_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "three"):
                run(None, Path(directory) / "captures", runs=1)
