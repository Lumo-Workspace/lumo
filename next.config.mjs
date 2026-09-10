import { withWorkflow } from 'workflow/next'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Layer 2 memory consolidation (lib/services/memory/layer2-input.ts) reads the
  // project constitution from the repo root at runtime to skip promoting lessons
  // already documented there. The consolidation fires via waitUntil from task
  // API routes, so CLAUDE.md/AGENTS.md must be traced into those serverless
  // bundles — otherwise process.cwd() wouldn't contain them on Vercel and the
  // reads would silently degrade to null.
  outputFileTracingIncludes: {
    '/api/**': ['./CLAUDE.md', './AGENTS.md'],
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
