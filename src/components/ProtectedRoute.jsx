import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { getCurrentPortalSession, normalizeRole, roleRoutes } from '../lib/auth'

export default function ProtectedRoute({ allowedRoles, children }) {
  const location = useLocation()
  const [state, setState] = useState({ loading: true, profile: null })

  useEffect(() => {
    let active = true
    getCurrentPortalSession().then(({ profile }) => {
      if (!active) return
      setState({ loading: false, profile })
    })
    return () => { active = false }
  }, [])

  if (state.loading) return <div className="auth-loading">Checking portal access...</div>
  if (!state.profile) return <Navigate to="/portal" replace state={{ from: location.pathname }} />

  const actualRole = normalizeRole(state.profile.role)
  const allowed = allowedRoles.map(normalizeRole)
  if (!allowed.includes(actualRole)) return <Navigate to={roleRoutes[actualRole] || '/portal'} replace />

  return children
}
