export default function DropboxLogo({ size = 32 }: { size?: number }) {
  // Simple placeholder - in production would use actual Dropbox SVG logo
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#007EE5"
        d="M12 2L2.5 9.5L12 17l9.5-7.5L12 2zm0 3.4L18.6 10.9L12 15.2L5.4 10.9L12 5.4z"
      />
    </svg>
  )
}
