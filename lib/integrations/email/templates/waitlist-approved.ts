import type { WaitlistApprovedEmailOptions, InviteEmailResult } from '../types'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildWaitlistApprovedEmail({
  name,
  signInUrl,
}: WaitlistApprovedEmailOptions): InviteEmailResult {
  const lumoLogo = `<img src="https://www.uselumo.ai/logo-dark.svg" width="32" height="32" alt="Lumo" style="display:block;"/>`
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,'

  return {
    subject: "You're in — create your Lumo workspace",
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

          <!-- Header -->
          <tr>
            <td align="left" style="padding:32px 40px 24px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">${lumoLogo}</td>
                  <td style="font-size:18px;font-weight:700;color:#111;vertical-align:middle;letter-spacing:-0.3px;">Lumo</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td align="center" style="padding:0 40px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#111;letter-spacing:-0.4px;">
                You're in
              </h1>
            </td>
          </tr>

          <!-- Body text -->
          <tr>
            <td style="padding:16px 40px 28px;">
              <p style="margin:0;font-size:15px;color:#444;line-height:1.6;">
                ${greeting} you've been approved from the Lumo waitlist. Sign in to create your workspace and get your team started.
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding:0 40px 40px;">
              <a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#111111;color:#ffffff;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.1px;">Sign in to Lumo</a>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="border-top:1px solid #f0f0f0;"></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 40px;background:#fafafa;">
              <p style="margin:0 0 4px;font-size:12px;color:#aaa;">© 2026 Lumo, Inc.</p>
              <p style="margin:0;font-size:12px;color:#bbb;">You received this because you asked to join the Lumo waitlist. If you didn't, you can safely ignore it.</p>
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
