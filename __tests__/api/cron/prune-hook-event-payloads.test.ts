/**
 * @jest-environment node
 *
 * LUM-913 — the daily raw-payload prune cron also drops the webhook payload of
 * PR comment dead letters, behind the same CRON_SECRET check, and one step
 * failing does not stop the other from running.
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/services/hook-event-retention.service', () => ({
  hookEventRetentionService: { pruneExpiredPayloads: jest.fn() },
}))
jest.mock('@/lib/services/pr-comment-dead-letter-retention.service', () => ({
  prCommentDeadLetterRetentionService: { purgeExpiredPayloads: jest.fn() },
}))
jest.mock('@/lib/services/crossing-raw-retention.service', () => ({
  crossingRawRetentionService: { purgeExpired: jest.fn() },
}))
jest.mock('@/lib/plugins/retention', () => ({
  sweepPluginRetention: jest.fn(),
}))

import { GET } from '@/app/api/cron/prune-hook-event-payloads/route'
import { hookEventRetentionService } from '@/lib/services/hook-event-retention.service'
import { prCommentDeadLetterRetentionService } from '@/lib/services/pr-comment-dead-letter-retention.service'
import { crossingRawRetentionService } from '@/lib/services/crossing-raw-retention.service'
import { sweepPluginRetention } from '@/lib/plugins/retention'

const hookPrune = hookEventRetentionService.pruneExpiredPayloads as jest.Mock
const deadLetterPurge =
  prCommentDeadLetterRetentionService.purgeExpiredPayloads as jest.Mock

const crossingPurge = crossingRawRetentionService.purgeExpired as jest.Mock

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  crossingPurge.mockResolvedValue({ purged: 0, capped: false })
  ;(sweepPluginRetention as jest.Mock).mockResolvedValue({})
  process.env = { ...OLD_ENV, CRON_SECRET: 'secret' }
})
afterAll(() => {
  process.env = OLD_ENV
})

function req(auth?: string) {
  return new NextRequest(
    'http://localhost/api/cron/prune-hook-event-payloads',
    {
      headers: auth ? { authorization: auth } : {},
    }
  )
}

it('rejects a request without the cron secret and purges nothing', async () => {
  const res = await GET(req('Bearer wrong'))
  expect(res.status).toBe(401)
  expect(hookPrune).not.toHaveBeenCalled()
  expect(deadLetterPurge).not.toHaveBeenCalled()
  expect(crossingPurge).not.toHaveBeenCalled()
})

it('daily prune cron also purges dead letter payloads', async () => {
  hookPrune.mockResolvedValue({ workspaces: [], pruned: 3 })
  deadLetterPurge.mockResolvedValue({ purged: 2, capped: false })
  const res = await GET(req('Bearer secret'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    workspaces: [],
    pruned: 3,
    prCommentDeadLetters: { purged: 2, capped: false },
    crossingRaw: { purged: 0, capped: false },
  })
  expect(deadLetterPurge).toHaveBeenCalledTimes(1)
})

it('runs the dead letter purge even when the hook event prune fails', async () => {
  hookPrune.mockRejectedValue(new Error('hook prune down'))
  deadLetterPurge.mockResolvedValue({ purged: 1, capped: false })
  await expect(GET(req('Bearer secret'))).rejects.toThrow('hook prune down')
  expect(deadLetterPurge).toHaveBeenCalledTimes(1)
})

it('daily prune cron also purges dispositioned crossing raw text', async () => {
  hookPrune.mockRejectedValue(new Error('hook prune down'))
  deadLetterPurge.mockResolvedValue({ purged: 0, capped: false })
  crossingPurge.mockResolvedValue({ purged: 4, capped: false })
  await expect(GET(req('Bearer secret'))).rejects.toThrow('hook prune down')
  expect(crossingPurge).toHaveBeenCalledTimes(1)

  hookPrune.mockResolvedValue({ workspaces: [], pruned: 0 })
  const res = await GET(req('Bearer secret'))
  expect((await res.json()).crossingRaw).toEqual({ purged: 4, capped: false })
})

it('LUM-1259: runs the plugin sweeps too, and reports them only when there are any', async () => {
  hookPrune.mockResolvedValue({ workspaces: [], pruned: 0 })
  deadLetterPurge.mockResolvedValue({ purged: 0, capped: false })
  ;(sweepPluginRetention as jest.Mock).mockResolvedValue({ localScanRuns: 4 })
  const res = await GET(req('Bearer secret'))
  expect((await res.json()).plugins).toEqual({ localScanRuns: 4 })
})

it('LUM-1259: a failing plugin sweep fails the run after the core steps ran', async () => {
  hookPrune.mockResolvedValue({ workspaces: [], pruned: 0 })
  deadLetterPurge.mockResolvedValue({ purged: 0, capped: false })
  ;(sweepPluginRetention as jest.Mock).mockRejectedValue(
    new Error('sweep down')
  )
  await expect(GET(req('Bearer secret'))).rejects.toThrow('sweep down')
  expect(hookPrune).toHaveBeenCalledTimes(1)
  expect(crossingPurge).toHaveBeenCalledTimes(1)
})
