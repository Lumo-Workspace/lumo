/**
 * LUM-1234 — pure: the reward-hack layer's operational log line.
 */
import { estimateRhTokens } from './reward-hack-cost'

/**
 * One operational log line per decision — numbers and ids only, never
 * transcript text: which window was used, how much of the task's session
 * history made it in, how big the judge input was and what came of it.
 */
export function rhDecisionLogLine(args: {
  scanId: string
  windowStart: Date | null
  windowEnd: Date
  sessions: number
  included: { events: unknown[] }[]
  prompt: string | null
  truncated: boolean
  outcome: string
  /** The task requirement was cut to its own cap (not lost coverage). */
  requirementTruncated?: boolean
  /** Judge suspicion 0..100, when the judge ran. */
  suspicion?: number | null
  /** Items the judge returned / that passed the gates / kept after refute. */
  items?: number
  gated?: number
  kept?: number
}): string {
  const events = args.included.reduce((n, s) => n + s.events.length, 0)
  const chars = args.prompt === null ? 0 : args.prompt.length
  const tokens = args.prompt === null ? 0 : estimateRhTokens(args.prompt)
  return `[reward-hack] decide scan=${args.scanId} window=${args.windowStart ? args.windowStart.toISOString() : 'none'}..${args.windowEnd.toISOString()} sessions=${args.sessions} included=${args.included.length} events=${events} promptChars=${chars} estTokens=${tokens} truncated=${args.truncated} requirementTruncated=${args.requirementTruncated ?? false} outcome=${args.outcome}${args.suspicion === undefined ? '' : ` suspicion=${args.suspicion ?? 'none'}`}${args.items === undefined ? '' : ` items=${args.items}`}${args.gated === undefined ? '' : ` gated=${args.gated}`}${args.kept === undefined ? '' : ` kept=${args.kept}`}`
}
