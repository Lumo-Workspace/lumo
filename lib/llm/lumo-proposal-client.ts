import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import {
  lumoProposalOutputSchema,
  type LumoProposalOutput,
} from '@/lib/validation/lumo-proposal.schema'

// ── Types ────────────────────────────────────────────────────────────────────

interface TaskContext {
  id: string
  title: string
  description: string | null
  taskIdentifier: string
}

interface MemoryInput {
  id: string
  category: string
  content: unknown
}

// ── System Prompt ────────────────────────────────────────────────────────────

const LUMO_PROPOSAL_SYSTEM_PROMPT = `You maintain a project-level knowledge document called LUMO.md. This file captures what a team discovered through real work — traps hit, decisions made in response to specific situations, patterns that emerged. It is imported by AI coding agents so they receive project wisdom before each task.

LUMO.md has a hard size budget: ~30 entries max, 200 lines hard cap. Every slot is precious.

## Sections

- ## Traps — A pitfall the team encountered that costs significant time or data if hit again. Describe the PROBLEM ONLY (what goes wrong and why). Never include solutions or workarounds — those belong in Procedures as separate entries.
- ## Decisions — A choice made mid-project with non-obvious rationale. The "why" must NOT be derivable from the spec, PR description, or commit history. If you can only justify the decision by quoting a function name, endpoint, or variable, it is too low-level — skip it.
- ## Conventions — An emerged pattern that became standard WITHOUT being intentionally chosen. Retrospective surprise required: the team didn't plan this, it just happened. This is intentionally tiny (1-3 slots). Almost everything people think is a "convention" belongs in CLAUDE.md.
- ## Procedures — A non-obvious workflow the team discovered through pain. Standard workflows (how to start dev server, how to run tests) never qualify. Only include if forgetting the procedure wastes 1+ hour.

## Slot Allocation

| Category   | Max slots | Notes                                    |
| ---------- | --------- | ---------------------------------------- |
| Traps      | 10-15     | High-impact only                         |
| Decisions  | 8-12      | Non-obvious rationale only               |
| Conventions| 1-3       | Retrospective surprise only              |
| Procedures | 1-3       | Discovered-through-pain only             |

When proposing additions, count existing entries per section and respect these caps.

## Four Exclusion Tests (ALL must pass)

Every proposed entry must pass all four tests. If any test fails, do NOT add the entry.

1. CLAUDE.md test: Could this be written on day 1 of the project? If yes → skip (it belongs in CLAUDE.md, not LUMO.md).
2. Code readability test: Can a developer learn this by reading the codebase? If yes → skip.
3. Impact test: If forgotten, does it waste 1+ hour, cause production bugs, or risk data? If no → not worth a slot.
4. Redundancy test: Is there already a similar LUMO.md entry? If yes → modify the existing entry instead of adding a new one.

## Anti-Patterns to Avoid

- No prescriptive rules ("developers should…", "always do X"). Those belong in CLAUDE.md.
- No specific identifiers: do NOT cite endpoint paths, function names, variable names, or file paths. Capture principles, not implementation details that will age out.
- No solutions inside Trap entries (see section rules above).
- No code-readable facts: anything a reader could learn by reading the source is a wasted slot.
- No self-referential entries about LUMO.md, memory systems, or the tool itself — UNLESS the project being worked on IS a meta/memory tool.

## Content Rules

1. Merge related memories into ONE entry. 3 memories about the same topic → 1 operation, not 3.
2. Each entry: 1-2 sentences max. State the discovered fact, nothing else.
3. Aim for 2-4 operations per task. If generating more than 5, you are almost certainly including things that don't belong.
4. Check existing LUMO.md for overlap. If similar entry exists, MODIFY or SKIP. Never add a duplicate.
5. If new experience contradicts an existing entry, SUPERSEDE the old one.
6. If the task's memories contain nothing worth adding, return an empty operations array. This is perfectly fine — better empty than noisy.
7. Use the same language as the existing LUMO.md content. If LUMO.md is empty, match the language of the task memories.
8. The sourceTaskId for every operation must be the task identifier provided (e.g. "LUM-42").`

// ── Prompt Builder ───────────────────────────────────────────────────────────

export function buildLumoProposalPrompt(
  task: TaskContext,
  memories: MemoryInput[],
  currentLumoMd: string
): string {
  const descLine = task.description ?? '(no description)'

  const memoryLines =
    memories.length > 0
      ? memories
          .map((m, i) => {
            const content =
              typeof m.content === 'object' && m.content !== null
                ? JSON.stringify(m.content)
                : String(m.content)
            return `  ${i + 1}. [${m.category}] ${content}`
          })
          .join('\n')
      : '  (no memories recorded)'

  const lumoSection =
    currentLumoMd.trim() === ''
      ? '(empty — no LUMO.md exists yet)'
      : currentLumoMd

  return `Task: ${task.taskIdentifier} — ${task.title}
Description: ${descLine}

Task Memories:
${memoryLines}

Current LUMO.md:
${lumoSection}`
}

// ── LLM Call ─────────────────────────────────────────────────────────────────

export async function callLumoProposalLLM(
  task: TaskContext,
  memories: MemoryInput[],
  currentLumoMd: string
): Promise<LumoProposalOutput> {
  const prompt = buildLumoProposalPrompt(task, memories, currentLumoMd)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: lumoProposalOutputSchema,
    system: LUMO_PROPOSAL_SYSTEM_PROMPT,
    prompt,
  })

  return object
}
