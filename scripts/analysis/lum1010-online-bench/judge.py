"""LUM-1010 — score Lumo's AI review as one more "bot" on the online-ETL PRs.

For each PR in <data>/meta.json it takes one replay run's findings, applies the
production removal policy (the verifier's rejections, then the ranker's
p < threshold, both only on non-HIGH non-security rows — `applyRankerPolicy`
in lib/security-scan/verifier.ts), and matches what is left against the human
actions the ETL already extracted for that PR, with the ETL's own step-3
prompt (JUDGE_MATCHING) and schema. Lumo's findings are structured already, so
they skip step 1 (the bot-comment extraction) and go in as suggestions.

The bot that reviewed the PR is scored from the ETL's stored analysis, so both
sides are matched against the same human actions by the same judge prompt.

  cd <crb>/online/etl && uv run python <this file> --data <data dir> \
    --review review.json --run 0 [--verify verify.json --rank rank.json --threshold 18] \
    --tag lumo-run0 --out judged.json

Needs DATABASE_URL and MARTIAN_* (the ZDR gateway, see the README). Judgements
are cached in --out per (tag, url): re-running only judges what is missing.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, os.getcwd())
from config import DBConfig  # noqa: E402
from db.connection import DBAdapter  # noqa: E402
from llm.client import LLMClient  # noqa: E402
from llm.prompts import JUDGE_MATCHING  # noqa: E402
from llm.schemas import MatchingResponse  # noqa: E402
from pipeline.analyze import _format_actions, _format_suggestions  # noqa: E402

# verify.ts SECURITY_KINDS: production never lets the verifier or ranker remove these.
SECURITY_KINDS = {
    "sql_injection", "command_injection", "xss", "ssrf", "path_traversal",
    "insecure_deserialization", "auth_bypass", "unsafe_eval", "weak_crypto",
    "hardcoded_credential", "csrf", "clickjacking_or_insecure_headers",
    "origin_or_host_validation", "open_redirect", "authz_logic",
}  # fmt: skip


def applicable(f: dict) -> bool:
    return f.get("severity") != "HIGH" and f.get("kind") not in SECURITY_KINDS


def kept_findings(url: str, review: dict, run: int, verify: dict, rank: dict, threshold: float) -> list[dict] | None:
    runs = review.get(url, {}).get("runs", [])
    if run >= len(runs) or "findings" not in runs[run]:
        return None  # over cap / error: Lumo posted nothing
    findings = [{**f, "id": f"f{i}"} for i, f in enumerate(runs[run]["findings"])]
    rejected = {
        r["id"] for r in (verify.get(url, {}).get("results") or []) if r.get("verdict") == "REJECTED"
    }
    rejected = {f["id"] for f in findings if f["id"] in rejected and applicable(f)}
    for r in rank.get(url, {}).get("ranking") or []:
        f = next((x for x in findings if x["id"] == r["id"]), None)
        if f and f["id"] not in rejected and applicable(f) and r["p"] < threshold:
            rejected.add(f["id"])
    return [f for f in findings if f["id"] not in rejected]


def as_suggestions(findings: list[dict]) -> list[dict]:
    return [
        {
            "issue_id": f"S{i + 1}",
            "description": f"{f['title']} — {f['detail']}",
            "category": "security" if f.get("kind") in SECURITY_KINDS else "bug",
            "file_path": f.get("filePath"),
            "line_number": f.get("line"),
            "severity": str(f.get("severity", "MEDIUM")).lower(),
        }
        for i, f in enumerate(findings)
    ]


def counts(suggestions: list[dict], actions: list[dict], matches: list[dict]) -> dict:
    s_ids = {s["issue_id"] for s in suggestions}
    a_ids = {a["action_id"] for a in actions}
    ok = [m for m in matches if m.get("matched")]
    return {
        "suggestions": len(suggestions),
        "matchedSuggestions": len({m["bot_issue_id"] for m in ok if m.get("bot_issue_id") in s_ids}),
        "actions": len(actions),
        "matchedActions": len({m["human_action_id"] for m in ok if m.get("human_action_id") in a_ids}),
    }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--review", required=True)
    ap.add_argument("--run", type=int, default=0)
    ap.add_argument("--verify", default="")
    ap.add_argument("--rank", default="")
    ap.add_argument("--threshold", type=float, default=18)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--concurrency", type=int, default=12)
    a = ap.parse_args()

    meta = json.loads((Path(a.data) / "meta.json").read_text())
    review = json.loads(Path(a.review).read_text())
    verify = json.loads(Path(a.verify).read_text()) if a.verify else {}
    rank = json.loads(Path(a.rank).read_text()) if a.rank else {}
    out_path = Path(a.out)
    judged = json.loads(out_path.read_text()) if out_path.exists() else {}
    # A tag caches judgements for one exact input; refuse to mix in another run/filter.
    params = {"review": str(Path(a.review).resolve()), "run": a.run, "verify": a.verify and str(Path(a.verify).resolve()),
              "rank": a.rank and str(Path(a.rank).resolve()), "threshold": a.threshold}
    judged.setdefault("params", {})
    if judged["params"].get(a.tag, params) != params:
        sys.exit(f"tag {a.tag} was judged with {judged['params'][a.tag]}, not {params}: use a new --tag")
    judged["params"][a.tag] = params
    judged.setdefault(a.tag, {})
    judged.setdefault("bots", {})

    cfg = DBConfig()
    db = DBAdapter(cfg.database_url)
    await db.connect()
    rows = await db.fetchall(
        "SELECT p.pr_url, a.bot_suggestions, a.human_actions, a.matching_results FROM prs p "
        "JOIN llm_analyses a ON a.pr_id = p.id"
    )
    await db.close()
    by_url = {r["pr_url"]: r for r in rows}

    llm = LLMClient(base_url=cfg.martian_base_url, api_key=cfg.martian_api_key, model_name=cfg.martian_model_name)
    sem = asyncio.Semaphore(a.concurrency)

    async def one(url: str) -> None:
        row = by_url[url]
        actions = json.loads(row["human_actions"] or "[]")
        bot_matches = json.loads(row["matching_results"] or "[]")
        a_ids = {a["action_id"] for a in actions}
        judged["bots"][url] = {
            "bot": meta[url]["bot"],
            **counts(json.loads(row["bot_suggestions"] or "[]"), actions, bot_matches),
            "actionIds": sorted(a_ids),
            "botMatchedActions": sorted(
                {m["human_action_id"] for m in bot_matches if m.get("matched") and m.get("human_action_id") in a_ids}
            ),
        }
        if url in judged[a.tag]:
            return
        kept = kept_findings(url, review, a.run, verify, rank, a.threshold)
        suggestions = as_suggestions(kept or [])
        matches: list[dict] = []
        if suggestions and actions:
            prompt = JUDGE_MATCHING.format(
                bot_username="lumo",
                bot_suggestions=_format_suggestions(suggestions),
                human_actions=_format_actions(actions),
            )
            async with sem:
                resp = await llm.structured_completion(prompt, MatchingResponse)
            matches = [m.model_dump() for m in resp.matches]
        judged[a.tag][url] = {
            **counts(suggestions, actions, matches),
            "skipped": kept is None,
            "suggestionsList": suggestions,
            "matches": matches,
        }
        c = judged[a.tag][url]
        print(f"{url.split('github.com/')[1]} lumo {c['matchedSuggestions']}/{c['suggestions']} "
              f"actions {c['matchedActions']}/{c['actions']}", flush=True)

    urls = [u for u in meta if u in by_url]
    try:
        # One failed call must not cancel the rest; failed PRs stay unjudged and a re-run fills them in.
        results = await asyncio.gather(*(one(u) for u in urls), return_exceptions=True)
        failed = [(u, r) for u, r in zip(urls, results, strict=True) if isinstance(r, BaseException)]
        for u, r in failed:
            print(f"{u.split('github.com/')[1]} FAILED {type(r).__name__}: {str(r)[:160]}", flush=True)
    finally:
        await llm.close()
        out_path.write_text(json.dumps(judged, indent=1))
    print(f"wrote {out_path}" + (f" — {len(failed)} PRs failed, re-run to retry" if failed else ""), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
