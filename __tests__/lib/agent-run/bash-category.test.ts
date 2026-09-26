import {
  BASH_CATEGORIES,
  BASH_CATEGORY_LABEL,
  classifyBashCommand,
  classifyBashCommandDetailed,
  classifyBashPayload,
  isBashCategory,
  toolDetailFromPayload,
  unrecognisedVerbs,
} from '@/lib/agent-run/bash-category'

describe('classifyBashCommand', () => {
  it.each([
    ['cat lib/a.ts', 'read'],
    ["sed -n '1,80p' lib/a.ts", 'read'],
    ['grep -rn foo lib | head -20', 'read'],
    ['ls -la __tests__', 'read'],
    ['git show origin/main:lib/a.ts', 'read'],
    ['git -C .worktrees/x log --oneline -5', 'read'],
    ['npx jest __tests__/a.test.ts', 'test'],
    ['npm test', 'test'],
    ['pnpm run test:unit', 'test'],
    ["npx tsx scripts/jest-t.ts 'name' __tests__/a.test.ts", 'test'],
    ['npx tsc --noEmit', 'check'],
    ['npx eslint lib', 'check'],
    ['npm run lint', 'check'],
    ['npx prisma generate', 'db'],
    ['git add -A', 'git-write'],
    ['git push -u origin HEAD', 'git-write'],
    ['git fetch -q origin main', 'git-write'],
    ['gh pr view 12 --json title', 'gh'],
    ['lumo task status LUM-1', 'lumo'],
    ['vercel ls lumo --prod', 'net'],
    ['curl -s https://example.com', 'net'],
    ["python3 -c 'print(1)'", 'script'],
    ['node -e "console.log(1)"', 'script'],
    ['npx tsx scripts/backfill.ts', 'script'],
    ['rm -rf tmp && mkdir tmp', 'file'],
    ['npm install', 'check'],
    ['pip install -r requirements.txt', 'check'],
    ['npm view @lumoai/cli version', 'net'],
    ['npx --no-install tsc --noEmit', 'check'],
    ['dotenv -e .env.local -- npx jest', 'test'],
    ['readlink -f node_modules', 'read'],
  ])('%s → %s', (cmd, expected) => {
    expect(classifyBashCommand(cmd)).toBe(expected)
  })

  it('skips cd / export / env-assignment prefixes instead of classifying by the first word', () => {
    expect(classifyBashCommand('cd /repo && npx jest a.test.ts')).toBe('test')
    expect(classifyBashCommand('export FOO=1; lumo whoami')).toBe('lumo')
    expect(classifyBashCommand('CI=1 npm test')).toBe('test')
  })

  it('resolves a chain to its most significant segment', () => {
    // read + test → test
    expect(
      classifyBashCommand('grep -n foo a.ts && npx jest a.test.ts | tail -5')
    ).toBe('test')
    // file + read + typecheck → typecheck
    expect(
      classifyBashCommand(
        "sed -i '' '3d' a.ts && sed -n 1,5p a.ts && npx tsc --noEmit"
      )
    ).toBe('check')
    // read + lumo → lumo
    expect(classifyBashCommand('lumo task status LUM-1 | grep -i done')).toBe(
      'lumo'
    )
  })

  it('looks through loops, subshells and bash -c wrappers', () => {
    expect(
      classifyBashCommand(
        'for n in 1 2; do echo "== $n"; lumo pr scan $n; done'
      )
    ).toBe('lumo')
    expect(classifyBashCommand('(cd cli && npx jest)')).toBe('test')
    expect(classifyBashCommand("bash -c 'gh pr checks 3'")).toBe('gh')
    expect(classifyBashCommand('out=$(gh api repos/x/y)')).toBe('gh')
  })

  it('does not classify by words inside a heredoc body', () => {
    const cmd = [
      "cat > notes.md <<'EOF'",
      'npx jest everything',
      'git push origin main',
      'EOF',
    ].join('\n')
    expect(classifyBashCommand(cmd)).toBe('read')
    const script = ["python3 - <<'EOF'", 'import os', 'EOF'].join('\n')
    expect(classifyBashCommand(script)).toBe('script')
  })

  it('classifies common non-Node toolchains', () => {
    const cases: [string, string][] = [
      ['pytest tests/', 'test'],
      ['python -m pytest -x', 'test'],
      ['uv run pytest', 'test'],
      ['cd api && pytest -x', 'test'],
      ['go test ./...', 'test'],
      ['cargo test --workspace', 'test'],
      ['bundle exec rspec spec/a_spec.rb', 'test'],
      ['mvn test', 'test'],
      ['./gradlew test', 'test'],
      ['make test', 'test'],
      ['make build', 'check'],
      ['mvn package', 'check'],
      ['./gradlew build', 'check'],
      ['cargo build --release', 'check'],
      ['go vet ./...', 'check'],
      ['ruff check .', 'check'],
      ['poetry run mypy src', 'check'],
      ['black --check .', 'check'],
      ['golangci-lint run', 'check'],
      ['docker compose up -d', 'net'],
      ['kubectl get pods', 'net'],
      ['terraform plan', 'net'],
      ['helm upgrade app ./chart', 'net'],
      ['timeout 60 pytest', 'test'],
      ['ps aux | grep jest', 'read'],
      ['pgrep -fl next-server', 'read'],
      ['./start-server.sh --port 3000', 'script'],
      ['bash scripts/run_mut.sh', 'script'],
      ["perl -pi -e 's/a/b/' f.txt", 'script'],
    ]
    for (const [cmd, expected] of cases) {
      expect([cmd, classifyBashCommand(cmd)]).toEqual([cmd, expected])
    }
  })

  it('an unknown command outranks read', () => {
    expect(classifyBashCommand('foo-new-tool --x && grep bar a.txt')).toBe(
      'other'
    )
    expect(classifyBashCommand('some-cli status | head -5')).toBe('other')
    expect(unrecognisedVerbs('"$D/review-package" --x && ls')).toEqual([
      'review-package',
    ])
    // Plumbing and bare variable assignments are still not commands.
    expect(classifyBashCommand('S=/tmp/x; echo hi; cat $S/a')).toBe('read')
    expect(classifyBashCommand('cd /repo && sleep 2 && ls')).toBe('read')
    // Comment lines are not commands (prod: 1,607 rows had `#` as their
    // "unrecognised verb" before this was handled).
    expect(
      classifyBashCommand(
        [
          '# Check what the plan says',
          '# and the locales',
          'grep -A3 x a.json',
        ].join('\n')
      )
    ).toBe('read')
    // `do VAR=$(cmd …)` resolves to the substituted command, not its flag.
    expect(
      classifyBashCommand(
        `for f in lib/*.json; do c=$(grep -c 'x' "$f"); echo "$f: $c"; done`
      )
    ).toBe('read')
  })

  it('does not split continuations, comments or bare keywords into commands', () => {
    // `\`-continued chain: the git write wins, `\` is never a command.
    const chain = [
      'git stash push -m x && \\',
      'git checkout main && \\',
      'git pull origin main',
    ].join('\n')
    expect(classifyBashCommandDetailed(chain)).toEqual({
      category: 'git-write',
      verb: 'git stash',
    })
    // A `|` inside a comment line must not start a fake command.
    const commented = [
      '# attrGet(name): string|null as a method',
      '# T | undefined',
      'grep -n attrGet lib/a.ts',
    ].join('\n')
    expect(classifyBashCommand(commented)).toBe('read')
    expect(unrecognisedVerbs(commented)).toEqual([])
    // Keywords alone on their line of a multi-line loop / if.
    const loop = [
      'for f in a b',
      'do',
      '  cat "$f"',
      '  if [ -s "$f" ]',
      '  then',
      '    continue',
      '  else',
      '    break',
      '  fi',
      'done',
    ].join('\n')
    expect(classifyBashCommand(loop)).toBe('read')
    expect(unrecognisedVerbs(loop)).toEqual([])
  })

  it('treats pure plumbing or an empty command as other', () => {
    expect(classifyBashCommand('')).toBe('other')
    expect(classifyBashCommand('sleep 20; echo waited')).toBe('other')
  })
})

describe('toolDetailFromPayload', () => {
  it('returns the category for a Bash payload with a command', () => {
    expect(
      toolDetailFromPayload({
        tool_name: 'Bash',
        tool_input: { command: 'npx jest' },
      })
    ).toBe('test')
  })

  it('returns null for non-Bash tools and unreadable payloads', () => {
    expect(
      toolDetailFromPayload({
        tool_name: 'Read',
        tool_input: { file_path: 'a' },
      })
    ).toBeNull()
    expect(toolDetailFromPayload({ tool_name: 'Bash' })).toBeNull()
    expect(toolDetailFromPayload(null)).toBeNull()
    expect(toolDetailFromPayload('Bash')).toBeNull()
  })
})

describe('category table', () => {
  it('gives every category a label and recognises only known slugs', () => {
    for (const c of BASH_CATEGORIES) {
      expect(BASH_CATEGORY_LABEL[c]).toBeTruthy()
      expect(isBashCategory(c)).toBe(true)
    }
    expect(isBashCategory('nope')).toBe(false)
    expect(isBashCategory(null)).toBe(false)
  })
})

describe('classifyBashCommandDetailed', () => {
  it('labels the decisive command', () => {
    const cases: [string, string, string | null][] = [
      ['grep -rn foo lib | head', 'read', 'grep'],
      ['cd /repo && npx jest a.test.ts | tail -5', 'test', 'jest'],
      ["npx tsx scripts/jest-t.ts 'x' a.test.ts", 'test', 'jest'],
      ['npm run test:unit', 'test', 'npm test:unit'],
      ['pnpm lint', 'check', 'pnpm lint'],
      ['git -C .worktrees/x show HEAD', 'read', 'git show'],
      ['git push -u origin HEAD', 'git-write', 'git push'],
      ['gh pr view 12', 'gh', 'gh pr'],
      ['lumo task status LUM-1 | grep -i done', 'lumo', 'lumo task'],
      ['uv run pytest -x', 'test', 'pytest'],
      ['timeout 60 go test ./...', 'test', 'go test'],
      ['docker compose up -d', 'net', 'docker compose'],
      ['"$D/review-package" --x', 'other', 'review-package'],
      ['sleep 5; echo done', 'other', null],
    ]
    for (const [cmd, category, verb] of cases) {
      expect([cmd, classifyBashCommandDetailed(cmd)]).toEqual([
        cmd,
        { category, verb },
      ])
    }
  })

  it('keeps the label short and free of shell metacharacters', () => {
    const { verb } = classifyBashCommandDetailed(
      `${'x'.repeat(80)}$(evil) --flag`
    )
    expect(verb).not.toBeNull()
    expect(verb!.length).toBeLessThanOrEqual(40)
    expect(verb).toMatch(/^[\w.:/@+ -]+$/)
  })

  it('classifies a Bash payload into category and verb', () => {
    expect(
      classifyBashPayload({
        tool_name: 'Bash',
        tool_input: { command: 'cat a.ts' },
      })
    ).toEqual({ category: 'read', verb: 'cat' })
    expect(classifyBashPayload({ tool_name: 'Read' })).toBeNull()
  })
})
