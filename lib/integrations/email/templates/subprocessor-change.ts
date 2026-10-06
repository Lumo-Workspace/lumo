import type { SubprocessorChangeKind } from '@/lib/legal/subprocessor-changes'

export interface SubprocessorChangeEmailOptions {
  workspaceName: string
  kind: SubprocessorChangeKind
  summary: string
  /** `YYYY-MM-DD`, takes effect at 00:00 UTC. */
  effectiveAt: string
  /** Present = an urgent change sent with less than the full notice period. */
  urgentReason?: string | undefined
  noticePeriodDays: number
  securityUrl: string
  privacyEmail: string
}

export interface SubprocessorChangeEmailResult {
  subject: string
  html: string
  text: string
}

const KIND_LABEL: Record<SubprocessorChangeKind, string> = {
  added: 'New subprocessor',
  replaced: 'Replacement subprocessor',
  changed: 'Change of purpose or data location',
  removed: 'Subprocessor removed',
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** `2026-11-20` → `20 November 2026` (fixed English, UTC). */
function longDate(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00Z`))
}

/**
 * LUM-919: the DPA §7.2 notice every workspace OWNER gets about a
 * subprocessor change. English like the other Lumo emails (invite, workspace
 * deletion — none is localized). Plain: no images, no tracking pixel, one
 * link to the public /security page. Carries a text part as well.
 */
export function buildSubprocessorChangeEmail(
  o: SubprocessorChangeEmailOptions
): SubprocessorChangeEmailResult {
  const effective = longDate(o.effectiveAt)
  const label = KIND_LABEL[o.kind]
  const subject = `${o.urgentReason ? 'Urgent subprocessor change' : 'Subprocessor change'} for ${o.workspaceName}, effective ${effective}`
  const intro = `Lumo is changing the subprocessors that process data for the ${o.workspaceName} workspace.`
  const urgent = o.urgentReason
    ? `This change is needed urgently to keep the service secure or available, so we are notifying you with less than ${o.noticePeriodDays} days' notice. Reason: ${o.urgentReason}`
    : null
  const list = `The full list of subprocessors and all upcoming changes: ${o.securityUrl}`
  const objection = `If you object to this change on reasonable data protection grounds, write to ${o.privacyEmail} before ${effective}, as set out in section 7.3 of our Data Processing Agreement.`
  const footer =
    'You receive this because you are an owner of this workspace. Lumo emails the owners of every workspace about subprocessor changes.'

  const text = [
    intro,
    '',
    `${label}: ${o.summary}`,
    `Takes effect: ${effective} (00:00 UTC)`,
    ...(urgent ? ['', urgent] : []),
    '',
    list,
    '',
    objection,
    '',
    '--',
    footer,
  ].join('\n')

  const p = (body: string, style = 'color:#444;') =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;${style}">${body}</p>`
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td align="left" style="padding:32px 40px 16px;font-size:18px;font-weight:700;color:#111;">Lumo</td>
          </tr>
          <tr>
            <td style="padding:0 40px 12px;">
              ${p(escapeHtml(intro))}
              <div style="margin:0 0 16px;padding:16px;border:1px solid #e5e5e5;border-radius:8px;">
                ${p(`<strong>${escapeHtml(label)}</strong><br/>${escapeHtml(o.summary)}`, 'color:#111;')}
                <p style="margin:0;font-size:14px;color:#444;">Takes effect: <strong>${escapeHtml(effective)}</strong> (00:00 UTC)</p>
              </div>
              ${urgent ? p(escapeHtml(urgent)) : ''}
              ${p(`The full list of subprocessors and all upcoming changes: <a href="${escapeHtml(o.securityUrl)}" style="color:#111;">${escapeHtml(o.securityUrl)}</a>`)}
              ${p(escapeHtml(objection))}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;background:#fafafa;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:12px;color:#888;">${escapeHtml(footer)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
  return { subject, html, text }
}
