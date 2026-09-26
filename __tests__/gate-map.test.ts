import { checkInvocations, isCheckCommand } from '../shared/src/gate-map'

describe('isCheckCommand', () => {
  it('recognizes real check invocations', () => {
    expect(isCheckCommand('tsc --noEmit')).toBe(true)
    expect(isCheckCommand('cd /x && npx tsc --noEmit')).toBe(true)
    expect(isCheckCommand('npx jest foo.test.ts')).toBe(true)
    expect(isCheckCommand('npx vitest run')).toBe(true)
    expect(isCheckCommand('npm test')).toBe(true)
    expect(isCheckCommand('npm run typecheck')).toBe(true)
    expect(isCheckCommand('cd /x && npm run build')).toBe(true)
    expect(isCheckCommand('npx next build')).toBe(true)
    expect(isCheckCommand('node --check foo.js')).toBe(false)
    expect(isCheckCommand('ls -la')).toBe(false)
  })

  it('treats a chained command as one check command', () => {
    expect(
      isCheckCommand('npx jest __tests__/x.test.ts; npx tsc --noEmit')
    ).toBe(true)
  })

  it('does NOT recognize check keywords that only appear inside quoted text', () => {
    // The LUM-614 prod bug: a `lumo task create` whose description discusses
    // checks ("parse/typecheck/build/test") was taken for a check run.
    expect(
      isCheckCommand(
        'lumo task create "机械门闸:执行类 gate(parse/typecheck/build/test)" --new-scope'
      )
    ).toBe(false)
    expect(
      isCheckCommand(
        'echo "===run same test on main===" && git branch --show-current'
      )
    ).toBe(false)
    expect(isCheckCommand("git commit -m 'fix build'")).toBe(false)
    expect(isCheckCommand('cat package.json | grep test')).toBe(false)
  })
})

describe('checkInvocations', () => {
  it('ignores a check word inside a heredoc body but keeps the commands after it', () => {
    const cmd = [
      "cat > __tests__/x.test.ts <<'EOF'",
      "it('runs jest', () => { expect(run('npx tsc --noEmit')).toBe(0) })",
      'EOF',
      'npx jest __tests__/x.test.ts 2>&1 | tail -5',
    ].join('\n')
    expect(checkInvocations(cmd)).toEqual(['npx jest __tests__/x.test.ts 2>&1'])
    expect(
      checkInvocations(
        "git commit -F - <<'EOF'\nfix: make jest and tsc pass\nEOF"
      )
    ).toEqual([])
    expect(
      checkInvocations('cat <<-EOF > notes.txt\n\tnpx jest\n\tEOF\necho done')
    ).toEqual([])
  })

  it('does not count a check word in a file path or argument', () => {
    expect(checkInvocations('cat scripts/jest-t.ts | head -30')).toEqual([])
    expect(
      checkInvocations(
        'lumo task testcase run X --evidence-file /tmp/tc1-jest.log'
      )
    ).toEqual([])
    expect(
      checkInvocations('git diff -- tsconfig.json jest.config.js')
    ).toEqual([])
    expect(checkInvocations('grep -rn vitest package.json')).toEqual([])
  })

  it('recognizes checks behind prefixes, wrappers and package managers', () => {
    expect(checkInvocations('CI=1 npx jest --ci')).toEqual([
      'CI=1 npx jest --ci',
    ])
    expect(checkInvocations('npx -y tsc -p .')).toEqual(['npx -y tsc -p .'])
    expect(checkInvocations('pnpm exec vitest run')).toEqual([
      'pnpm exec vitest run',
    ])
    expect(checkInvocations('npm run test:unit')).toEqual(['npm run test:unit'])
    expect(checkInvocations('yarn build')).toEqual(['yarn build'])
    expect(checkInvocations('npm run lint')).toEqual([])
    expect(checkInvocations('./node_modules/.bin/jest a.test.ts')).toEqual([
      './node_modules/.bin/jest a.test.ts',
    ])
    expect(
      checkInvocations('for f in a b; do npx tsx scripts/jest-t.ts "$f"; done')
    ).toEqual(['npx tsx scripts/jest-t.ts "$f"'])
  })

  it('keeps a redirection with an ampersand inside one command', () => {
    expect(
      checkInvocations('npx jest 2>&1 | tail -3 && npx tsc &>/dev/null')
    ).toEqual(['npx jest 2>&1', 'npx tsc &>/dev/null'])
  })

  it('treats a here-string as a command, not a heredoc', () => {
    expect(checkInvocations('cat <<< "hello"\nnpx jest')).toEqual(['npx jest'])
  })
})
