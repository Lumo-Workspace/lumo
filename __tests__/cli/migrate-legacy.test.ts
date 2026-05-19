/**
 * @jest-environment node
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { migrateLegacyCurrentTask } from '@/cli/src/lib/session-binding'

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumo-migrate-'))
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

describe('migrateLegacyCurrentTask', () => {
  it('returns false when the legacy file does not exist', () => {
    expect(migrateLegacyCurrentTask()).toBe(false)
  })

  it('deletes the legacy file when present and returns true', () => {
    fs.mkdirSync(configDir, { recursive: true })
    const legacy = path.join(configDir, 'current-task.json')
    fs.writeFileSync(legacy, '{"taskId":"x"}')
    expect(migrateLegacyCurrentTask()).toBe(true)
    expect(fs.existsSync(legacy)).toBe(false)
  })

  it('is idempotent across calls', () => {
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(path.join(configDir, 'current-task.json'), '{}')
    expect(migrateLegacyCurrentTask()).toBe(true)
    expect(migrateLegacyCurrentTask()).toBe(false)
  })
})
