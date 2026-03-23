interface InviteEmailOptions {
  workspaceName: string
  inviterName: string
  inviteUrl: string
}

export function buildInviteEmail({
  workspaceName,
  inviterName,
  inviteUrl,
}: InviteEmailOptions): { subject: string; html: string } {
  return {
    subject: `${inviterName} invited you to join ${workspaceName} on Lumo`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:40px auto;padding:0 24px;color:#111;">
        <h2 style="font-size:18px;font-weight:600;margin:0 0 8px;">${inviterName} invited you to join <strong>${workspaceName}</strong></h2>
        <p style="font-size:14px;color:#555;margin:0 0 24px;">Accept the invitation to start collaborating on Lumo.</p>
        <a href="${inviteUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:500;text-decoration:none;">Accept invitation</a>
        <p style="font-size:12px;color:#999;margin-top:32px;">This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.</p>
      </div>
    `,
  }
}
