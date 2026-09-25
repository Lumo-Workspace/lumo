/**
 * LUM-836 — severity re-check for an INFRA_TERMINATION crossing that stops a
 * LOCAL DEV PROCESS the same session started.
 *
 * `kill -9` / `kill -TERM` / `pkill` always trip INFRA_TERMINATION (HIGH, forces
 * the DONE gate even under opt-out). The house rule "stop the dev server before
 * a full test run" makes an agent stopping the dev server IT launched a
 * recurring false positive. After the deterministic hit, this module asks an LLM
 * whether the kill targets a local dev process that an EARLIER command of the
 * same session launched.
 *
 * Red lines:
 *   - The judge only LOWERS severity (HIGH → LOW). The crossing is always still
 *     recorded, never dispositioned, never cleared; the DONE gate is untouched.
 *   - Eligibility is deterministic: systemctl / service / kubectl / docker / pm2
 *     / killall / sudo never reach the judge (stay HIGH whatever it would say).
 *   - The judge sees structured facts only — the executing segments of the kill
 *     command and of the session's earlier commands, with comments, heredoc
 *     bodies and print/commit/PR carriers removed. Never agent-authored prose,
 *     so an agent cannot argue its own case into the prompt.
 *   - The judge must cite WHICH earlier command launched the process; the
 *     crossing detail quotes that command from our own records, never model text.
 *   - Any failure, timeout, uncertainty or out-of-range citation → stay HIGH.
 */
import { executingSegments } from './command-shape'
import { stripHeredocBodies } from './action-confirm'
import { withTimeout } from './judge-timeout'

/** One earlier command of the same session, as the judge sees it. */
export interface SessionCommandFact {
  /** 1-based position among the facts, oldest first — what the judge cites. */
  index: number
  /** Executing segments only, comments stripped, one segment per line. */
  command: string
  /** Launched with Claude Code's `run_in_background` (a long-lived process). */
  background: boolean
}

export interface InfraKillJudgeInput {
  /** Executing segments of the kill command, comments stripped. */
  killCommand: string
  /** The session's earlier commands (bounded), oldest first. */
  sessionCommands: SessionCommandFact[]
}

export type InfraKillVerdict =
  | { classification: 'LOCAL_DEV_SELF_STARTED'; launchIndex: number }
  | { classification: 'NOT_SELF_STARTED' | 'UNCERTAIN' }

/** Abstraction over the LLM call (DIP) — injected so tests never hit the model. */
export type InfraKillJudge = (
  input: InfraKillJudgeInput
) => Promise<InfraKillVerdict>

/** A raw earlier event, before it is reduced to a fact. */
export interface RawSessionCommand {
  command: string
  background: boolean
}

const DEFAULT_TIMEOUT_MS = 10_000
/** Bounded prompt: the most recent N earlier commands, each clipped. */
export const MAX_SESSION_FACTS = 40
const FACT_MAX_CHARS = 300

/**
 * Terminators that are never "stopping my own dev process": service managers,
 * orchestrators, containers, process managers, name-wide killall, and anything
 * run as root. Matched against the executing segments that tripped the matcher.
 */
const NEVER_ELIGIBLE =
  /(?:^|[\s;&|/])(?:sudo|doas|killall|systemctl|service|kubectl|docker|docker-compose|podman|pm2)\b/

/**
 * Remove unquoted shell comments (`# …` to end of line, where `#` starts a
 * word). Quote-aware so `pkill -f "a#b"` keeps its argument.
 */
export function stripShellComments(cmd: string): string {
  const out: string[] = []
  for (const line of cmd.split('\n')) {
    let quote: '"' | "'" | null = null
    let cut = line.length
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (quote) {
        if (c === '\\' && quote === '"') i++
        else if (c === quote) quote = null
        continue
      }
      if (c === '\\') {
        i++
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        continue
      }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
        cut = i
        break
      }
    }
    out.push(line.slice(0, cut))
  }
  return out.join('\n')
}

/** Verbs whose segments author text or query metadata — never a launch fact. */
const NON_LAUNCH_VERB = /^(?:git|gh|lumo)\b/

/**
 * Reduce a command to the facts a judge may see: heredoc bodies dropped,
 * comments dropped, only EXECUTING segments kept (print / search / read carriers
 * like echo, printf, grep, cat are removed by `executingSegments`), one per
 * line. `forLaunch` also drops git / gh / lumo segments (commit messages and PR
 * bodies are prose, and none of them launches a process).
 */
export function commandFacts(cmd: string, forLaunch: boolean): string {
  const segments = executingSegments(
    stripShellComments(stripHeredocBodies(cmd))
  )
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .filter(s => !forLaunch || !NON_LAUNCH_VERB.test(s))
  return segments.join('\n')
}

/** Clip one fact so a pasted script cannot flood the prompt. */
function clipFact(s: string): string {
  return s.length > FACT_MAX_CHARS ? `${s.slice(0, FACT_MAX_CHARS)}…` : s
}

/**
 * Build the judge input. Returns null when the kill is ineligible for a
 * downgrade (a never-eligible terminator, or nothing executing) or the session
 * has no earlier command that could have launched anything — in both cases no
 * LLM call is made and the crossing stays HIGH.
 */
export function buildInfraKillJudgeInput(
  killCmd: string,
  earlier: RawSessionCommand[],
  matchesInfra: (segment: string) => boolean
): InfraKillJudgeInput | null {
  const killCommand = commandFacts(killCmd, false)
  if (!killCommand) return null
  const tripping = killCommand.split('\n').filter(s => matchesInfra(s))
  // Nothing matches in isolation (a match spanning segments) → cannot tell
  // which terminator it is → stay HIGH.
  if (tripping.length === 0) return null
  if (tripping.some(s => NEVER_ELIGIBLE.test(s))) return null
  const facts: SessionCommandFact[] = []
  for (const e of earlier.slice(-MAX_SESSION_FACTS)) {
    const command = commandFacts(e.command, true)
    if (!command) continue
    facts.push({
      index: facts.length + 1,
      command: clipFact(command),
      background: e.background,
    })
  }
  if (facts.length === 0) return null
  return { killCommand: clipFact(killCommand), sessionCommands: facts }
}

/**
 * Best-effort judge call. Returns the launch fact the judge cited when it
 * confirmed a self-started local dev process, or null (stay HIGH) on any other
 * verdict, an out-of-range citation, a throw, or a timeout. Never throws.
 */
export async function confirmSelfStartedDevKill(
  input: InfraKillJudgeInput,
  deps: { judge: InfraKillJudge; timeoutMs?: number }
): Promise<SessionCommandFact | null> {
  let verdict: InfraKillVerdict
  try {
    verdict = await withTimeout(
      deps.judge(input),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
  } catch {
    return null
  }
  if (verdict.classification !== 'LOCAL_DEV_SELF_STARTED') return null
  return (
    input.sessionCommands.find(f => f.index === verdict.launchIndex) ?? null
  )
}

/**
 * Detail prefix for a downgraded crossing — quotes OUR record of the launch,
 * never model text. A prefix (not a suffix) so the detail's length clip can
 * only ever cut the kill command, never the reason it was downgraded.
 */
export function downgradeNote(launch: SessionCommandFact): string {
  const first = launch.command.split('\n')[0] ?? ''
  const shown = first.length > 60 ? `${first.slice(0, 60)}…` : first
  return `[downgraded to LOW — judge: stops a local dev process this session launched: ${shown}] `
}
