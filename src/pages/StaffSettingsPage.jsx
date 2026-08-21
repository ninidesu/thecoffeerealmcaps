import { useEffect, useRef, useState } from 'react'
import { BellRing, Inbox, LayoutPanelTop, LockKeyhole, Monitor, RotateCcw, Save, ShieldCheck, UserRound } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { useAuth } from '../context/AuthContext'
import { describeError } from '../utils/describeError'
import {
  changeStaffPassword, DEFAULT_STAFF_PREFERENCES, fetchStaffPreferences,
  fetchPreciseStaffLocation, fetchStaffSessionInfo,
  MANAGEMENT_DISPLAY_PREFERENCE_KEYS, NOTIFICATION_STAFF_PREFERENCE_KEYS, previewStaffPreferences, saveStaffPreferences, saveStaffProfile,
  verifyStaffCurrentPassword, WORKSPACE_STAFF_PREFERENCE_KEYS,
} from '../services/staffSettingsService'
import {
  clearManagementSessionState, hasManagementSessionState, readManagementSessionState,
  useManagementSessionState, writeManagementSessionState,
} from '../hooks/useManagementSessionState'

const roleLabel = (role) => String(role || 'staff').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const SETTINGS_TABS = [
  { id: 'profile', label: 'My profile', Icon: UserRound },
  { id: 'notifications', label: 'Notifications', Icon: BellRing },
  { id: 'workspace', label: 'Workspace', Icon: LayoutPanelTop },
  { id: 'security', label: 'Security', Icon: LockKeyhole },
]
const formatSignIn = (value) => value ? new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not available'

function SettingToggle({ id, checked, onChange, title, description }) {
  return <label className="staff-setting-toggle" htmlFor={id}>
    <span><b>{title}</b><small>{description}</small></span>
    <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <i aria-hidden="true" />
  </label>
}

function SelectField({ id, label, value, onChange, children, help }) {
  return <label className="staff-settings-field" htmlFor={id}>
    <span>{label}</span>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    {help && <small>{help}</small>}
  </label>
}

export default function StaffSettingsPage({ role = 'staff' }) {
  const location = useLocation()
  const { user, profile, updateProfile } = useAuth()
  const profileDraftScope = `${role}:settings:profile-draft`
  const preferencesDraftScope = `${role}:settings:preferences-draft`
  const workspacePreferenceKeys = role === 'admin' ? MANAGEMENT_DISPLAY_PREFERENCE_KEYS : WORKSPACE_STAFF_PREFERENCE_KEYS
  const profileDraftAtMount = useRef(hasManagementSessionState(profileDraftScope))
  const preferencesDraftAtMount = useRef(hasManagementSessionState(preferencesDraftScope))
  const [profileValues, setProfileValues] = useState(() => readManagementSessionState(profileDraftScope, { full_name: '', username: '' }))
  const [preferences, setPreferences] = useState(() => readManagementSessionState(preferencesDraftScope, DEFAULT_STAFF_PREFERENCES))
  const [passwords, setPasswords] = useState({ current: '', password: '', confirm: '' })
  const [activeSection, setActiveSection] = useManagementSessionState(`${role}:settings:active-section`, 'profile')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState('success')
  const [sessionInfo, setSessionInfo] = useState({ loading: true, ip: null, city: null, region: null, countryCode: null, source: null })
  const preciseLocationRequested = useRef(false)

  useEffect(() => {
    if (!user?.id) return
    if (!profileDraftAtMount.current) setProfileValues({ full_name: profile?.full_name || '', username: profile?.username || '' })
    fetchStaffPreferences(user.id)
      .then((saved) => { if (!preferencesDraftAtMount.current) setPreferences(saved) })
      .catch((error) => { setNoticeKind('error'); setNotice(describeError(error, 'Could not load your workspace preferences.')) })
      .finally(() => setLoading(false))
  }, [user?.id, profile?.full_name, profile?.username])

  useEffect(() => {
    if (!user?.id) return
    let active = true
    setSessionInfo({ loading: true, ip: null, city: null, region: null, countryCode: null, source: null })
    fetchStaffSessionInfo()
      .then((data) => { if (active) setSessionInfo((current) => current.source === 'device' ? { ...current, loading: false, ip: data.ip } : { loading: false, ...data, source: 'ip' }) })
      .catch(() => { if (active) setSessionInfo((current) => current.source === 'device' ? { ...current, loading: false } : { loading: false, ip: null, city: null, region: null, countryCode: null, source: null }) })
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id || activeSection !== 'security' || preciseLocationRequested.current) return
    preciseLocationRequested.current = true
    let active = true
    fetchPreciseStaffLocation()
      .then((location) => {
        if (!active || !location.city) return
        setSessionInfo((current) => ({ ...current, city: location.city, region: location.region, source: 'device' }))
      })
      .catch(() => { /* Keep the IP-based fallback when device location is unavailable or denied. */ })
    return () => { active = false }
  }, [activeSection, user?.id])

  useEffect(() => {
    if (location.state?.section === 'notifications') setActiveSection('notifications')
  }, [location.state, setActiveSection])

  const updatePreference = (key, value) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    writeManagementSessionState(preferencesDraftScope, next)
    if (WORKSPACE_STAFF_PREFERENCE_KEYS.includes(key)) previewStaffPreferences(next)
  }
  const showNotice = (kind, message) => { setNoticeKind(kind); setNotice(message) }

  async function submitProfile(event) {
    event.preventDefault()
    if (!profileValues.full_name.trim()) { showNotice('error', 'Enter your full name before saving.'); return }
    const username = profileValues.username.trim()
    if (username && !/^[A-Za-z0-9._-]{3,32}$/.test(username)) { showNotice('error', 'Use 3–32 letters, numbers, periods, underscores, or hyphens for your username.'); return }
    setSaving('profile')
    try {
      const saved = await saveStaffProfile(user.id, profileValues)
      updateProfile((current) => ({ ...current, ...saved }))
      clearManagementSessionState(profileDraftScope)
      showNotice('success', 'Your profile has been updated.')
    } catch (error) {
      showNotice('error', error?.code === '23505' ? 'That username is already in use. Choose another one.' : describeError(error, 'Could not update your profile.'))
    } finally { setSaving('') }
  }

  async function submitPreferences(event, section) {
    event.preventDefault()
    const isWorkspace = section === 'workspace'
    const keys = isWorkspace ? workspacePreferenceKeys : NOTIFICATION_STAFF_PREFERENCE_KEYS
    setSaving(section)
    try {
      const saved = await saveStaffPreferences(user.id, preferences, keys)
      setPreferences((current) => {
        const next = { ...current, ...saved }
        writeManagementSessionState(preferencesDraftScope, next)
        return next
      })
      const workspaceMessage = role === 'admin'
        ? 'Workspace preferences saved. Display changes apply immediately across the Admin portal.'
        : 'Workspace preferences saved. Display changes apply now; start-page and order-board defaults apply the next time those views open.'
      showNotice('success', isWorkspace ? workspaceMessage : 'Notification preferences saved and applied.')
    } catch (error) {
      showNotice('error', describeError(error, isWorkspace ? 'Could not save your workspace preferences.' : 'Could not save your notification preferences.'))
    } finally { setSaving('') }
  }

  async function submitPassword(event) {
    event.preventDefault()
    if (!passwords.current) { showNotice('error', 'Enter your current password before choosing a new one.'); return }
    if (passwords.password.length < 8) { showNotice('error', 'Use a password with at least 8 characters.'); return }
    if (passwords.password !== passwords.confirm) { showNotice('error', 'The new password and confirmation do not match.'); return }
    setSaving('password')
    try {
      await verifyStaffCurrentPassword(profile?.email || user?.email, passwords.current)
      await changeStaffPassword(passwords.password)
      setPasswords({ current: '', password: '', confirm: '' })
      showNotice('success', 'Your password has been changed.')
    } catch (error) { showNotice('error', describeError(error, 'Could not change your password.')) } finally { setSaving('') }
  }

  const restoreWorkspaceDefaults = () => {
    const next = {
      ...preferences,
      ...Object.fromEntries(workspacePreferenceKeys.map((key) => [key, DEFAULT_STAFF_PREFERENCES[key]])),
    }
    setPreferences(next)
    writeManagementSessionState(preferencesDraftScope, next)
    previewStaffPreferences(next)
  }

  const refreshSettings = async () => {
    if (!user?.id) return
    try {
      const [savedPreferences, savedSession] = await Promise.all([fetchStaffPreferences(user.id), fetchStaffSessionInfo()])
      if (!hasManagementSessionState(preferencesDraftScope)) setPreferences(savedPreferences)
      setSessionInfo((current) => current.source === 'device' ? { ...current, loading: false, ip: savedSession.ip } : { loading: false, ...savedSession, source: 'ip' })
    } catch (error) {
      showNotice('error', describeError(error, 'Could not refresh settings data.'))
    }
  }

  const updateProfileDraft = (key, value) => {
    setProfileValues((current) => {
      const next = { ...current, [key]: value }
      writeManagementSessionState(profileDraftScope, next)
      return next
    })
  }

  return <AppShell role={role} title="Settings" onRefresh={refreshSettings}>
    {notice && <p className={`staff-settings-notice ${noticeKind}`} role="status">{notice}</p>}
    {loading ? <div className="staff-settings-loading">Loading your settings…</div> : <section className="staff-settings-container" aria-label={`${roleLabel(role)} settings`}>
      <div className="staff-settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map(({ id, label, Icon }) => <button key={id} id={`${id}-tab`} type="button" role="tab" aria-selected={activeSection === id} aria-controls={`${id}-panel`} className={activeSection === id ? 'active' : ''} onClick={() => setActiveSection(id)}><Icon size={17} /><span>{label}</span></button>)}
      </div>
      <div className="staff-settings-panel" id={`${activeSection}-panel`} role="tabpanel" aria-labelledby={`${activeSection}-tab`}>
      {activeSection === 'profile' && <form className="staff-settings-card" onSubmit={submitProfile}>
        <header className="staff-profile-header"><span className="staff-settings-icon"><UserRound size={19} /></span><div><h2>My profile</h2><p>Keep the details shown to your team accurate.</p></div><div className="staff-role-summary staff-profile-role"><span>Account role</span><b><ShieldCheck size={16} />{roleLabel(profile?.role)}</b></div></header>
        <div className="staff-settings-grid">
          <label className="staff-settings-field" htmlFor="staff-full-name"><span>Full name</span><input id="staff-full-name" value={profileValues.full_name} onChange={(event) => updateProfileDraft('full_name', event.target.value)} autoComplete="name" required /></label>
          <label className="staff-settings-field" htmlFor="staff-username"><span>Username <em>Optional</em></span><input id="staff-username" value={profileValues.username} onChange={(event) => updateProfileDraft('username', event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" minLength="3" maxLength="32" pattern="[A-Za-z0-9._-]+" /><small>{role === 'admin' ? 'Used to identify you across the administration workspace.' : 'You can use this username or your email when signing in as staff.'}</small></label>
          <label className="staff-settings-field"><span>Email address</span><input value={profile?.email || user?.email || ''} readOnly aria-readonly="true" /><small>{role === 'admin' ? 'Email changes are managed through Users & Access.' : 'Email changes require an administrator.'}</small></label>
          <div className="staff-profile-save"><button className="ops-main-action" type="submit" disabled={saving === 'profile'}><Save size={16} />{saving === 'profile' ? 'Saving…' : 'Save profile'}</button></div>
        </div>
      </form>}

      {activeSection === 'notifications' && <form className="staff-settings-card" onSubmit={(event) => submitPreferences(event, 'notifications')}>
        <header><span className="staff-settings-icon"><BellRing size={19} /></span><div><h2>Notifications</h2><p>Control what is saved in the notification center and what appears as a temporary system popup.</p></div></header>
        <div className="staff-notification-preference-groups">
          <fieldset className="staff-notification-preference-group">
            <legend><span className="staff-notification-group-icon"><Inbox size={18} /></span><span><b>Notification Center</b><small>Persistent alerts stacked under the bell icon. Open the bell to mark everything read or clear the list.</small></span></legend>
            <div className="staff-settings-toggles">
              <SettingToggle id="notify-orders" checked={preferences.notify_new_orders} onChange={(value) => updatePreference('notify_new_orders', value)} title="New orders" description="Save an alert when an order enters the preparation queue." />
              <SettingToggle id="notify-proofs" checked={preferences.notify_payment_proofs} onChange={(value) => updatePreference('notify_payment_proofs', value)} title="Payment verification" description="Save an alert when a payment proof needs review." />
              <SettingToggle id="notify-stock" checked={preferences.notify_low_stock} onChange={(value) => updatePreference('notify_low_stock', value)} title="Low stock" description="Save an alert when stock reaches a low or out-of-stock state." />
              <SettingToggle id="notify-menu" checked={preferences.notify_menu_changes} onChange={(value) => updatePreference('notify_menu_changes', value)} title="Menu changes" description="Save an alert when an item is added, updated, removed, or its availability changes." />
              <SettingToggle id="notify-cancellations" checked={preferences.notify_customer_cancellations} onChange={(value) => updatePreference('notify_customer_cancellations', value)} title="Customer cancellations and refunds" description="Save an alert when a customer cancels an order, including whether a refund needs staff action." />
            </div>
          </fieldset>
          <fieldset className="staff-notification-preference-group">
            <legend><span className="staff-notification-group-icon"><Monitor size={18} /></span><span><b>System Notifications</b><small>Temporary popups that confirm the result of actions while you work.</small></span></legend>
            <div className="staff-settings-toggles">
              <SettingToggle id="system-change-popups" checked={preferences.system_change_popups} onChange={(value) => updatePreference('system_change_popups', value)} title="Changes and updates" description="Show a popup after an item, order, transaction, or stock record is added, updated, removed, or changed." />
              <SettingToggle id="system-error-popups" checked={preferences.system_error_popups} onChange={(value) => updatePreference('system_error_popups', value)} title="Errors and failed actions" description="Show a popup when an attempted operation cannot be completed." />
            </div>
          </fieldset>
        </div>
        <footer><button className="ops-main-action" type="submit" disabled={saving === 'notifications'}><Save size={16} />{saving === 'notifications' ? 'Saving…' : 'Save notification preferences'}</button></footer>
      </form>}

      {activeSection === 'workspace' && <form className="staff-settings-card" onSubmit={(event) => submitPreferences(event, 'workspace')}>
        <header><span className="staff-settings-icon"><LayoutPanelTop size={19} /></span><div><h2>{role === 'admin' ? 'Admin workspace preferences' : 'Workspace preferences'}</h2><p>{role === 'admin' ? 'Adjust the density, accessibility, and behavior of your administration workspace.' : 'Set the defaults that make your operational views work best for you.'}</p></div></header>
        <div className="staff-workspace-groups">
          {role === 'staff' && <><fieldset className="staff-workspace-group"><legend>Start page</legend><p>Choose where your staff workspace opens after sign-in.</p><SelectField id="landing-view" label="Open after sign-in" value={preferences.landing_view} onChange={(value) => updatePreference('landing_view', value)}><option value="orders">Order Preparation</option><option value="inventory">Inventory Management</option><option value="transactions">Transactions</option><option value="menu">Manage Menu</option></SelectField></fieldset>
          <fieldset className="staff-workspace-group"><legend>Order board</legend><p>Set the view defaults for preparing and monitoring orders.</p><div className="staff-workspace-fields"><SelectField id="order-queue" label="Default order queue" value={preferences.order_queue} onChange={(value) => updatePreference('order_queue', value)}><option value="active">Active orders</option><option value="scheduled">Scheduled orders</option></SelectField><SelectField id="order-sort" label="Default order sorting" value={preferences.order_sort} onChange={(value) => updatePreference('order_sort', value)}><option value="priority">Priority</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="scheduled">Scheduled time</option></SelectField><SelectField id="fulfillment-filter" label="Default fulfillment filter" value={preferences.fulfillment_filter} onChange={(value) => updatePreference('fulfillment_filter', value)}><option value="all">All orders</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></SelectField><SettingToggle id="overdue-highlighting" checked={preferences.overdue_highlighting} onChange={(value) => updatePreference('overdue_highlighting', value)} title="Highlight overdue orders" description="Use a clear visual signal for active orders past their scheduled time." /></div></fieldset></>}
          <fieldset className="staff-workspace-group"><legend>Display and behavior</legend><p>Adjust how much information is shown and how the interface responds.</p><div className="staff-workspace-fields"><SelectField id="table-density" label="Table density" value={preferences.table_density} onChange={(value) => updatePreference('table_density', value)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></SelectField><SelectField id="rows-per-page" label="Rows per page" value={String(preferences.rows_per_page)} onChange={(value) => updatePreference('rows_per_page', Number(value))}><option value="10">10 rows</option><option value="25">25 rows</option><option value="50">50 rows</option></SelectField><SelectField id="reduced-motion" label="Motion" value={preferences.reduced_motion} onChange={(value) => updatePreference('reduced_motion', value)}><option value="system">Follow device settings</option><option value="reduce">Reduce motion</option><option value="full">Full motion</option></SelectField><SelectField id="font-size" label="Font size" value={preferences.font_size} onChange={(value) => updatePreference('font_size', value)} help="Previewed immediately. Save to keep it for your next session."><option value="standard">Standard</option><option value="large">Large</option><option value="extra_large">Extra large</option></SelectField></div><div className="staff-workspace-toggles"><SettingToggle id="remember-filters" checked={preferences.remember_filters} onChange={(value) => updatePreference('remember_filters', value)} title="Remember filters" description="Keep your most recent filters during your current browser session." /><SettingToggle id="high-contrast" checked={preferences.high_contrast} onChange={(value) => updatePreference('high_contrast', value)} title="Higher contrast" description="Increase the contrast of workspace surfaces and text." /></div></fieldset>
        </div>
        <footer><button className="ops-secondary-action" type="button" onClick={restoreWorkspaceDefaults}><RotateCcw size={16} />Restore defaults</button><button className="ops-main-action" type="submit" disabled={saving === 'workspace'}><Save size={16} />{saving === 'workspace' ? 'Saving…' : 'Save workspace preferences'}</button></footer>
      </form>}

      {activeSection === 'security' && <form className="staff-settings-card staff-settings-security" onSubmit={submitPassword}>
        <header className="staff-security-header"><span className="staff-settings-icon"><LockKeyhole size={19} /></span><div><h2>Security</h2><p>Use a strong, unique password for this internal account.</p></div><section className="staff-session-details" aria-labelledby="active-session-title"><div className="staff-session-current"><span className="staff-session-eyebrow">Active session</span><h3 className="staff-session-device-title" id="active-session-title">This device</h3><div className="staff-session-network" aria-label="Current IP address and approximate city and state or province" aria-live="polite">{sessionInfo.loading ? <span className="staff-session-loading">Checking…</span> : <><code title={sessionInfo.ip || 'Unavailable'}>{sessionInfo.ip || 'Unavailable'}</code><span className="staff-session-place" title={sessionInfo.city ? `${sessionInfo.city}${sessionInfo.region ? `, ${sessionInfo.region}` : ''}` : 'Unavailable'}>{sessionInfo.city ? `${sessionInfo.city}${sessionInfo.region ? `, ${sessionInfo.region}` : ''}` : 'Unavailable'}</span></>}</div></div><div className="staff-session-last"><span className="staff-session-eyebrow">Last sign-in</span><time dateTime={user?.last_sign_in_at || undefined}>{formatSignIn(user?.last_sign_in_at)}</time><p>Based on your account activity.</p></div></section></header>
        <div className="staff-settings-grid">
          <label className="staff-settings-field" htmlFor="current-password"><span>Current password</span><input id="current-password" type="password" value={passwords.current} onChange={(event) => setPasswords((current) => ({ ...current, current: event.target.value }))} autoComplete="current-password" required /></label>
          <label className="staff-settings-field" htmlFor="new-password"><span>New password</span><input id="new-password" type="password" value={passwords.password} onChange={(event) => setPasswords((current) => ({ ...current, password: event.target.value }))} autoComplete="new-password" minLength="8" required /><small>At least 8 characters.</small></label>
          <label className="staff-settings-field" htmlFor="confirm-password"><span>Confirm new password</span><input id="confirm-password" type="password" value={passwords.confirm} onChange={(event) => setPasswords((current) => ({ ...current, confirm: event.target.value }))} autoComplete="new-password" minLength="8" required /></label>
        </div>
        <footer className="staff-security-actions"><p className="staff-security-help">{role === 'admin' ? 'Forgot your current password? Use account recovery or ask another administrator for help.' : 'Forgot your current password? Contact an administrator to reset your account access.'}</p><button className="ops-main-action" type="submit" disabled={saving === 'password'}><LockKeyhole size={16} />{saving === 'password' ? 'Updating…' : 'Update password'}</button></footer>
      </form>}
      </div>
    </section>}
  </AppShell>
}
