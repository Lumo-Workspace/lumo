/**
 * @jest-environment node
 *
 * LUM-1014 / LUM-1066: the app, the CLI and shared/ are licensed under MIT
 * (MIT open-core ruling 2026-10-10).
 * Guards that the LICENSE files, package.json fields and the CLI's npm
 * `files` allowlist stay consistent with each other.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const repo = join(__dirname, '../..')
const read = (p: string) => readFileSync(join(repo, p), 'utf8')
const json = (p: string) => JSON.parse(read(p)) as Record<string, unknown>

describe('project license (LUM-1014, LUM-1066)', () => {
  it('root LICENSE is the MIT License for Lumo AI (LUM-1066)', () => {
    const text = read('LICENSE')
    const mit = read('cli/LICENSE')
    // The license text itself is exactly the MIT text cli/ and shared/ ship.
    expect(text.endsWith(mit)).toBe(true)
    // The private repository prepends a scope note for the proprietary ee/
    // plugin; the open-source snapshot has no ee/ and ships MIT alone
    // (oss/overlay/LICENSE).
    if (!existsSync(join(repo, 'ee'))) expect(text).toBe(mit)
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
    expect(json('package.json').license).toBe('MIT')
    expect(json('cli/package.json').license).toBe('MIT')
    expect(json('shared/package.json').license).toBe('MIT')
    const lock = json('package-lock.json') as {
      packages: Record<string, { license?: string }>
    }
    expect(lock.packages['']?.license).toBe('MIT')
    expect(lock.packages['cli']?.license).toBe('MIT')
    expect(lock.packages['shared']?.license).toBe('MIT')
  })

  it('the CLI npm package ships its LICENSE', () => {
    expect(json('cli/package.json').files).toContain('LICENSE')
  })
})
