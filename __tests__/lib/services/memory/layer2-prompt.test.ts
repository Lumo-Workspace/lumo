/**
 * @jest-environment node
 *
 * Sanity checks on the Layer 2 prompt builder. We don't snapshot the whole
 * prompt — both the system block and the examples are large and we want
 * tests that fail for the right reason. Instead we assert specific
 * invariants that the prompt must keep (grouping, dedup signal,
 * recurrence rule) so a regression in any of those is caught.
 */
import { buildLayer2Prompt } from '@/lib/services/memory/layer2-prompt'
import type { Layer2Input } from '@/lib/services/memory/layer2-input'

const baseProject = {
  id: 'proj_1',
  name: 'TestProject',
  workspaceId: 'ws_1',
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

describe('buildLayer2Prompt', () => {
  it('groups TASK memories by source taskId so the LLM can see recurrence', () => {
    // The clustering signal Layer 2 cares about is "same lesson appears in
    // multiple different tasks" — the prompt must surface taskId so the
    // model can count distinct sources.
    const input: Layer2Input = {
      project: baseProject,
      taskMemories: [
        mem({ id: 'm_a1', taskId: 'task_a' }),
        mem({ id: 'm_a2', taskId: 'task_a' }),
        mem({ id: 'm_b1', taskId: 'task_b' }),
      ],
      existingProjectMemories: [],
    }
    const { user } = buildLayer2Prompt(input)
    expect(user).toMatch(/task=task_a \(2 memories\)/)
    expect(user).toMatch(/task=task_b \(1 memories\)/)
  })

  it('lists existing PROJECT memories so the LLM can avoid duplicates', () => {
    const input: Layer2Input = {
      project: baseProject,
      taskMemories: [mem({})],
      existingProjectMemories: [
        {
          id: 'proj_mem_1',
          category: 'CONVENTION',
          content: { rule: 'use Zod', scope: 'all schemas' },
        },
      ],
    }
    const { user } = buildLayer2Prompt(input)
    expect(user).toMatch(/id=proj_mem_1/)
    expect(user).toMatch(/use Zod/)
  })

  it('renders "(none)" sections so the LLM does not see a truncated prompt', () => {
    // Empty sections must be obvious. A blank list with no marker can look
    // like a prompt-rendering bug to the model.
    const input: Layer2Input = {
      project: baseProject,
      taskMemories: [],
      existingProjectMemories: [],
    }
    const { user } = buildLayer2Prompt(input)
    expect(user).toMatch(/Recent TASK-scope memories[^\n]*\n\s*\(none\)/)
    expect(user).toMatch(/Existing PROJECT-scope memories[^\n]*\n\s*\(none\)/)
  })

  it('includes the project name so the LLM has context about which project it is consolidating', () => {
    const input: Layer2Input = {
      project: { ...baseProject, name: 'MyCoolProject' },
      taskMemories: [],
      existingProjectMemories: [],
    }
    const { user } = buildLayer2Prompt(input)
    expect(user).toMatch(/MyCoolProject/)
  })

  it('keeps the recurrence-required rule in the system prompt', () => {
    // This is the most important constraint Layer 2 enforces; if it leaks
    // out of the prompt, the LLM will promote single-task patterns and
    // PROJECT scope will fill with noise.
    const { system } = buildLayer2Prompt({
      project: baseProject,
      taskMemories: [],
      existingProjectMemories: [],
    })
    expect(system).toMatch(/Recurrence is mandatory for ADD/i)
  })
})
