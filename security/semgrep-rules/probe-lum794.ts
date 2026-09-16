/**
 * LUM-794 probe — THROWAWAY, DO NOT MERGE.
 *
 * Why this file exists: the managed scan runs semgrep with the rule pack from
 * the PRODUCTION deploy (main's `lib/security-scan/semgrep-rules.ts`), and it
 * only reports hits on lines a PR ADDED. So a PR that introduces new rules can
 * never demonstrate them on itself — the rules were not deployed yet when it
 * was scanned. The evidence has to come from a PR opened AFTER the rule PR
 * merged, whose added lines are exactly the shapes the rules look for.
 *
 * That is all this file is: four added shapes, one per detector, so a
 * production scan has something to report. Read the SARIF-side ids as
 * `ext:semgrep:lumo.llm.*`; the loop at the bottom is the in-process graph
 * rule instead (`agent-loop-unbounded:while-true`, DETERMINISTIC).
 *
 * Deliberately not real code: `security/` is excluded from tsc and
 * `security/semgrep-rules/` from eslint, and nothing imports this.
 * Close the PR once the evidence is captured — never merge it.
 */
import { generateText, streamText } from 'ai'

declare const model: unknown
declare const tools: Record<string, unknown>
declare function stepCountIs(n: number): unknown
declare function hasToolCall(name: string): unknown

/** Expect: lumo.llm.agent-loop-no-step-cap — tools, no stopWhen, no maxSteps. */
export async function probeNoStepCap() {
  return generateText({
    model,
    tools,
    prompt: 'probe',
  })
}

/** Expect: lumo.llm.agent-loop-non-step-stop — a stop condition with no step count. */
export async function probeNonStepStop() {
  return streamText({
    model,
    tools,
    prompt: 'probe',
    stopWhen: [hasToolCall('submit_candidates')],
  })
}

/** Expect: lumo.llm.agent-step-cap-from-request — the ceiling comes from the caller. */
export async function probeStepCapFromRequest(req: Request) {
  const body = await req.json()
  return generateText({
    model,
    tools,
    prompt: 'probe',
    maxSteps: body.steps,
  })
}

/**
 * Expect: agent-loop-unbounded:while-true — the graph rule, not semgrep. No
 * break, no return, no throw, no comparison: nothing but the model ends it.
 */
export async function probeUnboundedLoop() {
  const transcript: string[] = []
  while (true) {
    const step = await generateText({ model, prompt: 'probe' })
    transcript.push(step.text)
  }
}

/** Negative control: the same loop with a ceiling. Nothing may be reported here. */
export async function probeBoundedLoop() {
  return generateText({
    model,
    tools,
    prompt: 'probe',
    stopWhen: [stepCountIs(24)],
  })
}
