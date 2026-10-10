/**
 * LUM-1071 — Ban a Better Auth user: block sign-in, revoke sessions and MCP OAuth
 * tokens, and deprovision every workspace membership (API keys revoked,
 * audited; a workspace's last OWNER keeps the row, keys revoked).
 *
 * Dry run by default (prints ids and counts, writes nothing); --confirm
 * applies. Point DATABASE_URL at the target database in your own shell.
 *
 *   npx tsx scripts/auth-admin/ban.ts (--user-id <id> | --email <email>) [--reason <text>] [--expires-in-days <n>] [--confirm]
 *
 * Logic: lib/services/auth-user-admin.service.ts.
 */
import 'dotenv/config'
import { main } from './run'

void main('ban')
