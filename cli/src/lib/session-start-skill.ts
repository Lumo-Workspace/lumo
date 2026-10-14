import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { configDir } from './config'
import { acquireFileLock, releaseFileLock } from './file-lock'
import { detectInstalledSkills } from './install-locations'
import {
  projectDriftNote,
  projectDriftOnce,
  projectNotesPath,
  type ProjectDriftItem,
} from './project-install-drift'
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

/** A held lock older than this is treated as abandoned. */
const LOCK_STALE_MS = 10_000

/**
 * Remember which CLI version served this session's SessionStart. When a
 * later SessionStart of the same session (resume / clear / compact) runs
 * under a different CLI, the skill text already in the conversation predates
 * the upgrade: say so once. The read-modify-write runs under a lock file;
 * when another hook holds it this one skips (no hint, nothing recorded)
 * rather than wait. Never throws.
 */
export function cliUpgradeNote(
  sessionId: string,
  cliVersion: string,
  file: string = sessionVersionsPath()
): string | null {
  const lock = `${file}.lock`
  try {
    if (!acquireFileLock(lock, LOCK_STALE_MS)) return null
  } catch {
    return null
  }
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
  } finally {
    try {
      releaseFileLock(lock)
    } catch {
      // best effort
    }
  }
}

/**
 * LUM-1136: the session's skill copy as the `X-Lumo-Skill-Version` header the
 * SessionStart hook sends, so the members page can show it — `1.2.3`,
 * `1.2.3 modified`, `modified`, `source`, or `none` when no copy is
 * installed. Null when it cannot tell (unknown agent, no CLI version,
 * unreadable copy). Purely local; never throws.
 */
export function skillVersionHeaderValue(input: {
  agentEnum: string | null
  cliVersion: string | null
  cwd: string
  homeDir?: string
}): string | null {
  try {
    if (!input.cliVersion) return null
    const agent = skillAgentFor(input.agentEnum)
    if (!agent) return null
    const copy = sessionSkillCopy({
      agent,
      cliVersion: input.cliVersion,
      homeDir: input.homeDir ?? os.homedir(),
      cwd: input.cwd,
    })
    if (!copy) return 'none'
    if (copy.state === 'source') return 'source'
    if (copy.state === 'modified')
      return copy.version ? `${copy.version} modified` : 'modified'
    return copy.version
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
  /** Where the once-per-session committed-install reminder state lives (defaults to ~/.lumo). */
  projectNotesFile?: string
}

const NOTHING: SessionStartSkillInfo = { tag: null, notes: [] }

/** Everything the status line needs about the skill; never throws. */
export function sessionStartSkillInfo(
  input: SessionStartSkillInput
): SessionStartSkillInfo {
  try {
    if (!input.cliVersion) return NOTHING
    const cliVersion = input.cliVersion
    const agent = skillAgentFor(input.agentEnum)
    const notes: string[] = []
    let tag: string | null = null
    let copy: SkillCopyStatus | null = null
    let behindNote: string | null = null
    if (agent) {
      try {
        copy = sessionSkillCopy({
          agent,
          cliVersion,
          homeDir: input.homeDir ?? os.homedir(),
          cwd: input.cwd,
        })
        if (copy) {
          tag = skillTag(copy)
          behindNote = skillVersionNote(copy, cliVersion)
        }
      } catch {
        // unreadable copy: no tag, no hint
      }
    }
    // LUM-1108: the repo's committed install behind the CLI, once per
    // session. When it names the session's own skill copy it replaces the
    // plain skill hint (same copy, the project-scoped fix plus the PR step).
    let drift: ProjectDriftItem[] = []
    try {
      drift = projectDriftOnce({
        cwd: input.cwd,
        cliVersion,
        sessionId: input.sessionId,
        notedFile: input.projectNotesFile ?? projectNotesPath(configDir()),
      })
    } catch {
      // a failed probe only drops the reminder
    }
    const ownCopyInDrift =
      copy !== null &&
      drift.some(d => d.kind === 'skill' && d.path === copy.path)
    if (behindNote && !ownCopyInDrift) notes.push(behindNote)
    const driftNote = projectDriftNote(drift, cliVersion, {
      restart: ownCopyInDrift,
    })
    if (driftNote) notes.push(driftNote)
    // The restart hint is about reloading the skill: without a readable copy
    // there is nothing to reload, so neither hint nor record.
    if (tag !== null && input.sessionId) {
      const upgraded = cliUpgradeNote(
        input.sessionId,
        cliVersion,
        input.sessionVersionsFile
      )
      if (upgraded) notes.push(upgraded)
    }
    return { tag, notes }
  } catch {
    return NOTHING
  }
}
