/**
 * LUM-1027 — "verify your email" message for self-hosted (Better Auth)
 * sign-ups. Only a verified address can match a workspace invite.
 */
export interface VerifyEmailResult {
  subject: string
  html: string
  text: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildVerifyEmail(verifyUrl: string): VerifyEmailResult {
  const href = escapeHtml(verifyUrl)
  return {
    subject: 'Verify your email for Lumo',
    text:
      'Confirm this email address for your Lumo account by opening the link ' +
      `below (it expires in 1 hour):\n\n${verifyUrl}\n\n` +
      "If you didn't create a Lumo account, you can ignore this email.",
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
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#111;">Verify your email</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 40px 28px;">
              <p style="margin:0;font-size:15px;color:#444;line-height:1.6;">
                Confirm this email address for your Lumo account. The link expires in 1 hour.
              </p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 40px 40px;">
              <a href="${href}" style="display:inline-block;background:#111111;color:#ffffff;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">Verify email</a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 40px;background:#fafafa;">
              <p style="margin:0;font-size:12px;color:#bbb;">If you didn't create a Lumo account, you can safely ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  }
}
