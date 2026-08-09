import { BarChart3, Bell, Boxes, CheckCheck, ClipboardList, Coffee, FileBarChart, LayoutDashboard, LogOut, Mail, MenuSquare, Moon, ReceiptText, RefreshCw, Settings, ShieldCheck, Sun, Trash2, TrendingUp, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { signOutPortal } from '../lib/auth'
import LogoutConfirmModal from './auth/LogoutConfirmModal'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { DEFAULT_STAFF_PREFERENCES, fetchStaffPreferences, getCachedStaffPreferences, subscribeToStaffPreferences } from '../services/staffSettingsService'
import {
  addStaffNotification, clearStaffNotifications, getStaffNotifications, markAllStaffNotificationsRead,
  markStaffNotificationRead, subscribeToStaffNotifications,
} from '../services/notificationCenterService'
import { clearManagementSessionState, requestManagementDataRefresh, useManagementSessionState } from '../hooks/useManagementSessionState'

const adminGroups = [
  { label: '', links: [['Dashboard','/admin',LayoutDashboard]] },
  { label: 'Operations', links: [['Inventory Monitoring','/admin/inventory',Boxes],['Transaction History','/admin/transactions',ReceiptText]] },
  { label: 'Reports', links: [['Sales Reports','/admin/reports',FileBarChart],['Inventory Report','/admin/inventory-report',ClipboardList],['Cancellation & Refunds','/admin/cancellations',ShieldCheck]] },
  { label: 'Analytics', links: [['Product Performance','/admin/products',BarChart3],['Sales Trends','/admin/trends',TrendingUp]] },
  { label: 'Administration', links: [['Content Management','/admin/content',MenuSquare],['Users & Access','/admin/users-access',Users],['System Settings','/admin/settings',Settings]] },
  { label: '', links: [['Settings','/admin/preferences',Settings]] },
]
const staffGroups = [{ label:'', links:[['Order Preparation','/staff',ClipboardList],['Inventory Management','/staff/inventory',Boxes],['Manage Menu','/staff/menu',Coffee],['Customer Messages','/staff/messages',Mail],['Transactions','/staff/transactions',ReceiptText],['Settings','/staff/settings',Settings]] }]

function notificationTime(value) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (elapsed < 60000) return 'Just now'
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(value))
}

export default function AppShell({ role, title, eyebrow, children, actions, titleActions, onRefresh, onNotifications, notificationCount = 0 }) {
  const groups = role === 'admin' ? adminGroups : staffGroups
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [notificationsOpen, setNotificationsOpen] = useManagementSessionState(`${role}:shell:notifications-open`, false)
  const [refreshing, setRefreshing] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [staffPreferences, setStaffPreferences] = useState(() => role === 'staff' ? getCachedStaffPreferences() : DEFAULT_STAFF_PREFERENCES)
  const notificationAnchorRef = useRef(null)
  const { preference, resolvedTheme, setPreference } = useTheme()
  const { profile, user } = useAuth()
  const accountRoleLabel = role === 'admin' ? 'Administrator' : 'Operation Staff'
  const accountDisplayName = profile?.full_name || profile?.username || profile?.email || user?.email || accountRoleLabel
  const accountInitials = accountDisplayName
    .replace(/@.*$/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'ST'
  const unreadNotificationCount = notifications.filter((item) => !item.read).length
  const visibleNotificationCount = Math.max(notificationCount, unreadNotificationCount)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const scrollKey = `tcr:management-scroll:${pathname}`
    const savedPosition = Number(window.sessionStorage.getItem(scrollKey) || 0)
    const restoreFrame = window.requestAnimationFrame(() => window.scrollTo({ top: savedPosition, behavior: 'auto' }))
    let saveFrame = 0
    const rememberPosition = () => {
      window.cancelAnimationFrame(saveFrame)
      saveFrame = window.requestAnimationFrame(() => window.sessionStorage.setItem(scrollKey, String(window.scrollY)))
    }
    window.addEventListener('scroll', rememberPosition, { passive: true })
    return () => {
      window.cancelAnimationFrame(restoreFrame)
      window.cancelAnimationFrame(saveFrame)
      window.removeEventListener('scroll', rememberPosition)
    }
  }, [pathname])

  useEffect(() => {
    if (!['staff', 'admin'].includes(role) || !user?.id) return undefined
    setNotifications(getStaffNotifications(user.id))
    const unsubscribeNotifications = subscribeToStaffNotifications(user.id, setNotifications)
    const unsubscribePreferences = role === 'staff' ? subscribeToStaffPreferences(setStaffPreferences) : () => {}
    if (role === 'staff') fetchStaffPreferences(user.id).then(setStaffPreferences).catch(() => setStaffPreferences(DEFAULT_STAFF_PREFERENCES))
    return () => {
      unsubscribeNotifications()
      unsubscribePreferences()
    }
  }, [role, user?.id])

  useEffect(() => {
    if (role !== 'staff') return undefined
    const root = document.documentElement
    root.dataset.staffFontSize = staffPreferences.font_size
    root.dataset.staffMotion = staffPreferences.reduced_motion
    return () => {
      delete root.dataset.staffFontSize
      delete root.dataset.staffMotion
    }
  }, [role, staffPreferences.font_size, staffPreferences.reduced_motion])

  useEffect(() => {
    if (!notificationsOpen) return undefined
    const closeOnOutsideClick = (event) => {
      if (!notificationAnchorRef.current?.contains(event.target)) setNotificationsOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setNotificationsOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [notificationsOpen, setNotificationsOpen])

  useEffect(() => {
    if (!['staff', 'admin'].includes(role) || !user?.id || !isSupabaseConfigured) return undefined
    const add = (notification) => addStaffNotification(user.id, notification)
    const channel = supabase.channel(`management-notification-center-${user.id}`)

    if (role === 'admin' || staffPreferences.notify_new_orders) channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, ({ new: order }) => add({
      category: 'orders', title: 'New order received', message: order?.order_number ? `${order.order_number} entered the order queue.` : 'A new order entered the preparation queue.',
    }))
    if (role === 'admin' || staffPreferences.notify_payment_proofs) channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, ({ new: order, old }) => {
      if (!order?.payment_proof_path || order.payment_proof_path === old?.payment_proof_path) return
      add({ category: 'payments', title: 'Payment proof received', message: order.order_number ? `${order.order_number} needs payment verification.` : 'A payment proof needs verification.' })
    })
    if (role === 'admin' || staffPreferences.notify_customer_cancellations) channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, ({ new: order, old }) => {
      const reviewRequested = order?.cancellation_status === 'requested'
        && old?.cancellation_status !== 'requested'
        && order.cancellation_requested_by_role === 'Customer'
      const cancelled = order?.status === 'Cancelled'
        && old?.status !== 'Cancelled'
        && order.cancelled_by_role === 'Customer'
      if (!reviewRequested && !cancelled) return
      const orderLabel = order.order_number || 'An order'
      const reason = order.cancellation_reason ? ` Reason: ${order.cancellation_reason}.` : ''
      add({
        category: 'cancellations',
        title: reviewRequested ? 'Cancellation review requested' : 'Customer cancellation',
        message: reviewRequested
          ? `${orderLabel} is on hold while payment and refund requirements are reviewed.${reason}`
          : `${orderLabel} was cancelled by the customer. No verified payment was recorded.${reason}`,
      })
    })
    if (role === 'admin' || staffPreferences.notify_low_stock) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_stock' }, ({ new: stock }) => {
      const quantity = Number(stock?.quantity)
      const minimum = Number(stock?.min_stock_level)
      if (!Number.isFinite(quantity) || !Number.isFinite(minimum) || minimum <= 0 || quantity > minimum) return
      add({ category: 'inventory', title: quantity <= 0 ? 'Item out of stock' : 'Low stock detected', message: `Stock is at ${quantity}; the reorder level is ${minimum}.` })
    })
    if (role === 'admin' || staffPreferences.notify_menu_changes) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, ({ eventType, new: item, old }) => {
      const name = item?.name || old?.name || 'A menu item'
      const action = eventType === 'INSERT' ? 'was added' : eventType === 'DELETE' ? 'was removed' : 'was updated'
      add({ category: 'menu', title: 'Menu changed', message: `${name} ${action}.` })
    })

    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [role, staffPreferences.notify_customer_cancellations, staffPreferences.notify_low_stock, staffPreferences.notify_menu_changes, staffPreferences.notify_new_orders, staffPreferences.notify_payment_proofs, user?.id])

  useEffect(() => {
    const themeColor = document.querySelector('meta[name="theme-color"]')
    if (!themeColor) return undefined
    const previous = themeColor.getAttribute('content')
    themeColor.setAttribute('content', resolvedTheme === 'dark' ? '#050708' : '#ffffff')
    return () => themeColor.setAttribute('content', previous || '#1b2f22')
  }, [resolvedTheme])

  const refreshPage = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      if (onRefresh) await onRefresh()
      else requestManagementDataRefresh(pathname)
    } finally {
      window.setTimeout(() => setRefreshing(false), 350)
    }
  }

  const openNotifications = () => {
    if (onNotifications) onNotifications()
    else if (role === 'staff' || role === 'admin') setNotificationsOpen((current) => !current)
  }

  const readNotification = (notificationId) => markStaffNotificationRead(user?.id, notificationId)
  const readAllNotifications = () => markAllStaffNotificationsRead(user?.id)
  const clearNotifications = () => clearStaffNotifications(user?.id)

  async function confirmLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await signOutPortal()
      clearManagementSessionState()
      navigate('/portal', { replace: true })
    } finally {
      setLoggingOut(false)
      setLogoutOpen(false)
    }
  }

  const themeOptions = [
    ['light', 'Light theme', Sun],
    ['dark', 'Dark theme', Moon],
  ]

  return <div className={`app-layout legacy-${role}`} data-theme={resolvedTheme} data-staff-density={role === 'staff' ? staffPreferences.table_density : undefined} data-staff-contrast={role === 'staff' ? String(staffPreferences.high_contrast) : undefined} data-staff-overdue={role === 'staff' ? String(staffPreferences.overdue_highlighting) : undefined}>
    <aside className="sidebar internal-sidebar">
      <div className="internal-brand"><img src="/images/coffeerealmlogo.png" alt="thecoffeerealm logo"/><div><h2>thecoffeerealm</h2>{role === 'admin' && <p>Admin Portal</p>}</div></div>
      <nav aria-label={`${role} navigation`}>{groups.map(group => <div className="internal-nav-group" key={group.label || group.links[0][1]}>{group.label && <span className="internal-group-label">{group.label}</span>}{group.links.map(([label,to,Icon]) => <NavLink key={to} to={to} end={to === `/${role}`} title={label}><Icon size={20}/><span>{label}</span></NavLink>)}</div>)}</nav>
      <div className="sidebar-footer-stack">
        <div className="sidebar-theme-switcher" role="group" aria-label="Theme options">
          {themeOptions.map(([value, label, Icon]) => <button key={value} type="button" className={preference === value ? 'active' : ''} aria-label={label} aria-pressed={preference === value} title={label} onClick={() => setPreference(value)}><Icon size={18} aria-hidden="true"/></button>)}
        </div>
        <button type="button" className="sidebar-staff-profile" onClick={() => navigate(role === 'admin' ? '/admin/preferences' : '/staff/settings')} title={`Open profile for ${accountDisplayName}`} aria-label={`Open profile for ${accountDisplayName}, ${accountRoleLabel}`}>
          <span className="sidebar-staff-avatar" aria-hidden="true">{accountInitials}</span>
          <span className="sidebar-staff-profile-copy"><strong>{accountDisplayName}</strong><small>{accountRoleLabel}</small></span>
        </button>
        <button className="sidebar-exit" type="button" onClick={() => setLogoutOpen(true)}><LogOut size={19}/><span>Logout</span></button>
      </div>
    </aside>
    <main className="app-main internal-main"><header className={`page-header internal-page-header${eyebrow ? '' : ' is-compact'}`}><div><div className="internal-title-row"><h1>{title}</h1>{titleActions}</div>{eyebrow && <span>{eyebrow}</span>}</div><div className="header-actions"><div className="internal-utility-bar" aria-label="Workspace utilities"><div className="internal-live-datetime"><span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span><b>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)} PHT</b></div><div className="internal-notification-anchor" ref={notificationAnchorRef}><button type="button" className="internal-utility-button" aria-label={`Open notifications${visibleNotificationCount ? `, ${visibleNotificationCount} unread` : ''}`} aria-expanded={['staff', 'admin'].includes(role) ? notificationsOpen : undefined} aria-controls={role === 'staff' ? 'staff-notification-center' : undefined} title="Notifications" onClick={openNotifications}><Bell size={18} />{visibleNotificationCount > 0 && <span className="internal-utility-badge">{visibleNotificationCount > 99 ? '99+' : visibleNotificationCount}</span>}</button>{['staff', 'admin'].includes(role) && notificationsOpen && <aside className="staff-notification-center" id="staff-notification-center" role="dialog" aria-modal="false" aria-labelledby="staff-notification-title"><header><div><span>Notification center</span><h2 id="staff-notification-title">Recent activity</h2></div><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={18} /></button></header><div className="staff-notification-actions"><button type="button" onClick={readAllNotifications} disabled={!unreadNotificationCount}><CheckCheck size={16} />Read all</button><button type="button" className="is-destructive" onClick={clearNotifications} disabled={!notifications.length}><Trash2 size={16} />Clear</button></div><div className="staff-notification-list">{notifications.length ? notifications.map((notification) => <button type="button" className={notification.read ? 'is-read' : 'is-unread'} data-category={notification.category} key={notification.id} onClick={() => readNotification(notification.id)}><i aria-hidden="true" /><span><b>{notification.title}</b><small>{notification.message}</small><time dateTime={notification.createdAt}>{notificationTime(notification.createdAt)}</time></span></button>) : <div className="staff-notification-empty"><Bell size={22} /><b>{role === 'admin' && notificationCount > 0 ? `${notificationCount} items need attention` : 'You’re all caught up'}</b><span>{role === 'admin' && notificationCount > 0 ? 'Review the dashboard attention cards for details.' : 'Operational alerts will stack here as they arrive.'}</span></div>}</div><footer><button type="button" onClick={() => { setNotificationsOpen(false); navigate(role === 'admin' ? '/admin/preferences' : '/staff/settings') }}>Notification settings</button></footer></aside>}</div><button type="button" className="internal-utility-button" aria-label={refreshing ? 'Refreshing current page data' : 'Refresh current page data'} aria-busy={refreshing} title={refreshing ? 'Refreshing data…' : 'Refresh data'} onClick={refreshPage} disabled={refreshing}><RefreshCw size={18} className={refreshing ? 'spin' : ''} /></button></div>{actions}</div></header>{children}</main>
    <LogoutConfirmModal open={logoutOpen} busy={loggingOut} onCancel={() => setLogoutOpen(false)} onConfirm={confirmLogout} />
  </div>
}
