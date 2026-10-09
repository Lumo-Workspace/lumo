#!/usr/bin/env python3
"""Exercise the release audit in a disposable Git repository (requires Gitleaks)."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent


class SecretAuditTest(unittest.TestCase):
    def test_reviewed_fixture_mutation_and_deleted_secret(self):
        with tempfile.TemporaryDirectory(prefix="lumo-audit-test-") as directory:
            repo = Path(directory)
            for file in (
                "scripts/audit-secrets.py", ".gitleaks.toml",
                "docs/open-source/secret-scan-false-positives.json",
                "docs/open-source/historical-credential-rotations.json",
            ):
                (repo / file).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / file, repo / file)

            def git(*args):
                return subprocess.check_output(
                    ["git", "-C", str(repo), "-c", "core.hooksPath=/dev/null", *args],
                    stderr=subprocess.DEVNULL,
                )

            git("init", "-q")
            git("config", "user.name", "Audit test")
            git("config", "user.email", "audit-test@example.invalid")
            (repo / ".gitignore").write_text("*.report.json\n")
            file = "__tests__/security-scan/sarif.test.ts"
            entries = json.loads((ROOT / "docs/open-source/secret-scan-false-positives.json").read_text())
            hashes = {x["contentSha256"] for x in entries["falsePositives"] if x["file"] == file}
            line = next(
                line for line in (ROOT / file).read_text().splitlines()
                if hashlib.sha256(line.encode()).hexdigest() in hashes
            )
            fixture = repo / file
            fixture.parent.mkdir(parents=True)
            fixture.write_text(line + "\n")

            def commit():
                git("add", "-A")
                git("commit", "-qm", "Synthetic audit verification fixture")

            def scan(mode):
                report = repo / (mode + ".report.json")
                result = subprocess.run(
                    ["python3", str(repo / "scripts/audit-secrets.py"), mode, "--report", str(report)],
                    env=os.environ.copy(), capture_output=True, text=True,
                )
                self.assertTrue(report.exists(), "Audit must produce a metadata report")
                return result.returncode, json.loads(report.read_text())

            commit()
            code, report = scan("snapshot")
            self.assertEqual((code, report["reviewedFalsePositives"], report["unresolved"]), (0, 1, 0))

            changed = re.sub(
                r"AKIA[A-Z0-9]{16}",
                lambda match: match[0][:-1] + ("Z" if match[0][-1] != "Z" else "Y"), line,
            )
            self.assertNotEqual(line, changed)
            fixture.write_text(changed + "\n")
            commit()
            code, report = scan("snapshot")
            self.assertEqual((code, report["unresolved"]), (1, 1))

            fixture.unlink()
            # A synthetic, never-issued URL exercises the extra database rule.
            (repo / ".env.production").write_text(
                "\n" * 11 + "DATABASE_URL=postgresql://audit_user:"
                + "".join(["unreviewed", "-audit", "-only"]) + "@localhost/audit\n"
            )
            commit()
            code, report = scan("snapshot")
            self.assertEqual((code, report["unresolved"]), (1, 1))
            self.assertEqual(report["findings"][0]["rule"], "database-url-password")
            self.assertEqual(set(report["findings"][0]), {
                "file", "startLine", "endLine", "commit", "rule", "disposition", "reason",
            })

            code, report = scan("history")
            self.assertEqual(code, 1)
            self.assertGreaterEqual(report["unresolved"], 2)


if __name__ == "__main__":
    unittest.main()
