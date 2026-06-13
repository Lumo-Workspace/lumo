import {
  boundaryDetectorService,
  detectCrossings,
} from '@/lib/services/boundary-detector.service'
import { activityRepository } from '@/lib/repositories/activity.repository'

// LUM-477: coalesce repeated OPEN crossings with the same (taskId, category,
// target) into one row instead of recording a duplicate per detection event.
// A stateful fake repository models the real coalescing semantics: an OPEN row
// with a matching key absorbs the recurrence (occurrenceCount++/lastSeenAt),
// any other key (or a key whose prior row was dispositioned) inserts anew.

interface FakeRow {
  id: string
  taskId: string
  category: string
  target: string | null
  detail: string
  disposition: string | null
  occurrenceCount: number
  lastSeenAt: Date | null
}

const rows: FakeRow[] = []
let idSeq = 0

const fakeRepo = {
  // Atomic recurrence: bump every OPEN row whose key matches; return how many
  // were bumped (0 → the caller inserts a fresh row).
  coalesceRecurrence: jest.fn(
    async (
      taskId: string,
      category: string,
      target: string | null,
      now: Date
    ) => {
      let count = 0
      for (const r of rows) {
        if (
          r.taskId === taskId &&
          r.category === category &&
          r.target === target &&
          r.disposition == null
        ) {
          r.occurrenceCount += 1
          r.lastSeenAt = now
          count++
        }
      }
      return count
    }
  ),
  create: jest.fn(async (input: Record<string, unknown>) => {
    const row: FakeRow = {
      id: `bc-${++idSeq}`,
      taskId: input.taskId as string,
      category: input.category as string,
      target: (input.target as string | null) ?? null,
      detail: input.detail as string,
      disposition: null,
      occurrenceCount: 1,
      lastSeenAt: null,
    }
    rows.push(row)
    return row
  }),
}

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    coalesceRecurrence: (...a: unknown[]) =>
      (fakeRepo.coalesceRecurrence as (...x: unknown[]) => unknown)(...a),
    create: (...a: unknown[]) =>
      (fakeRepo.create as (...x: unknown[]) => unknown)(...a),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

const createActivity = activityRepository.create as jest.Mock

const bash = (command: string) => ({ tool_input: { command } })
const bashEvent = (taskId: string, hookEventId: string, command: string) => ({
  taskId,
  hookEventId,
  toolName: 'Bash' as const,
  filePath: null,
  payload: bash(command),
})

beforeEach(() => {
  rows.length = 0
  idSeq = 0
  jest.clearAllMocks()
  ;(createActivity as jest.Mock).mockResolvedValue({ id: 'act' })
})

it('a repeated crossing with the same task category target coalesces into one open crossing', async () => {
  // Same forbidden action recorded across three distinct hook events — the agent
  // ran (or re-edited) the very same thing three times.
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-1', 'git push origin main')
  )
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-2', 'git push origin main')
  )
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-3', 'git push origin main')
  )

  // Exactly ONE open crossing exists — not one row per event.
  const open = rows.filter(r => r.disposition == null)
  expect(open).toHaveLength(1)
  // It carries the recurrence (occurrence count) so a reviewer sees it repeated.
  expect(open[0]!.occurrenceCount).toBe(3)
  expect(open[0]!.lastSeenAt).not.toBeNull()
  // The duplicate detections never inserted a new row or a duplicate timeline
  // marker — the second/third events coalesced.
  expect(fakeRepo.create).toHaveBeenCalledTimes(1)
  expect(createActivity).toHaveBeenCalledTimes(1)
})

it('distinct targets stay separate and a recurrence after disposition records anew', async () => {
  // Same category (INFRA_TERMINATION) but DIFFERENT targets → two separate rows.
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-1', 'kill -9 111')
  )
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-2', 'kill -9 222')
  )
  const infra = rows.filter(r => r.category === 'INFRA_TERMINATION')
  expect(infra).toHaveLength(2)
  expect(infra.every(r => r.occurrenceCount === 1)).toBe(true)

  // A different CATEGORY also stays its own crossing.
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-3', 'git push origin main')
  )
  const push = rows.filter(r => r.category === 'PUSH_TO_PROTECTED_BRANCH')
  expect(push).toHaveLength(1)

  // A human dispositions that crossing (no longer OPEN)…
  push[0]!.disposition = 'CONFIRMED'

  // …and the SAME action recurs afterwards. A post-resolution recurrence is a
  // new event the human hasn't seen — it must record anew, never be swallowed.
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-4', 'git push origin main')
  )
  const pushAfter = rows.filter(r => r.category === 'PUSH_TO_PROTECTED_BRANCH')
  expect(pushAfter).toHaveLength(2)
  const fresh = pushAfter.find(r => r.disposition == null)
  expect(fresh).toBeDefined()
  expect(fresh!.occurrenceCount).toBe(1)
})

it('the detector stamps a coalescing target per category — file for tampering, command for actions', () => {
  // Action category → the normalized command is the target (same command = same
  // target = coalesces; a different command = a different target = separate).
  const push = detectCrossings({
    toolName: 'Bash',
    filePath: null,
    payload: bash('git push origin main'),
  })
  expect(push[0]!.target).toBe('git push origin main')

  // Hardcoded-secret → the written file is the target (never the secret value).
  const secret = detectCrossings({
    toolName: 'Write',
    filePath: 'lib/config.ts',
    payload: {
      tool_input: {
        file_path: 'lib/config.ts',
        content: 'export const KEY = "AKIAIOSFODNN7EXAMPLE"',
      },
    },
  })
  const secretRow = secret.find(c => c.category === 'HARDCODED_SECRET')
  expect(secretRow!.target).toBe('lib/config.ts')
})

it('an action-class target is the matched forbidden segment, not the whole command line', () => {
  // The forbidden segment (`pkill foo`) is the target — surrounding noise (a
  // trailing echo) is stripped, so two near-identical runs share one target.
  const a = detectCrossings({
    toolName: 'Bash',
    filePath: null,
    payload: bash('pkill foo; echo "run 1"'),
  })
  const b = detectCrossings({
    toolName: 'Bash',
    filePath: null,
    payload: bash('pkill foo; echo "run 2"'),
  })
  const aInfra = a.find(c => c.category === 'INFRA_TERMINATION')
  const bInfra = b.find(c => c.category === 'INFRA_TERMINATION')
  expect(aInfra!.target).toBe('pkill foo')
  expect(bInfra!.target).toBe('pkill foo')
  // …yet the full command is still preserved in the detail for the reviewer.
  expect(aInfra!.detail).toBe('pkill foo; echo "run 1"')
})

it('the same dangerous action amid differing noise coalesces into one open crossing', async () => {
  // Same forbidden segment, different trailing prose each event — the LUM-477
  // dogfood gap: these used to record as N separate crossings. Now they merge.
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-1', 'pkill foo; echo "run 1"')
  )
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-2', 'pkill foo; echo "run 2"')
  )
  await boundaryDetectorService.detectAndRecord(
    bashEvent('t-1', 'e-3', 'pkill foo && echo done')
  )

  const open = rows.filter(
    r => r.category === 'INFRA_TERMINATION' && r.disposition == null
  )
  expect(open).toHaveLength(1)
  expect(open[0]!.target).toBe('pkill foo')
  expect(open[0]!.occurrenceCount).toBe(3)
})
