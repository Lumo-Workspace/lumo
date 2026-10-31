/**
 * LUM-1344 — Take platform admin away from a Better Auth user (`role =
 * 'user'`). Effective on the next /api/admin request: the guard reads the
 * role every time, so admin tokens already issued stop working.
 *
 * Dry run by default (prints ids and the current role, writes nothing);
 * --confirm applies. Point DATABASE_URL at the target database in your own
 * shell.
 *
 *   npx tsx scripts/auth-admin/revoke-admin.ts (--user-id <id> | --email <email>) [--confirm]
 *
 * Logic: lib/services/auth-user-admin.service.ts.
 */
import 'dotenv/config'
import { main } from './run'

void main('revoke-admin')
