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
}): string {
  const events = args.included.reduce((n, s) => n + s.events.length, 0)
  const chars = args.prompt === null ? 0 : args.prompt.length
  const tokens = args.prompt === null ? 0 : estimateRhTokens(args.prompt)
  return `[reward-hack] decide scan=${args.scanId} window=${args.windowStart ? args.windowStart.toISOString() : 'none'}..${args.windowEnd.toISOString()} sessions=${args.sessions} included=${args.included.length} events=${events} promptChars=${chars} estTokens=${tokens} truncated=${args.truncated} outcome=${args.outcome}`
}
