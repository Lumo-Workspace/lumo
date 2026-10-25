import { FEATURES, type FeatureKey, type FeatureStage } from './config'

type Env = Record<string, string | undefined>

type CohortVar = 'LUMO_DOGFOOD_WORKSPACE_IDS' | 'LUMO_BETA_WORKSPACE_IDS'

/**
 * The workspace ids in a comma-separated cohort env var. Unset or blank means
 * an empty cohort, so dogfood and beta features stay off (self-hosted
 * installs only ever see public features).
 */
export function featureCohort(
  name: CohortVar,
  env: Env = process.env
): Set<string> {
  return new Set(
    (env[name] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
  )
}

/** Whether a stage is on for one workspace. No workspace gets only public. */
export function isStageEnabled(
  stage: FeatureStage,
  workspaceId: string | null | undefined,
  env: Env = process.env
): boolean {
  if (stage === 'public') return true
  if (stage === 'off' || !workspaceId) return false
  if (featureCohort('LUMO_DOGFOOD_WORKSPACE_IDS', env).has(workspaceId))
    return true
  return (
    stage === 'beta' &&
    featureCohort('LUMO_BETA_WORKSPACE_IDS', env).has(workspaceId)
  )
}

/**
 * A feature's configured stage, widened to `FeatureStage` so a caller can
 * ask "is it off everywhere?" without knowing today's literal stage.
 */
export function featureStage(key: FeatureKey): FeatureStage {
  return FEATURES[key].stage
}

/**
 * Whether a feature is on for one workspace, per its stage in `./config`.
 * Server-side only: env is read on every call.
 */
export function isFeatureEnabled(
  key: FeatureKey,
  workspaceId: string | null | undefined,
  env: Env = process.env
): boolean {
  const stage: FeatureStage = FEATURES[key].stage
  return isStageEnabled(stage, workspaceId, env)
}
