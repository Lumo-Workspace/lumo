import { sanitizeField } from './sanitize'

/**
 * LUM-1292 — no Lumo skill is installed any more; the SessionStart hook is
 * the only thing that tells an agent Lumo exists here. The text is category
 * level on purpose: it names the situations that need the guide and where to
 * get it (`lumo skill read`), not the commands themselves. Keep it short —
 * it rides along on every session start, resume, clear and compact.
 */
const RAW_SKILL_POINTER_TEXT =
  "This repository's work is tracked in Lumo (task ids look like LUM-42). " +
  'Whenever the request involves a Lumo task id, the `lumo` CLI, ' +
  'picking/starting/resuming/finishing a task, test cases, milestones, ' +
  'sprints or team memory: before running any other lumo command, run ' +
  '`lumo skill read` and follow it.'

export const SKILL_POINTER_TEXT: string = sanitizeField(RAW_SKILL_POINTER_TEXT)
