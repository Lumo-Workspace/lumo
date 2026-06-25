import {
  matchPathGlob,
  matchCmdSubstr,
  matchDiffRegex,
} from '@/lib/services/policy/predicate-eval'

test('path-glob matches changed paths under a glob', () => {
  expect(matchPathGlob('legacy/**', ['src/a.ts', 'legacy/b.ts'])).toBe(true)
  expect(matchPathGlob('legacy/**', ['src/a.ts'])).toBe(false)
})

test('path-glob single-star does not cross segment boundary', () => {
  expect(matchPathGlob('src/*.ts', ['src/a.ts'])).toBe(true)
  expect(matchPathGlob('src/*.ts', ['src/sub/a.ts'])).toBe(false)
})

test('path-glob double-star matches nested paths', () => {
  expect(matchPathGlob('src/**/*.ts', ['src/deep/nested/a.ts'])).toBe(true)
  expect(matchPathGlob('src/**/*.ts', ['other/a.ts'])).toBe(false)
})

test('cmd-substr matches a literal substring in a command', () => {
  expect(matchCmdSubstr('rm -rf /', 'sudo rm -rf / now')).toBe(true)
  expect(matchCmdSubstr('rm -rf /', 'echo safe')).toBe(false)
})

test('diff-regex flags added lines only not pre-existing base lines', () => {
  // addedLines = lines beginning with '+' in a unified diff, stripped of the leading '+'
  const added = ['  console.log("new")']
  expect(matchDiffRegex('console\\.log', added).matched).toBe(true)
  expect(matchDiffRegex('console\\.log', []).matched).toBe(false)
})

test('diff-regex returns the matched line', () => {
  const added = ['safe line', 'eval("danger")']
  const result = matchDiffRegex('eval\\(', added)
  expect(result.matched).toBe(true)
  expect(result.line).toBe('eval("danger")')
})

test('diff-regex returns matched:false for invalid regex', () => {
  const result = matchDiffRegex('[invalid(', ['anything'])
  expect(result.matched).toBe(false)
  expect(result.line).toBeUndefined()
})

test('diff-regex returns matched:false for regex exceeding 200 chars (ReDoS guard)', () => {
  const longRe = 'a'.repeat(201)
  const result = matchDiffRegex(longRe, ['aaaaaaaaaa'])
  expect(result.matched).toBe(false)
})
