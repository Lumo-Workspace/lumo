/**
 * LUM-1344 — register the lumo-admin console as a trusted OAuth client of
 * this app (confidential, no consent screen, scope `platform-admin`, linked to
 * the admin API resource only, no refresh tokens).
 *
 * Dry run by default (prints the spec, writes nothing); --confirm creates the
 * client in the database DATABASE_URL points at — set it in your own shell.
 *
 *   npx tsx scripts/admin-oauth/register-console-client.ts --name "Lumo Admin" \
 *     --redirect-uri https://admin.example.com/api/auth/callback \
 *     --operator-email <admin email> [--confirm]
 *
 * Logic: ./console-client.ts, ./provider-deps.ts.
 */
import 'dotenv/config'
import { resolveMcpOAuthUrls } from '@/lib/auth/better-auth/mcp-oauth-config'
import { getBetterAuth } from '@/lib/auth/better-auth/server'
import { prisma } from '@/lib/db/prisma'
import { runRegisterConsoleClient } from './console-client'
import { openAdminProvider, type AdminCapableAuth } from './provider-deps'

async function main(): Promise<void> {
  const code = await runRegisterConsoleClient(process.argv.slice(2), {
    openProvider: async operatorEmail => {
      const urls = resolveMcpOAuthUrls()
      if (!urls) throw new Error('BETTER_AUTH_URL is not configured')
      return openAdminProvider(
        getBetterAuth() as unknown as AdminCapableAuth,
        { adminResource: urls.adminResource, mcpResource: urls.resource },
        operatorEmail
      )
    },
    io: {
      stdout: line => process.stdout.write(`${line}\n`),
      stderr: line => process.stderr.write(line),
    },
  })
  await prisma.$disconnect()
  process.exit(code)
}

void main()
