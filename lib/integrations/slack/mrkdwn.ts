/**
 * Slack mrkdwn escaping (LUM-928).
 *
 * Slack treats `<…>` as control sequences — `<!channel>` / `<!here>` ping a
 * whole channel, `<@U123>` mentions a user and `<https://x|label>` renders a
 * link whose target is hidden behind arbitrary text. Per Slack's formatting
 * rules, the only characters that must be escaped are `&`, `<` and `>`
 * (as `&amp;`, `&lt;`, `&gt;`); everything else stays readable as typed.
 *
 * Every user- or third-party-controlled value (task titles, names, comment
 * bodies, GitHub PR titles, echoed command arguments) goes through
 * `escapeMrkdwn` before it is interpolated into a mrkdwn string.
 */

/** Escape `&`, `<` and `>` so the value renders as literal text in mrkdwn. */
export function escapeMrkdwn(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Build a `<url|label>` link with both halves neutralised: the label is
 * escaped, and the URL is escaped plus `|` percent-encoded so neither can
 * close the link early or smuggle in a second control sequence.
 */
export function mrkdwnLink(url: string, label: string): string {
  const safeUrl = escapeMrkdwn(url).replace(/\|/g, '%7C')
  return `<${safeUrl}|${escapeMrkdwn(label)}>`
}
