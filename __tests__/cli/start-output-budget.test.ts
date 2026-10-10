/**
 * @jest-environment node
 */
// LUM-844: start-of-session output budget. The fixture is the real LUM-844
// payload captured before the change (`attach-before.txt` / `context-before.txt`
// are the verbatim CLI output). The budgets are absolute numbers derived from
// those baselines — never a comparison against origin/main.
import fs from 'fs'
import path from 'path'
import type { RenderableMemory } from '@/lib/memory/render'

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'lum844')
const fixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, 'lum844-start.fixture.json'), 'utf8')
) as {
  sessionId: string
  now: string
  task: Record<string, unknown> & { identifier: string; title: string }
  criteriaSection: string
  testCaseSection: string
  lineageSection: string
  memories: RenderableMemory[]
  sessions: unknown[]
  attachTrailer: string
}
const attachBefore = fs.readFileSync(
  path.join(FIXTURE_DIR, 'attach-before.txt'),
  'utf8'
)
const contextBefore = fs.readFileSync(
  path.join(FIXTURE_DIR, 'context-before.txt'),
  'utf8'
)

// The sync + worktree trailer is output this task doesn't touch — replay it
// from the fixture so the attach measurement stays like-for-like.
const [, mockWorktreeBlock = ''] = fixture.attachTrailer.split('\n\n')
jest.mock('@/cli/src/lib/worktree-attach', () => ({
  attachWorktreeStep: jest.fn(() => {
    console.log('')
    console.log(mockWorktreeBlock.trimEnd())
  }),
}))
jest.mock('@/cli/src/lib/resolve-project', () => ({
  resolveBoundProjectId: jest.fn(async () => ({ ok: true, id: 'p-1' })),
}))
jest.mock('@/cli/src/lib/memory-auto', () => ({
  autoDownsyncOnAttach: jest.fn(async () => ({
    skipped: false,
    added: 333,
    updated: 0,
    removed: 0,
    anchorCandidates: 8,
  })),
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 't',
    apiUrl: 'https://x',
    workspaceSlug: 'lumo',
  })),
}))

import {
  renderMemorySection,
  renderMemoryIndexBlock,
  wrapUntrustedMemory,
} from '@/lib/memory/render'
import { sessionAttach } from '@/cli/src/commands/session-attach'
import { formatTaskContextMarkdown } from '@/cli/src/commands/task-context'
import {
  TASK_DESCRIPTION_FENCE,
  TASK_DESCRIPTION_PREAMBLE,
  fenceUntrustedText,
  renderSessionRecapFence,
} from '@/shared/src/untrusted-fence'

// UTF-8 bytes (what `wc -c` reports) — the unit the baselines were recorded in.
const chars = (s: string) => Buffer.byteLength(s, 'utf8')
const BASE_ATTACH = 5261
const BASE_CONTEXT = 7321

const memorySection = wrapUntrustedMemory(renderMemorySection(fixture.memories))
const memoryIndexSection = renderMemoryIndexBlock(
  fixture.memories,
  fixture.task.identifier
)
const contextPayload = {
  task: fixture.task,
  testCaseSection: fixture.testCaseSection,
  memorySection,
  memoryIndexSection,
  lineageSection: fixture.lineageSection,
  sessions: fixture.sessions,
}
const NOW = new Date(fixture.now)

function renderContext(opts: { full?: boolean; currentSessionId?: string }) {
  return formatTaskContextMarkdown(contextPayload as never, NOW, opts)
}

async function renderAttach(extra: Record<string, unknown> = {}) {
  const logs: string[] = []
  const logSpy = jest
    .spyOn(console, 'log')
    .mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
  const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      taskId: 't-844',
      taskIdentifier: fixture.task.identifier,
      taskTitle: fixture.task.title,
      retaggedEventCount: 0,
      testCaseSection: fixture.testCaseSection,
      memorySection,
      ...extra,
    }),
  } as Response)
  const prev = process.env.CLAUDE_CODE_SESSION_ID
  process.env.CLAUDE_CODE_SESSION_ID = fixture.sessionId
  try {
    await sessionAttach(fixture.task.identifier, { worktree: false })
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID
    else process.env.CLAUDE_CODE_SESSION_ID = prev
    logSpy.mockRestore()
    fetchSpy.mockRestore()
  }
  return logs.map(l => l + '\n').join('')
}

describe('LUM-844 start-of-session output budget', () => {
  it('fixture faithfully reproduces the recorded baseline', async () => {
    expect(chars(attachBefore)).toBe(BASE_ATTACH)
    expect(chars(contextBefore)).toBe(BASE_CONTEXT)
    // Structured memories re-render byte-identically to what was printed.
    expect(attachBefore).toContain(memorySection)
    // --full with the caller's session still listed = the old output exactly,
    // minus the acceptance-criteria block LUM-942 removed from the payload.
    const withoutCriteria = contextBefore.replace(
      fixture.criteriaSection.trimEnd() + '\n\n',
      ''
    )
    expect(withoutCriteria).not.toBe(contextBefore)
    // LUM-998: the description now prints inside its own fence instead of a
    // bare `**Description**:` line; everything else is byte-identical.
    const description = String(fixture.task.descriptionMarkdown)
    const bareLine = `**Description**: ${description}\n\n`
    expect(withoutCriteria).toContain(bareLine)
    const fenced = withoutCriteria.replace(
      bareLine,
      `\n${fenceUntrustedText(TASK_DESCRIPTION_FENCE, TASK_DESCRIPTION_PREAMBLE, description)}\n\n`
    )
    // LUM-1067: the session recaps print inside one untrusted fence (this
    // replaced LUM-1003's one-line note); the recap lines themselves are
    // unchanged.
    const noted = fenced.replace(
      /(## Previous Sessions \(\d+\)\n\n)((?:### Session[^\n]*\n(?:[^\n]+\n)*\n)+)/,
      (_m, head: string, body: string) =>
        `${head}${renderSessionRecapFence(body)}\n\n`
    )
    expect(noted).not.toBe(fenced)
    expect(renderContext({ full: true })).toBe(noted)
  })

  it('attach output on the LUM-844 fixture is at most half the baseline', async () => {
    const out = await renderAttach()
    expect(chars(out)).toBeLessThanOrEqual(Math.floor(BASE_ATTACH / 2))
  })

  it('context output and the attach plus context pair on the LUM-844 fixture fit the budget', async () => {
    const attach = await renderAttach()
    const context = renderContext({ currentSessionId: fixture.sessionId })
    expect(chars(context)).toBeLessThanOrEqual(4760)
    expect(chars(attach) + chars(context)).toBeLessThanOrEqual(
      Math.floor((BASE_ATTACH + BASE_CONTEXT) / 2)
    )
  })

  it('start outputs keep every correctness signal on the LUM-844 fixture', async () => {
    const attach = await renderAttach({
      blockerWarningSection: '## ⚠ Blocked by LUM-1 (IN_PROGRESS)',
      securityFindingsSection: '## Security findings (1 undispositioned)',
    })
    expect(attach).toContain('## ⚠ Blocked by LUM-1 (IN_PROGRESS)')
    expect(attach).toContain('## Security findings (1 undispositioned)')
    expect(attach).toContain('lumo task context LUM-844')

    const context = renderContext({ currentSessionId: fixture.sessionId })
    expect(context).toContain(String(fixture.task.descriptionMarkdown))
    expect(context).toContain(fixture.testCaseSection)
    expect(context).toContain('<untrusted-team-memory>')
    expect(context).toContain('lumo memory show <id>')
    for (const m of fixture.memories) {
      expect(context).toContain(`· ${m.id}`)
    }
    // Traps still lead, as in the full rendering.
    expect(context.indexOf('- Trap ')).toBeLessThan(
      context.indexOf('- Decision ')
    )
  })

  it('context full flag restores full memory and the lineage footer', () => {
    const def = renderContext({})
    expect(def).not.toContain('Workaround:')
    expect(def).not.toContain('## Memory usefulness')
    expect(def).toContain('lumo task context LUM-844 --full')

    const full = renderContext({ full: true })
    expect(full).toContain(memorySection)
    expect(full).toContain('Workaround:')
    expect(full).toContain('Why:')
    expect(full).toContain('Steps:')
    expect(full).toContain('## Memory usefulness · judged-used track record')

    // An older server without memoryIndexSection: the full section prints.
    const legacy = formatTaskContextMarkdown(
      { ...contextPayload, memoryIndexSection: undefined } as never,
      NOW
    )
    expect(legacy).toContain(memorySection)
  })
})
