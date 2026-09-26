import { isCheckCommand } from '../shared/src/gate-map'

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
