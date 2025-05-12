import './../utils/meta'
import '../utils/webpack-public-path'
import './../infrastructure/error-reporter'
import '@/i18n'
import '../features/event-tracking'
import '../features/cookie-banner'
import '../features/link-helpers/slow-link'
import ReactDOM from 'react-dom/client'
import TemplateRoot from '../features/template/components/template-root'

const element = document.getElementById('template-root')
if (element) {
  const root = ReactDOM.createRoot(element)
  root.render(<TemplateRoot />)
}
