/**
 * @jest-environment node
 *
 * LUM-1137 — review every push (incremental review +
 * `auto_pause_after_reviewed_commits`) against a REAL Postgres replayed from
 * every migration (the LUM-1137 migration included):
 *
 * - the setting: default 5; an OWNER changes it (audited), a MEMBER gets
 *   403, the route schema and the column accept only 0–100;
 * - admission: a task-less PR's pushes are admitted until the workspace's
 *   N reviewed commits, then paused; 0 never pauses; `--resume --limit`
 *   gives the PR its own limit over the workspace's.
 */
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrCommitCount: jest.fn(),
}))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn(),
}))

import { fetchPrCommitCount } from '@/lib/integrations/github/contents'
import { securityScanSettingsService } from '@/ee/security/services/security-scan-settings.service'
import { updateSecurityScanSettingsSchema } from '@/ee/security/validation/security-scan-settings'
import {
  __resetAutoReviewRateLimitForTests,
  autoReviewAdmissionService,
} from '@/ee/security/services/auto-review-admission.service'
import { prReviewControlService } from '@/ee/security/services/pr-review-control.service'
import { memberAuditContext } from '@/lib/api/audit-context'

jest.setTimeout(180_000)

const WS = 'ws_rep'
const OWNER = 'm_rep_owner'
const MEMBER = 'm_rep_member'
const commitCount = fetchPrCommitCount as jest.Mock

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: WS, name: WS, slug: WS })
  await harness.insert('workspace_members', {
    id: OWNER,
    workspaceId: WS,
    clerkId: 'c-owner',
    role: 'OWNER',
  })
  await harness.insert('workspace_members', {
    id: MEMBER,
    workspaceId: WS,
    clerkId: 'c-member',
    role: 'MEMBER',
  })
})
afterAll(async () => harness.stop())
beforeEach(() => {
  __resetAutoReviewRateLimitForTests()
  commitCount.mockReset()
})

let prSeq = 0
/** A task-less open PR. */
async function openPr(): Promise<{
  id: string
  workspaceId: string
  repo: string
  number: number
  authorLogin: string
}> {
  prSeq++
  const pr = {
    id: `pr-${prSeq}`,
    workspaceId: WS,
    repo: 'acme/app',
    number: prSeq,
    authorLogin: `dev${prSeq}`,
  }
  await harness.insert('pull_requests', { ...pr, state: 'open' })
  return pr
}

/** Single-commit pushes 1..n; which were admitted. */
async function pushes(
  pr: Awaited<ReturnType<typeof openPr>>,
  n: number
): Promise<boolean[]> {
  const out: boolean[] = []
  for (let i = 1; i <= n; i++) {
    commitCount.mockResolvedValueOnce(i)
    out.push((await autoReviewAdmissionService.admit(pr, `head${i}`)).allowed)
  }
  return out
}

const ctx = (memberId: string) =>
  memberAuditContext(new Headers({}), { clerkId: 'c', memberId })
const caller = { workspaceId: WS, memberId: OWNER, workspaceSlug: WS }

describe('the setting', () => {
  it('defaults to 5: pushes 1–5 are reviewed automatically and the 6th pauses', async () => {
    expect(
      (await securityScanSettingsService.get(caller)).switches
        .securityReviewAutoPauseAfter
    ).toBe(5)
    expect(await pushes(await openPr(), 6)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ])
  })

  it('an OWNER changes it (audited); 0 never pauses', async () => {
    const next = await securityScanSettingsService.update(
      caller,
      { securityReviewAutoPauseAfter: 0 },
      ctx(OWNER)
    )
    expect(next.switches.securityReviewAutoPauseAfter).toBe(0)
    const events = await harness.prisma!.auditEvent.findMany({
      where: { workspaceId: WS, action: 'workspace.security_settings_updated' },
    })
    expect(events.map(e => e.metadata)).toEqual([
      { changes: { securityReviewAutoPauseAfter: { from: 5, to: 0 } } },
    ])
    expect((await pushes(await openPr(), 12)).every(Boolean)).toBe(true)
  })

  it('a MEMBER gets 403 and nothing changes', async () => {
    await expect(
      securityScanSettingsService.update(
        { workspaceId: WS, memberId: MEMBER, workspaceSlug: WS },
        { securityReviewAutoPauseAfter: 2 },
        ctx(MEMBER)
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(
      (
        await harness.prisma!.workspace.findUniqueOrThrow({
          where: { id: WS },
          select: { securityReviewAutoPauseAfter: true },
        })
      ).securityReviewAutoPauseAfter
    ).toBe(0)
  })

  it('only whole numbers 0–100 are accepted — by the route schema and the column', async () => {
    for (const v of [0, 5, 100])
      expect(
        updateSecurityScanSettingsSchema.safeParse({
          securityReviewAutoPauseAfter: v,
        }).success
      ).toBe(true)
    for (const v of [-1, 101, 2.5, '5'])
      expect(
        updateSecurityScanSettingsSchema.safeParse({
          securityReviewAutoPauseAfter: v,
        }).success
      ).toBe(false)
    await expect(
      harness.query(
        `update workspaces set "securityReviewAutoPauseAfter" = -1 where id = $1`,
        [WS]
      )
    ).rejects.toThrow()
  })
})

describe('a PR limit from --resume --limit', () => {
  it('overrides the workspace setting until the next resume without a limit keeps it', async () => {
    await securityScanSettingsService.update(
      caller,
      { securityReviewAutoPauseAfter: 5 },
      ctx(OWNER)
    )
    const pr = await openPr()
    expect(
      await prReviewControlService.act(WS, pr.number, pr.repo, 'resume', 2)
    ).toEqual({ paused: false, rounds: 0, limit: 2, unit: 'commits' })
    expect(await pushes(pr, 3)).toEqual([true, true, false])
    // A plain resume resets the count and keeps the PR's own limit.
    expect(
      await prReviewControlService.act(WS, pr.number, pr.repo, 'resume')
    ).toEqual({ paused: false, rounds: 0, limit: 2, unit: 'commits' })
  })
})
