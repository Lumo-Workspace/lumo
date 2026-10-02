import 'dotenv/config'
import { defineConfig } from 'prisma/config'
import { resolveDatabaseUrl } from './lib/db/database-url'

export default defineConfig({
  datasource: {
    // Migrations need a direct (unpooled) connection: pooled ones don't support
    // DDL. On a production deployment this is the Neon-managed
    // PROD_DATABASE_URL_UNPOOLED; elsewhere DATABASE_URL_UNPOOLED ?? DATABASE_URL.
    url: resolveDatabaseUrl('direct')!,
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
