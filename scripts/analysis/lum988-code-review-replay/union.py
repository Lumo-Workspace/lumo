"""LUM-988 (precision/recall, direction 1) — pool several review runs of the
same PR into one candidate list, keeping each finding's own verifier verdict,
so `rank.ts` can rank the pool and `score-union.py` can score it.

  python3 scripts/analysis/lum988-code-review-replay/union.py \
    --results results-sonnet55.json --runs 0,1,2 \
    --verify verify-v3-run1.json,verify-v3-run2.json,verify-v3-run3.json \
    --out-results results-union-123.json --out-verify verify-union-123.json

The pooled list is written as run 0 of `--out-results`; each finding carries
`src: [run, index]` so its step3 label can be looked up in its own run's eval.
Verdict ids are renumbered to the pooled `f<i>`.
"""
import argparse
import json
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True, type=Path)
    ap.add_argument("--runs", required=True, help="comma-separated run indices")
    ap.add_argument("--verify", required=True, help="comma-separated verify files, one per run")
    ap.add_argument("--out-results", required=True, type=Path)
    ap.add_argument("--out-verify", required=True, type=Path)
    args = ap.parse_args()

    runs = [int(x) for x in args.runs.split(",")]
    verifies = [json.loads(Path(p).read_text()) for p in args.verify.split(",")]
    assert len(runs) == len(verifies), "one verify file per run"
    results = json.loads(args.results.read_text())

    out_results, out_verify = {}, {}
    for url, r in results.items():
        pooled, verdicts = [], []
        for run, verify in zip(runs, verifies):
            findings = r["runs"][run].get("findings")
            if findings is None:
                continue
            by_id = {v["id"]: v for v in verify.get(url, {}).get("results", [])}
            for i, f in enumerate(findings):
                new_id = f"f{len(pooled)}"
                pooled.append({**f, "src": [run, i]})
                v = by_id.get(f"f{i}")
                if v:
                    verdicts.append({**v, "id": new_id})
        out_results[url] = {"runs": [{"findings": pooled}]}
        out_verify[url] = {"results": verdicts}
    args.out_results.write_text(json.dumps(out_results, indent=1))
    args.out_verify.write_text(json.dumps(out_verify, indent=1))
    n = sum(len(v["runs"][0]["findings"]) for v in out_results.values())
    print(f"pooled {n} findings over {len(out_results)} PRs from runs {runs}")


if __name__ == "__main__":
    main()
