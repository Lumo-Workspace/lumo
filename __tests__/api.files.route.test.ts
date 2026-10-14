/**
 * @jest-environment node
 */

/**
 * LUM-916: uploads are private blobs; `GET /api/files/<pathname>` is the only
 * way to read them. These tests pin who gets the bytes:
 *   - evidence / images → members of the owning workspace only
 *   - an image inside a publicly shared document → anyone holding that
 *     document's share token, but only images that document embeds
 */
import { NextRequest, NextResponse } from 'next/server'

// LUM-916: private blobs live in the private store; its token must be set.
process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = 'priv-token'

const requireIdentity = jest.fn()
const requireAuth = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => requireIdentity(...a),
  requireAuth: (...a: unknown[]) => requireAuth(...a),
}))
const requireUserWorkspace = jest.fn()
jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: (...a: unknown[]) => requireUserWorkspace(...a),
}))

const findTaskWorkspaceId = jest.fn()
const findMilestoneWorkspaceId = jest.fn()
const findSharedDocument = jest.fn()
jest.mock('@/lib/repositories/private-file.repository', () => ({
  privateFileRepository: {
    findTaskWorkspaceId: (...a: unknown[]) => findTaskWorkspaceId(...a),
    findMilestoneWorkspaceId: (...a: unknown[]) =>
      findMilestoneWorkspaceId(...a),
    findSharedDocument: (...a: unknown[]) => findSharedDocument(...a),
  },
}))

const put = jest.fn()
const get = jest.fn()
jest.mock('@vercel/blob', () => ({
  put: (...a: unknown[]) => put(...a),
  get: (...a: unknown[]) => get(...a),
}))

import { GET } from '@/app/api/files/[...path]/route'
import { POST as uploadImage } from '@/app/api/upload/image/route'

const EVIDENCE =
  'test-evidence/task-1/case-1/0b5c4a1e-7f7e-4a4e-9d1b-1a2b3c4d5e6f'
const MILESTONE_EVIDENCE =
  'milestone-evidence/m1/c1/0b5c4a1e-7f7e-4a4e-9d1b-1a2b3c4d5e6f'
const IMAGE = 'workspaces/ws-a/images/1f2e3d4c-aaaa-bbbb-cccc-000011112222'

function identity(workspaceId: string) {
  return {
    clerkId: 'u',
    memberId: 'm',
    workspaceId,
    workspaceSlug: 's',
    workspaceName: 'n',
    source: 'clerk' as const,
  }
}
const anonymous = () =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

function read(pathname: string, query = '') {
  return GET(new NextRequest(`http://app.test/api/files/${pathname}${query}`), {
    params: Promise.resolve({ path: pathname.split('/') }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  findTaskWorkspaceId.mockResolvedValue('ws-a')
  findMilestoneWorkspaceId.mockResolvedValue('ws-a')
  findSharedDocument.mockResolvedValue(null)
  get.mockImplementation(async () => ({
    statusCode: 200,
    stream: new Blob(['bytes']).stream(),
    blob: { contentType: 'image/svg+xml', size: 5 },
  }))
  put.mockResolvedValue({})
})

describe('file route serves a blob only to members of the owning workspace', () => {
  it('401s an anonymous viewer without a share token and reads nothing', async () => {
    requireIdentity.mockResolvedValue(anonymous())
    const res = await read(EVIDENCE)
    expect(res.status).toBe(401)
    expect(get).not.toHaveBeenCalled()
  })

  it('404s a member of another workspace for evidence and images alike', async () => {
    requireIdentity.mockResolvedValue(identity('ws-b'))
    expect((await read(EVIDENCE)).status).toBe(404)
    expect((await read(IMAGE)).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })

  it('404s evidence whose task no longer exists', async () => {
    requireIdentity.mockResolvedValue(identity('ws-a'))
    findTaskWorkspaceId.mockResolvedValue(null)
    expect((await read(EVIDENCE)).status).toBe(404)
  })

  it('streams the private blob to a member of the owning workspace with sandboxing headers', async () => {
    requireIdentity.mockResolvedValue(identity('ws-a'))
    const res = await read(EVIDENCE)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('bytes')
    expect(get).toHaveBeenCalledWith(EVIDENCE, {
      access: 'private',
      token: 'priv-token',
    })
    expect(findTaskWorkspaceId).toHaveBeenCalledWith('task-1')
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/)
    expect(res.headers.get('content-security-policy')).toMatch(
      /default-src 'none'/
    )
    expect(res.headers.get('cache-control')).toMatch(/^private/)
  })

  it('refuses paths outside the two private prefixes (exports, SARIF, logos, traversal)', async () => {
    requireIdentity.mockResolvedValue(identity('ws-a'))
    for (const p of [
      'workspaces/ws-a/exports/e1/workspace-export.zip',
      'security-sarif/x',
      'workspaces/ws-a/logo-1',
      'test-evidence/task-1/../../workspaces/ws-a/exports/e1',
      'test-evidence/task-1/case-1/a.png',
    ]) {
      expect((await read(p)).status).toBe(404)
    }
    expect(get).not.toHaveBeenCalled()
  })
})

describe('milestone evidence (LUM-1135)', () => {
  it('streams milestone evidence to a member of the milestone workspace', async () => {
    requireIdentity.mockResolvedValue(identity('ws-a'))
    const res = await read(MILESTONE_EVIDENCE)
    expect(res.status).toBe(200)
    expect(findMilestoneWorkspaceId).toHaveBeenCalledWith('m1')
    expect(findTaskWorkspaceId).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledWith(MILESTONE_EVIDENCE, {
      access: 'private',
      token: 'priv-token',
    })
  })

  it('404s a member of another workspace, same as a missing file', async () => {
    requireIdentity.mockResolvedValue(identity('ws-b'))
    expect((await read(MILESTONE_EVIDENCE)).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })

  it('404s evidence whose milestone no longer exists', async () => {
    requireIdentity.mockResolvedValue(identity('ws-a'))
    findMilestoneWorkspaceId.mockResolvedValue(null)
    expect((await read(MILESTONE_EVIDENCE)).status).toBe(404)
  })

  it('never opens milestone evidence through a share token', async () => {
    requireIdentity.mockResolvedValue(anonymous())
    findSharedDocument.mockResolvedValue({
      workspaceId: 'ws-a',
      content: `<a href="/api/files/${MILESTONE_EVIDENCE}">x</a>`,
      sourceMarkdown: null,
    })
    expect((await read(MILESTONE_EVIDENCE, '?share=tok-1')).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })

  it('404s traversal in the milestone segment', async () => {
    requireIdentity.mockResolvedValue(identity('ws-a'))
    expect((await read('milestone-evidence/../c1/f1')).status).toBe(404)
  })
})

describe('editor images are private per workspace and reachable anonymously only through a sharing document', () => {
  function uploadRequest(file: File, folder?: string) {
    const fd = new FormData()
    fd.append('file', file)
    if (folder) fd.append('folder', folder)
    return new NextRequest('http://app.test/api/upload/image', {
      method: 'POST',
      body: fd,
    })
  }

  it('stores an upload as a private blob under the server-chosen workspace prefix, ignoring the client folder', async () => {
    requireAuth.mockResolvedValue({ userId: 'u' })
    requireUserWorkspace.mockResolvedValue({ workspaceId: 'ws-a' })
    const png = new File([new Uint8Array(3)], 'a.png', { type: 'image/png' })

    const res = await uploadImage(uploadRequest(png, '../../ws-b'))
    expect(res.status).toBe(200)
    const { url } = (await res.json()) as { url: string }

    const [pathname, , opts] = put.mock.calls[0] as [
      string,
      unknown,
      { access: string; token: string },
    ]
    expect(opts.access).toBe('private')
    expect(opts.token).toBe('priv-token')
    expect(pathname).toMatch(/^workspaces\/ws-a\/images\/[0-9a-f-]{36}$/)
    expect(url).toBe(`http://app.test/api/files/${pathname}`)
  })

  it('serves an image to an anonymous viewer holding the token of a public document that embeds it', async () => {
    requireIdentity.mockResolvedValue(anonymous())
    findSharedDocument.mockResolvedValue({
      workspaceId: 'ws-a',
      content: `<p><img src="https://www.uselumo.ai/api/files/${IMAGE}"></p>`,
      sourceMarkdown: null,
    })
    const res = await read(IMAGE, '?share=tok-1')
    expect(res.status).toBe(200)
    expect(findSharedDocument).toHaveBeenCalledWith('tok-1')
  })

  it('also lets a signed-in member of another workspace through the share token', async () => {
    requireIdentity.mockResolvedValue(identity('ws-b'))
    findSharedDocument.mockResolvedValue({
      workspaceId: 'ws-a',
      content: `<img src="/api/files/${IMAGE}">`,
      sourceMarkdown: null,
    })
    expect((await read(IMAGE, '?share=tok-1')).status).toBe(200)
  })

  it('404s an image the sharing document does not embed', async () => {
    requireIdentity.mockResolvedValue(anonymous())
    findSharedDocument.mockResolvedValue({
      workspaceId: 'ws-a',
      content: '<img src="/api/files/workspaces/ws-a/images/some-other-id">',
      sourceMarkdown: null,
    })
    expect((await read(IMAGE, '?share=tok-1')).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })

  it('404s when the sharing document belongs to another workspace, even if it embeds the URL', async () => {
    requireIdentity.mockResolvedValue(anonymous())
    findSharedDocument.mockResolvedValue({
      workspaceId: 'ws-b',
      content: `<img src="/api/files/${IMAGE}">`,
      sourceMarkdown: null,
    })
    expect((await read(IMAGE, '?share=tok-1')).status).toBe(404)
  })

  it('404s an unknown share token, and never opens evidence through a share token', async () => {
    requireIdentity.mockResolvedValue(anonymous())
    expect((await read(IMAGE, '?share=nope')).status).toBe(404)
    findSharedDocument.mockResolvedValue({
      workspaceId: 'ws-a',
      content: `<a href="/api/files/${EVIDENCE}">x</a>`,
      sourceMarkdown: null,
    })
    expect((await read(EVIDENCE, '?share=tok-1')).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })
})
