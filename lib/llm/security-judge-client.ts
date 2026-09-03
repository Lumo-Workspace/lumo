/**
 * LLM security judge for a PR diff (LUM-732).
 *
 * Mirrors lib/llm/code-rule-judge-client.ts: static imports of `ai` and
 * `@ai-sdk/gateway`, so this module MUST only be reached via `await import()`
 * from service code (jest TransformStream trap). Uses REASONING_MODEL (桶1
 * VERIFIER tier): a missed injection ships a real vulnerability, so this is a
 * high-value adversarial judgment. Conservative by construction — only clear
 * findings in ADDED lines, with a verbatim evidence line.
 */

import { REASONING_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

export const VULN_KINDS = [
  'sql_injection',
  'command_injection',
  'xss',
  'ssrf',
  'path_traversal',
  'insecure_deserialization',
  'auth_bypass',
  'unsafe_eval',
  'weak_crypto',
  'hardcoded_credential',
] as const
export type VulnKind = (typeof VULN_KINDS)[number]

const SecurityJudgeSchema = z.object({
  findings: z
    .array(
      z.object({
        kind: z.enum(VULN_KINDS),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        filePath: z.string().describe('Path from the +++ b/ header'),
        line: z
          .number()
          .int()
          .nullable()
          .describe('New-file line number if determinable, else null'),
        title: z.string().describe('Short finding title, ≤ 80 chars'),
        detail: z
          .string()
          .describe(
            'One or two sentences: what is wrong and how it is exploited'
          ),
        evidence: z
          .string()
          .describe('ONE added line quoted verbatim (without the leading +)'),
      })
    )
    .describe('Clear security defects in ADDED code only. Empty if none.'),
})

const SECURITY_JUDGE_SYSTEM_PROMPT = `You are an application-security reviewer examining a unified diff.

Only ADDED lines (starting with '+') are in scope; ignore removed ('-') and context lines.
Report ONLY clear, exploitable defects of these kinds: SQL injection, command injection, XSS, SSRF, path traversal, insecure deserialization, authentication/authorization bypass, unsafe eval/dynamic code execution, weak or misused cryptography, hardcoded credentials that a regex would miss.
Be conservative: if it is ambiguous, or mitigated elsewhere in the same diff, do NOT report it. Test files and fixtures are LOW severity at most.
For every finding quote exactly one added line verbatim as evidence and give the file path from the '+++ b/' header. Return an empty findings array when nothing is clearly wrong.`

export interface SecurityJudgeInput {
  diff: string
}

export interface SecurityJudgeFinding {
  kind: VulnKind
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  filePath: string
  line: number | null
  title: string
  detail: string
  evidence: string
}

export async function judgeSecurity(
  input: SecurityJudgeInput
): Promise<{ findings: SecurityJudgeFinding[] }> {
  const { object } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: SecurityJudgeSchema,
    system: SECURITY_JUDGE_SYSTEM_PROMPT,
    prompt: `Unified diff:\n${input.diff.trim().length > 0 ? input.diff : '(empty diff)'}`,
  })
  return { findings: object.findings }
}
