/** @jest-environment node */
import { inheritDispositions } from '@/lib/security-scan/inherit-dispositions'
import type {
  NewFindingInput,
  DispositionedFingerprint,
} from '@/lib/repositories/pr-security-scan.repository'

const fresh = (fingerprint: string): NewFindingInput => ({
  scanId: 's2',
  kind: 'VULNERABILITY',
  ruleId: 'ext:semgrep:x',
  severity: 'MEDIUM',
  provenance: 'EXTERNAL_TOOL',
  filePath: 'lib/a.ts',
  line: 3,
  title: 't',
  detail: 'd',
  evidence: '',
  fingerprint,
  externalRef: null,
  disposition: null,
})

const prior = (
  over: Partial<DispositionedFingerprint>
): DispositionedFingerprint => ({
  id: 'old',
  fingerprint: 'fp',
  disposition: null,
  dispositionNote: null,
  dispositionedById: null,
  dispositionedAt: null,
  suggestedDisposition: null,
  suggestedReason: null,
  suggestionOutcome: null,
  ...over,
})

describe('LUM-740 inherit suggestions', () => {
  it('an open suggestion on an earlier scan of the PR carries over, without inventing a disposition', () => {
    const [row] = inheritDispositions(
      [fresh('fp')],
      [
        prior({
          suggestedDisposition: 'FALSE_POSITIVE',
          suggestedReason: 'fixture',
        }),
      ]
    )
    expect(row).toMatchObject({
      suggestedDisposition: 'FALSE_POSITIVE',
      suggestedReason: 'fixture',
      suggestionOutcome: null,
      disposition: null,
      inheritedFromFindingId: 'old',
    })
  })

  it('a confirmed suggestion carries its disposition AND its outcome', () => {
    const when = new Date(5)
    const [row] = inheritDispositions(
      [fresh('fp')],
      [
        prior({
          disposition: 'FALSE_POSITIVE',
          dispositionNote: 'Confirmed LLM suggestion (bulk)',
          dispositionedById: 'm1',
          dispositionedAt: when,
          suggestedDisposition: 'FALSE_POSITIVE',
          suggestedReason: 'fixture',
          suggestionOutcome: 'CONFIRMED',
        }),
      ]
    )
    expect(row).toMatchObject({
      disposition: 'FALSE_POSITIVE',
      dispositionedById: 'm1',
      dispositionedAt: when,
      suggestedDisposition: 'FALSE_POSITIVE',
      suggestionOutcome: 'CONFIRMED',
    })
  })

  it('a prior row with neither a disposition nor a suggestion changes nothing', () => {
    const [row] = inheritDispositions([fresh('fp')], [prior({})])
    expect(row).toEqual(fresh('fp'))
  })
})

describe('LUM-902 inherit from a scrubbed prior', () => {
  it('a scrubbed prior reason does not blank the new finding reason', () => {
    const [row] = inheritDispositions(
      [{ ...fresh('fp'), suggestedReason: 'fresh reason' }],
      [prior({ suggestedDisposition: 'FALSE_POSITIVE', suggestedReason: null })]
    )
    expect(row).toMatchObject({
      suggestedDisposition: 'FALSE_POSITIVE',
      suggestedReason: 'fresh reason',
    })
  })
})
