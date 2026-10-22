"""Paired comparison: step-1 bigram gate vs step-2 embedding gate on the same cases.

Usage: python3 compare.py <name>=<bigram gate.jsonl>,<embedding gate.jsonl> ...
Only case ids present in both files count. Note the bigram runs swapped the
canonical into the recent-200 pool, so they are an optimistic baseline.
"""
import json, sys


def load(p):
    return {(r := json.loads(l))['id']: r for l in open(p)}


def p(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] / 1000 if xs else 0


tot = {'b': [], 'e': []}
print(f'{"repo":10} {"n":>7} | {"caught b→e":>13} | {"negBlocked b→e":>15} | {"errors b→e":>11} | {"p50 b→e":>9} | {"p90 b→e":>9}')
for arg in sys.argv[1:]:
    name, files = arg.split('=')
    bf, ef = files.split(',')
    b, e = load(bf), load(ef)
    ids = [i for i in e if i in b and not e[i].get('meta')]
    pos = [i for i in ids if e[i]['kind'] == 'pos']
    neg = [i for i in ids if e[i]['kind'] == 'neg']
    negok = [i for i in neg if not b[i]['error'] and not e[i]['error']]
    tot['b'] += [b[i] for i in ids]
    tot['e'] += [e[i] for i in ids]
    c = lambda d: sum(d[i]['caughtExpected'] for i in pos)
    nb = lambda d: sum(d[i]['blocked'] for i in negok)
    er = lambda d: sum(1 for i in ids if d[i]['error'])
    print(f'{name:10} {len(pos):3d}/{len(neg):<3d} | {c(b):4d} → {c(e):<4d}/{len(pos):<3d} | {nb(b):5d} → {nb(e):<4d}/{len(negok):<3d} | '
          f'{er(b):3d} → {er(e):<3d}  | {p([b[i]["ms"] for i in ids], .5):3.0f}→{p([e[i]["ms"] for i in ids], .5):3.0f}s | '
          f'{p([b[i]["ms"] for i in ids], .9):3.0f}→{p([e[i]["ms"] for i in ids], .9):3.0f}s')
B, E = tot['b'], tot['e']
pb = [x for x in B if x['kind'] == 'pos']
pe = [x for x in E if x['kind'] == 'pos']
print(f'{"ALL":10} caught {sum(x["caughtExpected"] for x in pb)}/{len(pb)} → {sum(x["caughtExpected"] for x in pe)}/{len(pe)};'
      f' errors {sum(1 for x in B if x["error"])} → {sum(1 for x in E if x["error"])} of {len(E)}')
