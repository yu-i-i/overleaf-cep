import React, { useEffect, useMemo, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import OLForm from '@/features/ui/components/ol/ol-form'
import OLFormGroup from '@/features/ui/components/ol/ol-form-group'
import OLFormControl from '@/features/ui/components/ol/ol-form-control'
import OLFormLabel from '@/features/ui/components/ol/ol-form-label'
import OLButton from '@/features/ui/components/ol/ol-button'
import withErrorBoundary from '../../../infrastructure/error-boundary'
import { Template } from '../../../../../types/template'
import TemplateActionModal from './template-action-modal'
import { useTemplateContext } from '../context/template-context'
import SettingsTemplateCategory from './settings/settings-template-category'
import SettingsLanguage from './settings/settings-language'

type EditTemplateModalProps = {
  showModal: boolean
  handleCloseModal: () => void
  actionHandler: (editedTemplate: Template) => void | Promise<void>
}

function EditTemplateModal({
  showModal,
  handleCloseModal,
  actionHandler,
}: EditTemplateModalProps) {
  const { t } = useTranslation()
  const { template } = useTemplateContext()
  const [editedTemplate, setEditedTemplate] = useState<Template>({ ...template })
  const [actionError, setActionError] = useState<any>(null)

  useEffect(() => {
    if (showModal) {
      setEditedTemplate({ ...template })
      setActionError(null)
    }
  }, [showModal, template])

  const isConflictError = actionError?.info?.statusCode === 409

  const valid = useMemo(
    () => editedTemplate.name.trim().length > 0 && editedTemplate.license.trim().length > 0,
    [editedTemplate.name, editedTemplate.license]
  )

  const clearModalErrorRef = useRef<() => void>(() => {})

  return (
    <TemplateActionModal
      action="edit"
      title={t('edit_template')}
      template={editedTemplate}
      showModal={showModal}
      handleCloseModal={handleCloseModal}
      actionHandler={() =>
        Promise.resolve(actionHandler(editedTemplate)).catch(err => {
          setActionError(err)
          throw err
        })
      }
      renderFooterButtons={({ onConfirm, onCancel, isProcessing }) => (
        <>
          <OLButton variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </OLButton>
          <OLButton
            onClick={onConfirm}
            variant="primary"
            type="submit"
            form="edit-template-form"
            disabled={!valid || isProcessing || isConflictError}
          >
            {t('save')}
          </OLButton>
        </>
      )}
      onClearError={fn => {
        clearModalErrorRef.current = fn
      }}
    >
      <OLForm id="edit-template-form" onSubmit={e => e.preventDefault()}>
        <OLFormGroup controlId="edit-template-form-title">
          <OLFormLabel>{t('template_title')}</OLFormLabel>
          <OLFormControl
            type="text"
            required
            value={editedTemplate.name}
            onChange={e => {
              setEditedTemplate(prev => ({ ...prev, name: e.target.value }))
              if (isConflictError) {
                setActionError(null)
                clearModalErrorRef.current?.()
              }
            }}
          />
        </OLFormGroup>

        <OLFormGroup controlId="edit-template-form-category">
          <SettingsTemplateCategory
            value={editedTemplate.category}
            onChange={category =>
              setEditedTemplate(prev => ({ ...prev, category }))
            }
          />
        </OLFormGroup>

        <OLFormGroup controlId="edit-template-form-author">
          <OLFormLabel>{t('Author')}</OLFormLabel>
          <OLFormControl
            type="text"
            value={editedTemplate.authorMD}
            onChange={e =>
              setEditedTemplate(prev => ({ ...prev, authorMD: e.target.value }))
            }
          />
        </OLFormGroup>

        <OLFormGroup controlId="edit-template-form-license">
          <OLFormLabel>{t('License')}</OLFormLabel>
          <OLFormControl
            type="text"
            required
            value={editedTemplate.license}
            onChange={e =>
              setEditedTemplate(prev => ({ ...prev, license: e.target.value }))
            }
          />
        </OLFormGroup>

        <OLFormGroup controlId="edit-template-form-description">
          <OLFormLabel>{t('template_description')}</OLFormLabel>
          <OLFormControl
            as="textarea"
            value={editedTemplate.descriptionMD}
            onChange={e =>
              setEditedTemplate(prev => ({ ...prev, descriptionMD: e.target.value }))
            }
            rows={6}
          />
        </OLFormGroup>

        <OLFormGroup controlId="edit-template-form-language">
          <SettingsLanguage
            value={editedTemplate.language}
            onChange={language =>
              setEditedTemplate(prev => ({ ...prev, language }))
            }
          />
        </OLFormGroup>
      </OLForm>
    </TemplateActionModal>
  )
}
export default withErrorBoundary(React.memo(EditTemplateModal))
