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
            file = "__tests__/audit-fixture.txt"
            line = "value: '" + "AKIA" + "ABCDEFGHIJKLMNOP" + "',"
            (repo / "docs/open-source/secret-scan-false-positives.json").write_text(json.dumps({
                "falsePositives": [{"file": file, "rule": "aws-access-token",
                    "contentSha256": hashlib.sha256(line.encode()).hexdigest(),
                    "lineSpans": [[1, 1]], "reason": "Synthetic regression fixture"}],
            }))
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

            fixture.write_text("\n" + line + "\n")
            commit()
            code, report = scan("snapshot")
            self.assertEqual((code, report["unresolved"]), (1, 1))

            changed = re.sub(
                r"AKIA[A-Z0-9]{16}",
                lambda match: match[0][:-1] + ("Z" if match[0][-1] != "Z" else "Y"), line,
            )
            self.assertNotEqual(line, changed)
            fixture.write_text(changed + "\n")
            commit()
            mutated_commit = git("rev-parse", "HEAD").decode().strip()
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
                "startColumn", "endColumn",
            })

            code, report = scan("history")
            self.assertEqual(code, 1)
            self.assertEqual(report["unresolved"], 2)
            self.assertEqual({x["file"] for x in report["findings"] if x["disposition"] == "unresolved"},
                             {file, ".env.production"})
            self.assertEqual([(x["commit"], x["startLine"]) for x in report["findings"]
                              if x["file"] == file and x["disposition"] == "unresolved"],
                             [(mutated_commit, 1)])

            # Only the immutable original occurrence is confirmed rotated.
            credential_commit = git("rev-parse", "HEAD").decode().strip()
            columns = next(x for x in report["findings"] if x["file"] == ".env.production")
            ledger = repo / "docs/open-source/historical-credential-rotations.json"
            rotation = {
                "file": ".env.production", "rule": "database-url-password",
                "commit": credential_commit, "startLine": 12, "endLine": 12,
                "startColumn": columns["startColumn"], "endColumn": columns["endColumn"],
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
                               ("rule", "other-rule"), ("startLine", 11), ("endLine", 13),
                               ("startColumn", columns["startColumn"] + 1), ("endColumn", columns["endColumn"] + 1)):
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

            # Materializing a symlink must scan its blob without following it.
            (repo / "excluded.env").unlink()
            (repo / "credential-link").symlink_to(candidate.strip().split("=", 1)[1])
            commit()
            code, report = scan("snapshot")
            self.assertEqual((code, report["unresolved"]), (1, 1))
            self.assertEqual(report["findings"][0]["file"], "credential-link")

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

            stub.write_text("#!/usr/bin/env python3\nimport sys\n"
                "if sys.argv[1]=='version': print('8.30.1'); sys.exit(0)\n"
                "report=next(x.split('=',1)[1] for x in sys.argv if x.startswith('--report-path='))\n"
                "open(report,'w').write('[]')\nsys.exit(1)\n")
            result = subprocess.run(
                ["python3", str(repo / "scripts/audit-secrets.py"), "snapshot", "--gitleaks-bin", str(stub)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("exit 1; report present", result.stderr)

            # Missing commit metadata cannot accidentally read the current index.
            for commit_value in (None, "", "--help"):
                with self.subTest(invalid_commit=commit_value):
                    row = {"File": file, "RuleID": "aws-access-token", "StartLine": 1, "EndLine": 1}
                    if commit_value is not None:
                        row["Commit"] = commit_value
                    stub.with_name("stub-report.json").write_text(json.dumps([row]))
                    stub.write_text("#!/usr/bin/env python3\nimport sys\nfrom pathlib import Path\n"
                        "if sys.argv[1]=='version': print('8.30.1'); sys.exit(0)\n"
                        "report=next(x.split('=',1)[1] for x in sys.argv if x.startswith('--report-path='))\n"
                        "Path(report).write_bytes(Path(__file__).with_name('stub-report.json').read_bytes())\nsys.exit(3)\n")
                    result = subprocess.run(
                        ["python3", str(repo / "scripts/audit-secrets.py"), "history", "--gitleaks-bin", str(stub)],
                        capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("no valid immutable commit identifier", result.stderr)
                    self.assertNotIn("Traceback", result.stderr)

            missing = {"File": "missing:path.env", "RuleID": "aws-access-token",
                       "StartLine": 1, "EndLine": 1, "StartColumn": 1, "EndColumn": 2,
                       "Commit": git("rev-parse", "HEAD").decode().strip()}
            stub.with_name("stub-report.json").write_text(json.dumps([missing]))
            report_file = repo / "missing.report.json"
            result = subprocess.run(
                ["python3", str(repo / "scripts/audit-secrets.py"), "history", "--gitleaks-bin", str(stub), "--report", str(report_file)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 1)
            missing_report = json.loads(report_file.read_text())
            self.assertEqual((missing_report["unresolved"], missing_report["confirmedRotated"]), (1, 0))
            self.assertEqual(missing_report["findings"][0]["file"], "missing:path.env")
            self.assertIn("Cannot read immutable source", missing_report["findings"][0]["reason"])

            # U+0085 is not an LF line boundary, even though splitlines splits it.
            blob = b"# prefix with separator \xc2\x85 and invalid byte \xff\n" + candidate.encode()
            (repo / "credential-link").unlink()
            (repo / "line-boundaries.env").write_bytes(blob)
            (repo / "docs/open-source/secret-scan-false-positives.json").write_text(json.dumps({
                "falsePositives": [{"file": "line-boundaries.env", "rule": "database-url-password",
                    "contentSha256": hashlib.sha256(candidate.rstrip("\n").encode()).hexdigest(),
                    "lineSpans": [[2, 2]], "reason": "Synthetic line-boundary regression fixture"}],
            }))
            commit()
            code, report = scan("snapshot")
            self.assertEqual((code, report["reviewedFalsePositives"], report["unresolved"]), (0, 1, 0))

            for file, key, error in (("docs/open-source/secret-scan-false-positives.json", "reason", "Invalid false-positive inventory metadata"),
                                     ("docs/open-source/historical-credential-rotations.json", "evidence", "Invalid rotation ledger metadata")):
                config = repo / file
                original = config.read_text()
                data = json.loads(original)
                next(iter(data.values()))[0].pop(key)
                config.write_text(json.dumps(data))
                result = subprocess.run(
                    ["python3", str(repo / "scripts/audit-secrets.py"), "snapshot", "--gitleaks-bin", BINARY],
                    capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 2)
                self.assertIn(error, result.stderr)
                config.write_text(original)

            result = subprocess.run(
                ["python3", str(repo / "scripts/audit-secrets.py"), "history", "--ref", "HEAD", "--gitleaks-bin", BINARY],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("--ref is snapshot-only", result.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--gitleaks-bin", default="gitleaks")
    args, remaining = parser.parse_known_args()
    BINARY = args.gitleaks_bin
    unittest.main(argv=[__file__, *remaining])
