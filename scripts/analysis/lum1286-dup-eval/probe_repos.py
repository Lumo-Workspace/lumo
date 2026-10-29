"""Probe candidate repos for duplicate-pair yield. Usage: python3 probe_repos.py <start> <end> repo..."""
import json, re, subprocess, sys, time

START, END, REPOS = sys.argv[1], sys.argv[2], sys.argv[3:]
CJK = re.compile(r'[一-鿿]')


def gql(query, **v):
    args = ['gh', 'api', 'graphql', '-f', f'query={query}'] + [x for k, val in v.items() for x in ('-f', f'{k}={val}')]
    for a in range(5):
        p = subprocess.run(args, capture_output=True, text=True)
        if p.returncode == 0 and 'errors' not in (d := json.loads(p.stdout)):
            return d['data']
        time.sleep(2 * (a + 1))
    raise RuntimeError(p.stderr[-200:] or p.stdout[-200:])


COUNT = 'query($q:String!){search(query:$q,type:ISSUE,first:1){issueCount}}'
SAMPLE = '''query($q:String!){search(query:$q,type:ISSUE,first:50){nodes{... on Issue{title
  timelineItems(itemTypes:[CLOSED_EVENT,MARKED_AS_DUPLICATE_EVENT],last:5){nodes{
    ... on ClosedEvent{duplicateOf{... on Issue{number}}}
    ... on MarkedAsDuplicateEvent{canonical{... on Issue{number}}}}}}}}}'''

print(f'{"repo":32} {"issues":>7} {"dupClosed":>9} {"withCanon":>9} {"estPairs":>8} {"cjk%":>5}')
for repo in REPOS:
    base = f'repo:{repo} is:issue created:{START}..{END}'
    total = gql(COUNT, q=base)['search']['issueCount']
    dup = gql(COUNT, q=base + ' reason:duplicate')['search']['issueCount']
    nodes = [n for n in gql(SAMPLE, q=base + ' reason:duplicate')['search']['nodes'] if n]
    canon = sum(1 for n in nodes if any((e or {}).get('duplicateOf') or (e or {}).get('canonical') for e in n['timelineItems']['nodes']))
    frac = canon / len(nodes) if nodes else 0
    cjk = sum(1 for n in nodes if CJK.search(n['title'])) / len(nodes) if nodes else 0
    print(f'{repo:32} {total:7d} {dup:9d} {canon:4d}/{len(nodes):<4d} {int(dup * frac):8d} {cjk:5.0%}', flush=True)
