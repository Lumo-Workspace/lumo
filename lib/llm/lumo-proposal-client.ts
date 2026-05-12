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

const LUMO_PROPOSAL_SYSTEM_PROMPT = `You maintain a project-level knowledge document called LUMO.md. This file is automatically imported by AI coding agents (via CLAUDE.md) so they receive accumulated project wisdom before starting work.

LUMO.md is organized into sections, each containing bullet points:
- ## Traps — pitfalls, gotchas, things that broke unexpectedly
- ## Decisions — key engineering decisions and their rationale
- ## Conventions — coding patterns, naming rules, architectural norms
- ## Procedures — step-by-step workflows, deployment processes, testing protocols

Your job: given a completed task's memories (lessons learned during that task), propose structured operations to update LUMO.md.

Quality bar — be EXTREMELY selective:
1. Only record knowledge that is NOT obvious from reading the code or spec. Implementation details visible in the source code are worthless here. Self-check: "Could a developer learn this by reading the source code?" If yes, skip it.
2. Merge related memories into ONE entry. If 3 memories are about the same topic, produce 1 operation, not 3.
3. Each entry must be 1-2 sentences max. State the conclusion and the reason, nothing else. No step-by-step instructions, no implementation walkthroughs.
4. Aim for 3-6 operations per task. Most tasks produce 2-4 entries. If you're generating more than 6, you are almost certainly including things that don't belong.
5. Procedures should be rare — only include a procedure if the workflow is non-obvious and cannot be found in the codebase. "How to implement X" is NEVER a valid procedure; the code shows that.

Section-specific rules:
6. Traps describe PROBLEMS ONLY — what goes wrong and why. Never include the solution in a Trap. If there is a workaround, it belongs in Procedures as a separate entry.
7. Decisions state PRINCIPLES, not specific identifiers. BAD: "API uses POST /api/tasks/[id]/lumo-proposals". GOOD: "Sync uses a two-call API to decouple generation from application." If you can only state a decision by quoting a function name, endpoint path, or variable name, it is too low-level — skip it.

Content rules:
8. Check existing LUMO.md content for overlap. If a similar entry already exists, either SKIP or MODIFY. Never add a duplicate.
9. If new experience contradicts an existing entry, SUPERSEDE the old one.
10. If the task's memories contain nothing worth adding, return an empty operations array. This is perfectly fine — better empty than noisy.
11. Use the same language as the existing LUMO.md content. If LUMO.md is empty, match the language of the task memories.
12. The sourceTaskId for every operation must be the task identifier provided (e.g. "LUM-42").`

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
