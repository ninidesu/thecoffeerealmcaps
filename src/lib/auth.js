import { Navigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export const roleRoutes = {
  admin: '/admin',
  cashier: '/cashier',
  staff: '/staff',
  operational_staff: '/staff',
}

export function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
  if (value === 'operations_staff') return 'operational_staff'
  if (value === 'operation_staff') return 'operational_staff'
  return value
}

export async function getCurrentPortalSession() {
  if (!isSupabaseConfigured) return { session: null, profile: null, error: new Error('Supabase is not configured.') }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) return { session: null, profile: null, error: sessionError || null }

  const userId = sessionData.session.user.id
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, full_name, username, email')
    .eq('id', userId)
    .maybeSingle()

  return { session: sessionData.session, profile, error: profileError || null }
}

export async function signInPortal({ email, password, role }) {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured yet.')
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  const userId = data.user?.id
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, full_name, username, email')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) throw profileError
  if (!profile) throw new Error('Login succeeded, but no staff profile was found for this account.')

  const requestedRole = normalizeRole(role)
  const actualRole = normalizeRole(profile.role)
  const roleMatches = requestedRole === actualRole || (requestedRole === 'staff' && actualRole === 'operational_staff')
  if (!roleMatches) {
    await supabase.auth.signOut()
    throw new Error(`This account is registered as ${profile.role || 'another role'}, not ${role}.`)
  }

  return { session: data.session, profile }
}

export async function signOutPortal() {
  if (isSupabaseConfigured) await supabase.auth.signOut()
}



