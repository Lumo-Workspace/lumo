import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL!,
    ...(process.env.DATABASE_URL_UNPOOLED
      ? { shadowDatabaseUrl: process.env.DATABASE_URL_UNPOOLED }
      : {}),
  },
})
