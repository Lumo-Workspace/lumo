/**
 * LUM-1344 — Make a Better Auth user a platform admin (`auth_users.role =
 * 'admin'`): the role the /api/admin/* guard checks on every request, so the
 * person can sign in to the admin console. Refused for a banned user.
 *
 * Dry run by default (prints ids and the current role, writes nothing);
 * --confirm applies. Point DATABASE_URL at the target database in your own
 * shell.
 *
 *   npx tsx scripts/auth-admin/grant-admin.ts (--user-id <id> | --email <email>) [--confirm]
 *
 * Logic: lib/services/auth-user-admin.service.ts.
 */
import 'dotenv/config'
import { main } from './run'

void main('grant-admin')
