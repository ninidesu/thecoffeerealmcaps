import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isCustomerRole, normalizeRole, roleRoutes } from '../lib/auth'

export default function CustomerProtectedRoute({ children }) {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <main className="customer-state">Checking your account...</main>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (isCustomerRole(profile?.role)) return children

  const portalRoute = roleRoutes[normalizeRole(profile?.role)]
  if (portalRoute) return <Navigate to={portalRoute} replace />

  return (
    <Navigate
      to="/login"
      replace
      state={{ authMessage: 'This account is not registered as a customer. Please use the correct sign-in portal.' }}
    />
  )
}
