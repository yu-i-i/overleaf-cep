import { createRoot } from 'react-dom/client'
import ManageProjectsRoot from '../manage-projects-root'

const element = document.getElementById('manage-projects-root')
if (element) {
  const root = createRoot(element)
  root.render(<ManageProjectsRoot />)
}
