/**
 * @jest-environment node
 *
 * LUM-740 — the falsifier pass over EXTERNAL_TOOL findings. It may only
 * SUGGEST a false positive (a REJECT), never disposition; INCONCLUSIVE writes
 * nothing; a failure on one finding never reaches the workflow.
 */

// LUM-866: every workspace here has AI review and hunt on (off by default since LUM-1328).
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  // A plain function, not jest.fn: survives resetAllMocks.
  loadSecurityLayers: async () =>
    jest
      .requireActual('@/ee/security/security-scan/workspace-switches')
      .resolveSecurityLayers({
        securityAiReviewEnabled: true,
        securityHuntEnabled: true,
      }),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findScanForSuggestion: jest.fn(),
    setSuggestedDisposition: jest.fn(),
    addSuggestionTokens: jest.fn(),
    markSuggested: jest.fn(),
    updateDisposition: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/scan-code-retention.service', () => ({
  scrubScanIfRepositoryUnconfirmed: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDiff: jest.fn(),
}))
jest.mock('@/ee/security/llm/security-disposition-falsifier-client', () => ({
  falsifyExternalFinding: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  securitySuggestDispositionService,
  SUGGEST_MAX_PER_SCAN,
} from '@/ee/security/services/security-suggest-disposition.service'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { fetchPrDiff } from '@/lib/integrations/github/contents'
import { falsifyExternalFinding } from '@/ee/security/llm/security-disposition-falsifier-client'
import { scrubScanIfRepositoryUnconfirmed } from '@/ee/security/services/scan-code-retention.service'

const findScan = prSecurityScanRepository.findScanForSuggestion as jest.Mock
const suggest = prSecurityScanRepository.setSuggestedDisposition as jest.Mock
const addTokens = prSecurityScanRepository.addSuggestionTokens as jest.Mock
const markSuggested = prSecurityScanRepository.markSuggested as jest.Mock
const disposition = prSecurityScanRepository.updateDisposition as jest.Mock
const diff = fetchPrDiff as jest.Mock
const falsify = falsifyExternalFinding as jest.Mock

const PLAINTEXT = 'AKIA' + 'IOSFODNN7EXAMPLE'

const DIFF = [
  '+++ b/lib/a.ts',
  '@@ -1,2 +1,3 @@',
  ' const a = 1',
  '+const b = exec(cmd)',
  ' export {}',
].join('\n')

const candidate = (over: object) => ({
  id: 'f1',
  kind: 'VULNERABILITY',
  ruleId: 'ext:semgrep:cmd-injection',
  severity: 'HIGH',
  filePath: 'lib/a.ts',
  line: 2,
  title: 'Command injection',
  detail: 'user input reaches exec',
  externalRef: 'https://semgrep.dev/r/x',
  // The row the repository returns must not even carry `evidence` (P8).
  ...over,
})

const scan = (findings: object[]) => ({
  id: 's1',
  pullRequest: { workspaceId: 'w1', repo: 'acme/app', number: 7 },
  findings,
})

describe('LUM-740 suggested disposition', () => {
  const env = process.env.LUMO_SECURITY_SUGGEST
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.LUMO_SECURITY_SUGGEST
    diff.mockResolvedValue(DIFF)
    suggest.mockResolvedValue(undefined)
    addTokens.mockResolvedValue(undefined)
    markSuggested.mockResolvedValue(undefined)
  })
  afterAll(() => {
    if (env === undefined) delete process.env.LUMO_SECURITY_SUGGEST
    else process.env.LUMO_SECURITY_SUGGEST = env
  })

  it('a REJECT writes the suggestion and its reason, never a disposition', async () => {
    findScan.mockResolvedValue(scan([candidate({})]))
    falsify.mockResolvedValue({
      verdict: 'REJECT',
      reason: 'cmd is a hard-coded literal on line 2',
      tokens: 321,
    })
    const out = await securitySuggestDispositionService.suggestForScan('s1')
    expect(out).toEqual({ judged: 1, suggested: 1, tokens: 321 })
    expect(suggest).toHaveBeenCalledWith(
      'f1',
      'FALSE_POSITIVE',
      'cmd is a hard-coded literal on line 2'
    )
    expect(disposition).not.toHaveBeenCalled()
    expect(addTokens).toHaveBeenCalledWith('s1', 321)
  })

  it('the stored reason is redacted (the model cites the flagged line) and capped at 500 chars', async () => {
    findScan.mockResolvedValue(scan([candidate({})]))
    falsify.mockResolvedValue({
      verdict: 'REJECT',
      reason:
        `the value ${PLAINTEXT} on line 2 is the documented example key ` +
        'x'.repeat(600),
      tokens: 1,
    })
    await securitySuggestDispositionService.suggestForScan('s1')
    const reason = suggest.mock.calls[0][2] as string
    expect(reason).not.toContain(PLAINTEXT)
    expect(reason.length).toBeLessThanOrEqual(500)
  })

  it('marks the scan judged when the pass ran — even with nothing to judge — so the PR sync may post external rows', async () => {
    findScan.mockResolvedValue(scan([candidate({})]))
    falsify.mockResolvedValue({
      verdict: 'INCONCLUSIVE',
      reason: 'r',
      tokens: 1,
    })
    await securitySuggestDispositionService.suggestForScan('s1')
    expect(markSuggested).toHaveBeenCalledWith('s1')

    jest.clearAllMocks()
    findScan.mockResolvedValue(scan([]))
    await securitySuggestDispositionService.suggestForScan('s1')
    expect(markSuggested).toHaveBeenCalledWith('s1')
  })

  it('does not mark the scan judged when the pass is off or the scan is missing', async () => {
    process.env.LUMO_SECURITY_SUGGEST = 'off'
    findScan.mockResolvedValue(scan([candidate({})]))
    await securitySuggestDispositionService.suggestForScan('s1')
    expect(markSuggested).not.toHaveBeenCalled()
    delete process.env.LUMO_SECURITY_SUGGEST
    findScan.mockResolvedValue(null)
    await securitySuggestDispositionService.suggestForScan('gone')
    expect(markSuggested).not.toHaveBeenCalled()
  })

  it('exposes the pass as three steps the workflow can run one finding at a time', async () => {
    findScan.mockResolvedValue(
      scan([candidate({ id: 'f1' }), candidate({ id: 'f2', line: 99 })])
    )
    const prepared = await securitySuggestDispositionService.prepare('s1')
    expect(prepared.enabled).toBe(true)
    // f2's line is not in the diff → not a candidate.
    expect(prepared.candidates.map(c => c.id)).toEqual(['f1'])
    expect(prepared.candidates[0]?.hunk).toContain('+const b = exec(cmd)')
    expect(JSON.stringify(prepared)).not.toContain('evidence')

    falsify.mockResolvedValue({
      verdict: 'REJECT',
      reason: 'literal',
      tokens: 7,
    })
    await expect(
      securitySuggestDispositionService.judge(prepared.candidates[0]!)
    ).resolves.toEqual({ suggested: true, tokens: 7 })
    expect(suggest).toHaveBeenCalledWith('f1', 'FALSE_POSITIVE', 'literal')

    await securitySuggestDispositionService.finish('s1', 7)
    expect(addTokens).toHaveBeenCalledWith('s1', 7)
    expect(markSuggested).toHaveBeenCalledWith('s1')
  })

  it('an INCONCLUSIVE verdict writes nothing', async () => {
    findScan.mockResolvedValue(scan([candidate({})]))
    falsify.mockResolvedValue({
      verdict: 'INCONCLUSIVE',
      reason: 'could not refute',
      tokens: 100,
    })
    const out = await securitySuggestDispositionService.suggestForScan('s1')
    expect(out).toEqual({ judged: 1, suggested: 0, tokens: 100 })
    expect(suggest).not.toHaveBeenCalled()
  })

  it('hands the client the finding fields plus the diff hunk — and nothing named evidence', async () => {
    findScan.mockResolvedValue(scan([candidate({ evidence: PLAINTEXT })]))
    falsify.mockResolvedValue({
      verdict: 'INCONCLUSIVE',
      reason: 'r',
      tokens: 1,
    })
    await securitySuggestDispositionService.suggestForScan('s1')
    expect(falsify).toHaveBeenCalledTimes(1)
    const arg = falsify.mock.calls[0][0]
    expect(arg.finding).toEqual({
      ruleId: 'ext:semgrep:cmd-injection',
      severity: 'HIGH',
      filePath: 'lib/a.ts',
      line: 2,
      title: 'Command injection',
      detail: 'user input reaches exec',
      externalRef: 'https://semgrep.dev/r/x',
    })
    expect(arg.hunk).toContain('+const b = exec(cmd)')
    expect(JSON.stringify(arg)).not.toContain(PLAINTEXT)
  })

  it('a finding whose line is not in the diff is skipped, not judged', async () => {
    findScan.mockResolvedValue(
      scan([candidate({ id: 'f1', line: 99 }), candidate({ id: 'f2' })])
    )
    falsify.mockResolvedValue({
      verdict: 'INCONCLUSIVE',
      reason: 'r',
      tokens: 1,
    })
    const out = await securitySuggestDispositionService.suggestForScan('s1')
    expect(falsify).toHaveBeenCalledTimes(1)
    expect(out.judged).toBe(1)
  })

  it('a client failure on one finding does not stop the others and never throws', async () => {
    findScan.mockResolvedValue(
      scan([candidate({ id: 'f1' }), candidate({ id: 'f2' })])
    )
    falsify
      .mockRejectedValueOnce(new Error('gateway 502'))
      .mockResolvedValueOnce({
        verdict: 'REJECT',
        reason: 'dead code',
        tokens: 5,
      })
    const out = await securitySuggestDispositionService.suggestForScan('s1')
    expect(out).toEqual({ judged: 1, suggested: 1, tokens: 5 })
    expect(suggest).toHaveBeenCalledWith('f2', 'FALSE_POSITIVE', 'dead code')
  })

  it('judges at most SUGGEST_MAX_PER_SCAN findings, worst severity first', async () => {
    const rows = Array.from({ length: SUGGEST_MAX_PER_SCAN + 5 }, (_, i) =>
      candidate({ id: `f${i}`, severity: i < 5 ? 'LOW' : 'HIGH' })
    )
    findScan.mockResolvedValue(scan(rows))
    falsify.mockResolvedValue({
      verdict: 'INCONCLUSIVE',
      reason: 'r',
      tokens: 0,
    })
    await securitySuggestDispositionService.suggestForScan('s1')
    expect(falsify).toHaveBeenCalledTimes(SUGGEST_MAX_PER_SCAN)
    for (const call of falsify.mock.calls) {
      expect(call[0].finding.severity).toBe('HIGH')
    }
    expect(addTokens).not.toHaveBeenCalled()
  })

  it('LUMO_SECURITY_SUGGEST=off does nothing — no diff fetch, no model call', async () => {
    process.env.LUMO_SECURITY_SUGGEST = 'off'
    findScan.mockResolvedValue(scan([candidate({})]))
    const out = await securitySuggestDispositionService.suggestForScan('s1')
    expect(out).toEqual({ judged: 0, suggested: 0, tokens: 0 })
    expect(diff).not.toHaveBeenCalled()
    expect(falsify).not.toHaveBeenCalled()
  })

  it('a missing scan or no candidates is a no-op without a diff fetch', async () => {
    findScan.mockResolvedValueOnce(null)
    await expect(
      securitySuggestDispositionService.suggestForScan('gone')
    ).resolves.toEqual({ judged: 0, suggested: 0, tokens: 0 })
    findScan.mockResolvedValueOnce(scan([]))
    await expect(
      securitySuggestDispositionService.suggestForScan('s1')
    ).resolves.toEqual({ judged: 0, suggested: 0, tokens: 0 })
    expect(diff).not.toHaveBeenCalled()
  })

  it('a diff fetch failure is swallowed as zero judged', async () => {
    findScan.mockResolvedValue(scan([candidate({})]))
    diff.mockRejectedValue(new Error('github 500'))
    await expect(
      securitySuggestDispositionService.suggestForScan('s1')
    ).resolves.toEqual({ judged: 0, suggested: 0, tokens: 0 })
    expect(falsify).not.toHaveBeenCalled()
  })
})

describe('LUM-896 suggested reasons', () => {
  it('LUM-896 write path rechecks the confirmed list once the suggestions are written', async () => {
    const recheck = scrubScanIfRepositoryUnconfirmed as jest.Mock
    recheck.mockClear()
    await securitySuggestDispositionService.finish('s1', 7)
    expect(recheck).toHaveBeenCalledWith('s1')
    expect(recheck.mock.invocationCallOrder[0]!).toBeGreaterThan(
      markSuggested.mock.invocationCallOrder[
        markSuggested.mock.invocationCallOrder.length - 1
      ]!
    )
  })
})
