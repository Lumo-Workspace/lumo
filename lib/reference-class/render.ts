import { sanitizeField } from '@/shared/src/sanitize'
import {
  CROSSING_LABELS,
  labelFor,
  REJECTION_LABELS,
  selectReflectionPrompt,
} from './copy'
import type { AnchorData, ReferenceClassAnchor, TallyEntry } from './types'

export const ANCHOR_HEADING = '### Reference class (outside view)'

/**
 * Heading + "Based on" + at most 3 signal lines + at most 1 question. The cap
 * is a design constraint, not a coincidence: a resizable anchor competes with
 * the contract itself for the agent's attention.
 */
export const ANCHOR_MAX_LINES = 6

const SCOPE_NOUN: Record<AnchorData['level'], string> = {
  MILESTONE: 'milestone',
  PROJECT: 'project',
  WORKSPACE: 'workspace',
}

/** `evidence insufficient 5/14 · scope mismatch 3/14` */
function tallyLine(
  entries: TallyEntry[],
  labels: Record<string, string>,
  size: number
): string {
  return entries
    .map(e => `${labelFor(labels, e.key)} ${e.count}/${size}`)
    .join(' · ')
}

/**
 * Render the outside-view anchor appended to the criteria draft nudge.
 *
 * Counts are raw fractions on purpose — a percentage over a 9-task class reads
 * as a rate while carrying nothing. An absent signal drops its line rather than
 * printing `0/14`; a class with no signals at all still states its basis, so a
 * clean history is reported as a fact rather than looking like missing data.
 */
export function renderReferenceClassAnchor(
  anchor: ReferenceClassAnchor
): string {
  if (anchor.kind === 'INSUFFICIENT') {
    return [
      ANCHOR_HEADING,
      '',
      'Insufficient sample: milestone, project and workspace all hold fewer than 8 delivered tasks, so no distribution is reported.',
    ].join('\n')
  }

  const { level, label, size, rejections, crossings, postStartContractTasks } =
    anchor
  const lines: string[] = [
    ANCHOR_HEADING,
    '',
    `Based on: ${size} delivered tasks in ${SCOPE_NOUN[level]} "${sanitizeField(label)}"`,
    '',
  ]

  const signals: string[] = []
  if (rejections.length > 0) {
    signals.push(
      `· Most common send-back reasons: ${tallyLine(rejections, REJECTION_LABELS, size)}`
    )
  }
  if (postStartContractTasks > 0) {
    signals.push(
      `· Contract still being written after work started: ${postStartContractTasks}/${size} deliveries`
    )
  }
  if (crossings.length > 0) {
    signals.push(
      `· Most common boundary crossing: ${tallyLine(crossings, CROSSING_LABELS, size)}`
    )
  }

  if (signals.length === 0) {
    lines.push(
      '· This class has no recorded send-backs, post-start contract edits or boundary crossings.'
    )
    return lines.join('\n').trimEnd()
  }

  lines.push(...signals)

  const prompt = selectReflectionPrompt(rejections, crossings)
  if (prompt) lines.push('', prompt)

  return lines.join('\n').trimEnd()
}
