// overleaf-lab: shared "Select LLM Model" dialog (owner request 2026-08-25).
// The single place where the deployment-wide model choice is made; the value
// drives Chat, Review, all AI Generate items and the ask-AI context menu.
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OLModal } from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import { useLLMModelSelection } from '../hooks/use-llm-model-selection'
import '../../stylesheets/llm-ui.scss'

interface LLMModelSelectModalProps {
    show: boolean
    onHide: () => void
}

const LLMModelSelectModal = React.memo(function LLMModelSelectModal({
    show,
    onHide,
}: LLMModelSelectModalProps) {
    const { t } = useTranslation()
    // overleaf-lab (owner request 2026-08-26): the "Deployment default" pseudo
    // option is gone — only concrete models (site + BYO rows) are selectable.
    const { options, loaded, selected, apply } = useLLMModelSelection()
    const [local, setLocal] = useState('')

    // Re-seed each time the modal opens (and live if another surface changed
    // the selection while it is open). When nothing is selected yet, preselect
    // the first concrete model (site default) so "Use this model" always picks
    // a real model.
    useEffect(() => {
        if (show) setLocal(selected || (loaded ? options[0]?.value || '' : ''))
    }, [show, selected, loaded, options])

    const save = () => {
        apply(local)
        onHide()
    }

    return (
        <OLModal
            show={show}
            onHide={onHide}
            aria-label={t('llm_select_model', 'Select LLM Model')}
        >
            <div className="modal-header">
                <h5 className="modal-title">
                    <MaterialIcon type="model_training" className="me-2" />
                    {t('llm_select_model', 'Select LLM Model')}
                </h5>
                <button
                    type="button"
                    className="btn-close"
                    onClick={onHide}
                    aria-label={t('close', 'Close')}
                />
            </div>
            <div className="modal-body">
                <p className="llm-model-hint">
                    {t(
                        'llm_select_model_hint',
                        'This model is used everywhere — AI Assistant chat, Review, the AI Generate menu items and ask-AI on selected text. The choice is saved to your profile and follows you across projects.',
                    )}
                </p>
                <div className="llm-model-option-list" role="radiogroup">
                    {options.map(o => (
                        <label
                            key={o.value || 'default'}
                            className={`llm-model-option${local === o.value ? ' selected' : ''}`}
                        >
                            <input
                                type="radio"
                                name="llm-select-model"
                                value={o.value}
                                checked={local === o.value}
                                onChange={() => setLocal(o.value)}
                            />
                            <span className="llm-model-option-body">
                                <span className="llm-model-option-label">
                                    {o.label}
                                </span>
                                {o.rowName && (
                                    <span className="llm-model-option-row">
                                        {o.rowName}
                                    </span>
                                )}
                            </span>
                        </label>
                    ))}
                    {!loaded && (
                        <div className="llm-model-option loading">
                            {t('llm_loading', 'Loading…')}
                        </div>
                    )}
                </div>
            </div>
            <div className="modal-footer">
                <OLButton variant="tertiary" onClick={onHide}>
                    {t('cancel', 'Cancel')}
                </OLButton>
                <OLButton variant="primary" onClick={save} disabled={!loaded}>
                    {t('llm_apply_model', 'Use this model')}
                </OLButton>
            </div>
        </OLModal>
    )
})

export default LLMModelSelectModal
