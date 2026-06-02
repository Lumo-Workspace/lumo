/**
 * @jest-environment node
 */
jest.mock('child_process', () => ({ spawnSync: jest.fn() }))
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  rmSync: jest.fn(),
  mkdtempSync: jest.fn(() => '/tmp/lumo-wrap-xxx'),
}))

import { spawnSync } from 'child_process'
import * as fs from 'fs'
import { editInEditor } from '@/cli/src/lib/editor'

const spawn = spawnSync as jest.Mock
const read = fs.readFileSync as jest.Mock

const originalEditor = process.env.EDITOR
const originalTTY = process.stdin.isTTY

afterEach(() => {
  process.env.EDITOR = originalEditor
  Object.defineProperty(process.stdin, 'isTTY', { value: originalTTY, configurable: true })
  jest.clearAllMocks()
})

it('returns the initial text unchanged when stdin is not a TTY', async () => {
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
  const out = await editInEditor('initial')
  expect(out).toBe('initial')
  expect(spawn).not.toHaveBeenCalled()
})

it('spawns $EDITOR and returns the edited file contents', async () => {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  process.env.EDITOR = 'vim'
  spawn.mockReturnValue({ status: 0 })
  read.mockReturnValue('edited body')
  const out = await editInEditor('initial')
  expect(spawn).toHaveBeenCalledWith('vim', [expect.stringContaining('/tmp/lumo-wrap-xxx')], { stdio: 'inherit' })
  expect(out).toBe('edited body')
})

it('falls back to vi when $EDITOR is unset', async () => {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  delete process.env.EDITOR
  spawn.mockReturnValue({ status: 0 })
  read.mockReturnValue('x')
  await editInEditor('initial')
  expect(spawn.mock.calls[0][0]).toBe('vi')
})

it('returns initial text when the editor exits non-zero', async () => {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  process.env.EDITOR = 'vim'
  spawn.mockReturnValue({ status: 1 })
  const out = await editInEditor('initial')
  expect(out).toBe('initial')
})
