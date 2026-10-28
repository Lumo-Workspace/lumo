import { EXIT_USAGE } from '../lib/exit-codes'
import { apiCall, apiContext } from '../lib/test-case-api'
import { emitJson, withVersion } from '../lib/json-output'
import {
  emitConfirmation,
  isConfirmed,
  type ConfirmFlags,
} from '../lib/confirmation'

export interface WorkspaceDoneRequirementsOptions extends ConfirmFlags {
  testCase?: string
  review?: string
  json?: boolean
}

/** GET/PATCH /api/workspaces/me/done-requirements (LUM-1334). */
export interface DoneRequirementsView {
  testCase: boolean
  review: boolean
  canEdit: boolean
}

export interface DoneRequirementsUpdate {
  testCase?: boolean
  review?: boolean
}

const PATH = '/api/workspaces/me/done-requirements'

const LABELS: Record<keyof DoneRequirementsUpdate, string> = {
  testCase: 'a passing test case on each PR’s latest commit',
  review: 'a review on each PR’s latest commit',
}

function parseSwitch(flag: string, value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v === 'on') return true
  if (v === 'off') return false
  throw new Error(`invalid ${flag} "${value}". Expected on or off.`)
}

/** The PATCH body the flags ask for, or null when no flag was given. */
export function buildDoneRequirementsUpdate(
  opts: WorkspaceDoneRequirementsOptions
): DoneRequirementsUpdate | null {
  const update: DoneRequirementsUpdate = {}
  if (opts.testCase !== undefined)
    update.testCase = parseSwitch('--test-case', opts.testCase)
  if (opts.review !== undefined)
    update.review = parseSwitch('--review', opts.review)
  return Object.keys(update).length > 0 ? update : null
}

/** One `Will …` line per switch that actually changes. */
export function describeDoneRequirementChanges(
  current: DoneRequirementsView,
  update: DoneRequirementsUpdate
): string[] {
  const lines: string[] = []
  for (const key of ['testCase', 'review'] as const) {
    const next = update[key]
    if (next === undefined || next === current[key]) continue
    lines.push(
      next
        ? `Will require ${LABELS[key]} before DONE — workspace-wide: every member's task with a linked PR is refused DONE until it has one.`
        : `Will stop requiring ${LABELS[key]} before DONE — workspace-wide.`
    )
  }
  return lines
}

export function formatDoneRequirements(v: DoneRequirementsView): string {
  const row = (on: boolean) => (on ? 'on' : 'off')
  return [
    'Done requirements (each linked PR, not closed unmerged, on its latest commit):',
    `  Passing test case:  ${row(v.testCase)}`,
    `  Review:             ${row(v.review)}  (Lumo AI review, an imported agent review, or a GitHub approval)`,
    ...(v.canEdit ? [] : ['  Only workspace owners can change these.']),
  ].join('\n')
}

/**
 * `lumo workspace done-requirements show|update` (LUM-1334). Reading is open
 * to every member; a change is OWNER only and always exit-4 gated — it
 * changes what DONE needs for every member's task.
 */
export async function workspaceDoneRequirements(
  opts: WorkspaceDoneRequirementsOptions = {}
): Promise<number | void> {
  let update: DoneRequirementsUpdate | null
  try {
    update = buildDoneRequirementsUpdate(opts)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return EXIT_USAGE
  }

  const ctx = apiContext()
  if (!ctx) return 1
  const current = await apiCall<DoneRequirementsView>(
    ctx,
    PATH,
    {},
    'done-requirements settings'
  )
  if (!current.ok || !current.data) return 1

  let result = current.data
  if (update) {
    if (!current.data.canEdit) {
      console.error(
        'Error: only workspace owners can change the Done requirements (reading is open to every member).'
      )
      return 1
    }
    const changes = describeDoneRequirementChanges(current.data, update)
    if (changes.length > 0) {
      if (!isConfirmed(opts))
        return emitConfirmation({
          command: 'workspace done-requirements update',
          changes,
        })
      const r = await apiCall<DoneRequirementsView>(
        ctx,
        PATH,
        { method: 'PATCH', json: update },
        'done-requirements update'
      )
      if (!r.ok || !r.data) return 1
      result = r.data
    }
  }

  if (opts.json) {
    emitJson(withVersion(result))
    return
  }
  if (update) process.stdout.write('Done requirements saved.\n\n')
  process.stdout.write(formatDoneRequirements(result) + '\n')
}

/** `update` with no setting is a usage error — reading is `show`. */
export async function workspaceDoneRequirementsUpdate(
  opts: WorkspaceDoneRequirementsOptions = {}
): Promise<number | void> {
  if (opts.testCase === undefined && opts.review === undefined) {
    console.error(
      'Error: nothing to change — pass --test-case on|off and/or --review on|off. Read the settings with `lumo workspace done-requirements show`.'
    )
    return EXIT_USAGE
  }
  return workspaceDoneRequirements(opts)
}
