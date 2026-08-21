import {
  Activity, AlertTriangle, BadgeCheck, CalendarDays, ChevronLeft, ChevronRight,
  CircleUserRound, Download, FilterX, History, KeyRound, MailPlus, Search,
  ShieldCheck, Trash2, UserPlus, Users, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/AuthContext'
import { describeError } from '../utils/describeError'
import {
  PORTAL_ROLES, downloadAuditCsv, fetchManagedUsers, fetchPortalAuditEvents,
  fetchPortalAuditExport, invitePortalUser, removePortalUser, sendPortalPasswordReset, updatePortalUser,
} from '../services/usersAccessService'

const PAGE_SIZE_OPTIONS = [25, 50, 100]
const MODULE_OPTIONS = ['users_access', 'inventory', 'menu', 'orders', 'transactions', 'refunds', 'content', 'settings']

function displayRole(role) {
  return PORTAL_ROLES.find((item) => item.value === role)?.label || String(role || 'Unknown').replaceAll('_', ' ')
}

function formatDateTime(value) {
  if (!value) return 'Not available'
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(value))
}

function initials(value) {
  return String(value || 'User').replace(/@.*$/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'US'
}

function useEscapeClose(open, onClose) {
  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', close) }
  }, [open, onClose])
}

function WorkspaceTabs() {
  return <nav className="ua-tabs" aria-label="Users and access modules">
    <NavLink to="/admin/users-access/users"><Users size={18} aria-hidden="true"/><span><b>User Management</b><small>Accounts, roles and access</small></span></NavLink>
    <NavLink to="/admin/users-access/activity"><History size={18} aria-hidden="true"/><span><b>Activity Logs</b><small>Portal-wide audit trail</small></span></NavLink>
  </nav>
}

export default function UsersAccessPage() {
  const { pathname } = useLocation()
  const activityTab = pathname.endsWith('/activity')
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [inviteOpen, setInviteOpen] = useState(false)

  return <AppShell
    role="admin"
    title="Users & Access"
    onRefresh={() => setRefreshSignal((value) => value + 1)}
  >
    <WorkspaceTabs />
    {activityTab
      ? <ActivityLogsModule refreshSignal={refreshSignal} />
      : <UserManagementModule refreshSignal={refreshSignal} inviteOpen={inviteOpen} setInviteOpen={setInviteOpen} />}
  </AppShell>
}

function UserManagementModule({ refreshSignal, inviteOpen, setInviteOpen }) {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('all')
  const [sort, setSort] = useState('name')
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setUsers(await fetchManagedUsers()); setError('') }
    catch (cause) { setError(describeError(cause, 'Could not load portal users.')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load, refreshSignal])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    const result = users.filter((item) => {
      const matchesQuery = !term || [item.full_name, item.email, item.username].some((value) => String(value || '').toLowerCase().includes(term))
      return matchesQuery && (role === 'all' || item.role === role)
    })
    return result.sort((a, b) => {
      if (sort === 'recent') return new Date(b.last_active_at || b.updated_at || 0) - new Date(a.last_active_at || a.updated_at || 0)
      if (sort === 'created') return new Date(b.created_at || 0) - new Date(a.created_at || 0)
      return String(a.full_name || a.email).localeCompare(String(b.full_name || b.email))
    })
  }, [users, query, role, sort])

  const counts = useMemo(() => ({
    total: users.length,
    admins: users.filter((item) => item.role === 'admin').length,
    operations: users.filter((item) => ['staff', 'operational_staff'].includes(item.role)).length,
    cashiers: users.filter((item) => item.role === 'cashier').length,
  }), [users])

  const clearFilters = () => { setQuery(''); setRole('all'); setSort('name') }
  const refreshAfterChange = async (message) => { await load(); setToast({ tone: 'success', message }) }

  return <section className="ua-module" aria-labelledby="user-management-title">
    <header className="ua-module-intro">
      <div><span className="ua-module-icon"><Users size={20}/></span><div><h2 id="user-management-title">User Management</h2><p>Manage administrator, operations staff, and cashier access.</p></div></div>
      <div className="ua-module-intro-actions">
        <span className="ua-module-count">{filtered.length} of {users.length} users</span>
        <button type="button" className="ua-primary-action" onClick={() => setInviteOpen(true)}><UserPlus size={17}/>Add User</button>
      </div>
    </header>

    <div className="ua-stat-rail" aria-label="Account summary">
      <div><span>Total users</span><b>{counts.total}</b></div>
      <div><span>Administrators</span><b>{counts.admins}</b></div>
      <div><span>Operations staff</span><b>{counts.operations}</b></div>
      <div><span>Cashiers</span><b>{counts.cashiers}</b></div>
    </div>

    <div className="ua-toolbar">
      <label className="ua-search"><Search size={18}/><span className="sr-only">Search users</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or username"/></label>
      <label><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">All roles</option>{PORTAL_ROLES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Name</option><option value="recent">Recently active</option><option value="created">Recently created</option></select></label>
      {(query || role !== 'all' || sort !== 'name') && <button type="button" className="ua-clear" onClick={clearFilters}><FilterX size={16}/>Clear</button>}
    </div>

    {error && <div className="ua-state ua-state--error" role="alert"><AlertTriangle/><div><b>Users could not be loaded</b><span>{error}</span></div><button onClick={load}>Try again</button></div>}
    {loading ? <LoadingRows /> : !error && <>
      <div className="ua-table-wrap">
        <table className="ua-table">
          <thead><tr><th>User</th><th>Role</th><th>Last active</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{filtered.map((item) => <tr key={item.id}>
            <td><UserIdentity user={item}/></td><td>{item.roleLabel}</td>
            <td>{formatDateTime(item.last_active_at || item.updated_at)}</td><td>{formatDateTime(item.created_at)}</td>
            <td><button type="button" className="ua-row-action" onClick={() => setSelected(item)}>View</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="ua-mobile-list">{filtered.map((item) => <button type="button" className="ua-user-card" key={item.id} onClick={() => setSelected(item)}><UserIdentity user={item}/><span>{item.roleLabel}</span></button>)}</div>
      {!filtered.length && <EmptyState icon={Users} title="No users found" message="Adjust the search or filters to see more accounts."/>}
    </>}

    <InviteUserModal open={inviteOpen} onClose={() => setInviteOpen(false)} onSuccess={(message) => refreshAfterChange(message)} />
    <UserDrawer user={selected} currentUserId={currentUser?.id} onClose={() => setSelected(null)} onChanged={(message) => { setSelected(null); refreshAfterChange(message) }} />
    {toast && <div className={`ua-toast ua-toast--${toast.tone}`} role="status"><BadgeCheck size={18}/>{toast.message}</div>}
  </section>
}

function UserIdentity({ user }) {
  const name = user.full_name || user.username || user.email || 'Unnamed user'
  return <div className="ua-user-identity"><span aria-hidden="true">{initials(name)}</span><div><b>{name}</b><small>{user.username ? `@${user.username} · ${user.email}` : user.email}</small></div></div>
}

function InviteUserModal({ open, onClose, onSuccess }) {
  const [values, setValues] = useState({ fullName: '', email: '', username: '', role: 'operational_staff' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(open, onClose)
  useEffect(() => { if (open) { setValues({ fullName: '', email: '', username: '', role: 'operational_staff' }); setError('') } }, [open])
  if (!open) return null
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await invitePortalUser(values); onClose(); onSuccess(`${values.fullName} was added. Sign-in instructions were sent to ${values.email}.`) }
    catch (cause) { setError(describeError(cause, 'Could not invite this user.')) }
    finally { setBusy(false) }
  }
  return <div className="ua-overlay" onMouseDown={onClose}><form className="ua-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="invite-user-title">
    <header><div><span className="ua-modal-icon"><MailPlus size={20}/></span><div><h2 id="invite-user-title">Add portal user</h2><p>Send a secure invitation to an internal team member.</p></div></div><button type="button" onClick={onClose} aria-label="Close add user dialog"><X/></button></header>
    <div className="ua-form-grid">
      <label className="ua-field ua-field--wide"><span>Full name</span><input autoFocus required value={values.fullName} onChange={(event) => setValues({ ...values, fullName: event.target.value })} autoComplete="name"/></label>
      <label className="ua-field"><span>Email</span><input required type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} autoComplete="email"/></label>
      <label className="ua-field"><span>Username <small>Optional</small></span><input value={values.username} onChange={(event) => setValues({ ...values, username: event.target.value })} autoComplete="username"/></label>
      <label className="ua-field ua-field--wide"><span>Portal role</span><select value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value })}>{PORTAL_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>The new user receives only the permissions assigned to this role.</small></label>
    </div>
    {error && <p className="ua-form-error" role="alert">{error}</p>}
    <footer><button type="button" className="ua-secondary-action" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="ua-primary-action" disabled={busy}>{busy ? 'Sending invitation…' : 'Send invitation'}</button></footer>
  </form></div>
}

function UserDrawer({ user, currentUserId, onClose, onChanged }) {
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState([])
  const [removeOpen, setRemoveOpen] = useState(false)
  useEscapeClose(Boolean(user) && !removeOpen, onClose)
  useEffect(() => {
    if (!user) return
    setRole(user.role === 'staff' ? 'operational_staff' : user.role); setError(''); setRemoveOpen(false)
    fetchPortalAuditEvents({ actorId: user.id }, { pageSize: 6 }).then(({ events }) => setRecent(events)).catch(() => setRecent([]))
  }, [user])
  if (!user) return null
  const isSelf = user.id === currentUserId
  const save = async () => {
    setBusy(true); setError('')
    try { await updatePortalUser(user.id, { role }); onChanged(`${user.full_name || user.email} was updated.`) }
    catch (cause) { setError(describeError(cause, 'Could not update this user.')) }
    finally { setBusy(false) }
  }
  const resetPassword = async () => {
    setBusy(true); setError('')
    try { await sendPortalPasswordReset(user.id); onChanged(`Password reset sent to ${user.email}.`) }
    catch (cause) { setError(describeError(cause, 'Could not send the password reset.')) }
    finally { setBusy(false) }
  }
  return <><button className="ua-drawer-scrim" onClick={onClose} aria-label="Close user details"/><aside className="ua-drawer" role="dialog" aria-modal="true" aria-labelledby="user-drawer-title">
    <header><div><span className="ua-drawer-avatar">{initials(user.full_name || user.email)}</span><div><h2 id="user-drawer-title">{user.full_name || user.email}</h2><p>{user.email}</p></div></div><button autoFocus type="button" onClick={onClose} aria-label="Close user details"><X/></button></header>
    <div className="ua-drawer-body">
      <section><div className="ua-section-heading"><ShieldCheck size={18}/><div><h3>Access controls</h3><p>Changes take effect the next time access is checked.</p></div></div>
        <label className="ua-field"><span>Portal role</span><select value={role} onChange={(event) => setRole(event.target.value)} disabled={isSelf}>{PORTAL_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {isSelf && <p className="ua-inline-note">Your own administrator role is protected.</p>}
      </section>
      <section><div className="ua-section-heading"><CircleUserRound size={18}/><div><h3>Account details</h3><p>Identity and account activity information.</p></div></div>
        <dl className="ua-details"><div><dt>Username</dt><dd>{user.username || 'Not set'}</dd></div><div><dt>Created</dt><dd>{formatDateTime(user.created_at)}</dd></div><div><dt>Last active</dt><dd>{formatDateTime(user.last_active_at || user.updated_at)}</dd></div></dl>
      </section>
      <section><div className="ua-section-heading"><Activity size={18}/><div><h3>Recent activity</h3><p>Latest recorded events by this user.</p></div></div>
        <div className="ua-recent-list">{recent.length ? recent.map((event) => <div key={event.id}><i className={`ua-event-dot ua-event-dot--${event.severity}`}/><span><b>{event.summary}</b><small>{formatDateTime(event.occurred_at)}</small></span></div>) : <p className="ua-inline-note">No recorded activity yet.</p>}</div>
      </section>
      {error && <p className="ua-form-error" role="alert">{error}</p>}
    </div>
    <footer><button type="button" className="ua-danger-action" onClick={() => setRemoveOpen(true)} disabled={busy || isSelf} title={isSelf ? 'You cannot remove your own account' : undefined}><Trash2 size={16}/>Remove User</button><button type="button" className="ua-secondary-action" onClick={resetPassword} disabled={busy}><KeyRound size={16}/>Send password reset</button><button type="button" className="ua-primary-action" onClick={save} disabled={busy || role === user.role}>{busy ? 'Saving…' : 'Save changes'}</button></footer>
  </aside><RemoveUserConfirm open={removeOpen} user={user} onClose={() => setRemoveOpen(false)} onRemoved={() => onChanged(`${user.full_name || user.email} was removed from portal access.`)} /></>
}

function RemoveUserConfirm({ open, user, onClose, onRemoved }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscapeClose(open && !busy, onClose)
  useEffect(() => { if (open) { setBusy(false); setError('') } }, [open])
  if (!open) return null

  const confirm = async () => {
    setBusy(true); setError('')
    try { await removePortalUser(user.id); onClose(); onRemoved() }
    catch (cause) { setError(describeError(cause, 'Could not remove this user. Please try again.')) }
    finally { setBusy(false) }
  }

  const name = user.full_name || user.username || user.email
  return <div className="ua-overlay ua-confirm-overlay" onMouseDown={busy ? undefined : onClose}>
    <section className="ua-modal ua-confirm-modal" onMouseDown={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="remove-user-title" aria-describedby="remove-user-description">
      <header><div><span className="ua-modal-icon ua-modal-icon--danger"><Trash2 size={20}/></span><div><h2 id="remove-user-title">Remove {name}?</h2><p>Confirm permanent portal removal.</p></div></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close remove user confirmation"><X/></button></header>
      <div className="ua-confirm-copy" id="remove-user-description"><p>This removes the user’s portal sign-in. Their recorded activity stays in Activity Logs for auditing, and this action cannot be undone.</p></div>
      {error && <p className="ua-form-error" role="alert">{error}</p>}
      <footer><button autoFocus type="button" className="ua-secondary-action" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="ua-danger-action ua-danger-action--solid" onClick={confirm} disabled={busy}>{busy ? 'Removing…' : 'Remove User'}</button></footer>
    </section>
  </div>
}

function ActivityLogsModule({ refreshSignal }) {
  const [searchInput, setSearchInput] = useState('')
  const [filters, setFilters] = useState({ search: '', surface: 'all', module: 'all', result: 'all', severity: 'all', dateFrom: '', dateTo: '' })
  const [events, setEvents] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => { setFilters((current) => ({ ...current, search: searchInput })); setPage(1) }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    try { const result = await fetchPortalAuditEvents(filters, { page, pageSize }); setEvents(result.events); setCount(result.count); setError('') }
    catch (cause) { setError(describeError(cause, 'Could not load portal activity.')) }
    finally { setLoading(false) }
  }, [filters, page, pageSize])
  useEffect(() => { load() }, [load, refreshSignal])

  const exportCsv = useCallback(async () => {
    setExporting(true)
    try { downloadAuditCsv(await fetchPortalAuditExport(filters)); setError('') }
    catch (cause) { setError(describeError(cause, 'Could not export activity.')) }
    finally { setExporting(false) }
  }, [filters])

  const setFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1) }
  const activeFilters = Object.entries(filters).filter(([key, value]) => key !== 'search' ? value && value !== 'all' : value.trim()).length
  const clearFilters = () => { setSearchInput(''); setFilters({ search: '', surface: 'all', module: 'all', result: 'all', severity: 'all', dateFrom: '', dateTo: '' }); setPage(1) }
  const pages = Math.max(1, Math.ceil(count / pageSize))

  return <section className="ua-module" aria-labelledby="activity-logs-title">
    <header className="ua-module-intro">
      <div><span className="ua-module-icon"><History size={20}/></span><div><h2 id="activity-logs-title">Activity Logs</h2><p>Read-only history from admin, staff, cashier, and system processes.</p></div></div>
      <div className="ua-module-intro-actions">
        <span className="ua-module-count">{count.toLocaleString()} events</span>
        <button type="button" className="ua-primary-action" onClick={exportCsv} disabled={exporting}><Download size={17}/>{exporting ? 'Exporting…' : 'Export CSV'}</button>
      </div>
    </header>
    <div className="ua-audit-notice"><ShieldCheck size={18}/><div><b>Immutable audit trail</b><span>Events can be reviewed and exported, but they cannot be edited or deleted from the portal.</span></div></div>
    <div className="ua-toolbar ua-toolbar--audit">
      <label className="ua-search"><Search size={18}/><span className="sr-only">Search activity logs</span><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search actor, action or target"/></label>
      <label><span>Surface</span><select value={filters.surface} onChange={(event) => setFilter('surface', event.target.value)}><option value="all">All surfaces</option><option value="admin">Admin</option><option value="staff">Staff</option><option value="cashier">Cashier</option><option value="system">System</option></select></label>
      <label><span>Module</span><select value={filters.module} onChange={(event) => setFilter('module', event.target.value)}><option value="all">All modules</option>{MODULE_OPTIONS.map((item) => <option value={item} key={item}>{item.replaceAll('_', ' ')}</option>)}</select></label>
      <label><span>Result</span><select value={filters.result} onChange={(event) => setFilter('result', event.target.value)}><option value="all">All results</option><option value="success">Success</option><option value="warning">Warning</option><option value="failed">Failed</option></select></label>
      <label><span>Severity</span><select value={filters.severity} onChange={(event) => setFilter('severity', event.target.value)}><option value="all">All levels</option><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
      <label><span>From</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilter('dateFrom', event.target.value)}/></label>
      <label><span>To</span><input type="date" value={filters.dateTo} onChange={(event) => setFilter('dateTo', event.target.value)}/></label>
      {activeFilters > 0 && <button type="button" className="ua-clear" onClick={clearFilters}><FilterX size={16}/>Clear {activeFilters}</button>}
    </div>

    {exporting && <div className="ua-exporting" role="status">Preparing the filtered activity export…</div>}
    {error && <div className="ua-state ua-state--error" role="alert"><AlertTriangle/><div><b>Activity could not be loaded</b><span>{error}</span></div><button onClick={load}>Try again</button></div>}
    {loading ? <LoadingRows /> : !error && <>
      <div className="ua-table-wrap">
        <table className="ua-table ua-audit-table">
          <thead><tr><th>Date & time</th><th>Actor</th><th>Surface</th><th>Module</th><th>Activity</th><th>Target</th><th>Result</th><th><span className="sr-only">Details</span></th></tr></thead>
          <tbody>{events.map((event) => <tr key={event.id}>
            <td><time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time></td>
            <td><b>{event.actor_name_snapshot || 'System'}</b><small>{displayRole(event.actor_role_snapshot)}</small></td>
            <td><span className="ua-surface"><i className={`ua-event-dot ua-event-dot--${event.surface}`}/>{event.surface}</span></td>
            <td>{event.module.replaceAll('_', ' ')}</td><td><b>{event.summary}</b><small>{event.action}</small></td><td>{event.entity_label || event.entity_id || 'Not available'}</td>
            <td><span className={`ua-result ua-result--${event.result}`}><i/>{event.result}</span></td><td><button className="ua-row-action" type="button" onClick={() => setSelected(event)}>Details</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="ua-mobile-list">{events.map((event) => <button type="button" className="ua-event-card" key={event.id} onClick={() => setSelected(event)}><span><i className={`ua-event-dot ua-event-dot--${event.severity}`}/><time>{formatDateTime(event.occurred_at)}</time><b>{event.actor_name_snapshot || 'System'}</b></span><strong>{event.summary}</strong><small>{event.module.replaceAll('_', ' ')} · {event.entity_label || event.entity_id || 'No target'}</small><span className={`ua-result ua-result--${event.result}`}><i/>{event.result}</span></button>)}</div>
      {!events.length && <EmptyState icon={History} title="No activity found" message="No audit events match the current filters."/>}
      <footer className="ua-pagination"><span>Page {page} of {pages}</span><label>Rows<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}>{PAGE_SIZE_OPTIONS.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><div><button type="button" onClick={() => setPage((value) => value - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft/></button><button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight/></button></div></footer>
    </>}
    <ActivityDrawer event={selected} onClose={() => setSelected(null)}/>
  </section>
}

function ActivityDrawer({ event, onClose }) {
  useEscapeClose(Boolean(event), onClose)
  if (!event) return null
  const before = event.before_data || {}
  const after = event.after_data || {}
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).slice(0, 30)
  const renderValue = (value) => value === undefined || value === null ? 'Not available' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return <><button className="ua-drawer-scrim" onClick={onClose} aria-label="Close activity details"/><aside className="ua-drawer ua-activity-drawer" role="dialog" aria-modal="true" aria-labelledby="activity-drawer-title">
    <header><div><span className="ua-modal-icon"><Activity size={20}/></span><div><h2 id="activity-drawer-title">Activity details</h2><p>{formatDateTime(event.occurred_at)}</p></div></div><button autoFocus type="button" onClick={onClose} aria-label="Close activity details"><X/></button></header>
    <div className="ua-drawer-body">
      <section className="ua-event-summary"><span className={`ua-result ua-result--${event.result}`}><i/>{event.result}</span><h3>{event.summary}</h3><p>{event.action}</p></section>
      <section><div className="ua-section-heading"><CircleUserRound size={18}/><div><h3>Context</h3><p>Who performed the action and where it occurred.</p></div></div><dl className="ua-details"><div><dt>Actor</dt><dd>{event.actor_name_snapshot || 'System'}</dd></div><div><dt>Role</dt><dd>{displayRole(event.actor_role_snapshot)}</dd></div><div><dt>Surface</dt><dd>{event.surface}</dd></div><div><dt>Module</dt><dd>{event.module.replaceAll('_', ' ')}</dd></div><div><dt>Target type</dt><dd>{event.entity_type}</dd></div><div><dt>Target</dt><dd>{event.entity_label || event.entity_id || 'Not available'}</dd></div></dl></section>
      <section><div className="ua-section-heading"><CalendarDays size={18}/><div><h3>Recorded changes</h3><p>Only fields that changed are shown.</p></div></div>{keys.length ? <div className="ua-change-list">{keys.map((key) => <div key={key}><b>{key.replaceAll('_', ' ')}</b><span><small>Before</small><code>{renderValue(before[key])}</code></span><span><small>After</small><code>{renderValue(after[key])}</code></span></div>)}</div> : <p className="ua-inline-note">This event contains no field-level comparison.</p>}</section>
      {(event.correlation_id || Object.keys(event.metadata || {}).length > 0) && <details className="ua-technical"><summary>Technical details</summary><dl className="ua-details">{event.correlation_id && <div><dt>Correlation ID</dt><dd><code>{event.correlation_id}</code></dd></div>}{Object.entries(event.metadata || {}).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd><code>{renderValue(value)}</code></dd></div>)}</dl></details>}
    </div>
  </aside></>
}

function LoadingRows() {
  return <div className="ua-loading" aria-label="Loading data">{Array.from({ length: 7 }).map((_, index) => <div key={index}/>)}</div>
}

function EmptyState({ icon: Icon, title, message }) {
  return <div className="ua-empty"><Icon size={24}/><b>{title}</b><span>{message}</span></div>
}
