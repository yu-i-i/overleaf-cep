import { useMemo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import { debugConsole } from '@/utils/debugging'
import { getJSON, postJSON } from '../../../infrastructure/fetch-json'
import Notification from '@/shared/components/notification'
import {
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/features/ui/components/ol/ol-modal'
import OLForm from '@/features/ui/components/ol/ol-form'
import OLFormGroup from '@/features/ui/components/ol/ol-form-group'
import OLFormControl from '@/features/ui/components/ol/ol-form-control'
import OLFormLabel from '@/features/ui/components/ol/ol-form-label'
import OLButton from '@/features/ui/components/ol/ol-button'
import { useDetachCompileContext } from '../../../shared/context/detach-compile-context'
import { useUserContext } from '../../../shared/context/user-context'
import SettingsTemplateCategory from './settings-template-category'

const defaultLicense = 'Creative Commons CC BY 4.0'

export default function ManageTemplateModalContent({
  handleHide,
  inFlight,
  setInFlight,
  handleAfterPublished,
  projectId,
  projectName,
}) {
  const { t } = useTranslation()

  const { pdfFile } = useDetachCompileContext()
  const user = useUserContext()

  const [error, setError] = useState()
  const [disablePublish, setDisablePublish] = useState(false)
  const [notificationType, setNotificationType] = useState('error')
  const [name, setName] = useState(`${projectName}`)
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState(`${user.first_name} ${user.last_name}`.trim())
  const [license, setLicense] = useState(defaultLicense)
  const [category, setCategory] = useState()
  const [override, setOverride] = useState(false)
  const [titleConflict, setTitleConflict] = useState(false)

  const valid = useMemo(
    () => name.trim().length > 0 && license.trim().length,
    [name, license]
  )

  useEffect(() => {
    const queryParams = new URLSearchParams({ key: 'name', val: projectName })
    getJSON(`/api/template?${queryParams}`)
      .then((data) => {
        if (!data) return
        setDescription(data.descriptionMD)
        setAuthor(data.authorMD)
        setLicense(data.license)
        setCategory(data.category)
      })
      .catch(debugConsole.error)
  }, [])

  const handleSubmit = event => {
    event.preventDefault()

    if (!valid) {
      return
    }

    setError(false)
    setInFlight(true)

    postJSON(`/template/new/${projectId}`, {
      body: {
        category,
        name: name.trim(),
        authorMD: author.trim(),
        license: license.trim(),
        descriptionMD: description.trim(),
        build: pdfFile.build,
        override,
      },
    })
      .then(data => {
        // redirect to template page
        handleHide()
        handleAfterPublished(data)
      })
      .catch(({ response, data }) => {
        if (response?.status === 409 && data.canOverride) {
          setNotificationType('warning')
          setOverride(true)
        } else {
          setNotificationType('error')
          setDisablePublish(true)
        }
        setError(data.message)
        if (response?.status === 409) setTitleConflict(true) 
      })
      .finally(() => {
        setInFlight(false)
      })
  }

  const handleNameChange = event => {
    setName(event.target.value)
    if (titleConflict) {
      setError(false)
      setOverride(false)
      if (disablePublish) setDisablePublish(false)
    }
  }

  return (
    <>
      <OLModalHeader closeButton>
        <OLModalTitle>{t('publish_as_template')}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        <OLForm id="publish-template-form" onSubmit={handleSubmit}>
          <OLFormGroup controlId="publish-template-form-title">
            <OLFormLabel>{t('template_title')}</OLFormLabel>
            <OLFormControl
              type="text"
              placeholder="New Template"
              required
              value={name}
              onChange={handleNameChange}
            />
          </OLFormGroup>
          <OLFormGroup controlId="publish-template-form-category">
            <SettingsTemplateCategory
              setCategory={setCategory}
              category={category}
            />
          </OLFormGroup>
          <OLFormGroup controlId="publish-template-form-author">
            <OLFormLabel>{t('Author')}</OLFormLabel>
            <OLFormControl
              type="text"
              placeholder="Anonymous"
              value={author}
              onChange={event => setAuthor(event.target.value)}
            />
          </OLFormGroup>
          <OLFormGroup controlId="publish-template-form-license">
            <OLFormLabel>{t('License')}</OLFormLabel>
            <OLFormControl
              type="text"
              placeholder="Template License"
              required
              value={license}
              onChange={event => setLicense(event.target.value)}
            />
          </OLFormGroup>
          <OLFormGroup controlId="publish-template-form-description">
            <OLFormLabel>{t('template_description')}</OLFormLabel>
            <OLFormControl
              as="textarea"
              value={description}
              onChange={event => setDescription(event.target.value)}
              rows={4}
              autoFocus
            />
          </OLFormGroup>
        </OLForm>
        {error && (
          <Notification
            content={error.length ? error : t('generic_something_went_wrong')}
            type={notificationType}
          />
        )}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" disabled={inFlight} onClick={handleHide}>
          {t('cancel')}
        </OLButton>
        <OLButton
          variant={override ? "danger" : "primary"}
          disabled={inFlight || !valid || disablePublish}
          form="publish-template-form"
          type="submit"
        >
          {inFlight ? <>{t('publishing')}…</> : override ? t('overwrite') : t('publish')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

ManageTemplateModalContent.propTypes = {
  handleHide: PropTypes.func.isRequired,
  inFlight: PropTypes.bool,
  handleAfterPublished: PropTypes.func.isRequired,
  setInFlight: PropTypes.func.isRequired,
  projectId: PropTypes.string,
  projectName: PropTypes.string,
}
