/**
 * @jest-environment node
 *
 * LUM-779 — the post-tool-use hook folds `_lumo_deleted_test_files` into the
 * body for a Bash command that looks like a delete, so the server can judge
 * TEST_FILE_DELETED by what is actually missing instead of by command text.
 * The probe itself is covered by git-deleted-test-files.test.ts; here it is
 * mocked so the assertions are about WHEN it runs and WHAT reaches the wire.
 */
jest.mock('@/cli/src/lib/config', () => ({ readCredentials: jest.fn() }))
jest.mock('@/cli/src/lib/git-deleted-test-files', () => {
  const actual = jest.requireActual('@/cli/src/lib/git-deleted-test-files')
  return { ...actual, collectDeletedTestFiles: jest.fn() }
})

import { readCredentials } from '@/cli/src/lib/config'
import { collectDeletedTestFiles } from '@/cli/src/lib/git-deleted-test-files'
import {
  runHookWithBody,
  augmentBodyWithDeletedTestFiles,
} from '@/cli/src/lib/hook-runner'

const mockCreds = readCredentials as jest.Mock
const mockProbe = collectDeletedTestFiles as jest.Mock
const fetchMock = jest.fn()

const bashBody = (command: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    session_id: 's1',
    cwd: '/repo/here',
    tool_name: 'Bash',
    tool_input: { command },
    ...extra,
  })

function sentBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[0]
  expect(call).toBeDefined()
  return JSON.parse(call![1].body as string)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreds.mockReturnValue({ token: 't', apiUrl: 'https://api.example.com' })
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  global.fetch = fetchMock as unknown as typeof fetch
  mockProbe.mockReturnValue([])
})

describe('post-tool-use hook — deleted test files field (LUM-779)', () => {
  it('probes local git in the payload cwd for a Bash rm and sends the list', async () => {
    mockProbe.mockReturnValue(['__tests__/a.test.ts'])
    await runHookWithBody('post-tool-use', bashBody('rm __tests__/a.test.ts'))
    expect(mockProbe).toHaveBeenCalledTimes(1)
    expect(mockProbe).toHaveBeenCalledWith('/repo/here')
    expect(sentBody()['_lumo_deleted_test_files']).toEqual([
      '__tests__/a.test.ts',
    ])
  })

  it('sends an EMPTY list when the probe ran and nothing tracked is missing — empty is a verdict, not silence', async () => {
    mockProbe.mockReturnValue([])
    await runHookWithBody(
      'post-tool-use',
      bashBody('rm -f __tests__/zz-probe.test.ts; git status')
    )
    expect(sentBody()['_lumo_deleted_test_files']).toEqual([])
  })

  it('does not probe, and sends no field, for a Bash command with no rm token', async () => {
    await runHookWithBody(
      'post-tool-use',
      bashBody('npx jest __tests__/a.test.ts')
    )
    expect(mockProbe).not.toHaveBeenCalled()
    expect(sentBody()).not.toHaveProperty('_lumo_deleted_test_files')
  })

  it('does not probe for a non-Bash tool even when its input carries a `command` field with rm', async () => {
    await runHookWithBody(
      'post-tool-use',
      JSON.stringify({
        session_id: 's1',
        cwd: '/repo/here',
        tool_name: 'mcp__sandbox__run',
        tool_input: { command: 'rm __tests__/a.test.ts' },
      })
    )
    expect(mockProbe).not.toHaveBeenCalled()
    expect(sentBody()).not.toHaveProperty('_lumo_deleted_test_files')
  })

  it('does not probe on any other hook path (pre-tool-use sees the same Bash payload)', async () => {
    await runHookWithBody('pre-tool-use', bashBody('rm __tests__/a.test.ts'))
    expect(mockProbe).not.toHaveBeenCalled()
    expect(sentBody()).not.toHaveProperty('_lumo_deleted_test_files')
  })

  it('sends no field when git could not answer (probe returns null) — the server then fails closed', async () => {
    mockProbe.mockReturnValue(null)
    await runHookWithBody('post-tool-use', bashBody('rm __tests__/a.test.ts'))
    expect(mockProbe).toHaveBeenCalledTimes(1)
    expect(sentBody()).not.toHaveProperty('_lumo_deleted_test_files')
  })

  it('falls back to process.cwd() when the payload carries no cwd', async () => {
    await runHookWithBody(
      'post-tool-use',
      JSON.stringify({
        session_id: 's1',
        tool_name: 'Bash',
        tool_input: { command: 'rm __tests__/a.test.ts' },
      })
    )
    expect(mockProbe).toHaveBeenCalledWith(process.cwd())
  })

  it('never throws: a probe that throws leaves the body unchanged and the hook still resolves', async () => {
    mockProbe.mockImplementation(() => {
      throw new Error('git exploded')
    })
    await expect(
      runHookWithBody('post-tool-use', bashBody('rm __tests__/a.test.ts'))
    ).resolves.toBeUndefined()
    expect(sentBody()).not.toHaveProperty('_lumo_deleted_test_files')
  })
})

describe('augmentBodyWithDeletedTestFiles (pure)', () => {
  it('returns the body unchanged when it is not valid JSON', () => {
    expect(
      augmentBodyWithDeletedTestFiles('post-tool-use', '{not json', () => [])
    ).toBe('{not json')
  })

  it('keeps every other field of the body intact', () => {
    const out = JSON.parse(
      augmentBodyWithDeletedTestFiles(
        'post-tool-use',
        bashBody('rm __tests__/a.test.ts', { _lumo_usage: { inputTokens: 1 } }),
        () => ['__tests__/a.test.ts']
      )
    )
    expect(out.tool_input).toEqual({ command: 'rm __tests__/a.test.ts' })
    expect(out._lumo_usage).toEqual({ inputTokens: 1 })
    expect(out._lumo_deleted_test_files).toEqual(['__tests__/a.test.ts'])
  })
})
