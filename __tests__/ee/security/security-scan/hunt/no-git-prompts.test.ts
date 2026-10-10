/** @jest-environment node */
jest.mock('ai', () => ({
  generateText: jest.fn(),
  generateObject: jest.fn(),
  tool: (t: unknown) => t,
  stepCountIs: jest.fn(),
  hasToolCall: jest.fn(),
}))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  HUNT_SYSTEM_PROMPT,
  describeRunShellTool,
} from '@/ee/security/llm/security-hunt-client'
import { PLAN_SYSTEM_PROMPT } from '@/ee/security/llm/security-hunt-plan-client'
import { categoriesToTasks } from '@/ee/security/security-scan/hunt/plan-fallback'
import {
  HUNT_CATEGORIES,
  HUNT_STEP_OUTPUT_MAX,
} from '@/ee/security/services/security-hunt.config'

// LUM-787 — PR 1008's t1 was briefed "Across the diff, find …" and spent two
// of its five shell calls on `git diff`: one refused for the unquoted `>` in
// `2>/dev/null`, one because `git` is not allowlisted. The checkout is a
// plain tree at the head sha; the agent has no diff and never will. Every
// prompt that reaches it, or the planner that briefs it, has to say so.
describe('LUM-787 no prompt sends the agent after git or a diff', () => {
  it('the fallback planner briefs every category against the touched files, never "across the diff"', () => {
    for (const category of HUNT_CATEGORIES) {
      const [task] = categoriesToTasks([category])
      expect(task!.objective).not.toMatch(/across the diff/i)
      expect(task!.objective).not.toMatch(/\bdiff\b/i)
      // Where the agent's only view of "what changed" actually is.
      expect(task!.objective).toContain('Starting points')
      expect(task!.objective).toContain('files this pull request touched')
    }
  })

  it('the plan system prompt tells the planner the analyst has a plain head-sha checkout', () => {
    expect(PLAN_SYSTEM_PROMPT).toContain('no git, no diff and no history')
    // The forbidden phrasing is named so the model does not produce it.
    expect(PLAN_SYSTEM_PROMPT).toContain('"across the diff"')
    expect(PLAN_SYSTEM_PROMPT).toContain(
      'name the files and symbols from the touched-files list instead'
    )
  })

  it('the hunt system prompt says the checkout has no history to diff against, where the change is listed, and what git may do', () => {
    expect(HUNT_SYSTEM_PROMPT).toContain(
      'depth-1 clone at the head sha: one commit of history, so there is nothing earlier to diff against'
    )
    expect(HUNT_SYSTEM_PROMPT).toContain('listed under Starting points')
    // LUM-787 follow-up (user decision): git is allowed, read-only only; the
    // model is told rather than left to try `git diff HEAD~1` and fail.
    expect(HUNT_SYSTEM_PROMPT).toContain(
      '`git` is allowed for read-only subcommands only'
    )
    expect(HUNT_SYSTEM_PROMPT).toContain(
      'redirections other than `2>/dev/null` / `2>&1` are refused'
    )
    // …and tells the model its allowance and how to spend it.
    expect(HUNT_SYSTEM_PROMPT).toContain('four to six tool steps')
    expect(HUNT_SYSTEM_PROMPT).toContain('never whole files')
    // Wildcards: allowed where an expanded name cannot become a flag, quoted
    // elsewhere — and the Next.js `[id]` path shape is named.
    expect(HUNT_SYSTEM_PROMPT).toContain(
      'Unquoted wildcards (`lib/*.ts`) are fine for cat, head, tail, wc, ls, grep, echo, cut and uniq'
    )
    expect(HUNT_SYSTEM_PROMPT).toContain('quote paths that contain `[` or `]`')
    expect(HUNT_SYSTEM_PROMPT).toContain(
      'Call submit_candidates yourself before the allowance runs out'
    )
  })

  it('the run_shell description states the redirection, wildcard, git and awk rules and names the per-step ceiling', () => {
    const description = describeRunShellTool()
    expect(description).toContain(
      'the only redirections allowed are `2>/dev/null` and `2>&1`'
    )
    expect(description).toContain('`git` is read-only (log, show, blame')
    expect(description).toContain('depth-1 clone at the head sha')
    expect(description).toContain('`awk` scripts go in single quotes')
    expect(description).toContain(
      `share a ceiling of ${HUNT_STEP_OUTPUT_MAX} characters`
    )
    expect(description).toContain('no -exec, -delete or file-writing actions')
    expect(description).toContain('rg --files <dir>')
    expect(description).toContain('`ls <dir>`')
    expect(description).toContain(
      'Unquoted wildcards (`*`, `?`, `[…]`) are allowed only for cat, head, tail, wc, ls, grep, echo, cut and uniq'
    )
    expect(description).toContain('Quote any path that contains `[` or `]`')
  })
})
