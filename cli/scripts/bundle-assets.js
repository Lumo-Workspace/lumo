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

const skillSrc = path.join(repoRoot, '.claude', 'skills', 'lumo', 'SKILL.md')
const skillDst = path.join(assetsDir, 'skill.md')

if (!fs.existsSync(skillSrc)) {
  console.error(`bundle-assets: cannot find ${skillSrc}`)
  process.exit(1)
}

fs.copyFileSync(skillSrc, skillDst)
console.log(`bundle-assets: ${skillSrc} → ${skillDst}`)
