import { withWorkflow } from 'workflow/next'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // LUM-1030: the self-hosted workflow-queue cleanup loads graphile-worker at
  // runtime (it resolves config/plugins dynamically) — keep it unbundled.
  serverExternalPackages: ['graphile-worker'],
  experimental: {
    // LUM-1339: Vercel throws the build cache away every time (1.68 GB > the
    // 1.5 GB limit), so Turbopack's build-time filesystem cache only costs
    // memory — its write overlaps the TypeScript step and got the 8 GB build
    // machine killed (exit 137).
    turbopackFileSystemCacheForBuild: false,
  },
}

// LUM-735 v4: Vercel Workflows compile `'use workflow'` / `'use step'` files
// (lib/workflows/**) and register the /.well-known/workflow/v1/* routes. The
// wrapper also runs the workflow builder whenever Next loads its config —
// including from `next/jest` — so it is skipped under NODE_ENV=test, where
// `jest.config.js` maps the `workflow` entrypoints to stubs instead.
export default process.env.NODE_ENV === 'test'
  ? nextConfig
  : withWorkflow(nextConfig)
