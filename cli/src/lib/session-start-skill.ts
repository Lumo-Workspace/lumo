import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { configDir } from './config'
import { detectInstalledSkills } from './install-locations'
import { skillCopyStatus, type SkillCopyStatus } from './skill-copies'

/**
 * LUM-1111 — what the SessionStart status line says about the Lumo skill:
 * the version of the copy this session loads, a hint when that copy is
 * behind the CLI, and a restart hint when the CLI changed under a running
 * session. Purely local (no network), and every entry point swallows its own
 * failures — a broken probe leaves the status line exactly as before.
 */

/** Skill-dir agent tokens, in the order the agent resolves a name clash. */
const LOAD_ORDER: Record<string, readonly ('user' | 'project')[]> = {
  // Claude Code: personal skills override project skills of the same name.
  'claude-code': ['user', 'project'],
  // Codex lists repo (`.agents/skills`) locations before the user's.
  codex: ['project', 'user'],
}

/** Map a hook `--agent` enum (null = Claude Code default) to a skill-dir token. */
export function skillAgentFor(agentEnum: string | null): string | null {
  if (agentEnum === null || agentEnum === 'CLAUDE_CODE') return 'claude-code'
  if (agentEnum === 'CODEX') return 'codex'
  return null
}

export interface SessionSkillOptions {
  /** Skill-dir agent token (`claude-code` / `codex`). */
  agent: string
  cliVersion: string
  homeDir: string
  /** The session's working directory (its repo root holds project skills). */
  cwd: string
}

/** The skill copy the session will load, or null when there is none. */
export function sessionSkillCopy(
  opts: SessionSkillOptions
): SkillCopyStatus | null {
  const order = LOAD_ORDER[opts.agent]
  if (!order) return null
  const mine = detectInstalledSkills({
    homeDir: opts.homeDir,
    cwd: opts.cwd,
  }).filter(l => l.agent === opts.agent)
  for (const scope of order) {
    const loc = mine.find(l => l.scope === scope)
    if (loc) return skillCopyStatus(loc, opts.cliVersion)
  }
  return null
}

/** `skill 1.2.3` — plus `modified` / `source` when the copy is not managed. */
export function skillTag(copy: SkillCopyStatus): string {
  if (copy.state === 'source') return 'skill source'
  const v = copy.version ? `skill ${copy.version}` : 'skill'
  return copy.state === 'modified' ? `${v} modified` : v
}

/**
 * Only a managed copy older than the CLI gets a hint: `lumo skill update`
 * refreshes exactly that. Newer, modified and source copies get none.
 */
export function skillVersionNote(
  copy: SkillCopyStatus,
  cliVersion: string
): string | null {
  if (copy.state !== 'behind') return null
  return `skill ${copy.version ?? '?'} is older than lumo ${cliVersion} — run \`lumo skill update\`, then restart the session`
}

const SESSION_VERSIONS_FILE = 'session-cli-versions.json'
/** Sessions remembered for the restart hint; the oldest are dropped. */
const MAX_SESSIONS = 200

export function sessionVersionsPath(): string {
  return path.join(configDir(), SESSION_VERSIONS_FILE)
}

/**
 * Session ids come from the agent, so they live in a Map (an id such as
 * `__proto__` is just another key), serialized as `[id, version]` pairs in
 * insertion order — oldest first.
 */
function readSessionVersions(file: string): Map<string, string> {
  const out = new Map<string, string>()
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(parsed))
      for (const pair of parsed)
        if (
          Array.isArray(pair) &&
          typeof pair[0] === 'string' &&
          typeof pair[1] === 'string'
        )
          out.set(pair[0], pair[1])
  } catch {
    // missing or unreadable: start fresh
  }
  return out
}

/** Write via a temp file + rename so a concurrent reader never sees half a file. */
function writeSessionVersions(file: string, seen: Map<string, string>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify([...seen]) + '\n')
  fs.renameSync(tmp, file)
}

/**
 * Remember which CLI version served this session's SessionStart. When a
 * later SessionStart of the same session (resume / clear / compact) runs
 * under a different CLI, the skill text already in the conversation predates
 * the upgrade: say so once. Concurrent session starts may drop each other's
 * entry (last rename wins) — that only costs a hint. Never throws.
 */
export function cliUpgradeNote(
  sessionId: string,
  cliVersion: string,
  file: string = sessionVersionsPath()
): string | null {
  try {
    const seen = readSessionVersions(file)
    const prev = seen.get(sessionId)
    if (prev === cliVersion) return null
    seen.delete(sessionId)
    seen.set(sessionId, cliVersion)
    for (const k of [...seen.keys()].slice(
      0,
      Math.max(0, seen.size - MAX_SESSIONS)
    ))
      seen.delete(k)
    writeSessionVersions(file, seen)
    if (prev === undefined) return null
    return `lumo upgraded ${prev} → ${cliVersion} since this session started — restart the session to load the new skill`
  } catch {
    return null
  }
}

export interface SessionStartSkillInfo {
  /** Field for the identity segment (`skill 1.2.3`), or null to add nothing. */
  tag: string | null
  /** Extra ` | …` segments for the end of the status line. */
  notes: string[]
}

export interface SessionStartSkillInput {
  /** Normalized hook agent enum; null means the Claude Code default. */
  agentEnum: string | null
  cliVersion: string | null
  sessionId: string | null
  cwd: string
  homeDir?: string
  /** Where the restart-hint state lives (defaults to ~/.lumo). */
  sessionVersionsFile?: string
}

const NOTHING: SessionStartSkillInfo = { tag: null, notes: [] }

/** Everything the status line needs about the skill; never throws. */
export function sessionStartSkillInfo(
  input: SessionStartSkillInput
): SessionStartSkillInfo {
  try {
    const agent = skillAgentFor(input.agentEnum)
    if (!agent || !input.cliVersion) return NOTHING
    const notes: string[] = []
    let tag: string | null = null
    try {
      const copy = sessionSkillCopy({
        agent,
        cliVersion: input.cliVersion,
        homeDir: input.homeDir ?? os.homedir(),
        cwd: input.cwd,
      })
      if (copy) {
        tag = skillTag(copy)
        const note = skillVersionNote(copy, input.cliVersion)
        if (note) notes.push(note)
      }
    } catch {
      // unreadable copy: no tag, no hint
    }
    if (input.sessionId) {
      const upgraded = cliUpgradeNote(
        input.sessionId,
        input.cliVersion,
        input.sessionVersionsFile
      )
      if (upgraded) notes.push(upgraded)
    }
    return { tag, notes }
  } catch {
    return NOTHING
  }
}
