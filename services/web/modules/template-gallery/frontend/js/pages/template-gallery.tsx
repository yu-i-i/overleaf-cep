import ReactDOM from 'react-dom/client'
import TemplateGalleryRoot from '../features/template-gallery/components/template-gallery-root'

const element = document.getElementById('template-gallery-root')
if (element) {
  const root = ReactDOM.createRoot(element)
  root.render(<TemplateGalleryRoot />)
}
