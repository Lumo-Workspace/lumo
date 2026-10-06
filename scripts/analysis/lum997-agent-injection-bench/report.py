"""LUM-997 — merge partial run.py outputs into results.json and print the
README tables.

    $VENV/bin/python scripts/analysis/lum997-agent-injection-bench/report.py \
        part1.json part2.json … [--out results.json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def pooled(rows: list[dict]) -> dict:
    """Pool cells across suites, weighting each rate by its N."""

    def wavg(key: str, n_key: str) -> tuple[float | None, int]:
        n = sum(r[n_key] for r in rows if r[key] is not None)
        if n == 0:
            return None, 0
        return round(sum(r[key] * r[n_key] for r in rows if r[key] is not None) / n, 4), n

    u, nu = wavg("utility", "nUtility")
    ua, na = wavg("utilityUnderAttack", "nAttack")
    asr, _ = wavg("asr", "nAttack")
    return {"nUtility": nu, "utility": u, "nAttack": na, "utilityUnderAttack": ua, "asr": asr}


def merge(parts: list[dict]) -> dict:
    table = [row for p in parts for row in p["table"]]
    models = sorted({r["model"] for r in table})
    arms = [a for a in ["none", "fence", "lumo_guard", "spotlight"] if any(r["arm"] == a for r in table)]
    by_model_arm = []
    for m in models:
        for a in arms:
            rows = [r for r in table if r["model"] == m and r["arm"] == a]
            if rows:
                by_model_arm.append({"model": m, "arm": a, **pooled(rows)})
    by_model: dict[str, dict] = {}
    for p in parts:
        for m, c in p["cost"]["byModel"].items():
            agg = by_model.setdefault(m, {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0, "usd": 0.0})
            for k in ("calls", "prompt_tokens", "completion_tokens"):
                agg[k] += c[k]
            agg["usd"] = round(agg["usd"] + c["usd"], 4)
    detector_rows = {(r["suite"], r["injectionTask"]): r for p in parts for r in p["detectorOnly"]["rows"]}
    detector = sorted(detector_rows.values(), key=lambda r: (r["suite"], int(r["injectionTask"].rsplit("_", 1)[-1])))
    guard_stats: dict[str, int] = {}
    for p in parts:
        for k, v in p.get("guardBridgeStats", {}).items():
            guard_stats[k] = guard_stats.get(k, 0) + v
    return {
        "task": "LUM-997",
        "agentdojo": parts[0]["agentdojo"],
        "models": models,
        "arms": arms,
        "plans": [{"models": p["models"], "plan": p["plan"], "stoppedEarly": p["stoppedEarly"]} for p in parts],
        "cost": {"estimatedUsdFromListPrice": round(sum(c["usd"] for c in by_model.values()), 4), "byModel": by_model},
        "guardBridgeStats": guard_stats,
        "byModelArm": by_model_arm,
        "table": sorted(table, key=lambda r: (r["model"], r["suite"], arms.index(r["arm"]))),
        "detectorOnly": {
            "payloads": len(detector),
            "flagged": sum(1 for r in detector if r["signals"] > 0),
            "rows": detector,
        },
    }


def pct(v: float | None) -> str:
    return "—" if v is None else f"{v * 100:.1f}%"


def markdown(result: dict) -> str:
    out = ["| model | arm | utility (N) | utility under attack (N) | targeted ASR (N) |", "| --- | --- | --- | --- | --- |"]
    for r in result["byModelArm"]:
        out.append(
            f"| {r['model']} | {r['arm']} | {pct(r['utility'])} ({r['nUtility']}) | "
            f"{pct(r['utilityUnderAttack'])} ({r['nAttack']}) | {pct(r['asr'])} ({r['nAttack']}) |"
        )
    out += ["", "| model | suite | arm | utility (N) | utility under attack | ASR (N) | errors |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for r in result["table"]:
        out.append(
            f"| {r['model']} | {r['suite']} | {r['arm']} | {pct(r['utility'])} ({r['nUtility']}) | "
            f"{pct(r['utilityUnderAttack'])} | {pct(r['asr'])} ({r['nAttack']}) | {r['errors']} |"
        )
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("parts", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=HERE / "results.json")
    args = ap.parse_args()
    result = merge([json.loads(p.read_text()) for p in args.parts])
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(markdown(result))
    print(f"\ncost ≈ ${result['cost']['estimatedUsdFromListPrice']:.2f}; wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
