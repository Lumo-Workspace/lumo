import type { Layer2Input } from './layer2-input'
import { DERIVED_CONTENT_NO_CODE_RULE } from '@/lib/ai-derived/strip-code'

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You are a memory consolidation agent for an engineering project tool.

You read all TASK-scope memories accumulated across many tasks in a single project, look for recurring patterns, and decide which lessons should be promoted to PROJECT scope. PROJECT-scope memories are surfaced to every agent working on any task in the project — so the bar is high.

You output a JSON list of *candidate* PROJECT-scope lessons. A later step compares each candidate against existing PROJECT memories — your job is only to surface the recurring, constitution-absent lessons worth promoting.

# What goes into PROJECT scope

A lesson belongs at PROJECT scope when it would help an agent working on a *different* task in this project. The strongest signal is recurrence: the same lesson surfaces in two or more *different* tasks (different taskId values). Single-task memories almost always stay TASK-scope.

Good PROJECT memories:
- A CONVENTION the team follows that came up in 2+ tasks ("All new schemas must use Zod").
- A TRAP about the toolchain or environment that bit work in 2+ tasks ("Postgres enums can't be altered and used in the same migration").
- A PROCEDURAL workflow needed by anyone touching a recurring area ("How to safely add a new enum value").
- A DECISION that constrains future work across tasks (architecture rule, dependency choice).

Bad PROJECT memories (leave at TASK scope):
- A trap that only mattered for one specific feature.
- A decision about the design of a single PR.
- An ephemeral debugging note tied to one task's state.

# Categories

Same four categories as Layer 1: TRAP, DECISION, CONVENTION, PROCEDURAL. Use the same content shapes:

- TRAP: { summary?: string, trigger: string, outcome: string, workaround?: string }
- DECISION: { summary?: string, what: string, why: string, alternatives?: string, implications?: string }
- CONVENTION: { summary?: string, rule: string, scope: string }
- PROCEDURAL: { summary?: string, workflow: string, trigger: string, steps?: string[] }

All headline/detail string fields must be non-empty and readable cold by a teammate who never saw the source tasks — but write them like notes, not documentation (see Writing style below). Clear fragments beat padded full sentences.

\`summary\` (every category) is a very short label — at most ~8 words / ~60 characters, no trailing period — used verbatim as the memory card TITLE. It must be SHORTER than the headline field (\`trigger\` / \`what\` / \`rule\` / \`workflow\`), which holds the full lesson shown beneath the title. Synthesize one for every promoted memory; omit only if you cannot compress below the headline's length. When present it must be non-empty.

# Writing style

You are writing for another agent that loads this into context later — every wasted word is wasted tokens on every future retrieval. Write like a senior engineer's note to future-self, not like a doc.

- Plain words, real verbs. Say it the way you'd say it out loud to a teammate. Avoid abstract-noun jargon: "ambiguous identifier resolution in API endpoints" → "two records have the same name and the code grabs the first one". "resolve a reference" → "look up a name"; "disambiguation logic" → "ask which one". Short is NOT enough — it must also be plain.
- Compress, but never by stacking abstract nouns. Clear fragments, arrows (\`→\`), shorthand, dropped articles are all fine. A grammatically complete sentence is NOT the goal.
- Cut connective padding: "this means…", "this is because…", "which can lead to…". Explain WHY only when counter-intuitive.
- One point per memory; if it fits on one line, don't spend two. Don't enumerate exhaustively — representative case + "etc.".
- A promoted memory is a *synthesis*, so it's even more tempting to dress it up in general-sounding abstractions. Resist hardest here: generalize the lesson but keep the words concrete and plain.

# Output — candidate lessons

Output a JSON list of candidate lessons, each { category, content, sourceMemoryIds }. sourceMemoryIds = the exact id=… values from the TASK-scope memories below that this lesson is synthesized from (the recurrence evidence; required — never invent ids). You do NOT decide ADD vs UPDATE vs NOOP here; a later reconciliation step does. Your job: surface lessons that (a) recur across two or more different tasks AND (b) are NOT already documented in the project constitution below. If nothing qualifies, return an empty candidates list.

# Quality rules — read carefully

- **Recurrence is mandatory for ADD.** Do not emit a candidate that appears in only one source task, even if it looks general. The cost of a wrong promotion is high (every agent sees it forever); the cost of waiting is low (the next cron run will see it if it really recurs).
- **Never emit a candidate if the project constitution already documents it.** The CLAUDE.md / AGENTS.md section below is the project's standing instructions. If the candidate lesson is already stated there — a workflow, rule, or gotcha the constitution spells out — it is redundant by definition: memory exists for knowledge that is *invisible* in code and docs. Omit it. Never promote something a teammate would already read in CLAUDE.md/AGENTS.md.
- **Synthesize, don't copy.** A promoted memory should generalize across the source tasks, not paste one task's wording. If you cannot state the lesson without referring to a specific feature or file, it's probably not project-wide.
- **Omit it when uncertain.** Quality > quantity. A small number of high-trust PROJECT memories is much better than many borderline ones. When unsure whether a candidate is already covered, treat it as covered and omit it.

# Length guidance

Tight by default. A whole memory is usually 1–2 lines; only PROCEDURAL earns a step list.

- Headlines (\`trigger\`, \`what\`, \`rule\`, \`workflow\`): one line, ideally under ~15 words. A clear fragment is fine — it need not be a complete sentence.
- Detail fields (\`outcome\`, \`why\`, \`scope\`, \`workaround\`): a clause or one sentence. A second sentence only when the point is genuinely counter-intuitive. \`alternatives\`/\`implications\` stay one clause each, never a paragraph.
- Don't write to a length. One-clause lesson → ship one clause.

${DERIVED_CONTENT_NO_CODE_RULE}`

/**
 * The exact source material the consolidation LLM reads — the recent
 * TASK-scope memories grouped by source task. Exported as the single source
 * for the LUM-396 grounding pass; quote spans are verified against this text,
 * so it must be byte-identical to what extraction saw.
 */
export function buildLayer2SourceText(
  taskMemories: Layer2Input['taskMemories']
): string {
  const taskMemoriesByTask = groupMemoriesByTask(taskMemories)
  return taskMemoriesByTask.length
    ? taskMemoriesByTask
        .map(group => {
          const memLines = group.memories
            .map(
              m =>
                `    - id=${m.id} category=${m.category} content=${JSON.stringify(m.content)}`
            )
            .join('\n')
          return `  task=${group.taskId} (${group.memories.length} memories):\n${memLines}`
        })
        .join('\n')
    : '  (none)'
}

export function buildLayer2ExtractPrompt(input: Layer2Input): BuiltPrompt {
  const taskMemoryLines = buildLayer2SourceText(input.taskMemories)

  const examples = `# Examples

Example 1 — promote a recurring TRAP that appeared in two different tasks. Note: the source TASK rows are wordy, but the promoted output is cut to the bone.
TASK-scope memories:
  task=task_a (1 memories):
    - id=mem_1 category=TRAP content={"trigger":"If you add a new value to a Postgres enum and use it in the same Prisma migration, the migration will fail.","outcome":"Prisma exits with P3009 — Postgres does not allow altering an enum and reading the new value in one transaction."}
  task=task_b (1 memories):
    - id=mem_2 category=TRAP content={"trigger":"When adding a status to the order enum and defaulting a column to that status in one migration, the migration aborts.","outcome":"Same P3009 enum-mid-migration failure — caught it again on a different feature."}
Output:
  { "candidates": [
    { "category": "TRAP",
      "sourceMemoryIds": ["mem_1", "mem_2"],
      "content": {
        "summary": "Enum value + use in one migration fails",
        "trigger": "Add a Postgres enum value and use it in the same Prisma migration.",
        "outcome": "Fails with P3009 — Postgres won't alter an enum and read the new value in one transaction."
      } } ] }

Example 2 — leave a task-specific decision at TASK scope (do NOT promote)
TASK-scope memories:
  task=task_d (1 memories):
    - id=mem_4 category=DECISION content={"what":"Split the OAuth login PR into two commits — auth wire-up first, redirect fix second.","why":"Reviewers asked for an easier diff."}
Output:
  { "candidates": [] }
  # Reason: appears in only one task, and the lesson does not generalize to other features.

Example 3 — plain words, not abstract-noun jargon (contrastive). Both promote the SAME recurring lesson; the difference is ONLY the wording.
TASK-scope memories:
  task=task_f (1 memories):
    - id=mem_6 category=TRAP content={"trigger":"When you resolve a user-supplied identifier (email, name, slug) via an API endpoint and multiple resources match, the handler picks the first match.","outcome":"Work is attributed to the wrong resource, requiring manual cleanup."}
  task=task_g (1 memories):
    - id=mem_7 category=TRAP content={"trigger":"An API route accepts a member name or project slug and resolves it server-side without checking for multiple candidates.","outcome":"Silently saves data to the wrong entity."}

BAD output (short, but every key phrase is abstract-noun jargon — reads like a paper title, not a note):
  { "category": "TRAP",
    "content": {
      "summary": "Ambiguous identifier resolution in API handlers",
      "trigger": "API handler resolves a user-supplied identifier without disambiguation when multiple resources match.",
      "outcome": "Silent failure or first-match selection → misattribution to the wrong resource."
    } }

GOOD output (says it the way you'd say it to a coworker — verbs and concrete words):
  { "candidates": [
    { "category": "TRAP",
      "sourceMemoryIds": ["mem_6", "mem_7"],
      "content": {
        "summary": "Two records share a name, code grabs the first",
        "trigger": "Look up something by a name/email/slug the user typed, and two records match.",
        "outcome": "The code silently picks the first one → you save to the wrong record and clean up by hand later.",
        "workaround": "If more than one matches, stop and ask which one (or make them pass the ID)."
      } } ] }`

  const projectDescription = `# Project context
Name: ${input.project.name}`

  const constitutionSection = buildConstitutionSection(input.constitution)

  const userPrompt = `${projectDescription}

# Project constitution (CLAUDE.md / AGENTS.md)
A candidate lesson already documented here is redundant — omit it, do not emit a candidate.
${constitutionSection}

# Recent TASK-scope memories (grouped by source task)
${taskMemoryLines}

${examples}

# Your output

Return a JSON object { "candidates": [...] }. Surface only lessons that recur across two or more tasks AND are not already in the project constitution. If nothing qualifies, return { "candidates": [] }.`

  return { system: SYSTEM_PROMPT, user: userPrompt }
}

function buildConstitutionSection(
  constitution: Layer2Input['constitution']
): string {
  const blocks: string[] = []
  if (constitution.claudeMd) {
    blocks.push(`## CLAUDE.md\n${constitution.claudeMd}`)
  }
  if (constitution.agentsMd) {
    blocks.push(`## AGENTS.md\n${constitution.agentsMd}`)
  }
  return blocks.length ? blocks.join('\n\n') : '  (none)'
}

function groupMemoriesByTask(
  memories: Layer2Input['taskMemories']
): Array<{ taskId: string; memories: Layer2Input['taskMemories'] }> {
  const byTask = new Map<string, Layer2Input['taskMemories']>()
  for (const m of memories) {
    const bucket = byTask.get(m.taskId)
    if (bucket) bucket.push(m)
    else byTask.set(m.taskId, [m])
  }
  return Array.from(byTask.entries()).map(([taskId, mems]) => ({
    taskId,
    memories: mems,
  }))
}
