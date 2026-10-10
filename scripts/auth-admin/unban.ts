/**
 * LUM-1071 — Lift a Better Auth user's ban. Memberships are NOT restored; only a new
 * invite brings the person back.
 *
 * Dry run by default (prints ids and counts, writes nothing); --confirm
 * applies. Point DATABASE_URL at the target database in your own shell.
 *
 *   npx tsx scripts/auth-admin/unban.ts (--user-id <id> | --email <email>) [--confirm]
 *
 * Logic: lib/services/auth-user-admin.service.ts.
 */
import 'dotenv/config'
import { main } from './run'

void main('unban')
