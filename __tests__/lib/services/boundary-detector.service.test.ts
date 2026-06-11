import {
  detectCrossings,
  boundaryDetectorService,
  isReversible,
} from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock

const bash = (command: string) => ({
  tool_input: { command },
})

beforeEach(() => {
  jest.clearAllMocks()
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
})

describe('detectCrossings — taxonomy (CLAUDE.md Forbidden, single source)', () => {
  it('flags a push to main / develop, force or not', () => {
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('git push origin main'),
      }).map(c => c.category)
    ).toContain('PUSH_TO_PROTECTED_BRANCH')
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('git push --force origin develop'),
      }).map(c => c.category)
    ).toContain('PUSH_TO_PROTECTED_BRANCH')
  })

  it('does NOT flag a push to a normal feature branch (precision, criterion 6)', () => {
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('git push origin lumo/LUM-426-boundary-detector'),
      })
    ).toEqual([])
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('git push -u origin feature/maintenance'),
      })
    ).toEqual([])
  })

  it('flags a delete under prisma/migrations/', () => {
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('rm prisma/migrations/20240101_init/migration.sql'),
      }).map(c => c.category)
    ).toContain('MIGRATION_FILE_DELETED')
  })

  it('flags a destructive DB command (migrate reset / force-reset)', () => {
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('npx prisma migrate reset --force'),
      }).map(c => c.category)
    ).toContain('DESTRUCTIVE_DB_COMMAND')
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('prisma db push --force-reset'),
      }).map(c => c.category)
    ).toContain('DESTRUCTIVE_DB_COMMAND')
  })

  it('flags a new npm dependency install but not a bare install / ci', () => {
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('npm install left-pad'),
      }).map(c => c.category)
    ).toContain('NEW_NPM_DEPENDENCY')
    // bare install (restore lockfile) and `npm ci` add nothing new → not flagged
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('npm install'),
      })
    ).toEqual([])
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('npm ci'),
      })
    ).toEqual([])
  })

  it('flags a hardcoded secret written into a file (content signal, not a path)', () => {
    expect(
      detectCrossings({
        toolName: 'Write',
        filePath: 'lib/config.ts',
        payload: {
          tool_input: {
            file_path: 'lib/config.ts',
            content: 'export const KEY = "AKIAIOSFODNN7EXAMPLE"',
          },
        },
      }).map(c => c.category)
    ).toContain('HARDCODED_SECRET')
  })

  it('returns [] for an innocuous command', () => {
    expect(
      detectCrossings({
        toolName: 'Bash',
        filePath: null,
        payload: bash('npm test'),
      })
    ).toEqual([])
  })
})

describe('boundaryDetectorService.detectAndRecord', () => {
  it('boundary detector records a marker for a forbidden action', async () => {
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      toolName: 'Bash',
      filePath: null,
      payload: bash('git push origin main --force'),
    })

    // a BoundaryCrossing row is persisted for the matched action…
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        hookEventId: 'evt-1',
        category: 'PUSH_TO_PROTECTED_BRANCH',
      })
    )
    // …and a timeline marker (TaskActivity) is written on the bound task.
    expect(createActivity).toHaveBeenCalledTimes(1)
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        type: 'BOUNDARY_CROSSING_DETECTED',
        payload: expect.objectContaining({
          category: 'PUSH_TO_PROTECTED_BRANCH',
        }),
      })
    )
  })

  it('stamps reversibility from the taxonomy when recording (LUM-435)', async () => {
    // Irreversible: a force-push to main cannot be taken back.
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      toolName: 'Bash',
      filePath: null,
      payload: bash('git push origin main --force'),
    })
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({ reversible: false })
    )

    jest.clearAllMocks()
    createCrossing.mockResolvedValue({ id: 'bc-2' })
    createActivity.mockResolvedValue({ id: 'act-2' })

    // Reversible: a dependency install can be undone (uninstall).
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-2',
      toolName: 'Bash',
      filePath: null,
      payload: bash('npm install date-fns'),
    })
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({ reversible: true })
    )
  })

  it('isReversible: only npm dependency installs are reversible', () => {
    expect(isReversible('NEW_NPM_DEPENDENCY')).toBe(true)
    expect(isReversible('PUSH_TO_PROTECTED_BRANCH')).toBe(false)
    expect(isReversible('MIGRATION_FILE_DELETED')).toBe(false)
    expect(isReversible('HARDCODED_SECRET')).toBe(false)
    expect(isReversible('DESTRUCTIVE_DB_COMMAND')).toBe(false)
  })

  it('records nothing for an innocuous action', async () => {
    await boundaryDetectorService.detectAndRecord({
      taskId: 't-1',
      hookEventId: 'evt-1',
      toolName: 'Bash',
      filePath: null,
      payload: bash('git status'),
    })
    expect(createCrossing).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('is best-effort: a repository failure never throws out of detectAndRecord', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    createCrossing.mockRejectedValue(new Error('db down'))
    await expect(
      boundaryDetectorService.detectAndRecord({
        taskId: 't-1',
        hookEventId: 'evt-1',
        toolName: 'Bash',
        filePath: null,
        payload: bash('git push origin main'),
      })
    ).resolves.toBeUndefined()
    errSpy.mockRestore()
  })
})
