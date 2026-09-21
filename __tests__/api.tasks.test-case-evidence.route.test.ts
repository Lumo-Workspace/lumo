/**
 * @jest-environment node
 */

/**
 * LUM-801: run 证据上传路由。
 *
 * 这条路由单独存在的**唯一理由**是身份：/api/upload/image 用 requireAuth()
 * （只认 Clerk 浏览器会话），agent 拿 API key 调不了。这里用 requireIdentity()，
 * bearer 身份能过。第一个测试就是锁这件事——它一旦被"统一"回去，agent 上传
 * 证据的能力会静默消失。
 */
import { NextRequest } from 'next/server'

const requireIdentity = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => requireIdentity(...a),
}))
jest.mock('@/lib/api/resolve-task-param', () => ({
  resolveTaskParam: jest.fn().mockResolvedValue({ id: 't-1' }),
}))
jest.mock('@/lib/api/resolve-test-case-param', () => ({
  resolveTestCaseParam: jest
    .fn()
    .mockResolvedValue({ id: 'tc-1', taskId: 't-1' }),
}))

const put = jest.fn()
jest.mock('@vercel/blob', () => ({ put: (...a: unknown[]) => put(...a) }))

import { POST } from '@/app/api/tasks/[id]/test-cases/[caseRef]/evidence/route'

const params = { params: Promise.resolve({ id: 'LUM-1', caseRef: 'TC1' }) }

function multipart(files: File[]): NextRequest {
  const fd = new FormData()
  for (const f of files) fd.append('file', f)
  return new NextRequest('http://x/api/tasks/LUM-1/test-cases/TC1/evidence', {
    method: 'POST',
    body: fd,
  })
}

const png = (name = 'shot.png', bytes = 10) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' })

beforeEach(() => {
  jest.clearAllMocks()
  // bearer = CLI / agent 身份。requireAuth() 会拒掉它，requireIdentity() 不会。
  requireIdentity.mockResolvedValue({
    clerkId: 'u-1',
    memberId: 'm-1',
    workspaceId: 'w-1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    source: 'bearer',
  })
  put.mockImplementation(async (pathname: string) => ({
    url: `https://blob.example/${pathname}`,
  }))
})

describe('POST evidence', () => {
  it('accepts an API-key (bearer) identity, not only a Clerk session', async () => {
    const res = await POST(multipart([png()]), params)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      files: Array<Record<string, unknown>>
    }
    expect(body.files).toHaveLength(1)
    expect(body.files[0]).toMatchObject({
      filename: 'shot.png',
      contentType: 'image/png',
      size: 10,
    })
  })

  it('stores under the test-evidence/{taskId}/{caseId}/ prefix', async () => {
    await POST(multipart([png()]), params)
    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^test-evidence\/t-1\/tc-1\//),
      expect.anything(),
      expect.objectContaining({ access: 'public' })
    )
  })

  it('accepts a text log', async () => {
    const log = new File(['boom'], 'console.log', { type: 'text/plain' })
    const res = await POST(multipart([log]), params)
    expect(res.status).toBe(200)
  })

  it('rejects a disallowed content type', async () => {
    const pdf = new File([new Uint8Array(4)], 'x.pdf', {
      type: 'application/pdf',
    })
    const res = await POST(multipart([pdf]), params)
    expect(res.status).toBe(400)
    expect(put).not.toHaveBeenCalled()
  })

  it('rejects more than 5 files', async () => {
    const res = await POST(
      multipart([
        png('1.png'),
        png('2.png'),
        png('3.png'),
        png('4.png'),
        png('5.png'),
        png('6.png'),
      ]),
      params
    )
    expect(res.status).toBe(400)
    expect(put).not.toHaveBeenCalled()
  })

  it('rejects a file over 10 MB', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    })
    const res = await POST(multipart([big]), params)
    expect(res.status).toBe(400)
    expect(put).not.toHaveBeenCalled()
  })

  it('uploads nothing when one file in the batch is invalid — no orphan blobs', async () => {
    const pdf = new File([new Uint8Array(4)], 'x.pdf', {
      type: 'application/pdf',
    })
    const res = await POST(multipart([png('ok.png'), pdf]), params)
    expect(res.status).toBe(400)
    expect(put).not.toHaveBeenCalled()
  })

  it('400s when no file part is present', async () => {
    const res = await POST(multipart([]), params)
    expect(res.status).toBe(400)
  })

  it('passes the auth failure response straight through', async () => {
    const { NextResponse } = await import('next/server')
    requireIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(multipart([png()]), params)
    expect(res.status).toBe(401)
    expect(put).not.toHaveBeenCalled()
  })
})
