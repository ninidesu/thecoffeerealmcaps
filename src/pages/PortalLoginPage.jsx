import { ArrowRight, ChevronDown, Coffee, Eye, EyeOff, Lock, ShieldCheck, UserRound, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { normalizeRole, roleRoutes, signInPortal } from '../lib/auth'
import { queueAuthWelcome } from '../lib/authFeedback'
import { fetchStaffPreferences } from '../services/staffSettingsService'

export default function PortalLoginPage() {
  const [role, setRole] = useState('admin')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const location = useLocation()

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    setLoading(true)
    const form = new FormData(event.currentTarget)
    const identifier = String(form.get('identifier') || '').trim()
    const password = String(form.get('password') || '')

    try {
      const { profile } = await signInPortal({ identifier, password, role })
      const normalizedRole = normalizeRole(profile.role || role)
      let target = location.state?.from || roleRoutes[normalizedRole] || roleRoutes[role] || '/portal'
      if (!location.state?.from && ['staff', 'operational_staff'].includes(normalizedRole)) {
        try {
          const preferences = await fetchStaffPreferences(profile.id)
          const workspaceRoutes = { orders: '/staff', inventory: '/staff/inventory', transactions: '/staff/transactions', menu: '/staff/menu' }
          target = workspaceRoutes[preferences.landing_view] || target
        } catch { /* The standard staff landing page remains available before the preference migration is deployed. */ }
      }
      queueAuthWelcome(profile)
      navigate(target, { replace: true })
    } catch (error) {
      setMessage(error.message || 'Unable to sign in. Please check the account and role.')
    } finally {
      setLoading(false)
    }
  }

  return <div className="legacy-portal">
    <header className="legacy-portal-header"><div className="legacy-portal-brand"><Coffee size={22} fill="currentColor"/><span>thecoffeerealm</span></div><Lock size={21}/></header>
    <main className="legacy-login-card"><h1>Internal Portal Login</h1><p>Private access for admin, staff, and cashier only.</p><form onSubmit={submit} autoComplete="off">
      <label htmlFor="portal-role">Role</label><div className="legacy-input"><UsersRound size={19}/><select id="portal-role" value={role} onChange={event => setRole(event.target.value)} required><option value="admin">Admin</option><option value="staff">Operations Staff</option><option value="cashier">Cashier</option></select><ChevronDown size={18}/></div>
      <label htmlFor="portal-identifier">{role === 'staff' ? 'Email or username' : 'Email'}</label><div className="legacy-input"><UserRound size={19}/><input id="portal-identifier" name="identifier" type={role === 'staff' ? 'text' : 'email'} placeholder={role === 'staff' ? 'name@example.com or username' : 'name@example.com'} required autoComplete="username" autoCapitalize="none" spellCheck="false"/></div>
      <label htmlFor="portal-password">Password</label><div className="legacy-input"><Lock size={19}/><input id="portal-password" name="password" type={showPassword ? 'text' : 'password'} placeholder="********" required autoComplete="current-password"/><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div>
      {message ? <p className="portal-message portal-message-error">{message}</p> : null}
      <button className="legacy-sign-in" type="submit" disabled={loading}><span>{loading ? 'Signing in...' : 'Sign In'}</span><ArrowRight size={19}/></button>
    </form></main>
    <footer className="legacy-portal-footer"><div><ShieldCheck size={18} fill="currentColor"/><span>Secure Internal Network</span></div><div><strong>thecoffeerealm</strong><span>(c) 2026 thecoffeerealm internal systems</span></div></footer>
  </div>
}


