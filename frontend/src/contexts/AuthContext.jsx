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

  const login = async (email, password) => {
    // NOTE: the login form has a "role" dropdown, but role is authoritative
    // ONLY on the server — the client's picked value MUST be ignored.
    // Previously, if /users/me hit any error (transient 500, network blip)
    // we fell back to writing { email, role: <picked>, ... } to localStorage,
    // which any component reading user.role then treated as Admin. That's
    // a privilege trap — any user could pick "Admin" and hit refresh
    // during a backend hiccup to gain admin UI access.
    //
    // Correct behaviour: on /users/me failure we treat the login as
    // incomplete — clear the token, throw, and let the login page show
    // an error. No cached role means no privilege can be spoofed.
    const res = await loginApi(email, password)
    const token = res.data.access_token
    localStorage.setItem('token', token)
    try {
      const me = await fetchMe()
      const userData = me.data
      localStorage.setItem('user', JSON.stringify(userData))
      setUser(userData)
    } catch (err) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      setUser(null)
      throw new Error(
        'Signed in, but could not load your profile — please try again. ' +
        'If this keeps happening, ask an admin to check the backend logs.'
      )
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
