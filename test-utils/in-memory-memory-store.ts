/**
 * In-memory Prisma fake + shared suite for the LUM-326 selective-forgetting
 * integration test.
 *
 * Why a stateful fake instead of method-level jest mocks (the LUM-325 style):
 * this test proves an *emergent* invariant — after a real SUPERSEDE apply, the
 * active/injection read set converges to {A'} and excludes {A}. A method-level
 * mock would just echo whatever the test tells it to return, proving nothing
 * about convergence. So we back `@/lib/db/prisma` with a tiny stateful store
 * and run the REAL repository + apply code over it. Only the persistence layer
 * is faked; the supersede flip, the `status='ACTIVE'` read filter, and the
 * provenance walk all execute for real. The reconcile LLM (which *decides* the
 * SUPERSEDE op) and the embedding gateway are out of scope here and mocked at
 * the call site — this asserts the pipeline AFTER the decision, not the
 * decision quality (that's LUM-329 eval).
 *
 * Lives outside `__tests__/` so jest's `**∕__tests__∕**` testMatch doesn't try
 * to run it as a suite; imported by the two root copies via `@/test-utils/…`.
 */
import type { MemoryCategory } from '@prisma/client'
import type { Layer1Operation } from '@/lib/services/memory/layer1-extract'

export interface MemoryRow {
  id: string
  workspaceId: string
  projectId: string
  taskId: string | null
  scope: string
  category: string
  agent: string
  content: unknown
  sourceSessionId: string | null
  createdByMemberId: string | null
  status: string
  createdAt: Date
  validFrom: Date
  supersededAt: Date | null
  supersededById: string | null
}

export interface ProvenanceRow {
  id: string
  parentMemoryId: string
  childMemoryId: string
  createdAt: Date
}

/** Seed input — id/scope/owner are explicit; the rest fall back to defaults. */
export interface SeedMemoryInput {
  id: string
  projectId: string
  taskId: string | null
  workspaceId?: string
  scope?: string
  category?: string
  agent?: string
  content?: unknown
  sourceSessionId?: string | null
  createdByMemberId?: string | null
  status?: string
}

/** Test-side handle hung off the fake `prisma` so suites can seed + inspect. */
export interface InMemoryMemoryStore {
  reset(): void
  seedMemory(input: SeedMemoryInput): MemoryRow
  memories(): MemoryRow[]
  provenance(): ProvenanceRow[]
  getMemory(id: string): MemoryRow | undefined
}

type WhereClause = Record<string, unknown> | undefined
type OrderBy = { createdAt?: 'asc' | 'desc' } | undefined
type Select = Record<string, boolean> | undefined

/**
 * Build a structural fake of the slice of PrismaClient the memory repositories
 * touch. Equality-only WHERE matching and single-key `createdAt` ordering are
 * all the exercised paths use. A monotonic clock guarantees each successive
 * write gets a strictly-later `createdAt` — that's what makes the "later fact
 * wins" ordering assertion deterministic without `Date.now()`.
 */
export function makeInMemoryPrisma() {
  const memories: MemoryRow[] = []
  const provenance: ProvenanceRow[] = []
  const CLOCK_BASE = 1_700_000_000_000
  let tick = 0
  let idSeq = 0
  const nextDate = (): Date => new Date(CLOCK_BASE + tick++ * 1000)
  const nextId = (prefix: string): string => `${prefix}_${++idSeq}`

  const project = <T extends object>(
    row: T,
    select: Select
  ): Record<string, unknown> => {
    const r = row as Record<string, unknown>
    if (!select) return { ...r }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(select)) {
      if (select[key]) out[key] = r[key]
    }
    return out
  }

  const matches = (row: object, where: WhereClause): boolean => {
    if (!where) return true
    const r = row as Record<string, unknown>
    for (const [key, value] of Object.entries(where)) {
      if (r[key] !== value) return false
    }
    return true
  }

  const sortByCreatedAt = <T extends { createdAt: Date }>(
    rows: T[],
    orderBy: OrderBy
  ): T[] => {
    if (!orderBy?.createdAt) return rows
    const dir = orderBy.createdAt === 'desc' ? -1 : 1
    return [...rows].sort(
      (a, b) => (a.createdAt.getTime() - b.createdAt.getTime()) * dir
    )
  }

  const store: InMemoryMemoryStore = {
    reset() {
      memories.length = 0
      provenance.length = 0
      tick = 0
      idSeq = 0
    },
    seedMemory(input) {
      const now = nextDate()
      const row: MemoryRow = {
        id: input.id,
        workspaceId: input.workspaceId ?? 'ws_1',
        projectId: input.projectId,
        taskId: input.taskId,
        scope: input.scope ?? 'TASK',
        category: input.category ?? 'CONVENTION',
        agent: input.agent ?? 'CLAUDE_CODE',
        content: input.content ?? {},
        sourceSessionId: input.sourceSessionId ?? null,
        createdByMemberId: input.createdByMemberId ?? null,
        status: input.status ?? 'ACTIVE',
        createdAt: now,
        validFrom: now,
        supersededAt: null,
        supersededById: null,
      }
      memories.push(row)
      return { ...row }
    },
    memories: () => memories.map(m => ({ ...m })),
    provenance: () => provenance.map(p => ({ ...p })),
    getMemory: id => {
      const row = memories.find(m => m.id === id)
      return row ? { ...row } : undefined
    },
  }

  const fake = {
    memory: {
      async findUniqueOrThrow({
        where,
        select,
      }: {
        where: { id: string }
        select?: Select
      }) {
        const row = memories.find(m => m.id === where.id)
        if (!row) throw new Error(`Memory ${where.id} not found`)
        return project(row, select)
      },
      async findUnique({
        where,
        select,
      }: {
        where: { id: string }
        select?: Select
      }) {
        const row = memories.find(m => m.id === where.id)
        return row ? project(row, select) : null
      },
      async findFirst({
        where,
        select,
      }: {
        where?: WhereClause
        select?: Select
      }) {
        const row = memories.find(m => matches(m, where))
        return row ? project(row, select) : null
      },
      async findMany({
        where,
        orderBy,
        select,
      }: {
        where?: WhereClause
        orderBy?: OrderBy
        select?: Select
      }) {
        const rows = sortByCreatedAt(
          memories.filter(m => matches(m, where)),
          orderBy
        )
        return rows.map(r => project(r, select))
      },
      async create({
        data,
        select,
      }: {
        data: Record<string, unknown>
        select?: Select
      }) {
        const now = nextDate()
        const row: MemoryRow = {
          id: nextId('mem'),
          workspaceId: data.workspaceId as string,
          projectId: data.projectId as string,
          taskId: (data.taskId as string | null) ?? null,
          scope: data.scope as string,
          category: data.category as string,
          agent: (data.agent as string) ?? 'CLAUDE_CODE',
          content: data.content,
          sourceSessionId: (data.sourceSessionId as string | null) ?? null,
          createdByMemberId: (data.createdByMemberId as string | null) ?? null,
          status: (data.status as string) ?? 'ACTIVE',
          createdAt: now,
          validFrom: now,
          supersededAt: null,
          supersededById: null,
        }
        memories.push(row)
        return project(row, select)
      },
      async update({
        where,
        data,
        select,
      }: {
        where: { id: string }
        data: Record<string, unknown>
        select?: Select
      }) {
        const row = memories.find(m => m.id === where.id)
        if (!row) throw new Error(`Memory ${where.id} not found`)
        Object.assign(row, data)
        return project(row, select)
      },
      async updateMany({
        where,
        data,
      }: {
        where: { id?: { in: string[] } } & WhereClause
        data: Record<string, unknown>
      }) {
        const { id: idFilter, ...flat } = where ?? {}
        const targets = memories.filter(
          m =>
            (!idFilter || idFilter.in.includes(m.id)) &&
            matches(m, flat as WhereClause)
        )
        for (const row of targets) Object.assign(row, data)
        return { count: targets.length }
      },
    },
    memoryProvenance: {
      async create({
        data,
      }: {
        data: { parentMemoryId: string; childMemoryId: string }
      }) {
        const edge: ProvenanceRow = {
          id: nextId('prov'),
          parentMemoryId: data.parentMemoryId,
          childMemoryId: data.childMemoryId,
          createdAt: nextDate(),
        }
        provenance.push(edge)
        return { ...edge }
      },
      async findFirst({
        where,
        orderBy,
        select,
      }: {
        where?: WhereClause
        orderBy?: OrderBy
        select?: Select
      }) {
        const rows = sortByCreatedAt(
          provenance.filter(p => matches(p, where)),
          orderBy
        )
        const row = rows[0]
        return row ? project(row, select) : null
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      // No real isolation — run the callback against the same in-memory store.
      return fn(fake)
    },
    async $executeRaw(): Promise<number> {
      // pgvector embedding write — a no-op here; the active filter never reads
      // the embedding column, so it's irrelevant to selective-forgetting.
      return 0
    },
    /** Back-channel for the suite to seed + inspect rows. */
    $store: store,
  }

  return fake
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared suite — invoked from both test roots (__tests__/ and tests/) so the
// later-fact-wins invariant is covered under each runner without duplicating
// the assertions. Each root file owns the jest.mock wiring (hoisted, file-
// scoped) and passes the resolved real modules + a guard setter in here.
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectiveForgettingDeps {
  applyLayer1Operations: (input: {
    operations: Layer1Operation[]
    taskId: string
    projectId: string
    workspaceId: string
    sessionId: string
    existingMemories: Array<{ id: string; category: MemoryCategory }>
  }) => Promise<{ superseded: number; skipped: number }>
  memoryRepository: {
    findActiveTaskMemories: (taskId: string) => Promise<Array<{ id: string }>>
  }
  memoryProvenanceRepository: {
    resolveCanonicalFragment: (
      fragmentType: string,
      fragmentId: string
    ) => Promise<string>
  }
  store: InMemoryMemoryStore
  /** Set which SUPERSEDE target ids the (mocked) usage-trust guard protects. */
  setGuarded: (ids: string[]) => void
  /** Reset the call-site mocks (embedding + guard) between tests. */
  resetMocks: () => void
}

export function runSelectiveForgettingSuite(
  deps: SelectiveForgettingDeps
): void {
  const {
    applyLayer1Operations,
    memoryRepository,
    memoryProvenanceRepository,
    store,
    setGuarded,
    resetMocks,
  } = deps

  const TASK = 'task_sf'
  const PROJECT = 'proj_sf'
  // FactConsolidation counterfactual edit pair: A states the original fact,
  // A' contradicts it and arrives later. "later fact wins."
  const FACT_A = {
    rule: 'Use GraphQL for all API endpoints',
    scope: 'api layer',
  }
  const FACT_A_PRIME = {
    rule: 'Use REST for all API endpoints',
    scope: 'api layer',
  }

  const seedA = () =>
    store.seedMemory({
      id: 'mem_A',
      taskId: TASK,
      projectId: PROJECT,
      scope: 'TASK',
      category: 'CONVENTION',
      content: FACT_A,
    })

  const applyInput = {
    operations: [
      {
        type: 'SUPERSEDE',
        id: 'mem_A',
        content: FACT_A_PRIME,
      } as Layer1Operation,
    ],
    taskId: TASK,
    projectId: PROJECT,
    workspaceId: 'ws_1',
    sessionId: 'sess_sf',
    existingMemories: [
      { id: 'mem_A', category: 'CONVENTION' as MemoryCategory },
    ],
  }

  describe('selective forgetting: FactConsolidation later-fact-wins invariant (LUM-326)', () => {
    beforeEach(() => {
      resetMocks()
      store.reset()
    })

    it('unguarded: a fresh low-trust memory is superseded — only the later fact stays active/injected', async () => {
      const a = seedA()
      setGuarded([]) // no usage trust signal → supersede proceeds

      const result = await applyLayer1Operations(applyInput)
      expect(result.superseded).toBe(1)
      expect(result.skipped).toBe(0)

      // Old row: invalidated-not-deleted, content preserved verbatim for audit.
      const oldRow = store.getMemory('mem_A')!
      expect(oldRow.status).toBe('SUPERSEDED')
      expect(oldRow.supersededAt).toBeInstanceOf(Date)
      expect(oldRow.content).toEqual(FACT_A)

      const newId = oldRow.supersededById
      expect(newId).toBeTruthy()
      const newRow = store.getMemory(newId!)!
      expect(newRow.status).toBe('ACTIVE')
      expect(newRow.content).toEqual(FACT_A_PRIME)

      // FactConsolidation ordering: the replacement is strictly later than A.
      expect(newRow.createdAt.getTime()).toBeGreaterThan(a.createdAt.getTime())
      expect(newRow.validFrom.getTime()).toBeGreaterThan(a.validFrom.getTime())

      // Provenance edge old→new so lineage rolls forward across the supersede.
      const edges = store.provenance()
      expect(edges).toHaveLength(1)
      expect(edges[0]!.parentMemoryId).toBe('mem_A')
      expect(edges[0]!.childMemoryId).toBe(newId)

      // Injection side (the real active read used by session-start): the set
      // converges to {A'} and excludes the forgotten {A}.
      const active = await memoryRepository.findActiveTaskMemories(TASK)
      expect(active.map(m => m.id)).toEqual([newId])

      // Lineage canonicalization: an edge keyed by the old id resolves forward.
      expect(
        await memoryProvenanceRepository.resolveCanonicalFragment(
          'MEMORY',
          'mem_A'
        )
      ).toBe(newId)
    })

    it('guarded: a high-trust (usage) memory survives the same contradicting SUPERSEDE', async () => {
      seedA()
      setGuarded(['mem_A']) // strong usage verdict → supersede is skipped

      const result = await applyLayer1Operations(applyInput)
      expect(result.superseded).toBe(0)
      expect(result.skipped).toBe(1)

      // The battle-tested memory keeps its ACTIVE row and original content.
      const row = store.getMemory('mem_A')!
      expect(row.status).toBe('ACTIVE')
      expect(row.content).toEqual(FACT_A)

      // No replacement row was written, no provenance edge created.
      expect(store.memories()).toHaveLength(1)
      expect(store.provenance()).toHaveLength(0)

      // Injection side still serves the original; lineage stays put.
      const active = await memoryRepository.findActiveTaskMemories(TASK)
      expect(active.map(m => m.id)).toEqual(['mem_A'])
      expect(
        await memoryProvenanceRepository.resolveCanonicalFragment(
          'MEMORY',
          'mem_A'
        )
      ).toBe('mem_A')
    })
  })
}
