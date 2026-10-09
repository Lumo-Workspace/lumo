#!/usr/bin/env python3
"""Scan a tracked release snapshot or all locally available Git history.

Requires Gitleaks 8.30.1. Never prints scanner matches or credential values.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import re
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
VERSION = "8.30.1"
FINDINGS_EXIT = 3


class AuditError(Exception):
    """A diagnostic that never includes scanner output or file contents."""


def git(*args, input=None, stdout=subprocess.PIPE):
    result = subprocess.run(
        ["git", "-C", str(ROOT), *args], input=input,
        stdout=stdout, stderr=subprocess.DEVNULL,
    )
    if result.returncode:
        raise AuditError(f"Git {args[0]} failed (exit {result.returncode}); no clean result")
    return result.stdout


def materialize_snapshot(revision, snapshot, temp):
    # Read immutable blobs, ignoring export-ignore/export-subst and checkout filters.
    entries = []
    for record in git("ls-tree", "-r", "-z", revision).split(b"\0"):
        if not record:
            continue
        metadata, name = record.split(b"\t", 1)
        mode, kind, oid = metadata.split()
        path = Path(name.decode("utf-8", errors="surrogateescape"))
        if path.is_absolute() or ".." in path.parts or ".git" in path.parts:
            raise AuditError("Unsafe tracked path; snapshot extraction refused")
        if kind != b"blob" or mode not in (b"100644", b"100755", b"120000"):
            raise AuditError("Snapshot includes a submodule/unsupported entry; audit it separately")
        entries.append((oid, path))
    batch = temp / "blobs"
    with batch.open("wb") as handle:
        git("cat-file", "--batch", input=b"".join(oid + b"\n" for oid, _ in entries), stdout=handle)
    with batch.open("rb") as handle:
        for expected_oid, path in entries:
            oid, kind, size = handle.readline().split()
            if oid != expected_oid or kind != b"blob":
                raise AuditError("Invalid Git blob response; no clean result")
            content = handle.read(int(size))
            if len(content) != int(size) or handle.read(1) != b"\n":
                raise AuditError("Truncated Git blob response; no clean result")
            target = snapshot / path
            target.parent.mkdir(parents=True, exist_ok=True)
            # A tracked symlink is scanned as its stored target text, never followed.
            target.write_bytes(content)


def scanner_diagnostic(result, raw):
    # Select fixed categories only; even redacted logs may contain source context.
    logs = (result.stdout + result.stderr).decode("utf-8", errors="replace").lower()
    category = next((label for word, label in (
        ("config", "configuration"), ("permission", "permissions"),
        ("timeout", "timeout"), ("git", "git source"),
    ) if word in logs), "scanner execution")
    state = "present" if raw.exists() else "absent"
    return f"Gitleaks failed (exit {result.returncode}; report {state}; category {category}); raw output withheld"


def validate_inventory(reviewed, rotations):
    if not isinstance(reviewed, list) or not isinstance(rotations, list):
        raise AuditError("Invalid audit inventory/rotation schema")
    for row in reviewed:
        if not isinstance(row, dict) or not all(isinstance(row.get(k), str) and row[k] for k in ("file", "rule", "reason")):
            raise AuditError("Invalid false-positive inventory metadata")
        if not isinstance(row.get("contentSha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", row["contentSha256"]):
            raise AuditError("Invalid false-positive content hash")
        spans = row.get("lineSpans")
        if not isinstance(spans, list) or not spans or any(
            not isinstance(span, list) or len(span) != 2
            or any(type(n) is not int for n in span) or not 1 <= span[0] <= span[1]
            for span in spans
        ):
            raise AuditError("Invalid reviewed line spans")
    for row in rotations:
        if not isinstance(row, dict) or not all(isinstance(row.get(k), str) and row[k] for k in ("file", "rule", "evidence", "commit")):
            raise AuditError("Invalid rotation ledger metadata")
        if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", row["commit"]):
            raise AuditError("Invalid rotation ledger commit")
        if any(type(row.get(k)) is not int for k in ("startLine", "endLine", "startColumn", "endColumn")):
            raise AuditError("Invalid rotation ledger source position")
        if not 1 <= row["startLine"] <= row["endLine"] or min(row["startColumn"], row["endColumn"]) < 0:
            raise AuditError("Invalid rotation ledger source position")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["snapshot", "history"])
    parser.add_argument("--ref", help="Snapshot-only commit/ref (default HEAD)")
    parser.add_argument("--gitleaks-bin", default="gitleaks", help="Trusted local Gitleaks executable")
    parser.add_argument("--report", type=Path, help="Write locations and dispositions only")
    args = parser.parse_args()
    if args.mode == "history" and args.ref is not None:
        parser.error("--ref is snapshot-only; history scans all locally available refs")
    # Only the local operator selects the executable; no task/file/scanner data does.
    binary = shutil.which(args.gitleaks_bin)
    if binary is None:
        parser.error("Install Gitleaks 8.30.1 or provide --gitleaks-bin")
    # The operator intentionally selects a trusted executable. Arguments are
    # fixed, shell=False, and scanned content never controls this invocation.
    # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args
    version_result = subprocess.run([binary, "version"], capture_output=True, shell=False)
    if version_result.returncode:
        raise AuditError(f"Gitleaks version check failed (exit {version_result.returncode})")
    version = version_result.stdout.decode("utf-8", errors="replace").strip()
    if version.lstrip("v") != VERSION:
        parser.error("This reviewed inventory requires Gitleaks " + VERSION)
    if args.mode == "history" and git("rev-parse", "--is-shallow-repository").strip() != b"false":
        parser.error("History scan requires an unshallow repository")
    inventory = json.loads((ROOT / "docs/open-source/secret-scan-false-positives.json").read_text())
    ledger = json.loads((ROOT / "docs/open-source/historical-credential-rotations.json").read_text())
    rotations = ledger.get("rotations") if isinstance(ledger, dict) else None
    validate_inventory(inventory.get("falsePositives") if isinstance(inventory, dict) else None, rotations)
    reviewed = {
        (x["file"], x["rule"], x["contentSha256"], span[0], span[1]): x["reason"]
        for x in inventory["falsePositives"]
        for span in x["lineSpans"]
    }
    revision = git("rev-parse", "--verify", "--end-of-options", (args.ref or "HEAD") + "^{commit}").decode().strip()
    with tempfile.TemporaryDirectory(prefix="lumo-secret-audit-") as temp:
        temp = Path(temp)
        raw = temp / "redacted.json"
        ignore_file = temp / "empty.gitleaksignore"
        ignore_file.write_bytes(b"")
        snapshot = temp / "snapshot"
        if args.mode == "snapshot":
            snapshot.mkdir()
            materialize_snapshot(revision, snapshot, temp)
            command = [binary, "dir", str(snapshot)]
        else:
            command = [binary, "git", str(ROOT), "--log-opts=--all --full-history"]
        command += [
            "--config=" + str(ROOT / ".gitleaks.toml"),
            "--gitleaks-ignore-path=" + str(ignore_file),
            "--exit-code=" + str(FINDINGS_EXIT),
            "--ignore-gitleaks-allow", "--redact=100", "--no-banner",
            "--report-format=json", "--report-path=" + str(raw), "--log-level=error",
        ]
        # Same trusted local binary; every argument is constructed here, not from
        # source content. Shell quoting would corrupt these literal argv entries.
        # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-tainted-env-args.dangerous-subprocess-use-tainted-env-args
        result = subprocess.run(command, capture_output=True, shell=False)
        if result.returncode not in (0, FINDINGS_EXIT) or not raw.exists():
            parser.error(scanner_diagnostic(result, raw))
        findings = json.loads(raw.read_text())
        if not isinstance(findings, list) or bool(findings) != (result.returncode == FINDINGS_EXIT):
            raise AuditError("Scanner report/exit status mismatch; no clean result")
        rows = []
        sources = {}
        for finding in findings:
            file = finding["File"]
            if args.mode == "snapshot":
                file = str(Path(file).relative_to(snapshot))
            commit = finding.get("Commit", "")
            if args.mode == "history" and (not isinstance(commit, str) or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", commit)):
                raise AuditError("History finding has no valid immutable commit identifier; no clean result")
            key = (commit, file)
            if key not in sources:
                sources[key] = (
                    (snapshot / file).read_bytes()
                    if args.mode == "snapshot"
                    else git("show", commit + ":" + file)
                ).split(b"\n")
            start, end = finding["StartLine"], finding["EndLine"]
            start_column, end_column = finding["StartColumn"], finding["EndColumn"]
            if not (isinstance(start, int) and isinstance(end, int) and 1 <= start <= end <= len(sources[key])):
                raise AuditError("Finding has an invalid source line span; no clean result")
            # Use LF boundaries exactly as Gitleaks does, preserving CR/non-UTF-8 bytes.
            span = b"\n".join(sources[key][start - 1:end])
            digest = hashlib.sha256(span).hexdigest()
            reason = reviewed.get((file, finding["RuleID"], digest, start, end))
            rotation = next((x for x in rotations if (
                args.mode == "history" and x["file"] == file
                and x["rule"] == finding["RuleID"] and commit == x["commit"]
                and x["startLine"] == start and x["endLine"] == end
                and x["startColumn"] == start_column and x["endColumn"] == end_column
            )), None)
            # Real credentials never enter the false-positive inventory.
            rows.append({
                "file": file, "startLine": start, "endLine": end,
                "startColumn": start_column, "endColumn": end_column,
                "commit": commit or revision, "rule": finding["RuleID"],
                "disposition": "confirmed-rotated" if rotation else "reviewed-false-positive" if reason else "unresolved",
                "reason": rotation["evidence"] if rotation else reason or "Requires review or credential rotation evidence",
            })
    unresolved = sum(x["disposition"] == "unresolved" for x in rows)
    false_positives = sum(x["disposition"] == "reviewed-false-positive" for x in rows)
    rotated = sum(x["disposition"] == "confirmed-rotated" for x in rows)
    report = {
        "mode": args.mode, "snapshotCommit": revision, "gitleaksVersion": VERSION,
        "historyScope": "All locally available refs; fetch remote branches/tags before running" if args.mode == "history" else None,
        "total": len(rows), "reviewedFalsePositives": false_positives,
        "confirmedRotated": rotated,
        "unresolved": unresolved, "findings": rows,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{args.mode}: {len(rows)} findings, {false_positives} reviewed false positives, {rotated} confirmed rotated, {unresolved} unresolved")
    for row in rows:
        if row["disposition"] == "unresolved":
            print(f"  {row['file']}:{row['startLine']} @ {row['commit'][:10]} ({row['rule']})")
    return 1 if unresolved else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AuditError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
    except (OSError, ValueError, KeyError, TypeError) as error:
        # Exception messages can include file/scanner contents; emit only their type.
        print(f"Audit could not complete ({type(error).__name__}); no clean result", file=sys.stderr)
        raise SystemExit(2)
