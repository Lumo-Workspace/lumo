#!/usr/bin/env python3
"""Scan a tracked release snapshot or all locally available Git history.

Requires Gitleaks 8.30.1. Never prints scanner matches or credential values.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent.parent
VERSION = "8.30.1"


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["snapshot", "history"])
    parser.add_argument("--ref", default="HEAD", help="Snapshot commit/ref to archive")
    parser.add_argument("--report", type=Path, help="Write locations and dispositions only")
    args = parser.parse_args()
    binary = os.environ.get("GITLEAKS_BIN", "gitleaks")
    try:
        version = subprocess.check_output([binary, "version"], text=True).strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        parser.error("Install Gitleaks 8.30.1 or set GITLEAKS_BIN to its binary")
    if version.lstrip("v") != VERSION:
        parser.error("This reviewed inventory requires Gitleaks " + VERSION)
    if args.mode == "history" and git("rev-parse", "--is-shallow-repository").strip() != b"false":
        parser.error("History scan requires an unshallow repository")
    inventory = json.loads((ROOT / "docs/open-source/secret-scan-false-positives.json").read_text())
    reviewed = {
        (x["file"], x["rule"], x["contentSha256"]): x["reason"]
        for x in inventory["falsePositives"]
    }
    rotations = json.loads((ROOT / "docs/open-source/historical-credential-rotations.json").read_text())["rotations"]
    revision = git("rev-parse", "--verify", args.ref + "^{commit}").decode().strip()
    with tempfile.TemporaryDirectory(prefix="lumo-secret-audit-") as temp:
        temp = Path(temp)
        raw = temp / "redacted.json"
        snapshot = temp / "snapshot"
        if args.mode == "snapshot":
            snapshot.mkdir()
            archive = temp / "snapshot.tar"
            with archive.open("wb") as handle:
                subprocess.run(["git", "-C", str(ROOT), "archive", revision], stdout=handle, check=True)
            subprocess.run(["tar", "-xf", str(archive), "-C", str(snapshot)], check=True, stderr=subprocess.DEVNULL)
            command = [binary, "dir", str(snapshot)]
        else:
            command = [binary, "git", str(ROOT), "--log-opts=--all --full-history"]
        command += [
            "--config=" + str(ROOT / ".gitleaks.toml"),
            "--gitleaks-ignore-path=" + str(temp),
            "--ignore-gitleaks-allow", "--redact=100", "--no-banner",
            "--report-format=json", "--report-path=" + str(raw), "--log-level=error",
        ]
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode not in (0, 1) or not raw.exists():
            parser.error("Gitleaks did not complete; no clean result can be claimed")
        findings = json.loads(raw.read_text())
        rows = []
        sources = {}
        for finding in findings:
            file = finding["File"]
            if args.mode == "snapshot":
                file = str(Path(file).relative_to(snapshot))
            commit = finding["Commit"]
            key = (commit, file)
            if key not in sources:
                sources[key] = (
                    (snapshot / file).read_text()
                    if args.mode == "snapshot"
                    else git("show", commit + ":" + file).decode()
                ).splitlines()
            start, end = finding["StartLine"], finding["EndLine"]
            # Only compare exact source spans. A changed fixture fails closed.
            span = "\n".join(sources[key][start - 1:end])
            digest = hashlib.sha256(span.encode()).hexdigest()
            reason = reviewed.get((file, finding["RuleID"], digest))
            rotation = next((x for x in rotations if (
                args.mode == "history" and x["file"] == file
                and x["rule"] == finding["RuleID"] and commit == x["commit"]
                and x["startLine"] == start and x["endLine"] == end
            )), None)
            # Real credentials never enter the false-positive inventory.
            rows.append({
                "file": file, "startLine": start, "endLine": end,
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
    raise SystemExit(main())
