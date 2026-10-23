/**
 * @jest-environment node
 *
 * LUM-1302 — the migration that lifts payload fields into columns fills them
 * for rows stored before it (from the still-plaintext payload), and leaves
 * every payload untouched.
 */
import { createPgliteHarness } from '../scripts/test-support/pglite-harness'

const MIGRATION = '20261204090000_lum1302_hook_payload_encryption'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient, {
  stopBeforeMigration: MIGRATION,
})

jest.setTimeout(180_000)

const HOUR = 60 * 60 * 1000

interface Row {
  id: string
  payload: unknown
  payloadPrunedReason: string | null
  toolUseId: string | null
  promptTaskNotification: boolean
  payloadKeyId: string | null
}

const rows: Record<
  string,
  { type: string; payload: object; createdAt?: Date; prunedAt?: Date }
> = {
  pruned_user: {
    type: 'POST_TOOL_USE',
    payload: {
      _lumo_pruned: {
        at: '2026-10-01T00:00:00Z',
        reason: 'USER_DELETED',
        by: 'm1',
      },
    },
    prunedAt: new Date(),
  },
  pruned_retention: {
    type: 'POST_TOOL_USE',
    payload: {
      _lumo_pruned: {
        at: '2026-10-01T00:00:00Z',
        reason: 'RETENTION_POLICY',
        retentionDays: 30,
      },
    },
    prunedAt: new Date(),
  },
  prompt_notice: {
    type: 'USER_PROMPT_SUBMIT',
    payload: {
      prompt:
        'done: <task-notification><task-id>a1b2</task-id></task-notification>',
    },
  },
  prompt_plain: {
    type: 'USER_PROMPT_SUBMIT',
    payload: { prompt: 'fix LUM-1' },
  },
  pre_recent: {
    type: 'PRE_TOOL_USE',
    payload: { tool_use_id: 'toolu_recent' },
    createdAt: new Date(Date.now() - HOUR),
  },
  pre_old: {
    type: 'PRE_TOOL_USE',
    payload: { tool_use_id: 'toolu_old' },
    createdAt: new Date(Date.now() - 10 * 24 * HOUR),
  },
  post_recent: {
    type: 'POST_TOOL_USE',
    payload: { tool_use_id: 'toolu_post' },
    createdAt: new Date(Date.now() - HOUR),
  },
}

beforeAll(async () => {
  await harness.start()
  await harness.insert('workspaces', { id: 'ws_m', name: 'ws', slug: 'ws_m' })
  await harness.insert('workspace_members', {
    id: 'm_m',
    workspaceId: 'ws_m',
    clerkId: 'clerk_m',
    role: 'OWNER',
  })
  for (const [id, r] of Object.entries(rows)) {
    await harness.insert('hook_events', {
      id,
      workspaceId: 'ws_m',
      workspaceMemberId: 'm_m',
      type: r.type,
      payload: JSON.stringify(r.payload),
      createdAt: (r.createdAt ?? new Date()).toISOString(),
      ...(r.prunedAt ? { payloadPrunedAt: r.prunedAt.toISOString() } : {}),
    })
  }
  await harness.applyMigration(MIGRATION)
})

afterAll(async () => {
  await harness.stop()
})

async function row(id: string): Promise<Row> {
  const [r] = await harness.query<Row>(
    `select id, payload, "payloadPrunedReason", "toolUseId", "promptTaskNotification", "payloadKeyId"
     from hook_events where id = $1`,
    [id]
  )
  return r!
}

describe(`migration ${MIGRATION}`, () => {
  it('fills the pruned reason from the marker', async () => {
    expect((await row('pruned_user')).payloadPrunedReason).toBe('USER_DELETED')
    expect((await row('pruned_retention')).payloadPrunedReason).toBe(
      'RETENTION_POLICY'
    )
    expect((await row('prompt_plain')).payloadPrunedReason).toBeNull()
  })

  it('flags root prompts carrying a task notification', async () => {
    expect((await row('prompt_notice')).promptTaskNotification).toBe(true)
    expect((await row('prompt_plain')).promptTaskNotification).toBe(false)
  })

  it('fills toolUseId for recent pre-tool events only', async () => {
    expect((await row('pre_recent')).toolUseId).toBe('toolu_recent')
    expect((await row('pre_old')).toolUseId).toBeNull()
    expect((await row('post_recent')).toolUseId).toBeNull()
  })

  it('leaves every payload as it was, still plaintext', async () => {
    for (const [id, r] of Object.entries(rows)) {
      const stored = await row(id)
      expect(stored.payload).toEqual(r.payload)
      expect(stored.payloadKeyId).toBeNull()
    }
    const keys = await harness.query('select * from workspace_data_keys')
    expect(keys).toEqual([])
  })
})
