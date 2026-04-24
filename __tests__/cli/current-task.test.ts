/**
 * @jest-environment node
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  readCurrentTask,
  writeCurrentTask,
  clearCurrentTask,
  currentTaskPath,
} from '@/cli/src/lib/current-task'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-current-task-'))
const configDir = path.join(tmpRoot, 'lumo-cfg')
const originalEnv = process.env.LUMO_CONFIG_DIR

beforeEach(() => {
  process.env.LUMO_CONFIG_DIR = configDir
  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true, force: true })
  }
})

afterAll(() => {
  if (originalEnv === undefined) delete process.env.LUMO_CONFIG_DIR
  else process.env.LUMO_CONFIG_DIR = originalEnv
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

const sample = {
  taskId: 'cmoc_abc',
  taskIdentifier: 'LUM-30',
  taskTitle: 'Task-Run relation',
  workspaceSlug: 'lumo',
  startedAt: '2026-04-24T12:00:00.000Z',
}

describe('current-task config', () => {
  it('returns null when the file does not exist', () => {
    expect(readCurrentTask()).toBeNull()
  })

  it('round-trips write → read', () => {
    writeCurrentTask(sample)
    expect(readCurrentTask()).toEqual(sample)
  })

  it('writes to the configured directory with 0600 permissions', () => {
    writeCurrentTask(sample)
    const stat = fs.statSync(currentTaskPath())
    expect(currentTaskPath()).toBe(path.join(configDir, 'current-task.json'))
    // Low six bits: owner rw, no group/other access
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('creates the config directory if missing', () => {
    expect(fs.existsSync(configDir)).toBe(false)
    writeCurrentTask(sample)
    expect(fs.existsSync(configDir)).toBe(true)
  })

  it('returns null on malformed JSON rather than throwing', () => {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, 'current-task.json'), '{not json')
    expect(readCurrentTask()).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    writeCurrentTask(sample)
    const partial = { ...sample, taskTitle: undefined as unknown as string }
    fs.writeFileSync(currentTaskPath(), JSON.stringify(partial))
    expect(readCurrentTask()).toBeNull()
  })

  it('clearCurrentTask removes the file and reports the deletion', () => {
    writeCurrentTask(sample)
    expect(clearCurrentTask()).toBe(true)
    expect(readCurrentTask()).toBeNull()
  })

  it('clearCurrentTask returns false when nothing to clear', () => {
    expect(clearCurrentTask()).toBe(false)
  })
})
