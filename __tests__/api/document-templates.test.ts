/**
 * @jest-environment node
 */
import { GET } from '@/app/api/document-templates/route'
import { NextRequest } from 'next/server'

const mockRequireIdentity = jest.fn()
const mockListTemplates = jest.fn()

jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: any[]) => mockRequireIdentity(...a),
}))
jest.mock('@/lib/services/document-template.service', () => ({
  documentTemplateService: {
    listTemplates: (...a: any[]) => mockListTemplates(...a),
  },
}))

beforeEach(() => {
  mockRequireIdentity.mockReset()
  mockListTemplates.mockReset()
})

function req() {
  return new NextRequest('http://localhost/api/document-templates')
}

describe('GET /api/document-templates', () => {
  it('returns the workspace-visible templates', async () => {
    mockRequireIdentity.mockResolvedValue({
      workspaceId: 'ws_1',
      memberId: 'm_1',
    })
    mockListTemplates.mockResolvedValue([{ id: 't_1', key: 'prd' }])

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ templates: [{ id: 't_1', key: 'prd' }] })
    expect(mockListTemplates).toHaveBeenCalledWith('ws_1')
  })

  it('propagates the auth guard response', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireIdentity.mockResolvedValue(
      NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    )

    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockListTemplates).not.toHaveBeenCalled()
  })
})
