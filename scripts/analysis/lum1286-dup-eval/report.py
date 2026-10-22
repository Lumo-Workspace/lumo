"""Aggregate LUM-1286 eval results per repo. Usage: python3 report.py <dupeval_dir>"""
import json, os, re, sys

D = sys.argv[1]
CJK = re.compile(r'[一-鿿]')
REPOS = [('microsoft/vscode', f'{D}/rerun')] + [
    (r.replace('__', '/'), f'{D}/repos/{r}') for r in
    ['golang__go', 'flutter__flutter', 'home-assistant__core', 'rust-lang__rust', '1Panel-dev__1Panel', 'siyuan-note__siyuan']]


def load(p):
    return [json.loads(l) for l in open(p)] if os.path.exists(p) else []


def pct(a, b):
    return f'{a / b:4.0%} ({a}/{b})' if b else '   -'


print('## Prefilter (no LLM): canonical within top-20 by bigram similarity')
print(f'{"repo":24} {"pairs":>5} {"@5":>5} {"@20":>5} {"@50":>5} {"inWindow":>8}')
allp = []
for name, d in REPOS:
    rows = [x for x in load(f'{d}/prefilter.jsonl') or load(f'{D}/data/prefilter.jsonl' if 'vscode' in name else '') if not x['meta']]
    allp += rows
    n = len(rows)
    if not n:
        continue
    at = lambda k: sum(1 for x in rows if 0 < x['prefilterRank'] <= k) / n
    print(f'{name:24} {n:5d} {at(5):5.0%} {at(20):5.0%} {at(50):5.0%} {sum(x["canonicalInWindow"] for x in rows) / n:8.0%}')
n = len(allp)
print(f'{"ALL":24} {n:5d} {sum(1 for x in allp if 0 < x["prefilterRank"] <= 5) / n:5.0%} '
      f'{sum(1 for x in allp if 0 < x["prefilterRank"] <= 20) / n:5.0%} {sum(1 for x in allp if 0 < x["prefilterRank"] <= 50) / n:5.0%}')

print('\n## Gate (shipped checkDuplicates, top-20, 45s, block >= 0.7)')
print(f'{"repo":24} {"caught":>13} {"modelHit|kept":>13} {"negBlocked":>13} {"errors":>12} {"p50":>5} {"p90":>5}')
tot = {'pos': [], 'neg': []}
for name, d in REPOS:
    rows = load(f'{d}/gate.jsonl')
    pos = [x for x in rows if x['kind'] == 'pos' and not x['meta']]
    neg = [x for x in rows if x['kind'] == 'neg']
    if not pos:
        continue
    tot['pos'] += pos
    tot['neg'] += neg
    kept = [x for x in pos if 0 < x['prefilterRank'] <= 20 and not x['error']]
    negok = [x for x in neg if not x['error']]
    allr = pos + neg
    ms = sorted(x['ms'] for x in allr)
    print(f'{name:24} {pct(sum(x["caughtExpected"] for x in pos), len(pos)):>13} '
          f'{pct(sum(x["caughtExpected"] for x in kept), len(kept)):>13} '
          f'{pct(sum(x["blocked"] for x in negok), len(negok)):>13} '
          f'{pct(sum(1 for x in allr if x["error"]), len(allr)):>12} '
          f'{ms[len(ms) // 2] / 1000:4.0f}s {ms[int(len(ms) * .9)] / 1000:4.0f}s')
pos, neg = tot['pos'], tot['neg']
kept = [x for x in pos if 0 < x['prefilterRank'] <= 20 and not x['error']]
negok = [x for x in neg if not x['error']]
print(f'{"ALL":24} {pct(sum(x["caughtExpected"] for x in pos), len(pos)):>13} '
      f'{pct(sum(x["caughtExpected"] for x in kept), len(kept)):>13} '
      f'{pct(sum(x["blocked"] for x in negok), len(negok)):>13} '
      f'{pct(sum(1 for x in pos + neg if x["error"]), len(pos + neg)):>12}')

cjk = [x for x in pos if CJK.search(x['title'])]
if cjk:
    kc = [x for x in cjk if 0 < x['prefilterRank'] <= 20]
    print(f'\nCJK-titled positives: n={len(cjk)} prefilter@20 {len(kc) / len(cjk):.0%} caught {sum(x["caughtExpected"] for x in cjk) / len(cjk):.0%}')

print('\n## Threshold sweep (all repos)')
for t in (0.7, 0.8, 0.85, 0.9, 0.95):
    c = sum(1 for x in pos if any(m['n'] == x['expected'] and m['s'] >= t for m in x['matches']))
    b = sum(1 for x in negok if any(m['s'] >= t for m in x['matches']))
    print(f'  {t:.2f}: caught {pct(c, len(pos))}   negBlocked {pct(b, len(negok))}')
