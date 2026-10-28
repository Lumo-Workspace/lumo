/**
 * @jest-environment node
 *
 * LUM-1329 — agent-review blocking against a REAL Postgres replayed from
 * every migration: the level is written as a compare-and-set on
 * `Workspace.securityPolicy` (null and a stored policy both match), other
 * entries are kept, a stale expected value writes nothing, a result equal to
 * the default clears the column, the write is audited under its own action,
 * and a MEMBER gets 403 with nothing written.
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

import { securityScanSettingsService } from '@/ee/security/services/security-scan-settings.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { memberAuditContext } from '@/lib/api/audit-context'

jest.setTimeout(180_000)

const WS = 'ws_arb'
const OWNER = 'm_arb_owner'
const MEMBER = 'm_arb_member'
const caller = (memberId: string) => ({
  workspaceId: WS,
  memberId,
  workspaceSlug: WS,
})
const ctx = (memberId: string) =>
  memberAuditContext(new Headers({}), { clerkId: 'c', memberId })

const storedPolicy = async () =>
  (
    await harness.prisma!.workspace.findUniqueOrThrow({
      where: { id: WS },
      select: { securityPolicy: true },
    })
  ).securityPolicy

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

it('an unset policy reads off; an OWNER turns it on over null, keeping the default entry, audited', async () => {
  expect(await storedPolicy()).toBeNull()
  expect(
    (await securityScanSettingsService.get(caller(OWNER))).agentReviewBlocking
  ).toBe('off')
  const next = await securityScanSettingsService.update(
    caller(OWNER),
    { agentReviewBlocking: 'medium' },
    ctx(OWNER)
  )
  expect(next.agentReviewBlocking).toBe('medium')
  expect(await storedPolicy()).toEqual({
    block: [
      { provenance: 'DETERMINISTIC', severity: 'HIGH' },
      { provenance: 'AGENT_REVIEW', severity: 'HIGH' },
      { provenance: 'AGENT_REVIEW', severity: 'MEDIUM' },
    ],
  })
  const events = await harness.prisma!.auditEvent.findMany({
    where: {
      workspaceId: WS,
      action: 'workspace.agent_review_blocking_updated',
    },
  })
  expect(events).toHaveLength(1)
  expect(events[0]!.metadata).toMatchObject({ from: 'off', to: 'medium' })
})

it('keeps an entry another writer added, and a stale expected value writes nothing', async () => {
  const edited = {
    block: [
      { provenance: 'DETERMINISTIC', severity: 'HIGH' },
      { provenance: 'EXTERNAL_TOOL', severity: 'LOW' },
      { provenance: 'AGENT_REVIEW', severity: 'HIGH' },
      { provenance: 'AGENT_REVIEW', severity: 'MEDIUM' },
    ],
  }
  await harness.prisma!.workspace.update({
    where: { id: WS },
    data: { securityPolicy: edited },
  })
  // A compare-and-set against what was there before the edit loses.
  expect(
    await securityColumnsRepository.replaceSecurityPolicyIf(
      WS,
      { block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }] },
      { block: [] }
    )
  ).toBe(false)
  expect(await storedPolicy()).toEqual(edited)

  await securityScanSettingsService.update(
    caller(OWNER),
    { agentReviewBlocking: 'high' },
    ctx(OWNER)
  )
  expect(await storedPolicy()).toEqual({
    block: [
      { provenance: 'DETERMINISTIC', severity: 'HIGH' },
      { provenance: 'EXTERNAL_TOOL', severity: 'LOW' },
      { provenance: 'AGENT_REVIEW', severity: 'HIGH' },
    ],
  })
})

it('a MEMBER gets 403 and the policy is unchanged', async () => {
  const before = await storedPolicy()
  await expect(
    securityScanSettingsService.update(
      caller(MEMBER),
      { agentReviewBlocking: 'off' },
      ctx(MEMBER)
    )
  ).rejects.toMatchObject({ status: 403 })
  expect(await storedPolicy()).toEqual(before)
})

it('turning it off where only the default is left clears the column to null', async () => {
  await harness.prisma!.workspace.update({
    where: { id: WS },
    data: {
      securityPolicy: {
        block: [
          { provenance: 'DETERMINISTIC', severity: 'HIGH' },
          { provenance: 'AGENT_REVIEW', severity: 'HIGH' },
        ],
      },
    },
  })
  await securityScanSettingsService.update(
    caller(OWNER),
    { agentReviewBlocking: 'off' },
    ctx(OWNER)
  )
  expect(await storedPolicy()).toBeNull()
  expect(
    (await securityScanSettingsService.get(caller(OWNER))).agentReviewBlocking
  ).toBe('off')
})
