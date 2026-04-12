import { createContext, useContext, useState, useEffect } from 'react'
import { loginUser as loginApi, fetchMe } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')
    if (token && savedUser) {
      setUser(JSON.parse(savedUser))
    }
    setLoading(false)
  }, [])

  const login = async (email, password, role) => {
    const res = await loginApi(email, password)
    const token = res.data.access_token
    localStorage.setItem('token', token)

    // Fetch user profile
    try {
      const me = await fetchMe()
      const userData = me.data
      localStorage.setItem('user', JSON.stringify(userData))
      setUser(userData)
    } catch {
      // Fallback: store basic info
      const userData = { email, role, full_name: email.split('@')[0] }
      localStorage.setItem('user', JSON.stringify(userData))
      setUser(userData)
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
