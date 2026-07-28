/**
 * @jest-environment node
 *
 * Pure prompt-shape tests for buildLayer1ExtractPrompt. We don't call the LLM here —
 * just assert that the rendered system+user strings carry the inputs and the
 * style guidance the prompt is supposed to enforce. If a future refactor
 * accidentally drops the plain-language rules or stops embedding the turn
 * events, these tests catch it before a real Stop hook silently regresses.
 */
import { buildLayer1ExtractPrompt } from '@/lib/services/memory/layer1-prompt'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'

function makeBashFailureTurn(): RawEvent[] {
  const baseTime = new Date('2026-05-04T12:00:00Z')
  return [
    {
      id: 'evt_pre',
      type: 'PRE_TOOL_USE',
      toolName: 'Bash',
      payload: {
        tool_input: { command: 'npx prisma migrate dev --name add_status' },
        tool_use_id: 'tool_1',
      },
      createdAt: baseTime,
    },
    {
      id: 'evt_post',
      type: 'POST_TOOL_USE',
      toolName: 'Bash',
      payload: {
        tool_use_id: 'tool_1',
        tool_response: {
          stderr: "P3009: enum can't add value mid-migration",
          exitCode: 1,
        },
      },
      createdAt: new Date(baseTime.getTime() + 1000),
    },
  ]
}

describe('buildLayer1ExtractPrompt', () => {
  const baseTask = {
    title: 'Add status enum migration',
    description: 'Introduce a `status` enum and apply it to the Task table.',
  }

  it('returns both system and user strings', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(typeof out.system).toBe('string')
    expect(typeof out.user).toBe('string')
    expect(out.system.length).toBeGreaterThan(0)
    expect(out.user.length).toBeGreaterThan(0)
  })

  it('embeds task title and description in the user prompt', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.user).toContain(baseTask.title)
    expect(out.user).toContain(baseTask.description)
  })

  it('renders "(no description)" when description is null or blank', () => {
    const nullDesc = buildLayer1ExtractPrompt({
      task: { title: 't', description: null },
      turnEvents: [],
    })
    expect(nullDesc.user).toContain('(no description)')

    const blankDesc = buildLayer1ExtractPrompt({
      task: { title: 't', description: '   ' },
      turnEvents: [],
    })
    expect(blankDesc.user).toContain('(no description)')
  })

  it('does NOT include an "Existing task memories" block (blind extraction)', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.user).not.toContain('Existing task memories')
  })

  it('user prompt mentions candidates framing', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.user).toContain('candidates')
  })

  it('renders "(empty turn)" when turnEvents is empty', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.user).toContain('(empty turn)')
  })

  it('compacts and embeds tool-call events', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: makeBashFailureTurn(),
    })
    // Should not be the empty-turn marker.
    expect(out.user).not.toContain('(empty turn)')
    // Compaction should surface the command and the error fingerprint.
    expect(out.user).toContain('prisma migrate dev')
    expect(out.user).toContain('P3009')
  })

  it('includes the four memory categories in the system prompt', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    for (const cat of ['TRAP', 'DECISION', 'CONVENTION', 'PROCEDURAL']) {
      expect(out.system).toContain(cat)
    }
  })

  it('carries the note-style writing guidance', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    // The style section is the load-bearing change — guard it.
    expect(out.system).toContain('Writing style')
    // Note-style, anti-over-writing direction (the de-AI-flavor change).
    expect(out.system).toMatch(/note to future-self/i)
    expect(out.system).toMatch(/over-writing/i)
    // BAD/GOOD contrast must remain so the model can learn the style.
    expect(out.system).toContain('BAD ')
    expect(out.system).toContain('GOOD ')
  })

  it('explains the TASK vs PROJECT scope distinction in the system prompt', () => {
    // Without this guidance the LLM never produces PROJECT-scope candidates and
    // the cross-task injection block stays empty (regression: LUM-68).
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.system).toMatch(/scope/i)
    expect(out.system).toContain('TASK')
    expect(out.system).toContain('PROJECT')
    // Must describe when each scope applies in plain terms.
    expect(out.system).toMatch(/this (specific )?task/i)
    expect(out.system).toMatch(/any task|every task|all tasks/i)
  })

  it('embeds at least one candidate example that demonstrates scope=PROJECT', () => {
    // Examples teach by example; without a PROJECT instance the LLM tends
    // to default everything to TASK.
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.user).toMatch(/"scope":\s*"PROJECT"/)
  })

  it('examples use candidate shape (not operations shape)', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.user).toContain('# Examples')
    // Good examples wrap output in candidates array
    expect(out.user).toMatch(/"candidates":\s*\[/)
    // No operation type field in good-path examples
    // The examples still contain "ADD" in BAD outputs for contrast — that's fine.
  })

  it('documents the optional summary title field and demonstrates it in an example', () => {
    // summary is the card title (LUM-121); without prompt guidance the LLM
    // never emits it and every card falls back to the long headline field.
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.system).toMatch(/summary/i)
    expect(out.system).toMatch(/title/i)
    expect(out.user).toMatch(/"summary":/)
  })

  it('instructs the model to return { "candidates": [] } for a no-op turn', () => {
    const out = buildLayer1ExtractPrompt({
      task: baseTask,
      turnEvents: [],
    })
    expect(out.user).toMatch(/\{\s*"candidates":\s*\[\]\s*\}/)
  })

  // LUM-316: a trap's fix has ONE home. A one-line fix lives inline on the
  // TRAP as `workaround`; a separate PROCEDURAL is only for a genuine
  // multi-step workflow. Without this guidance the extractor double-writes
  // every trap fix as both a `workaround` AND a redundant PROCEDURAL.
  describe('trap fix lives in one place (LUM-316)', () => {
    it('documents workaround as part of the TRAP content shape', () => {
      const out = buildLayer1ExtractPrompt({
        task: baseTask,
        turnEvents: [],
      })
      // TRAP shape must now advertise the optional workaround field.
      expect(out.system).toMatch(
        /content shape:\s*\{[^}]*trigger[^}]*outcome[^}]*workaround\?/
      )
    })

    it('carries the anti-double-write rule (one fix, one home)', () => {
      const out = buildLayer1ExtractPrompt({
        task: baseTask,
        turnEvents: [],
      })
      expect(out.system).toMatch(/one fix, one home/i)
      expect(out.system).toMatch(/double-write/i)
      // The PROCEDURAL definition must warn against restating a workaround.
      expect(out.system).toMatch(
        /restate[^.]*workaround|workaround[^.]*restate/i
      )
    })

    it('shows a TRAP example with an inline workaround and a double-write BAD case', () => {
      const out = buildLayer1ExtractPrompt({
        task: baseTask,
        turnEvents: [],
      })
      // At least one example TRAP carries the fix inline.
      expect(out.user).toMatch(/"workaround":/)
      // The contrastive BAD example teaches against the double-write.
      expect(out.user).toMatch(/double-write/i)
    })
  })
})
