/**
 * @jest-environment node
 *
 * LUM-943 — the server side of the session record notice: the rendered line
 * per mode, the GET /api/workspaces/me/session-records route `lumo setup`
 * reads, and the `sessionRecordNotice` field on the session-start response.
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findTaskBinding: jest.fn(),
    findStewardBinding: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/workspace-deletion.repository', () => ({
  workspaceDeletionRepository: { findPending: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { findSessionRecordSetting: jest.fn() },
}))
jest.mock('@/lib/auth/identity', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {},
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { NextResponse } from 'next/server'
import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { workspaceDeletionRepository } from '@/lib/repositories/workspace-deletion.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { requireIdentity } from '@/lib/auth/identity'
import {
  renderSessionRecordNotice,
  sessionRecordNoticeService,
  sessionRecordSettingsUrl,
} from '@/lib/services/session-record-notice.service'
import { POST as sessionStart } from '@/app/api/hooks/session-start/route'
import { GET as getSessionRecords } from '@/app/api/workspaces/me/session-records/route'

const m = <T>(fn: T) => fn as unknown as jest.Mock

const URL_ =
  'https://www.uselumo.ai/workspace/acme/settings/workspace#data-retention'

function setting(mode: 'RETAIN' | 'USED_UP', days: number | null) {
  return {
    slug: 'acme',
    hookEventRetentionMode: mode,
    hookEventRetentionDays: days,
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  delete process.env.LUMO_PUBLIC_URL
  m(authService.verifyApiKey).mockResolvedValue({
    user: { id: 'clerk_1', email: 'a@b', name: 'A' },
    workspace: { id: 'ws_1', slug: 'acme', name: 'Acme' },
    apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
  })
  m(hookEventService.recordHookEvent).mockResolvedValue({
    id: 'he_1',
    sessionId: 's-1',
    taskId: null,
  })
  m(sessionRepository.findTaskBinding).mockResolvedValue({ bound: false })
  m(sessionRepository.findStewardBinding).mockResolvedValue(null)
  m(workspaceDeletionRepository.findPending).mockResolvedValue(null)
  m(requireIdentity).mockResolvedValue({
    clerkId: 'clerk_1',
    memberId: 'member_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    source: 'bearer',
  })
})

function postSessionStart() {
  return sessionStart(
    new Request('http://x/api/hooks/session-start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer lum_ok',
      },
      body: JSON.stringify({ sessionId: 's-1' }),
    })
  )
}

function getRoute() {
  return getSessionRecords(
    new Request('http://x/api/workspaces/me/session-records', {
      headers: { Authorization: 'Bearer lum_ok' },
    })
  )
}

describe('LUM-943 session record notice (server)', () => {
  it('LUM-943 notice text: states mode, retention, the OWNER and the settings link for every mode, with no encryption claim', () => {
    const forever = renderSessionRecordNotice({
      mode: 'RETAIN',
      days: null,
      settingsUrl: URL_,
    })
    const days = renderSessionRecordNotice({
      mode: 'RETAIN',
      days: 90,
      settingsUrl: URL_,
    })
    const usedUp = renderSessionRecordNotice({
      mode: 'USED_UP',
      days: null,
      settingsUrl: URL_,
    })
    expect(forever).toContain('kept forever, including code and command output')
    expect(days).toContain('kept for at least 90 days')
    expect(usedUp).toContain('code and command output are not stored')
    expect(usedUp).toContain('7 days after its work is used up')
    for (const line of [forever, days, usedUp]) {
      expect(line).not.toContain('\n')
      expect(line).toContain('credentials are always redacted')
      expect(line).toContain(
        'An OWNER can change this in Settings → Data retention'
      )
      expect(line).toContain(URL_)
      expect(line).not.toMatch(/encrypt|shred|key/i)
    }
  })

  it('LUM-943 settings link: points at the workspace settings data-retention section on the public origin', () => {
    expect(sessionRecordSettingsUrl('https://www.uselumo.ai', 'acme')).toBe(
      URL_
    )
    expect(sessionRecordSettingsUrl('https://x.test', 'a b')).toBe(
      'https://x.test/workspace/a%20b/settings/workspace#data-retention'
    )
  })

  it('LUM-943 service: reads the setting fresh on every call, so a mode change shows on the next lookup', async () => {
    m(workspaceRepository.findSessionRecordSetting)
      .mockResolvedValueOnce(setting('RETAIN', null))
      .mockResolvedValueOnce(setting('USED_UP', null))
    const first = await sessionRecordNoticeService.getForWorkspace('ws_1')
    const second = await sessionRecordNoticeService.getForWorkspace('ws_1')
    expect(first).toMatchObject({
      mode: 'RETAIN',
      days: null,
      settingsUrl: URL_,
    })
    expect(second).toMatchObject({ mode: 'USED_UP', days: null })
    expect(second!.notice).toContain('not stored')
    expect(workspaceRepository.findSessionRecordSetting).toHaveBeenCalledTimes(
      2
    )
    expect(workspaceRepository.findSessionRecordSetting).toHaveBeenCalledWith(
      'ws_1'
    )
  })

  it('LUM-943 service: a day tier is reported only in RETAIN mode', async () => {
    m(workspaceRepository.findSessionRecordSetting).mockResolvedValue(
      setting('RETAIN', 180)
    )
    const notice = await sessionRecordNoticeService.getForWorkspace('ws_1')
    expect(notice).toMatchObject({ mode: 'RETAIN', days: 180 })
    expect(notice!.notice).toContain('at least 180 days')
  })

  it('LUM-943 service: a missing workspace or failed lookup yields null instead of throwing', async () => {
    m(workspaceRepository.findSessionRecordSetting).mockResolvedValueOnce(null)
    await expect(
      sessionRecordNoticeService.getForWorkspace('ws_1')
    ).resolves.toBeNull()
    m(workspaceRepository.findSessionRecordSetting).mockRejectedValueOnce(
      new Error('db down')
    )
    await expect(
      sessionRecordNoticeService.getForWorkspace('ws_1')
    ).resolves.toBeNull()
  })

  it('LUM-943 route: GET session-records returns the current mode, retention, link and notice for the caller workspace', async () => {
    m(workspaceRepository.findSessionRecordSetting).mockResolvedValue(
      setting('RETAIN', 30)
    )
    const res = await getRoute()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const body = await res.json()
    expect(body.sessionRecords).toMatchObject({
      mode: 'RETAIN',
      days: 30,
      settingsUrl: URL_,
    })
    expect(body.sessionRecords.notice).toContain('at least 30 days')
    expect(workspaceRepository.findSessionRecordSetting).toHaveBeenCalledWith(
      'ws_1'
    )
  })

  it('LUM-943 route: an unauthenticated caller gets the auth response and no setting is read', async () => {
    m(requireIdentity).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await getRoute()
    expect(res.status).toBe(401)
    expect(workspaceRepository.findSessionRecordSetting).not.toHaveBeenCalled()
  })

  it('LUM-943 route: a failed lookup returns sessionRecords null', async () => {
    m(workspaceRepository.findSessionRecordSetting).mockRejectedValue(
      new Error('db down')
    )
    const res = await getRoute()
    expect(res.status).toBe(200)
    expect((await res.json()).sessionRecords).toBeNull()
  })

  it('LUM-943 session start: the response carries the notice for an unbound session and reflects a mode change on the next start', async () => {
    m(workspaceRepository.findSessionRecordSetting)
      .mockResolvedValueOnce(setting('RETAIN', null))
      .mockResolvedValueOnce(setting('USED_UP', null))

    const first = await (await postSessionStart()).json()
    const second = await (await postSessionStart()).json()

    expect(first.sessionRecordNotice).toContain('kept forever')
    expect(second.sessionRecordNotice).toContain('not stored')
    expect(workspaceRepository.findSessionRecordSetting).toHaveBeenCalledWith(
      'ws_1'
    )
  })

  it('LUM-943 session start: a failed lookup leaves the notice empty and session start still succeeds', async () => {
    m(workspaceRepository.findSessionRecordSetting).mockRejectedValue(
      new Error('db down')
    )
    const res = await postSessionStart()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessionId).toBe('s-1')
    expect(body.sessionRecordNotice).toBe('')
  })
})
