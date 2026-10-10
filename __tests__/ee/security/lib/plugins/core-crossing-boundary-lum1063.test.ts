/**
 * LUM-1063 — the crossing-side core files of RFC LUM-1058 §3.5 (the 14 PR4
 * edges: boundary-detector ×9, rejudge ×2, boundary-crossing.service,
 * memory/write-gate, task-state) and the core modules this PR split out of
 * them reach the security plugin's crossing code only through the registry.
 * PR5 replaces these per-PR lists with a guard over every core file.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '../../../../..')

const CORE_FILES = [
  // the five files that held the 14 edges
  'lib/services/boundary-detector.service.ts',
  'lib/services/boundary-crossing-rejudge.service.ts',
  'lib/services/boundary-crossing.service.ts',
  'lib/services/memory/write-gate.ts',
  'lib/services/task-state.service.ts',
  // the core modules split out of the detector / the policy compiler
  'lib/boundary-crossing/detection-types.ts',
  'lib/boundary-crossing/detection-input.ts',
  'lib/boundary-crossing/taxonomy.ts',
  'lib/boundary-crossing/prose.ts',
  'lib/boundary-crossing/install-sources.ts',
  'lib/boundary-crossing/policy-rule-paths.ts',
  'lib/boundary-crossing/policy-weakening.ts',
  'lib/services/boundary-crossing-policy-weakening.service.ts',
  'lib/policy/path-glob.ts',
  'lib/plugins/crossing-types.ts',
  'lib/plugins/crossings.ts',
  // the core re-judge modules (decision Q1)
  'lib/boundary-crossing/rejudge.ts',
  'lib/boundary-crossing/rejudge-cause.ts',
]

/** The plugin's crossing modules (RFC appendix B: crossing-detectors-adv,
 *  policy-rules, crossing-ai). `lib/policy/` (core types) is not one. */
const PLUGIN_IMPORT =
  /(?:from\s+|import\(\s*)['"][^'"]*(?:(?:boundary-crossing\/|\.\/)(?:action-confirm|sensitive-read|untrusted-code|destructive-fs|action-rule-match|push-target-match|triage)|llm\/(?:action-confirm|crossing-explain|policy-compiler|code-rule-judge)-client|services\/policy\/|project-policy\.repository|boundary-crossing-triage)[^'"]*['"]/

describe('LUM-1063 crossing-side core files go through the plugin registry', () => {
  it.each(CORE_FILES)('%s imports no crossing-plugin module', file => {
    const src = readFileSync(join(ROOT, file), 'utf8')
    expect(src).not.toMatch(PLUGIN_IMPORT)
    expect(src).not.toMatch(/['"]@\/ee\//)
  })

  it('the guard pattern recognises the imports it is meant to catch', () => {
    for (const s of [
      "import { x } from '@/ee/security/boundary-crossing/sensitive-read'",
      "await import('@/ee/security/llm/crossing-explain-client')",
      "import { p } from '@/ee/security/services/policy/policy-compiler.service'",
      "import { r } from '@/ee/security/repositories/project-policy.repository'",
      "import { s } from './untrusted-code'",
    ])
      expect(s).toMatch(PLUGIN_IMPORT)
    expect("import type { PolicyRule } from '@/lib/policy/types'").not.toMatch(
      PLUGIN_IMPORT
    )
  })
})
