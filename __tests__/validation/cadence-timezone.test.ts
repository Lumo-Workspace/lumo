import { cadenceSchema } from '@/lib/validation/sprint.schema'

test('cadenceSchema accepts a valid IANA timezone', () => {
  const r = cadenceSchema.safeParse({
    enabled: true,
    timezone: 'Asia/Shanghai',
  })
  expect(r.success).toBe(true)
})

test('cadenceSchema rejects an invalid timezone', () => {
  const r = cadenceSchema.safeParse({ enabled: true, timezone: 'Mars/Phobos' })
  expect(r.success).toBe(false)
})

test('cadenceSchema allows omitting timezone', () => {
  const r = cadenceSchema.safeParse({ enabled: true })
  expect(r.success).toBe(true)
})
