/**
 * @jest-environment node
 *
 * LUM-1236 follow-up — the lum1236 recompile of an UNCHANGED CLAUDE.md turned
 * the deterministic, blocking Production migration rule (2b687fb274ed60e1)
 * into a reworded rule with no checker (724a56aa8d15e1c1, NO_CHECKER), the Dev
 * line's direct-UPDATE rule (d0a822cd596f9363) with it, and the weakening
 * judge blamed a person (X953/X954, HIGH). Fixed compile outputs drive every
 * case here — nothing depends on one model run:
 *
 *   1. a rule forbidding migration commands gets a `migration-command`
 *      checker derived from its own text, whatever the model said;
 *   2. a recompile carries a previous deterministic+blocking rule over when
 *      the model drops or downgrades it and its text is still in the source;
 *      a rule whose text really left the file is still reported HIGH;
 *   3. the weakening judge tolerates the classifier rewording the rule.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  detectCrossings,
  detectProjectActionCrossings,
} from '@/lib/services/boundary-detector.service'
import { compileRuleSet } from '@/ee/security/services/policy/policy-compiler.service'
import { ruleReach } from '@/ee/security/services/policy/rule-reachability'
import { uncheckedRules } from '@/ee/security/services/policy-coverage.service'
import {
  forbiddenMigrationOps,
  migrationCommandRuleShape,
  prohibitedClauses,
} from '@/ee/security/services/policy/migration-command-rule'
import {
  hasProductionSignal,
  matchMigrationCommand,
  migrationOpsIn,
  parseMigrationCommandValue,
} from '@/ee/security/boundary-crossing/migration-command-match'
import { retainWeakenedRules } from '@/ee/security/services/policy/retain-rules'
import {
  policyWeakeningVerdict,
  weakenedRules,
} from '@/lib/boundary-crossing/policy-weakening'
import {
  compiledRuleTextPresentIn,
  presenceWords,
  rejudgePolicyWeakening,
  ruleTextPresentIn,
} from '@/lib/boundary-crossing/rejudge-cause'
import {
  isDestructiveDbSegment,
  matchDestructiveDb,
} from '@/lib/boundary-crossing/destructive-db'
import { findRuleByRef } from '@/lib/policy/rule-ref'
import { findPolicyConflicts } from '@/lib/memory/poison-gate'
import type { PolicyRule, RawPolicyRule } from '@/lib/policy/types'

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../fixtures/lum1236-prod-migration-rule-recompile.json'
    ),
    'utf8'
  )
) as {
  source: string
  previousRules: PolicyRule[]
  lum1236Raw: RawPolicyRule[]
  noCheckerIds: Record<string, string>
}

const SOURCE = FIXTURE.source
const [PREV_PROD] = FIXTURE.previousRules as [PolicyRule]
const [RAW_PROD, RAW_DEV] = FIXTURE.lum1236Raw as [RawPolicyRule, RawPolicyRule]
const BUILTINS = new Set([
  'DESTRUCTIVE_DB_COMMAND',
  'MIGRATION_FILE_DELETED',
  'PUSH_TO_PROTECTED_BRANCH',
  'INFRA_TERMINATION',
])

/** The source with one bullet (by its bold label) removed — a person's edit. */
function withoutBullet(label: string): string {
  return SOURCE.split('\n')
    .filter(l => !l.startsWith(`- **${label}**`))
    .join('\n')
}

const bash = (command: string) => ({
  toolName: 'Bash' as const,
  filePath: null,
  payload: { tool_input: { command } },
})

/** The compiled lum1236 rules after this fix. */
const COMPILED = compileRuleSet(FIXTURE.lum1236Raw)
const ruleById = (id: string) => COMPILED.find(r => r.id === id)
const projectHits = (command: string) =>
  detectProjectActionCrossings(bash(command), COMPILED)
const builtinDbHit = (command: string) =>
  detectCrossings(bash(command)).some(
    c => c.category === 'DESTRUCTIVE_DB_COMMAND'
  )

// Assembled so this file holds no runnable migration command line of its own.
const P = 'npx prisma'

/** Must be caught — by the project rule or by the built-in. */
const MUST_HIT: Array<[string, 'project' | 'builtin']> = [
  [`${P} migrate reset --force`, 'builtin'],
  [`${P} db push`, 'project'],
  [`npx prisma db push --skip-generate`, 'project'],
  [`bash -c '${P} db push'`, 'project'],
  [
    `psql "$DATABASE_URL" -c "UPDATE _prisma_migrations SET checksum = 'x' WHERE migration_name = 'y'"`,
    'project',
  ],
  [
    `psql "$DIRECT_URL" -c "DELETE FROM \\"_prisma_migrations\\" WHERE migration_name = 'y'"`,
    'project',
  ],
  [
    `${P} db execute --stdin <<< "INSERT INTO public._prisma_migrations (id) VALUES ('x')"`,
    'project',
  ],
  [
    `psql "$DATABASE_URL" <<'SQL'\nupdate _prisma_migrations set rolled_back_at = now();\nSQL`,
    'project',
  ],
  [`DATABASE_URL=$PROD_DATABASE_URL ${P} migrate dev --name x`, 'project'],
  [`npx dotenv -e .env.production -- prisma migrate dev`, 'project'],
]

/** The dev workflow CLAUDE.md sanctions, and text that only names commands. */
const MUST_NOT_HIT = [
  `${P} migrate dev --name add_column`,
  `cd /repo && ${P} migrate dev`,
  `${P} migrate deploy`,
  `${P} migrate status`,
  `${P} migrate resolve --applied 20261018000000_x`,
  `${P} db execute --file prisma/migrations/20261018000000_x/migration.sql`,
  `${P} generate`,
  `psql "$DATABASE_URL" -c "SELECT migration_name FROM _prisma_migrations"`,
  `grep -rn "migrate reset" docs`,
  `git commit -m "never run prisma db push or UPDATE _prisma_migrations"`,
  `lumo task decide LUM-1 "no UPDATE _prisma_migrations, no prisma db push"`,
  `gh pr create --body "requires migrate deploy; never db push"`,
  `git push origin lumo/LUM-1-x`,
  `npx jest __tests__/ee/security`,
]

describe('fixture', () => {
  it('ids are sha256(text) and match the production rows', () => {
    const { createHash } = jest.requireActual(
      'crypto'
    ) as typeof import('crypto')
    const id = (t: string) =>
      createHash('sha256').update(t).digest('hex').slice(0, 16)
    expect(id(PREV_PROD.text)).toBe('2b687fb274ed60e1')
    for (const [ref, text] of Object.entries(FIXTURE.noCheckerIds))
      expect(id(text)).toBe(ref)
  })
})

describe('1. migration rules keep a deterministic checker', () => {
  it('both lum1236 rules compile to a migration-command checker, not NO_CHECKER', () => {
    for (const ref of ['724a56aa8d15e1c1', 'd0a822cd596f9363']) {
      const r = ruleById(ref)
      expect(r).toBeDefined()
      expect(r).toMatchObject({
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'DESTRUCTIVE_DB_COMMAND',
        blocking: true,
        predicate: { type: 'migration-command' },
      })
      expect(ruleReach(r!, BUILTINS)).toBe('action-predicate')
    }
    expect(uncheckedRules(COMPILED, { aiJudgeRuns: true })).toEqual([])
  })

  it('the other NO_CHECKER shape (deterministic, no predicate) is rewritten too', () => {
    const [r] = compileRuleSet([
      { ...RAW_PROD, tier: 'deterministic', assertion: undefined },
    ])
    expect(r?.predicate?.type).toBe('migration-command')
    expect(r?.tier).toBe('deterministic')
  })

  it('a single-command cmd-substr from the model is widened to every named command', () => {
    const [r] = compileRuleSet([
      {
        ...RAW_PROD,
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'prisma migrate reset' },
      },
    ])
    expect(r?.predicate).toEqual({
      type: 'migration-command',
      value:
        'migrate-dev@production,migrate-reset,db-push,migrations-table-write',
    })
  })

  it('takes only the commands of the prohibition clause; production limits migrate dev', () => {
    expect(forbiddenMigrationOps(RAW_PROD.text)).toEqual([
      'migrate-dev@production',
      'migrate-reset',
      'db-push',
      'migrations-table-write',
    ])
    expect(forbiddenMigrationOps(RAW_DEV.text)).toEqual([
      'migrations-table-write',
    ])
    expect(forbiddenMigrationOps(PREV_PROD.text)).toEqual([
      'migrate-dev@production',
      'migrate-reset',
      'db-push',
      'migrations-table-write',
    ])
    const devBullet = SOURCE.split('\n').find(l => l.startsWith('- **Dev**'))!
    // "applied locally via prisma migrate dev" is permission, not a ban.
    expect(forbiddenMigrationOps(devBullet)).toEqual([
      'migrate-reset',
      'migrations-table-write',
    ])
    const prodBullet = SOURCE.split('\n').find(l =>
      l.startsWith('- **Production**')
    )!
    expect(forbiddenMigrationOps(prodBullet)).toEqual([
      'migrate-dev@production',
      'migrate-reset',
      'db-push',
      'migrations-table-write',
    ])
    // Without any environment qualifier the command itself is the violation.
    expect(forbiddenMigrationOps('Never run `prisma migrate dev`')).toEqual([
      'migrate-dev',
    ])
    expect(prohibitedClauses('Use X. Never run Y; ok Z')).toEqual([' run Y'])
    // A negation that obliges is no ban.
    expect(
      forbiddenMigrationOps(
        "Don't forget to run `prisma migrate dev` after editing the schema"
      )
    ).toEqual([])
    expect(
      forbiddenMigrationOps('Never skip `prisma migrate dev` locally')
    ).toEqual([])
    // Seen in a local recompile: the model elides with "...".
    expect(
      forbiddenMigrationOps(
        'use only `prisma migrate deploy` in production — never `migrate dev` ... or direct edits to `_prisma_migrations`'
      )
    ).toEqual(['migrate-dev@production', 'migrations-table-write'])
  })

  it.each([
    ['区别 migrate dev 和 deploy', []],
    ['特别注意 db push 的用法', []],
    ['不可能在生产跑 migrate reset', []],
    ['不可或缺的一步是 prisma migrate dev', []],
    ['别人会在 CI 里跑 migrate dev', []],
    ['别用 db push', ['db-push']],
    ['不得 migrate reset', ['migrate-reset']],
    ['开发时，别 db push', ['db-push']],
    ['生产环境严禁 migrate dev', ['migrate-dev@production']],
    ['不可以直接修改 _prisma_migrations', ['migrations-table-write']],
  ])('Chinese prohibition markers: %s → %j', (text, ops) => {
    expect(forbiddenMigrationOps(text)).toEqual(ops)
  })

  it('leaves rules that name no migration command, or carry another predicate kind', () => {
    expect(
      migrationCommandRuleShape({
        text: 'Do not apply a migration to production manually unless the user explicitly authorizes it in the current session',
        kind: 'action',
      })
    ).toBeNull()
    expect(
      migrationCommandRuleShape({
        text: 'Never `prisma migrate reset`',
        kind: 'code',
      })
    ).toBeNull()
    expect(
      migrationCommandRuleShape({
        text: 'Never `prisma migrate reset`',
        kind: 'action',
        predicate: { type: 'path-glob', value: 'prisma/**' },
      })
    ).toBeNull()
    expect(
      migrationCommandRuleShape({
        text: 'The schema is applied with prisma migrate dev',
        kind: 'action',
      })
    ).toBeNull()
  })

  it.each(MUST_HIT)('catches %s', (command, by) => {
    const project = projectHits(command)
    if (by === 'project') {
      expect(project.length).toBeGreaterThan(0)
      expect(project[0]).toMatchObject({
        category: 'PROJECT_RULE_VIOLATION',
        advisory: false,
      })
    } else {
      // The built-in reports it; the project rule does not add a second row.
      expect(builtinDbHit(command)).toBe(true)
      expect(project).toEqual([])
      expect(matchMigrationCommand('migrate-reset', command)).toBe(true)
    }
  })

  it.each(MUST_NOT_HIT)('leaves %s alone', command => {
    expect(projectHits(command)).toEqual([])
  })

  it('one action is one crossing, however many rules state the ban', () => {
    const devBullet = SOURCE.split('\n').find(l => l.startsWith('- **Dev**'))!
    const rules = compileRuleSet([
      RAW_DEV,
      RAW_PROD,
      { ...RAW_DEV, text: devBullet },
    ])
    expect(
      rules.filter(r => r.predicate?.type === 'migration-command')
    ).toHaveLength(3)
    const update = `psql "$DATABASE_URL" -c "UPDATE _prisma_migrations SET checksum = 'x'"`
    const hits = detectProjectActionCrossings(bash(update), rules)
    expect(hits.map(h => h.policyRuleRef)).toEqual(['d0a822cd596f9363'])
    // A second operation in the same line is reported by the rule naming it.
    const both = detectProjectActionCrossings(
      bash(`${update} && ${P} db push`),
      rules
    )
    expect(both.map(h => h.policyRuleRef)).toEqual([
      'd0a822cd596f9363',
      '724a56aa8d15e1c1',
    ])
  })

  it('the production signal is read from the command line only', () => {
    expect(
      hasProductionSignal('DATABASE_URL=postgres://u@prod-db/x npx prisma')
    ).toBe(true)
    expect(hasProductionSignal('NODE_ENV=production npx prisma')).toBe(true)
    expect(hasProductionSignal('npx prisma migrate dev')).toBe(false)
    expect(
      hasProductionSignal('DATABASE_URL=$DEV_DATABASE_URL npx prisma')
    ).toBe(false)
  })

  it('parses the value and reports which operations a command runs', () => {
    expect(
      parseMigrationCommandValue(' db-push, bogus,db-push ,migrate-reset')
    ).toEqual(['db-push', 'migrate-reset'])
    expect(
      migrationOpsIn(
        ['migrate-reset', 'db-push'],
        `${P} migrate reset --force && ${P} db push`,
        { skipSegment: isDestructiveDbSegment }
      )
    ).toEqual(['db-push'])
  })

  it('the built-in DESTRUCTIVE_DB_COMMAND test is unchanged by the move', () => {
    expect(matchDestructiveDb(`${P} migrate reset --force`)).toBe(true)
    expect(matchDestructiveDb(`${P} db push --accept-data-loss`)).toBe(true)
    expect(matchDestructiveDb(`psql -c "DROP TABLE users"`)).toBe(true)
    expect(matchDestructiveDb(`${P} db push`)).toBe(false)
    expect(matchDestructiveDb(`grep "DROP TABLE" -r docs`)).toBe(false)
  })

  it('a memory granting `db push` conflicts; one granting dev migrate dev does not', () => {
    expect(
      findPolicyConflicts(
        'You can run prisma db push to sync the schema.',
        COMPILED
      ).length
    ).toBeGreaterThan(0)
    expect(
      findPolicyConflicts('You can run prisma migrate dev locally.', COMPILED)
    ).toEqual([])
    expect(
      findPolicyConflicts(
        'You can query _prisma_migrations to see what was applied.',
        COMPILED
      )
    ).toEqual([])
    expect(
      findPolicyConflicts(
        'It is fine to UPDATE _prisma_migrations by hand.',
        COMPILED
      ).length
    ).toBeGreaterThan(0)
  })
})

describe('2. a recompile never silently drops a checker', () => {
  it('rule removed from the new compile, text still in the source → kept', () => {
    const next = compileRuleSet([RAW_DEV]) // the model lost the prod rule
    expect(weakenedRules([PREV_PROD], next).map(r => r.id)).toEqual([
      PREV_PROD.id,
    ])
    const { rules, retained } = retainWeakenedRules({
      prevRules: [PREV_PROD],
      nextRules: next,
      source: SOURCE,
      compile: compileRuleSet,
    })
    expect(retained.map(r => r.previous.id)).toEqual([PREV_PROD.id])
    const kept = findRuleByRef(rules, PREV_PROD.id)
    expect(kept).toMatchObject({
      tier: 'deterministic',
      blocking: true,
      predicate: { type: 'migration-command' },
    })
    expect(weakenedRules([PREV_PROD], rules)).toEqual([])
  })

  it('rule downgraded in the new compile (same id) → the previous checker replaces it', () => {
    const text = 'Never run `terraform destroy` against the shared account'
    const prev = compileRuleSet([
      {
        text,
        kind: 'action',
        tier: 'deterministic',
        mappedCategory: 'INFRA_TERMINATION',
        severity: 'HIGH',
        blocking: true,
      },
    ])
    const next = compileRuleSet([
      {
        text,
        kind: 'action',
        tier: 'semantic',
        assertion: 'no terraform destroy',
        severity: 'HIGH',
        blocking: false,
      },
    ])
    expect(weakenedRules(prev, next)).toHaveLength(1)
    const source = `## Forbidden\n- ${text}\n`
    const { rules, retained } = retainWeakenedRules({
      prevRules: prev,
      nextRules: next,
      source,
      compile: compileRuleSet,
    })
    expect(retained).toHaveLength(1)
    expect(rules.filter(r => r.id === prev[0]!.id)).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      tier: 'deterministic',
      mappedCategory: 'INFRA_TERMINATION',
      blocking: true,
    })
  })

  it('text really deleted from the source → not kept, still HIGH', () => {
    const source = withoutBullet('Production')
    const next = compileRuleSet([RAW_DEV])
    const { rules, retained } = retainWeakenedRules({
      prevRules: [PREV_PROD],
      nextRules: next,
      source,
      compile: compileRuleSet,
    })
    expect(retained).toEqual([])
    const weakened = weakenedRules([PREV_PROD], rules)
    expect(weakened.map(r => r.id)).toEqual([PREV_PROD.id])
    expect(policyWeakeningVerdict(weakened[0]!, source)).toMatchObject({
      severity: 'HIGH',
      advisory: false,
    })
  })

  it('nothing weakened → the new compile is returned as is', () => {
    const { rules, retained } = retainWeakenedRules({
      prevRules: COMPILED,
      nextRules: COMPILED,
      source: SOURCE,
      compile: compileRuleSet,
    })
    expect(retained).toEqual([])
    expect(rules).toEqual(COMPILED)
  })
})

describe('3. the weakening judge tolerates the classifier rewording a rule', () => {
  it('X953/X954: both reworded texts read as still in CLAUDE.md → MEDIUM advisory', () => {
    for (const text of [PREV_PROD.text, RAW_PROD.text, RAW_DEV.text]) {
      // The verbatim check is what produced the HIGH rows.
      expect(ruleTextPresentIn(SOURCE, text)).toBe(false)
      expect(compiledRuleTextPresentIn(SOURCE, text)).toBe(true)
      const rule = { ...PREV_PROD, id: 'x', text }
      expect(policyWeakeningVerdict(rule, SOURCE)).toMatchObject({
        severity: 'MEDIUM',
        advisory: true,
      })
    }
  })

  it('the line really deleted → still HIGH, even though its words appear elsewhere', () => {
    expect(
      policyWeakeningVerdict(PREV_PROD, withoutBullet('Production'))
    ).toMatchObject({ severity: 'HIGH', advisory: false })
    expect(
      policyWeakeningVerdict(
        { ...PREV_PROD, id: 'd', text: RAW_DEV.text },
        withoutBullet('Dev')
      )
    ).toMatchObject({ severity: 'HIGH', advisory: false })
  })

  it('a polarity edit is never tolerated away', () => {
    const edited = SOURCE.replace(
      'never `migrate dev`, `db push`',
      'you may run `migrate dev`, `db push`'
    )
    expect(edited).not.toBe(SOURCE)
    expect(compiledRuleTextPresentIn(edited, PREV_PROD.text)).toBe(false)
    expect(policyWeakeningVerdict(PREV_PROD, edited)).toMatchObject({
      severity: 'HIGH',
    })
  })

  it('a short rule must match verbatim', () => {
    expect(
      compiledRuleTextPresentIn('never push main ever', 'Never push to main')
    ).toBe(false)
    expect(presenceWords('Never `push` to the _main_x branch')).toEqual([
      'never',
      'push',
      '_main_x',
      'branch',
    ])
  })

  it('re-judge: a compiler row is judged tolerantly, a core Forbidden row literally', () => {
    expect(
      rejudgePolicyWeakening(
        {
          detail: '',
          policyRuleText: PREV_PROD.text,
          policyRuleRef: PREV_PROD.id,
        },
        SOURCE
      ).outcome
    ).toBe('CAUSE_GONE')
    expect(
      rejudgePolicyWeakening(
        {
          detail: '',
          policyRuleText: PREV_PROD.text,
          policyRuleRef: 'forbidden:abc',
        },
        SOURCE
      ).outcome
    ).toBe('STILL_HOLDS')
  })
})
