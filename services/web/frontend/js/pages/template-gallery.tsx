import './../utils/meta'
import '../utils/webpack-public-path'
import './../infrastructure/error-reporter'
import '@/i18n'
import '../features/event-tracking'
import '../features/cookie-banner'
import '../features/link-helpers/slow-link'
import ReactDOM from 'react-dom/client'
import TemplateGalleryRoot from '../features/template-gallery/components/template-gallery-root'

const element = document.getElementById('template-gallery-root')
if (element) {
  const root = ReactDOM.createRoot(element)
  root.render(<TemplateGalleryRoot />)
}
