import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * LUM-676: the plan-run routes that trigger a slow reasoning-model LLM stage
 * must export a `maxDuration` with headroom over the ~70s clustering call, or
 * the serverless function inherits the ~60s platform default and is killed
 * mid-call → the run lands FAILED.
 *
 * Next.js extracts route-segment config (`maxDuration`) by static analysis and
 * requires it to be a literal, so a source-level assertion faithfully mirrors
 * what the platform sees — and avoids importing the routes' prisma-backed
 * service graph into jest.
 */

const REPO_ROOT = join(__dirname, '..', '..')

// Must clear the ~70s clustering call with real headroom.
const MIN_MAX_DURATION = 180

const LLM_STAGE_ROUTES = [
  {
    stage: 'Stage-1 (聚类)',
    file: 'app/api/plan-runs/route.ts',
  },
  {
    stage: 'Stage-2 (对齐)',
    file: 'app/api/plan-runs/[runId]/gate/cluster/route.ts',
  },
  {
    stage: 'Stage-3 (生成)',
    file: 'app/api/plan-runs/[runId]/gate/align/route.ts',
  },
] as const

function readMaxDuration(relativePath: string): number | null {
  const source = readFileSync(join(REPO_ROOT, relativePath), 'utf8')
  const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/)
  return match ? Number(match[1]) : null
}

describe('plan-run LLM-stage routes export maxDuration (LUM-676)', () => {
  it.each(LLM_STAGE_ROUTES)(
    '$stage ($file) exports maxDuration >= 180',
    ({ file }) => {
      const value = readMaxDuration(file)
      expect(value).not.toBeNull()
      expect(value).toBeGreaterThanOrEqual(MIN_MAX_DURATION)
    }
  )
})
