function ForgejoLogo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 212 212"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
    >
      <g transform="translate(6 6)">
        <path
          d="M58 168V70a50 50 0 0 1 50-50h20"
          stroke="#f60"
          strokeWidth="25"
        />
        <path
          d="M58 168v-30a50 50 0 0 1 50-50h20"
          stroke="#d40000"
          strokeWidth="25"
        />
        <circle cx="142" cy="20" r="18" stroke="#f60" strokeWidth="15" />
        <circle cx="142" cy="88" r="18" stroke="#d40000" strokeWidth="15" />
        <circle cx="58" cy="180" r="18" stroke="#d40000" strokeWidth="15" />
      </g>
    </svg>
  )
}

export default ForgejoLogo
