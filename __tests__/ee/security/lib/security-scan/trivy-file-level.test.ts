/**
 * LUM-851 — trivy checks with no line of their own (DS-0002 "no USER") stop
 * posing as line 1. The fixtures under `__tests__/fixtures/lum851/` are real
 * trivy 0.74.0 output from `scripts/security/lum851-sandbox-probe.ts`, made
 * by the production script in a Vercel Sandbox:
 *   trivy.json / trivy.sarif        the LUM-846 probe tree (DS-0001 is a
 *                                   real `FROM node:latest` on line 1)
 *   pr-no-user.*                    a PR that deletes only the USER line
 *                                   from a Dockerfile whose line 1 is a comment
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  changedLinesOfDiff,
  normalizeSarif,
  parseSarif,
  trivyFileLevelKeys,
} from '@/lib/security-scan/sarif'

const read = (dir: string, name: string) =>
  readFileSync(join(__dirname, '../../../../fixtures', dir, name), 'utf8')
const sarif = (dir: string, name: string) =>
  parseSarif(JSON.parse(read(dir, name)))

const runs = sarif('lum851', 'trivy.sarif')
const fileLevel = trivyFileLevelKeys(JSON.parse(read('lum851', 'trivy.json')))
const rule = (id: string) => `ext:trivy:${id}`

describe('LUM-851 file-level trivy checks', () => {
  it('LUM-851 file-level DS-0002 has no line and is kept when its file is in the diff', () => {
    // The PR touched only line 3 of the Dockerfile.
    const out = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: new Map([['Dockerfile', new Set([3])]]),
      fileLevelResults: fileLevel,
    })
    expect(out.findings.map(f => [f.ruleId, f.line])).toEqual([
      [rule('DS-0002'), null],
    ])
    expect(out.findings[0]).toMatchObject({
      severity: 'HIGH',
      filePath: 'Dockerfile',
      detail:
        'Specify at least 1 USER command in Dockerfile with non-root user as argument',
    })
  })

  it('LUM-851 file-level DS-0002 is still dropped when its file is not in the diff', () => {
    const out = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: new Map([['README.md', new Set([1])]]),
      fileLevelResults: fileLevel,
    })
    expect(out.findings).toEqual([])
  })

  it('LUM-851 file-level only DS-0002 is lineless in the probe tree', () => {
    expect([...fileLevel].map(k => k.split('\u0000')[0])).toEqual(['DS-0002'])
  })

  it('LUM-851 file-level a deletion-only file stays in changedLinesOfDiff and a deleted file does not', () => {
    const diff = read('lum851', 'pr-no-user.diff')
    expect(changedLinesOfDiff(diff)).toEqual(
      new Map([['Dockerfile', new Set()]])
    )
    const withDeletedFile = [
      diff.trimEnd(),
      'diff --git a/old.yaml b/old.yaml',
      'deleted file mode 100644',
      '--- a/old.yaml',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-kind: Pod',
      'diff --git a/new.txt b/new.txt',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1 @@',
      '+hi',
    ].join('\n')
    expect(changedLinesOfDiff(withDeletedFile)).toEqual(
      new Map([
        ['new.txt', new Set([1])],
        ['Dockerfile', new Set()],
      ])
    )
  })

  it('LUM-851 file-level the real PR that deletes USER reports DS-0002 and the old filter did not', () => {
    const prRuns = sarif('lum851', 'pr-no-user.trivy.sarif')
    const changedLines = changedLinesOfDiff(read('lum851', 'pr-no-user.diff'))
    const after = normalizeSarif(prRuns, {
      toolHint: 'trivy',
      changedLines,
      fileLevelResults: trivyFileLevelKeys(
        JSON.parse(read('lum851', 'pr-no-user.trivy.json'))
      ),
    })
    expect(after.findings.map(f => [f.ruleId, f.line])).toEqual([
      [rule('DS-0002'), null],
    ])
    // Pre-LUM-851: SARIF line 1, and line 1 is not an added line.
    const before = normalizeSarif(prRuns, { toolHint: 'trivy', changedLines })
    expect(before.findings).toEqual([])
    expect(before.dropped.notInDiff).toBe(1)
  })
})

describe('LUM-851 real first-line trivy findings', () => {
  it('LUM-851 real first-line DS-0001 keeps line 1 when line 1 was added', () => {
    const out = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: new Map([['Dockerfile', new Set([1, 2, 3, 4])]]),
      fileLevelResults: fileLevel,
    })
    expect(out.findings.find(f => f.ruleId === rule('DS-0001'))?.line).toBe(1)
  })

  it('LUM-851 real first-line DS-0001 is filtered out when the PR did not add line 1', () => {
    const out = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: new Map([['Dockerfile', new Set([3])]]),
      fileLevelResults: fileLevel,
    })
    expect(out.findings.some(f => f.ruleId === rule('DS-0001'))).toBe(false)
  })
})

describe('LUM-851 invariant', () => {
  const fingerprints = (o: ReturnType<typeof normalizeSarif>) =>
    o.findings.map(f => `${f.ruleId} ${f.fingerprint}`).sort()

  it('LUM-851 invariant trivy fingerprints are identical with and without the file-level signal', () => {
    const withSignal = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: null,
      fileLevelResults: fileLevel,
    })
    const without = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: null,
    })
    expect(fingerprints(withSignal)).toEqual(fingerprints(without))
    expect(withSignal.findings).toHaveLength(15)
    // …and identical to LUM-846's direct `--format sarif` of the same tree,
    // so baselines stored before this change still match (persisting).
    const lum846 = normalizeSarif(sarif('lum846', 'trivy.sarif'), {
      toolHint: 'trivy',
      changedLines: null,
    })
    expect(fingerprints(withSignal)).toEqual(fingerprints(lum846))
  })

  it('LUM-851 invariant only the lineless result loses its line', () => {
    const withSignal = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: null,
      fileLevelResults: fileLevel,
    })
    const without = normalizeSarif(runs, {
      toolHint: 'trivy',
      changedLines: null,
    })
    const lines = (o: typeof without) =>
      o.findings.map(f => (f.ruleId === rule('DS-0002') ? 'x' : f.line))
    expect(lines(withSignal)).toEqual(lines(without))
  })

  it('LUM-851 invariant a check with a lined twin is not file-level', () => {
    const doc = JSON.parse(read('lum851', 'trivy.json')) as {
      Results: Array<{
        Misconfigurations?: Array<{
          ID: string
          CauseMetadata: Record<string, unknown>
        }>
      }>
    }
    const ds2 = doc.Results.flatMap(r => r.Misconfigurations ?? []).find(
      m => m.ID === 'DS-0002'
    )!
    doc.Results.push({
      ...doc.Results.find(r => r.Misconfigurations?.includes(ds2))!,
      Misconfigurations: [
        {
          ...ds2,
          CauseMetadata: { ...ds2.CauseMetadata, StartLine: 1, EndLine: 1 },
        },
      ],
    })
    expect(trivyFileLevelKeys(doc).size).toBe(0)
  })

  it('LUM-851 invariant malformed trivy JSON yields no file-level keys', () => {
    for (const doc of [null, 'x', [], { Results: 'no' }, { Results: [{}] }]) {
      expect(trivyFileLevelKeys(doc).size).toBe(0)
    }
  })
})
