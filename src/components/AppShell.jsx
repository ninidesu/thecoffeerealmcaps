import { BarChart3, Boxes, ClipboardList, Coffee, FileBarChart, LayoutDashboard, LogOut, MenuSquare, Package, ReceiptText, Settings, ShieldCheck, TrendingUp, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'

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
  return <div className={`app-layout legacy-${role}`}>
    <aside className="sidebar internal-sidebar">
      <div className="internal-brand"><img src="/images/coffeerealmlogo.png" alt="the coffee realm logo"/><div><h2>the coffee realm</h2><p>{role === 'admin' ? 'Admin Portal' : 'Operations Staff'}</p></div></div>
      <nav aria-label={`${role} navigation`}>{groups.map(group => <div className="internal-nav-group" key={group.label || 'main'}>{group.label && <span className="internal-group-label">{group.label}</span>}{group.links.map(([label,to,Icon]) => <NavLink key={to} to={to} end={to === `/${role}`} title={label}><Icon size={20}/><span>{label}</span></NavLink>)}</div>)}</nav>
      <a className="sidebar-exit" href="/portal"><LogOut size={19}/><span>Logout</span></a>
    </aside>
    <main className="app-main internal-main"><header className="page-header internal-page-header"><div><h1>{title}</h1><span>{eyebrow}</span></div><div className="header-actions">{actions}</div></header>{children}</main>
  </div>
}
