/**
 * @jest-environment node
 *
 * LUM-907 / LUM-1065 — the security plugin's workspace settings through the
 * core settings write, against a REAL Postgres: the plugin columns are
 * written in the same update and audited under the pre-split actions, and a
 * cleared policy lands as SQL NULL (the `toColumnWrite` mapping that moved
 * out of the core workspace repository).
 */
import { createPgliteHarness } from '../../../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
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

import { workspaceService } from '@/lib/services/workspace.service'
import { memberAuditContext } from '@/lib/api/audit-context'

jest.setTimeout(180_000)

const WS = 'ws_audit_sec'
const OWNER = 'm_audit_sec_owner'

const ownerContext = () =>
  memberAuditContext(new Headers({}), {
    clerkId: 'clerk_owner',
    memberId: OWNER,
  })

async function events() {
  return harness.prisma!.auditEvent.findMany({
    where: { workspaceId: WS },
    orderBy: { createdAt: 'asc' },
  })
}

beforeAll(async () => {
  await harness.start()
  await harness.prisma!.workspace.create({
    data: { id: WS, name: `WS ${WS}`, slug: WS },
  })
  await harness.prisma!.workspaceMember.create({
    data: {
      id: OWNER,
      workspaceId: WS,
      clerkId: `clerk_${OWNER}`,
      role: 'OWNER',
    },
  })
})

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.prisma!.auditEvent.deleteMany({})
})

it('plugin columns are written and audited with the core settings, under the same actions', async () => {
  await workspaceService.updateWorkspace(
    WS,
    'OWNER',
    WS,
    {
      name: 'Renamed',
      securityHuntEnabled: false,
      scanEvidenceRetentionDays: 14,
    },
    ownerContext()
  )
  const ws = await harness.prisma!.workspace.findUniqueOrThrow({
    where: { id: WS },
  })
  expect(ws.securityHuntEnabled).toBe(false)
  expect(ws.scanEvidenceRetentionDays).toBe(14)
  const byAction = Object.fromEntries(
    (await events()).map(r => [r.action, r.metadata])
  )
  expect(byAction).toEqual({
    'workspace.settings_updated': {
      changes: { name: { from: `WS ${WS}`, to: 'Renamed' } },
    },
    'workspace.security_settings_updated': {
      changes: { securityHuntEnabled: { from: true, to: false } },
    },
    'workspace.retention_updated': {
      changes: { scanEvidenceRetentionDays: { from: 7, to: 14 } },
    },
  })
})

it('a cleared policy is stored as SQL NULL and audited as null', async () => {
  const policy = { block: [{ provenance: 'DETERMINISTIC', severity: 'HIGH' }] }
  await workspaceService.updateWorkspace(
    WS,
    'OWNER',
    WS,
    { securityPolicy: policy },
    ownerContext()
  )
  expect(
    (
      await harness.prisma!.workspace.findUniqueOrThrow({
        where: { id: WS },
        select: { securityPolicy: true },
      })
    ).securityPolicy
  ).toEqual(policy)

  await harness.prisma!.auditEvent.deleteMany({})
  await workspaceService.updateWorkspace(
    WS,
    'OWNER',
    WS,
    { securityPolicy: null },
    ownerContext()
  )
  const [row] = await harness.query<{ isNull: boolean }>(
    `select "securityPolicy" is null as "isNull" from workspaces where id = $1`,
    [WS]
  )
  expect(row).toEqual({ isNull: true })
  const [e] = await events()
  expect(e).toMatchObject({
    action: 'workspace.security_settings_updated',
    metadata: { changes: { securityPolicy: { from: policy, to: null } } },
  })
})
