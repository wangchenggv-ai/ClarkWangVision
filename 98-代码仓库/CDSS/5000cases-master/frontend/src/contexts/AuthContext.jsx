import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { login as apiLogin, getMe } from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // On mount: restore session from stored token
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      setLoading(false)
      return
    }
    getMe()
      .then((res) => setUser(res.data))
      .catch(() => {
        localStorage.removeItem('access_token')
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username, password) => {
    const res = await apiLogin(username, password)
    const { access_token } = res.data
    localStorage.setItem('access_token', access_token)
    const meRes = await getMe()
    setUser(meRes.data)
    return meRes.data
  }, [])

  const logout = useCallback(() => {
    localStorage.clear()
    setUser(null)
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
