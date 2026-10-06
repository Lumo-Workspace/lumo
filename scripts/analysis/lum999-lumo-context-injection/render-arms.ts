/**
 * LUM-999 — run render-harness.ts inside an arm worktree (origin/main or the
 * PR #1290 head) so every variant is rendered by THAT tree's real code.
 *
 * The harness + fixtures are copied into `<tree>/__lum999__/` and jest runs
 * with the tree's own config (`@/` → that tree). Nothing in the tree's
 * tracked files is touched.
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { TaskFixture } from './fixtures'
import type { RenderedVariant } from './render-harness'

export interface ArmRender extends RenderedVariant {
  sha256: string
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function gitHead(tree: string): string {
  const r = spawnSync('git', ['-C', tree, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error(`git rev-parse failed in ${tree}`)
  return r.stdout.trim()
}

/** Anything with an id and a fixture renders (LUM-999 and LUM-1003 variants). */
export interface RenderableVariant {
  id: string
  fixture: TaskFixture
}

export function renderArm(
  tree: string,
  variants: RenderableVariant[],
  workDir: string
): ArmRender[] {
  const harnessDir = join(tree, '__lum999__')
  mkdirSync(harnessDir, { recursive: true })
  for (const f of ['render-harness.ts', 'fixtures.ts']) {
    copyFileSync(join(__dirname, f), join(harnessDir, f))
  }
  mkdirSync(workDir, { recursive: true })
  const variantsPath = join(workDir, 'variants.json')
  const outPath = join(workDir, 'rendered.json')
  writeFileSync(variantsPath, JSON.stringify(variants))
  const r = spawnSync(
    'npx',
    [
      'jest',
      '--rootDir',
      tree,
      '--roots',
      harnessDir,
      '--testRegex',
      'render-harness\\.ts$',
      '--ci',
    ],
    {
      cwd: tree,
      encoding: 'utf8',
      env: {
        ...process.env,
        LUM999_VARIANTS: variantsPath,
        LUM999_OUT: outPath,
      },
    }
  )
  writeFileSync(join(workDir, 'jest.log'), `${r.stdout}\n${r.stderr}`)
  if (r.status !== 0) {
    throw new Error(`render harness failed in ${tree}; see ${workDir}/jest.log`)
  }
  const rendered = JSON.parse(
    readFileSync(outPath, 'utf8')
  ) as RenderedVariant[]
  return rendered.map(x => ({ ...x, sha256: sha256(x.markdown) }))
}
