/**
 * @jest-environment node
 */
import { runWrapPanel, type WrapSection } from '@/cli/src/lib/wrap-panel'

function makeSection(over: Partial<WrapSection> & { title: string }): WrapSection & {
  prepared: boolean
  ran: boolean
} {
  const s: WrapSection & { prepared: boolean; ran: boolean } = {
    title: over.title,
    prepared: false,
    ran: false,
    prepare: over.prepare ?? (async () => { s.prepared = true; return true }),
    run: over.run ?? (async () => { s.ran = true }),
  }
  return s
}

let out: string[]
beforeEach(() => {
  out = []
  jest.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
    out.push(String(c)); return true
  })
})
afterEach(() => jest.restoreAllMocks())

it('runs only sections whose prepare() returns true', async () => {
  const a = makeSection({ title: 'A' })
  const b = makeSection({ title: 'B', prepare: async () => false })
  await runWrapPanel([a, b], { yes: false, dryRun: false })
  expect(a.ran).toBe(true)
  expect(b.ran).toBe(false)
})

it('skips run() entirely in dry-run but still prepares', async () => {
  const a = makeSection({ title: 'A' })
  await runWrapPanel([a], { yes: false, dryRun: true })
  expect(a.prepared).toBe(true)
  expect(a.ran).toBe(true) // run() is still invoked; dryRun is passed through for the section to honor
})

it('passes opts through to run()', async () => {
  let seen: unknown
  const a = makeSection({ title: 'A', run: async opts => { seen = opts } })
  await runWrapPanel([a], { yes: true, dryRun: false })
  expect(seen).toEqual({ yes: true, dryRun: false })
})
