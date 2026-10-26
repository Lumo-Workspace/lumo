"""LUM-1286: embedding recall + cosine-threshold gate vs the shipped bigram/LLM gate.

Usage: python3 embed_analyze.py <dupeval_dir>
Pools per case:
  A (window): the 200 issues created just before (canonical swapped in) — same as the LLM eval
  B (history): every issue created before it in the fetched window, plus the canonical
"""
import json, os, re, sys
import numpy as np

D = sys.argv[1]
DIM = 1024
POOL = 200
CJK = re.compile(r'[一-鿿]')
REPOS = [('vscode', f'{D}/data', f'{D}/rerun'), ('go', f'{D}/repos/golang__go', None),
         ('flutter', f'{D}/repos/flutter__flutter', None), ('home-assistant', f'{D}/repos/home-assistant__core', None),
         ('rust', f'{D}/repos/rust-lang__rust', None), ('1Panel', f'{D}/repos/1Panel-dev__1Panel', None),
         ('siyuan', f'{D}/repos/siyuan-note__siyuan', None)]
THRS = [0.70, 0.75, 0.80, 0.85, 0.90]


def load_jsonl(p):
    return [json.loads(l) for l in open(p)] if p and os.path.exists(p) else []


agg = {'pos': [], 'neg': []}
h2h = []
print(f'{"repo":15} {"pairs":>5} | {"bigram@20":>9} {"emb@20 A":>8} | {"emb@1 B":>7} {"emb@5 B":>7} {"emb@20 B":>8}')
for name, d, gdir in REPOS:
    if not os.path.exists(f'{d}/emb_ids.json'):
        continue
    issues = json.load(open(f'{d}/issues.json'))
    dups = [x for x in json.load(open(f'{d}/dups.json')) if not x['meta']]
    labelled = set(json.load(open(f'{d}/dup_labelled.json')))
    ids = json.load(open(f'{d}/emb_ids.json'))
    M = np.fromfile(f'{d}/emb.f32', dtype='<f4').reshape(-1, DIM)[:len(ids)]
    M = M / np.linalg.norm(M, axis=1, keepdims=True)
    row = {n: i for i, n in enumerate(ids)}
    order = [x['number'] for x in issues]
    pos_of = {n: i for i, n in enumerate(order)}
    need = set(order) | {x['canonical']['number'] for x in dups}
    if not need <= row.keys():
        print(f'{name:15} (embeddings incomplete: {len(need - row.keys())} missing, skipped)')
        continue
    O = M[[row[n] for n in order]]  # issue vectors in creation order
    titles = {x['number']: x['title'] for x in issues}
    bigram = {r['id']: r['prefilterRank'] for r in load_jsonl(f'{d}/prefilter.jsonl')}

    pos = []
    for dp in dups:
        i = pos_of.get(dp['number'])
        if i is None or i < POOL:
            continue
        q = M[row[dp['number']]]
        c = dp['canonical']['number']
        prior = order[:i]
        hist_nums = prior if c in pos_of and pos_of[c] < i else prior + [c]
        sims = M[[row[n] for n in hist_nums]] @ q  # history pool (B)
        cs = float(M[row[c]] @ q)
        rank_b = int((sims > cs).sum()) + 1
        win = prior[-POOL:] if c in prior[-POOL:] else prior[-(POOL - 1):] + [c]  # same pool as the LLM eval (A)
        rank_a = int(((M[[row[n] for n in win]] @ q) > cs).sum()) + 1
        others = sims[np.array(hist_nums) != c]
        pos.append({'id': f'pos-{dp["number"]}', 'cos': cs, 'rankA': rank_a, 'rankB': rank_b,
                    'maxOther': float(others.max()) if len(others) else 0.0,
                    'bigram': bigram.get(f'pos-{dp["number"]}'), 'cjk': bool(CJK.search(dp['title'])), 'repo': name})
    neg = []
    dupn = {x['number'] for x in json.load(open(f'{d}/dups.json'))}
    for i in range(POOL, len(order)):
        n = order[i]
        if n in labelled or n in dupn:
            continue
        q = O[i]
        sims = O[:i] @ q
        neg.append({'id': f'neg-{n}', 'maxB': float(sims.max()), 'maxA': float(sims[-POOL:].max()),
                    'cjk': bool(CJK.search(titles[n])), 'repo': name})
    agg['pos'] += pos
    agg['neg'] += neg
    n = len(pos)
    at = lambda k, key: sum(1 for p in pos if p[key] <= k) / n
    bg = [p for p in pos if p['bigram'] is not None]
    print(f'{name:15} {n:5d} | {sum(1 for p in bg if 0 < p["bigram"] <= 20) / max(1, len(bg)):9.0%} {at(20, "rankA"):8.0%} | '
          f'{at(1, "rankB"):7.0%} {at(5, "rankB"):7.0%} {at(20, "rankB"):8.0%}')

    # head-to-head on the exact cases the LLM gate ran
    for g in load_jsonl(f'{(gdir or d)}/gate.jsonl'):
        if g.get('meta'):
            continue
        e = next((p for p in pos if p['id'] == g['id']), None) if g['kind'] == 'pos' else next((x for x in neg if x['id'] == g['id']), None)
        if e:
            h2h.append((g, e))

pos, neg = agg['pos'], agg['neg']
n = len(pos)
bg = [p for p in pos if p['bigram'] is not None]
print(f'{"ALL":15} {n:5d} | {sum(1 for p in bg if 0 < p["bigram"] <= 20) / len(bg):9.0%} '
      f'{sum(1 for p in pos if p["rankA"] <= 20) / n:8.0%} | {sum(1 for p in pos if p["rankB"] <= 1) / n:7.0%} '
      f'{sum(1 for p in pos if p["rankB"] <= 5) / n:7.0%} {sum(1 for p in pos if p["rankB"] <= 20) / n:8.0%}')
cj = [p for p in pos if p['cjk']]
if cj:
    cbg = [p for p in cj if p['bigram'] is not None]
    print(f'{"CJK titles":15} {len(cj):5d} | {sum(1 for p in cbg if 0 < p["bigram"] <= 20) / max(1, len(cbg)):9.0%} '
          f'{sum(1 for p in cj if p["rankA"] <= 20) / len(cj):8.0%} | {sum(1 for p in cj if p["rankB"] <= 1) / len(cj):7.0%} '
          f'{sum(1 for p in cj if p["rankB"] <= 5) / len(cj):7.0%} {sum(1 for p in cj if p["rankB"] <= 20) / len(cj):8.0%}')

print('\n## Candidate set for the LLM, same 200-window pool (A)')
def rate(ps, f): return f'{sum(1 for p in ps if f(p)) / len(ps):4.0%}'
for label, ps in [('ALL', pos), ('CJK', [p for p in pos if p['cjk']])]:
    bp = [p for p in ps if p['bigram'] is not None]
    if not bp: continue
    print(f'  {label:4} n={len(bp):4d}  bigram top20 {rate(bp, lambda p: 0 < p["bigram"] <= 20)}'
          f'  emb top20 {rate(bp, lambda p: p["rankA"] <= 20)}'
          f'  bigram10+emb10 {rate(bp, lambda p: 0 < p["bigram"] <= 10 or p["rankA"] <= 10)}'
          f'  bigram20+emb20 (40) {rate(bp, lambda p: 0 < p["bigram"] <= 20 or p["rankA"] <= 20)}')
print(f'\n## Cosine-only gate over full history (B): caught = canonical cos >= t; neg blocked = any prior issue >= t')
print(f'   pos n={n}  neg n={len(neg)}')
for t in THRS:
    c = sum(1 for p in pos if p['cos'] >= t)
    ctop = sum(1 for p in pos if p['cos'] >= t and p['rankB'] == 1)
    b = sum(1 for x in neg if x['maxB'] >= t)
    bA = sum(1 for x in neg if x['maxA'] >= t)
    print(f'  t={t:.2f}: caught {c / n:4.0%} (top-1 {ctop / n:4.0%})   neg blocked {b / len(neg):4.0%} (200-window {bA / len(neg):4.0%})')

print('\n## Head-to-head on the LLM-gate cases (same ids)')
gp = [(g, e) for g, e in h2h if g['kind'] == 'pos']
gn = [(g, e) for g, e in h2h if g['kind'] == 'neg' and not g['error']]
gn_all = [(g, e) for g, e in h2h if g['kind'] == 'neg']
print(f'  LLM gate (shipped): caught {sum(g["caughtExpected"] for g, _ in gp) / len(gp):.0%} of {len(gp)}; '
      f'neg blocked {sum(g["blocked"] for g, _ in gn) / max(1, len(gn)):.0%} of {len(gn)} non-error')
for t in THRS:
    print(f'  cosine t={t:.2f}: caught {sum(e["cos"] >= t for _, e in gp) / len(gp):4.0%}; '
          f'neg blocked {sum(e["maxB"] >= t for _, e in gn_all) / max(1, len(gn_all)):4.0%} of {len(gn_all)}')
