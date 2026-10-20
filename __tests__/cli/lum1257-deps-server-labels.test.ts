/**
 * @jest-environment node
 */
/**
 * LUM-1257 × LUM-1256 — DEPS findings get the same server labels as secret
 * findings: the default branch's baseline holds the managed scan's dependency
 * fingerprints (osv-scanner runs there as an external tool), so an advisory
 * already on main reads ON_MAIN; the policy is applied with the provenance the
 * server gives DEPENDENCY rows (EXTERNAL_TOOL); `--pr` compares DEPENDENCY rows
 * by fingerprint.
 */
import { dependencyFingerprint } from '@/lib/security-scan/redact'
import {
  formatLocalScan,
  localScanJson,
  type LocalFinding,
} from '../../cli/src/lib/local-scan-report'
import type { ScanContext } from '../../cli/src/lib/scan-context'
import {
  comparePrFindings,
  labelFinding,
  type ServerPrFinding,
} from '../../cli/src/lib/scan-labels'
import { toDependencyFinding } from '../../cli/src/lib/osv-advisory'
import { LODASH_VULN } from '../../cli/test-support/osv-fixtures'

const FP = dependencyFingerprint(
  'npm',
  'lodash',
  '4.17.15',
  'GHSA-35jh-r3h4-6jhm'
)

const ctx = (over: Partial<ScanContext> = {}): ScanContext => ({
  version: 1,
  repo: 'acme/app',
  baseline: null,
  rulings: [],
  learnings: [],
  learningsScope: 'auto',
  policy: { block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }] },
  pullRequest: { number: 12, headSha: 'abc' },
  ...over,
})

function depsFinding(): LocalFinding {
  const r = toDependencyFinding(
    {
      ecosystem: 'npm',
      name: 'lodash',
      version: '4.17.15',
      filePath: 'package-lock.json',
      ids: ['GHSA-35jh-r3h4-6jhm'],
      vulns: [LODASH_VULN],
    },
    [],
    new Date('2026-10-19T00:00:00Z')
  )
  if (!('finding' in r)) throw new Error('expected a finding')
  return r.finding
}

describe('DEPS findings and the server context', () => {
  it('an advisory in the default branch baseline reads "already on main" and never blocks', () => {
    const f = depsFinding()
    expect(f.fingerprint).toBe(FP)
    const l = labelFinding(
      f,
      ctx({
        baseline: {
          sha: 'mainsha',
          at: '2026-10-19T00:00:00.000Z',
          partial: false,
          fingerprints: [FP],
        },
        policy: { block: [{ provenance: 'EXTERNAL_TOOL', severity: 'HIGH' }] },
      })
    )
    expect(l).toMatchObject({ status: 'ON_MAIN', wouldBlockDone: false })
  })

  it('applies the policy with the EXTERNAL_TOOL provenance the server gives DEPENDENCY rows', () => {
    const f = depsFinding()
    expect(labelFinding(f, ctx()).wouldBlockDone).toBe(false)
    expect(
      labelFinding(
        f,
        ctx({
          policy: {
            block: [{ provenance: 'EXTERNAL_TOOL', severity: 'HIGH' }],
          },
        })
      )
    ).toMatchObject({ status: 'NEW', wouldBlockDone: true })
  })

  it('a ruling on the fingerprint labels the DEPS finding', () => {
    const l = labelFinding(
      depsFinding(),
      ctx({
        rulings: [
          {
            fingerprint: FP,
            ruleId: 'ext:osv-scanner:GHSA-35jh-r3h4-6jhm',
            disposition: 'ACCEPTED_RISK',
            by: 'Alice',
            at: '2026-10-17T08:00:00.000Z',
            pullRequest: 12,
          },
        ],
      })
    )
    expect(l).toMatchObject({ status: 'ACCEPTED_RISK', carriesOver: true })
  })

  it('--pr compares DEPENDENCY rows by fingerprint and leaves other kinds alone', () => {
    const row = (over: Partial<ServerPrFinding>): ServerPrFinding => ({
      kind: 'DEPENDENCY',
      ruleId: 'ext:osv-scanner:GHSA-35jh-r3h4-6jhm',
      severity: 'HIGH',
      provenance: 'EXTERNAL_TOOL',
      filePath: 'package-lock.json',
      line: null,
      title: 'Command Injection in lodash',
      fingerprint: FP,
      open: true,
      disposition: null,
      ...over,
    })
    const c = comparePrFindings(
      [
        row({}),
        row({ fingerprint: 'gone', ruleId: 'ext:osv-scanner:GHSA-gone' }),
        row({ kind: 'SECRET', provenance: 'DETERMINISTIC', fingerprint: 'x' }),
      ],
      [depsFinding()],
      ['DEPS']
    )
    expect(c.stillOpen.map(f => f.fingerprint)).toEqual([FP])
    expect(c.fixedLocally.map(f => f.fingerprint)).toEqual(['gone'])
  })

  it("the human report and --json carry the DEPS finding's server label", () => {
    const f = {
      ...depsFinding(),
      server: labelFinding(
        depsFinding(),
        ctx({
          baseline: {
            sha: 's',
            at: '2026-10-19T00:00:00.000Z',
            partial: false,
            fingerprints: [FP],
          },
        })
      ),
    }
    const result = {
      scanners: ['DEPS' as const],
      scope: 'staged changes',
      filesScanned: 0,
      skipped: [],
      elapsedMs: 5,
      findings: [f],
    }
    expect(formatLocalScan(result)).toContain('Server:    already on main')
    const json = localScanJson(result) as {
      findings: { server: { status: string } | null }[]
    }
    expect(json.findings[0]?.server?.status).toBe('ON_MAIN')
  })
})
