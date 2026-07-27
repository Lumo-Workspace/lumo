/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/prune-document-revisions/route'

jest.mock('@/lib/services', () => ({
  documentRevisionService: { pruneRevisions: jest.fn() },
}))
const { documentRevisionService } = jest.requireMock('@/lib/services') as {
  documentRevisionService: { pruneRevisions: jest.Mock }
}

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...OLD_ENV, CRON_SECRET: 'secret' }
})
afterAll(() => {
  process.env = OLD_ENV
})

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/prune-document-revisions', {
    headers: auth ? { authorization: auth } : {},
  })
}

it('rejects an unauthorized request', async () => {
  const res = await GET(req('Bearer wrong'))
  expect(res.status).toBe(401)
  expect(documentRevisionService.pruneRevisions).not.toHaveBeenCalled()
})

it('runs prune for an authorized cron request', async () => {
  documentRevisionService.pruneRevisions.mockResolvedValue({ deleted: 7 })
  const res = await GET(req('Bearer secret'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ deleted: 7 })
})
