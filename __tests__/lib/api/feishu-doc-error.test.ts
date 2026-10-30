/**
 * @jest-environment node
 *
 * LUM-1343 — the import / sync routes answer `{ error, code, objectType? }`
 * so the UI can show a distinct message per failure; 500s hide the message.
 */
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }))
import { feishuDocErrorResponse } from '@/lib/api/feishu-doc-error'

it('passes status, code and objectType through', async () => {
  const res = feishuDocErrorResponse(
    Object.assign(new Error('Feishu sheet files cannot be imported'), {
      status: 422,
      code: 'feishu_doc_unsupported_type',
      objectType: 'sheet',
    }),
    'r'
  )
  expect(res.status).toBe(422)
  await expect(res.json()).resolves.toEqual({
    error: 'Feishu sheet files cannot be imported',
    code: 'feishu_doc_unsupported_type',
    objectType: 'sheet',
  })
})

it('an unexpected error is a 500 without its message', async () => {
  const res = feishuDocErrorResponse(new Error('db password wrong'), 'r')
  expect(res.status).toBe(500)
  await expect(res.json()).resolves.toEqual({ error: 'Internal error' })
})
