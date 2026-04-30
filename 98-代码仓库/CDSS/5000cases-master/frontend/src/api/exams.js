import api from './client'

export const getBaseline = (patientId) => api.get(`/exams/baseline/${patientId}`)

export const createBaseline = (data) => api.post('/exams/baseline', data)

export const updateBaseline = (patientId, data) => api.put(`/exams/baseline/${patientId}`, data)
