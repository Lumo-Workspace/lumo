/**
 * @jest-environment node
 *
 * LUM-587 — guards the consolidation of LLM model ids into lib/ai/models.ts and
 * the Sonnet 4.5→4.6 / Opus 4.7→4.8 upgrade; LUM-748 moved the last two
 * Anthropic tiers (CONTENT, POLICY_COMPILER) onto zai/glm-5.2.
 *
 * Two id spaces exist and must not be confused:
 *  - Gateway format (provider-prefixed, e.g. `anthropic/claude-sonnet-4.6`) —
 *    consumed by `@ai-sdk/gateway`'s `gateway('<id>')`.
 *  - Native Anthropic SDK format (bare, e.g. `claude-opus-4-8`) — consumed by
 *    `@anthropic-ai/sdk`'s `client.messages.create({ model })`. Prefixing this
 *    one with `anthropic/` would 400 the native API (LUM-587 invariant).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  REASONING_MODEL,
  GENERATION_MODEL,
  MEMORY_JUDGE_MODEL,
  CONTENT_MODEL,
  FAST_MODEL,
  TRANSLATION_MODEL,
  POLICY_COMPILER_MODEL,
} from '@/lib/ai/models'

// 桶4 MEMORY_JUDGE call sites (LUM-591) — split off FAST_MODEL onto the dearer
// MEMORY_JUDGE_MODEL (deepseek-v4-pro) for the reconciliation judges.
const MEMORY_JUDGE_CALL_SITES = [
  'lib/services/memory/curation-judge.ts',
  'lib/services/memory/fold-compute.ts',
  'lib/services/memory/layer2-extract.ts',
  'lib/services/memory/manual-dedup.ts',
]

// FAST tier — high-frequency, cost-sensitive; MUST stay on FAST_MODEL (flash).
// The bucket-4 split must not drag these onto the dearer judge model.
const FAST_TIER_CALL_SITES = [
  'lib/services/content-summary.service.ts',
  'lib/services/lineage/usage-judge.ts',
  'lib/services/memory/canonicalize-language.ts',
  'lib/services/memory/ground-candidates.ts',
  'lib/services/memory/layer1-extract.ts',
  'lib/services/session-summary/classifier.ts',
  'lib/services/turn-summary/turn-summary.service.ts',
]

// 桶2 GENERATION call sites (LUM-588) — repointed from REASONING_MODEL (Sonnet)
// to GENERATION_MODEL (deepseek-v4-pro). Paths relative to repo root.
const GENERATION_CALL_SITES = [
  'app/api/tasks/[id]/decompose/route.ts',
  'app/api/tasks/suggest-priority/route.ts',
  'lib/llm/run-summary-client.ts',
  'lib/llm/sprint-summary-client.ts',
  'lib/llm/milestone-summary-client.ts',
  'lib/services/description.service.ts',
  'lib/services/duplicate-check.service.ts',
  'lib/services/quick-dispatch.service.ts',
  'lib/summaries/report.ts',
]

// 桶1 VERIFIER + low-adversarial — MUST stay on REASONING_MODEL (now GPT-5.5);
// the cheap-model swap must not leak into the verifier tier (LUM-588 invariant).
const VERIFIER_CALL_SITES = [
  'lib/llm/claim-faithfulness-judge-client.ts',
  'lib/llm/action-confirm-client.ts',
]
// EMBEDDING_MODEL stays in ./embedding (coupled to EMBEDDING_DIM / pgvector);
// the registry is kept gateway-free, so it is not re-exported there.
import { EMBEDDING_MODEL } from '@/lib/ai/embedding'

const REPO_ROOT = join(__dirname, '..')
const LIB_DIR = join(REPO_ROOT, 'lib')

function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...walkTsFiles(full))
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full)
    }
  }
  return out
}

test('models module exposes upgraded reasoning and content model ids', () => {
  // 桶1 VERIFIER swapped Sonnet 4.6 → GPT-5.5 (LUM-588 A/B gate explicitly
  // WAIVED by the user; catalog-resolve probe only). Gateway format, version dot.
  expect(REASONING_MODEL).toBe('openai/gpt-5.5')
  // 桶3 (LUM-592 → LUM-748): content generation dropped Opus + the native SDK
  // for Sonnet via the gateway, then Sonnet → GLM-5.2 (gate WAIVED by the user).
  expect(CONTENT_MODEL).toBe('zai/glm-5.2')
})

test('content and policy-compiler tiers repointed to zai/glm-5.2', () => {
  // LUM-748: the last two Anthropic gateway call sites (桶3 CONTENT, 桶5
  // POLICY_COMPILER) moved to GLM-5.2 (not 5.3 — see the registry comment on
  // its whitespace-loop degeneration). Gateway format, version dot — the
  // catalog has `zai/glm-5.2`, NOT `zai/glm-5-2`.
  expect(CONTENT_MODEL).toBe('zai/glm-5.2')
  expect(POLICY_COMPILER_MODEL).toBe('zai/glm-5.2')

  // No provider-prefixed Anthropic id may remain in the registry; the ids the
  // registry exports are the single source of truth for every call site.
  const registry = readFileSync(join(LIB_DIR, 'ai/models.ts'), 'utf8')
  const exportedIds = [
    ...registry.matchAll(/export const \w+_MODEL = '([^']+)'/g),
  ].flatMap(m => (m[1] ? [m[1]] : []))
  expect(exportedIds.length).toBeGreaterThan(0)
  expect(exportedIds.filter(id => id.startsWith('anthropic/'))).toEqual([])
})

test('lib runtime has no inline gateway claude model literals', () => {
  // Any `gateway('anthropic/claude-…')` literal in lib/ means a call site still
  // hardcodes a model id instead of importing the central constant.
  const inlineGatewayClaude = /gateway\(\s*['"]anthropic\/claude-/
  const offenders = walkTsFiles(LIB_DIR).filter(f =>
    inlineGatewayClaude.test(readFileSync(f, 'utf8'))
  )
  expect(offenders.map(f => f.replace(REPO_ROOT + '/', ''))).toEqual([])
})

test('session summary content routes through the gateway, native anthropic sdk removed', () => {
  // 桶3 (LUM-592): content generation moved to the gateway → provider-prefixed
  // (`<provider>/<model>`), and the native @anthropic-ai/sdk exception is gone.
  // LUM-748 moved the provider off Anthropic; the invariant is "gateway
  // format", not "anthropic".
  expect(CONTENT_MODEL).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/)

  const templates = readFileSync(
    join(LIB_DIR, 'services/session-summary/templates.ts'),
    'utf8'
  )
  const service = readFileSync(
    join(LIB_DIR, 'services/session-summary/service.ts'),
    'utf8'
  )
  // Native SDK fully removed from the content-generation path.
  expect(templates).not.toMatch(/@anthropic-ai\/sdk/)
  expect(service).not.toMatch(/@anthropic-ai\/sdk/)
  // Still sources the id from the central registry, routed through the gateway.
  const localContentModelDef = /const\s+CONTENT_MODEL\s*=/
  expect(localContentModelDef.test(templates)).toBe(false)
  expect(localContentModelDef.test(service)).toBe(false)
  expect(templates).toMatch(/gateway\(CONTENT_MODEL\)/)
  expect(service).toMatch(/CONTENT_MODEL/)
})

test('pinned tiers keep their ids; translation moved to the deepseek fast tier', () => {
  expect(FAST_MODEL).toBe('deepseek/deepseek-v4-flash')
  // LUM-587: translation dropped the Haiku pin for the deepseek fast tier.
  expect(TRANSLATION_MODEL).toBe('deepseek/deepseek-v4-flash')
  expect(EMBEDDING_MODEL).toBe('alibaba/qwen3-embedding-0.6b')
})

test('memory judge tier repointed to deepseek-v4-pro', () => {
  expect(MEMORY_JUDGE_MODEL).toBe('deepseek/deepseek-v4-pro')

  for (const rel of MEMORY_JUDGE_CALL_SITES) {
    const src = readFileSync(join(REPO_ROOT, rel), 'utf8')
    expect({ rel, usesJudge: /\bMEMORY_JUDGE_MODEL\b/.test(src) }).toEqual({
      rel,
      usesJudge: true,
    })
    expect({ rel, usesFast: /\bFAST_MODEL\b/.test(src) }).toEqual({
      rel,
      usesFast: false,
    })
  }
})

test('fast tier stays on deepseek-v4-flash', () => {
  // The bucket-4 split must not drag the high-frequency FAST tier onto the
  // dearer judge model (LUM-591 invariant).
  for (const rel of FAST_TIER_CALL_SITES) {
    const src = readFileSync(join(REPO_ROOT, rel), 'utf8')
    expect({ rel, usesFast: /\bFAST_MODEL\b/.test(src) }).toEqual({
      rel,
      usesFast: true,
    })
    expect({ rel, usesJudge: /\bMEMORY_JUDGE_MODEL\b/.test(src) }).toEqual({
      rel,
      usesJudge: false,
    })
  }
})

test('generation tier repointed to deepseek-v4-pro', () => {
  // The 桶2 generation tier rides the gateway → provider-prefixed deepseek id.
  expect(GENERATION_MODEL).toBe('deepseek/deepseek-v4-pro')

  for (const rel of GENERATION_CALL_SITES) {
    const src = readFileSync(join(REPO_ROOT, rel), 'utf8')
    // Repointed to the generation constant…
    expect({ rel, usesGeneration: /\bGENERATION_MODEL\b/.test(src) }).toEqual({
      rel,
      usesGeneration: true,
    })
    // …and no longer references the reasoning (Sonnet) constant.
    expect({ rel, usesReasoning: /\bREASONING_MODEL\b/.test(src) }).toEqual({
      rel,
      usesReasoning: false,
    })
  }
})

test('policy-compiler tier pinned to glm-5.2, sourced from the registry', () => {
  // 桶5 POLICY_COMPILER (LUM-590) — the per-project rule compiler rode Opus 4.8,
  // now GLM-5.2 (LUM-748), via the gateway → provider-prefixed, version dot
  // (not dash).
  expect(POLICY_COMPILER_MODEL).toBe('zai/glm-5.2')

  const src = readFileSync(
    join(LIB_DIR, 'llm/policy-compiler-client.ts'),
    'utf8'
  )
  // Uses the dedicated constant…
  expect(/\bPOLICY_COMPILER_MODEL\b/.test(src)).toBe(true)
  // …and no longer shares the verifier (Sonnet) constant.
  expect(/\bREASONING_MODEL\b/.test(src)).toBe(false)
})

test('verifier tier rides the reasoning constant (now GPT-5.5)', () => {
  // 桶1 VERIFIER swapped Sonnet 4.6 → GPT-5.5. The LUM-588 "never swap without
  // the lineage A/B gate" rule was explicitly WAIVED by the user for this change.
  // The call sites must still source the shared REASONING_MODEL constant so the
  // tier stays single-pointed and the cheap generation model never leaks in.
  expect(REASONING_MODEL).toBe('openai/gpt-5.5')

  for (const rel of VERIFIER_CALL_SITES) {
    const src = readFileSync(join(REPO_ROOT, rel), 'utf8')
    // Still on the reasoning (Sonnet) constant…
    expect({ rel, usesReasoning: /\bREASONING_MODEL\b/.test(src) }).toEqual({
      rel,
      usesReasoning: true,
    })
    // …and the cheap generation model never leaked in.
    expect({ rel, usesGeneration: /\bGENERATION_MODEL\b/.test(src) }).toEqual({
      rel,
      usesGeneration: false,
    })
  }
})
