/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Next.js server-side minification mangles class constructors from
      // external packages (Sandbox, Anthropic, Pusher, etc.), causing
      // "e is not a constructor" at runtime. Disable minification for
      // server bundles — they run on Vercel's infrastructure, not in
      // browsers, so bundle size is not critical.
      config.optimization.minimize = false
    }
    return config
  },
}

export default nextConfig
