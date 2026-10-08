/**
 * @jest-environment node
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  AGENT_PLUGINS_SCHEMA,
  buildPluginManifest,
  listFiles,
  writePluginBundle,
} from '@/cli/src/lib/codex-plugin'

const repoRoot = join(__dirname, '..', '..')
const skillSrc = join(repoRoot, '.claude', 'skills', 'lumo')
const cliPkg = JSON.parse(
  readFileSync(join(repoRoot, 'cli', 'package.json'), 'utf8')
) as { version: string; license: string }

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lumo-codex-plugin-'))
}

describe('buildPluginManifest', () => {
  it('is a portable Agent Plugins manifest named lumo at the package version', () => {
    const m = buildPluginManifest({ version: '1.2.3', license: 'MIT' })
    expect(m.$schema).toBe(AGENT_PLUGINS_SCHEMA)
    expect(m.name).toBe('lumo')
    expect(m.version).toBe('1.2.3')
    expect(m.license).toBe('MIT')
    expect(m.extensions['com.openai'].interface.displayName).toBe('Lumo')
  })

  it('omits license when the package has none', () => {
    expect('license' in buildPluginManifest({ version: '1.0.0' })).toBe(false)
  })
})

describe('listFiles', () => {
  it('lists nested files relative to the root, sorted', () => {
    const dir = tmp()
    try {
      mkdirSync(join(dir, 'references'))
      writeFileSync(join(dir, 'SKILL.md'), 'x')
      writeFileSync(join(dir, 'references', 'a.md'), 'y')
      expect(listFiles(dir)).toEqual(['SKILL.md', join('references', 'a.md')])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('writePluginBundle', () => {
  it('copies .claude/skills/lumo byte-for-byte into skills/lumo and writes plugin.json', () => {
    const out = tmp()
    try {
      writePluginBundle(skillSrc, out, cliPkg)
      const bundled = join(out, 'skills', 'lumo')
      const srcFiles = listFiles(skillSrc)
      expect(listFiles(bundled)).toEqual(srcFiles)
      for (const rel of srcFiles) {
        expect(
          readFileSync(join(bundled, rel)).equals(
            readFileSync(join(skillSrc, rel))
          )
        ).toBe(true)
      }
      const manifest = JSON.parse(
        readFileSync(join(out, 'plugin.json'), 'utf8')
      )
      expect(manifest).toEqual(buildPluginManifest(cliPkg))
      expect(manifest.version).toBe(cliPkg.version)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('removes stale files from a previous bundle', () => {
    const out = tmp()
    try {
      const stale = join(out, 'skills', 'lumo', 'references', 'gone.md')
      mkdirSync(join(out, 'skills', 'lumo', 'references'), { recursive: true })
      writeFileSync(stale, 'old')
      writePluginBundle(skillSrc, out, cliPkg)
      expect(listFiles(join(out, 'skills', 'lumo'))).not.toContain(
        join('references', 'gone.md')
      )
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('throws when the source has no SKILL.md', () => {
    const src = tmp()
    const out = tmp()
    try {
      expect(() => writePluginBundle(src, out, cliPkg)).toThrow(/SKILL\.md/)
    } finally {
      rmSync(src, { recursive: true, force: true })
      rmSync(out, { recursive: true, force: true })
    }
  })
})
