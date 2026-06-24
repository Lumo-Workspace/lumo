/**
 * @jest-environment node
 *
 * LUM-587 — guards the consolidation of LLM model ids into lib/ai/models.ts and
 * the Sonnet 4.5→4.6 / Opus 4.7→4.8 upgrade.
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
  CONTENT_MODEL,
  FAST_MODEL,
  TRANSLATION_MODEL,
} from '@/lib/ai/models'
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
  // Sonnet routed through the gateway → provider-prefixed.
  expect(REASONING_MODEL).toBe('anthropic/claude-sonnet-4.6')
  // Opus driven via the native Anthropic SDK → bare id.
  expect(CONTENT_MODEL).toBe('claude-opus-4-8')
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

test('session summary content model id stays bare for native anthropic sdk', () => {
  // The native SDK rejects provider-prefixed ids — the constant must be bare.
  expect(CONTENT_MODEL.startsWith('anthropic/')).toBe(false)

  // Both session-summary files must import the central constant, not redefine it.
  const templates = readFileSync(
    join(LIB_DIR, 'services/session-summary/templates.ts'),
    'utf8'
  )
  const service = readFileSync(
    join(LIB_DIR, 'services/session-summary/service.ts'),
    'utf8'
  )
  const localContentModelDef = /const\s+CONTENT_MODEL\s*=/
  expect(localContentModelDef.test(templates)).toBe(false)
  expect(localContentModelDef.test(service)).toBe(false)
  expect(templates).toMatch(/CONTENT_MODEL/)
  expect(service).toMatch(/CONTENT_MODEL/)
})

test('unchanged model tiers keep their pinned ids', () => {
  expect(FAST_MODEL).toBe('deepseek/deepseek-v4-flash')
  expect(TRANSLATION_MODEL).toBe('anthropic/claude-haiku-4-5')
  expect(EMBEDDING_MODEL).toBe('alibaba/qwen3-embedding-0.6b')
})
