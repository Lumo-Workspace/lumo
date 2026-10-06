"""LUM-1010 — why the LUM-988 ranker helps on the Martian offline set and not
on fresh PRs. Scores both sets the same way, without re-judging:

  - ranker AUC (true vs false positives by p), overall and per finding group
    (logic_error / test+doc / other),
  - the verifier's rejection rate on true vs false positives,
  - P / R / F1 / F2 of raw, verifier, shipped (verifier + ranker p >= 18) and
    a variant where the ranker leaves test_defect / doc_mismatch alone.

Online labels come from judge.py's raw tags (S<k+1> = finding f<k>); offline
labels from the Martian step3 evals of the LUM-988 runs (Core profile, the way
score-rank.py counts them). The offline variant rows reproduce the published
LUM-988 numbers exactly, which is the check that both scorers are right.

  python3 ranker-diagnosis.py --online <lum1010 dir> \
    --offline-bench <crb>/offline --offline-evals <dir with lumo988-*.json>
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

SECURITY_KINDS = {
    "sql_injection", "command_injection", "xss", "ssrf", "path_traversal",
    "insecure_deserialization", "auth_bypass", "unsafe_eval", "weak_crypto",
    "hardcoded_credential", "csrf", "clickjacking_or_insecure_headers",
    "origin_or_host_validation", "open_redirect", "authz_logic",
}  # fmt: skip
CORE = {"bug", "security", "concurrency", "data", "api", "perf", "test_gap", "doc_defect"}
TEST_DOC = {"test_defect", "doc_mismatch"}
THRESHOLD = 18
LUM988 = Path(__file__).resolve().parent.parent / "lum988-code-review-replay"
OFFLINE_RUNS = [
    (0, "lumo988-sonnet55-v975desc", "verify-v3-run1.json", "rank-run1.json"),
    (1, "lumo988-sonnet55-v975desc-r2", "verify-v3-run2.json", "rank-run2.json"),
    (2, "lumo988-sonnet55-v975desc-r3", "verify-v3-run3.json", "rank-run3.json"),
]


def group(kind: str) -> str:
    return "logic_error" if kind == "logic_error" else "test/doc" if kind in TEST_DOC else "other"


def auc(pos: list[float], neg: list[float]) -> float:
    if not pos or not neg:
        return float("nan")
    return sum((p > n) + 0.5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg))


def fb(p: float, r: float, b: float) -> float:
    return (1 + b * b) * p * r / (b * b * p + r) if p + r else 0.0


def keeps(f: dict, rejected: bool, p: float | None) -> dict[str, bool]:
    app = f["severity"] != "HIGH" and f["kind"] not in SECURITY_KINDS
    low = p is not None and p < THRESHOLD
    return {
        "raw": True,
        "verifier": not (app and rejected),
        "shipped (verifier + ranker)": not (app and (rejected or low)),
        "ranker leaves test/doc alone": not (app and (rejected or (low and f["kind"] not in TEST_DOC))),
    }


def online(d: Path):
    """Rows: (finding, run, url, matched action ids, rejected, p)."""
    j = json.loads((d / "judged.json").read_text())
    review = json.loads((d / "review.json").read_text())
    rows = []
    total = 0
    for run in (0, 1):
        tag = f"lumo-raw-run{run}"
        if tag not in j:
            continue
        total += sum(b["actions"] for b in j["bots"].values())
        ver = json.loads((d / f"verify-run{run}.json").read_text())
        rank = json.loads((d / f"rank-run{run}.json").read_text())
        for url, jr in j[tag].items():
            runs = review[url]["runs"]
            if run >= len(runs) or "findings" not in runs[run]:
                continue
            matched: dict[str, set] = {}
            for m in jr["matches"]:
                if m.get("matched") and m.get("human_action_id"):
                    matched.setdefault(m["bot_issue_id"], set()).add((run, url, m["human_action_id"]))
            v = {x["id"]: x.get("verdict") for x in (ver.get(url, {}).get("results") or [])}
            p = {x["id"]: x["p"] for x in (rank.get(url, {}).get("ranking") or [])}
            for i, f in enumerate(runs[run]["findings"]):
                rows.append((f, matched.get(f"S{i + 1}", set()), v.get(f"f{i}") == "REJECTED", p.get(f"f{i}")))
    return rows, total


def offline(bench: Path, evals: Path):
    """Rows: (finding, #core golden matched, is FP, rejected, p); plus the core golden total."""
    review = json.loads((LUM988 / "results-sonnet55.json").read_text())
    cat = {}
    for f in (bench / "golden_comments").glob("*.json"):
        for pr in json.loads(f.read_text()):
            for g in pr["comments"]:
                cat[g["comment"].strip()] = g.get("category", "")
    rows, golden = [], 0
    for run, tool, vf, rf in OFFLINE_RUNS:
        ev_all = json.loads((evals / f"{tool}.json").read_text())
        ver = json.loads((LUM988 / vf).read_text())
        rank = json.loads((LUM988 / rf).read_text())
        for url, r in review.items():
            ev = ev_all.get(url, {}).get(tool)
            if not ev:
                continue

            def c(t: dict) -> str:
                return t.get("category") or cat.get(t.get("golden_comment", "").strip(), "")

            tp: dict[str, int] = {}
            for t in ev.get("true_positives", []):
                if c(t) in CORE:
                    tp[t.get("matched_candidate", "")] = tp.get(t.get("matched_candidate", ""), 0) + 1
            fps = {x.get("candidate", "") for x in ev.get("false_positives", [])}
            golden += sum(c(t) in CORE for t in ev.get("true_positives", []))
            golden += sum(c(t) in CORE for t in ev.get("false_negatives", []))
            v = {x["id"]: x["verdict"] for x in ver.get(url, {}).get("results", [])}
            p = {x["id"]: x["p"] for x in rank.get(url, {}).get("ranking", [])}
            for i, f in enumerate(r["runs"][run].get("findings", [])):
                text = f"{f['title']} - {f['detail']}"
                rows.append((f, tp.get(text, 0), text in fps, v.get(f"f{i}") == "REJECTED", p.get(f"f{i}")))
    return rows, golden


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--online", required=True, type=Path)
    ap.add_argument("--offline-bench", required=True, type=Path)
    ap.add_argument("--offline-evals", required=True, type=Path)
    a = ap.parse_args()

    on, on_total = online(a.online)
    off, off_golden = offline(a.offline_bench, a.offline_evals)

    print("Ranker AUC (true vs false positives by p)")
    for g in ("all", "logic_error", "test/doc", "other"):
        def sel(f: dict) -> bool:
            return g == "all" or group(f["kind"]) == g

        o_pos = [p for f, m, _, p in on if p is not None and sel(f) and m]
        o_neg = [p for f, m, _, p in on if p is not None and sel(f) and not m]
        f_pos = [p for f, tp, _, _, p in off if p is not None and sel(f) and tp]
        f_neg = [p for f, tp, fp, _, p in off if p is not None and sel(f) and fp and not tp]
        print(f"  {g:12} online {auc(o_pos, o_neg):.3f} ({len(o_pos)} TP / {len(o_neg)} FP)   "
              f"offline {auc(f_pos, f_neg):.3f} ({len(f_pos)} TP / {len(f_neg)} FP)")

    def app(f: dict) -> bool:
        return f["severity"] != "HIGH" and f["kind"] not in SECURITY_KINDS

    o_tp = [rej for f, m, rej, _ in on if app(f) and m]
    o_fp = [rej for f, m, rej, _ in on if app(f) and not m]
    f_tp = [rej for f, tp, _, rej, _ in off if app(f) and tp]
    f_fp = [rej for f, tp, fp, rej, _ in off if app(f) and fp and not tp]
    print("\nVerifier rejects   TP / FP")
    print(f"  online           {100 * sum(o_tp) / len(o_tp):4.1f}% / {100 * sum(o_fp) / len(o_fp):4.1f}%")
    print(f"  offline          {100 * sum(f_tp) / len(f_tp):4.1f}% / {100 * sum(f_fp) / len(f_fp):4.1f}%")

    print("\nShare of ranked findings that are test/doc: "
          f"online {sum(group(f['kind']) == 'test/doc' for f, *_ in on) / len(on):.0%}, "
          f"offline {sum(group(f['kind']) == 'test/doc' for f, *_ in off) / len(off):.0%}")

    print("\nVariants              online (2 runs pooled)              offline (3 runs, Core)")
    for name in keeps(on[0][0], False, None):
        s = tp = 0
        found: set = set()
        for f, m, rej, p in on:
            if keeps(f, rej, p)[name]:
                s += 1
                tp += bool(m)
                found |= m
        op, orc = tp / s, len(found) / on_total
        tp2 = fp2 = 0
        for f, t, fp, rej, p in off:
            if keeps(f, rej, p)[name]:
                tp2 += t
                fp2 += int(fp)
        fp_, fr = tp2 / (tp2 + fp2), tp2 / off_golden
        print(f"  {name:30} P {100 * op:4.1f} R {100 * orc:4.1f} F1 {100 * fb(op, orc, 1):4.1f} "
              f"F2 {100 * fb(op, orc, 2):4.1f}  |  P {100 * fp_:4.1f} R {100 * fr:4.1f} "
              f"F1 {100 * fb(fp_, fr, 1):4.1f} F2 {100 * fb(fp_, fr, 2):4.1f}")


if __name__ == "__main__":
    main()
