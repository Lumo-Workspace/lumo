import { cn } from '@/lib/utils'

const COLOR_MAP: Record<string, string> = {
  TODO: 'bg-zinc-300 dark:bg-zinc-600',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW: 'bg-violet-500',
  DONE: 'bg-emerald-500',
}

export function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'size-2 rounded-full shrink-0',
        COLOR_MAP[status] ?? 'bg-zinc-300'
      )}
    />
  )
}
