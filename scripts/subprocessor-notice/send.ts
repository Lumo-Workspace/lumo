/**
 * LUM-919 — email a subprocessor change (lib/legal/subprocessor-changes.ts)
 * to the owners of every workspace, as DPA 7.2 promises. Run by an operator
 * from their own terminal; nothing runs it on merge or deploy.
 *
 * Usage (DATABASE_URL, CLERK_SECRET_KEY and — for --confirm — RESEND_API_KEY or SMTP_*
 * come from the env file you pass; nothing is loaded implicitly):
 *
 *   # 1. dry run: the change, owners per workspace, the email; sends nothing
 *   DOTENV_CONFIG_PATH=<env file> npx tsx -r dotenv/config \
 *     scripts/subprocessor-notice/send.ts --change <change id>
 *
 *   # 2. send to every owner not yet notified
 *   DOTENV_CONFIG_PATH=<env file> npx tsx -r dotenv/config \
 *     scripts/subprocessor-notice/send.ts --change <change id> \
 *     --confirm --confirm-host <db host printed by the dry run>
 *
 * A rerun sends nothing to an owner already notified (recorded per change,
 * workspace and owner); failures are listed and retried by the next run. A
 * change that takes effect in fewer than 30 days is refused unless it is
 * marked urgent, and a removal is never sent.
 */
import { prisma } from '@/lib/db/prisma'
import { sendEmail } from '@/lib/integrations/email'
import { PRIVACY_CONTACT_EMAIL } from '@/lib/legal/subprocessor-changes'
import { assertApplyHost } from '@/lib/services/secret-stock-reredact.service'
import {
  planSubprocessorNotice,
  sendSubprocessorNotice,
  type NoticeDeps,
} from '@/lib/services/subprocessor-notice.service'
import { lookupClerkProfiles } from '@/lib/utils/clerk-helpers'
import {
  USAGE,
  formatNoticePlan,
  formatSendResult,
  parseNoticeArgs,
} from './args'

function out(line: string) {
  process.stdout.write(`${line}\n`)
}

function err(line: string) {
  process.stderr.write(`${line}\n`)
}

async function main() {
  let args: ReturnType<typeof parseNoticeArgs>
  try {
    args = parseNoticeArgs(process.argv.slice(2))
  } catch (e) {
    err((e as Error).message)
    err(USAGE)
    process.exit(2)
  }
  if (!process.env.DATABASE_URL) {
    err('DATABASE_URL is not set (pass the env file with DOTENV_CONFIG_PATH).')
    process.exit(2)
  }
  const host = new URL(process.env.DATABASE_URL).host
  if (args.confirm) {
    try {
      assertApplyHost(process.env.DATABASE_URL, args.confirmHost)
    } catch (e) {
      err((e as Error).message.replace('--apply', '--confirm'))
      process.exit(2)
    }
  }

  const deps: NoticeDeps = {
    now: new Date(),
    lookupEmails: async ids => {
      const profiles = await lookupClerkProfiles(ids)
      return new Map(ids.map(id => [id, profiles.get(id)?.email ?? null]))
    },
    sendEmail: async message => {
      const result = await sendEmail(
        {
          replyTo: PRIVACY_CONTACT_EMAIL,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
        { idempotencyKey: message.idempotencyKey }
      )
      if (result.status === 'failed') {
        throw new Error(`${result.error.name}: ${result.error.message}`)
      }
      if (result.status === 'skipped' && result.reason === 'not_configured') {
        throw new Error(
          'No email transport configured (SMTP_URL/SMTP_HOST or RESEND_API_KEY)'
        )
      }
      // sent, or skipped as a duplicate key: this owner already has the
      // notice (a crashed earlier run), so it is recorded as delivered.
      return { messageId: result.id }
    },
  }

  out(
    `[${args.confirm ? 'send' : 'dry-run'}] LUM-919 subprocessor change notice · db ${host}`
  )
  const plan = await planSubprocessorNotice(args.changeId, deps)
  for (const line of formatNoticePlan(plan, { html: args.html })) out(line)
  if (!args.confirm) {
    out('')
    out(
      plan.refusal
        ? 'Dry run only. This change would be refused by --confirm.'
        : `Dry run only. To send: add --confirm --confirm-host ${host}`
    )
    await prisma.$disconnect()
    return
  }
  if (plan.totals.toNotify === 0) {
    out('Every active owner is already notified — nothing to send.')
    await prisma.$disconnect()
    return
  }
  const result = await sendSubprocessorNotice(args.changeId, deps)
  for (const line of formatSendResult(result)) out(line)
  await prisma.$disconnect()
  if (result.failed.length > 0 || result.unrecorded.length > 0) process.exit(1)
}

main().catch(async error => {
  err(
    `[subprocessor-notice] failed: ${error instanceof Error ? error.message : String(error)}`
  )
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
