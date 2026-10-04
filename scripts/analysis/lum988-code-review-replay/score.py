"""LUM-988 — judge a replay with the benchmark's own step3 judge and score it
the way the Martian dashboard does (Core profile: per-PR TP/FN over the Core
golden categories, FP as the judge counts it, micro-averaged over PRs).

  python3 \
    scripts/analysis/lum988-code-review-replay/score.py \
    --bench <bench>/offline --results results.json --tool lumo988-sonnet55-r1

Each run of the replay becomes one pseudo-tool `<tool>` (run 1), `<tool>-r2`
… It is injected into the clone's benchmark_data.json and the judge model's
candidates.json, judged with step3 into evals/<tool>.json (its own file, so
parallel tools never race on one evaluations.json), then scored next to the
leaderboard tools from the official Opus 4.5 evaluations.

Judge: anthropic/claude-opus-4.5 through the AI Gateway's OpenAI-compatible
endpoint, key = AI_GATEWAY_API_KEY (from the environment or .env.local).
step3 is incremental per tool name: a tool already in its evaluations file is
not re-judged — use a new --tool name (or delete the file) to judge again.
"""
import argparse
import glob
import json
import os
import subprocess
import sys
from pathlib import Path

CORE = {"bug", "security", "concurrency", "data", "api", "perf", "test_gap", "doc_defect"}
JUDGE_MODEL = "anthropic/claude-opus-4.5"
OFFICIAL_DIR = "anthropic_claude-opus-4-5-20251101"
LEADERBOARD = ["qodo-extended-v2", "cubic-v2", "augment", "coderabbit", "greptile-v4-1", "graphite"]


def gateway_key() -> str:
    if os.environ.get("AI_GATEWAY_API_KEY"):
        return os.environ["AI_GATEWAY_API_KEY"]
    root = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    for env in [Path(".env.local"), Path(root).parent / ".env.local"]:
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("AI_GATEWAY_API_KEY="):
                    return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit("AI_GATEWAY_API_KEY not found")


def tool_names(base: str, n: int) -> list[str]:
    return [base if i == 1 else f"{base}-r{i}" for i in range(1, n + 1)]


def inject(bench: Path, results: dict, base: str) -> list[str]:
    bd_path = bench / "results/benchmark_data.json"
    cand_path = bench / "results" / JUDGE_MODEL.replace("/", "_") / "candidates.json"
    bd = json.loads(bd_path.read_text())
    cand = json.loads(cand_path.read_text()) if cand_path.exists() else {}
    n = max(len(r["runs"]) for r in results.values())
    names = tool_names(base, n)
    for url, r in results.items():
        for tool, run in zip(names, r["runs"]):
            fs = run.get("findings", [])
            texts = [f"{f['title']} - {f['detail']}" for f in fs]
            bd[url]["reviews"] = [x for x in bd[url]["reviews"] if x["tool"] != tool]
            bd[url]["reviews"].append({
                "tool": tool, "pr_url": url,
                "review_comments": [{"path": f["filePath"], "line": f["line"], "body": t} for f, t in zip(fs, texts)],
            })
            cand.setdefault(url, {})[tool] = [
                {"text": t, "path": f["filePath"], "line": f["line"], "source": "local"} for f, t in zip(fs, texts)
            ]
    bd_path.write_text(json.dumps(bd))
    cand_path.parent.mkdir(parents=True, exist_ok=True)
    cand_path.write_text(json.dumps(cand))
    return names


def judge(bench: Path, tool: str, evals: Path) -> None:
    env = {
        **os.environ,
        "MARTIAN_API_KEY": gateway_key(),
        "MARTIAN_BASE_URL": "https://ai-gateway.vercel.sh/v1",
        "MARTIAN_MODEL": JUDGE_MODEL,
    }
    subprocess.run(
        ["uv", "run", "python", "-m", "code_review_benchmark.step3_judge_comments",
         "--tool", tool, "--no-dedup", "--evaluations-file", str(evals)],
        cwd=bench, env=env, check=True,
    )


def golden_categories(bench: Path) -> dict:
    cat = {}
    for f in glob.glob(str(bench / "golden_comments/*.json")):
        for pr in json.load(open(f)):
            for g in pr["comments"]:
                cat[g["comment"].strip()] = g.get("category", "")
    return cat


def score(evs: dict, tool: str, prs: list[str], cat: dict) -> dict:
    def category(e):
        return e.get("category") or cat.get(e.get("golden_comment", "").strip(), "")

    tp = fp = fn = sec_tp = sec_all = n = 0
    for url in prs:
        r = evs.get(url, {}).get(tool)
        if not r:
            continue
        n += 1
        fp += r.get("fp", 0)
        tp += sum(1 for x in r.get("true_positives", []) if category(x) in CORE)
        fn += sum(1 for x in r.get("false_negatives", []) if category(x) in CORE)
        sec_tp += sum(1 for x in r.get("true_positives", []) if category(x) == "security")
        sec_all += sum(1 for x in r.get("true_positives", []) + r.get("false_negatives", []) if category(x) == "security")
    p = tp / (tp + fp) if tp + fp else 0.0
    rc = tp / (tp + fn) if tp + fn else 0.0

    def fb(b):
        return (1 + b * b) * p * rc / (b * b * p + rc) if p + rc else 0.0

    return {"prs": n, "tp": tp, "fp": fp, "fn": fn, "P": p, "R": rc, "F1": fb(1), "F2": fb(2), "security": f"{sec_tp}/{sec_all}"}


def row(label: str, m: dict) -> str:
    return (f"{label:28s} {m['prs']:3d}  {m['tp']:3d} {m['fp']:4d} {m['fn']:4d}  "
            f"{m['P']:6.1%} {m['R']:6.1%} {m['F1']:6.1%} {m['F2']:6.1%}  sec {m['security']}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", required=True, type=Path, help="<code-review-benchmark>/offline")
    ap.add_argument("--results", required=True, type=Path, help="replay.ts output")
    ap.add_argument("--tool", required=True, help="pseudo-tool name for run 1")
    ap.add_argument("--skip-judge", action="store_true", help="score existing evals only")
    args = ap.parse_args()
    bench = args.bench.resolve()
    results = json.loads(args.results.read_text())
    prs = list(results)
    evals_dir = bench / "evals"
    evals_dir.mkdir(exist_ok=True)

    names = inject(bench, results, args.tool)
    if not args.skip_judge:
        for t in names:
            judge(bench, t, evals_dir / f"{t}.json")

    cat = golden_categories(bench)
    print(f"Core profile, judge {JUDGE_MODEL}, {len(prs)} PRs")
    print(f"{'tool':28s} PRs   TP   FP   FN       P      R     F1     F2")
    official = json.loads((bench / "results" / OFFICIAL_DIR / "evaluations.json").read_text())
    for t in LEADERBOARD:
        print(row(t, score(official, t, prs, cat)))
    print()
    for t in names:
        print(row(t, score(json.loads((evals_dir / f"{t}.json").read_text()), t, prs, cat)))


if __name__ == "__main__":
    main()
