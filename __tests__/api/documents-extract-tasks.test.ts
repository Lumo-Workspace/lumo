/** @jest-environment node */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(async () => ({
    clerkId: 'user_1',
    memberId: 'mem_1',
    workspaceId: 'ws_1',
    workspaceSlug: 'lumo',
    workspaceName: 'Lumo',
    source: 'bearer',
  })),
}))

jest.mock('@/lib/services/document-task-extraction.service', () => ({
  extractTasksFromDoc: jest.fn(),
}))

import { POST } from '@/app/api/documents/[id]/extract-tasks/route'
import { extractTasksFromDoc } from '@/lib/services/document-task-extraction.service'

const svc = extractTasksFromDoc as jest.Mock

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc_1/extract-tasks', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      authorization: 'Bearer lum_test',
      'content-type': 'application/json',
    },
  })
}

describe('POST /api/documents/[id]/extract-tasks', () => {
  beforeEach(() => svc.mockReset())

  it('returns 200 with service result', async () => {
    svc.mockResolvedValueOnce({
      tasks: [{ id: 'cm_1', identifier: 'LUM-1', title: 'first' }],
      updatedContent: '<ul/>',
      updatedAt: '2026-05-24T10:00:00.000Z',
      skipped: [],
    })

    const res = await POST(
      req({
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>first</p></li></ul>',
        selector: { type: 'all_unchecked' },
      }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tasks).toHaveLength(1)
    expect(json.tasks[0].identifier).toBe('LUM-1')
  })

  it('returns 400 on validation failure', async () => {
    const res = await POST(
      req({ content: '', selector: { type: 'all_unchecked' } }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 with MISSING_PROJECT code from service', async () => {
    svc.mockRejectedValueOnce(
      Object.assign(new Error('Document has no project'), {
        status: 400,
        code: 'MISSING_PROJECT',
      })
    )

    const res = await POST(
      req({ content: '<p>x</p>', selector: { type: 'all_unchecked' } }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('MISSING_PROJECT')
  })

  it('returns 403 from service', async () => {
    svc.mockRejectedValueOnce(
      Object.assign(new Error('No edit access'), { status: 403 })
    )

    const res = await POST(
      req({ content: '<p>x</p>', selector: { type: 'all_unchecked' } }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )
    expect(res.status).toBe(403)
  })

  it('returns 409 NO_CANDIDATES from service', async () => {
    svc.mockRejectedValueOnce(
      Object.assign(new Error('No candidates'), {
        status: 409,
        code: 'NO_CANDIDATES',
      })
    )

    const res = await POST(
      req({ content: '<p>x</p>', selector: { type: 'marked' } }),
      { params: Promise.resolve({ id: 'doc_1' }) }
    )
    expect(res.status).toBe(409)
  })
})
