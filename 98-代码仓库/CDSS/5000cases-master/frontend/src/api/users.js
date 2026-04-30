import api from './client'

export const listUsers = () => api.get('/users')

export const createUser = (data) => api.post('/users', data)

export const updateUser = (id, data) => api.put(`/users/${id}`, data)
