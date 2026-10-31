/**
 * @jest-environment node
 *
 * LUM-1344 follow-up — waitlist dismiss / restore against a REAL Postgres
 * (every migration replayed into PGlite, including the DISMISSED enum value):
 * a batch dismiss changes only PENDING rows, a dismissed email that signs up
 * again or is blocked at onboarding stays DISMISSED, approve refuses it, and
 * restore brings it back to PENDING. Every change is audited.
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
jest.mock('@/lib/integrations/email/client', () => ({
  sendEmail: jest.fn(async () => ({ status: 'skipped' })),
}))

import { miscRepository } from '@/lib/repositories/misc.repository'
import { waitlistAdmin } from '@/lib/services/waitlist-admin.service'

jest.setTimeout(180_000)

const ADMIN = 'admin-lum1344'

function db() {
  return harness.prisma!
}

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

it('waitlist dismiss/restore: only PENDING rows move, dismissed emails stay dismissed', async () => {
  const pending = await miscRepository.createWaitlistEntry({
    email: 'bogus@invalid.test',
    name: null,
    company: null,
    teamSize: null,
  })
  const other = await miscRepository.createWaitlistEntry({
    email: 'asdf@asdf.test',
    name: null,
    company: null,
    teamSize: null,
  })
  const approved = await db().waitlistEntry.create({
    data: { email: 'real@company.test', status: 'APPROVED' },
  })

  const res = await waitlistAdmin.dismiss(
    [pending.id, other.id, approved.id, 'missing-id'],
    ADMIN
  )
  expect(res.dismissed.sort()).toEqual([pending.id, other.id].sort())
  const rows = await db().waitlistEntry.findMany({
    select: { email: true, status: true },
    orderBy: { email: 'asc' },
  })
  expect(rows).toEqual([
    { email: 'asdf@asdf.test', status: 'DISMISSED' },
    { email: 'bogus@invalid.test', status: 'DISMISSED' },
    { email: 'real@company.test', status: 'APPROVED' },
  ])

  // Signing up again (marketing form looks it up and stops) or being blocked
  // at onboarding (upsert with an empty update) leaves it DISMISSED.
  expect(
    (await miscRepository.findWaitlistEntryByEmail('bogus@invalid.test'))
      ?.status
  ).toBe('DISMISSED')
  const blocked = await miscRepository.upsertBlockedWaitlistEntry({
    email: 'bogus@invalid.test',
    name: 'Bogus',
  })
  expect(blocked.status).toBe('DISMISSED')
  expect(
    await miscRepository.findApprovedWaitlistEntryByEmails([
      'bogus@invalid.test',
    ])
  ).toBeNull()

  const dismissedList = await waitlistAdmin.list({
    status: 'DISMISSED',
    limit: 50,
  })
  expect(dismissedList.items.map(i => i.email).sort()).toEqual([
    'asdf@asdf.test',
    'bogus@invalid.test',
  ])

  await expect(waitlistAdmin.approve(pending.id, ADMIN)).rejects.toMatchObject(
    { status: 409, code: 'WAITLIST_DISMISSED' }
  )

  const restored = await waitlistAdmin.restore(pending.id, ADMIN)
  expect(restored.entry.status).toBe('PENDING')
  await expect(waitlistAdmin.restore(pending.id, ADMIN)).rejects.toMatchObject(
    { status: 409, code: 'WAITLIST_NOT_DISMISSED' }
  )

  const audit = await db().platformAdminAuditEvent.findMany({
    where: { adminUserId: ADMIN },
    select: { action: true, targetId: true },
  })
  expect(audit.filter(a => a.action === 'waitlist.dismiss')).toHaveLength(2)
  expect(audit).toContainEqual({
    action: 'waitlist.restore',
    targetId: pending.id,
  })
})
