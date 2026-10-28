/**
 * @jest-environment node
 *
 * LUM-1321: POST /api/workspaces/me/security-scan/import — identity first,
 * a 1 MiB cap, Zod at the edge (agent tools only, full head SHA), then the
 * service with the caller's workspace and member.
 */
jest.mock('@/lib/auth/identity', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/ee/security/services/security-agent-import.service', () => ({
  securityAgentImportService: { import: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { securityAgentImportService } from '@/ee/security/services/security-agent-import.service'
import { POST } from '@/app/api/workspaces/me/security-scan/import/route'

const identity = requireIdentity as jest.Mock
const importMock = securityAgentImportService.import as jest.Mock
const URL_ = 'http://localhost/api/workspaces/me/security-scan/import'
const HEAD = 'c'.repeat(40)

const valid = {
  repository: 'acme/app',
  prNumber: 7,
  headSha: HEAD,
  tool: 'codex',
  sarif: { version: '2.1.0', runs: [] },
}

const post = (body: unknown) =>
  POST(
    new NextRequest(URL_, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

beforeEach(() => {
  jest.clearAllMocks()
  identity.mockResolvedValue({ workspaceId: 'ws1', memberId: 'm1' })
})

it('answers 202 with the service result for the caller', async () => {
  importMock.mockResolvedValue({ runId: 'run_1', results: 3 })
  const res = await post(valid)
  expect(res.status).toBe(202)
  await expect(res.json()).resolves.toEqual({ runId: 'run_1', results: 3 })
  expect(importMock).toHaveBeenCalledWith(
    { workspaceId: 'ws1', memberId: 'm1' },
    valid
  )
})

it('returns the identity refusal as is (not logged in / scoped key)', async () => {
  identity.mockResolvedValue(
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  )
  expect((await post(valid)).status).toBe(401)
  expect(importMock).not.toHaveBeenCalled()
})

it.each([
  ['a CI scanner tool name', { ...valid, tool: 'semgrep' }],
  ['a short head SHA', { ...valid, headSha: 'abc1234' }],
  ['a repository path with extra segments', { ...valid, repository: 'a/b/c' }],
  ['an unknown field', { ...valid, extra: 1 }],
  ['no report', { ...valid, sarif: undefined }],
])('400 on %s', async (_name, body) => {
  expect((await post(body)).status).toBe(400)
  expect(importMock).not.toHaveBeenCalled()
})

it('400 on a body that is not JSON', async () => {
  expect((await post('not json')).status).toBe(400)
})

it('413 on a body over 1 MiB, before parsing', async () => {
  const res = await post({ ...valid, sarif: { pad: 'x'.repeat(1024 * 1024) } })
  expect(res.status).toBe(413)
  expect(importMock).not.toHaveBeenCalled()
})

it('413 from a declared Content-Length before reading the body', async () => {
  const res = await POST(
    new NextRequest(URL_, {
      method: 'POST',
      body: JSON.stringify(valid),
      headers: { 'content-length': String(2 * 1024 * 1024) },
    })
  )
  expect(res.status).toBe(413)
  expect(importMock).not.toHaveBeenCalled()
})

it('maps a service refusal to its status and message', async () => {
  importMock.mockRejectedValue(
    Object.assign(
      new Error('No GitHub pull request acme/app#7 in this workspace'),
      {
        status: 404,
      }
    )
  )
  const res = await post(valid)
  expect(res.status).toBe(404)
  await expect(res.json()).resolves.toEqual({
    error: 'No GitHub pull request acme/app#7 in this workspace',
  })
})
