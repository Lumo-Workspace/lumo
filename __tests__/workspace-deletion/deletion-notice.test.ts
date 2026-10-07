/**
 * @jest-environment node
 *
 * LUM-918 — the owner email for a scheduled / cancelled workspace deletion.
 */
jest.mock('@/lib/integrations/email/client', () => ({
  sendEmail: jest.fn(),
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  lookupClerkProfiles: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { buildWorkspaceDeletionEmail } from '@/lib/integrations/email'
import { sendEmail } from '@/lib/integrations/email/client'
import { lookupClerkProfiles } from '@/lib/utils/clerk-helpers'
import { sendDeletionNotice } from '@/lib/services/workspace-deletion-notice'

const executeAt = new Date('2026-10-03T12:00:00.000Z')

describe('buildWorkspaceDeletionEmail', () => {
  it('names the deadline and escapes the workspace name', () => {
    const { subject, html } = buildWorkspaceDeletionEmail({
      kind: 'scheduled',
      workspaceName: 'Acme <script>',
      actorName: 'Ada',
      executeAt,
      settingsUrl: 'https://app.test/workspace/acme/settings/workspace',
    })
    expect(subject).toContain('scheduled for deletion')
    expect(html).toContain('2026-10-03 12:00 UTC')
    expect(html).toContain('Acme &lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('cancel')
  })

  it('a cancelled notice says nothing was deleted', () => {
    const { subject, html } = buildWorkspaceDeletionEmail({
      kind: 'cancelled',
      workspaceName: 'Acme',
      actorName: 'Ada',
      executeAt,
      settingsUrl: 'https://app.test/x',
    })
    expect(subject).toContain('cancelled')
    expect(html).toContain('Nothing was deleted')
  })
})

describe('sendDeletionNotice', () => {
  it('emails every owner that has an address and counts the rest as failed', async () => {
    const send = sendEmail as jest.Mock
    send
      .mockResolvedValueOnce({ status: 'sent', id: 'm1' })
      .mockResolvedValueOnce({
        status: 'failed',
        error: { name: 'Error', message: 'bounced' },
      })
    ;(lookupClerkProfiles as jest.Mock).mockResolvedValue(
      new Map([
        ['o1', { name: 'Ada', email: 'ada@example.test' }],
        ['o2', { name: 'Bo', email: 'bo@example.test' }],
        ['o3', { name: 'Cy', email: null }],
      ])
    )

    const out = await sendDeletionNotice({
      kind: 'scheduled',
      workspaceId: 'ws1',
      workspaceName: 'Acme',
      workspaceSlug: 'acme',
      actorClerkId: 'o1',
      ownerClerkIds: ['o1', 'o2', 'o3'],
      requestedAt: new Date('2026-10-01T12:00:00.000Z'),
      executeAt,
    })

    expect(out).toEqual({ sent: 1, failed: 2 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls.map(c => c[0].to[0])).toEqual([
      'ada@example.test',
      'bo@example.test',
    ])
    expect(send.mock.calls[0][1].idempotencyKey).toContain('ws1/scheduled/')
  })
})
