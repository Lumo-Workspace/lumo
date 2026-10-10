/**
 * @jest-environment node
 *
 * LUM-1071 — the admin plugin as configured: impersonation closed, field
 * names match the migration.
 */
import { readFileSync } from 'fs'
import path from 'path'
import {
  ADMIN_DISABLED_PATHS,
  ADMIN_PLUGIN_ROLES,
  lumoAdminPlugin,
} from '@/lib/auth/better-auth/admin-plugin'

const MIGRATION = path.join(
  __dirname,
  '../../../../prisma/migrations/20261028090000_lum1071_auth_admin_fields/migration.sql'
)

describe('LUM-1071 admin plugin', () => {
  it('admin plugin lists both impersonation endpoints for disabling', () => {
    const plugin = lumoAdminPlugin() as unknown as {
      id: string
      endpoints: Record<string, { path: string }>
    }
    expect(plugin.id).toBe('admin')
    const paths = Object.values(plugin.endpoints).map(e => e.path)
    for (const p of ADMIN_DISABLED_PATHS) expect(paths).toContain(p)
    expect(ADMIN_DISABLED_PATHS).toEqual([
      '/admin/impersonate-user',
      '/admin/stop-impersonating',
    ])
  })

  it('admin plugin is installed in the Better Auth instance with impersonation disabled', async () => {
    const saved = {
      secret: process.env.BETTER_AUTH_SECRET,
      url: process.env.BETTER_AUTH_URL,
    }
    process.env.BETTER_AUTH_SECRET = 'x'.repeat(32)
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    globalThis.lumoBetterAuth = undefined
    try {
      const { getBetterAuth } = await import('@/lib/auth/better-auth/server')
      const options = getBetterAuth().options as {
        disabledPaths?: string[]
        plugins?: Array<{ id: string }>
      }
      for (const p of ADMIN_DISABLED_PATHS) {
        expect(options.disabledPaths).toContain(p)
      }
      expect(options.plugins?.map(p => p.id)).toContain('admin')
    } finally {
      globalThis.lumoBetterAuth = undefined
      if (saved.secret === undefined) delete process.env.BETTER_AUTH_SECRET
      else process.env.BETTER_AUTH_SECRET = saved.secret
      if (saved.url === undefined) delete process.env.BETTER_AUTH_URL
      else process.env.BETTER_AUTH_URL = saved.url
    }
  })

  it('admin plugin: no role may impersonate', () => {
    for (const [name, role] of Object.entries(ADMIN_PLUGIN_ROLES)) {
      for (const action of ['impersonate', 'impersonate-admins']) {
        const r = role.authorize({ user: [action] } as never)
        expect([name, action, r.success]).toEqual([name, action, false])
      }
    }
    expect(ADMIN_PLUGIN_ROLES.admin.authorize({ user: ['ban'] }).success).toBe(
      true
    )
    expect(ADMIN_PLUGIN_ROLES.user.authorize({ user: ['ban'] }).success).toBe(
      false
    )
  })

  it("admin plugin schema fields are the migration's columns", () => {
    const plugin = lumoAdminPlugin() as unknown as {
      schema: Record<string, { fields: Record<string, unknown> }>
    }
    const sql = readFileSync(MIGRATION, 'utf8')
    for (const f of Object.keys(plugin.schema.user!.fields)) {
      expect(sql).toContain(`ALTER TABLE "auth_users" ADD COLUMN "${f}"`)
    }
    for (const f of Object.keys(plugin.schema.session!.fields)) {
      expect(sql).toContain(`ALTER TABLE "auth_sessions" ADD COLUMN "${f}"`)
    }
    expect(Object.keys(plugin.schema.user!.fields).sort()).toEqual([
      'banExpires',
      'banReason',
      'banned',
      'role',
    ])
    expect(Object.keys(plugin.schema.session!.fields)).toEqual([
      'impersonatedBy',
    ])
  })
})
