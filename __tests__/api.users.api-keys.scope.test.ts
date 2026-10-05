/**
 * @jest-environment node
 *
 * The /api/users/api-keys routes and, since LUM-907 PR3, the api-key service
 * they call (extracted from the routes) with its audit events.
 */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue({ userId: 'c1' }),
  getUserWorkspace: jest
    .fn()
    .mockResolvedValue({ workspaceId: 'w1', member: { id: 'm1' } }),
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    createApiKey: jest.fn(),
    findActiveApiKeys: jest.fn(),
    findApiKeyById: jest.fn(),
    revokeApiKey: jest.fn(),
  },
}))
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: jest.fn().mockResolvedValue(true),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}))
import { GET, POST } from '@/app/api/users/api-keys/route'
import { DELETE } from '@/app/api/users/api-keys/[id]/route'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { recordAuditEvent } from '@/lib/services/audit.service'
import { createHash } from 'crypto'
import {
  apiKeyService,
  generateApiKey,
  parseApiKeyScope,
} from '@/lib/services/api-key.service'

const create = miscRepository.createApiKey as jest.Mock
const findById = miscRepository.findApiKeyById as jest.Mock
const revoke = miscRepository.revokeApiKey as jest.Mock
const audit = recordAuditEvent as jest.Mock

const req = (body: unknown, method = 'POST') =>
  new Request('http://x/api/users/api-keys', {
    method,
    headers: {
      'content-type': 'application/json',
      'x-real-ip': '203.0.113.9',
      'user-agent': 'test-agent',
    },
    body: body === undefined ? null : JSON.stringify(body),
  })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  create.mockResolvedValue({
    id: 'k1',
    label: 'CI ingest',
    keyPrefix: 'lum_x',
    createdAt: new Date(),
    scope: 'security:ingest',
  })
})

test('creates a scoped key when scope=security:ingest', async () => {
  const res = await POST(req({ label: 'CI ingest', scope: 'security:ingest' }))
  expect(res.status).toBe(201)
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ label: 'CI ingest', scope: 'security:ingest' })
  )
  expect((await res.json()).key).toMatch(/^lum_[0-9a-f]{64}$/)
})

test('rejects an unknown scope with 400 and defaults to a full key when omitted', async () => {
  expect((await POST(req({ label: 'x', scope: 'admin' }))).status).toBe(400)
  await POST(req({ label: 'x' }))
  expect(create).toHaveBeenLastCalledWith(
    expect.objectContaining({ scope: null })
  )
})

test('api key routes: create passes the web audit context of the signed-in member', async () => {
  await POST(req({ label: 'laptop' }))
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: 'w1',
      action: 'api_key.created',
      context: expect.objectContaining({
        actor: { type: 'MEMBER', clerkId: 'c1', memberId: 'm1' },
        source: 'WEB',
        ip: '203.0.113.9',
        userAgent: 'test-agent',
      }),
    })
  )
})

test('api key routes: a missing label is 400 and writes nothing', async () => {
  expect((await POST(req({ label: '  ' }))).status).toBe(400)
  expect(create).not.toHaveBeenCalled()
  expect(audit).not.toHaveBeenCalled()
})

test('api key routes: revoke is 404 for another member key, 409 when revoked, 200 and audited otherwise', async () => {
  findById.mockResolvedValueOnce({ workspaceMemberId: 'other', revokedAt: null })
  expect((await DELETE(req(undefined, 'DELETE'), params('k9'))).status).toBe(404)
  findById.mockResolvedValueOnce({ workspaceMemberId: 'm1', revokedAt: new Date() })
  expect((await DELETE(req(undefined, 'DELETE'), params('k1'))).status).toBe(409)
  expect(revoke).not.toHaveBeenCalled()

  findById.mockResolvedValueOnce({ workspaceMemberId: 'm1', revokedAt: null })
  const res = await DELETE(req(undefined, 'DELETE'), params('k1'))
  expect(res.status).toBe(200)
  expect(audit).toHaveBeenCalledTimes(1)
  expect(audit).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'api_key.revoked',
      target: { type: 'api_key', id: 'k1' },
      context: expect.objectContaining({ source: 'WEB' }),
    })
  )
})

test('api key routes: list returns the member keys; a repository failure is a message-free 500', async () => {
  ;(miscRepository.findActiveApiKeys as jest.Mock).mockResolvedValueOnce([
    { id: 'k1' },
  ])
  const ok = await GET()
  expect(await ok.json()).toEqual({ keys: [{ id: 'k1' }] })
  expect(miscRepository.findActiveApiKeys).toHaveBeenCalledWith('m1')
  ;(miscRepository.findActiveApiKeys as jest.Mock).mockRejectedValueOnce(
    new Error('db down')
  )
  const bad = await GET()
  expect(bad.status).toBe(500)
  expect(await bad.json()).toEqual({ error: 'Internal Server Error' })
})

// ── apiKeyService (LUM-907 PR3) ─────────────────────────────────────────

const repo = miscRepository as jest.Mocked<typeof miscRepository>
const owner = { workspaceId: 'w1', memberId: 'm1' }
const ctx = { actor: { type: 'MEMBER' as const, clerkId: 'c1' }, source: 'CLI' as const }

describe('api key service', () => {
  it('api key service: generateApiKey returns a lum_ key, its sha256 and a 16-char prefix', () => {
    const { key, keyHash, keyPrefix } = generateApiKey()
    expect(key).toMatch(/^lum_[0-9a-f]{64}$/)
    expect(keyHash).toBe(createHash('sha256').update(key).digest('hex'))
    expect(keyPrefix).toBe(key.slice(0, 16))
  })

  it('api key service: parseApiKeyScope accepts known scopes and null, rejects others with 400', () => {
    expect(parseApiKeyScope(undefined)).toBeNull()
    expect(parseApiKeyScope(null)).toBeNull()
    expect(parseApiKeyScope('security:ingest')).toBe('security:ingest')
    expect(() => parseApiKeyScope('admin')).toThrow(
      expect.objectContaining({ status: 400 })
    )
  })

  it('api key service: create stores only the hash and audits id, label, prefix and scope', async () => {
    repo.createApiKey.mockResolvedValue({
      id: 'k1',
      label: 'ci',
      keyPrefix: 'lum_abc',
      createdAt: new Date(),
      scope: null,
    })
    const out = await apiKeyService.create(owner, { label: ' ci ', scope: undefined }, ctx)
    const stored = repo.createApiKey.mock.calls[0]![0]
    expect(stored).toMatchObject({ workspaceMemberId: 'm1', label: 'ci', scope: null })
    expect(stored).not.toHaveProperty('key')
    expect(out.key).toMatch(/^lum_/)
    expect(audit).toHaveBeenCalledWith({
      workspaceId: 'w1',
      action: 'api_key.created',
      target: { type: 'api_key', id: 'k1' },
      metadata: { label: 'ci', keyPrefix: stored.keyPrefix, scope: null },
      context: ctx,
    })
    // Never the key or its hash.
    expect(JSON.stringify(audit.mock.calls)).not.toContain(out.key)
    expect(JSON.stringify(audit.mock.calls)).not.toContain(stored.keyHash)
  })

  it('api key service: revoke refuses foreign and revoked keys without auditing, audits a real revoke', async () => {
    repo.findApiKeyById.mockResolvedValueOnce(null)
    await expect(apiKeyService.revoke(owner, 'k0', ctx)).rejects.toMatchObject({ status: 404 })
    repo.findApiKeyById.mockResolvedValueOnce({ workspaceMemberId: 'm2', revokedAt: null })
    await expect(apiKeyService.revoke(owner, 'k2', ctx)).rejects.toMatchObject({ status: 404 })
    repo.findApiKeyById.mockResolvedValueOnce({ workspaceMemberId: 'm1', revokedAt: new Date() })
    await expect(apiKeyService.revoke(owner, 'k1', ctx)).rejects.toMatchObject({ status: 409 })
    expect(audit).not.toHaveBeenCalled()

    repo.findApiKeyById.mockResolvedValueOnce({ workspaceMemberId: 'm1', revokedAt: null })
    repo.revokeApiKey.mockResolvedValueOnce({ id: 'k1' } as never)
    await apiKeyService.revoke(owner, 'k1', ctx)
    expect(audit).toHaveBeenCalledWith({
      workspaceId: 'w1',
      action: 'api_key.revoked',
      target: { type: 'api_key', id: 'k1' },
      context: ctx,
    })
  })

  it('api key service: list reads the member keys', async () => {
    repo.findActiveApiKeys.mockResolvedValue([])
    await apiKeyService.list(owner)
    expect(repo.findActiveApiKeys).toHaveBeenCalledWith('m1')
  })
})
