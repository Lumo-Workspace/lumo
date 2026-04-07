/**
 * Tests for useFormRecovery hook logic.
 * We test the core save/load/clear functions directly since they're pure localStorage ops.
 */

const MOCK_KEY = 'lumo:form-recovery:test'

// Mock localStorage
const store: Record<string, string> = {}
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k])
  jest
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(k => store[k] ?? null)
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
    store[k] = v
  })
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(k => {
    delete store[k]
  })
})
afterEach(() => jest.restoreAllMocks())

// Import the cache utilities used by the hook
import { readCache, writeCache } from '../app/workspace/[workspaceUrl]/cache'

describe('form recovery via cache utilities', () => {
  it('writeCache stores data and readCache retrieves it', () => {
    writeCache(MOCK_KEY, { title: 'test' })
    const result = readCache<{ title: string }>(MOCK_KEY)
    expect(result).toEqual({ title: 'test' })
  })

  it('readCache returns null for missing key', () => {
    const result = readCache(MOCK_KEY)
    expect(result).toBeNull()
  })

  it('removeItem clears the stored data', () => {
    writeCache(MOCK_KEY, { title: 'test' })
    localStorage.removeItem(MOCK_KEY)
    const result = readCache(MOCK_KEY)
    expect(result).toBeNull()
  })

  it('empty object is stored and retrieved correctly', () => {
    writeCache(MOCK_KEY, {})
    const result = readCache<Record<string, unknown>>(MOCK_KEY)
    expect(result).toEqual({})
  })
})
