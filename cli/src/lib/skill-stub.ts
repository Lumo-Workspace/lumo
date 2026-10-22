import * as fs from 'fs'
import * as path from 'path'

/**
 * LUM-1292: the project-level skill stub `lumo init` writes so `/lumo` (Claude
 * Code) and `$lumo` / the skill list (Codex) exist. It is a pointer, not the
 * guide: the guide is served by `lumo skill read` from the installed CLI.
 *
 * FROZEN. Its content never depends on the CLI version, so nothing ever has
 * to keep it in sync. Do not edit LUMO_SKILL_STUB: a change means every repo
 * must re-run `lumo init` (the freeze test in skill-stub.test.ts guards it).
 */
export const LUMO_SKILL_STUB = `---
name: lumo
description: Use for this repository's task tracking in Lumo — creating, finding, filing, picking, starting, resuming or finishing tasks and bugs, a task id (LUM-42, SPEC-12 or any team prefix), the \`lumo\` CLI, test cases, milestones, sprints or team memory. Prefer it over other task trackers here.
---

Run \`lumo skill read\` first and follow it. It prints the current guide for the installed Lumo CLI; read linked files with \`lumo skill read <path>\`.

If \`lumo\` is not found: \`npm install -g @lumoai/cli\`, then \`lumo auth login\`.
`

/** Claude Code reads project skills from here. */
export const CLAUDE_SKILL_STUB_REL = path.join(
  '.claude',
  'skills',
  'lumo',
  'SKILL.md'
)
/** Codex reads project skills from `.agents/skills`. */
export const CODEX_SKILL_STUB_REL = path.join(
  '.agents',
  'skills',
  'lumo',
  'SKILL.md'
)

/**
 * The agent token that owns the stub at `file`: `codex` for the `.agents`
 * one; the `.claude` one belongs to every non-codex token, so it carries
 * `claudeAgent` (the token baked into the repo's settings: `cursor`, …).
 */
export function skillStubAgent(
  root: string,
  file: string,
  claudeAgent = 'claude-code'
): string {
  return path.relative(root, file) === CODEX_SKILL_STUB_REL
    ? 'codex'
    : claudeAgent
}

/**
 * Stub file paths for the repo at `root`: the Claude Code one for any
 * non-codex agent token, the Codex one for `codex`. Without `tokens`, both.
 */
export function skillStubPaths(
  root: string,
  tokens: readonly string[] = ['claude-code', 'codex']
): string[] {
  const out: string[] = []
  if (tokens.some(t => t !== 'codex'))
    out.push(path.join(root, CLAUDE_SKILL_STUB_REL))
  if (tokens.includes('codex')) out.push(path.join(root, CODEX_SKILL_STUB_REL))
  return out
}

/** How a stub file compares with {@link LUMO_SKILL_STUB}. */
export type SkillStubState = 'current' | 'differs' | 'missing'

export function classifySkillStub(file: string): SkillStubState {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return 'missing'
  }
  return text === LUMO_SKILL_STUB ? 'current' : 'differs'
}

/** Write the stub (creating dirs); returns what changed. */
export function installSkillStub(
  file: string
): 'created' | 'updated' | 'unchanged' {
  const state = classifySkillStub(file)
  if (state === 'current') return 'unchanged'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, LUMO_SKILL_STUB)
  return state === 'missing' ? 'created' : 'updated'
}

/**
 * Remove a stub file and, if that leaves it empty, its `lumo` directory.
 * Other skills (siblings of `lumo`) are never touched. Returns false when the
 * file was not there.
 */
export function removeSkillStub(file: string): boolean {
  try {
    fs.unlinkSync(file)
  } catch {
    return false
  }
  try {
    fs.rmdirSync(path.dirname(file)) // only succeeds when empty
  } catch {
    // other files live there: keep the directory
  }
  return true
}
