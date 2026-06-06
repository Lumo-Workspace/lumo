import { cn } from '@/lib/utils'

// Typography components following shadcn/ui design system

const H1_ALIGN_CLASS = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const

type TypographyH1Props = React.HTMLAttributes<HTMLHeadingElement> & {
  /**
   * Horizontal alignment. Defaults to `left` to match document/page
   * heading convention. Pass `center` to restore the marketing-page
   * shadcn default.
   */
  align?: keyof typeof H1_ALIGN_CLASS
  /**
   * Apply CSS `text-wrap: balance` (Tailwind `text-balance`) so the
   * heading wraps with visually balanced line widths. Default off —
   * balanced wrap reads well on landing heroes but is unnecessary
   * (and slightly costly) on most app-level headings.
   */
  balance?: boolean
}

export function TypographyH1({
  className,
  children,
  align = 'left',
  balance = false,
  ...props
}: TypographyH1Props) {
  return (
    <h1
      className={cn(
        'scroll-m-20 text-display tracking-tight',
        H1_ALIGN_CLASS[align],
        balance && 'text-balance',
        className
      )}
      {...props}
    >
      {children}
    </h1>
  )
}

export function TypographyH2({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'scroll-m-20 border-b pb-2 text-heading tracking-tight first:mt-0',
        className
      )}
      {...props}
    >
      {children}
    </h2>
  )
}

export function TypographyH3({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'scroll-m-20 text-heading tracking-tight',
        className
      )}
      {...props}
    >
      {children}
    </h3>
  )
}

export function TypographyH4({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h4
      className={cn(
        'scroll-m-20 text-title tracking-tight',
        className
      )}
      {...props}
    >
      {children}
    </h4>
  )
}

export function TypographyH5({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5
      className={cn(
        'scroll-m-20 text-title tracking-tight',
        className
      )}
      {...props}
    >
      {children}
    </h5>
  )
}

export function TypographyH6({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h6
      className={cn(
        'scroll-m-20 text-title tracking-tight',
        className
      )}
      {...props}
    >
      {children}
    </h6>
  )
}

export function TypographyP({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-body [&:not(:first-child)]:mt-6', className)}
      {...props}
    >
      {children}
    </p>
  )
}

export function TypographyLead({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-muted-foreground text-heading', className)} {...props}>
      {children}
    </p>
  )
}

export function TypographyLarge({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('text-title', className)} {...props}>
      {children}
    </div>
  )
}

export function TypographySmall({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <small
      className={cn('text-caption leading-none', className)}
      {...props}
    >
      {children}
    </small>
  )
}

export function TypographyMuted({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-muted-foreground text-caption', className)} {...props}>
      {children}
    </p>
  )
}

export function TypographyBlockquote({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLQuoteElement>) {
  return (
    <blockquote
      className={cn('mt-6 border-l-2 pl-6 italic', className)}
      {...props}
    >
      {children}
    </blockquote>
  )
}

export function TypographyList({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={cn('my-6 ml-6 list-disc [&>li]:mt-2', className)} {...props}>
      {children}
    </ul>
  )
}

export function TypographyOrderedList({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLOListElement>) {
  return (
    <ol
      className={cn('my-6 ml-6 list-decimal [&>li]:mt-2', className)}
      {...props}
    >
      {children}
    </ol>
  )
}

export function TypographyInlineCode({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        'relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold',
        className
      )}
      {...props}
    >
      {children}
    </code>
  )
}

export function TypographyCode({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLPreElement>) {
  return (
    <pre
      className={cn(
        'mb-4 mt-6 overflow-x-auto rounded-lg border bg-muted p-4',
        className
      )}
      {...props}
    >
      <code className='relative font-mono text-sm font-semibold'>
        {children}
      </code>
    </pre>
  )
}

export function TypographyTable({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className='my-6 w-full overflow-y-auto'>
      <table className={cn('w-full', className)} {...props}>
        {children}
      </table>
    </div>
  )
}

export function TypographyTableHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('[&_tr]:border-b', className)} {...props}>
      {children}
    </thead>
  )
}

export function TypographyTableBody({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props}>
      {children}
    </tbody>
  )
}

export function TypographyTableRow({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('even:bg-muted m-0 border-t p-0', className)} {...props}>
      {children}
    </tr>
  )
}

export function TypographyTableHead({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right',
        className
      )}
      {...props}
    >
      {children}
    </th>
  )
}

export function TypographyTableCell({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right',
        className
      )}
      {...props}
    >
      {children}
    </td>
  )
}
