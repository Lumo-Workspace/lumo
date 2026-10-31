/**
 * LUM-1344 — the role string Lumo assigns to platform admins on
 * `auth_users.role`. Its own module so operator scripts can name it without
 * loading the admin guard (Next.js + Better Auth).
 */
export const PLATFORM_ADMIN_ROLE = 'admin'
