import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock, LogIn, Mail, Sparkles } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/ToastProvider'
import { formatError } from '../utils/formatError'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      toast.success('Signed in', { message: `Welcome back, ${email}` })
      navigate('/dashboard')
    } catch (err) {
      setError(formatError(err, 'Login failed. Check credentials.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/40 to-amber-50/30 flex items-center justify-center p-4">
      {/* Soft blurred accent shapes — pure decoration, no runtime cost. */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 w-[28rem] h-[28rem] bg-amber-200/30 rounded-full blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Brand block sits outside the card so it feels like the app,
            not a form-inside-a-form. */}
        <div className="text-center mb-6">
          <div className="mx-auto mb-3 w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center shadow-md ring-1 ring-blue-500/40">
            <span className="text-white font-bold text-xl">JK</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
            JK Maini
          </h1>
          <p className="mt-1 text-sm text-gray-500 flex items-center justify-center gap-1.5">
            <Sparkles size={12} className="text-amber-500" />
            AI-powered Email to ZSO Automation
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white/95 backdrop-blur rounded-2xl shadow-xl ring-1 ring-gray-200/60 p-7 space-y-4"
        >
          <div>
            <h2 className="text-base font-semibold text-gray-900">Sign in</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Enter your credentials to continue.
            </p>
          </div>

          {error && (
            <div role="alert" className="bg-rose-50 text-rose-700 text-sm px-3 py-2 rounded-lg border border-rose-200">
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="login-email">
              Email
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500 transition"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="login-password">
              Password
            </label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="login-password"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/70 focus:border-blue-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
                tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 disabled:from-blue-400 disabled:to-blue-400 text-white text-sm font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 shadow-sm transition disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                <LogIn size={16} />
                Sign In
              </>
            )}
          </button>

          <p className="text-[11px] text-center text-gray-400 pt-1">
            Contact your administrator if you can’t sign in.
          </p>
        </form>
      </div>
    </div>
  )
}
