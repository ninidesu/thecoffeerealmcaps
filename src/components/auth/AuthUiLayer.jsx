import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import AuthWelcomePopup from './AuthWelcomePopup'
import { clearAuthWelcome, readAuthWelcome } from '../../lib/authFeedback'

export default function AuthUiLayer() {
  const location = useLocation()
  const [welcome, setWelcome] = useState(null)

  useEffect(() => {
    const nextWelcome = readAuthWelcome()
    if (!nextWelcome) return
    setWelcome((current) => current?.token === nextWelcome.token ? current : {
      id: `${location.key || location.pathname}-${nextWelcome.token}`,
      name: nextWelcome.name,
      token: nextWelcome.token,
    })
  }, [location.key, location.pathname])

  return <AuthWelcomePopup welcome={welcome} onClose={() => { clearAuthWelcome(); setWelcome(null) }} />
}
