import api from './client'

export function listPatients(params) {
  return api.get('/patients/', { params })
}

export function getPatient(id) {
  return api.get(`/patients/${id}`)
}

export function createPatient(data) {
  return api.post('/patients/', data)
}

export function updatePatient(id, data) {
  return api.put(`/patients/${id}`, data)
}

export function deletePatient(id) {
  return api.delete(`/patients/${id}`)
}

export function getOverduePatients() {
  return api.get('/patients/overdue')
}
