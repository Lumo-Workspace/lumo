/**
 * Slack message copy (LUM-1097): every word Lumo writes into Slack comes from
 * the `slack.*` keys of the locale catalogues (lib/i18n/*.json).
 *
 * Which language a message is in is decided by the sender, not here:
 * channel posts (and command replies, which are posted in a channel) use the
 * workspace's default language; a DM uses its recipient's own language,
 * falling back to the workspace default (lib/services/slack-locale.service.ts).
 *
 * The copy is plain text. Interpolated values keep the LUM-928 rule: the
 * caller escapes user- or GitHub-controlled values with `escapeMrkdwn` before
 * they reach a mrkdwn string — `slackMrkdwn` additionally escapes the
 * catalogue text itself, so a translation can never carry a control sequence.
 * Pure functions only — no Prisma, no network.
 */
import {
  DEFAULT_LOCALE,
  formatServerMessage,
  type MessageValues,
  type SupportedLocale,
} from '@/lib/i18n/server-messages'
import { escapeMrkdwn } from './mrkdwn'

export type SlackLocale = SupportedLocale
export const DEFAULT_SLACK_LOCALE: SlackLocale = DEFAULT_LOCALE

/** `slack.<key>` as plain text (header / button `plain_text`, raw values). */
export function slackText(
  locale: SlackLocale,
  key: string,
  values?: MessageValues
): string {
  return formatServerMessage(locale, `slack.${key}`, values)
}

/**
 * `slack.<key>` as mrkdwn: the catalogue text is escaped, then `values` —
 * already-escaped mrkdwn supplied by the caller — are filled in as-is.
 */
export function slackMrkdwn(
  locale: SlackLocale,
  key: string,
  values: MessageValues = {}
): string {
  const placeholders: MessageValues = {}
  for (const name of Object.keys(values)) placeholders[name] = `{${name}}`
  const template = escapeMrkdwn(slackText(locale, key, placeholders))
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : whole
  )
}
