import { useRef, useEffect } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'
import LLMChatPane from './llm-chat-pane'
import { useLLMFeatures } from '../hooks/use-llm-features'
import { useLLMModelSelection } from '../hooks/use-llm-model-selection'
import { watchEditorTheme } from '../utils/llm-editor-theme'
import '../../stylesheets/llm-ui.scss'

function LLMRailPane() {
  const rootRef = useRef<HTMLDivElement>(null)
  const features = useLLMFeatures()
  const models = useLLMModelSelection()
  useEffect(() => {
    // レールはエディターとは別のDOMにあるため、配色だけを監視して追従させます。
    const watcher = watchEditorTheme([rootRef.current])
    return () => watcher.stop()
  }, [])
  return (
    <div className="llm-rail-panel llm-wf-editor-scoped" ref={rootRef}>
      <RailPanelHeader title="AI Assistant" />
      {features.loaded && !features.chatEnabled ? (
        <p>管理者によってチャットが無効になっています。</p>
      ) : (
        <>
          <label style={{ padding: 8 }}>
            モデル
            <select
              aria-label="チャットのモデル"
              value={models.selected}
              disabled={!models.loaded || models.saving}
              onChange={event => models.apply(event.target.value)}
            >
              <option value="">既定のモデル</option>
              {models.options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.rowName ? `${option.rowName} · ` : ''}
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {models.saveError && <p role="alert">{models.saveError}</p>}
          <LLMChatPane />
        </>
      )}
    </div>
  )
}

const entry: RailElement = {
  key: 'llm-chat',
  icon: 'smart_toy',
  title: 'AI Assistant',
  component: <LLMRailPane />,
  hide: () => !getMeta('ol-ExposedSettings').llmEnabled,
}
export default entry
