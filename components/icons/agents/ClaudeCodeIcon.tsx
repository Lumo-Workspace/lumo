interface Props {
  size?: number
  className?: string
}

export function ClaudeCodeIcon({
  size = 14,
  className,
}: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='currentColor'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <path d='M8 1.2l1.2 4 4-1.2-2.4 3.4 3.4 2.4-4-1.2-1.2 4-1.2-4-4 1.2 3.4-2.4-3.4-2.4 4 1.2z' />
    </svg>
  )
}
