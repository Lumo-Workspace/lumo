/**
 * LUM-1071 — Remove a Better Auth user: deprovision every workspace membership, then
 * delete the user (sessions, linked accounts and tokens cascade). Refused
 * while the user is the last OWNER of a workspace.
 *
 * Dry run by default (prints ids and counts, writes nothing); --confirm
 * applies. Point DATABASE_URL at the target database in your own shell.
 *
 *   npx tsx scripts/auth-admin/remove.ts (--user-id <id> | --email <email>) [--confirm]
 *
 * Logic: lib/services/auth-user-admin.service.ts.
 */
import 'dotenv/config'
import { main } from './run'

void main('remove')
