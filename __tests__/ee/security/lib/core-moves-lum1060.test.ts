/**
 * @jest-environment node
 *
 * LUM-1060 — PR1 of the open-core split (RFC LUM-1058 §7) moved pure helpers,
 * types and constants into the core and left re-exports at the old paths.
 * Pins two things: the old paths hand out the very same bindings (no second
 * copy that could drift), and the core-side files no longer reach the
 * security-scan barrel.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as coreControlCalls from '@/lib/diff/control-calls'
import * as coreDiffLines from '@/lib/diff/diff-lines'
import * as coreScanEvidence from '@/lib/retention/scan-evidence'
import * as oldDiffLines from '@/lib/security-scan/diff-lines'
import * as oldEvidenceRetention from '@/lib/security-scan/evidence-retention'
import * as oldPatterns from '@/lib/security-scan/graph/patterns'
import * as oldTrigger from '@/lib/security-scan/hunt/trigger'

describe('LUM-1060 re-exports at the old paths', () => {
  it('diff-lines is the core parser', () => {
    expect(oldDiffLines.addedLinesWithNumbers).toBe(
      coreDiffLines.addedLinesWithNumbers
    )
    expect(oldDiffLines.splitDiffByFile).toBe(coreDiffLines.splitDiffByFile)
  })

  it('the hunt trigger and graph patterns hand out the core control-call helpers', () => {
    expect(oldTrigger.addedControlCallIds).toBe(
      coreControlCalls.addedControlCallIds
    )
    expect(oldTrigger.calleesOf).toBe(coreControlCalls.calleesOf)
    expect(oldPatterns.CONTROL_RULES).toBe(coreControlCalls.CONTROL_RULES)
    expect(oldPatterns.matchCallRule).toBe(coreControlCalls.matchCallRule)
  })

  it('evidence-retention hands out the core tiers and cutoff', () => {
    expect(oldEvidenceRetention.SCAN_EVIDENCE_RETENTION_DAYS).toBe(
      coreScanEvidence.SCAN_EVIDENCE_RETENTION_DAYS
    )
    expect(oldEvidenceRetention.DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS).toBe(7)
    expect(oldEvidenceRetention.SCAN_EVIDENCE_HARD_CAP_DAYS).toBe(30)
    expect(oldEvidenceRetention.isScanEvidenceRetentionDays).toBe(
      coreScanEvidence.isScanEvidenceRetentionDays
    )
    expect(oldEvidenceRetention.retentionCutoffs).toBe(
      coreScanEvidence.retentionCutoffs
    )
  })

  it('addedControlCallIds still finds added control calls', () => {
    const files = coreDiffLines.addedLinesWithNumbers(
      [
        'diff --git a/app/api/x/route.ts b/app/api/x/route.ts',
        '--- a/app/api/x/route.ts',
        '+++ b/app/api/x/route.ts',
        '@@ -1,0 +1,2 @@',
        '+const user = await requireAuth(req)',
        '+const body = schema.parse(json)',
      ].join('\n')
    )
    expect(coreControlCalls.addedControlCallIds(files).sort()).toEqual([
      'auth',
      'zod-parse',
    ])
  })
})

describe('LUM-1060 core files skip the security-scan barrel', () => {
  // The files RFC LUM-1058 §3.5 lists under "pure functions / types /
  // constants move to the core".
  const CORE_FILES = [
    'lib/services/boundary-detector.service.ts',
    'lib/security-scan/scan-secrets.ts',
    'lib/security-scan/secret-patterns.ts',
    'lib/repositories/project.repository.ts',
    'lib/claim-faithfulness/prefilter.ts',
    'lib/legal/retention-figures.ts',
    'lib/services/workspace.service.ts',
    'lib/services/retention-stock.service.ts',
    'lib/boundary-crossing/rejudge.ts',
  ]
  const MOVED_FROM = [
    /['"]@\/lib\/security-scan(\/index)?['"]/,
    /['"]@\/lib\/security-scan\/types['"]/,
    /security-scan\/diff-lines['"]/,
    /security-scan\/hunt\/trigger['"]/,
    /security-scan\/evidence-retention['"]/,
    /services\/policy\/types['"]/,
  ]

  it.each(CORE_FILES)('%s imports the moved code from its core home', file => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    for (const re of MOVED_FROM) expect(source).not.toMatch(re)
    // Inside lib/security-scan, `./types` is the plugin-side types module.
    if (file.startsWith('lib/security-scan/')) {
      expect(source).not.toMatch(/['"]\.\/types['"]/)
    }
  })
})
