import ReactDOM from 'react-dom/client'
import TemplateRoot from '../features/template/components/template-root'

const element = document.getElementById('template-root')
if (element) {
  const root = ReactDOM.createRoot(element)
  root.render(<TemplateRoot />)
}
