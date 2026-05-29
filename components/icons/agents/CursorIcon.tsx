interface Props {
  size?: number
  className?: string
}

export function CursorIcon({
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
      <path d='M3 1.5l9.5 5.2-4 1 -1 4z' />
    </svg>
  )
}
