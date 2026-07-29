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

export default nextConfig
