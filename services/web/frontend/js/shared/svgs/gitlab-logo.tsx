import * as React from 'react'

const GitLabLogo = ({ size = 32, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      d="M18.5 6c-2.5 0-4.5 2-4.5 4.5s2 4.5 4.5 4.5c2.5 0 4.5-2 4.5-4.5S21 6 18.5 6zm-9 0C7 6 5 8 5 10.5S7 15 9.5 15s4.5-2 4.5-4.5S12 6 9.5 6zM22 18H2l-2 2h22l-2-2zm-2 0L19 22H3l2-4h18z"
      fill="#FC6D26"
    />
  </svg>
)

export default GitLabLogo
