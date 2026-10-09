#!/usr/bin/env node
// One-off generator (NOT part of `npm run build`): hash the bundled skill of
// every published @lumoai/cli version into src/lib/skill-version-hashes.json
// ({ "sha256:<hex>": "<lowest version with that content>" }). Used by
// install-state to recognise unmarked legacy installs as managed.
//
// Usage: cd cli && npx tsc && node scripts/gen-skill-hashes.js
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const cliRoot = path.resolve(__dirname, '..')
const { hashSkillDir } = require(
  path.join(cliRoot, 'dist', 'cli', 'src', 'lib', 'skill-hash.js')
)
const outFile = path.join(cliRoot, 'src', 'lib', 'skill-version-hashes.json')

// New versions ship skills/lumo; older ones assets/skill.
const SKILL_LOCATIONS = [
  ['skills', 'lumo'],
  ['assets', 'skill'],
]

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

const versions = JSON.parse(
  execFileSync('npm', ['view', '@lumoai/cli', 'versions', '--json'], {
    encoding: 'utf8',
  })
)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-skill-hashes-'))
const table = {}
let hashed = 0
const skipped = []

try {
  for (const v of versions) {
    const dir = path.join(tmp, v)
    try {
      fs.mkdirSync(dir)
      execFileSync('npm', ['pack', `@lumoai/cli@${v}`, '--silent'], {
        cwd: dir,
        stdio: 'ignore',
      })
      const tgz = fs.readdirSync(dir).find(f => f.endsWith('.tgz'))
      execFileSync('tar', ['xzf', tgz], { cwd: dir })
      const skillDir = SKILL_LOCATIONS.map(p =>
        path.join(dir, 'package', ...p)
      ).find(p => fs.existsSync(path.join(p, 'SKILL.md')))
      if (!skillDir) {
        skipped.push(`${v} (no skill dir)`)
        continue
      }
      const h = hashSkillDir(skillDir)
      if (!table[h] || cmpVersion(v, table[h]) < 0) table[h] = v
      hashed++
    } catch (err) {
      skipped.push(`${v} (${err.message.split('\n')[0]})`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

const sorted = Object.fromEntries(
  Object.entries(table).sort(
    (a, b) => cmpVersion(a[1], b[1]) || a[0].localeCompare(b[0])
  )
)
fs.writeFileSync(outFile, JSON.stringify(sorted, null, 2) + '\n')
process.stdout.write(
  `hashed ${hashed}/${versions.length} versions, ${Object.keys(sorted).length} distinct hashes; skipped ${skipped.length}\n`
)
for (const s of skipped) process.stdout.write(`  skipped ${s}\n`)
