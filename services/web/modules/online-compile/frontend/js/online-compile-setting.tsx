import ToggleSetting from '@/features/settings/components/toggle-setting'
import { useDetachCompileContext as useCompileContext } from '@/shared/context/detach-compile-context'
import { useSetCompilationSettingWithEvent } from '@/features/editor-left-menu/hooks/use-set-compilation-setting'

export default function OnlineCompileSetting() {
  const { onlineCompile, setOnlineCompile } = useCompileContext()
  const changeOnlineCompile = useSetCompilationSettingWithEvent(
    'compile-target',
    setOnlineCompile
  )

  return (
    <ToggleSetting
      id="onlineCompile"
      label="Browser compile"
      description="Compile using WebAssembly in your browser instead of the server"
      checked={onlineCompile}
      onChange={changeOnlineCompile}
    />
  )
}
