/**
 * LUM-1338 — the workspace's AI feature switches, in three levels: one master
 * switch, one switch per group, one per feature. A feature runs only when the
 * deployment has a model configured (`isAiConfigured`) and all three of its
 * switches are on.
 *
 * Stored sparse on `Workspace.aiFeatureSwitches`: only the switches an OWNER
 * turned off are written, so every switch defaults to on and a workspace that
 * never touched them keeps its behaviour.
 *
 * No SDK or server imports here: the settings page and the server both
 * resolve with this module.
 */

/** Error codes an AI entry point is refused with (API `code`). */
export const AI_FEATURE_OFF_CODE = 'AI_FEATURE_OFF'
export const AI_NOT_CONFIGURED_CODE = 'AI_NOT_CONFIGURED'

/** Pure: whether an API error `code` means "AI is off here", not a failure. */
export function isAiOffCode(code: string | undefined): boolean {
  return code === AI_FEATURE_OFF_CODE || code === AI_NOT_CONFIGURED_CODE
}

export const AI_FEATURE_GROUPS = [
  'assist',
  'summaries',
  'memory',
  'review',
] as const
export type AiFeatureGroup = (typeof AI_FEATURE_GROUPS)[number]

/** Every feature, in the order the settings page lists them, by group. */
export const AI_FEATURES = {
  // Task creation helpers
  taskDescription: 'assist',
  prioritySuggestion: 'assist',
  duplicateCheck: 'assist',
  quickDispatch: 'assist',
  // Summaries
  contentSummary: 'summaries',
  turnSummary: 'summaries',
  sessionSummary: 'summaries',
  runSummary: 'summaries',
  retroSummary: 'summaries',
  // Memory
  memoryExtraction: 'memory',
  memoryConsolidation: 'memory',
  memoryAssist: 'memory',
  memoryRanking: 'memory',
  // Code review
  claimCheck: 'review',
  prCodeReview: 'review',
} as const satisfies Record<string, AiFeatureGroup>

export type AiFeature = keyof typeof AI_FEATURES

export const AI_FEATURE_KEYS = Object.keys(AI_FEATURES) as AiFeature[]

/** Features that exist only when a plugin provides them (the security plugin). */
export const PLUGIN_AI_FEATURES: readonly AiFeature[] = ['prCodeReview']

export interface AiFeatureSwitches {
  master?: boolean
  groups?: Partial<Record<AiFeatureGroup, boolean>>
  features?: Partial<Record<AiFeature, boolean>>
}

/** A switch as the settings API addresses it. */
export type AiSwitchKey =
  | { level: 'master' }
  | { level: 'group'; key: AiFeatureGroup }
  | { level: 'feature'; key: AiFeature }

export function isAiFeature(value: unknown): value is AiFeature {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(AI_FEATURES, value)
  )
}

export function isAiFeatureGroup(value: unknown): value is AiFeatureGroup {
  return (
    typeof value === 'string' &&
    (AI_FEATURE_GROUPS as readonly string[]).includes(value)
  )
}

function booleanEntries<K extends string>(
  raw: unknown,
  isKey: (k: unknown) => k is K
): Partial<Record<K, boolean>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Partial<Record<K, boolean>> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (isKey(k) && typeof v === 'boolean') out[k] = v
  }
  return out
}

/**
 * Pure: the stored JSON as switches. Unknown keys and non-boolean values are
 * dropped, so a hand-edited or older row never breaks a read.
 */
export function parseAiFeatureSwitches(raw: unknown): AiFeatureSwitches {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const obj = raw as Record<string, unknown>
  const out: AiFeatureSwitches = {}
  if (typeof obj.master === 'boolean') out.master = obj.master
  const groups = booleanEntries(obj.groups, isAiFeatureGroup)
  if (Object.keys(groups).length > 0) out.groups = groups
  const features = booleanEntries(obj.features, isAiFeature)
  if (Object.keys(features).length > 0) out.features = features
  return out
}

/** Pure: the switch's own position (on unless turned off). */
export function switchOn(
  switches: AiFeatureSwitches,
  key: AiSwitchKey
): boolean {
  if (key.level === 'master') return switches.master !== false
  if (key.level === 'group') return switches.groups?.[key.key] !== false
  return switches.features?.[key.key] !== false
}

/** Pure: switches with one switch set. On is stored as absent (the default). */
export function withSwitch(
  switches: AiFeatureSwitches,
  key: AiSwitchKey,
  enabled: boolean
): AiFeatureSwitches {
  const next: AiFeatureSwitches = {
    ...switches,
    groups: { ...switches.groups },
    features: { ...switches.features },
  }
  if (key.level === 'master') {
    if (enabled) delete next.master
    else next.master = false
  } else if (key.level === 'group') {
    if (enabled) delete next.groups![key.key]
    else next.groups![key.key] = false
  } else if (enabled) delete next.features![key.key]
  else next.features![key.key] = false
  if (Object.keys(next.groups!).length === 0) delete next.groups
  if (Object.keys(next.features!).length === 0) delete next.features
  return next
}

/** Pure: whether `feature` runs, given the deployment and the switches. */
export function isAiFeatureOn(
  switches: AiFeatureSwitches,
  feature: AiFeature,
  aiConfigured: boolean
): boolean {
  return (
    aiConfigured &&
    switchOn(switches, { level: 'master' }) &&
    switchOn(switches, { level: 'group', key: AI_FEATURES[feature] }) &&
    switchOn(switches, { level: 'feature', key: feature })
  )
}

/** Pure: every feature's effective state. */
export function resolveAiFeatures(
  switches: AiFeatureSwitches,
  aiConfigured: boolean
): Record<AiFeature, boolean> {
  return Object.fromEntries(
    AI_FEATURE_KEYS.map(f => [f, isAiFeatureOn(switches, f, aiConfigured)])
  ) as Record<AiFeature, boolean>
}
