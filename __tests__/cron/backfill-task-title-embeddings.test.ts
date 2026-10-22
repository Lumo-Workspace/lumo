/** @jest-environment node */
// LUM-1286: scheduled backfill of Task.titleEmbedding, run inside Vercel.
const run = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/services/task-embedding.service', () => ({
  runTaskTitleEmbeddingBackfill: (...a: unknown[]) => run(...a),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/backfill-task-title-embeddings/route'

const req = (query: string, auth: string | null) =>
  new NextRequest(`http://x/api/cron/backfill-task-title-embeddings${query}`, {
    headers: auth ? { authorization: auth } : {},
  })

const OLD = process.env.CRON_SECRET
beforeAll(() => {
  process.env.CRON_SECRET = 'secret'
})
afterAll(() => {
  process.env.CRON_SECRET = OLD
})
beforeEach(() => {
  run.mockReset()
  run.mockResolvedValue({
    dryRun: false,
    missingBefore: 3,
    embedded: 3,
    failed: 0,
    missingAfter: 0,
    stoppedAtDeadline: false,
  })
})

it('rejects a call without the cron secret', async () => {
  const res = await GET(req('', null))
  expect(res.status).toBe(401)
  expect(run).not.toHaveBeenCalled()
})

it('writes by default (the scheduled call) within a time budget and returns the report', async () => {
  const before = Date.now()
  const res = await GET(req('', 'Bearer secret'))

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ missingBefore: 3, embedded: 3 })
  const arg = run.mock.calls[0]![0]
  expect(arg.dryRun).toBe(false)
  expect(arg.deadline.getTime()).toBeGreaterThan(before)
  expect(arg.deadline.getTime()).toBeLessThanOrEqual(Date.now() + 240_000)
})

it('only counts with ?dryRun=1', async () => {
  await GET(req('?dryRun=1', 'Bearer secret'))
  expect(run.mock.calls[0]![0].dryRun).toBe(true)
})

it('rejects a malformed query', async () => {
  const res = await GET(req('?dryRun=maybe', 'Bearer secret'))
  expect(res.status).toBe(400)
  expect(run).not.toHaveBeenCalled()
})

it('returns 500 instead of an unhandled error when the run throws', async () => {
  run.mockRejectedValueOnce(new Error('db down'))
  const res = await GET(req('', 'Bearer secret'))
  expect(res.status).toBe(500)
  expect(await res.json()).toEqual({ error: 'Backfill failed' })
})
