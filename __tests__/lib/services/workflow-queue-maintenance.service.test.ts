/**
 * @jest-environment node
 *
 * LUM-1030 ruling ④ — the self-hosted Postgres World's queue cleanup and its
 * cron route. Runs graphile-worker's own cleanup tasks (deleting permanently
 * failed jobs such as the ones a killed worker leaves once graphile releases
 * its lock) and keeps the World's two task identifiers. A no-op off the
 * Postgres World.
 */
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))
jest.mock('graphile-worker', () => ({ makeWorkerUtils: jest.fn() }))

import { makeWorkerUtils } from 'graphile-worker'
import { NextRequest } from 'next/server'
import {
  workflowQueueMaintenanceService,
  workflowTaskIdentifiers,
} from '@/lib/services/workflow-queue-maintenance.service'
import {
  WORKFLOW_QUEUE_CLEANUP_TASKS,
  workflowQueueRepository,
} from '@/lib/repositories/workflow-queue.repository'

const env = (vars: Record<string, string | undefined>) =>
  vars as unknown as NodeJS.ProcessEnv
const PG = {
  WORKFLOW_TARGET_WORLD: '@workflow/world-postgres',
  WORKFLOW_POSTGRES_URL: 'postgres://lumo:pw@db:5432/lumo',
}

beforeEach(() => jest.clearAllMocks())

describe('workflowTaskIdentifiers', () => {
  it('LUM-1030 cleanup: mirrors the World job names, honouring WORKFLOW_POSTGRES_JOB_PREFIX', () => {
    expect(workflowTaskIdentifiers(env({}))).toEqual([
      'workflow_flows',
      'workflow_flows_executor',
    ])
    expect(
      workflowTaskIdentifiers(env({ WORKFLOW_POSTGRES_JOB_PREFIX: 'lumo_' }))
    ).toEqual(['lumo_flows', 'lumo_flows_executor'])
  })
})

describe('workflowQueueMaintenanceService.cleanup', () => {
  it('LUM-1030 cleanup: skipped off the Postgres World (Vercel has no graphile queue)', async () => {
    const repo = { cleanup: jest.fn() }
    await expect(
      workflowQueueMaintenanceService.cleanup(
        env({ VERCEL_DEPLOYMENT_ID: 'dpl_1' }),
        repo
      )
    ).resolves.toEqual({ skipped: true, reason: expect.any(String) })
    expect(repo.cleanup).not.toHaveBeenCalled()
  })

  it('LUM-1030 cleanup: on the Postgres World runs every graphile cleanup task against WORKFLOW_POSTGRES_URL', async () => {
    const repo = { cleanup: jest.fn(async () => undefined) }
    await expect(
      workflowQueueMaintenanceService.cleanup(env(PG), repo)
    ).resolves.toEqual({
      skipped: false,
      tasks: [...WORKFLOW_QUEUE_CLEANUP_TASKS],
    })
    expect(repo.cleanup).toHaveBeenCalledWith({
      connectionString: PG.WORKFLOW_POSTGRES_URL,
      taskIdentifiersToKeep: ['workflow_flows', 'workflow_flows_executor'],
    })
  })

  it('LUM-1030 cleanup: a Postgres World without a URL is a 500, not a silent no-op', async () => {
    await expect(
      workflowQueueMaintenanceService.cleanup(
        env({ ...PG, WORKFLOW_POSTGRES_URL: undefined }),
        { cleanup: jest.fn() }
      )
    ).rejects.toMatchObject({ status: 500 })
  })
})

describe('workflowQueueRepository.cleanup', () => {
  it('LUM-1030 cleanup: calls graphile-worker cleanup with all three tasks and always releases', async () => {
    const utils = {
      cleanup: jest.fn(async () => {
        throw new Error('db down')
      }),
      release: jest.fn(async () => undefined),
    }
    ;(makeWorkerUtils as jest.Mock).mockResolvedValue(utils)

    await expect(
      workflowQueueRepository.cleanup({
        connectionString: 'postgres://x',
        taskIdentifiersToKeep: ['workflow_flows'],
      })
    ).rejects.toThrow('db down')
    expect(makeWorkerUtils).toHaveBeenCalledWith({
      connectionString: 'postgres://x',
    })
    expect(utils.cleanup).toHaveBeenCalledWith({
      tasks: [
        'DELETE_PERMAFAILED_JOBS',
        'GC_JOB_QUEUES',
        'GC_TASK_IDENTIFIERS',
      ],
      taskIdentifiersToKeep: ['workflow_flows'],
    })
    expect(utils.release).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/cron/workflow-queue-cleanup', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  async function call(auth?: string) {
    const { GET } = await import('@/app/api/cron/workflow-queue-cleanup/route')
    const headers: Record<string, string> = auth ? { authorization: auth } : {}
    return GET(
      new NextRequest('http://localhost/api/cron/workflow-queue-cleanup', {
        headers,
      })
    )
  }

  it('LUM-1030 cleanup route: refuses without the cron secret', async () => {
    process.env.CRON_SECRET = 'cron-test-value'
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
  })

  it('LUM-1030 cleanup route: with the secret, off the Postgres World it answers skipped', async () => {
    process.env.CRON_SECRET = 'cron-test-value'
    delete process.env.WORKFLOW_TARGET_WORLD
    const res = await call('Bearer cron-test-value')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: true })
  })
})
