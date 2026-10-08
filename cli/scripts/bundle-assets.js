#!/usr/bin/env node
// Copy runtime assets from the source-of-truth locations in the monorepo
// into the CLI package root so they ship in the npm tarball. Runs from `npm
// run build`, after tsc. Portable across macOS / Linux / Windows (avoids
// shell-specific cp / xcopy syntax).
'use strict'

const path = require('path')

const repoRoot = path.resolve(__dirname, '..', '..')
const cliRoot = path.resolve(__dirname, '..')

// The lumo skill (SKILL.md + references/*.md) is copied to cli/skills/lumo/,
// next to a generated plugin.json, so the package root is also a portable
// Agent Plugins package (LUM-1049). `setup` installs that same skills/lumo/
// directory into .claude/skills/lumo/ or .agents/skills/lumo/.
const { writePluginBundle } = require(
  path.join(cliRoot, 'dist', 'cli', 'src', 'lib', 'codex-plugin.js')
)
const pkg = require(path.join(cliRoot, 'package.json'))
const skillSrcDir = path.join(repoRoot, '.claude', 'skills', 'lumo')

try {
  const { skillFiles } = writePluginBundle(skillSrcDir, cliRoot, {
    version: pkg.version,
    license: pkg.license,
  })
  process.stdout.write(
    `bundle-assets: ${skillSrcDir} → ${path.join(cliRoot, 'skills', 'lumo')} (${skillFiles.length} files) + plugin.json\n`
  )
} catch (err) {
  process.stderr.write(`bundle-assets: ${err.message}\n`)
  process.exit(1)
}
