import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertTriangle, HelpCircle, Info } from 'lucide-react'

// Promise-based replacement for window.alert / window.confirm / window.prompt.
//
// Native browser dialogs freeze the whole tab, can't be styled, and look
// jarring next to the rest of the app. This renders a real modal instead,
// while keeping a call-site API close enough to the native one that every
// existing `alert(...)`, `if (!window.confirm(...)) return`, and
// `window.prompt(...)` call could be swapped in with a small, mechanical
// edit (add `await`, use the hook).
//
// Usage:
//   const dialog = useDialog()
//
//   await dialog.alert('Upload complete!', { detail: '2033 rows processed' })
//
//   if (!(await dialog.confirm('Delete this upload?'))) return
//
//   const note = await dialog.prompt('Log a follow-up note', { defaultValue: '' })
//   if (note === null) return   // user cancelled
//
// Only one dialog is shown at a time (matches native dialog behaviour —
// nothing in this app ever needs two stacked at once).
const DialogContext = createContext(null)

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const [inputValue, setInputValue] = useState('')
  const resolveRef = useRef(null)
  const inputRef = useRef(null)

  const openDialog = useCallback((type, message, opts = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setInputValue(opts.defaultValue ?? '')
      setDialog({ type, message, ...opts })
    })
  }, [])

  const alertFn = useCallback(
    (message, opts) => openDialog('alert', message, opts),
    [openDialog],
  )
  const confirmFn = useCallback(
    (message, opts) => openDialog('confirm', message, opts),
    [openDialog],
  )
  const promptFn = useCallback(
    (message, opts) => openDialog('prompt', message, opts),
    [openDialog],
  )

  function close(result) {
    const resolve = resolveRef.current
    resolveRef.current = null
    setDialog(null)
    if (resolve) resolve(result)
  }

  // Focus the input (prompt) or the primary button as soon as the dialog
  // mounts, and let Escape cancel / Enter confirm like native dialogs did.
  useEffect(() => {
    if (!dialog) return
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(dialog.type === 'alert' ? undefined : dialog.type === 'confirm' ? false : null)
      }
      if (e.key === 'Enter' && dialog.type !== 'prompt') {
        // Prompt's own <input> handles Enter itself (see below) so it
        // doesn't fire twice; alert/confirm can confirm on Enter globally.
        e.preventDefault()
        close(dialog.type === 'alert' ? undefined : true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog])

  const api = { alert: alertFn, confirm: confirmFn, prompt: promptFn }

  const tone = dialog?.tone || (dialog?.type === 'confirm' ? 'danger' : 'default')
  const ToneIcon = tone === 'danger' ? AlertTriangle : dialog?.type === 'prompt' ? HelpCircle : Info

  return (
    <DialogContext.Provider value={api}>
      {children}

      {dialog && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-[1px] px-4"
          onMouseDown={(e) => {
            // Click on the backdrop itself (not the card) cancels.
            if (e.target === e.currentTarget) {
              close(dialog.type === 'alert' ? undefined : dialog.type === 'confirm' ? false : null)
            }
          }}
        >
          <div
            role={dialog.type === 'alert' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            className="w-full max-w-sm rounded-xl bg-white shadow-2xl ring-1 ring-black/5 animate-[dialogin_140ms_ease-out]"
          >
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div
                  className={
                    'shrink-0 grid place-items-center w-9 h-9 rounded-full ' +
                    (tone === 'danger'
                      ? 'bg-rose-100 text-rose-600'
                      : dialog.type === 'prompt'
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-sky-100 text-sky-600')
                  }
                >
                  <ToneIcon size={18} />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  {dialog.title && (
                    <h3 className="text-sm font-semibold text-gray-900">{dialog.title}</h3>
                  )}
                  <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                    {dialog.message}
                  </p>
                  {dialog.detail && (
                    <p className="mt-1.5 text-xs text-gray-500 whitespace-pre-wrap break-words">
                      {dialog.detail}
                    </p>
                  )}
                </div>
              </div>

              {dialog.type === 'prompt' && (
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); close(inputValue) }
                  }}
                  placeholder={dialog.placeholder || ''}
                  className="mt-3 w-full pl-3 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500"
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
              {dialog.type !== 'alert' && (
                <button
                  type="button"
                  onClick={() => close(dialog.type === 'confirm' ? false : null)}
                  className="px-3.5 py-1.5 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100"
                >
                  {dialog.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                ref={dialog.type === 'alert' ? inputRef : undefined}
                type="button"
                onClick={() => close(dialog.type === 'alert' ? undefined : dialog.type === 'confirm' ? true : inputValue)}
                className={
                  'px-3.5 py-1.5 text-sm font-medium text-white rounded-lg shadow-sm ' +
                  (tone === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-blue-600 hover:bg-blue-700')
                }
              >
                {dialog.confirmLabel || (dialog.type === 'alert' ? 'OK' : dialog.type === 'confirm' ? 'Confirm' : 'Submit')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes dialogin {
          from { opacity: 0; transform: scale(0.97) translateY(4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);   }
        }
      `}</style>
    </DialogContext.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(DialogContext)
  if (!ctx) {
    // eslint-disable-next-line no-console
    console.warn('useDialog called outside <DialogProvider>')
    return { alert: async () => {}, confirm: async () => false, prompt: async () => null }
  }
  return ctx
}
