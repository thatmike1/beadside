// the undo toast, bottom centre

import type { ToastState } from '../use-toast'
import { useStrings } from '../i18n'

interface ToastProps {
  toast: ToastState | null
  onUndo: () => void
  onDismiss: () => void
}

/** single toast; the undo button appears only when the write has an inverse */
export function Toast({ toast, onUndo, onDismiss }: ToastProps) {
  const s = useStrings()
  if (!toast) return null
  return (
    <div className="toast" role="status">
      <span className={toast.tone === 'error' ? 'err' : ''}>{toast.message}</span>
      {toast.undo ? <button onClick={onUndo}>{s.toast.undo}</button> : <button onClick={onDismiss}>{s.toast.ok}</button>}
    </div>
  )
}
