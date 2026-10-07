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
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;padding:32px;">
<h1 style="font-size:20px;">Verify your email</h1>
<p style="font-size:15px;color:#444;">Confirm this email address for your Lumo account. The link expires in 1 hour.</p>
<p><a href="${href}" style="display:inline-block;background:#111;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;">Verify email</a></p>
<p style="font-size:12px;color:#999;">If you didn't create a Lumo account, you can safely ignore this email.</p>
</body></html>`,
  }
}
