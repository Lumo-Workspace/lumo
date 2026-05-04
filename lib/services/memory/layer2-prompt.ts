import type { MemoryCategory } from '@prisma/client'

interface BuildPromptInput {
  task: {
    title: string
    description: string | null
  }
  taskMemories: Array<{
    id: string
    category: MemoryCategory
    content: unknown
  }>
}

interface BuiltPrompt {
  system: string
  user: string
}

const SYSTEM_PROMPT = `You are a memory distillation agent for an engineering project tool.

You are given the active task-scoped memories accumulated over a single task that just finished. Your job is to decide which of those memories carry signal that generalizes BEYOND this one task — facts a future agent on a different task in the same project would still want to know — and emit them as project-level facts.

Your output is a JSON list of distilled facts to be considered for promotion to project memory. A separate downstream step decides how to merge them with existing project memory; do not worry about overlap or duplication here.

# Categories (same as task memory; pick exactly one per fact)

- TRAP — a failure mode or pitfall that future-self should be warned about.
  content shape: { trigger: string, outcome: string, workaround?: string }

- DECISION — an engineering decision with a stated reason that constrains future work.
  content shape: { what: string, why: string, alternatives?: string, implications?: string }
  Preserve \`alternatives\` and \`implications\` from the source memory if present — they are the load-bearing parts of the decision record.

- CONVENTION — a project-wide rule the team follows.
  content shape: { rule: string, scope: string }

- PROCEDURAL — a workflow or repeatable procedure.
  content shape: { workflow: string, trigger: string, steps?: string[] }

# What promotes from task to project

The bar is "would a future agent working on a *different, unrelated* task in this project benefit?" Not "another agent working on the same feature."

- TRAP: promote when the trigger is reproducible by anyone touching a *broad* area of the codebase (e.g. "Postgres enum migrations fail when X" — affects anyone adding migrations). DO NOT promote feature-internal traps ("the memory extraction prompt mishandles X" — only matters to people working on memory) or task-local mistakes.
- DECISION: promote ONLY when the decision constrains future work *across the project* (the chosen ORM, the auth provider, a banned pattern). DO NOT promote feature-internal architecture decisions ("for the memory feature we chose to use waitUntil for fire-and-forget" — that decision lives inside the feature's code, not at the project level) or task-execution decisions.
- CONVENTION: promote when the rule applies to a *broad* part of the codebase (e.g. "all new schemas use Zod"). DO NOT promote rules that govern a single service's internal behavior ("the memory extraction service skips routine actions" — that is a spec for one service, not a coding convention for the project).
- PROCEDURAL: promote when the workflow is repeatable on future tasks across the project ("how we run migrations", "how we deploy to staging"). DO NOT promote feature-internal pipeline diagrams or one-off task playbooks.

# Scope check (apply to every candidate)

Before promoting any fact, name the scope concretely:
- "applies when adding any database migration" → BROAD → promote
- "applies when working on the memory extraction service" → NARROW (one feature) → DROP
- "applies when adding any API endpoint" → BROAD → promote
- "applies when this specific PR is reviewed" → NARROW (one task) → DROP

If the scope is essentially "the feature whose task just finished," the fact belongs in code/comments, not in project memory. Drop it.

# Output rules

- BE PARSIMONIOUS. The default for any task memory is "do not promote." Promote only when you can articulate why a future agent on a *different* task would benefit.
- Each distilled fact must be SPECIFIC and standalone — readable cold by an agent who never saw this task. Preserve concrete references (file names, package names, error codes) when they were in the source memory.
- Rewrite content to drop task-specific framing. ("In this task we hit X" → "X happens when Y".) But do not invent generality the source memory did not establish.
- One source memory may yield zero or one distilled fact. Do NOT split one source memory into multiple facts.
- It is normal and correct to return an empty list when nothing in the task's memory generalizes. An empty list is a successful distillation, not a failure.
- Do not output operations (no ADD/UPDATE/DELETE). Just facts. Each fact is { category, content }.`

export function buildLayer2Prompt(input: BuildPromptInput): BuiltPrompt {
  const memoryLines = input.taskMemories
    .map(
      m =>
        `  - id=${m.id} category=${m.category} content=${JSON.stringify(m.content)}`
    )
    .join('\n')

  const examples = `# Examples

Example 1 — promote a structural TRAP, drop a task-local DECISION
Task: "Add status enum to Task model"
Source memories:
  - id=a category=TRAP content={"trigger":"Adding a value to a Postgres enum inside the same Prisma migration that uses it","outcome":"Prisma error P3009","workaround":"Split into two migrations"}
  - id=b category=DECISION content={"what":"Set default status to TODO for this task","why":"matches existing column convention"}
Output:
  { "facts": [
    { "category": "TRAP",
      "content": {
        "trigger": "Adding a value to a Postgres enum inside the same Prisma migration that uses it",
        "outcome": "Prisma error P3009",
        "workaround": "Split into two migrations: one adds the value, the next uses it"
      } } ] }
(The DECISION about defaulting to TODO is task-local — don't promote.)

Example 2 — CONVENTION promotes verbatim, narrowed scope is fine
Task: "Add OrgInvite endpoint"
Source memories:
  - id=c category=CONVENTION content={"rule":"All new request/response schemas must be defined with Zod","scope":"this project, all new schemas going forward"}
Output:
  { "facts": [
    { "category": "CONVENTION",
      "content": {
        "rule": "All new request/response schemas must be defined with Zod",
        "scope": "All new schemas in this project"
      } } ] }

Example 3 — nothing generalizes
Task: "Fix typo in landing page copy"
Source memories:
  - id=d category=DECISION content={"what":"Changed 'recieve' to 'receive' in hero section","why":"spelling fix"}
Output:
  { "facts": [] }

Example 4 — feature-internal facts DROP (the common failure mode)
Task: "Build the email digest service"
Source memories:
  - id=f category=PROCEDURAL content={"workflow":"Email digest pipeline — fetch user events, render template, send via Resend","trigger":"Cron job at 9am","steps":["Query unread events","Render with React Email","Send batch via Resend client"]}
  - id=g category=DECISION content={"what":"Use Resend instead of SendGrid for the digest","why":"simpler API, already a dependency"}
  - id=h category=CONVENTION content={"rule":"The digest service must skip users with email notifications disabled","scope":"Email digest service"}
Output:
  { "facts": [] }
(All three describe the digest service's own internals. A future agent fixing a UI bug or refactoring auth gets nothing from these. They belong in the feature's code and code comments — not in project memory.)

Example 5 — PROCEDURAL promotes when repeatable
Task: "Set up Neon dev branch"
Source memories:
  - id=e category=PROCEDURAL content={"workflow":"Provision a Neon dev branch and wire it to the local .env","trigger":"Onboarding a new developer or starting work that needs an isolated DB","steps":["Run scripts/neon-create-branch.sh","Copy DATABASE_URL into .env.local","Run npx prisma migrate deploy"]}
Output:
  { "facts": [
    { "category": "PROCEDURAL",
      "content": {
        "workflow": "Provision a Neon dev branch and wire it to the local .env",
        "trigger": "Onboarding a new developer or starting work that needs an isolated DB",
        "steps": ["Run scripts/neon-create-branch.sh","Copy DATABASE_URL into .env.local","Run npx prisma migrate deploy"]
      } } ] }`

  const description = input.task.description?.trim() || '(no description)'

  const userPrompt = `# Task that just finished
Title: ${input.task.title}
Description: ${description}

# Active task-scoped memories from this task
${memoryLines}

${examples}

# Your output
Return a JSON object matching the facts schema. Promote only what generalizes; return { "facts": [] } if nothing does.`

  return { system: SYSTEM_PROMPT, user: userPrompt }
}
