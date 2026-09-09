import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ImportFromWebdavModalWrapperProps {
  onImportClick: () => void
}

export default function ImportFromWebdavModalWrapper({ onImportClick }: ImportFromWebdavModalWrapperProps) {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)

  const handleImport = () => {
    setShowModal(false)
    onImportClick()
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
        {t('webdav.import_from_webdav')}
      </button>

      {showModal && (
        <div
          className="modal fade show d-block"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
          role="dialog"
          tabIndex={-1}
        >
          <div className="modal-dialog" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('webdav.import_from_webdav')}</h5>
                <button
                  type="button"
                  className="close"
                  onClick={() => setShowModal(false)}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>

              <div className="modal-body">
                {/* Project selection dropdown */}
                <div className="form-group mb-3">
                  <label htmlFor="webdav-project-select">{t('project.project')}:</label>
                  <select id="webdav-project-select" className="form-control">
                    <option value="">{t('common.select_project')}</option>
                    {/* Options populated dynamically */}
                  </select>
                </div>

                {/* Remote path input */}
                <div className="form-group mb-3">
                  <label htmlFor="webdav-path-input">{t('webdav.remote_path')}:</label>
                  <input
                    id="webdav-path-input"
                    type="text"
                    className="form-control"
                    placeholder="/Overleaf/my-project"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  {t('common.cancel')}
                </button>
                <button type="button" className="btn btn-primary" onClick={handleImport}>
                  {t('webdav.import')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}