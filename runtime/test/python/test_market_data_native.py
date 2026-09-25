"""Provider-free owned-worker regressions; copied native bridge has an explicit probe.

Synthetic JSON/process cases exercise Pythia framing and cleanup, not providers.
"""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

from test_market_data_identity import PACKAGE
WORKER = __import__('importlib').import_module(PACKAGE + '.process')


class WorkerTest(unittest.TestCase):
    def run_worker(self, source, request=None, **kwargs):
        return WORKER.run_worker([sys.executable, "-c", source], request,
            {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}, **kwargs)

    def test_bounded_json_and_safe_failures(self):
        value = {"decimal": "12.3400", "missing": None}
        self.assertEqual(self.run_worker("import sys; print(sys.stdin.readline())",
            value, cancelled=lambda: False), value)
        with self.assertRaisesRegex(WORKER.WorkerError, "worker_failed"):
            self.run_worker("import sys; sys.stderr.write('private-canary'); sys.exit(2)",
                cancelled=lambda: False)
        with self.assertRaisesRegex(WORKER.WorkerError, "output_limit"):
            self.run_worker("import sys; sys.stdout.write('x'*2100000)", cancelled=lambda: False)
        # A connector may raise the bound for a documented bulk read, within a cap.
        self.assertEqual(len(self.run_worker("import json; print(json.dumps('x'*2100000))",
            cancelled=lambda: False, output_limit=3_000_000)), 2100000)
        with self.assertRaisesRegex(WORKER.WorkerError, "invalid_request"):
            self.run_worker("print(1)", cancelled=lambda: False, output_limit=16_000_001)

    def test_deadline_reaps_owned_process(self):
        with tempfile.TemporaryDirectory() as raw:
            pidfile = Path(raw) / "pid"
            source = "import os, pathlib, threading; p=pathlib.Path(%r); p.with_suffix('.tmp').write_text(str(os.getpid())); os.replace(p.with_suffix('.tmp'),p); threading.Event().wait()" % str(pidfile)
            with self.assertRaisesRegex(WORKER.WorkerError, "timeout"):
                self.run_worker(source, timeout=0.3, cancelled=lambda: False)
            pid = int(pidfile.read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    def test_cancellation_after_child_closes_output(self):
        with tempfile.TemporaryDirectory() as raw:
            pidfile = Path(raw) / "pid"
            source = "import os, pathlib, threading; os.close(1); os.close(2); p=pathlib.Path(%r); p.with_suffix('.tmp').write_text(str(os.getpid())); os.replace(p.with_suffix('.tmp'),p); threading.Event().wait()" % str(pidfile)
            with self.assertRaisesRegex(WORKER.WorkerError, "cancelled"):
                self.run_worker(source, timeout=3, cancelled=pidfile.exists)
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pidfile.read_text()), 0)

    def test_cancellation_waits_for_observed_start_then_reaps(self):
        with tempfile.TemporaryDirectory() as raw:
            pidfile = Path(raw) / "pid"
            source = "import os, pathlib, threading; p=pathlib.Path(%r); p.with_suffix('.tmp').write_text(str(os.getpid())); os.replace(p.with_suffix('.tmp'),p); threading.Event().wait()" % str(pidfile)
            with self.assertRaisesRegex(WORKER.WorkerError, "cancelled"):
                self.run_worker(source, timeout=3, cancelled=pidfile.exists)
            pid = int(pidfile.read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)


if __name__ == "__main__":
    unittest.main()
