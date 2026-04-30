import api from './client'

export const listVisits = (patientId) => api.get(`/visits/${patientId}`)

export const createVisit = (data) => api.post('/visits', data)

export const updateVisit = (id, data) => api.put(`/visits/${id}`, data)

export const deleteVisit = (id) => api.delete(`/visits/${id}`)
