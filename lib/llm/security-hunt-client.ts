/**
 * LUM-739 — the L3 Hunt model call (spec §6 L3 "Hunt"). One bounded
 * tool-calling loop per PLANNED TASK over the diff subgraph.
 *
 * LUM-758 — the unit is a `HuntTask`, not a bare category: the prompt leads
 * with the task's free-text objective and its starting points (what to
 * investigate in THIS diff), and the task's closed `category` only types the
 * output — it selects the CWE hint and the `CATEGORY_BRIEF` that the
 * mechanical gate and the falsifier judge the submissions against.
 *
 * Static imports of `ai` / `@ai-sdk/gateway`: this module MUST only be
 * reached via `await import()` from service code (jest TransformStream
 * trap). GENERATION_MODEL (桶2): many cheap tool calls; the adversarial
 * judgment is the falsifier's (`security-falsifier-client.ts`), not this.
 *
 * The model's only way to answer is the `submit_candidates` tool, so the
 * loop ends on that call (or on the step cap / the token budget). Every
 * tool is confined to the subgraph: `read_file` refuses paths outside it.
 */
import { generateText, tool, stepCountIs, hasToolCall } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'
import { GENERATION_MODEL } from '@/lib/ai/models'
import {
  HuntCandidateSchema,
  CATEGORY_CWE_HINT,
  type HuntCategory,
} from '@/lib/security-scan/hunt/candidate'
import {
  callersOf,
  calleesOf,
  pathToEntry,
} from '@/lib/security-scan/graph/query'
import type { Subgraph } from '@/lib/security-scan/graph/types'
import { numberLines } from '@/lib/security-scan/hunt/snippet'
import {
  HUNT_CLIENT_MAX_RETRIES,
  type HuntTask,
} from '@/lib/services/security-hunt.config'

export interface HuntClientInput {
  task: HuntTask
  subgraph: Subgraph
  /** Memoised by the caller; null when the file does not exist at the head sha. */
  readFile: (path: string) => Promise<string | null>
  tokenBudget: number
  timeoutMs: number
  maxSteps: number
}

export interface HuntClientOutput {
  candidates: unknown[]
  tokens: number
  stopped: 'done' | 'steps' | 'budget'
}

const PROMPT_MAX_SYMBOLS = 400
const PROMPT_MAX_EDGES = 800

export { numberLines }

/** The map the model reasons over: ids only, never source text. */
export function renderSubgraphForPrompt(g: Subgraph): string {
  const byKind = (kind: string) => g.symbols.filter(s => s.kind === kind)
  const fmt = (s: Subgraph['symbols'][number]) =>
    `- ${s.id} (${s.file}:${s.line}${s.rule ? `, ${s.rule}` : ''}${s.controls.length > 0 ? `, controls: ${s.controls.join(',')}` : ''})`
  const sections: string[] = []
  const push = (title: string, rows: string[]) => {
    if (rows.length === 0) return
    sections.push(`### ${title}\n${rows.join('\n')}`)
  }
  let budget = PROMPT_MAX_SYMBOLS
  const take = (kind: string) => {
    const rows = byKind(kind)
    const slice = rows.slice(0, Math.max(0, budget))
    budget -= slice.length
    const out = slice.map(fmt)
    if (rows.length > slice.length)
      out.push(`…${rows.length - slice.length} more omitted`)
    return out
  }
  push('Entries', take('entry'))
  push('Sinks', take('sink'))
  push('Controls', take('control'))
  push('Functions', take('function'))
  const edges = g.edges
    .slice(0, PROMPT_MAX_EDGES)
    .map(e => `- ${e.from} -> ${e.to}`)
  if (g.edges.length > PROMPT_MAX_EDGES)
    edges.push(`…${g.edges.length - PROMPT_MAX_EDGES} more omitted`)
  push('Edges (caller -> callee)', edges)
  push(
    'Files',
    g.files.map(
      f =>
        `- ${f.path} (${f.lineCount} lines${f.touched ? ', touched by the PR' : ''})`
    )
  )
  return sections.join('\n\n')
}

const CATEGORY_BRIEF: Record<HuntCategory, string> = {
  idor: 'IDOR / broken authorization: an object id taken from the request (path, query, body) reaches a repository or Prisma call on a path with no membership / ownership / workspace check, or the check uses the wrong subject.',
  injection:
    'Injection: request-derived strings reach `$queryRaw*`, `child_process`, `eval` / `new Function`, or a file-system path without a parse / allow-list / parameterisation on the path.',
  ssrf: 'SSRF: a request-derived URL or host reaches `fetch` / `redirect` without an allow-list; watch redirects and internal metadata hosts.',
  prompt_injection:
    'Prompt injection: untrusted text (PR bodies, comments, web pages, Slack, memory written by agents) reaches an LLM call as instructions without an untrusted-content wrapper, or model output is executed / persisted as trusted.',
  race: 'Race / TOCTOU: a check-then-act on shared rows (dedupe, claim, balance, status transition) without a transaction, row lock or unique constraint, reachable twice concurrently from an entry.',
  logic:
    'Business-logic bypass: a state machine, gate or quota can be skipped by calling an entry in an unexpected order or with an unexpected role / field combination.',
}

export const HUNT_SYSTEM_PROMPT = `You are an application-security researcher hunting for UNKNOWN, exploitable defects in a TypeScript pull request. You work over a call subgraph that Lumo built from the files the PR touched plus their direct imports. Facts come from the subgraph and from the files you read with the tools; you never guess about code you have not read.

Rules:
1. Only name symbols that appear in the subgraph, by their exact id.
2. Every candidate needs a call_chain whose edges are subgraph edges, starting at the entry and ending at the sink; every symbol in it must be in the subgraph.
3. Line numbers come from read_file output (numbered lines), never estimated.
4. Report at most 10 candidates for this task; a concrete precondition and a one-sentence claim each; severity by impact if exploited.
5. Stay inside the task's objective and its category. Do not report style issues, missing tests, or anything mitigated on the path.
6. Finish with exactly one submit_candidates call. An empty list is a valid, common answer.`

function sumTokens(
  steps: ReadonlyArray<{
    usage?: { totalTokens?: number | undefined } | undefined
  }>
): number {
  let total = 0
  for (const s of steps) total += s.usage?.totalTokens ?? 0
  return total
}

/**
 * LUM-758 — the task header. The objective is the model's brief; the category
 * line tells it what shape the answer must take, and `CATEGORY_BRIEF` is the
 * decision rule the mechanical gate and the falsifier will hold it to.
 */
export function renderTaskForPrompt(task: HuntTask): string {
  const start =
    task.startingPoints.length > 0
      ? `\nStart from: ${task.startingPoints.join(', ')}`
      : ''
  return `## Task ${task.id}: ${task.objective}
Findings from this task are filed under: ${task.category} (${CATEGORY_CWE_HINT[task.category]})${start}
${CATEGORY_BRIEF[task.category]}`
}

export async function huntTask(
  input: HuntClientInput
): Promise<HuntClientOutput> {
  const fileSet = new Set(input.subgraph.files.map(f => f.path))
  const submitted: unknown[] = []

  const tools = {
    read_file: tool({
      description:
        'Read a file at the PR head sha as numbered lines. Only files listed in the subgraph. Optional startLine/endLine narrow the range.',
      inputSchema: z.object({
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
      execute: async ({ path, startLine, endLine }) => {
        if (!fileSet.has(path)) return { error: 'not in subgraph' }
        const source = await input.readFile(path)
        if (source === null) return { error: 'not found' }
        return { content: numberLines(source, startLine, endLine) }
      },
    }),
    callers_of: tool({
      description: 'Symbols that call the given symbol (subgraph edges).',
      inputSchema: z.object({ symbol: z.string() }),
      execute: async ({ symbol }) => ({
        callers: callersOf(input.subgraph, symbol),
      }),
    }),
    callees_of: tool({
      description: 'Symbols the given symbol calls (subgraph edges).',
      inputSchema: z.object({ symbol: z.string() }),
      execute: async ({ symbol }) => ({
        callees: calleesOf(input.subgraph, symbol),
      }),
    }),
    path_to_entry: tool({
      description:
        'Shortest chain from an entry point down to the given symbol, or null when no entry reaches it.',
      inputSchema: z.object({ symbol: z.string() }),
      execute: async ({ symbol }) => ({
        path: pathToEntry(input.subgraph, symbol),
      }),
    }),
    submit_candidates: tool({
      description:
        'Submit the final candidates for this task (may be empty). Call exactly once, when done.',
      inputSchema: z.object({
        candidates: z.array(HuntCandidateSchema).max(10),
      }),
      execute: async ({ candidates }) => {
        submitted.push(...candidates)
        return { accepted: candidates.length }
      },
    }),
  }

  const result = await generateText({
    model: gateway(GENERATION_MODEL),
    tools,
    system: HUNT_SYSTEM_PROMPT,
    prompt: `${renderTaskForPrompt(input.task)}\n\n## Subgraph\n${renderSubgraphForPrompt(input.subgraph)}`,
    // LUM-762: the SDK's default 2 retries sit in exponential backoff, which
    // is where the production abort ("Delay was aborted") landed — the window
    // went to waiting, not analysis. Fail fast; the workflow's retry pass
    // re-runs the category with a fresh window.
    maxRetries: HUNT_CLIENT_MAX_RETRIES,
    stopWhen: [
      stepCountIs(input.maxSteps),
      hasToolCall('submit_candidates'),
      ({ steps }) => sumTokens(steps) >= input.tokenBudget,
    ],
    abortSignal: AbortSignal.timeout(input.timeoutMs),
  })

  const tokens = result.totalUsage.totalTokens ?? sumTokens(result.steps)
  const didSubmit = result.steps.some(s =>
    s.toolCalls.some(c => c.toolName === 'submit_candidates')
  )
  return {
    candidates: submitted,
    tokens,
    stopped: didSubmit
      ? 'done'
      : tokens >= input.tokenBudget
        ? 'budget'
        : 'steps',
  }
}
