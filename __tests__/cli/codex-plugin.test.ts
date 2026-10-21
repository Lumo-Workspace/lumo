/**
 * @jest-environment node
 */
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  AGENT_PLUGINS_SCHEMA,
  buildPluginManifest,
  bundledSkillDir,
  copySkillTree,
  listFiles,
  writePluginBundle,
} from '@/cli/src/lib/codex-plugin'

const repoRoot = join(__dirname, '..', '..')
const skillSrc = join(repoRoot, 'cli', 'skill')
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
  it('copies cli/skill byte-for-byte into skills/lumo and writes plugin.json', () => {
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

describe('bundledSkillDir', () => {
  it('resolves to <pkg>/skill from the compiled lib depth', () => {
    const pkg = tmp()
    writeFileSync(join(pkg, 'package.json'), '{"name":"@lumoai/cli"}')
    const lib = join(pkg, 'dist', 'cli', 'src', 'lib')
    mkdirSync(lib, { recursive: true })
    expect(bundledSkillDir(lib)).toBe(join(pkg, 'skill'))
  })
})

describe('copySkillTree', () => {
  it('replaces the destination wholesale, dropping stale files', () => {
    const root = tmp()
    const src = join(root, 'src')
    const dst = join(root, 'out', 'lumo')
    mkdirSync(join(src, 'references'), { recursive: true })
    writeFileSync(join(src, 'SKILL.md'), 'new')
    writeFileSync(join(src, 'references', 'a.md'), 'a')
    mkdirSync(dst, { recursive: true })
    writeFileSync(join(dst, 'stale.md'), 'x')
    expect(copySkillTree(src, dst)).toEqual(['SKILL.md', 'references/a.md'])
    expect(listFiles(dst)).toEqual(['SKILL.md', 'references/a.md'])
    expect(readdirSync(join(root, 'out'))).toEqual(['lumo'])
    rmSync(root, { recursive: true, force: true })
  })

  it('leaves the old copy intact when the copy fails midway', () => {
    const root = tmp()
    const src = join(root, 'src')
    const dst = join(root, 'lumo')
    mkdirSync(src)
    writeFileSync(join(src, 'SKILL.md'), 'new')
    mkdirSync(dst)
    writeFileSync(join(dst, 'SKILL.md'), 'old')
    // force a mid-copy failure with an unreadable source file
    writeFileSync(join(src, 'z.md'), 'z')
    chmodSync(join(src, 'z.md'), 0o000)
    if (process.getuid && process.getuid() !== 0) {
      expect(() => copySkillTree(src, dst)).toThrow()
      expect(readFileSync(join(dst, 'SKILL.md'), 'utf8')).toBe('old')
      expect(readdirSync(root).sort()).toEqual(['lumo', 'src'])
    }
    chmodSync(join(src, 'z.md'), 0o644)
    rmSync(root, { recursive: true, force: true })
  })
})
