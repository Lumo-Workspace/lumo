/**
 * @jest-environment node
 *
 * LUM-1236 — the project rule "Never delete files in prisma/migrations/"
 * (rule a5ef343312d06cd1) compiled to a path-blind `cmd-substr: "rm"` and
 * produced 12 HIGH false positives in three days. The fixture holds the FULL
 * commands of those crossings. A rule of that shape is now:
 *
 *   - compiled to `path-delete` over the named path (mapped to the built-in
 *     MIGRATION_FILE_DELETED when the path is prisma/migrations, so the
 *     built-in is the one detector);
 *   - never matched through a bare-verb `cmd-substr` (an already-stored
 *     policy is neutralised before it is recompiled);
 *
 * while every real delete / move of a migration is still detected. The model
 * is not called: the compile is driven from fixed raw outputs (the shapes the
 * model has produced or could produce), so nothing depends on one LLM run.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  detectCrossings,
  detectProjectActionCrossings,
} from '@/lib/services/boundary-detector.service'
import { compileRuleSet } from '@/ee/security/services/policy/policy-compiler.service'
import { isCoveredByBuiltinDetector } from '@/ee/security/crossing-detectors'
import {
  containsWord,
  isUnsafeCmdNeedle,
  matchActionRule,
} from '@/ee/security/boundary-crossing/action-rule-match'
import {
  deletePathRuleShape,
  protectedPathsFromText,
} from '@/ee/security/services/policy/delete-path-rule'
import {
  matchPathDelete,
  normaliseProtectedPath,
  operandTouchesPath,
  parsePathDeleteValue,
  pathsCoveredByMigrationBuiltin,
  protectedPathDeletions,
  shellWords,
} from '@/lib/boundary-crossing/path-delete'
import { executingSegments } from '@/lib/boundary-crossing/command-shape'
import {
  stripHeredocBodies,
  stripQuotedLiterals,
} from '@/ee/security/boundary-crossing/action-confirm'
import type { PolicyRule, RawPolicyRule } from '@/lib/policy/types'
import { findPolicyConflicts } from '@/lib/memory/poison-gate'

const FIXTURE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../fixtures/lum1236-migrations-rule-false-positives.json'
    ),
    'utf8'
  )
) as { commands: Record<string, string> }
const FALSE_POSITIVES = Object.entries(FIXTURE.commands)

// Built from parts so this file's own text is not a delete command.
const MIG = ['prisma', 'migrations'].join('/')
const RULE_TEXT = `Never delete files in ${MIG}/`

/** The Watch-out list of the task plus the other ways to remove a migration. */
const REAL_DELETES = [
  `rm ${MIG}/x/migration.sql`,
  `git rm -r ${MIG}/20240101000000_init`,
  `mv ${MIG}/a b`,
  `find ${MIG} -delete`,
  `bash -c 'rm ${MIG}/x/migration.sql'`,
  `sh -c "git rm -r ${MIG}/x"`,
  `git mv ${MIG}/a ${MIG}/b`,
  `find ${MIG} -type f -name '*.sql' -exec rm {} +`,
  `find ${MIG} -name '*.sql' | xargs rm`,
  `rm -rf ${MIG}`,
  `rm -rf ${MIG}/*`,
  `rm "${MIG}/with space/migration.sql"`,
  `cd ${MIG} && rm 20240101000000_init/migration.sql`,
  `W=/Users/dev/lumo; cd $W || exit 1; rm ${MIG}/a/migration.sql`,
  `rm -rf /Users/dev/lumo/${MIG}/20240101000000_init`,
  `sudo rm ${MIG}/a/migration.sql`,
  `eval "rm ${MIG}/a/migration.sql"`,
  `python3 -c "import shutil; shutil.rmtree('${MIG}/a')"`,
]

/** What the pre-LUM-1236 matcher did with a needle: executing segments,
 *  prose stripped, plain `includes`. Kept here to prove the fixture really
 *  reproduces the false positives. */
function legacyMatch(needle: string, command: string): boolean {
  return executingSegments(command).some(seg =>
    stripQuotedLiterals(stripHeredocBodies(seg)).includes(needle.trim())
  )
}

/** The policy as stored in production before this change (the shape the
 *  replay proves: only `rm` explains all 12; mapped → blocking HIGH). */
const STORED_BEFORE: PolicyRule = {
  id: 'a5ef343312d06cd1',
  text: RULE_TEXT,
  kind: 'action',
  tier: 'deterministic',
  mappedCategory: 'MIGRATION_FILE_DELETED',
  predicate: { type: 'cmd-substr', value: 'rm' },
  severity: 'HIGH',
  blocking: true,
}

/** Raw compiler outputs the model may give this rule. */
const RAW_VARIANTS: RawPolicyRule[] = [
  { ...STORED_BEFORE, polarity: 'forbid' },
  { ...STORED_BEFORE, predicate: { type: 'cmd-substr', value: 'rm ' } },
  { ...STORED_BEFORE, predicate: { type: 'cmd-substr', value: 'git rm' } },
  { ...STORED_BEFORE, predicate: undefined },
  {
    ...STORED_BEFORE,
    mappedCategory: undefined,
    blocking: false,
    predicate: { type: 'path-glob', value: `${MIG}/**` },
  },
  {
    ...STORED_BEFORE,
    mappedCategory: undefined,
    blocking: false,
    predicate: { type: 'cmd-substr', value: 'rm' },
  },
]

const bash = (command: string) => ({
  toolName: 'Bash' as const,
  filePath: null,
  payload: { tool_input: { command } },
})
const prv = (command: string, rules: PolicyRule[]) =>
  detectProjectActionCrossings(bash(command), rules)
const builtinHit = (command: string) =>
  detectCrossings(bash(command)).some(
    c => c.category === 'MIGRATION_FILE_DELETED'
  )

describe('LUM-1236 the 12 production false positives', () => {
  it('the fixture holds the 12 crossings ruled FALSE_POSITIVE', () => {
    expect(FALSE_POSITIVES.map(([ref]) => ref).sort()).toEqual(
      [
        'LUM-X923',
        'LUM-X932',
        'LUM-X933',
        'LUM-X935',
        'LUM-X936',
        'LUM-X938',
        'LUM-X940',
        'LUM-X941',
        'LUM-X942',
        'LUM-X945',
        'LUM-X947',
        'LUM-X948',
      ].sort()
    )
  })

  it.each(FALSE_POSITIVES)(
    'before the fix the stored `rm` predicate matched %s',
    (_ref, command) => {
      expect(legacyMatch('rm', command)).toBe(true)
      // …and none of them names the protected path in a delete.
      expect(protectedPathDeletions(command, [MIG])).toEqual([])
    }
  )

  it.each(FALSE_POSITIVES)(
    'after the fix the stored policy no longer flags %s',
    (_ref, command) => {
      expect(prv(command, [STORED_BEFORE])).toEqual([])
    }
  )

  it.each(FALSE_POSITIVES)(
    'after the fix the recompiled rule no longer flags %s',
    (_ref, command) => {
      for (const raw of RAW_VARIANTS)
        expect(prv(command, compileRuleSet([raw]))).toEqual([])
    }
  )

  it.each(FALSE_POSITIVES)(
    'the built-in migration detector does not flag %s',
    (_ref, command) => {
      expect(builtinHit(command)).toBe(false)
    }
  )
})

describe('LUM-1236 recall: real migration deletes are still detected', () => {
  it.each(REAL_DELETES)('built-in MIGRATION_FILE_DELETED flags: %s', cmd => {
    expect(builtinHit(cmd)).toBe(true)
  })

  it.each(REAL_DELETES)('the path-delete predicate matches: %s', cmd => {
    expect(matchPathDelete(`${MIG}/`, cmd)).toBe(true)
  })

  it('a per-worktree copy stays exempt from the built-in (LUM-482)', () => {
    expect(builtinHit(`rm -rf .worktrees/x/${MIG}/20240101000000_init`)).toBe(
      false
    )
    expect(
      builtinHit(`cd .worktrees/x/${MIG} && rm -rf 20240101000000_init`)
    ).toBe(false)
  })

  it('a rule naming another path is judged as a project rule on that path', () => {
    const rules = compileRuleSet([
      {
        text: 'Never delete files in `db/migrate/`',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'rm' },
        severity: 'HIGH',
        blocking: false,
      },
    ])
    expect(rules[0]!.predicate).toEqual({
      type: 'path-delete',
      value: 'db/migrate',
    })
    for (const cmd of REAL_DELETES.map(c => c.split(MIG).join('db/migrate')))
      expect(prv(cmd, rules).map(c => c.policyRuleRef)).toEqual([rules[0]!.id])
    for (const [, cmd] of FALSE_POSITIVES) expect(prv(cmd, rules)).toEqual([])
  })
})

describe('LUM-1236 compile shape (deterministic, no model call)', () => {
  it.each(RAW_VARIANTS.map((r, i) => [i, r] as const))(
    'raw variant %i compiles to path-delete mapped to the built-in',
    (_i, raw) => {
      const [rule] = compileRuleSet([raw])
      expect(rule).toMatchObject({
        id: 'a5ef343312d06cd1',
        tier: 'deterministic',
        mappedCategory: 'MIGRATION_FILE_DELETED',
        blocking: true,
        predicate: { type: 'path-delete', value: MIG },
      })
      expect(isCoveredByBuiltinDetector(rule!)).toBe(true)
    }
  )

  it('a real delete is one crossing (the built-in), not a second rule hit', () => {
    const rules = compileRuleSet([RAW_VARIANTS[0]!])
    const cmd = `rm ${MIG}/x/migration.sql`
    expect(prv(cmd, rules)).toEqual([])
    expect(builtinHit(cmd)).toBe(true)
  })

  it('a bare-verb cmd-substr on an unrelated rule is dropped, a specific one kept', () => {
    // LUM-1236 follow-up: a migration-command rule's specific cmd-substr is
    // widened to the derived `migration-command` check (same command).
    const specificCmd = 'docker compose down --volumes'
    const [bare, specific] = compileRuleSet([
      {
        text: 'Never use mv on shared files',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'mv' },
        severity: 'MEDIUM',
        blocking: false,
      },
      {
        text: `Never run ${specificCmd}`,
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: specificCmd },
        severity: 'HIGH',
        blocking: false,
      },
    ])
    expect(bare!.predicate).toBeUndefined()
    expect(bare!.tier).toBe('semantic')
    expect(specific!.predicate).toEqual({
      type: 'cmd-substr',
      value: specificCmd,
    })
    const [migration] = compileRuleSet([
      {
        text: 'Never run prisma migrate reset',
        kind: 'action',
        tier: 'deterministic',
        predicate: { type: 'cmd-substr', value: 'prisma migrate reset' },
        severity: 'HIGH',
        blocking: false,
      },
    ])
    expect(migration!.predicate).toEqual({
      type: 'migration-command',
      value: 'migrate-reset',
    })
  })

  it('a sensitive-path glob rule keeps its glob', () => {
    expect(
      deletePathRuleShape({
        text: 'Never read or delete ~/.ssh/id_rsa',
        kind: 'action',
        mappedCategory: 'SENSITIVE_PATH_READ',
        predicate: { type: 'path-glob', value: '~/.ssh/**' },
      })
    ).toBeNull()
  })

  it('an obligation or a non-delete rule is not rewritten', () => {
    expect(
      deletePathRuleShape({
        text: 'Always run tests in __tests__/ before a PR',
        kind: 'action',
      })
    ).toBeNull()
    expect(
      deletePathRuleShape({
        text: 'Never push to main or develop directly',
        kind: 'action',
      })
    ).toBeNull()
  })
})

describe('LUM-1236 helpers', () => {
  it('protectedPathsFromText prefers backticked paths and skips prose slashes', () => {
    expect(protectedPathsFromText(RULE_TEXT)).toEqual([MIG])
    expect(
      protectedPathsFromText(
        'Never delete and/or rename files in `db/migrate/`'
      )
    ).toEqual(['db/migrate'])
    expect(protectedPathsFromText('禁止删除 db/seeds/ 下的文件')).toEqual([
      'db/seeds',
    ])
    expect(protectedPathsFromText('Never delete anything')).toEqual([])
  })

  it('normaliseProtectedPath / parsePathDeleteValue', () => {
    expect(normaliseProtectedPath(`\`./${MIG}/**\``)).toBe(MIG)
    expect(parsePathDeleteValue(`${MIG}/, db/migrate,${MIG}`)).toEqual([
      MIG,
      'db/migrate',
    ])
  })

  it('pathsCoveredByMigrationBuiltin', () => {
    expect(pathsCoveredByMigrationBuiltin([MIG, `${MIG}/2024`])).toBe(true)
    expect(pathsCoveredByMigrationBuiltin([MIG, 'db/migrate'])).toBe(false)
    expect(pathsCoveredByMigrationBuiltin([])).toBe(false)
  })

  it('shellWords unquotes', () => {
    expect(shellWords(`rm -f "a b" 'c d' e\\ f $'g'`)).toEqual([
      'rm',
      '-f',
      'a b',
      'c d',
      'e f',
      'g',
    ])
  })

  it('operandTouchesPath: under, parent only when recursive, globs', () => {
    expect(operandTouchesPath(`${MIG}/a.sql`, MIG, false)).toBe(true)
    expect(operandTouchesPath('prisma', MIG, false)).toBe(false)
    expect(operandTouchesPath('prisma', MIG, true)).toBe(true)
    expect(operandTouchesPath('prisma/mig*', MIG, true)).toBe(true)
    expect(operandTouchesPath('.tc-ev/*', MIG, true)).toBe(false)
    expect(operandTouchesPath('lib/foo.ts', MIG, true)).toBe(false)
  })

  it('protectedPathDeletions ignores carriers and moves into the path', () => {
    for (const cmd of [
      `grep -r rm ${MIG}`,
      `echo "rm ${MIG}/a"`,
      `git commit -m "rm ${MIG}/a"`,
      `cat > f <<EOF\nrm ${MIG}/a\nEOF`,
      `mv tmp.sql ${MIG}/new/migration.sql`,
      `npx prisma db execute --file "${MIG}/a/migration.sql"`,
      `ls ${MIG} | wc -l`,
    ])
      expect(protectedPathDeletions(cmd, [MIG])).toEqual([])
    expect(
      protectedPathDeletions(`bash <<EOF\nrm ${MIG}/a\nEOF`, [MIG])
    ).toHaveLength(1)
  })

  it('isUnsafeCmdNeedle / containsWord / matchActionRule', () => {
    for (const n of ['rm', 'rm ', 'mv', 'git rm', 'rm -f', 'ab'])
      expect(isUnsafeCmdNeedle(n)).toBe(true)
    for (const n of ['rm -rf', 'prisma migrate reset', '--no-verify'])
      expect(isUnsafeCmdNeedle(n)).toBe(false)
    expect(containsWord('npx prettier --write format.md', 'rm')).toBe(false)
    expect(containsWord('git push --force-with-lease', '--force')).toBe(true)
    expect(
      matchActionRule('prisma migrate reset', 'npx prisma migrate reset')
    ).toBe(true)
    expect(
      matchActionRule('prisma migrate reset', 'npx prisma migrate resetx')
    ).toBe(false)
    expect(matchActionRule('rm', 'rm -f a.txt')).toBe(false)
  })
})

describe('LUM-1236 memory write gate keeps the rule subject', () => {
  it('a memory granting the delete still conflicts with the recompiled rule', () => {
    const rules = compileRuleSet([RAW_VARIANTS[0]!])
    const hits = findPolicyConflicts(`旧的 ${MIG} 迁移可以直接删掉`, rules)
    expect(hits.map(h => h.subject)).toEqual([MIG])
    expect(findPolicyConflicts(RULE_TEXT, rules)).toEqual([])
  })
})
