"""LUM-988 (precision, step 2) — score the listwise ranker (`rank.ts`) WITHOUT
re-judging, like score-verify.py: the step3 judgement of the unfiltered run
says which candidate matched each golden comment and which matched none.

Pipeline per run: the verifier's rejections (production policy), then drop a
non-HIGH, non-security finding whose ranker p is below a threshold. The sweep
prints P/R/F1/F2 per threshold, and — at the same number of findings dropped —
the result of dropping by the review's own order instead (last-listed first),
so a better ranking shows up as a better frontier, not just a different point.

  python3 scripts/analysis/lum988-code-review-replay/score-rank.py \
    --bench <bench>/offline --results results-sonnet55.json \
    --runs 0:lumo988-sonnet55-v975desc:verify-v3-run1.json:rank-run1.json [...]
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


def load_rows(bench: Path, results: dict, run: int, tool: str, verify: dict, rank: dict, cat: dict):
    """Per PR: candidate rows that survive the verifier, plus the golden counts."""
    evals = json.loads((bench / "evals" / f"{tool}.json").read_text())

    def category(e):
        return e.get("category") or cat.get(e.get("golden_comment", "").strip(), "")

    prs = []
    for url, r in results.items():
        ev = evals.get(url, {}).get(tool)
        if not ev:
            continue
        findings = r["runs"][run].get("findings", [])
        verdicts = {v["id"]: v["verdict"] for v in verify.get(url, {}).get("results", [])}
        p = {x["id"]: x["p"] for x in rank.get(url, {}).get("ranking", [])}
        # A candidate can match several golden comments; each counts, as in score-verify.py.
        tp_count = {}
        for t in ev.get("true_positives", []):
            if category(t) in CORE:
                c = t.get("matched_candidate", "")
                tp_count[c] = tp_count.get(c, 0) + 1
        fp_texts = {c.get("candidate", "") for c in ev.get("false_positives", [])}
        golden = sum(1 for t in ev.get("true_positives", []) if category(t) in CORE) + sum(
            1 for t in ev.get("false_negatives", []) if category(t) in CORE
        )
        rows = []
        for i, f in enumerate(findings):
            applicable = f["severity"] != "HIGH" and f["kind"] not in SECURITY_KINDS
            if applicable and verdicts.get(f"f{i}") == "REJECTED":
                continue
            t = text_of(f)
            rows.append({
                "applicable": applicable,
                "p": p.get(f"f{i}", 100),
                "order": i,
                "tp": tp_count.get(t, 0),
                "fp": int(t in fp_texts),
            })
        prs.append({"golden": golden, "rows": rows})
    return prs


def metrics(prs, keep):
    tp = fp = golden = 0
    for pr in prs:
        golden += pr["golden"]
        for row in pr["rows"]:
            if keep(row):
                tp += row["tp"]
                fp += row["fp"]
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / golden if golden else 0.0

    def fb(b):
        return (1 + b * b) * p * r / (b * b * p + r) if p + r else 0.0

    return tp, fp, p, r, fb(1), fb(2)


def fmt(m):
    tp, fp, p, r, f1, f2 = m
    return f"TP {tp:3} FP {fp:3}  P {p:5.1%} R {r:5.1%} F1 {f1:5.1%} F2 {f2:5.1%}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", required=True, type=Path)
    ap.add_argument("--results", required=True, type=Path)
    ap.add_argument("--runs", nargs="+", required=True, help="run:tool:verify.json:rank.json")
    ap.add_argument("--thresholds", default="0,10,20,25,30,35,40,45,50,55,60")
    args = ap.parse_args()

    results = json.loads(args.results.read_text())
    cat = {}
    for f in (args.bench / "golden_comments").glob("*.json"):
        for pr in json.load(open(f)):
            for g in pr["comments"]:
                cat[g["comment"].strip()] = g.get("category", "")

    per_run = []
    for spec in args.runs:
        run, tool, vf, rf = spec.split(":")
        per_run.append(load_rows(
            args.bench, results, int(run), tool,
            json.loads(Path(vf).read_text()), json.loads(Path(rf).read_text()), cat,
        ))
    pooled = [pr for prs in per_run for pr in prs]

    for name, prs in [*[(f"run {i + 1}", p) for i, p in enumerate(per_run)], ("pooled", pooled)]:
        print(f"\n== {name}")
        for t in [int(x) for x in args.thresholds.split(",")]:
            by_p = lambda row, t=t: not row["applicable"] or row["p"] >= t
            dropped = sum(1 for pr in prs for row in pr["rows"] if not by_p(row))
            # Same number of applicable drops, chosen by the review's own order:
            # within each PR the last-listed applicable rows go first, globally
            # the rows with the highest order index.
            ranked = sorted(
                ((row["order"], id(row)) for pr in prs for row in pr["rows"] if row["applicable"]),
                reverse=True,
            )
            drop_ids = {rid for _, rid in ranked[:dropped]}
            by_order = lambda row: id(row) not in drop_ids
            print(f"  p>={t:<3} drop {dropped:3}  ranker {fmt(metrics(prs, by_p))}   | review order {fmt(metrics(prs, by_order))}")


if __name__ == "__main__":
    main()
