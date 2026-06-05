import { prdTemplate } from './prd'
import { rfcTemplate } from './rfc'
import { meetingNotesTemplate } from './meeting-notes'
import { weeklyReportTemplate } from './weekly-report'

/** Shape of a built-in template skeleton (seeded into DocumentTemplate). */
export interface SystemTemplateSeed {
  key: string
  emoji: string
  /** Body HTML, in the same format as Document.content. */
  content: string
  sortOrder: number
}

/** Built-in system templates, ordered for display. */
export const SYSTEM_TEMPLATES: SystemTemplateSeed[] = [
  prdTemplate,
  rfcTemplate,
  meetingNotesTemplate,
  weeklyReportTemplate,
]
