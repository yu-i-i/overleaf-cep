import { createRoot } from 'react-dom/client'
import AdminPanelRoot from '../admin-panel-root'

const element = document.getElementById('admin-panel-root')
if (element) {
  const root = createRoot(element)
  root.render(<AdminPanelRoot />)
}
