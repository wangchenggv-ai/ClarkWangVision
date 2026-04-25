import api from './client'

export function listVisits(patientId) {
  return api.get(`/visits/${patientId}`)
}

export function createVisit(data) {
  return api.post('/visits/', data)
}

export function updateVisit(visitId, data) {
  return api.put(`/visits/${visitId}`, data)
}

export function deleteVisit(visitId) {
  return api.delete(`/visits/${visitId}`)
}
