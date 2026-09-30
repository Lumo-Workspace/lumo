import type {
  WorkspaceDeletionEmailOptions,
  WorkspaceDeletionEmailResult,
} from '../types'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * LUM-918: the notice every OWNER gets when a workspace deletion is scheduled
 * (with the 48h deadline and a link to cancel) or cancelled.
 */
export function buildWorkspaceDeletionEmail({
  kind,
  workspaceName,
  actorName,
  executeAt,
  settingsUrl,
}: WorkspaceDeletionEmailOptions): WorkspaceDeletionEmailResult {
  const name = escapeHtml(workspaceName)
  const actor = escapeHtml(actorName)
  const deadline = `${executeAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`

  const scheduled = kind === 'scheduled'
  const subject = scheduled
    ? `${workspaceName} is scheduled for deletion on Lumo`
    : `Deletion of ${workspaceName} was cancelled`
  const title = scheduled
    ? `<strong>${name}</strong> will be deleted in 48 hours`
    : `Deletion of <strong>${name}</strong> was cancelled`
  const body = scheduled
    ? `<strong>${actor}</strong> asked to delete the <strong>${name}</strong> workspace. All of its projects, tasks, documents and history will be permanently deleted at <strong>${deadline}</strong>. Any owner can cancel before then from the workspace settings.`
    : `<strong>${actor}</strong> cancelled the deletion of the <strong>${name}</strong> workspace. Nothing was deleted.`
  const cta = scheduled
    ? 'Review or cancel the deletion'
    : 'Open workspace settings'

  return {
    subject,
    html: `
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
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
          <tr>
            <td align="left" style="padding:32px 40px 24px;font-size:18px;font-weight:700;color:#111;">Lumo</td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#111;letter-spacing:-0.4px;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px 28px;">
              <p style="margin:0;font-size:15px;color:#444;line-height:1.6;">${body}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 40px;">
              <a href="${escapeHtml(settingsUrl)}" style="display:inline-block;background:#111111;color:#ffffff;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">${cta}</a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 40px;background:#fafafa;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:12px;color:#aaa;">You receive this because you are an owner of this workspace.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  }
}
