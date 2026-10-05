"""LUM-988 (agentic verifier) — score a verifier-filtered run WITHOUT
re-judging: the step3 judgement of the unfiltered run records, per PR, which
candidate matched each golden comment (`matched_candidate`) and which
candidates matched none (`false_positives`). Dropping the REJECTED findings
then gives the filtered TP / FP / FN exactly, assuming the judge would have
matched the same candidates (it judges each golden against the candidate
list; removing a non-matching candidate cannot create a match).

  python3 scripts/analysis/lum988-code-review-replay/score-verify.py \
    --bench <bench>/offline --results results.json --run 0 \
    --tool lumo988-sonnet55-v975desc --verify verify.json

`--tool` is the pseudo-tool whose evals/<tool>.json judged that run.
"""
import argparse
import json
from pathlib import Path

CORE = {"bug", "security", "concurrency", "data", "api", "perf", "test_gap", "doc_defect"}


def text_of(f: dict) -> str:
    return f"{f['title']} - {f['detail']}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", required=True, type=Path)
    ap.add_argument("--results", required=True, type=Path)
    ap.add_argument("--run", type=int, default=0)
    ap.add_argument("--tool", required=True)
    ap.add_argument("--verify", type=Path, help="verify.py output; omit to score the unfiltered run")
    args = ap.parse_args()

    results = json.loads(args.results.read_text())
    evals = json.loads((args.bench / "evals" / f"{args.tool}.json").read_text())
    verify = json.loads(args.verify.read_text()) if args.verify else {}

    cat = {}
    for f in (args.bench / "golden_comments").glob("*.json"):
        for pr in json.load(open(f)):
            for g in pr["comments"]:
                cat[g["comment"].strip()] = g.get("category", "")

    def category(e):
        return e.get("category") or cat.get(e.get("golden_comment", "").strip(), "")

    tp = fp = fn = dropped_tp = dropped_fp = kept = total = 0
    for url, r in results.items():
        ev = evals.get(url, {}).get(args.tool)
        if not ev:
            continue
        findings = r["runs"][args.run].get("findings", [])
        verdicts = {v["id"]: v["verdict"] for v in verify.get(url, {}).get("results", [])}
        rejected_texts = {text_of(f) for i, f in enumerate(findings) if verdicts.get(f"f{i}") == "REJECTED"}
        total += len(findings)
        kept += len(findings) - len(rejected_texts)
        for t in ev.get("true_positives", []):
            if category(t) not in CORE:
                continue
            if t.get("matched_candidate", "") in rejected_texts:
                fn += 1
                dropped_tp += 1
            else:
                tp += 1
        fn += sum(1 for t in ev.get("false_negatives", []) if category(t) in CORE)
        for c in ev.get("false_positives", []):
            if c.get("candidate", "") in rejected_texts:
                dropped_fp += 1
            else:
                fp += 1
    p = tp / (tp + fp) if tp + fp else 0.0
    rc = tp / (tp + fn) if tp + fn else 0.0

    def fb(b):
        return (1 + b * b) * p * rc / (b * b * p + rc) if p + rc else 0.0

    print(f"findings {total} kept {kept}  dropped: {dropped_fp} FP, {dropped_tp} TP")
    print(f"TP {tp} FP {fp} FN {fn}  P {p:.1%} R {rc:.1%} F1 {fb(1):.1%} F2 {fb(2):.1%}")


if __name__ == "__main__":
    main()
