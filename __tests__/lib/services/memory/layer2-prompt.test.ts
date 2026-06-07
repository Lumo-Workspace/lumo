/**
 * @jest-environment node
 *
 * Sanity checks on the Layer 2 prompt builder. We don't snapshot the whole
 * prompt — both the system block and the examples are large and we want
 * tests that fail for the right reason. Instead we assert specific
 * invariants that the prompt must keep (grouping, dedup signal,
 * recurrence rule, constitution-coverage NOOP) so a regression in any of
 * those is caught.
 */
import { buildLayer2Prompt } from '@/lib/services/memory/layer2-prompt'
import type { Layer2Input } from '@/lib/services/memory/layer2-input'

const baseProject = {
  id: 'proj_1',
  name: 'TestProject',
  workspaceId: 'ws_1',
}

const emptyConstitution: Layer2Input['constitution'] = {
  claudeMd: null,
  agentsMd: null,
}

function mem(overrides: Partial<Layer2Input['taskMemories'][number]>) {
  return {
    id: 'mem_x',
    taskId: 'task_x',
    category: 'TRAP' as const,
    content: { trigger: 't', outcome: 'o' },
    ...overrides,
  }
}

/** Build a Layer2Input with sensible empty defaults, overridable per test. */
function input(overrides: Partial<Layer2Input> = {}): Layer2Input {
  return {
    project: baseProject,
    taskMemories: [],
    existingProjectMemories: [],
    constitution: emptyConstitution,
    ...overrides,
  }
}

describe('buildLayer2Prompt', () => {
  it('groups TASK memories by source taskId so the LLM can see recurrence', () => {
    // The clustering signal Layer 2 cares about is "same lesson appears in
    // multiple different tasks" — the prompt must surface taskId so the
    // model can count distinct sources.
    const { user } = buildLayer2Prompt(
      input({
        taskMemories: [
          mem({ id: 'm_a1', taskId: 'task_a' }),
          mem({ id: 'm_a2', taskId: 'task_a' }),
          mem({ id: 'm_b1', taskId: 'task_b' }),
        ],
      })
    )
    expect(user).toMatch(/task=task_a \(2 memories\)/)
    expect(user).toMatch(/task=task_b \(1 memories\)/)
  })

  it('lists existing PROJECT memories so the LLM can avoid duplicates', () => {
    const { user } = buildLayer2Prompt(
      input({
        taskMemories: [mem({})],
        existingProjectMemories: [
          {
            id: 'proj_mem_1',
            category: 'CONVENTION',
            content: { rule: 'use Zod', scope: 'all schemas' },
          },
        ],
      })
    )
    expect(user).toMatch(/id=proj_mem_1/)
    expect(user).toMatch(/use Zod/)
  })

  it('renders "(none)" sections so the LLM does not see a truncated prompt', () => {
    // Empty sections must be obvious. A blank list with no marker can look
    // like a prompt-rendering bug to the model.
    const { user } = buildLayer2Prompt(input())
    expect(user).toMatch(/Recent TASK-scope memories[^\n]*\n\s*\(none\)/)
    expect(user).toMatch(/Existing PROJECT-scope memories[^\n]*\n\s*\(none\)/)
  })

  it('includes the project name so the LLM has context about which project it is consolidating', () => {
    const { user } = buildLayer2Prompt(
      input({ project: { ...baseProject, name: 'MyCoolProject' } })
    )
    expect(user).toMatch(/MyCoolProject/)
  })

  it('documents the optional summary title field and demonstrates it in an example', () => {
    // summary is the card title (LUM-121); the consolidation prompt must
    // teach the LLM to synthesize one when promoting a memory.
    const { system, user } = buildLayer2Prompt(input())
    expect(system).toMatch(/summary/i)
    expect(system).toMatch(/title/i)
    expect(user).toMatch(/"summary":/)
  })

  it('keeps the recurrence-required rule in the system prompt', () => {
    // This is the most important constraint Layer 2 enforces; if it leaks
    // out of the prompt, the LLM will promote single-task patterns and
    // PROJECT scope will fill with noise.
    const { system } = buildLayer2Prompt(input())
    expect(system).toMatch(/Recurrence is mandatory for ADD/i)
  })

  describe('constitution injection (LUM-137)', () => {
    it('injects CLAUDE.md and AGENTS.md content into the prompt when present', () => {
      const { user } = buildLayer2Prompt(
        input({
          constitution: {
            claudeMd: 'Never use raw SQL — use Prisma for all database access.',
            agentsMd: 'Always open openspec/AGENTS.md for proposals.',
          },
        })
      )
      expect(user).toMatch(/Project constitution \(CLAUDE\.md \/ AGENTS\.md\)/)
      expect(user).toMatch(/## CLAUDE\.md/)
      expect(user).toMatch(/Never use raw SQL/)
      expect(user).toMatch(/## AGENTS\.md/)
      expect(user).toMatch(/Always open openspec\/AGENTS\.md/)
    })

    it('renders the constitution section as "(none)" when both files are absent', () => {
      const { user } = buildLayer2Prompt(input())
      expect(user).toMatch(/Project constitution[^\n]*\n[^\n]*\n\s*\(none\)/)
      // A missing file must not leak a stray "## CLAUDE.md" / "## AGENTS.md"
      // header with no body.
      expect(user).not.toMatch(/## CLAUDE\.md/)
      expect(user).not.toMatch(/## AGENTS\.md/)
    })

    it('renders only the file that is present (partial constitution)', () => {
      const { user } = buildLayer2Prompt(
        input({
          constitution: { claudeMd: 'Use named exports.', agentsMd: null },
        })
      )
      expect(user).toMatch(/## CLAUDE\.md/)
      expect(user).toMatch(/Use named exports\./)
      expect(user).not.toMatch(/## AGENTS\.md/)
    })

    it('instructs the model to NOOP lessons already covered by an existing memory or the constitution', () => {
      // The core LUM-137 behavior: a candidate already documented at PROJECT
      // scope OR in CLAUDE.md/AGENTS.md must be NOOP, never ADD.
      const { system } = buildLayer2Prompt(input())
      expect(system).toMatch(/Never ADD a lesson already covered/i)
      expect(system).toMatch(/project constitution already documents it/i)
      expect(system).toMatch(/redundant by definition/i)
    })
  })

  it('system prompt instructs ADD to cite sourceMemoryIds', () => {
    const { system } = buildLayer2Prompt(input())
    expect(system).toContain('sourceMemoryIds')
  })
})
