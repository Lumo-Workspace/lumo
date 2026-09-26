import {
  BASH_CATEGORIES,
  BASH_CATEGORY_LABEL,
  classifyBashCommand,
  isBashCategory,
  toolDetailFromPayload,
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
    ['npm install', 'other'],
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
    // Plumbing and bare variable assignments are still not commands.
    expect(classifyBashCommand('S=/tmp/x; echo hi; cat $S/a')).toBe('read')
    expect(classifyBashCommand('cd /repo && sleep 2 && ls')).toBe('read')
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
