/** @jest-environment node */
/**
 * LUM-1257 — a `lumo security scan --deps` finding is the managed scan's
 * DEPENDENCY finding: same rule id, severity, fingerprint, path and no line,
 * for the same osv-scanner result. The server side is `normalizeSarif` over
 * osv-scanner's SARIF; the local side is the CLI's `toDependencyFinding`
 * over the OSV records (API) or osv-scanner's JSON (`--full`).
 */
import { normalizeSarif, parseSarif } from '@/ee/security/security-scan/sarif'
import {
  toDependencyFinding,
  type OsvVuln,
} from '../../../cli/src/lib/osv-advisory'

interface Case {
  name: string
  version: string
  id: string
  aliases: string[]
  /** osv-scanner's group `max_severity` / SARIF `security-severity`; null when unscored. */
  score: number | null
}

const CASES: Case[] = [
  {
    name: 'lodash',
    version: '4.17.15',
    id: 'GHSA-35jh-r3h4-6jhm',
    aliases: ['CVE-2021-23337'],
    score: 7.2,
  },
  {
    name: '@babel/traverse',
    version: '7.22.0',
    id: 'GHSA-67hx-6x53-jw92',
    aliases: [],
    score: 9.3,
  },
  {
    name: 'evil-pkg',
    version: '1.0.0',
    id: 'MAL-2024-1234',
    aliases: [],
    score: null,
  },
  {
    name: 'minor',
    version: '2.0.0',
    id: 'GHSA-minor',
    aliases: [],
    score: 3.1,
  },
  { name: 'mid', version: '0.1.0', id: 'GHSA-mid', aliases: [], score: 5.5 },
  {
    name: 'unscored',
    version: '1.2.3',
    id: 'GHSA-unscored',
    aliases: [],
    score: null,
  },
]

function osvSarif(cases: Case[]) {
  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'osv-scanner',
            rules: cases.map(c => ({
              id: c.id,
              shortDescription: { text: `${c.id}: advisory` },
              ...(c.score === null
                ? {}
                : { properties: { 'security-severity': String(c.score) } }),
            })),
          },
        },
        results: cases.map(c => ({
          ruleId: c.id,
          level: 'warning',
          message: {
            text: `Package '${c.name}@${c.version}' is vulnerable to '${c.id}'${
              c.aliases.length
                ? ` (also known as ${c.aliases.map(a => `'${a}'`).join(', ')})`
                : ''
            }.`,
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'package-lock.json' },
              },
            },
          ],
        })),
      },
    ],
  }
}

describe('LUM-1257 local DEPS finding = managed DEPENDENCY finding', () => {
  const server = normalizeSarif(parseSarif(osvSarif(CASES)), {
    toolHint: 'osv-scanner',
    changedLines: null,
  }).findings

  it.each(CASES)('$name@$version $id', c => {
    const vuln: OsvVuln = { id: c.id, aliases: c.aliases }
    const local = toDependencyFinding(
      {
        ecosystem: 'npm',
        name: c.name,
        version: c.version,
        filePath: 'package-lock.json',
        ids: [c.id],
        vulns: [vuln],
        maxScore: c.score,
      },
      [],
      new Date('2026-10-19T00:00:00Z')
    )
    if (!('finding' in local)) throw new Error('expected a finding')
    const s = server.find(f => f.ruleId === `ext:osv-scanner:${c.id}`)
    expect(s).toBeDefined()
    expect({
      kind: local.finding.kind,
      ruleId: local.finding.ruleId,
      severity: local.finding.severity,
      fingerprint: local.finding.fingerprint,
      filePath: local.finding.filePath,
      line: local.finding.line,
      externalRef: local.finding.url,
    }).toEqual({
      kind: s?.kind,
      ruleId: s?.ruleId,
      severity: s?.severity,
      fingerprint: s?.fingerprint,
      filePath: s?.filePath,
      line: s?.line,
      externalRef: s?.externalRef,
    })
  })
})
