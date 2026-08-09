import { supabase } from '../lib/supabase'

export const PORTAL_ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'operational_staff', label: 'Operations Staff' },
  { value: 'cashier', label: 'Cashier' },
]

const roleLabel = (role) => PORTAL_ROLES.find((item) => item.value === role)?.label || String(role || 'Unknown').replaceAll('_', ' ')

const usersAccessSetupMessage = 'Users & Access needs its database migration before this action is available.'

function isMissingUsersAccessSchema(error) {
  const message = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST204' ||
    message.includes('portal_audit_events') || message.includes('admin_update_portal_user') || message.includes('last_active_at')
}

function setupAwareError(error) {
  if (!isMissingUsersAccessSchema(error)) return error
  const nextError = new Error(usersAccessSetupMessage)
  nextError.cause = error
  return nextError
}

export async function fetchManagedUsers() {
  let { data, error } = await supabase
    .from('profiles')
    .select('id,email,full_name,username,role,created_at,updated_at,last_active_at,removed_at')
    .in('role', ['admin', 'staff', 'operational_staff', 'cashier'])
    .is('removed_at', null)
    .order('full_name', { ascending: true })

  if (isMissingUsersAccessSchema(error)) {
    const legacyResult = await supabase
      .from('profiles')
      .select('id,email,full_name,username,role')
      .in('role', ['admin', 'staff', 'operational_staff', 'cashier'])
      .order('full_name', { ascending: true })
    data = legacyResult.data
    error = legacyResult.error
  }
  if (error) throw error
  return (data || []).map((user) => ({
    ...user,
    roleLabel: roleLabel(user.role),
  }))
}

export async function invitePortalUser(values) {
  const { data, error } = await supabase.functions.invoke('admin-manage-user', {
    body: { action: 'invite', ...values },
  })
  if (error) throw setupAwareError(error)
  if (!data?.success) throw new Error(data?.error || 'Could not invite the user.')
  return data.user
}

export async function sendPortalPasswordReset(userId) {
  const { data, error } = await supabase.functions.invoke('admin-manage-user', {
    body: { action: 'reset_password', userId },
  })
  if (error) throw setupAwareError(error)
  if (!data?.success) throw new Error(data?.error || 'Could not send the password reset.')
}

export async function removePortalUser(userId) {
  const { data, error } = await supabase.functions.invoke('admin-manage-user', {
    body: { action: 'remove', userId },
  })
  if (error) throw setupAwareError(error)
  if (!data?.success) throw new Error(data?.error || 'Could not remove the user.')
}

export async function updatePortalUser(userId, values) {
  const { data, error } = await supabase.rpc('admin_update_portal_user', {
    p_user_id: userId,
    p_role: values.role,
  })
  if (error) throw setupAwareError(error)
  return data
}

function applyAuditFilters(query, filters) {
  if (filters.surface && filters.surface !== 'all') query = query.eq('surface', filters.surface)
  if (filters.module && filters.module !== 'all') query = query.eq('module', filters.module)
  if (filters.result && filters.result !== 'all') query = query.eq('result', filters.result)
  if (filters.severity && filters.severity !== 'all') query = query.eq('severity', filters.severity)
  if (filters.actorId) query = query.eq('actor_id', filters.actorId)
  if (filters.dateFrom) query = query.gte('occurred_at', `${filters.dateFrom}T00:00:00+08:00`)
  if (filters.dateTo) query = query.lte('occurred_at', `${filters.dateTo}T23:59:59.999+08:00`)
  if (filters.search?.trim()) {
    const term = filters.search.trim().replace(/[,%_]/g, ' ').slice(0, 80)
    query = query.or(`summary.ilike.%${term}%,entity_label.ilike.%${term}%,actor_name_snapshot.ilike.%${term}%,action.ilike.%${term}%`)
  }
  return query
}

const auditSelect = 'id,occurred_at,actor_id,actor_name_snapshot,actor_role_snapshot,surface,module,action,entity_type,entity_id,entity_label,summary,result,severity,before_data,after_data,metadata,correlation_id'

export async function fetchPortalAuditEvents(filters, { page = 1, pageSize = 25 } = {}) {
  let query = supabase.from('portal_audit_events').select(auditSelect, { count: 'exact' })
  query = applyAuditFilters(query, filters)
  const start = (page - 1) * pageSize
  const { data, error, count } = await query.order('occurred_at', { ascending: false }).range(start, start + pageSize - 1)
  if (error) throw setupAwareError(error)
  return { events: data || [], count: count || 0 }
}

export async function fetchPortalAuditExport(filters) {
  let query = supabase.from('portal_audit_events').select(auditSelect)
  query = applyAuditFilters(query, filters)
  const { data, error } = await query.order('occurred_at', { ascending: false }).limit(5000)
  if (error) throw setupAwareError(error)
  return data || []
}

export function downloadAuditCsv(events) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const header = ['Date & Time', 'Actor', 'Role', 'Surface', 'Module', 'Action', 'Target', 'Result', 'Severity', 'Summary']
  const rows = events.map((event) => [
    event.occurred_at, event.actor_name_snapshot || 'System', roleLabel(event.actor_role_snapshot), event.surface,
    event.module, event.action, event.entity_label || event.entity_id || '', event.result, event.severity, event.summary,
  ])
  const blob = new Blob([[header, ...rows].map((row) => row.map(escape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `coffeerealm-activity-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}
