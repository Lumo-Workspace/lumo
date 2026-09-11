/** @jest-environment node */
import {
  prefilterSecurityControlClaim,
  prefilterClaim,
} from '@/lib/claim-faithfulness/prefilter'

const diffWith = (path: string, added: string[]) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,1 +1,${added.length + 1} @@`,
    ' const keep = true',
    ...added.map(l => `+${l}`),
  ].join('\n')

const RENDER_ONLY = diffWith('components/Row.tsx', [
  "  return <div className='row'>{title}</div>",
])
const ADDS_AUTH = diffWith('app/api/tasks/route.ts', [
  '  const member = await requireWorkspaceMember(workspaceId, userId)',
  '  if (member instanceof NextResponse) return member',
])
const ADDS_ZOD = diffWith('app/api/tasks/route.ts', [
  '  const parsed = createTaskSchema.safeParse(body)',
])
const ADDS_RATE_LIMIT = diffWith('lib/services/x.ts', [
  '  await enforceRateLimit(key)',
])

describe('LUM-740 security-control-claim prefilter', () => {
  it('flags a claim of an added auth check when the diff adds no control call', () => {
    expect(
      prefilterSecurityControlClaim(
        'added a workspace authorization check to the tasks route',
        RENDER_ONLY
      )
    ).toBe('SECURITY_CONTROL_CLAIM')
  })

  it('flags validation and rate-limit claims the same way, in English or Chinese', () => {
    expect(
      prefilterSecurityControlClaim(
        'now validates the request body',
        RENDER_ONLY
      )
    ).toBe('SECURITY_CONTROL_CLAIM')
    expect(
      prefilterSecurityControlClaim('接口增加了鉴权与限流', RENDER_ONLY)
    ).toBe('SECURITY_CONTROL_CLAIM')
    expect(prefilterSecurityControlClaim('对入参做了校验', RENDER_ONLY)).toBe(
      'SECURITY_CONTROL_CLAIM'
    )
  })

  it('does not flag when the diff adds a control call of any kind', () => {
    expect(
      prefilterSecurityControlClaim(
        'added a workspace authorization check to the tasks route',
        ADDS_AUTH
      )
    ).toBeNull()
    expect(
      prefilterSecurityControlClaim('validates the body with zod', ADDS_ZOD)
    ).toBeNull()
    expect(
      prefilterSecurityControlClaim('added rate limiting', ADDS_RATE_LIMIT)
    ).toBeNull()
  })

  it('does not flag a claim that asserts no control', () => {
    expect(
      prefilterSecurityControlClaim(
        'refactored the row renderer and added tests',
        RENDER_ONLY
      )
    ).toBeNull()
    expect(prefilterSecurityControlClaim(null, RENDER_ONLY)).toBeNull()
  })

  it('does not flag a claim that merely mentions the word in passing (negation or unrelated noun)', () => {
    expect(
      prefilterSecurityControlClaim(
        'no auth changes in this PR — pure rendering',
        RENDER_ONLY
      )
    ).toBeNull()
  })

  describe('prefilterClaim (one signal per verdict)', () => {
    const delivery = (diff: string, churn = 40) => ({
      additions: churn,
      deletions: 2,
      changedFiles: ['components/Row.tsx'],
      diff,
    })
    it('underreport wins when both apply', () => {
      expect(
        prefilterClaim(
          'no code change — only added auth validation notes',
          delivery(RENDER_ONLY)
        )
      ).toBe('UNDERREPORT_CANDIDATE')
    })
    it('falls back to the security-control signal', () => {
      expect(
        prefilterClaim('added an authentication check', delivery(RENDER_ONLY))
      ).toBe('SECURITY_CONTROL_CLAIM')
    })
    it('null when neither applies', () => {
      expect(
        prefilterClaim('tidied the row renderer', delivery(RENDER_ONLY))
      ).toBeNull()
    })
  })
})
