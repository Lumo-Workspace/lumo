/**
 * @jest-environment node
 *
 * LUM-1003 — the operator backfill route: CRON_SECRET-gated, dry run unless
 * `dryRun=0`, query validated, cursor passed through.
 */
jest.mock('@/lib/services/pr-comment-author-backfill.service', () => ({
  prCommentAuthorBackfillService: {
    run: jest.fn(async (o: { dryRun: boolean }) => ({
      dryRun: o.dryRun,
      stoppedReason: 'done',
    })),
  },
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/backfill-pr-comment-author-association/route'
import { prCommentAuthorBackfillService } from '@/lib/services/pr-comment-author-backfill.service'

const run = prCommentAuthorBackfillService.run as jest.Mock
const URL_BASE =
  'https://lumo.test/api/cron/backfill-pr-comment-author-association'

function req(query = '', auth: string | null = 'Bearer s3cret') {
  return new NextRequest(`${URL_BASE}${query}`, {
    headers: auth ? { authorization: auth } : {},
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 's3cret'
})

describe('GET /api/cron/backfill-pr-comment-author-association', () => {
  it('rejects a request without the cron secret', async () => {
    const r = await GET(req('', null))
    expect(r.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('defaults to a dry run', async () => {
    const r = await GET(req())
    expect(r.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, cursor: null })
    )
  })

  it('writes only with an explicit dryRun=0, and passes cursor + maxPrs through', async () => {
    await GET(req('?dryRun=0&cursor=pr_abc&maxPrs=10'))
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, cursor: 'pr_abc', maxPrs: 10 })
    )
  })

  it('400s on a malformed query', async () => {
    expect((await GET(req('?maxPrs=0'))).status).toBe(400)
    expect((await GET(req('?cursor=../x'))).status).toBe(400)
    expect((await GET(req('?dryRun=maybe'))).status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})
