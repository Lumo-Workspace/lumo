import {
  FEEDBACK_EVIDENCE_ALLOWED_TYPES,
  FEEDBACK_EVIDENCE_MAX_BYTES,
  MAX_FEEDBACK_EVIDENCE_FILES,
  type FeedbackKindValue,
} from '@/lib/validation/feedback'
import type { FeedbackCreateInput } from '@/lib/api-client/feedback'

/**
 * LUM-1287: the web feedback form's rules, kept out of the component so they
 * can be tested on their own. Limits come from LUM-1240's validation module,
 * so the form refuses exactly what the server would.
 */

/** Evidence types the form offers: the server's list, images only. */
export const FEEDBACK_SCREENSHOT_TYPES: readonly string[] =
  FEEDBACK_EVIDENCE_ALLOWED_TYPES.filter(t => t.startsWith('image/'))

export const FEEDBACK_SCREENSHOT_MAX_MB =
  FEEDBACK_EVIDENCE_MAX_BYTES / (1024 * 1024)

export type ScreenshotProblem =
  | { code: 'tooMany'; max: number }
  | { code: 'tooLarge'; name: string; maxMb: number }
  | { code: 'type'; name: string }

/** The first reason the picked files can't be sent, or null when they can. */
export function checkScreenshots(
  files: readonly File[]
): ScreenshotProblem | null {
  if (files.length > MAX_FEEDBACK_EVIDENCE_FILES)
    return { code: 'tooMany', max: MAX_FEEDBACK_EVIDENCE_FILES }
  for (const f of files) {
    if (!FEEDBACK_SCREENSHOT_TYPES.includes(f.type))
      return { code: 'type', name: f.name }
    if (f.size > FEEDBACK_EVIDENCE_MAX_BYTES)
      return {
        code: 'tooLarge',
        name: f.name,
        maxMb: FEEDBACK_SCREENSHOT_MAX_MB,
      }
  }
  return null
}

export interface FeedbackFormValues {
  kind: FeedbackKindValue
  title: string
  /** Bug only: what happened. */
  actual: string
  /** Bug only: what the user expected. */
  expected: string
  /** Idea / question: the one free-text box. */
  details: string
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * The API payload for the form. A bug sends `actual` / `expected`; an idea or
 * a question has one details box, stored as `expected` (the payload has no
 * free-text field of its own). Blank fields are sent as null, which the
 * server's schema accepts where it would refuse an empty string.
 */
export function toFeedbackInput(
  values: FeedbackFormValues
): FeedbackCreateInput {
  const title = values.title.trim()
  if (values.kind === 'BUG')
    return {
      kind: 'BUG',
      title,
      actual: textOrNull(values.actual),
      expected: textOrNull(values.expected),
    }
  return { kind: values.kind, title, expected: textOrNull(values.details) }
}
