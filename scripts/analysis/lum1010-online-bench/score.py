"""LUM-1010 — print P / R / F1 / F2 from judge.py's output.

Pooled over PRs (micro): precision = matched suggestions / suggestions,
recall = matched human actions / human actions. Each PR was discovered for
one bot, so the per-bot block compares Lumo with that bot on exactly the PRs
that bot reviewed, against the same human actions.

The last block splits Lumo's recall by where a human action came from: fixes
the reviewing bot's own suggestion matched (the bot pointed at it, so it gets
causal credit Lumo cannot) versus every other fix. Needs judge.py to have
stored the bot's matches (`botMatchedActions`).

  python3 score.py judged.json [--tags lumo-raw-run0,lumo-run0,...]
"""

from __future__ import annotations

import argparse
import json


def f_beta(p: float, r: float, beta: float) -> float:
    b2 = beta * beta
    return (1 + b2) * p * r / (b2 * p + r) if p + r > 0 else 0.0


def pooled(rows: list[dict]) -> str:
    s = sum(r["suggestions"] for r in rows)
    ms = sum(r["matchedSuggestions"] for r in rows)
    a = sum(r["actions"] for r in rows)
    ma = sum(r["matchedActions"] for r in rows)
    p = ms / s if s else 0.0
    r = ma / a if a else 0.0
    return (f"P {100 * p:5.1f}%  R {100 * r:5.1f}%  F1 {100 * f_beta(p, r, 1):5.1f}  "
            f"F2 {100 * f_beta(p, r, 2):5.1f}   ({ms}/{s} sugg, {ma}/{a} actions)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("judged")
    ap.add_argument("--tags", default="")
    a = ap.parse_args()
    j = json.load(open(a.judged))
    bots = j["bots"]
    tags = [t for t in (a.tags.split(",") if a.tags else j) if t != "bots"]
    urls = sorted(bots)
    print(f"{len(urls)} PRs, {sum(bots[u]['actions'] > 0 for u in urls)} with ≥1 human action\n")
    print(f"{'all PRs':28}")
    print(f"  {'reviewing bot':26}{pooled([bots[u] for u in urls])}")
    for t in tags:
        print(f"  {t:26}{pooled([j[t][u] for u in urls if u in j[t]])}")
    for bot in sorted({bots[u]["bot"] for u in urls}):
        sub = [u for u in urls if bots[u]["bot"] == bot]
        print(f"\n{bot} ({len(sub)} PRs)")
        print(f"  {bot:26}{pooled([bots[u] for u in sub])}")
        for t in tags:
            print(f"  {t:26}{pooled([j[t][u] for u in sub if u in j[t]])}")

    caused = sum(len(bots[u].get("botMatchedActions", [])) for u in urls)
    other = sum(bots[u]["actions"] for u in urls) - caused
    print(f"\nLumo recall by source of the fix ({caused} fixes the bot pointed at, {other} others)")
    for t in tags:
        hit_c = hit_o = 0
        for u in urls:
            if u not in j[t]:
                continue
            bm = set(bots[u].get("botMatchedActions", []))
            # Only ids of this PR's actions: the judge may echo an id that does not exist.
            valid = set(bots[u].get("actionIds", []))
            lm = {m.get("human_action_id") for m in j[t][u]["matches"] if m.get("matched")} & valid
            hit_c += len(lm & bm)
            hit_o += len(lm - bm)
        print(f"  {t:26}bot-pointed {hit_c}/{caused} ({100 * hit_c / max(caused, 1):4.1f}%)  "
              f"other {hit_o}/{other} ({100 * hit_o / max(other, 1):4.1f}%)")


if __name__ == "__main__":
    main()
