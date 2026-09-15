/** @jest-environment node */
jest.mock('ai', () => ({
  generateText: jest.fn(),
  generateObject: jest.fn(),
  tool: (t: unknown) => t,
  stepCountIs: jest.fn(),
  hasToolCall: jest.fn(),
}))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  HUNT_SYSTEM_PROMPT,
  describeRunShellTool,
} from '@/lib/llm/security-hunt-client'
import { PLAN_SYSTEM_PROMPT } from '@/lib/llm/security-hunt-plan-client'
import { categoriesToTasks } from '@/lib/security-scan/hunt/plan-fallback'
import {
  HUNT_CATEGORIES,
  HUNT_STEP_OUTPUT_MAX,
} from '@/lib/services/security-hunt.config'

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

  it('the hunt system prompt says there is no git and no diff, and where the change is listed', () => {
    expect(HUNT_SYSTEM_PROMPT).toContain(
      'there is no git, no diff and no history in it'
    )
    expect(HUNT_SYSTEM_PROMPT).toContain('never run git')
    expect(HUNT_SYSTEM_PROMPT).toContain('never redirect')
    expect(HUNT_SYSTEM_PROMPT).toContain('listed under Starting points')
    // …and tells the model its allowance and how to spend it.
    expect(HUNT_SYSTEM_PROMPT).toContain('four to six tool steps')
    expect(HUNT_SYSTEM_PROMPT).toContain('never whole files')
    // The replay showed what "one or two commands per step" buys: `;`-chained
    // `echo` and `ls`, both refused.
    expect(HUNT_SYSTEM_PROMPT).toContain('never chain with `;` or `&&`')
    expect(HUNT_SYSTEM_PROMPT).toContain('there is no git and no awk')
    // 4 of the first 60 production scans' 28 refusals were unquoted `[` in
    // Next.js dynamic-route paths — legitimate paths in this repo.
    expect(HUNT_SYSTEM_PROMPT).toContain('Quote paths that contain `[` or `]`')
    // The first production rerun (PR 1014): 4 of 6 refusals were unquoted
    // `*` globs, a shape the prompt had never mentioned.
    expect(HUNT_SYSTEM_PROMPT).toContain('Never write an unquoted wildcard')
    expect(HUNT_SYSTEM_PROMPT).toContain(
      'Call submit_candidates yourself before the allowance runs out'
    )
  })

  it('the run_shell description refuses git and redirections up front and names the per-step ceiling', () => {
    const description = describeRunShellTool()
    expect(description).toContain('git, npm and shell redirections')
    expect(description).toContain('there is no git and no diff in the checkout')
    expect(description).toContain(
      `share a ceiling of ${HUNT_STEP_OUTPUT_MAX} characters`
    )
    expect(description).toContain('Do not chain commands with `;` or `&&`')
    expect(description).toContain('Never use an unquoted shell wildcard')
    // …and a listing affordance, so `ls`/`find` have a sanctioned substitute.
    expect(description).toContain('rg --files <dir>')
    // LUM-787 follow-up (user decision): `ls` and `find` are allowlisted, so
    // the description offers them — and says what `find` may not do.
    expect(description).toContain('`ls <dir>`')
    expect(description).toContain('`find <dir> -name "*.ts"`')
    expect(description).toContain('no -exec, -delete or file-writing actions')
    expect(description).toContain('Quote any path that contains `[` or `]`')
  })
})
