/**
 * @jest-environment node
 *
 * LUM-900 — a boundary crossing's `detail` / `target` are built from the raw
 * command, so a credential in the command was stored verbatim (and shown in
 * the crossing panel, `lumo task status`, the agent reminder, and the LLM
 * explanation evidence). Both columns now hold the shared storage-redaction
 * form. Credential-shaped values are assembled at runtime (no literal).
 */
// LUM-1059: create allocates the crossing number in a transaction.
function mockTxClient(): unknown {
  return mockPrisma
}
const mockPrisma = {
  $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
    fn(mockTxClient())
  ),
  task: { findUnique: jest.fn(async () => ({ workspaceId: 'w1' })) },
  workspace: { update: jest.fn(async () => ({ crossingSeq: 1 })) },
  boundaryCrossing: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn<Promise<{ count: number }>, [unknown]>(async () => ({
      count: 0,
    })),
  },
}
jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return mockPrisma
  },
}))

import { detectCrossings } from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { classifyRow } from '@/lib/security-scan/secret-stock/classify'

const PASS = 'Xq7' + 'Lp9Zk2'
const GH_TOKEN = 'ghp' + '_' + 'Qm7Tz4Lw9Kp2Xc8Vb5Nr3Hy6Gf1Dj0Sa4Pe7Ab'

const bash = (command: string) => ({
  toolName: 'Bash',
  filePath: null,
  payload: { tool_name: 'Bash', tool_input: { command } },
})

beforeEach(() => jest.clearAllMocks())

describe('LUM-900 detector output', () => {
  it('LUM-900 detector detail and target carry no credential for each reproduced command', () => {
    const cases = [
      {
        command: `git push https://me:${PASS}@github.com/a/b.git main --force`,
        secret: PASS,
        category: 'PUSH_TO_PROTECTED_BRANCH',
        names: 'git push',
      },
      {
        command: `PGPASSWORD=${PASS} psql -h prod-db -c "DROP TABLE users"`,
        secret: PASS,
        category: 'DESTRUCTIVE_DB_COMMAND',
        names: 'DROP TABLE users',
      },
      {
        command: `gh repo edit --visibility public && echo TOKEN=${PASS}`,
        secret: PASS,
        category: 'EXFILTRATION_PUBLIC',
        names: 'gh repo edit --visibility public',
      },
      {
        command: `rm -rf __tests__/a.test.ts # token ${GH_TOKEN}`,
        secret: GH_TOKEN,
        category: 'TEST_FILE_DELETED',
        names: 'rm -rf __tests__/a.test.ts',
      },
    ]
    for (const c of cases) {
      const hits = detectCrossings(bash(c.command)).filter(
        h => h.category === c.category
      )
      expect([c.category, hits.length]).toEqual([c.category, 1])
      const hit = hits[0]!
      for (const text of [hit.detail, hit.target ?? '']) {
        expect(text).not.toContain(c.secret)
        expect(classifyRow([text]).size).toBe(0)
      }
      expect(hit.detail).toContain(c.names)
      expect(hit.detail).toContain('…(len ')
    }
  })

  it('LUM-900 a credential straddling the detail clip boundary is not stored in part', () => {
    // The token starts a few characters before the 200-char clip: clipping
    // first would leave a raw fragment no registry rule recognises any more.
    const pad = 'x'.repeat(150)
    const command = `git push origin main --force # ${pad} ${GH_TOKEN} done`
    const hit = detectCrossings(bash(command)).find(
      h => h.category === 'PUSH_TO_PROTECTED_BRANCH'
    )
    expect(hit).toBeDefined()
    const tail = GH_TOKEN.slice(4, 14)
    for (const text of [hit!.detail, hit!.target ?? '']) {
      expect(text).not.toContain(GH_TOKEN)
      expect(text).not.toContain(tail)
      expect(classifyRow([text]).size).toBe(0)
    }
  })
})

describe('LUM-900 repository write paths', () => {
  it('LUM-900 repository redacts detail and target on every write path and still coalesces a recurrence', async () => {
    const command = `PGPASSWORD=${PASS} psql -h prod-db -c "DROP TABLE users"`
    await boundaryCrossingRepository.create({
      taskId: 't',
      category: 'DESTRUCTIVE_DB_COMMAND',
      severity: 'HIGH',
      detail: command,
      target: command,
    })
    await boundaryCrossingRepository.downgradeToAdvisory('bc', {
      severity: 'LOW',
      detail: command,
      now: new Date(),
    })
    await boundaryCrossingRepository.coalesceRecurrence(
      't',
      'DESTRUCTIVE_DB_COMMAND',
      command,
      new Date()
    )
    await boundaryCrossingRepository.coalesceSuppressedRecurrence(
      't',
      'DESTRUCTIVE_DB_COMMAND',
      command,
      'rule',
      new Date()
    )
    await boundaryCrossingRepository.coalesceRecurrenceForMilestone(
      'm',
      'DESTRUCTIVE_DB_COMMAND',
      command,
      new Date()
    )

    const created = mockPrisma.boundaryCrossing.create.mock.calls[0]![0] as {
      data: { detail: string; target: string }
    }
    const updates = mockPrisma.boundaryCrossing.updateMany.mock.calls.map(
      c => c[0] as unknown as { where: { target?: string }; data: object }
    )
    expect(updates).toHaveLength(4)
    const written = JSON.stringify([created, updates])
    expect(written).not.toContain(PASS)
    expect(classifyRow([written]).size).toBe(0)
    expect(created.data.detail).toContain('DROP TABLE users')

    // A recurrence looks up the SAME stored form, so it merges instead of
    // inserting a duplicate row.
    const lookups = updates.slice(1).map(u => u.where.target)
    expect(lookups).toEqual([
      created.data.target,
      created.data.target,
      created.data.target,
    ])

    // A clean write still reaches Prisma as built.
    mockPrisma.boundaryCrossing.create.mockClear()
    await boundaryCrossingRepository.create({
      taskId: 't',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      severity: 'MEDIUM',
      detail: 'git push origin main --force',
      target: 'git push origin main --force',
    })
    const clean = mockPrisma.boundaryCrossing.create.mock.calls[0]![0] as {
      data: { detail: string; target: string }
    }
    expect(clean.data.detail).toBe('git push origin main --force')
    expect(clean.data.target).toBe('git push origin main --force')
  })
})
