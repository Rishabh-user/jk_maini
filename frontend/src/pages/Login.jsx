import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Lock, LogIn } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password, role)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Check credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fdf6f0] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-lg p-8 space-y-5"
        >
          {/* Brand */}
          <div className="text-center">
            <div className="w-14 h-14 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">
              JK
            </div>
            <h1 className="text-2xl font-bold text-gray-900">JK Maini</h1>
            <p className="text-sm text-gray-500 mt-1">AI Email to ZSO Automation</p>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@maini.com"
                required
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Role selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Login as</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="admin">Admin</option>
              <option value="kas">KAS</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <LogIn size={18} />
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
