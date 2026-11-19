import type { RailElement } from '@/features/ide-react/util/rail-types'
import SplitLauncherPanel from './SplitLauncherPanel'

const splitRailEntry: RailElement = {
  key: 'split-view',
  icon: 'call_split',
  title: '横並び表示',
  component: <SplitLauncherPanel />,
}
export default splitRailEntry
