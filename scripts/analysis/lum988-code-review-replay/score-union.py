"""LUM-988 (direction 1) — score a pooled candidate list (`union.py`) after the
verifier and the ranker, WITHOUT re-judging. Each finding is labelled by the
step3 judgement of the run it came from (`src`).

A golden comment counts once however many kept findings match it. Duplicates
are bracketed, since the pool was never judged as one list:
  optimistic  — a kept finding matching an already-credited golden is ignored;
  pessimistic — it counts as a false positive.
The real judge lands in between.

  python3 scripts/analysis/lum988-code-review-replay/score-union.py --bench <bench>/offline \
    --results results-sonnet55.json --pool results-union-123.json --verify verify-union-123.json \
    --rank rank-union-123.json --tools lumo988-sonnet55-v975desc,lumo988-sonnet55-v975desc-r2,lumo988-sonnet55-v975desc-r3
"""
import argparse
import json
from pathlib import Path

SECURITY_KINDS = {
    "sql_injection", "command_injection", "xss", "ssrf", "path_traversal",
    "insecure_deserialization", "auth_bypass", "unsafe_eval", "weak_crypto",
    "hardcoded_credential", "csrf", "clickjacking_or_insecure_headers",
    "origin_or_host_validation", "open_redirect", "authz_logic",
}
CORE = {"bug", "security", "concurrency", "data", "api", "perf", "test_gap", "doc_defect"}


def text_of(f: dict) -> str:
    return f"{f['title']} - {f['detail']}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", required=True, type=Path)
    ap.add_argument("--pool", required=True, type=Path)
    ap.add_argument("--verify", required=True, type=Path)
    ap.add_argument("--rank", required=True, type=Path)
    ap.add_argument("--tools", required=True, help="judged tool per run index, comma-separated")
    ap.add_argument("--thresholds", default="0,18,22,25,30,35,40")
    ap.add_argument("--dedup-lines", type=int, default=-1, help="collapse kept findings in the same file within N lines to the highest p (-1 = off)")
    args = ap.parse_args()

    tools = args.tools.split(",")
    evals = [json.loads((args.bench / "evals" / f"{t}.json").read_text()) for t in tools]
    pool = json.loads(args.pool.read_text())
    verify = json.loads(args.verify.read_text())
    rank = json.loads(args.rank.read_text())
    cat = {}
    for f in (args.bench / "golden_comments").glob("*.json"):
        for pr in json.load(open(f)):
            for g in pr["comments"]:
                cat[g["comment"].strip()] = g.get("category", "")

    def category(e):
        return e.get("category") or cat.get(e.get("golden_comment", "").strip(), "")

    prs = []
    for url, r in pool.items():
        evs = [e.get(url, {}).get(t) for e, t in zip(evals, tools)]
        if not any(evs):
            continue
        goldens = set()
        for ev in evs:
            if not ev:
                continue
            for t in ev.get("true_positives", []) + ev.get("false_negatives", []):
                if category(t) in CORE:
                    goldens.add(t["golden_comment"].strip())
        verdicts = {v["id"]: v["verdict"] for v in verify.get(url, {}).get("results", [])}
        p = {x["id"]: x["p"] for x in rank.get(url, {}).get("ranking", [])}
        rows = []
        for i, f in enumerate(r["runs"][0]["findings"]):
            run, _ = f["src"]
            ev = evs[run] or {}
            t = text_of(f)
            matched = {
                x["golden_comment"].strip()
                for x in ev.get("true_positives", [])
                if category(x) in CORE and x.get("matched_candidate", "") == t
            }
            is_fp = any(c.get("candidate", "") == t for c in ev.get("false_positives", []))
            applicable = f["severity"] != "HIGH" and f["kind"] not in SECURITY_KINDS
            if applicable and verdicts.get(f"f{i}") == "REJECTED":
                continue
            rows.append({"applicable": applicable, "p": p.get(f"f{i}", 100), "matched": matched, "fp": is_fp, "file": f["filePath"], "line": f["line"]})
        prs.append({"goldens": goldens, "rows": rows})

    for t in [int(x) for x in args.thresholds.split(",")]:
        res = {}
        for mode in ("optimistic", "pessimistic"):
            tp = fp = g = 0
            for pr in prs:
                g += len(pr["goldens"])
                credited = set()
                kept = []
                for row in sorted(pr["rows"], key=lambda x: -x["p"]):
                    if row["applicable"] and row["p"] < t:
                        continue
                    if args.dedup_lines >= 0 and any(
                        k["file"] == row["file"]
                        and (k["line"] is None or row["line"] is None or abs(k["line"] - row["line"]) <= args.dedup_lines)
                        for k in kept
                    ):
                        continue
                    kept.append(row)
                    if row["fp"]:
                        fp += 1
                    elif row["matched"]:
                        new = row["matched"] - credited
                        if new:
                            credited |= new
                        elif mode == "pessimistic":
                            fp += 1
                tp += len(credited)
            prec = tp / (tp + fp) if tp + fp else 0.0
            rec = tp / g if g else 0.0
            fb = lambda b: (1 + b * b) * prec * rec / (b * b * prec + rec) if prec + rec else 0.0
            res[mode] = f"TP {tp:3} FP {fp:3} P {prec:5.1%} R {rec:5.1%} F1 {fb(1):5.1%} F2 {fb(2):5.1%}"
        print(f"p>={t:<3} opt {res['optimistic']}  | pess {res['pessimistic']}")


if __name__ == "__main__":
    main()
