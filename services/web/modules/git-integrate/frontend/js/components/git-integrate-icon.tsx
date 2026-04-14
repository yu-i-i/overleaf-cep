/**
 * git-integrate: SVG icon — a git branch symbol.
 *
 * A simple inline SVG that works well at both 16 px (menu button) and
 * 32 px (integration card).  Drop-in replacement for the git-bridge module's
 * GitFork / GitLogoOrange components when the git-bridge module is absent.
 */

import type React from 'react'

interface GitIntegrateIconProps {
    size?: number
    className?: string
}

const GitIntegrateIcon: React.FC<GitIntegrateIconProps> = ({
    size = 24,
    className = '',
}) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        {/* Branch line from bottom-centre to top-left */}
        <line x1="6" y1="3" x2="6" y2="15" />
        {/* Merge curve */}
        <path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M18 6c0 4-6 7-6 12" />
    </svg>
)

export default GitIntegrateIcon
