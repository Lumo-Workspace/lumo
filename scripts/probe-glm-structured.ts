/**
 * LUM-748 — structured-output conformance probe for the GLM-5.2 swap.
 *
 * The two tiers that moved off Anthropic (桶3 CONTENT_MODEL, 桶5
 * POLICY_COMPILER_MODEL) both rely on `generateObject` returning a
 * schema-valid object; a model that cannot honour the forced schema throws
 * `AI_NoObjectGeneratedError` at runtime. This probe exercises the real call
 * sites through the gateway so the swap ships on observed behaviour, not on a
 * catalog-resolve alone (the LUM-588 A/B gate was explicitly WAIVED by the
 * user for this change — there is still no judge A/B harness).
 *
 * Usage (needs AI_GATEWAY_API_KEY in .env / .env.local):
 *   npx tsx scripts/probe-glm-structured.ts --templates   # 6 session-summary kinds
 *   npx tsx scripts/probe-glm-structured.ts --policy      # CLAUDE.md → PolicyRule
 *   npx tsx scripts/probe-glm-structured.ts --policy --dump   # + print every rule
 *
 * Exit 0 only when every assertion for the selected probe holds; exit 1
 * otherwise. Doubles as the MACHINE checkpointer for the LUM-748 contract.
 */
import { config as loadEnv } from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

loadEnv({ path: path.resolve(__dirname, '../.env.local') })
loadEnv({ path: path.resolve(__dirname, '../.env') })

import { CONTENT_MODEL, POLICY_COMPILER_MODEL } from '../lib/ai/models'
import {
  generateStructuredSummary,
  type TemplateKind,
} from '../lib/services/session-summary/templates'
import { classifyRules } from '../lib/llm/policy-compiler-client'

type Check = { name: string; ok: boolean; detail: string }

// ── --templates ─────────────────────────────────────────────────────────────

/** Compact logs shaped to trigger each template's characteristic fields. */
const TEMPLATE_LOGS: Record<TemplateKind, string> = {
  exploration: `Read lib/auth.ts
Read lib/middleware.ts
Grep "requireIdentity" lib/
Read app/api/tasks/route.ts
Read lib/services/task.service.ts
Bash: git log --oneline -5 lib/auth.ts`,
  implementation: `Read app/api/tasks/route.ts
Edit lib/services/task.service.ts (+42 -3)
Write lib/validation/task-priority.ts
Edit app/api/tasks/route.ts (+12 -4)
Bash: npx jest __tests__/task.service.test.ts  (12 passed)
Bash: git commit -m "feat: add priority field to task create [LUM-12]"`,
  debug: `Read __tests__/slack-oauth.test.ts
Bash: npx jest __tests__/slack-oauth.test.ts  ERR (1 failed: redirect_uri mismatch)
Read app/api/slack/callback/route.ts
Read lib/slack/oauth.ts
Edit lib/slack/oauth.ts (+3 -1)
Bash: npx jest __tests__/slack-oauth.test.ts  (4 passed)`,
  refactor: `Read lib/services/task.service.ts
Write lib/repositories/task.repository.ts
Edit lib/services/task.service.ts (+18 -96)
Edit lib/services/sprint.service.ts (+4 -22)
Bash: npx tsc --noEmit  (ok)
Bash: npx jest lib  (88 passed)`,
  review: `Read app/api/webhooks/slack/route.ts
Read lib/slack/verify-signature.ts
Grep "timingSafeEqual" lib/
Read lib/slack/oauth.ts
Read __tests__/slack-webhook.test.ts`,
  mixed: `Read lib/ai/models.ts
Grep "anthropic/" lib/
Edit lib/ai/models.ts (+6 -2)
Bash: npx jest __tests__/llm-model-consolidation.test.ts  ERR (2 failed)
Edit __tests__/llm-model-consolidation.test.ts (+9 -3)
Bash: npx jest __tests__/llm-model-consolidation.test.ts  (10 passed)
Read docs/live-docs/README.md`,
}

const KINDS: TemplateKind[] = [
  'exploration',
  'implementation',
  'debug',
  'refactor',
  'review',
  'mixed',
]

/** The headline string field each kind must fill for the summary to be usable. */
function headline(payload: Record<string, unknown>): string {
  const key = {
    exploration: 'whatExplored',
    implementation: 'goal',
    debug: 'problem',
    refactor: 'refactorGoal',
    review: 'reviewScope',
    mixed: 'overview',
  }[payload.type as TemplateKind]
  const v = payload[key]
  return typeof v === 'string' ? v : ''
}

async function probeTemplates(): Promise<Check[]> {
  const checks: Check[] = []
  for (const kind of KINDS) {
    const started = Date.now()
    try {
      const payload = await generateStructuredSummary({
        kind,
        compactLog: TEMPLATE_LOGS[kind],
        truncatedToolCount: 0,
        sessionMeta: { cwd: '/repo', durationMs: 540_000, toolCallCount: 6 },
      })
      const head = headline(payload as unknown as Record<string, unknown>)
      const ok = payload.type === kind && head.trim().length > 0
      checks.push({
        name: `template:${kind}`,
        ok,
        detail: ok
          ? `${Date.now() - started}ms · ${JSON.stringify(head).slice(0, 100)}`
          : `type=${payload.type} headline=${JSON.stringify(head)}`,
      })
    } catch (err) {
      checks.push({
        name: `template:${kind}`,
        ok: false,
        detail: `threw ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      })
    }
  }
  return checks
}

// ── --policy ────────────────────────────────────────────────────────────────

// Mirrors BUILTIN_CATEGORIES in lib/services/policy/policy-compiler.service.ts
// (module-private there; the service wraps this call in a DB transaction, so
// the probe hits the LLM client directly with the same category list).
const BUILTIN_CATEGORIES = [
  'PUSH_TO_PROTECTED_BRANCH',
  'MIGRATION_FILE_DELETED',
  'HARDCODED_SECRET',
  'NEW_NPM_DEPENDENCY',
  'DESTRUCTIVE_DB_COMMAND',
  'EXFILTRATION_PUBLIC',
  'CLOUD_DATA_DELETION',
  'INFRA_TERMINATION',
  'UNTRUSTED_CODE_EXECUTION',
  'SENSITIVE_PATH_EDIT',
  'HOOK_BYPASS',
  'TEST_FILE_DELETED',
]

type Rule = Awaited<ReturnType<typeof classifyRules>>['rules'][number]

function expectMapped(
  rules: Rule[],
  label: string,
  textPattern: RegExp,
  category: string
): Check {
  const hit = rules.find(r => textPattern.test(r.text))
  if (!hit) {
    return {
      name: `policy:${label}`,
      ok: false,
      detail: 'rule not found in output',
    }
  }
  const ok =
    hit.mappedCategory === category &&
    hit.severity === 'HIGH' &&
    hit.blocking === true
  return {
    name: `policy:${label}`,
    ok,
    detail: `mapped=${hit.mappedCategory ?? '-'} severity=${hit.severity} blocking=${hit.blocking} tier=${hit.tier}`,
  }
}

async function probePolicy(dump: boolean): Promise<Check[]> {
  const sourceText = fs.readFileSync(
    path.resolve(__dirname, '../CLAUDE.md'),
    'utf8'
  )
  const started = Date.now()
  let rules: Rule[]
  try {
    ;({ rules } = await classifyRules({
      sourceText,
      builtinCategories: BUILTIN_CATEGORIES,
    }))
  } catch (err) {
    return [
      {
        name: 'policy:classifyRules',
        ok: false,
        detail: `threw ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
      },
    ]
  }
  if (dump) {
    process.stdout.write(JSON.stringify(rules, null, 2) + '\n')
  }
  const checks: Check[] = [
    {
      name: 'policy:count>=5',
      ok: rules.length >= 5,
      detail: `${rules.length} rules · ${Date.now() - started}ms`,
    },
    expectMapped(
      rules,
      'migrations-delete',
      /prisma\/migrations/i,
      'MIGRATION_FILE_DELETED'
    ),
    expectMapped(
      rules,
      'hardcoded-secret',
      /hardcode|secret|api key/i,
      'HARDCODED_SECRET'
    ),
  ]
  return checks
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<number> {
  const wantTemplates = argv.includes('--templates')
  const wantPolicy = argv.includes('--policy')
  const dump = argv.includes('--dump')
  if (!wantTemplates && !wantPolicy) {
    process.stderr.write(
      'usage: npx tsx scripts/probe-glm-structured.ts --templates | --policy [--dump]\n'
    )
    return 2
  }
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    process.stderr.write('AI_GATEWAY_API_KEY missing (.env / .env.local)\n')
    return 2
  }

  const checks: Check[] = []
  if (wantTemplates) {
    process.stdout.write(`CONTENT_MODEL = ${CONTENT_MODEL}\n`)
    checks.push(...(await probeTemplates()))
  }
  if (wantPolicy) {
    process.stdout.write(`POLICY_COMPILER_MODEL = ${POLICY_COMPILER_MODEL}\n`)
    checks.push(...(await probePolicy(dump)))
  }

  for (const c of checks) {
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail}\n`)
  }
  const failed = checks.filter(c => !c.ok).length
  process.stdout.write(
    `${checks.length - failed}/${checks.length} checks passed\n`
  )
  return failed === 0 ? 0 : 1
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    process.stderr.write(String(err instanceof Error ? err.stack : err) + '\n')
    process.exit(1)
  }
)
