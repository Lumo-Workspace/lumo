#!/usr/bin/env node
// Copy runtime assets from the source-of-truth locations in the monorepo
// into cli/assets/ so they ship in the npm tarball. Runs from `npm run
// build`. Portable across macOS / Linux / Windows (avoids shell-specific
// cp / xcopy syntax).
'use strict'

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..', '..')
const cliRoot = path.resolve(__dirname, '..')
const assetsDir = path.join(cliRoot, 'assets')

fs.mkdirSync(assetsDir, { recursive: true })

// The lumo skill is now a directory (SKILL.md + references/*.md), so copy the
// whole tree into cli/assets/skill/ rather than a single file. `setup`
// installs this directory verbatim into <scope>/.claude/skills/lumo/.
const skillSrcDir = path.join(repoRoot, '.claude', 'skills', 'lumo')
const skillDstDir = path.join(assetsDir, 'skill')

if (!fs.existsSync(path.join(skillSrcDir, 'SKILL.md'))) {
  console.error(`bundle-assets: cannot find SKILL.md under ${skillSrcDir}`)
  process.exit(1)
}

// Recursively copy a directory tree (markdown-only skill assets). Removes any
// stale destination first so deleted reference files don't linger in the
// bundle.
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d)
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d)
    }
  }
}

fs.rmSync(skillDstDir, { recursive: true, force: true })
copyDir(skillSrcDir, skillDstDir)
console.log(`bundle-assets: ${skillSrcDir} → ${skillDstDir}`)
