import api from './client'

export const listCenters = () => api.get('/centers')

export const createCenter = (data) => api.post('/centers', data)

export const updateCenter = (id, data) => api.put(`/centers/${id}`, data)

export const getCenterStats = (id) => api.get(`/centers/${id}/stats`)
