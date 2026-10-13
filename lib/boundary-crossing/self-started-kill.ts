/**
 * LUM-1114 — does an INFRA_TERMINATION command only stop a process this very
 * session started?
 *
 * Agents start long jobs in the background (an eval, a dev server, a watcher)
 * and stop them with `pkill -f <pattern>`. The matcher reads every pkill /
 * killall as HIGH and the crossing blocks DONE — a cost the agent pays for
 * cleaning up after itself. When the pattern names a command the same session
 * ran earlier, the stop is recorded as advisory instead. Pure.
 *
 * Narrow on purpose (the category is irreversible, so an exemption needs
 * positive evidence):
 *   - only pkill / killall — `kill -9 <pid>`, systemctl, docker, kubectl … carry
 *     no pattern that can be tied to the session, so they never qualify;
 *   - every terminating segment in the command must qualify;
 *   - the pattern must be specific — it contains a path separator, a dot or a
 *     space (`scripts/eval.ts`, `next dev`), never a bare program name
 *     (`pkill node` would also stop the user's own node processes);
 *   - an earlier session command must name the pattern inside a segment that
 *     EXECUTES something (command-shape `executingSegments`) — a `grep` /
 *     `cat` / `echo` / `git log` mentioning it started nothing — and that
 *     command must not itself be a kill (naming the target in an earlier pkill
 *     proves nothing).
 */
import { executingSegments, splitCommandSegments } from './command-shape'

const PKILL_OR_KILLALL = /^(?:\S*\/)?(pkill|killall)$/
/** Options of pkill / killall that consume the next token as their value. */
const OPTS_WITH_VALUE = new Set([
  '-u',
  '-U',
  '-g',
  '-G',
  '-P',
  '-s',
  '-t',
  '-F',
  '--signal',
  '--euid',
  '--uid',
  '--pgroup',
  '--group',
  '--parent',
  '--session',
  '--terminal',
  '--pidfile',
  '--older-than',
  '--younger-than',
  '-o',
  '-y',
])
/** Any other terminating verb the INFRA_TERMINATION matcher knows. */
const OTHER_TERMINATION =
  /(?:^|[\s;&|])kill\s+-(?:9|KILL|SIGKILL|15|TERM|SIGTERM)\b|\bsystemctl\s+(?:restart|stop)\b|\bservice\s+\S+\s+(?:restart|stop)\b|\bdocker\s+(?:kill|stop)\b|\bdocker[- ]compose\s+down\b|\bkubectl\s+(?:delete|rollout\s+restart|drain)\b|\bpm2\s+(?:restart|stop|delete|kill)\b/

function unquote(token: string): string {
  return token.replace(/^(['"])(.*)\1$/, '$2')
}

/** Shell tokens of a segment, keeping a quoted span (`"next dev"`) whole. */
function tokens(segment: string): string[] {
  return (segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(unquote)
}

/** A redirection token (`2>/dev/null`, `>log`, `&>x`) — not an argument. */
const REDIRECTION = /^(?:\d*|&)[<>]/

/**
 * The patterns a pkill / killall segment targets (pkill takes one, killall
 * several names), or null if the segment is not one. A redirection whose
 * target is the next token (`2> f`) consumes it.
 */
function killPatterns(segment: string): string[] | null {
  const toks = tokens(segment.trim())
  const verbAt = toks.findIndex(t => PKILL_OR_KILLALL.test(t))
  if (verbAt === -1) return null
  const patterns: string[] = []
  for (let i = verbAt + 1; i < toks.length; i++) {
    const t = toks[i] ?? ''
    if (OPTS_WITH_VALUE.has(t) || /^(?:\d*|&)[<>]+$/.test(t)) {
      i++
      continue
    }
    if (t === '&' || t.startsWith('-') || REDIRECTION.test(t)) continue
    patterns.push(t)
  }
  return patterns
}

/** Specific enough to tie to one command — not a bare program name. */
function isSpecific(pattern: string): boolean {
  return /[/.\s]/.test(pattern) && pattern.trim().length >= 4
}

function isKillCommand(cmd: string): boolean {
  return splitCommandSegments(cmd).some(
    seg => killPatterns(seg) !== null || OTHER_TERMINATION.test(seg)
  )
}

/**
 * The pkill / killall patterns of `cmd` when EVERY terminating segment is a
 * pkill / killall with a specific pattern; null otherwise (no exemption).
 */
export function selfStopPatterns(cmd: string): string[] | null {
  const patterns: string[] = []
  for (const seg of executingSegments(cmd)) {
    const own = killPatterns(seg)
    if (own !== null) {
      if (own.length === 0 || !own.every(isSpecific)) return null
      patterns.push(...own)
      continue
    }
    if (OTHER_TERMINATION.test(seg)) return null
  }
  return patterns.length > 0 ? patterns : null
}

/**
 * The earlier session command each pattern of `cmd` stops, or null when any
 * pattern names nothing this session started.
 */
export function matchSelfStartedProcesses(
  cmd: string,
  priorCommands: string[]
): string[] | null {
  const patterns = selfStopPatterns(cmd)
  if (!patterns) return null
  const starters = priorCommands.filter(c => !isKillCommand(c))
  const matched: string[] = []
  for (const pattern of patterns) {
    const starter = starters.find(c =>
      executingSegments(c).some(seg => seg.includes(pattern))
    )
    if (!starter) return null
    matched.push(starter)
  }
  return matched
}
