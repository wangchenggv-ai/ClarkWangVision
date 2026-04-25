import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Spin } from 'antd'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Workbench from './pages/Workbench'
import PatientList from './pages/Patients/PatientList'
import PatientDetail from './pages/Patients/PatientDetail'
import PatientCreate from './pages/Patients/PatientCreate'
import OverduePage from './pages/Patients/OverduePage'
import BaselineForm from './pages/Exams/BaselineForm'
import VisitForm from './pages/Visits/VisitForm'
import ExportPage from './pages/Export'
import CenterManage from './pages/Admin/CenterManage'
import UserManage from './pages/Admin/UserManage'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Spin fullscreen />
  return user ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/workbench" replace />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="workbench" element={<Workbench />} />
        <Route path="patients" element={<PatientList />} />
        <Route path="patients/new" element={<PatientCreate />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="patients/:patientId/baseline" element={<BaselineForm />} />
        <Route path="patients/:patientId/visits/new" element={<VisitForm />} />
        <Route path="overdue" element={<OverduePage />} />
        <Route path="export" element={<ExportPage />} />
        <Route path="admin/centers" element={<CenterManage />} />
        <Route path="admin/users" element={<UserManage />} />
      </Route>
      <Route path="*" element={<Navigate to="/workbench" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
