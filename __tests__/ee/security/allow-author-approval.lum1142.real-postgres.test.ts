/**
 * @jest-environment node
 *
 * LUM-1142 — the workspace "allow PR authors to resolve/approve by command"
 * setting (author approval) against a REAL
 * Postgres replayed from every migration (the LUM-1142 migration included):
 *
 * - an existing workspace reads it ON (the migration's default);
 * - an OWNER turns it off (audited) and the command gate reads it off;
 * - a MEMBER gets 403 and nothing changes;
 * - `all` (enable / disable every layer) never touches it.
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

const WS = 'ws_aaa'
const OWNER = 'm_aaa_owner'
const MEMBER = 'm_aaa_member'
const caller = (memberId: string) => ({
  workspaceId: WS,
  memberId,
  workspaceSlug: WS,
})
const ctx = (memberId: string) =>
  memberAuditContext(new Headers({}), { clerkId: 'c', memberId })

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

it('an existing workspace reads author approval ON (the migration default)', async () => {
  expect(await securityColumnsRepository.findAllowAuthorApproval(WS)).toBe(true)
  expect(
    (await securityScanSettingsService.get(caller(OWNER))).switches
      .securityAllowAuthorApproval
  ).toBe(true)
})

it('an OWNER turns it off, audited, and the command gate reads it off', async () => {
  const next = await securityScanSettingsService.update(
    caller(OWNER),
    { securityAllowAuthorApproval: false },
    ctx(OWNER)
  )
  expect(next.switches.securityAllowAuthorApproval).toBe(false)
  expect(await securityColumnsRepository.findAllowAuthorApproval(WS)).toBe(
    false
  )
  const events = await harness.prisma!.auditEvent.findMany({
    where: { workspaceId: WS, action: 'workspace.security_settings_updated' },
  })
  expect(events.map(e => e.metadata)).toEqual([
    {
      changes: { securityAllowAuthorApproval: { from: true, to: false } },
    },
  ])
})

it('a MEMBER gets 403 and nothing changes', async () => {
  await expect(
    securityScanSettingsService.update(
      caller(MEMBER),
      { securityAllowAuthorApproval: true },
      ctx(MEMBER)
    )
  ).rejects.toMatchObject({ status: 403 })
  expect(await securityColumnsRepository.findAllowAuthorApproval(WS)).toBe(
    false
  )
})

it('`all` never touches it', async () => {
  await securityScanSettingsService.update(
    caller(OWNER),
    { all: true },
    ctx(OWNER)
  )
  expect(await securityColumnsRepository.findAllowAuthorApproval(WS)).toBe(
    false
  )
})

it('a missing workspace fails closed', async () => {
  expect(await securityColumnsRepository.findAllowAuthorApproval('nope')).toBe(
    false
  )
})
