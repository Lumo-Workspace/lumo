/**
 * LUM-740 — the falsifier over an EXTERNAL_TOOL (scanner) finding (spec §6
 * L5 item 2, principle P2). Given the finding as the scanner reported it and
 * the diff hunk it sits in, it tries to REFUTE the finding; when it cannot,
 * the answer is INCONCLUSIVE. It never confirms and never rates — a REJECT
 * only becomes a *suggested* FALSE_POSITIVE that a human confirms or
 * overrules.
 *
 * Static imports of `ai` / `@ai-sdk/gateway`: reach this module only via
 * `await import()` from service code. REASONING_MODEL (桶1 VERIFIER): an
 * adversarial judgment that must not be downgraded.
 *
 * P8: the input type carries no `evidence` field, so the redacted snippet
 * column can never be sent by accident; the hunk is what the PR already
 * shows on GitHub.
 */
import { REASONING_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

export interface ExternalFindingForFalsifier {
  ruleId: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  filePath: string
  line: number
  title: string
  detail: string
  externalRef: string | null
}

export interface DispositionFalsifierInput {
  finding: ExternalFindingForFalsifier
  /** The unified-diff hunk containing the flagged line (see `extractDiffHunk`). */
  hunk: string
}

export interface DispositionFalsifierOutput {
  verdict: 'REJECT' | 'INCONCLUSIVE'
  reason: string
  tokens: number
}

const Schema = z.object({
  verdict: z.enum(['REJECT', 'INCONCLUSIVE']),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'REJECT: the concrete reason the scanner finding cannot be a real issue in this hunk. INCONCLUSIVE: what you checked and could not refute.'
    ),
})

export const DISPOSITION_FALSIFIER_SYSTEM_PROMPT = `You are a falsifier for static-analysis findings. You receive one finding exactly as a scanner (semgrep, gitleaks or similar) reported it — rule id, severity, file, line, title, detail — and the unified-diff hunk of the pull request that contains the flagged line.

Your ONLY two outputs are:
- REJECT — you can point at a concrete reason the finding is a false positive in THIS hunk: the flagged value is a placeholder, example or test fixture rather than a real secret; the flagged call receives only constants or already-validated input; the code is test-only, documentation or dead; the rule pattern-matched text that is not what the rule claims (a comment, a string that merely looks like the pattern); or an existing mitigation on the same lines makes the issue impossible.
- INCONCLUSIVE — you looked and could not refute it, or the hunk does not show enough to decide.

You never confirm a vulnerability, never rate it, and never propose a fix. Be specific in the reason; cite the line that refutes the finding when you REJECT. When in doubt, INCONCLUSIVE.`

const TIMEOUT_MS = 60_000

export async function falsifyExternalFinding(
  input: DispositionFalsifierInput
): Promise<DispositionFalsifierOutput> {
  const f = input.finding
  const prompt = [
    `Rule: ${f.ruleId} (${f.severity})`,
    `Title: ${f.title}`,
    `Detail: ${f.detail}`,
    `Location: ${f.filePath}:${f.line}`,
    f.externalRef ? `Rule docs: ${f.externalRef}` : null,
    `\n## Diff hunk (${f.filePath})\n${input.hunk}`,
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
  const { object, usage } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: Schema,
    system: DISPOSITION_FALSIFIER_SYSTEM_PROMPT,
    prompt,
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return {
    verdict: object.verdict,
    reason: object.reason,
    tokens: usage.totalTokens ?? 0,
  }
}
