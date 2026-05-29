interface Props {
  size?: number
  className?: string
}

export function WindsurfIcon({
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
      <path d='M3 13.5L11 1.5l1 11-9 1zm1.6-1.3l5.6-.6-.6-6.9z' />
    </svg>
  )
}
