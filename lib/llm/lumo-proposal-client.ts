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

Rules:
1. Only propose changes with project-level value. A one-off typo fix is not worth recording. A recurring pitfall that would burn another developer IS worth recording.
2. Check existing LUMO.md content for overlap. If a similar entry already exists, either SKIP (no operation) or MODIFY to improve it. Never add a duplicate.
3. If new experience contradicts an existing entry, SUPERSEDE the old one.
4. Each bullet should be concise (1-2 sentences), stating WHAT and WHY.
5. Every operation must include a rationale explaining your reasoning.
6. If the task's memories contain nothing worth adding to project knowledge, return an empty operations array. This is perfectly fine.
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
