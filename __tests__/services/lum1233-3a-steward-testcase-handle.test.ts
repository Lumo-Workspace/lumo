/**
 * LUM-1233 batch 3a — the steward's "run the end-to-end cases" line names the
 * milestone test-case handle the caller's CLI takes: the old two-argument form
 * for an older CLI, `<milestone-slug>/TC<n>` for a current one.
 */
const mockRead = jest.fn()
const mockFindById = jest.fn()
jest.mock('@/lib/services/milestone-close-gate.service', () => ({
  milestoneCloseGateService: { read: (...a: unknown[]) => mockRead(...a) },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { findById: (...a: unknown[]) => mockFindById(...a) },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {},
}))

import { stewardContextService } from '@/lib/services/steward-context.service'
import {
  CURRENT_CLI_COMMANDS,
  LEGACY_CLI_COMMANDS,
  cliCommandNamesForVersion,
} from '@/lib/cli/command-names'

const HELD = {
  held: 1,
  cases: [
    {
      number: 1,
      title: 'Round trip',
      state: 'held',
      reason: 'NOT_RUN',
      unprovenPass: false,
    },
  ],
}

beforeEach(() => {
  mockRead.mockResolvedValue(HELD)
  mockFindById.mockResolvedValue({ id: 'm-1', slug: 'headless-web-cli' })
})

describe('steward test-case run hint', () => {
  it('an older CLI keeps the two-argument form (the default)', async () => {
    const s = await stewardContextService.buildTestCaseSection('m-1')
    expect(s).toContain(
      '`lumo milestone testcase run <milestone> TC<n> --result … --env …`'
    )
    expect(mockFindById).not.toHaveBeenCalled()
    expect(
      await stewardContextService.buildTestCaseSection(
        'm-1',
        LEGACY_CLI_COMMANDS
      )
    ).toBe(s)
  })

  it('a current CLI gets the slug handle', async () => {
    const s = await stewardContextService.buildTestCaseSection(
      'm-1',
      CURRENT_CLI_COMMANDS
    )
    expect(s).toContain(
      '`lumo milestone testcase run headless-web-cli/TC<n> --result … --env …`'
    )
    expect(s).not.toContain('<milestone> TC<n>')
  })

  it('falls back to a placeholder when the slug cannot be read', async () => {
    mockFindById.mockResolvedValue(null)
    const s = await stewardContextService.buildTestCaseSection(
      'm-1',
      CURRENT_CLI_COMMANDS
    )
    expect(s).toContain('`lumo milestone testcase run <milestone>/TC<n>')
  })
})

describe('the two batch floors are independent', () => {
  it('a CLI past only one floor gets only that feature', () => {
    const env = {
      LUMO_READ_ENTRY_MIN_CLI_VERSION: '1.125.5',
      LUMO_TESTCASE_HANDLE_MIN_CLI_VERSION: '1.127.0',
    }
    const names = cliCommandNamesForVersion('1.126.0', env)
    expect(names.current).toBe(true)
    expect(names.testCaseHandle).toBe(false)
    expect(names.taskContext('LUM-1')).toBe('lumo task show LUM-1 --full')
    expect(names.milestoneTestCaseRun('m')).toBe(
      'lumo milestone testcase run <milestone> TC<n> --result … --env …'
    )
    expect(cliCommandNamesForVersion('1.127.0', env)).toBe(CURRENT_CLI_COMMANDS)
    expect(cliCommandNamesForVersion('1.125.4', env)).toBe(LEGACY_CLI_COMMANDS)
  })
})

describe('steward sections pass the CLI command names through', () => {
  it('buildStewardSections hands the names to the test-case section', async () => {
    const spy = jest
      .spyOn(stewardContextService, 'buildMilestoneMemorySection')
      .mockResolvedValue({ section: '', count: 0, memories: [] })
    const { section } = await stewardContextService.buildStewardSections(
      'm-1',
      CURRENT_CLI_COMMANDS
    )
    expect(section).toContain('headless-web-cli/TC<n>')
    spy.mockRestore()
  })
})
