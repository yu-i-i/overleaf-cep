import type { RailElement } from '@/features/ide-react/util/rail-types'
import TranslationPanel from './TranslationPanel'

// 既存フォントに含まれるアイコンを使い、フォント再生成を必要としない。
const translationRailEntry: RailElement = {
  key: 'translation',
  icon: 'globe',
  title: '英語翻訳',
  component: <TranslationPanel />,
}
export default translationRailEntry
