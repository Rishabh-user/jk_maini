import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import EmailInbox from './pages/EmailInbox'
import RawDataViewer from './pages/RawDataViewer'
import MasterData from './pages/MasterData'
import ZSOReports from './pages/ZSOReports'
import UserManagement from './pages/UserManagement'
import DemandManagement from './pages/DemandManagement'
import InventoryLiquidation from './pages/InventoryLiquidation'
import CoverageReport from './pages/CoverageReport'
import PerformanceDashboard from './pages/PerformanceDashboard'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen bg-[#fdf6f0] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <Login />}
      />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inbox" element={<EmailInbox />} />
        <Route path="/raw-data" element={<RawDataViewer />} />
        <Route path="/master-data" element={<MasterData />} />
        <Route path="/zso-reports" element={<ZSOReports />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/demand-management" element={<DemandManagement />} />
        <Route path="/inventory-liquidation" element={<InventoryLiquidation />} />
        <Route path="/coverage-report" element={<CoverageReport />} />
        <Route path="/performance" element={<PerformanceDashboard />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
