"""LUM-1286 eval: mine microsoft/vscode duplicate pairs + a contiguous issue window.

Usage: python3 fetch.py <out_dir> <start YYYY-MM-DD> <end YYYY-MM-DD>
Writes issues.json (every issue created in the window, oldest first) and
dups.json (issues in the window marked as duplicate, with their canonical).
"""
import json, subprocess, sys, time, datetime as dt

OUT, START, END = sys.argv[1], sys.argv[2], sys.argv[3]
import os
REPO = os.environ.get('REPO', 'microsoft/vscode')


def gql(query, **vars):
    args = ['gh', 'api', 'graphql', '-f', f'query={query}']
    for k, v in vars.items():
        if v is not None:
            args += ['-F' if isinstance(v, int) else '-f', f'{k}={v}']
    for attempt in range(6):
        p = subprocess.run(args, capture_output=True, text=True)
        if p.returncode == 0:
            d = json.loads(p.stdout)
            if 'errors' not in d:
                return d['data']
            err = d['errors']
        else:
            err = p.stderr[-300:]
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(err)


SEARCH = '''query($q:String!,$after:String){ search(query:$q,type:ISSUE,first:100,after:$after){
  issueCount pageInfo{hasNextPage endCursor}
  nodes{ ... on Issue { number title createdAt stateReason
    labels(first:20){nodes{name}}
    timelineItems(itemTypes:[MARKED_AS_DUPLICATE_EVENT,CLOSED_EVENT],last:10){nodes{
      ... on MarkedAsDuplicateEvent { canonical { ... on Issue { number title createdAt repository{nameWithOwner} } } }
      ... on ClosedEvent { duplicateOf { ... on Issue { number title createdAt repository{nameWithOwner} } } } }}
  } } } }'''


def days(a, b, step):
    d = dt.date.fromisoformat(a)
    e = dt.date.fromisoformat(b)
    while d <= e:
        n = min(d + dt.timedelta(days=step - 1), e)
        yield d.isoformat(), n.isoformat()
        d = n + dt.timedelta(days=1)


issues = {}
# search caps at 1000 results per query, so walk the window a few days at a time
for a, b in days(START, END, 3):
    after = None
    while True:
        q = f'repo:{REPO} is:issue created:{a}..{b}'
        r = gql(SEARCH, q=q, after=after)['search']
        if r['issueCount'] > 1000:
            raise SystemExit(f'window {a}..{b} has {r["issueCount"]} issues; shrink the step')
        for n in r['nodes']:
            if n:
                issues[n['number']] = n
        if not r['pageInfo']['hasNextPage']:
            break
        after = r['pageInfo']['endCursor']
    sys.stderr.write(f'{a}..{b}: total {len(issues)}\n')

rows = sorted(issues.values(), key=lambda n: n['createdAt'])
out_issues = [{'number': n['number'], 'title': n['title'], 'createdAt': n['createdAt']} for n in rows]

dups = []
for n in rows:
    canon = [e.get('canonical') or e.get('duplicateOf') for e in n['timelineItems']['nodes'] if e]
    canon = [c for c in canon if c]
    canon = [c for c in canon if c.get('repository', {}).get('nameWithOwner') == REPO and c['number'] != n['number']]
    if not canon:
        continue
    c = canon[-1]  # the last marking wins if it was re-pointed
    dups.append({'number': n['number'], 'title': n['title'], 'createdAt': n['createdAt'],
                 'canonical': {'number': c['number'], 'title': c['title'], 'createdAt': c['createdAt']},
                 'meta': c['title'].lower().startswith('meta')})

labelled = {n['number'] for n in rows if any(l['name'] == '*duplicate' for l in n['labels']['nodes'])
            or n.get('stateReason') == 'DUPLICATE'}
json.dump(out_issues, open(f'{OUT}/issues.json', 'w'))
json.dump(dups, open(f'{OUT}/dups.json', 'w'))
json.dump(sorted(labelled), open(f'{OUT}/dup_labelled.json', 'w'))
sys.stderr.write(f'issues={len(out_issues)} dups_with_canonical={len(dups)} dup_labelled={len(labelled)}\n')
