/**
 * @jest-environment node
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  readSessionBinding,
  writeSessionBinding,
  clearSessionBinding,
  sessionBindingPath,
  sessionBindingDir,
} from '@/cli/src/lib/session-binding'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-session-binding-'))
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
  taskIdentifier: 'LUM-40',
  taskTitle: 'Parallel sessions',
  workspaceSlug: 'lumo',
  startedAt: '2026-05-19T12:00:00.000Z',
}

describe('session-binding', () => {
  it('returns null when no binding file exists for the session', () => {
    expect(readSessionBinding('S1')).toBeNull()
  })

  it('round-trips write → read for a given sessionId', () => {
    writeSessionBinding('S1', sample)
    expect(readSessionBinding('S1')).toEqual(sample)
  })

  it('keeps bindings per-sessionId isolated', () => {
    const other = { ...sample, taskIdentifier: 'LUM-50' }
    writeSessionBinding('S1', sample)
    writeSessionBinding('S2', other)
    expect(readSessionBinding('S1')).toEqual(sample)
    expect(readSessionBinding('S2')).toEqual(other)
  })

  it('writes per-session files under <configDir>/sessions/<sid>.json with 0600', () => {
    writeSessionBinding('S1', sample)
    const p = sessionBindingPath('S1')
    expect(p).toBe(path.join(configDir, 'sessions', 'S1.json'))
    expect(fs.statSync(p).mode & 0o777).toBe(0o600)
  })

  it('creates the sessions directory with 0700 when missing', () => {
    expect(fs.existsSync(sessionBindingDir())).toBe(false)
    writeSessionBinding('S1', sample)
    expect(fs.statSync(sessionBindingDir()).mode & 0o777).toBe(0o700)
  })

  it('returns null on malformed JSON rather than throwing', () => {
    fs.mkdirSync(sessionBindingDir(), { recursive: true })
    fs.writeFileSync(sessionBindingPath('S1'), '{not json')
    expect(readSessionBinding('S1')).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    writeSessionBinding('S1', sample)
    const partial = { ...sample, taskTitle: undefined as unknown as string }
    fs.writeFileSync(sessionBindingPath('S1'), JSON.stringify(partial))
    expect(readSessionBinding('S1')).toBeNull()
  })

  it('clearSessionBinding removes the file and reports the deletion', () => {
    writeSessionBinding('S1', sample)
    expect(clearSessionBinding('S1')).toBe(true)
    expect(readSessionBinding('S1')).toBeNull()
  })

  it('clearSessionBinding returns false when nothing to clear', () => {
    expect(clearSessionBinding('S1')).toBe(false)
  })

  it('clearing one session does not touch another', () => {
    writeSessionBinding('S1', sample)
    writeSessionBinding('S2', sample)
    expect(clearSessionBinding('S1')).toBe(true)
    expect(readSessionBinding('S2')).toEqual(sample)
  })
})
