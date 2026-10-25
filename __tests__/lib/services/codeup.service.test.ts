/**
 * @jest-environment node
 *
 * LUM-1315 — Codeup connection service, with a mocked Codeup client.
 */
jest.mock('@/lib/repositories/codeup.repository', () => ({
  codeupRepository: {
    findConnectionByWorkspace: jest.fn(),
    upsertConnection: jest.fn(),
    deleteConnection: jest.fn(),
    deleteRepositoriesOfConnection: jest.fn(),
    upsertRepository: jest.fn(),
    markUnconfirmed: jest.fn(),
  },
}))
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue(true),
}))
jest.mock('@/lib/crypto', () => ({
  encrypt: jest.fn((s: string) => `enc(${s})`),
  decrypt: jest.fn((s: string) => s.replace(/^enc\((.*)\)$/, '$1')),
}))
jest.mock('@/lib/integrations/codeup/client', () => {
  const actual = jest.requireActual('@/lib/integrations/codeup/client')
  return { ...actual, createCodeupClient: jest.fn() }
})

import {
  CodeupApiError,
  createCodeupClient,
} from '@/lib/integrations/codeup/client'
import { hashWebhookToken } from '@/lib/integrations/codeup/webhook'
import { codeupRepository } from '@/lib/repositories/codeup.repository'
import { recordAuditEvent } from '@/lib/services/audit.service'
import {
  codeupService,
  codeupWebhookUrl,
  newWebhookToken,
} from '@/lib/services/codeup.service'

const repo = codeupRepository as jest.Mocked<typeof codeupRepository>
const mockCreateClient = createCodeupClient as jest.Mock

const WS = 'ws-dog'
const ORG = '60de7a6852743a5162b5f957'
const REPOS = [
  { id: 14, name: 'demo', pathWithNamespace: `${ORG}/demo`, webUrl: 'w14' },
  { id: 15, name: 'app', pathWithNamespace: `${ORG}/g/app`, webUrl: 'w15' },
]

function fakeClient(overrides: Record<string, jest.Mock> = {}) {
  const client = {
    listRepositories: jest.fn().mockResolvedValue(REPOS),
    createWebhook: jest.fn().mockResolvedValue({ id: 501 }),
    deleteWebhook: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  mockCreateClient.mockReturnValue(client)
  return client
}

function connection(repositories: unknown[] = []) {
  return {
    id: 'conn-1',
    organizationId: ORG,
    accessToken: 'enc(pt-old)',
    repositories,
  }
}

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...OLD_ENV,
    LUMO_DOGFOOD_WORKSPACE_IDS: WS,
    NEXT_PUBLIC_APP_URL: 'https://lumo.example',
  }
})
beforeEach(() => {
  repo.upsertConnection.mockResolvedValue({ id: 'conn-1' })
})
afterAll(() => {
  process.env = OLD_ENV
})

describe('codeupService.connect', () => {
  it('lists repositories with the token and stores it encrypted', async () => {
    fakeClient()
    repo.findConnectionByWorkspace.mockResolvedValue(null)

    const options = await codeupService.connect(WS, 'mem-1', 'OWNER', {
      organizationId: ORG,
      accessToken: 'pt-new',
    })

    expect(mockCreateClient).toHaveBeenCalledWith(ORG, 'pt-new')
    expect(repo.upsertConnection).toHaveBeenCalledWith({
      workspaceId: WS,
      organizationId: ORG,
      accessToken: 'enc(pt-new)',
      connectedBy: 'mem-1',
    })
    expect(options.map(o => o.pathWithNamespace)).toEqual([
      `${ORG}/demo`,
      `${ORG}/g/app`,
    ])
    expect(options.every(o => o.confirmed === false)).toBe(true)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'codeup.connected' })
    )
    // The token never reaches the audit log.
    expect(
      JSON.stringify((recordAuditEvent as jest.Mock).mock.calls)
    ).not.toContain('pt-new')
  })

  it('rejects an invalid token with 400 and stores nothing', async () => {
    fakeClient({
      listRepositories: jest
        .fn()
        .mockRejectedValue(new CodeupApiError(401, 'refused')),
    })
    await expect(
      codeupService.connect(WS, 'mem-1', 'OWNER', {
        organizationId: ORG,
        accessToken: 'pt-bad',
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.upsertConnection).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('answers 502 when Codeup fails for another reason', async () => {
    fakeClient({
      listRepositories: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    })
    await expect(
      codeupService.connect(WS, 'mem-1', 'OWNER', {
        organizationId: ORG,
        accessToken: 'pt',
      })
    ).rejects.toMatchObject({ status: 502 })
    expect(repo.upsertConnection).not.toHaveBeenCalled()
  })

  it('is owner-only', async () => {
    await expect(
      codeupService.connect(WS, 'mem-1', 'MEMBER', {
        organizationId: ORG,
        accessToken: 'pt',
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('404s outside the rollout', async () => {
    await expect(
      codeupService.connect('ws-other', 'mem-1', 'OWNER', {
        organizationId: ORG,
        accessToken: 'pt',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('stores the new connection before dropping the old organization confirmations', async () => {
    const client = fakeClient()
    repo.findConnectionByWorkspace.mockResolvedValue({
      ...connection([
        {
          id: 'r1',
          repositoryId: 9,
          pathWithNamespace: 'old/r',
          webUrl: 'w',
          webhookId: 33,
          confirmedAt: new Date(),
        },
      ]),
      organizationId: 'old-org',
    } as never)

    await codeupService.connect(WS, 'mem-1', 'OWNER', {
      organizationId: ORG,
      accessToken: 'pt-new',
    })
    expect(client.deleteWebhook).toHaveBeenCalledWith(9, 33)
    expect(repo.deleteRepositoriesOfConnection).toHaveBeenCalledWith('conn-1')
    expect(repo.deleteConnection).not.toHaveBeenCalled()
    // The old hooks are removed with the OLD token, after the new one is stored.
    expect(mockCreateClient).toHaveBeenCalledWith('old-org', 'pt-old')
    expect(repo.upsertConnection.mock.invocationCallOrder[0]).toBeLessThan(
      repo.deleteRepositoriesOfConnection.mock.invocationCallOrder[0]!
    )
  })

  it('keeps the connection when the old cleanup fails', async () => {
    fakeClient()
    repo.findConnectionByWorkspace.mockResolvedValue({
      ...connection(),
      organizationId: 'old-org',
    } as never)
    repo.deleteRepositoriesOfConnection.mockRejectedValue(new Error('db'))
    await expect(
      codeupService.connect(WS, 'mem-1', 'OWNER', {
        organizationId: ORG,
        accessToken: 'pt-new',
      })
    ).rejects.toThrow('db')
    expect(repo.upsertConnection).toHaveBeenCalled()
    expect(repo.deleteConnection).not.toHaveBeenCalled()
  })
})

describe('codeupService.getStatus', () => {
  it('reports not connected', async () => {
    repo.findConnectionByWorkspace.mockResolvedValue(null)
    await expect(codeupService.getStatus(WS)).resolves.toEqual({
      connected: false,
    })
  })

  it('lists only confirmed repositories and never the token', async () => {
    repo.findConnectionByWorkspace.mockResolvedValue(
      connection([
        {
          id: 'r1',
          repositoryId: 14,
          pathWithNamespace: `${ORG}/demo`,
          webUrl: 'w14',
          webhookId: 1,
          confirmedAt: new Date(),
        },
        {
          id: 'r2',
          repositoryId: 15,
          pathWithNamespace: `${ORG}/g/app`,
          webUrl: 'w15',
          webhookId: null,
          confirmedAt: null,
        },
      ]) as never
    )
    const status = await codeupService.getStatus(WS)
    expect(status).toEqual({
      connected: true,
      organizationId: ORG,
      repositories: [
        { repositoryId: 14, pathWithNamespace: `${ORG}/demo`, webUrl: 'w14' },
      ],
    })
    expect(JSON.stringify(status)).not.toContain('pt-old')
  })

  it('404s outside the rollout', async () => {
    await expect(codeupService.getStatus('ws-other')).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('codeupService.listRepositories', () => {
  it('marks confirmed repositories', async () => {
    fakeClient()
    repo.findConnectionByWorkspace.mockResolvedValue(
      connection([
        {
          id: 'r1',
          repositoryId: 15,
          pathWithNamespace: `${ORG}/g/app`,
          webUrl: 'w15',
          webhookId: 1,
          confirmedAt: new Date(),
        },
      ]) as never
    )
    const options = await codeupService.listRepositories(WS, 'OWNER')
    expect(mockCreateClient).toHaveBeenCalledWith(ORG, 'pt-old')
    expect(options.map(o => [o.repositoryId, o.confirmed])).toEqual([
      [14, false],
      [15, true],
    ])
  })

  it('404s when not connected', async () => {
    repo.findConnectionByWorkspace.mockResolvedValue(null)
    await expect(
      codeupService.listRepositories(WS, 'OWNER')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('is owner-only: the list is read with the owner token', async () => {
    await expect(
      codeupService.listRepositories(WS, 'MEMBER')
    ).rejects.toMatchObject({ status: 403 })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })
})

describe('codeupService.updateRepositories', () => {
  it('creates a webhook with a fresh token per new repository and stores only its hash', async () => {
    const client = fakeClient()
    repo.findConnectionByWorkspace.mockResolvedValue(connection() as never)

    await codeupService.updateRepositories(WS, 'OWNER', [14])

    expect(client.createWebhook).toHaveBeenCalledTimes(1)
    const [repoId, input] = client.createWebhook.mock.calls[0]!
    expect(repoId).toBe(14)
    expect(input.url).toBe('https://lumo.example/api/webhooks/codeup')
    expect(input.token).toMatch(/^[0-9a-f]{64}$/)
    expect(repo.upsertRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        repositoryId: 14,
        pathWithNamespace: `${ORG}/demo`,
        webhookId: 501,
        webhookTokenHash: hashWebhookToken(input.token),
      })
    )
    const stored = repo.upsertRepository.mock.calls[0]![0]
    expect(JSON.stringify(stored)).not.toContain(input.token)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'codeup.repositories_updated',
        metadata: { added: 1, removed: 0 },
      })
    )
  })

  it('removes the hook of a repository no longer selected and unconfirms it', async () => {
    const client = fakeClient()
    repo.findConnectionByWorkspace.mockResolvedValue(
      connection([
        {
          id: 'r1',
          repositoryId: 14,
          pathWithNamespace: `${ORG}/demo`,
          webUrl: 'w14',
          webhookId: 501,
          confirmedAt: new Date(),
        },
      ]) as never
    )
    await codeupService.updateRepositories(WS, 'OWNER', [])
    expect(client.deleteWebhook).toHaveBeenCalledWith(14, 501)
    expect(repo.markUnconfirmed).toHaveBeenCalledWith('r1')
    expect(client.createWebhook).not.toHaveBeenCalled()
  })

  it('still unconfirms when Codeup refuses the hook deletion', async () => {
    fakeClient({
      deleteWebhook: jest.fn().mockRejectedValue(new Error('gone')),
    })
    repo.findConnectionByWorkspace.mockResolvedValue(
      connection([
        {
          id: 'r1',
          repositoryId: 14,
          pathWithNamespace: `${ORG}/demo`,
          webUrl: 'w14',
          webhookId: 501,
          confirmedAt: new Date(),
        },
      ]) as never
    )
    await codeupService.updateRepositories(WS, 'OWNER', [])
    expect(repo.markUnconfirmed).toHaveBeenCalledWith('r1')
  })

  it('rejects a repository id the organization does not list', async () => {
    fakeClient()
    repo.findConnectionByWorkspace.mockResolvedValue(connection() as never)
    await expect(
      codeupService.updateRepositories(WS, 'OWNER', [999])
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.upsertRepository).not.toHaveBeenCalled()
  })

  it('is owner-only', async () => {
    await expect(
      codeupService.updateRepositories(WS, 'MEMBER', [14])
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('codeupService.disconnect', () => {
  it('removes every hook and the connection', async () => {
    const client = fakeClient()
    repo.findConnectionByWorkspace.mockResolvedValue(
      connection([
        {
          id: 'r1',
          repositoryId: 14,
          pathWithNamespace: `${ORG}/demo`,
          webUrl: 'w14',
          webhookId: 501,
          confirmedAt: new Date(),
        },
      ]) as never
    )
    await codeupService.disconnect(WS, 'OWNER')
    expect(client.deleteWebhook).toHaveBeenCalledWith(14, 501)
    expect(repo.deleteConnection).toHaveBeenCalledWith('conn-1')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'codeup.disconnected' })
    )
  })

  it('is owner-only', async () => {
    await expect(codeupService.disconnect(WS, 'MEMBER')).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('helpers', () => {
  it('codeupWebhookUrl builds the delivery URL from the app URL', () => {
    expect(codeupWebhookUrl('https://lumo.example/')).toBe(
      'https://lumo.example/api/webhooks/codeup'
    )
  })

  it('codeupWebhookUrl refuses to fall back to localhost when no app URL is set', () => {
    expect(() => codeupWebhookUrl('')).toThrow(/NEXT_PUBLIC_APP_URL/)
    expect(() => codeupWebhookUrl('   ')).toThrow(/NEXT_PUBLIC_APP_URL/)
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(() => codeupWebhookUrl()).toThrow(/NEXT_PUBLIC_APP_URL/)
  })

  it('newWebhookToken is a fresh 256-bit hex token', () => {
    const a = newWebhookToken()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(newWebhookToken()).not.toBe(a)
  })
})
