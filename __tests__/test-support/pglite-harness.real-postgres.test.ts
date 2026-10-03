/**
 * @jest-environment node
 *
 * LUM-928 — the PGlite test server must accept a new connection while an
 * earlier one is still open or still closing.
 *
 * Root cause of the "Server has closed the connection" flake: pg-pool drops
 * its client after ANY query error (an expected P2002 included) and opens a
 * fresh socket for the next query. The old socket has already sent Terminate,
 * but the server only sees it close a moment later — under parallel jest load
 * that moment is hundreds of ms. PGLiteSocketServer defaults to
 * maxConnections: 1 and copies it onto net.Server.maxConnections, so Node
 * silently drops the reconnect (a net.Server 'drop' event) and the client sees
 * the socket close before any reply. A second live client reproduces that
 * deterministically, without depending on timing.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.setTimeout(180_000)

beforeAll(async () => {
  await harness.start()
})

afterAll(async () => {
  await harness.stop()
})

it('accepts a second connection while the first is still open', async () => {
  // The harness client holds its single pooled connection open (idle).
  await harness.query('select 1')

  const second = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: harness.connectionString!,
      max: 1,
    }),
  })
  try {
    const rows = await second.$queryRawUnsafe<{ n: number }[]>('select 2 as n')
    expect(rows).toEqual([{ n: 2 }])
  } finally {
    await second.$disconnect()
  }

  // The first connection is unaffected.
  expect(await harness.query<{ n: number }>('select 3 as n')).toEqual([
    { n: 3 },
  ])
})

it('keeps serving after a query error makes the pool reconnect', async () => {
  await harness.insert('workspaces', { id: 'ws-err', slug: 'ws-err' })
  await expect(
    harness.insert('workspaces', { id: 'ws-err', slug: 'ws-err-2' })
  ).rejects.toMatchObject({ code: 'P2010' })
  expect(
    await harness.query<{ id: string }>(
      `select id from workspaces where id = 'ws-err'`
    )
  ).toEqual([{ id: 'ws-err' }])
})
