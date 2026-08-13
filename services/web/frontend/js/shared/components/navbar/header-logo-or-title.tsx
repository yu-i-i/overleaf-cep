import type { DefaultNavbarMetadata } from '@/shared/components/types/default-navbar-metadata'
import getMeta from '@/utils/meta'

export default function HeaderLogoOrTitle({
  overleafLogo,
  customLogo,
  title,
}: Pick<DefaultNavbarMetadata, 'customLogo' | 'title'> & {
  overleafLogo?: string
}) {
  const { appName } = getMeta('ol-ExposedSettings')
  return (
    <a href="/" aria-label={appName} className="navbar-brand">
      {(customLogo || !title) && (
        <div
          className={`navbar-logo${customLogo ? ' navbar-logo-custom' : ''}`}
          style={
            !customLogo && overleafLogo
              ? { backgroundImage: `url("${overleafLogo}")` }
              : undefined
          }
        />
      )}
      {title && (
        <div className="navbar-title">
          <span>{title}</span>
        </div>
      )}
    </a>
  )
}
