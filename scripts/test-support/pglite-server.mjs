/**
 * LUM-861 helper for __tests__/workspace-deletion/real-postgres.test.ts:
 * boots an in-memory PGlite, replays every prisma migration, and serves it
 * over the Postgres wire protocol. Runs as a plain Node ESM child process
 * because PGlite loads its wasm and extensions through dynamic import(),
 * which Jest's CommonJS sandbox cannot execute.
 *
 * Prints one JSON line on stdout — {"conn":"127.0.0.1:<port>"} — once ready,
 * or {"error":"…"} and exits 1. Stops when stdin closes (the parent exited).
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrations = path.resolve(here, '../../prisma/migrations')

try {
  const db = await PGlite.create({ extensions: { vector, pg_trgm } })
  for (const dir of readdirSync(migrations).sort()) {
    const file = path.join(migrations, dir, 'migration.sql')
    if (existsSync(file)) await db.exec(readFileSync(file, 'utf8'))
  }
  // LUM-928: the default maxConnections is 1, and it is copied onto
  // net.Server.maxConnections, so Node silently drops any socket that arrives
  // while an earlier one is still open. pg-pool discards its client after
  // every query error (an expected P2002 included) and reconnects at once;
  // the discarded socket has sent Terminate but the server sees it close only
  // later — hundreds of ms under parallel jest load — so the reconnect was
  // dropped and the next query failed with "Server has closed the
  // connection". PGlite itself is still a single session: the socket server
  // serialises protocol messages through one queue and only holds other
  // clients off while one is inside an explicit transaction. Outside a
  // transaction, two clients querying at the same moment can interleave their
  // Parse/Bind/Execute messages and clobber the shared unnamed statement and
  // portal — so this raises the limit only to absorb reconnect overlap. It is
  // not safe for genuinely concurrent clients.
  const server = new PGLiteSocketServer({
    db,
    port: 0,
    host: '127.0.0.1',
    maxConnections: 16,
  })
  await server.start()
  process.stdout.write(`${JSON.stringify({ conn: server.getServerConn() })}\n`)
  process.stdin.resume()
  process.stdin.on('end', async () => {
    await server.stop()
    await db.close()
    process.exit(0)
  })
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: String(error) })}\n`)
  process.exit(1)
}
