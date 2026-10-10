/**
 * LUM-1065 — plugin half of __tests__/llm-model-consolidation.test.ts: the
 * security plugin's LLM call sites source their tier from the central
 * registry (`lib/ai/models.ts`), like the core ones.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../../..')
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8')

test('policy-compiler client sources POLICY_COMPILER_MODEL, not the verifier tier (LUM-590 / LUM-748)', () => {
  const src = read('ee/security/llm/policy-compiler-client.ts')
  expect(/\bPOLICY_COMPILER_MODEL\b/.test(src)).toBe(true)
  expect(/\bREASONING_MODEL\b/.test(src)).toBe(false)
})

test('action-confirm client rides the verifier tier (REASONING_MODEL), never the generation one (LUM-588)', () => {
  const src = read('ee/security/llm/action-confirm-client.ts')
  expect(/\bREASONING_MODEL\b/.test(src)).toBe(true)
  expect(/\bGENERATION_MODEL\b/.test(src)).toBe(false)
})
