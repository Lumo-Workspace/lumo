/**
 * LUM-783 — write-time scan of a source card's untrusted text, producing the
 * `contentSignals` summary the row stores (or `null` when clean).
 *
 * The detection itself is the pure shared module; this file is the one
 * place that knows which FIELDS of each source card are untrusted text, so
 * every writer (Slack link/refresh, web add/refresh/body, comment
 * create/update, artifact add/update, every memory write path) computes the
 * same summary the same way. A hit is recorded on the source — never as a
 * boundary crossing on the agent: the attack surface is the content.
 */
import type { MemoryCategory } from '@prisma/client'
import {
  summarizeContentSignals,
  type ContentSignals,
} from '@/shared/src/untrusted-content'
import { memoryContentToText } from '@/lib/memory/content-text'
import type { SlackContextSnapshot } from '@/types/slack-context'

export type { ContentSignals }

/** Scan the given free-text fields together; empty/null parts are skipped. */
export function scanContent(
  ...parts: Array<string | null | undefined>
): ContentSignals | null {
  const text = parts
    .filter((p): p is string => !!p && p.trim() !== '')
    .join('\n')
  return text ? summarizeContentSignals(text) : null
}

/** A Slack snapshot's untrusted text is every message body. */
export function scanSlackSnapshot(
  snapshot: SlackContextSnapshot
): ContentSignals | null {
  return scanContent(...snapshot.messages.map(m => m.text))
}

/** A web link's untrusted text: fetched OG metadata, the member note, the body. */
export function scanWebLink(link: {
  title?: string | null | undefined
  description?: string | null | undefined
  note?: string | null | undefined
  body?: string | null | undefined
}): ContentSignals | null {
  return scanContent(link.title, link.description, link.note, link.body)
}

/** A memory row's untrusted text is its rendered content, headline first. */
export function scanMemoryContent(
  category: MemoryCategory,
  content: unknown
): ContentSignals | null {
  return scanContent(memoryContentToText(category, content))
}
