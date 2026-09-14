/**
 * @jest-environment node
 *
 * LUM-751 — deterministic false-positive fixes for the built-in command
 * matchers: DESTRUCTIVE_DB_COMMAND and NEW_NPM_DEPENDENCY are segment-scoped
 * and print/search-aware (incl. inside a `bash -c '…'` wrapper).
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import { detectCrossings } from '@/lib/services/boundary-detector.service'

const bash = (command: string) => ({
  toolName: 'Bash' as const,
  filePath: null,
  payload: { tool_input: { command } },
})
const cats = (command: string) =>
  detectCrossings(bash(command)).map(c => c.category)

// Never spell the DDL phrase contiguously in source — the prod detector scans
// this repo's own writes (the LUM-466 gold-set 口径).
const DDL_PHRASE = ['DROP', 'TABLE'].join(' ')
const TRUNC_PHRASE = ['truncate', 'table'].join(' ')

describe('DESTRUCTIVE_DB_COMMAND is segment-scoped and print/search-aware', () => {
  it('a grep / echo / git log segment naming DDL raises no DB crossing', () => {
    expect(
      cats(
        `grep -qiE '${DDL_PHRASE}|${TRUNC_PHRASE}' prisma/migrations/x/migration.sql`
      )
    ).not.toContain('DESTRUCTIVE_DB_COMMAND')
    expect(cats(`echo "never ${DDL_PHRASE} in prod"`)).not.toContain(
      'DESTRUCTIVE_DB_COMMAND'
    )
    expect(cats(`git log --grep "${DDL_PHRASE}"`)).not.toContain(
      'DESTRUCTIVE_DB_COMMAND'
    )
    expect(cats(`rg -n "prisma migrate reset" docs/`)).not.toContain(
      'DESTRUCTIVE_DB_COMMAND'
    )
  })

  it('the same grep wrapped in bash -c raises no DB crossing', () => {
    expect(
      cats(
        `bash -c "! grep -qiE '${DDL_PHRASE}' prisma/migrations/x/migration.sql"`
      )
    ).not.toContain('DESTRUCTIVE_DB_COMMAND')
    expect(
      cats(`sh -c 'grep -c "${TRUNC_PHRASE}" schema.sql && echo ok'`)
    ).not.toContain('DESTRUCTIVE_DB_COMMAND')
  })

  it('a PR body saying nothing was dropped raises no DB crossing', () => {
    expect(
      cats(
        `gh pr create --title "x" --body "nothing dropped, no ${DDL_PHRASE} in this migration"`
      )
    ).not.toContain('DESTRUCTIVE_DB_COMMAND')
    expect(
      cats(`git commit -m "chore: note that ${DDL_PHRASE} is forbidden"`)
    ).not.toContain('DESTRUCTIVE_DB_COMMAND')
  })

  it('real executors still raise the DB crossing', () => {
    expect(cats(`psql "$DATABASE_URL" -c "${DDL_PHRASE} users"`)).toContain(
      'DESTRUCTIVE_DB_COMMAND'
    )
    expect(cats('npx prisma migrate reset --force')).toContain(
      'DESTRUCTIVE_DB_COMMAND'
    )
    expect(cats('prisma db push --force-reset')).toContain(
      'DESTRUCTIVE_DB_COMMAND'
    )
    expect(cats(`bash -c "psql -c '${DDL_PHRASE} users'"`)).toContain(
      'DESTRUCTIVE_DB_COMMAND'
    )
    expect(cats(`echo ok && mysql -e "${DDL_PHRASE} users"`)).toContain(
      'DESTRUCTIVE_DB_COMMAND'
    )
  })
})

describe('NEW_NPM_DEPENDENCY only for a segment naming a package', () => {
  it('bare installs, worktree lockfile syncs, flag-only installs and npm ci raise no dependency crossing', () => {
    expect(cats('npm install && npm test')).not.toContain('NEW_NPM_DEPENDENCY')
    expect(cats('cd .worktrees/LUM-751-x && npm install')).not.toContain(
      'NEW_NPM_DEPENDENCY'
    )
    expect(cats('npm install --legacy-peer-deps')).not.toContain(
      'NEW_NPM_DEPENDENCY'
    )
    expect(cats('npm ci')).not.toContain('NEW_NPM_DEPENDENCY')
    expect(cats('npm install # sync lockfile')).not.toContain(
      'NEW_NPM_DEPENDENCY'
    )
    expect(cats('echo "run npm install left-pad first"')).not.toContain(
      'NEW_NPM_DEPENDENCY'
    )
  })

  it('a package-naming install still raises the dependency crossing', () => {
    expect(cats('npm install left-pad')).toContain('NEW_NPM_DEPENDENCY')
    expect(cats('npm test && npm i -D vitest')).toContain('NEW_NPM_DEPENDENCY')
    expect(cats('pnpm add zod')).toContain('NEW_NPM_DEPENDENCY')
    expect(cats('npm install\nnpm install chalk')).toContain(
      'NEW_NPM_DEPENDENCY'
    )
  })
})

// ── LUM-770: a heredoc body is authored text, not an install ─────────────────
describe('NEW_NPM_DEPENDENCY ignores heredoc bodies', () => {
  it('LUM-770: npm install inside a heredoc body raises no NEW_NPM_DEPENDENCY', () => {
    // Writing a probe script whose source mentions the install command.
    expect(
      cats(
        "cat > scripts/probe.ts <<'EOF'\nconst hint = 'run npm install left-pad first'\nconsole.log(hint)\nEOF"
      )
    ).not.toContain('NEW_NPM_DEPENDENCY')
    expect(
      cats(
        'cat > README.md <<EOF\n## Setup\n\nnpm install left-pad\nEOF\ngit add README.md'
      )
    ).not.toContain('NEW_NPM_DEPENDENCY')
    // A real install outside the heredoc still trips it.
    expect(
      cats("cat > notes.txt <<'EOF'\nsee below\nEOF\nnpm install left-pad")
    ).toContain('NEW_NPM_DEPENDENCY')
    expect(cats('npm install left-pad')).toContain('NEW_NPM_DEPENDENCY')
  })
})
