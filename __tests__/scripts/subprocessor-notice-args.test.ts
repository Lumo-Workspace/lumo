/**
 * @jest-environment node
 *
 * LUM-919 — the send script's arguments (dry run by default, --confirm needs
 * the host) and its report lines.
 */
import {
  formatNoticePlan,
  formatSendResult,
  parseNoticeArgs,
} from '../../scripts/subprocessor-notice/args'
import type { NoticePlan } from '@/lib/services/subprocessor-notice.service'

describe('subprocessor notice script args (LUM-919)', () => {
  it('defaults to a dry run', () => {
    expect(parseNoticeArgs(['--change', '2026-11-01-x'])).toEqual({
      changeId: '2026-11-01-x',
      confirm: false,
      html: false,
    })
  })

  it('--confirm needs --confirm-host, and the host only goes with --confirm', () => {
    expect(
      parseNoticeArgs([
        '--change',
        '2026-11-01-x',
        '--confirm',
        '--confirm-host',
        'db.example',
      ])
    ).toEqual({
      changeId: '2026-11-01-x',
      confirm: true,
      confirmHost: 'db.example',
      html: false,
    })
    expect(() =>
      parseNoticeArgs(['--change', '2026-11-01-x', '--confirm'])
    ).toThrow('--confirm needs --confirm-host <db host>')
    expect(() =>
      parseNoticeArgs(['--change', 'x', '--confirm-host', 'db.example'])
    ).toThrow('--confirm-host only goes with --confirm')
  })

  it('rejects a missing change id and unknown flags', () => {
    expect(() => parseNoticeArgs([])).toThrow(
      '--change <change id> is required'
    )
    expect(() => parseNoticeArgs(['--change'])).toThrow(
      '--change needs a value'
    )
    expect(() => parseNoticeArgs(['--change', 'x', '--yes'])).toThrow(
      'Unknown argument: --yes'
    )
  })
})

describe('subprocessor notice script report (LUM-919)', () => {
  const plan: NoticePlan = {
    change: {
      id: '2026-11-01-x',
      kind: 'added',
      announcedAt: '2026-11-01',
      effectiveAt: '2026-11-20',
      summary: 'X joins.',
    },
    refusal: 'too soon',
    workspaces: [
      {
        workspaceId: 'ws_a',
        workspaceName: 'Acme',
        pendingDeletion: true,
        owners: 2,
        alreadyNotified: 1,
        toNotify: 1,
        missingEmail: 1,
      },
      {
        workspaceId: 'ws_b',
        workspaceName: 'Beta',
        pendingDeletion: false,
        owners: 0,
        alreadyNotified: 0,
        toNotify: 0,
        missingEmail: 0,
      },
    ],
    totals: {
      workspaces: 2,
      owners: 2,
      alreadyNotified: 1,
      toNotify: 1,
      missingEmail: 1,
    },
    preview: { subject: 'S', html: '<p>H</p>', text: 'T' },
  }

  it('the dry-run report shows the refusal, owners per workspace and the email', () => {
    const lines = formatNoticePlan(plan, { html: false })
    expect(lines).toContain('REFUSED — would not send: too soon')
    expect(lines).toContain(
      '  ws_a  "Acme"  owners=2 notified=1 toNotify=1  [deletion scheduled, 1 without email]'
    )
    expect(lines).toContain(
      '  ws_b  "Beta"  owners=0 notified=0 toNotify=0  [NO ACTIVE OWNER]'
    )
    expect(lines).toContain('Subject: S')
    expect(lines[lines.length - 1]).toBe('T')
    expect(formatNoticePlan(plan, { html: true }).slice(-1)[0]).toBe('<p>H</p>')
  })

  it('the send report lists failures and says a rerun retries them', () => {
    expect(
      formatSendResult({
        changeId: '2026-11-01-x',
        sent: 2,
        alreadyNotified: 3,
        failed: [{ workspaceId: 'ws_a', clerkId: 'c1', reason: 'no email' }],
        unrecorded: [{ workspaceId: 'ws_b', clerkId: 'c2', reason: 'reset' }],
        workspacesNotified: 1,
      })
    ).toEqual([
      'Change 2026-11-01-x: sent 2 · already notified 3 · failed 1 · workspaces notified 1',
      '  FAILED ws_a c1: no email',
      'Failures are not recorded: rerun to retry them.',
      '  SENT BUT NOT RECORDED ws_b c2: reset',
      'These owners got the email but have no delivery record: a rerun within 24 hours is deduplicated by Resend, a later one would email them again.',
    ])
  })
})
