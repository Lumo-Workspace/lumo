/** @type {import('next').NextConfig} */
const nextConfig = {
  // @lobehub/icons ships pre-transpiled ESM; let Next transform it.
  transpilePackages: ['@lobehub/icons'],
}

export default nextConfig
