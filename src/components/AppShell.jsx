import { BarChart3, Boxes, ClipboardList, Coffee, FileBarChart, LayoutDashboard, LogOut, MenuSquare, Package, ReceiptText, Settings, ShieldCheck, TrendingUp, Users } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { signOutPortal } from '../lib/auth'
import LogoutConfirmModal from './auth/LogoutConfirmModal'

const adminGroups = [
  { label: '', links: [['Dashboard','/admin',LayoutDashboard]] },
  { label: 'Operations', links: [['Inventory Monitoring','/admin/inventory',Boxes],['Transaction History','/admin/transactions',ReceiptText]] },
  { label: 'Reports', links: [['Sales Report','/admin/reports',FileBarChart],['Inventory Report','/admin/inventory-report',ClipboardList],['Cancellation Report','/admin/cancellations',ShieldCheck]] },
  { label: 'Analytics', links: [['Product Performance','/admin/products',BarChart3],['Sales Trends','/admin/trends',TrendingUp]] },
  { label: 'Administration', links: [['User Management','/admin/team',Users],['System Settings','/admin/settings',Settings],['Content Management','/admin/content',MenuSquare],['Activity Logs','/admin/logs',ShieldCheck]] },
]
const staffGroups = [{ label:'', links:[['Order Preparation','/staff',ClipboardList],['Inventory Management','/staff/inventory',Boxes],['Supply Orders','/staff/supplies',Package],['Manage Menu','/staff/menu',Coffee],['Transactions','/staff/transactions',ReceiptText]] }]

export default function AppShell({ role, title, eyebrow, children, actions }) {
  const groups = role === 'admin' ? adminGroups : staffGroups
  const navigate = useNavigate()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  async function confirmLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await signOutPortal()
      navigate('/portal', { replace: true })
    } finally {
      setLoggingOut(false)
      setLogoutOpen(false)
    }
  }

  return <div className={`app-layout legacy-${role}`}>
    <aside className="sidebar internal-sidebar">
      <div className="internal-brand"><img src="/images/coffeerealmlogo.png" alt="thecoffeerealm logo"/><div><h2>thecoffeerealm</h2><p>{role === 'admin' ? 'Admin Portal' : 'Operations Staff'}</p></div></div>
      <nav aria-label={`${role} navigation`}>{groups.map(group => <div className="internal-nav-group" key={group.label || 'main'}>{group.label && <span className="internal-group-label">{group.label}</span>}{group.links.map(([label,to,Icon]) => <NavLink key={to} to={to} end={to === `/${role}`} title={label}><Icon size={20}/><span>{label}</span></NavLink>)}</div>)}</nav>
      <button className="sidebar-exit" type="button" onClick={() => setLogoutOpen(true)}><LogOut size={19}/><span>Logout</span></button>
    </aside>
    <main className="app-main internal-main"><header className="page-header internal-page-header"><div><h1>{title}</h1><span>{eyebrow}</span></div><div className="header-actions">{actions}</div></header>{children}</main>
    <LogoutConfirmModal open={logoutOpen} busy={loggingOut} onCancel={() => setLogoutOpen(false)} onConfirm={confirmLogout} />
  </div>
}
