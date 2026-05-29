interface Props {
  size?: number
  className?: string
}

export function CodexIcon({ size = 14, className }: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 16 16'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.4'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
      aria-hidden='true'
    >
      <circle cx='8' cy='8' r='5.5' />
      <path
        d='M5.5 8.5l1.8 1.8 3.2-3.6'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
