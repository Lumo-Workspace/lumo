/**
 * @jest-environment node
 *
 * LUM-1014: the app is licensed under Elastic-2.0 and the CLI under MIT.
 * Guards that the LICENSE files, package.json fields and the CLI's npm
 * `files` allowlist stay consistent with each other.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const repo = join(__dirname, '../..')
const read = (p: string) => readFileSync(join(repo, p), 'utf8')
const json = (p: string) => JSON.parse(read(p)) as Record<string, unknown>

describe('project license (LUM-1014)', () => {
  it('root LICENSE carries the Lumo AI licensor line and the Elastic License 2.0 text', () => {
    const text = read('LICENSE')
    expect(text.startsWith('Copyright 2026 Lumo AI\n')).toBe(true)
    expect(text).toContain('\nElastic License 2.0\n')
    expect(text).toContain(
      'You may not provide the software to third parties as a hosted or managed'
    )
    // Scope note: cli/, shared/ and the skill files are MIT, each pointing at its LICENSE.
    const scope = text.slice(0, text.indexOf('\nElastic License 2.0\n'))
    expect(scope).toContain('licensed under the MIT License instead')
    expect(scope).toMatch(/- cli\/ [^]*see cli\/LICENSE/)
    expect(scope).toMatch(/- shared\/ [^]*see shared\/LICENSE/)
    expect(scope).toMatch(/- \.claude\/skills\/lumo [^]*see cli\/LICENSE/)
  })

  it.each(['cli/LICENSE', 'shared/LICENSE'])(
    '%s is the MIT License for Lumo AI',
    file => {
      const text = read(file)
      expect(
        text.startsWith('MIT License\n\nCopyright (c) 2026 Lumo AI\n')
      ).toBe(true)
      expect(text).toContain('Permission is hereby granted, free of charge')
    }
  )

  it('cli/LICENSE and shared/LICENSE are the same MIT text', () => {
    expect(read('shared/LICENSE')).toBe(read('cli/LICENSE'))
  })

  it('package.json license fields match the LICENSE files', () => {
    expect(json('package.json').license).toBe('Elastic-2.0')
    expect(json('cli/package.json').license).toBe('MIT')
    expect(json('shared/package.json').license).toBe('MIT')
    const lock = json('package-lock.json') as {
      packages: Record<string, { license?: string }>
    }
    expect(lock.packages['']?.license).toBe('Elastic-2.0')
    expect(lock.packages['cli']?.license).toBe('MIT')
    expect(lock.packages['shared']?.license).toBe('MIT')
  })

  it('the CLI npm package ships its LICENSE', () => {
    expect(json('cli/package.json').files).toContain('LICENSE')
  })
})
