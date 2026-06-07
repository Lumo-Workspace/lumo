import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  findSelfReferentialNodeModules,
  removeSelfReferentialNodeModules,
} from '@/scripts/fix-nodemodules-selflink'

// A self-referential `node_modules/node_modules -> ../node_modules` symlink
// makes Turbopack's file globber recurse infinitely and hard-panic the build
// ("'node_modules/node_modules' is a symlink causes that causes an infinite
// loop!"). These tests pin the guard: it removes ONLY that self-loop, and is
// inert against a real nested directory or a legitimate (non-self) symlink.

describe('fix-nodemodules-selflink', () => {
  let dir: string
  let nm: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-selflink-'))
    nm = path.join(dir, 'node_modules')
    fs.mkdirSync(nm)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('detects + removes a relative self-referential node_modules/node_modules', () => {
    fs.symlinkSync('../node_modules', path.join(nm, 'node_modules'))

    expect(findSelfReferentialNodeModules(nm)).toBe(
      path.join(nm, 'node_modules')
    )
    expect(removeSelfReferentialNodeModules(nm)).toBe(
      path.join(nm, 'node_modules')
    )
    expect(fs.existsSync(path.join(nm, 'node_modules'))).toBe(false)
    // The real node_modules itself must survive.
    expect(fs.existsSync(nm)).toBe(true)
  })

  it('detects + removes an absolute self-referential link too', () => {
    fs.symlinkSync(nm, path.join(nm, 'node_modules'))
    expect(removeSelfReferentialNodeModules(nm)).toBe(
      path.join(nm, 'node_modules')
    )
    expect(fs.existsSync(path.join(nm, 'node_modules'))).toBe(false)
  })

  it('leaves a REAL nested node_modules directory untouched', () => {
    const nested = path.join(nm, 'node_modules')
    fs.mkdirSync(nested)
    fs.writeFileSync(path.join(nested, 'keep.txt'), 'x')

    expect(findSelfReferentialNodeModules(nm)).toBeNull()
    expect(removeSelfReferentialNodeModules(nm)).toBeNull()
    expect(fs.existsSync(path.join(nested, 'keep.txt'))).toBe(true)
  })

  it('leaves a legitimate (non-self) node_modules symlink untouched', () => {
    const other = path.join(dir, 'real-pkg')
    fs.mkdirSync(other)
    fs.symlinkSync(other, path.join(nm, 'node_modules'))

    expect(findSelfReferentialNodeModules(nm)).toBeNull()
    expect(removeSelfReferentialNodeModules(nm)).toBeNull()
    expect(fs.lstatSync(path.join(nm, 'node_modules')).isSymbolicLink()).toBe(
      true
    )
  })

  it('is a no-op when there is no nested node_modules', () => {
    expect(findSelfReferentialNodeModules(nm)).toBeNull()
    expect(removeSelfReferentialNodeModules(nm)).toBeNull()
  })
})
