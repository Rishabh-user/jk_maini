import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react'

// Lightweight toast system — no external deps.
//
// Anywhere in the app:
//   const toast = useToast()
//   toast.success('Report generated')
//   toast.error('Upload failed', { message: formatError(err) })
//   toast.info('Sync started')
//   toast.warn('Filter applied — 5 rows hidden')
//
// Toasts auto-dismiss after 5s (except errors, which stay 8s so the user
// can read them). Clicking the X closes immediately.

const ToastContext = createContext(null)

let _seq = 0
const nextId = () => ++_seq

const VARIANTS = {
  success: {
    icon: CheckCircle2,
    ring: 'ring-emerald-200',
    bg: 'bg-emerald-50',
    text: 'text-emerald-900',
    iconClass: 'text-emerald-600',
    duration: 4500,
  },
  error: {
    icon: XCircle,
    ring: 'ring-rose-200',
    bg: 'bg-rose-50',
    text: 'text-rose-900',
    iconClass: 'text-rose-600',
    duration: 8000,
  },
  warn: {
    icon: AlertTriangle,
    ring: 'ring-amber-200',
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    iconClass: 'text-amber-600',
    duration: 6000,
  },
  info: {
    icon: Info,
    ring: 'ring-sky-200',
    bg: 'bg-sky-50',
    text: 'text-sky-900',
    iconClass: 'text-sky-600',
    duration: 4500,
  },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (variant, title, opts = {}) => {
      const id = nextId()
      const duration = opts.duration ?? VARIANTS[variant].duration
      setToasts((prev) => [
        ...prev,
        { id, variant, title, message: opts.message || null },
      ])
      if (duration > 0) {
        const t = setTimeout(() => dismiss(id), duration)
        timers.current.set(id, t)
      }
      return id
    },
    [dismiss],
  )

  // Clear all pending timers on unmount to avoid "set state on unmounted" warnings.
  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current.clear()
    }
  }, [])

  const api = {
    success: (title, opts) => push('success', title, opts),
    error:   (title, opts) => push('error',   title, opts),
    warn:    (title, opts) => push('warn',    title, opts),
    info:    (title, opts) => push('info',    title, opts),
    dismiss,
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Toast rack — fixed top-right, doesn't obscure sidebar */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => {
          const V = VARIANTS[t.variant]
          const Icon = V.icon
          return (
            <div
              key={t.id}
              role={t.variant === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto min-w-[300px] max-w-md rounded-lg ring-1 ${V.ring} ${V.bg} ${V.text} shadow-lg px-3 py-2.5 flex items-start gap-2.5 animate-[toastin_180ms_ease-out]`}
            >
              <Icon size={18} className={`shrink-0 mt-0.5 ${V.iconClass}`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t.title}</div>
                {t.message && (
                  <div className="mt-0.5 text-xs opacity-80 break-words">
                    {t.message}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 -m-1 p-1 rounded opacity-60 hover:opacity-100 hover:bg-black/5"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
      {/* Minimal entry-in animation, injected once. */}
      <style>{`
        @keyframes toastin {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Non-fatal safety net — if a component is rendered outside the
    // provider (e.g. Storybook), we log and no-op so the page still works.
    // eslint-disable-next-line no-console
    console.warn('useToast called outside <ToastProvider>')
    return {
      success: () => {}, error: () => {}, warn: () => {}, info: () => {}, dismiss: () => {},
    }
  }
  return ctx
}
