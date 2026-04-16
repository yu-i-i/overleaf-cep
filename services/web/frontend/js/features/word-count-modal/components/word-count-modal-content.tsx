import { useTranslation } from 'react-i18next'
import {
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { WordCountServer } from './word-count-server'
import { WordCountClient } from './word-count-client'
import { isSplitTestEnabled } from '@/utils/splitTestUtils'
import SplitTestBadge from '@/shared/components/split-test-badge'
import { useEffect } from 'react'
import { useEditorAnalytics } from '@/shared/hooks/use-editor-analytics'
import { useDetachCompileContext as useCompileContext } from '@/shared/context/detach-compile-context'

// NOTE: this component is only mounted when the modal is open
export default function WordCountModalContent({
  handleHide,
}: {
  handleHide: () => void
}) {
  const { t } = useTranslation()

  const { sendEvent } = useEditorAnalytics()
  const { onlineCompile } = useCompileContext()

  // When online compile is active, always use client-side word count
  // since the server-side word count relies on the CLSI server
  const useClientWordCount =
    onlineCompile || isSplitTestEnabled('word-count-client')

  useEffect(() => {
    // record when the word count modal is opened
    sendEvent('word-count-opened', {
      mode: useClientWordCount ? 'client' : 'server',
    })
  }, [sendEvent, useClientWordCount])

  return (
    <>
      <OLModalHeader>
        <OLModalTitle>
          {t('word_count_lower')}{' '}
          <SplitTestBadge
            splitTestName="word-count-client"
            displayOnVariants={['enabled']}
          />
        </OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {useClientWordCount ? <WordCountClient /> : <WordCountServer />}
      </OLModalBody>

      <OLModalFooter>
        <OLButton variant="secondary" onClick={handleHide}>
          {t('close')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}
