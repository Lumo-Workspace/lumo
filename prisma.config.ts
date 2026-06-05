import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    // Use unpooled URL for migrations (pooled connections don't support DDL)
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
