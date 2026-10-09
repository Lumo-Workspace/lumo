#!/usr/bin/env python3
"""Exercise the release audit in a disposable Git repository (requires Gitleaks)."""
import hashlib
import json
import argparse
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
BINARY = "gitleaks"


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
                    ["python3", str(repo / "scripts/audit-secrets.py"), mode, "--report", str(report), "--gitleaks-bin", BINARY],
                    capture_output=True, text=True,
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
            self.assertEqual(report["unresolved"], 2)
            self.assertEqual({x["file"] for x in report["findings"] if x["disposition"] == "unresolved"},
                             {file, ".env.production"})

            # Only the immutable original occurrence is confirmed rotated.
            credential_commit = git("rev-parse", "HEAD").decode().strip()
            ledger = repo / "docs/open-source/historical-credential-rotations.json"
            rotation = {
                "file": ".env.production", "rule": "database-url-password",
                "commit": credential_commit, "startLine": 12, "endLine": 12,
                "evidence": "Synthetic regression-test rotation attestation",
            }
            ledger.write_text(json.dumps({"rotations": [rotation]}))
            commit()
            code, report = scan("history")
            self.assertEqual((code, report["confirmedRotated"], report["unresolved"]), (1, 1, 1))
            rotated = [x for x in report["findings"] if x["disposition"] == "confirmed-rotated"]
            self.assertEqual([(x["file"], x["commit"], x["startLine"], x["endLine"]) for x in rotated],
                             [(".env.production", credential_commit, 12, 12)])
            code, report = scan("snapshot")
            self.assertEqual((code, report["confirmedRotated"], report["unresolved"]), (1, 0, 1))

            for key, wrong in (("commit", "0" * 40), ("file", "other.env"),
                               ("rule", "other-rule"), ("startLine", 11), ("endLine", 13)):
                with self.subTest(mismatched_rotation=key):
                    ledger.write_text(json.dumps({"rotations": [{**rotation, key: wrong}]}))
                    commit()
                    code, report = scan("history")
                    self.assertEqual((code, report["confirmedRotated"], report["unresolved"]), (1, 0, 2))

            # Attributes cannot hide a blob, and invalid UTF-8 cannot crash triage.
            (repo / ".env.production").unlink()
            (repo / ".gitattributes").write_text("excluded.env export-ignore export-subst\n")
            candidate = ("DATABASE_URL=mysql+pymysql://audit_user:"
                         + "".join(["unreviewed", "-audit", "-only"]) + "@localhost/audit\n")
            (repo / "excluded.env").write_bytes(b"# invalid byte: \xff\n" + candidate.encode())
            commit()
            code, report = scan("snapshot")
            self.assertEqual((code, report["unresolved"]), (1, 1))
            self.assertEqual((report["findings"][0]["file"], report["findings"][0]["startLine"]),
                             ("excluded.env", 2))
            code, report = scan("history")
            self.assertEqual(report["unresolved"], 3)

            # Driver-qualified and additional database schemes use the same rule.
            schemes = ["postgresql+asyncpg", "mysql+pymysql", "mariadb", "mongodb+srv",
                       "rediss", "mssql+pyodbc", "sqlserver", "cockroachdb"]
            (repo / "excluded.env").write_text("".join(
                scheme + "://audit_user:" + "".join(["unreviewed", "-audit", "-only"])
                + "@localhost/audit\n" for scheme in schemes
            ))
            commit()
            code, report = scan("snapshot")
            self.assertEqual((code, report["unresolved"]), (1, len(schemes)))
            self.assertEqual({x["startLine"] for x in report["findings"]}, set(range(1, len(schemes) + 1)))
            self.assertTrue(all(x["rule"] == "database-url-password" for x in report["findings"]))

            # A failed scanner gets useful fixed diagnostics without echoing logs.
            stub = repo / "failing-gitleaks"
            stub.write_text("#!/bin/sh\nif [ \"$1\" = version ]; then echo 8.30.1; exit 0; fi\n"
                            "echo 'config failure: synthetic-sensitive-output' >&2\nexit 2\n")
            stub.chmod(0o700)
            result = subprocess.run(
                ["python3", str(repo / "scripts/audit-secrets.py"), "snapshot", "--gitleaks-bin", str(stub)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("exit 2; report absent; category configuration", result.stderr)
            self.assertNotIn("synthetic-sensitive-output", result.stderr + result.stdout)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--gitleaks-bin", default="gitleaks")
    args, remaining = parser.parse_known_args()
    BINARY = args.gitleaks_bin
    unittest.main(argv=[__file__, *remaining])
