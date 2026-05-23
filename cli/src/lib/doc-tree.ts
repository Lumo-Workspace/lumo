/**
 * Minimal shape a tree node needs. doc-list rows carry more (visibility,
 * project, etc.) but this module only depends on the tree-shape fields.
 */
export interface TreeNode<
  T extends {
    id: string
    parentId?: string | null
    sortOrder?: number | null
  },
> {
  row: T
  children: TreeNode<T>[]
}

/**
 * Group a flat list of docs into a forest. Docs whose parentId is null OR
 * whose parent is absent from the input become roots ("virtual roots" in
 * spec parlance). Siblings are sorted by sortOrder ascending; ties broken
 * by id to keep ordering stable when sortOrder collides.
 */
export function buildTree<
  T extends {
    id: string
    parentId?: string | null
    sortOrder?: number | null
  },
>(rows: T[]): TreeNode<T>[] {
  const byId = new Map<string, TreeNode<T>>()
  for (const row of rows) {
    byId.set(row.id, { row, children: [] })
  }

  const roots: TreeNode<T>[] = []
  for (const row of rows) {
    const node = byId.get(row.id)!
    const parent = row.parentId ? byId.get(row.parentId) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (nodes: TreeNode<T>[]) => {
    nodes.sort((a, b) => {
      const ao = a.row.sortOrder ?? 0
      const bo = b.row.sortOrder ?? 0
      if (ao !== bo) return ao - bo
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0
    })
    for (const n of nodes) sortNodes(n.children)
  }
  sortNodes(roots)

  return roots
}

/**
 * Pre-order traversal yielding rows tagged with depth. Roots → depth 0.
 */
export function flattenWithDepth<
  T extends {
    id: string
    parentId?: string | null
    sortOrder?: number | null
  },
>(roots: TreeNode<T>[]): { row: T; depth: number }[] {
  const out: { row: T; depth: number }[] = []
  const visit = (node: TreeNode<T>, depth: number) => {
    out.push({ row: node.row, depth })
    for (const child of node.children) visit(child, depth + 1)
  }
  for (const r of roots) visit(r, 0)
  return out
}
