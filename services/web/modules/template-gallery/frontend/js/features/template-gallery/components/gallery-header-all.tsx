import { useTranslation } from 'react-i18next'
import OLCol from '@/shared/components/ol/ol-col'
import OLRow from '@/shared/components/ol/ol-row'

// R6 (2026-08-29): compact /templates header — the eyebrow + long summary
// wasted a full screen area; keep a tight, functional title.
// R9 item 5 (2026-08-29): the "Manage template gallery" link moved into the
// account menu (above the Manage submenu) — removed from here.
export default function GalleryHeaderAll() {
  const { t } = useTranslation()
  return (
    <div className="gallery-header gallery-header-compact">
      <OLRow>
        <OLCol md={12}>
          <h1 className="gallery-title" style={{ margin: 0 }}>
            {t('latex_templates')}
          </h1>
        </OLCol>
      </OLRow>
    </div>
  )
}
