/**
 * LUM-1260 — the one place that says how far each feature has rolled out.
 *
 *   off      nobody (also the emergency off switch: set it and deploy)
 *   dogfood  the dogfood cohort only (`LUMO_DOGFOOD_WORKSPACE_IDS`)
 *   beta     the beta cohort (`LUMO_BETA_WORKSPACE_IDS`) plus dogfood
 *   public   every workspace
 *
 * Promoting a feature is a one-line PR here. Workspace ids never go in this
 * file: `lib/` ships in the open-source snapshot, so the cohorts come from
 * env. Check a feature on the server with `isFeatureEnabled` from
 * `./is-enabled` and pass the boolean down; the client never reads this.
 */
export type FeatureStage = 'off' | 'dogfood' | 'beta' | 'public'

export const FEATURES = {
  /** LUM-1234 — the "Agent behavior" PR scan layer. */
  'reward-hack-scan': { stage: 'dogfood' },
  /** LUM-1315 — Codeup as a second Git provider (connection, webhook, MR links). */
  'codeup-integration': { stage: 'dogfood' },
  /** LUM-1341 — Feishu / Lark connection (self-built app, our own tenant). */
  'feishu-integration': { stage: 'dogfood' },
} as const satisfies Record<string, { stage: FeatureStage }>

export type FeatureKey = keyof typeof FEATURES
