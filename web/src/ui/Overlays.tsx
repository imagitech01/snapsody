import { ConfirmDialog } from './components/index.ts'
import { SHEETS } from './screens/index.tsx'
import { useShell } from './ShellContext.ts'

/**
 * The layers over the top screen (`Router.overlays`): the sheets that have a component in
 * `screens/index.tsx`, and the confirm dialog on top. Only the top layer can be a dialog that is
 * answered (`Router.answerDialog` answers the top one), so a dialog below another layer waits unseen.
 */
export function Overlays() {
  const { router } = useShell()
  const layers = router.overlays.value
  return (
    <>
      {layers.map((layer, index) => {
        if (layer.kind === 'dialog') {
          return index === layers.length - 1 ? (
            <ConfirmDialog key={layer.id} {...layer.options} onAnswer={(accepted) => router.answerDialog(accepted)} />
          ) : null
        }
        const Sheet = SHEETS[layer.sheet]
        return Sheet ? <Sheet key={layer.id} /> : null
      })}
    </>
  )
}
