import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
// Load .env.local first (Next.js convention), then fall back to .env
dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') })
import { createMcpClient } from './client.js'

export const prisma = createMcpClient(process.env.DATABASE_URL!)
