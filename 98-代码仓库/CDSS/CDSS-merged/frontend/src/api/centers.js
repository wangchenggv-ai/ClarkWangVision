import api from './client'

export function listCenters() {
  return api.get('/centers/')
}

export function createCenter(data) {
  return api.post('/centers/', data)
}
