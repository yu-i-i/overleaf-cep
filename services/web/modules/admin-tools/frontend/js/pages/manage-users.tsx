import { createRoot } from 'react-dom/client'
import ManageUsersRoot from '../manage-users-root'

const element = document.getElementById('manage-users-root')
if (element) {
  const root = createRoot(element)
  root.render(<ManageUsersRoot />)
}
