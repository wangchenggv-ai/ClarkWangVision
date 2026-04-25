import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { login as apiLogin, getMe } from '../api/auth'

const DEMO_USER = {
  id: 1,
  username: 'admin',
  full_name: '系统管理员',
  email: 'admin@gaoshixing.com',
  role: 'admin',
  center_id: 1,
  is_active: true,
}

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    const demo = localStorage.getItem('demo_mode')
    if (!token && !demo) {
      setLoading(false)
      return
    }
    if (demo) {
      setUser(DEMO_USER)
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
    if (username === 'admin' && password === 'admin123') {
      localStorage.setItem('demo_mode', '1')
      setUser(DEMO_USER)
      return DEMO_USER
    }
    const res = await apiLogin(username, password)
    const { access_token } = res.data
    localStorage.setItem('access_token', access_token)
    localStorage.removeItem('demo_mode')
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
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
