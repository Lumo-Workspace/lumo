/**
 * @jest-environment node
 *
 * LUM-1072 — sealed (encrypted) migration files and the outside-git guard.
 */
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertOutsideGitRepo,
  findGitWorkTree,
  isSealed,
  passphraseFromEnv,
  PASSPHRASE_ENV,
  readSealedFile,
  seal,
  unseal,
  writeSealedFile,
} from '@/lib/auth-migration/sealed-file'

const PASS = 'correct horse battery staple 42'

describe('LUM-1072 sealed files', () => {
  it('seal/unseal round-trips; ciphertext does not contain the plaintext', () => {
    const plain = Buffer.from('{"email":"ada@example.com"}')
    const sealed = seal(plain, PASS)
    expect(isSealed(sealed)).toBe(true)
    expect(sealed.includes(Buffer.from('ada@example.com'))).toBe(false)
    expect(unseal(sealed, PASS).equals(plain)).toBe(true)
    // Fresh salt + IV every time.
    expect(seal(plain, PASS).equals(sealed)).toBe(false)
  })

  it('wrong passphrase, tampering and plaintext input are refused', () => {
    const sealed = seal(Buffer.from('data'), PASS)
    expect(() => unseal(sealed, `${PASS}!`)).toThrow(/wrong passphrase/)
    const tampered = Buffer.from(sealed)
    tampered[tampered.length - 20]! ^= 1
    expect(() => unseal(tampered, PASS)).toThrow(
      /wrong passphrase or the file is damaged/
    )
    expect(() => unseal(Buffer.from('id,email\n'), PASS)).toThrow(
      /Not a sealed file/
    )
  })

  it('passphrase comes from the environment and must be long enough', () => {
    expect(passphraseFromEnv({ [PASSPHRASE_ENV]: PASS })).toBe(PASS)
    expect(() => passphraseFromEnv({})).toThrow(/is not set/)
    expect(() => passphraseFromEnv({ [PASSPHRASE_ENV]: 'short' })).toThrow(
      /at least 20/
    )
  })

  it('refuses paths inside a git work tree (this repository), allows a temp dir', () => {
    const inRepo = path.join(process.cwd(), 'scripts', 'export.enc')
    expect(findGitWorkTree(inRepo)).not.toBeNull()
    expect(() => assertOutsideGitRepo(inRepo, '--out')).toThrow(
      /inside a git repository/
    )
    const dir = mkdtempSync(path.join(tmpdir(), 'lum1072-'))
    expect(findGitWorkTree(path.join(dir, 'not-yet', 'x.enc'))).toBeNull()
    expect(() => writeSealedFile(inRepo, Buffer.from('x'), PASS)).toThrow(
      /inside a git repository/
    )
  })

  it('writeSealedFile writes mode 600, never overwrites; readSealedFile decrypts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lum1072-'))
    const file = path.join(dir, 'bundle.enc')
    writeSealedFile(file, Buffer.from('hello'), PASS)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(isSealed(readFileSync(file))).toBe(true)
    expect(readSealedFile(file, PASS).toString()).toBe('hello')
    expect(() => writeSealedFile(file, Buffer.from('again'), PASS)).toThrow(
      /already exists/
    )
    const plainFile = path.join(dir, 'plain.csv')
    writeFileSync(plainFile, 'id\n')
    expect(() => readSealedFile(plainFile, PASS)).toThrow(/Not a sealed file/)
    expect(() => readSealedFile(path.join(dir, 'missing.enc'), PASS)).toThrow(
      /does not exist/
    )
  })
})
