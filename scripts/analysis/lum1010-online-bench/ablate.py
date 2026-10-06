"""LUM-1010 — which removal step costs what, scored without re-judging.

The judge has already matched every raw finding of a run (judge.py tag
`lumo-raw-run<i>`, where suggestion S<k+1> is finding f<k>). A filtered variant
keeps a subset of findings; its score is the raw judgement restricted to that
subset: a kept suggestion is a TP if the raw judge matched it, an action is
found if some kept suggestion matched it. Same approach as LUM-988's
score-verify.py; the last row checks it against the real judge on the shipped
variant (tag `lumo-run<i>`).

  python3 ablate.py --judged judged.json --review review.json --run 0 \
    --verify verify-run0.json --rank rank-run0.json [--removed]

--removed lists every true positive a step removed, with its reason.
"""

from __future__ import annotations

import argparse
import json

SECURITY_KINDS = {
    "sql_injection", "command_injection", "xss", "ssrf", "path_traversal",
    "insecure_deserialization", "auth_bypass", "unsafe_eval", "weak_crypto",
    "hardcoded_credential", "csrf", "clickjacking_or_insecure_headers",
    "origin_or_host_validation", "open_redirect", "authz_logic",
}  # fmt: skip


def applicable(f: dict) -> bool:
    return f.get("severity") != "HIGH" and f.get("kind") not in SECURITY_KINDS


def fb(p: float, r: float, b: float) -> float:
    return (1 + b * b) * p * r / (b * b * p + r) if p + r > 0 else 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--judged", required=True)
    ap.add_argument("--review", required=True)
    ap.add_argument("--run", type=int, default=0)
    ap.add_argument("--verify", required=True)
    ap.add_argument("--rank", required=True)
    ap.add_argument("--removed", action="store_true")
    a = ap.parse_args()
    j = json.load(open(a.judged))
    review = json.load(open(a.review))
    verify = json.load(open(a.verify))
    rank = json.load(open(a.rank))
    raw = j[f"lumo-raw-run{a.run}"]
    bots = j["bots"]

    # Per PR: findings with their raw judgement, verdict and rank.
    prs = {}
    for url, jr in raw.items():
        runs = review[url]["runs"]
        if a.run >= len(runs) or "findings" not in runs[a.run]:
            continue
        verdicts = {r["id"]: r for r in (verify.get(url, {}).get("results") or [])}
        ps = {r["id"]: r for r in (rank.get(url, {}).get("ranking") or [])}
        matched = {}
        for m in jr["matches"]:
            if m.get("matched") and m.get("human_action_id"):
                matched.setdefault(m["bot_issue_id"], set()).add(m["human_action_id"])
        rows = []
        for i, f in enumerate(runs[a.run]["findings"]):
            fid = f"f{i}"
            rows.append({
                "f": f,
                "id": fid,
                "app": applicable(f),
                "rejected": verdicts.get(fid, {}).get("verdict") == "REJECTED",
                "vreason": verdicts.get(fid, {}).get("reason", ""),
                "p": ps.get(fid, {}).get("p"),
                "preason": ps.get(fid, {}).get("reason", ""),
                "acts": matched.get(f"S{i + 1}", set()),
            })
        prs[url] = rows

    total_actions = sum(b["actions"] for b in bots.values())
    pointed = {u: set(b.get("botMatchedActions", [])) for u, b in bots.items()}
    n_pointed = sum(len(v) for v in pointed.values())

    def score(name: str, keep) -> None:
        s = tp = 0
        found: set = set()
        for url, rows in prs.items():
            for r in rows:
                if keep(r):
                    s += 1
                    tp += bool(r["acts"])
                    found |= {(url, x) for x in r["acts"]}
        p = tp / s if s else 0
        rc = len(found) / total_actions
        bp = sum((u, x) in found for u, v in pointed.items() for x in v)
        print(f"  {name:34} n={s:3}  P {100 * p:5.1f}  R {100 * rc:5.1f}  F1 {100 * fb(p, rc, 1):5.1f}  "
              f"F2 {100 * fb(p, rc, 2):5.1f}  bot-pointed {bp}/{n_pointed}")

    print(f"run {a.run}")
    score("raw review", lambda r: True)
    score("verifier only", lambda r: not (r["app"] and r["rejected"]))
    for t in (10, 18, 25, 35):
        score(f"ranker only, p>={t}", lambda r, t=t: not (r["app"] and r["p"] is not None and r["p"] < t))
    for t in (5, 10, 18, 25):
        score(f"verifier + ranker p>={t}", lambda r, t=t: not (r["app"] and (r["rejected"] or (r["p"] is not None and r["p"] < t))))
    score("drop every LOW (no model)", lambda r: r["f"].get("severity") != "LOW")

    shipped = j.get(f"lumo-run{a.run}", {})
    if shipped:
        s = sum(v["suggestions"] for v in shipped.values())
        tp = sum(v["matchedSuggestions"] for v in shipped.values())
        fa = sum(v["matchedActions"] for v in shipped.values())
        p, rc = tp / s, fa / total_actions
        print(f"  {'shipped, real judge (check)':34} n={s:3}  P {100 * p:5.1f}  R {100 * rc:5.1f}  F1 {100 * fb(p, rc, 1):5.1f}  "
              f"F2 {100 * fb(p, rc, 2):5.1f}")

    if a.removed:
        print("\ntrue positives removed:")
        for url, rows in prs.items():
            for r in rows:
                if not (r["acts"] and r["app"]):
                    continue
                why = ("VERIFIER: " + r["vreason"]) if r["rejected"] else (
                    f"RANKER p={r['p']}: {r['preason']}" if r["p"] is not None and r["p"] < 18 else None)
                if why:
                    tag = "bot-pointed" if r["acts"] & pointed.get(url, set()) else "other"
                    print(f"- [{tag}] {url.split('github.com/')[1]} {r['f']['severity']}/{r['f']['kind']} "
                          f"{r['f']['title'][:90]}\n    {why[:300]}")


if __name__ == "__main__":
    main()
