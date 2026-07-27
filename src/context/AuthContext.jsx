/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const AuthContext = createContext(null)
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    async function hydrate(nextSession) {
      if (!active) return
      setSession(nextSession)
      if (!nextSession) { setProfile(null); setLoading(false); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', nextSession.user.id).maybeSingle()
      if (active) { setProfile(data || { id: nextSession.user.id, email: nextSession.user.email }); setLoading(false) }
    }
    if (!isSupabaseConfigured) { setLoading(false); return undefined }
    supabase.auth.getSession().then(({ data }) => hydrate(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => hydrate(next))
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])
  const value = useMemo(() => ({ session, user: session?.user || null, profile, loading, signOut: () => supabase?.auth.signOut() }), [session, profile, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export const useAuth = () => useContext(AuthContext)

