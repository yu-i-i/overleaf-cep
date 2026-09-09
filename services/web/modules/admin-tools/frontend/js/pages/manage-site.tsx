import { createRoot } from 'react-dom/client'
import SiteSettingsRoot from '../site-settings/site-settings-root'

const element = document.getElementById('manage-site-root')
if (element) {
  const root = createRoot(element)
  root.render(<SiteSettingsRoot />)
}
