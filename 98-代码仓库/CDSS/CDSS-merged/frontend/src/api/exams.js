import api from './client'

export function getBaseline(patientId) {
  return api.get(`/exams/baseline/${patientId}`)
}

export function createBaseline(data) {
  return api.post('/exams/baseline', data)
}

export function updateBaseline(patientId, data) {
  return api.put(`/exams/baseline/${patientId}`, data)
}
