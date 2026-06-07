/**
 * Remove a self-referential `node_modules/node_modules -> ../node_modules`
 * symlink before Turbopack runs.
 *
 * Turbopack's file globber (read_glob → NftJsonAsset) does not guard against a
 * symlink that points back at its own parent, so such a link makes `next build`
 * (and `next dev`) hard-panic:
 *
 *   TurbopackInternalError: 'node_modules/node_modules' is a symlink causes
 *   that causes an infinite loop!
 *
 * The link is not committed (node_modules is gitignored) and has been observed
 * appearing in the main checkout's node_modules — most likely a transient npm
 * arborist artifact (older npm versions could plant it when installing through
 * a symlinked node_modules; current npm replaces the symlink instead, so the
 * exact creation path is not reproducible here). Rather than chase an elusive,
 * version-specific trigger, this guard fixes it deterministically at the layer
 * that breaks: it runs as `prebuild` / `predev` / `preanalyze`.
 *
 * Safety: it removes ONLY a symlink whose real target is the parent
 * node_modules. A real nested directory or a legitimate (non-self) symlink is
 * left untouched.
 */
import * as fs from 'fs'
import * as path from 'path'

/**
 * Return the path to a self-referential `<nodeModulesDir>/node_modules` symlink
 * (one that resolves back to `nodeModulesDir` itself), or null if there is no
 * such self-loop.
 */
export function findSelfReferentialNodeModules(
  nodeModulesDir: string
): string | null {
  const nested = path.join(nodeModulesDir, 'node_modules')

  let st: fs.Stats
  try {
    st = fs.lstatSync(nested)
  } catch {
    return null // nothing there
  }
  if (!st.isSymbolicLink()) return null // real dir/file — never touch it

  // Normal case: the link resolves to its own parent.
  try {
    if (fs.realpathSync(nested) === fs.realpathSync(nodeModulesDir)) {
      return nested
    }
  } catch {
    // realpath can throw ELOOP on a pathological chain; fall through to the
    // literal target check below.
  }

  // Fallback: compare the raw link target against the parent without resolving
  // (covers broken/loopy links realpath refuses to walk).
  try {
    const target = fs.readlinkSync(nested)
    const resolved = path.resolve(nodeModulesDir, target)
    if (resolved === path.resolve(nodeModulesDir)) return nested
  } catch {
    // ignore
  }

  return null
}

/**
 * Remove a self-referential node_modules/node_modules symlink if present.
 * Returns the removed path, or null when there was nothing to remove.
 */
export function removeSelfReferentialNodeModules(
  nodeModulesDir: string
): string | null {
  const found = findSelfReferentialNodeModules(nodeModulesDir)
  if (found) fs.unlinkSync(found)
  return found
}

// Run only when invoked as a script (not when imported by tests).
if (
  process.argv[1] &&
  process.argv[1].endsWith('fix-nodemodules-selflink.ts')
) {
  const removed = removeSelfReferentialNodeModules(
    path.join(process.cwd(), 'node_modules')
  )
  if (removed) {
    process.stdout.write(
      `fix-nodemodules-selflink: removed self-referential symlink ${removed}\n`
    )
  }
}
