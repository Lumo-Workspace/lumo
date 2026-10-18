/** @jest-environment node */
/**
 * LUM-1230: the memory commands print the 8-char short ref instead of the
 * cuid, accept it (or the old full cuid) as `<memory>`, and relay the
 * server's ambiguity error with its candidates instead of guessing.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: () => ({
    token: 'tok',
    apiUrl: 'https://x',
    workspaceSlug: 'ws',
  }),
}))
jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => undefined,
  AmbiguousSessionError: class extends Error {},
}))
jest.mock('../../cli/src/lib/report-pull', () => ({
  reportPull: jest.fn(async () => undefined),
}))

import { memoryShow } from '@/cli/src/commands/memory-show'
import { memoryDelete } from '@/cli/src/commands/memory-delete'
import { memoryPromote } from '@/cli/src/commands/memory-promote'
import { formatMemoryList } from '@/cli/src/lib/memory-content'
import { formatReviewLearnings } from '@/cli/src/commands/workspace-learnings'
import { reportPull } from '../../cli/src/lib/report-pull'

const FULL = 'cmprcce99003304jrkp5brom5'
const SHORT = 'kp5brom5'
const CARD = {
  id: FULL,
  category: 'TRAP',
  content: { trigger: 'edit lands in main checkout', outcome: 'lost work' },
}

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

let out: jest.SpyInstance
let log: jest.SpyInstance
let err: jest.SpyInstance
beforeEach(() => {
  out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
  log = jest.spyOn(console, 'log').mockImplementation(() => {})
  err = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const printed = () =>
  [...out.mock.calls, ...log.mock.calls].map(c => String(c[0])).join('\n')

describe('lumo memory show <memory>', () => {
  it('sends the short ref, prints the short ref, stamps the pull with the full id', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respond(200, { memory: CARD }))
    expect(await memoryShow(SHORT)).toBeUndefined()
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      `https://x/api/memories/${SHORT}`
    )
    expect(printed()).toMatch(new RegExp(`^${SHORT}  `, 'm'))
    expect(printed()).toMatch(/^Type:\s+TRAP$/m)
    expect(printed()).not.toContain(FULL)
    expect(reportPull).toHaveBeenCalledWith({
      fragmentType: 'MEMORY',
      fragmentId: FULL,
    })
  })

  it('the old full cuid still works', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respond(200, { memory: CARD }))
    expect(await memoryShow(FULL)).toBeUndefined()
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      `https://x/api/memories/${FULL}`
    )
  })

  it('an ambiguous ref prints the server candidates and exits 1', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      respond(409, {
        error: `memory ref "cmprcce99" is ambiguous — it matches 2: ${FULL} (TRAP), cmprcce99003404jrabcdefgh (DECISION). Re-run with one of these full ids`,
      })
    )
    expect(await memoryShow('cmprcce99')).toBe(1)
    const msg = String(err.mock.calls[0]![0])
    expect(msg).toContain('ambiguous')
    expect(msg).toContain(FULL)
    expect(msg).toContain('cmprcce99003404jrabcdefgh')
  })
})

describe('lumo memory delete <memory>', () => {
  it('the envelope names the memory by short ref', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respond(200, { memory: CARD }))
    expect(await memoryDelete(SHORT, {})).toBe(4)
    expect(printed()).toContain(`Will hard-delete memory ${SHORT} [TRAP]`)
    expect(printed()).not.toContain(FULL)
  })
})

describe('lumo memory promote <memory>', () => {
  it('reports the promoted memory by short ref', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respond(200, { memory: { id: FULL } }))
    expect(await memoryPromote(SHORT)).toBeUndefined()
    expect(printed()).toContain(`Promoted ${SHORT} to PROJECT`)
  })

  it('a 409 for an ambiguous ref is not mistaken for "already project-scoped"', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      respond(409, {
        error: 'memory ref "cmprcc" is ambiguous — it matches 2',
      })
    )
    expect(await memoryPromote('cmprcc')).toBe(1)
    expect(String(err.mock.calls[0]![0])).toMatch(/ambiguous/)
  })
})

describe('listings print the short ref, not the cuid', () => {
  it('task/project memory list', () => {
    const text = formatMemoryList([
      {
        id: FULL,
        scope: 'TASK',
        category: 'TRAP',
        content: CARD.content,
        createdByMemberId: null,
      },
    ])
    expect(text.startsWith(`${SHORT}\tTASK`)).toBe(true)
    expect(text).not.toContain(FULL)
  })

  it('workspace learnings', () => {
    const text = formatReviewLearnings(
      {
        learnings: [
          {
            id: FULL,
            ruleId: 'learning',
            repo: 'acme/app',
            pathGlob: null,
            authorLogin: 'bob',
            createdAt: '2026-10-15T00:00:00.000Z',
            repositoryWide: true,
            inProject: true,
            learning: 'Raw SQL in scripts/admin is intentional.',
          },
        ],
      },
      undefined
    )
    expect(text).toContain(`${SHORT}  acme/app`)
    expect(text).not.toContain(FULL)
  })
})
