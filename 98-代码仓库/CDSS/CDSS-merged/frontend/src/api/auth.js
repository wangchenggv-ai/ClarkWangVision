import api from './client'

export function login(username, password) {
  const formData = new FormData()
  formData.append('username', username)
  formData.append('password', password)
  return api.post('/auth/login', formData)
}

export function getMe() {
  return api.get('/auth/me')
}

export function changePassword(data) {
  return api.post('/auth/change-password', data)
}
