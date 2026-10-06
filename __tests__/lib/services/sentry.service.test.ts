/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {},
}))
jest.mock('@/lib/repositories/sentry.repository', () => ({
  sentryRepository: {
    findIntegrationByWorkspace: jest.fn(),
    upsertIntegration: jest.fn(),
    deleteIntegration: jest.fn(),
    listMappings: jest.fn(),
    findProjectInWorkspace: jest.fn(),
    findMappingByProjectSlug: jest.fn(),
    createMapping: jest.fn(),
    findMappingWithIntegration: jest.fn(),
    deleteMapping: jest.fn(),
    findIntegrationByOrgSlug: jest.fn(),
    findLink: jest.fn(),
    createLink: jest.fn(),
    markWebhookReceived: jest.fn(),
  },
}))
jest.mock('@/lib/crypto', () => ({
  encrypt: jest.fn((s: string) => `enc(${s})`),
  decrypt: jest.fn((s: string) => s.replace(/^enc\(|\)$/g, '')),
}))
jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: { findByName: jest.fn(), create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorsByEmailInWorkspace: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    createFromAutomation: jest.fn(),
    reopen: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findById: jest.fn() },
}))

import { sentryService } from '@/lib/services/sentry.service'
import { sentryRepository } from '@/lib/repositories/sentry.repository'
import { encrypt } from '@/lib/crypto'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import alertFixture from '@/__tests__/fixtures/sentry-issue-alert.json'
import { createHmac } from 'crypto'

describe('sentryService status/connect/disconnect', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('getIntegrationStatus', () => {
    it('returns { connected: false } when no integration', async () => {
      ;(
        sentryRepository.findIntegrationByWorkspace as jest.Mock
      ).mockResolvedValue(null)
      const status = await sentryService.getIntegrationStatus('ws1')
      expect(status).toEqual({ connected: false })
    })

    it('returns orgSlug and lastWebhookAt when connected', async () => {
      ;(
        sentryRepository.findIntegrationByWorkspace as jest.Mock
      ).mockResolvedValue({
        id: 'int1',
        orgSlug: 'acme',
        lastWebhookAt: new Date('2026-04-16T10:00:00Z'),
        installedBy: 'mem1',
      })
      const status = await sentryService.getIntegrationStatus('ws1')
      expect(status).toMatchObject({ connected: true, orgSlug: 'acme' })
    })
  })

  describe('connectIntegration', () => {
    it('rejects non-OWNER with 403', async () => {
      await expect(
        sentryService.connectIntegration('ws1', 'mem1', 'MEMBER', {
          orgSlug: 'acme',
          clientSecret: 'plaintext',
        })
      ).rejects.toMatchObject({ status: 403 })
      expect(sentryRepository.upsertIntegration).not.toHaveBeenCalled()
    })

    it('encrypts clientSecret before upserting', async () => {
      ;(sentryRepository.upsertIntegration as jest.Mock).mockResolvedValue({
        id: 'int1',
      })
      await sentryService.connectIntegration('ws1', 'mem1', 'OWNER', {
        orgSlug: 'acme',
        clientSecret: 'plaintext',
      })
      expect(encrypt).toHaveBeenCalledWith('plaintext')
      expect(sentryRepository.upsertIntegration).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        installedBy: 'mem1',
        orgSlug: 'acme',
        clientSecret: 'enc(plaintext)',
      })
    })
  })

  describe('disconnectIntegration', () => {
    it('rejects non-OWNER with 403', async () => {
      await expect(
        sentryService.disconnectIntegration('ws1', 'MEMBER')
      ).rejects.toMatchObject({ status: 403 })
    })

    it('calls deleteIntegration for OWNER', async () => {
      await sentryService.disconnectIntegration('ws1', 'OWNER')
      expect(sentryRepository.deleteIntegration).toHaveBeenCalledWith('ws1')
    })
  })
})

describe('sentryService mappings CRUD', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(
      sentryRepository.findIntegrationByWorkspace as jest.Mock
    ).mockResolvedValue({ id: 'int1' })
    ;(sentryRepository.listMappings as jest.Mock).mockResolvedValue([])
    ;(sentryRepository.findProjectInWorkspace as jest.Mock).mockResolvedValue({
      id: 'p1',
    })
    ;(sentryRepository.findMappingByProjectSlug as jest.Mock).mockResolvedValue(
      null
    )
    ;(sentryRepository.createMapping as jest.Mock).mockResolvedValue({
      id: 'map1',
      sentryProjectSlug: 'frontend',
      projectId: 'p1',
    })
  })

  it('listMappings throws 404 when integration missing', async () => {
    ;(
      sentryRepository.findIntegrationByWorkspace as jest.Mock
    ).mockResolvedValue(null)
    await expect(sentryService.listMappings('ws1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('listMappings returns repository result', async () => {
    ;(sentryRepository.listMappings as jest.Mock).mockResolvedValue([
      { id: 'm1' },
    ])
    const result = await sentryService.listMappings('ws1')
    expect(result).toEqual([{ id: 'm1' }])
  })

  it('createMapping rejects non-OWNER with 403', async () => {
    await expect(
      sentryService.createMapping('ws1', 'MEMBER', {
        sentryProjectSlug: 'frontend',
        projectId: 'p1',
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('createMapping rejects when project not in workspace', async () => {
    ;(sentryRepository.findProjectInWorkspace as jest.Mock).mockResolvedValue(
      null
    )
    await expect(
      sentryService.createMapping('ws1', 'OWNER', {
        sentryProjectSlug: 'frontend',
        projectId: 'bad',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('createMapping rejects duplicates with 409', async () => {
    ;(sentryRepository.findMappingByProjectSlug as jest.Mock).mockResolvedValue(
      { id: 'existing' }
    )
    await expect(
      sentryService.createMapping('ws1', 'OWNER', {
        sentryProjectSlug: 'frontend',
        projectId: 'p1',
      })
    ).rejects.toMatchObject({ status: 409 })
  })

  it('createMapping happy path creates mapping', async () => {
    const r = await sentryService.createMapping('ws1', 'OWNER', {
      sentryProjectSlug: 'frontend',
      projectId: 'p1',
    })
    expect(r.id).toBe('map1')
  })

  it('deleteMapping validates ownership', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'other-ws' },
    })
    await expect(
      sentryService.deleteMapping('ws1', 'OWNER', 'map1')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deleteMapping rejects non-OWNER', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'ws1' },
    })
    await expect(
      sentryService.deleteMapping('ws1', 'MEMBER', 'map1')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('deleteMapping happy path deletes', async () => {
    ;(
      sentryRepository.findMappingWithIntegration as jest.Mock
    ).mockResolvedValue({
      id: 'map1',
      integration: { workspaceId: 'ws1' },
    })
    await sentryService.deleteMapping('ws1', 'OWNER', 'map1')
    expect(sentryRepository.deleteMapping).toHaveBeenCalledWith('map1')
  })
})

describe('sentryService._ensureBugTag', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns existing bug tag id', async () => {
    ;(tagRepository.findByName as jest.Mock).mockResolvedValue({ id: 'tag1' })
    const id = await sentryService._ensureBugTag('ws1')
    expect(id).toBe('tag1')
    expect(tagRepository.create).not.toHaveBeenCalled()
  })

  it('creates bug tag with red colour when missing', async () => {
    ;(tagRepository.findByName as jest.Mock).mockResolvedValue(null)
    ;(tagRepository.create as jest.Mock).mockResolvedValue({ id: 'tag2' })
    const id = await sentryService._ensureBugTag('ws1')
    expect(id).toBe('tag2')
    expect(tagRepository.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      name: 'bug',
      color: '#ef4444',
    })
  })

  it('recovers from race (P2002) by re-finding', async () => {
    ;(tagRepository.findByName as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tag3' })
    ;(tagRepository.create as jest.Mock).mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' })
    )
    const id = await sentryService._ensureBugTag('ws1')
    expect(id).toBe('tag3')
  })
})

describe('sentryService._resolveAssignee', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns first matched actor id', async () => {
    ;(
      memberRepository.findActorsByEmailInWorkspace as jest.Mock
    ).mockResolvedValue(['actor-ada', 'actor-bob'])
    const id = await sentryService._resolveAssignee('ws1', [
      'ada@example.com',
      'bob@example.com',
    ])
    expect(id).toBe('actor-ada')
  })

  it('returns null when no emails match', async () => {
    ;(
      memberRepository.findActorsByEmailInWorkspace as jest.Mock
    ).mockResolvedValue([])
    const id = await sentryService._resolveAssignee('ws1', ['x@example.com'])
    expect(id).toBeNull()
  })

  it('returns null when emails list is empty', async () => {
    const id = await sentryService._resolveAssignee('ws1', [])
    expect(id).toBeNull()
  })
})

function signed(body: string, secret: string) {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

const PLAIN_SECRET = 'test-secret'
const ENC_SECRET = `enc(${PLAIN_SECRET})`

describe('sentryService.handleWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(sentryRepository.findIntegrationByOrgSlug as jest.Mock).mockResolvedValue(
      {
        id: 'int1',
        workspaceId: 'ws1',
        clientSecret: ENC_SECRET,
      }
    )
    ;(sentryRepository.findMappingByProjectSlug as jest.Mock).mockResolvedValue(
      {
        id: 'map1',
        projectId: 'p1',
        integrationId: 'int1',
      }
    )
    ;(sentryRepository.findLink as jest.Mock).mockResolvedValue(null)
    ;(sentryRepository.createLink as jest.Mock).mockResolvedValue({
      id: 'link1',
      taskId: 't1',
    })
    ;(sentryRepository.markWebhookReceived as jest.Mock).mockResolvedValue(
      undefined
    )
    // ensureBugTag + resolveAssignee behaviour
    ;(tagRepository.findByName as jest.Mock).mockResolvedValue({
      id: 'tagBug',
    })
    ;(
      memberRepository.findActorsByEmailInWorkspace as jest.Mock
    ).mockResolvedValue([])
    ;(taskService.createFromAutomation as jest.Mock).mockResolvedValue({
      task: { id: 't1' },
    })
  })

  it('throws 401 when signature is missing', async () => {
    const body = JSON.stringify(alertFixture)
    await expect(
      sentryService.handleWebhook({ rawBody: body, signature: null })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('throws 404 when orgSlug unmatched', async () => {
    ;(sentryRepository.findIntegrationByOrgSlug as jest.Mock).mockResolvedValue(
      null
    )
    const body = JSON.stringify(alertFixture)
    await expect(
      sentryService.handleWebhook({ rawBody: body, signature: 'deadbeef' })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 401 when signature is wrong', async () => {
    const body = JSON.stringify(alertFixture)
    await expect(
      sentryService.handleWebhook({ rawBody: body, signature: 'deadbeef' })
    ).rejects.toMatchObject({ status: 401 })
  })

  it('skips silently when mapping is missing', async () => {
    ;(sentryRepository.findMappingByProjectSlug as jest.Mock).mockResolvedValue(
      null
    )
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    const result = await sentryService.handleWebhook({
      rawBody: body,
      signature: sig,
    })
    expect(result).toMatchObject({ skipped: 'no_mapping' })
    expect(taskService.createFromAutomation).not.toHaveBeenCalled()
  })

  it('creates task + link for first-time issue', async () => {
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    const result = await sentryService.handleWebhook({
      rawBody: body,
      signature: sig,
    })
    expect(taskService.createFromAutomation).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        priority: 'HIGH',
        tagIds: ['tagBug'],
      })
    )
    expect(sentryRepository.createLink).toHaveBeenCalledWith({
      integrationId: 'int1',
      sentryIssueId: '4555555555',
      taskId: 't1',
    })
    expect(sentryRepository.markWebhookReceived).toHaveBeenCalledWith('int1')
    expect(result).toMatchObject({ created: true, taskId: 't1' })
  })

  it('records activity and does NOT create task for repeated issue', async () => {
    ;(sentryRepository.findLink as jest.Mock).mockResolvedValue({
      id: 'link1',
      taskId: 't1',
    })
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'TODO',
    })
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    const result = await sentryService.handleWebhook({
      rawBody: body,
      signature: sig,
    })
    expect(taskService.createFromAutomation).not.toHaveBeenCalled()
    expect(activityRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', type: 'SENTRY_ALERT' })
    )
    expect(result).toMatchObject({ repeated: true, taskId: 't1' })
  })

  it('reopens DONE task on regression', async () => {
    ;(sentryRepository.findLink as jest.Mock).mockResolvedValue({
      id: 'link1',
      taskId: 't1',
    })
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'DONE',
    })
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    await sentryService.handleWebhook({ rawBody: body, signature: sig })
    expect(taskService.reopen).toHaveBeenCalledWith('t1', 'ws1', {
      reason: 'sentry_regression',
      actorId: null,
    })
  })

  it('falls back to repeated flow on link P2002 race', async () => {
    ;(sentryRepository.findLink as jest.Mock)
      .mockResolvedValueOnce(null) // first read: not yet present
      .mockResolvedValueOnce({ id: 'link1', taskId: 't1' }) // after race: present
    ;(sentryRepository.createLink as jest.Mock).mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: 'P2002' })
    )
    ;(taskRepository.findById as jest.Mock).mockResolvedValue({
      id: 't1',
      status: 'TODO',
    })
    const body = JSON.stringify(alertFixture)
    const sig = signed(body, PLAIN_SECRET)
    const result = await sentryService.handleWebhook({
      rawBody: body,
      signature: sig,
    })
    expect(activityRepository.create).toHaveBeenCalled()
    expect(result).toMatchObject({ repeated: true })
  })
})
