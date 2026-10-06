"""LUM-997 — stdlib unittest for the runner's pure helpers (needs the venv:
`$VENV/bin/python -m unittest scripts/analysis/lum997-agent-injection-bench/test_run.py`)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import report  # noqa: E402
import run  # noqa: E402


class RunHelpers(unittest.TestCase):
    def test_zdr_body_forces_zdr_and_pins_anthropic(self):
        body = json.dumps({"model": "anthropic/claude-sonnet-5.5", "providerOptions": {"gateway": {"zeroDataRetention": False}}}).encode()
        out = json.loads(run.zdr_body(body))
        self.assertEqual(out["providerOptions"]["gateway"], {"zeroDataRetention": True, "only": ["anthropic"]})

    def test_zdr_body_unpinned_model(self):
        out = json.loads(run.zdr_body(b'{"model":"deepseek/deepseek-v4-flash"}'))
        self.assertEqual(out["providerOptions"], {"gateway": {"zeroDataRetention": True}})

    def test_zdr_body_fails_closed(self):
        with self.assertRaises(ValueError):
            run.zdr_body(b"[1,2]")

    def test_pick_evenly_is_numeric_and_deterministic(self):
        ids = [f"user_task_{i}" for i in [10, 2, 0, 1, 3, 11, 4, 5, 6, 7, 8, 9]]
        self.assertEqual(run.pick_evenly(ids, 4), ["user_task_0", "user_task_3", "user_task_6", "user_task_9"])
        self.assertEqual(len(run.pick_evenly(ids, 50)), 12)

    def test_cost_and_rate(self):
        self.assertAlmostEqual(run.cost_of("anthropic/claude-sonnet-5.5", {"prompt_tokens": 1000, "completion_tokens": 100}), 0.003)
        self.assertEqual(run.rate([True, False, False, True]), 0.5)
        self.assertIsNone(run.rate([]))

    def test_read_env_key(self):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as f:
            f.write('OTHER=1\nAI_GATEWAY_API_KEY="abc"\n')
        self.assertEqual(run.read_env_key(Path(f.name)), "abc")


class ReportHelpers(unittest.TestCase):
    def test_pooled_weights_by_n(self):
        rows = [
            {"utility": 1.0, "nUtility": 2, "utilityUnderAttack": 0.5, "asr": 0.0, "nAttack": 2},
            {"utility": 0.0, "nUtility": 2, "utilityUnderAttack": 1.0, "asr": 1.0, "nAttack": 6},
        ]
        self.assertEqual(report.pooled(rows), {"nUtility": 4, "utility": 0.5, "nAttack": 8, "utilityUnderAttack": 0.875, "asr": 0.75})


if __name__ == "__main__":
    unittest.main()
