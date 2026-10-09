import * as fs from 'fs'
import * as path from 'path'

/**
 * LUM-1049: the npm package root doubles as a portable Agent Plugins package
 * (https://developers.openai.com/plugins/build/plugins), so a Codex / ChatGPT
 * marketplace can reference `@lumoai/cli` with an `npm` source. The package
 * root carries `plugin.json` plus `skills/lumo/` — both generated at build
 * time from `.claude/skills/lumo/` (the single source) and package.json, so
 * neither can drift from what `lumo init` installs.
 */

export const AGENT_PLUGINS_SCHEMA =
  'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'

/** Where the bundled skill lives, relative to the CLI package root. */
export const BUNDLED_SKILL_REL = path.join('skills', 'lumo')

type PackageMeta = {
  version: string
  license?: string
}

export type PluginManifest = {
  $schema: string
  name: string
  version: string
  description: string
  author: { name: string; url: string }
  homepage: string
  license?: string
  keywords: string[]
  extensions: {
    'com.openai': {
      interface: {
        displayName: string
        shortDescription: string
        developerName: string
        category: string
        websiteURL: string
      }
    }
  }
}

const SHORT_DESCRIPTION =
  'Lumo tasks, docs, milestones and PR security scans from your coding agent.'

export function buildPluginManifest(pkg: PackageMeta): PluginManifest {
  return {
    $schema: AGENT_PLUGINS_SCHEMA,
    name: 'lumo',
    version: pkg.version,
    description: SHORT_DESCRIPTION,
    author: { name: 'Lumo', url: 'https://www.uselumo.ai' },
    homepage: 'https://www.uselumo.ai',
    ...(pkg.license ? { license: pkg.license } : {}),
    keywords: ['lumo', 'project-management', 'tasks'],
    extensions: {
      'com.openai': {
        interface: {
          displayName: 'Lumo',
          shortDescription: SHORT_DESCRIPTION,
          developerName: 'Lumo',
          category: 'Productivity',
          websiteURL: 'https://www.uselumo.ai',
        },
      },
    },
  }
}

/** Recursively list files under `dir` as paths relative to `base`. */
export function listFiles(dir: string, base: string = dir): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full))
  }
  return out.sort()
}

/**
 * Where the bundled skill lives on disk. `fromDir` is the compiled module dir
 * (`<pkg>/dist/cli/src/lib`), four levels below the package root.
 */
export function bundledSkillDir(fromDir: string = __dirname): string {
  return path.resolve(fromDir, '../../../..', BUNDLED_SKILL_REL)
}

/**
 * Replace `dst` with a copy of `src`. Copies into a sibling temp dir first and
 * only removes the old `dst` at the final rename, so a mid-copy failure leaves
 * the previous copy intact. Returns the relative file list.
 */
export function copySkillTree(src: string, dst: string): string[] {
  const files = listFiles(src)
  const tmp = `${dst}.tmp-${process.pid}`
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
    for (const rel of files) {
      const to = path.join(tmp, rel)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(path.join(src, rel), to)
    }
    fs.rmSync(dst, { recursive: true, force: true })
    fs.renameSync(tmp, dst)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  return files
}

/**
 * Write the plugin bundle into `packageRoot`: a fresh copy of `skillSrcDir`
 * at `skills/lumo/` (stale files removed first) and `plugin.json`.
 */
export function writePluginBundle(
  skillSrcDir: string,
  packageRoot: string,
  pkg: PackageMeta
): { skillFiles: string[] } {
  if (!fs.existsSync(path.join(skillSrcDir, 'SKILL.md'))) {
    throw new Error(`cannot find SKILL.md under ${skillSrcDir}`)
  }
  const skillDst = path.join(packageRoot, BUNDLED_SKILL_REL)
  const skillFiles = copySkillTree(skillSrcDir, skillDst)
  fs.writeFileSync(
    path.join(packageRoot, 'plugin.json'),
    JSON.stringify(buildPluginManifest(pkg), null, 2) + '\n'
  )
  return { skillFiles }
}
