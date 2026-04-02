const Figma = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width={24}
    height={24}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    {...props}
  >
    <path d='M8.5 2h3.5v7H8.5a3.5 3.5 0 110-7z' fill='#F24E1E' />
    <path d='M12 2h3.5a3.5 3.5 0 110 7H12V2z' fill='#FF7262' />
    <path d='M12 9.5h3.5a3.5 3.5 0 110 7H12v-7z' fill='#1ABCFE' />
    <path
      d='M5 19.5a3.5 3.5 0 013.5-3.5H12v3.5a3.5 3.5 0 11-7 0z'
      fill='#0ACF83'
    />
    <path
      d='M5 12.5A3.5 3.5 0 018.5 9H12v7H8.5A3.5 3.5 0 015 12.5z'
      fill='#A259FF'
    />
  </svg>
)
export default Figma
