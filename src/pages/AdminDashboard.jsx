import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleDollarSign, Clock3,
  Coffee, CreditCard, Mail, PackageCheck, PackageX, ReceiptText, RefreshCw, RotateCcw,
  ShoppingBag, TrendingDown, TrendingUp, Truck, UserRoundCheck, UsersRound, WalletCards,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import AppShell from '../components/AppShell'
import ContentManagementPage from './ContentManagementPage'
import SystemSettingsPage from './SystemSettingsPage'
import UsersAccessPage from './UsersAccessPage'
import AdminInventoryPage from './AdminInventoryPage'
import InventoryReportPage from './InventoryReportPage'
import TransactionsPage from './TransactionsPage'
import SalesReportPage from './SalesReportPage'
import CancellationReportPage from './CancellationReportPage'
import { computeDashboardMetrics, fetchDashboardData } from '../services/adminDashboardService'
import { describeError } from '../utils/describeError'
import { money } from '../utils/money'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const adminPageTitles = {
  '/admin': 'Dashboard',
  '/admin/inventory': 'Inventory Monitoring',
  '/admin/transactions': 'Transaction History',
  '/admin/reports': 'Sales',
  '/admin/inventory-report': 'Inventory Report',
  '/admin/cancellations': 'Cancellation & Refunds',
  '/admin/products': 'Product Performance',
  '/admin/trends': 'Sales Trends',
  '/admin/content': 'Content Management',
  '/admin/users-access/users': 'Users & Access',
  '/admin/users-access/activity': 'Users & Access',
  '/admin/settings': 'System Settings',
  '/admin/preferences': 'Settings',
}

const stageMeta = [
  ['pending', 'Needs review', Clock3, '#d6a34d'],
  ['preparing', 'Preparing', Coffee, '#5887a0'],
  ['ready', 'Ready for pickup', PackageCheck, '#4d8c68'],
  ['delivery', 'Out for delivery', Truck, '#397f7b'],
  ['completed', 'Completed', CheckCircle2, '#8a9690'],
]

const paymentLabels = { gcash: 'GCash', bank_transfer: 'Bank transfer', cod: 'Cash / COD', cash: 'Cash', other: 'Other' }
const fulfillmentLabels = { delivery: 'Delivery', pickup: 'Pickup', 'walk-in': 'Walk-in' }

function percentage(value) {
  if (!Number.isFinite(value)) return '0%'
  return `${Math.abs(value).toFixed(1)}%`
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function formatDashboardDate() {
  return new Intl.DateTimeFormat('en-PH', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
}

function timeAgo(value) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (elapsed < 60000) return 'Just now'
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`
  return formatShortDate(value)
}

export default function AdminDashboard() {
  const { pathname } = useLocation()
  if (pathname === '/admin/team') return <Navigate to="/admin/users-access/users" replace />
  if (pathname === '/admin/logs') return <Navigate to="/admin/users-access/activity" replace />
  if (pathname === '/admin/users-access') return <Navigate to="/admin/users-access/users" replace />
  if (pathname.startsWith('/admin/users-access/')) return <UsersAccessPage />
  if (pathname === '/admin/content') return <ContentManagementPage />
  if (pathname === '/admin/settings') return <SystemSettingsPage />
  if (pathname === '/admin/inventory') return <AdminInventoryPage />
  if (pathname === '/admin/inventory-report') return <InventoryReportPage />
  if (pathname === '/admin/transactions') return <TransactionsPage />
  if (pathname === '/admin/reports' || pathname === '/admin/products' || pathname === '/admin/trends') return <SalesReportPage />
  if (pathname === '/admin/cancellations') return <CancellationReportPage />
  if (pathname !== '/admin') return <AppShell role="admin" title={adminPageTitles[pathname] || 'Dashboard'} />
  return <AdminDashboardHome />
}

function AdminDashboardHome() {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    try {
      const raw = await fetchDashboardData()
      setMetrics(computeDashboardMetrics(raw))
      setLastUpdated(new Date())
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'The dashboard could not be loaded.'))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined
    const refresh = () => load({ quiet: true })
    const channel = supabase.channel('admin-dashboard-live')
    ;['orders', 'payments', 'refunds', 'inventory_stock', 'menu_items', 'customer_messages'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
    })
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const attentionCount = metrics ? metrics.attentionOrders.length + metrics.pendingRefunds.length + metrics.outOfStockItems.length + metrics.awaitingMessages.length + metrics.criticalAuditEvents.length : 0

  return <AppShell
    role="admin"
    title="Dashboard"
    eyebrow="Business health, live operations, and the work that needs attention."
    onRefresh={load}
    notificationCount={attentionCount}
    titleActions={<div className="ad-live-state"><i />Live monitoring{lastUpdated && <span>Updated {timeAgo(lastUpdated)}</span>}</div>}
  >
    {error && <div className="ad-error" role="alert"><AlertTriangle size={19} /><div><b>Dashboard unavailable</b><span>{error}</span></div><button type="button" onClick={() => load()}><RefreshCw size={15} />Try again</button></div>}
    {loading ? <DashboardSkeleton /> : metrics && <DashboardContent metrics={metrics} />}
  </AppShell>
}

function DashboardContent({ metrics }) {
  const actionCards = [
    { label: 'Orders to review', value: metrics.attentionOrders.length, detail: 'Payment or cancellation hold', icon: Clock3, tone: 'amber', to: '/staff' },
    { label: 'Pending refunds', value: metrics.pendingRefunds.length, detail: money(metrics.pendingRefundAmount), icon: RotateCcw, tone: 'rose', to: '/admin/cancellations' },
    { label: 'Stock at risk', value: metrics.lowStockItems.length, detail: `${metrics.outOfStockItems.length} out of stock`, icon: PackageX, tone: 'rose', to: '/admin/inventory' },
    { label: 'Awaiting reply', value: metrics.awaitingMessages.length, detail: `${metrics.messagesToday} received today`, icon: Mail, tone: 'blue', to: '/staff/messages' },
  ]

  const quickLinks = [
    { label: 'Transactions', icon: ReceiptText, to: '/admin/transactions' },
    { label: 'Sales report', icon: CircleDollarSign, to: '/admin/reports' },
    { label: 'Inventory', icon: PackageCheck, to: '/admin/inventory' },
  ]

  return <div className="ad-dashboard ad-dashboard-v2 dash-fade-in">
    <section className="ad-command-center" aria-labelledby="dashboard-overview-heading">
      <div className="ad-command-copy">
        <span className="ad-command-kicker"><i />{formatDashboardDate()}</span>
        <h2 id="dashboard-overview-heading">Store operations at a glance</h2>
        <p>Track sales, orders, inventory, and customer activity from one clear workspace.</p>
      </div>
      <div className="ad-command-side">
        <div className={`ad-store-state is-${metrics.storeStatus}`}><i /><b>{metrics.storeStatus === 'closed' ? 'Online ordering paused' : 'Store operations live'}</b></div>
        <nav className="ad-quick-nav" aria-label="Dashboard shortcuts">
          {quickLinks.map(({ label, icon: Icon, to }) => <Link to={to} key={label}><Icon size={17} /><span>{label}</span></Link>)}
        </nav>
      </div>
    </section>

    <section className="ad-section ad-overview-section" aria-labelledby="today-heading">
      <SectionHeading id="today-heading" title="Today's overview" detail="Revenue uses paid, completed sales." action={<Link to="/admin/reports">View full report <ArrowRight size={15} /></Link>} />
      <div className="ad-kpi-grid">
        <KpiCard icon={CircleDollarSign} label="Net sales" value={money(metrics.totalSales)} comparison={metrics.salesChangePct} detail="vs yesterday" tone="green" />
        <KpiCard icon={ShoppingBag} label="Orders" value={metrics.totalOrders.toLocaleString()} detail={`${metrics.completedOrders} completed`} tone="cream" />
        <KpiCard icon={WalletCards} label="Average order" value={money(metrics.avgOrderValue)} detail="Paid completed orders" tone="blue" />
        <KpiCard icon={CheckCircle2} label="Completion rate" value={`${metrics.completionRate.toFixed(0)}%`} detail={`${metrics.cancelledOrders} cancelled today`} tone="rose" />
        <KpiCard icon={UsersRound} label="Customers" value={metrics.totalCustomers.toLocaleString()} detail={`${metrics.newCustomers + metrics.returningCustomers} active today`} tone="green" />
      </div>
    </section>

    <section className="ad-v2-grid ad-v2-grid-main" aria-label="Sales and attention overview">
      <Panel title="Sales momentum" detail="Net sales over the last 14 days" action={<Link to="/admin/trends">Explore trends <ArrowRight size={15} /></Link>} className="ad-v2-sales-panel">
        <SalesLineChart points={metrics.salesTrend} />
      </Panel>

      <Panel title="Needs attention" detail="Priority work requiring a review" action={<span className="ad-attention-count">{actionCards.reduce((sum, item) => sum + item.value, 0)} open</span>} className="ad-v2-attention-panel">
        <div className="ad-attention-grid">
          {actionCards.map((item) => <Link className={`ad-attention-card is-${item.tone}`} to={item.to} key={item.label}>
            <span className="ad-attention-icon"><item.icon size={18} /></span><span><b>{item.value}</b><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowRight size={15} />
          </Link>)}
        </div>
        <Link className="ad-settings-link" to="/admin/settings">Review system settings <ArrowRight size={15} /></Link>
      </Panel>
    </section>

    <section className="ad-v2-grid ad-v2-grid-wide" aria-label="Orders and payments">
      <Panel title="Live order flow" detail="Today's orders by operational stage" action={<Link to="/staff">Open preparation <ArrowRight size={15} /></Link>} className="ad-operations-panel">
        <OrderFlowChart counts={metrics.orderStageCounts} />
        <div className="ad-order-list">
          <div className="ad-list-head"><span>Recent orders</span><span>Status</span></div>
          {metrics.recentOrders.slice(0, 5).map((order) => <div className="ad-order-row" key={order.id}>
            <span><b>{order.order_number}</b><small>{order.customer_name || 'Walk-in customer'} - {fulfillmentLabels[order.order_type] || order.order_type}</small></span>
            <span className={`ad-order-status is-${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</span>
          </div>)}
          {!metrics.recentOrders.length && <EmptyState icon={ReceiptText} text="No orders have been recorded today." />}
        </div>
      </Panel>

      <Panel title="Payment mix" detail="Today's completed payments by usage">
        <BreakdownDonut data={metrics.paymentUsage} labels={paymentLabels} colors={['#147d57', '#d1a44f', '#5f86a0', '#9a7564']} />
      </Panel>
    </section>

    <section className="ad-v2-grid ad-v2-grid-wide" aria-label="Inventory and product performance">
      <Panel title="Inventory risk" detail="Low and out-of-stock items ranked by urgency" action={<Link to="/admin/inventory">Monitor inventory <ArrowRight size={15} /></Link>}>
        <div className="ad-inventory-summary">
          <div className="is-danger"><PackageX size={18} /><span><b>{metrics.outOfStockItems.length}</b><small>Out of stock</small></span></div>
          <div className="is-warning"><AlertTriangle size={18} /><span><b>{Math.max(0, metrics.lowStockItems.length - metrics.outOfStockItems.length)}</b><small>Low stock</small></span></div>
          <div className="is-info"><Clock3 size={18} /><span><b>{metrics.expiringItems.length}</b><small>Expiring soon</small></span></div>
        </div>
        <div className="ad-stock-list">
          {metrics.lowStockItems.slice(0, 5).map((item) => {
            const ratio = item.min > 0 ? Math.min(100, Math.max(0, (item.quantity / item.min) * 100)) : 100
            return <div className="ad-stock-row" key={item.id}><span><b>{item.name}</b><small>{item.quantity} {item.unit} on hand - alert at {item.min}</small></span><div><i style={{ width: `${ratio}%` }} /></div><strong>{item.healthy > item.quantity ? `+${Math.ceil(item.healthy - item.quantity)}` : 'Review'}</strong></div>
          })}
          {!metrics.lowStockItems.length && <EmptyState icon={PackageCheck} text="Inventory levels are healthy." />}
        </div>
      </Panel>

      <Panel title="Best sellers" detail="Top products by quantity sold in the last 14 days" action={<Link to="/admin/products">Product report <ArrowRight size={15} /></Link>}>
        <RankedProducts products={metrics.bestSellers} />
      </Panel>
    </section>

    <section className="ad-v2-grid ad-v2-grid-even" aria-label="Customer and administration activity">
      <Panel title="Customer activity" detail="Today's customer mix and inbox workload" action={<Link to="/staff/messages">Open inbox <ArrowRight size={15} /></Link>}>
        <CustomerMixChart newCustomers={metrics.newCustomers} returningCustomers={metrics.returningCustomers} />
        <div className="ad-customer-stats">
          <div><UsersRound size={17} /><span><b>{metrics.totalCustomers.toLocaleString()}</b><small>Registered customers</small></span></div>
          <div><Mail size={17} /><span><b>{metrics.awaitingMessages.length}</b><small>Awaiting a reply</small></span></div>
          <div><TrendingUp size={17} /><span><b>{(metrics.newCustomers + metrics.returningCustomers) ? `${Math.round((metrics.returningCustomers / (metrics.newCustomers + metrics.returningCustomers)) * 100)}%` : '0%'}</b><small>Returning rate</small></span></div>
        </div>
        <div className="ad-message-list">
          {metrics.awaitingMessages.slice(0, 3).map((message) => <Link to="/staff/messages" key={message.id}><i /><span><b>{message.subject}</b><small>{message.customer_name} - {timeAgo(message.created_at)}</small></span></Link>)}
          {!metrics.awaitingMessages.length && <EmptyState icon={CheckCircle2} text="No customer messages are waiting." />}
        </div>
      </Panel>

      <Panel title="Store activity" detail="Order channels and recent administrative changes" action={<Link to="/admin/users-access/activity">View audit trail <ArrowRight size={15} /></Link>}>
        <div className="ad-v2-subsection"><span>Order channels</span><small>Today's non-cancelled orders</small></div>
        <HorizontalBreakdown data={metrics.fulfillmentCounts} labels={fulfillmentLabels} />
        <div className="ad-v2-subsection ad-v2-subsection-divided"><span>Administration activity</span><small>Latest management changes</small></div>
        <div className="ad-activity-list">
          {metrics.auditEvents.slice(0, 4).map((event) => <div key={event.id}><i className={`is-${event.severity || event.result}`} /><span><b>{event.summary}</b><small>{event.actor_name_snapshot || 'System'} - {timeAgo(event.occurred_at)}</small></span><em>{event.module?.replaceAll('_', ' ')}</em></div>)}
          {!metrics.auditEvents.length && <EmptyState icon={UserRoundCheck} text="No recent administrative activity." />}
        </div>
      </Panel>
    </section>
  </div>
}

function SectionHeading({ id, title, detail, action }) {
  return <div className="ad-section-heading"><div><h2 id={id}>{title}</h2><p>{detail}</p></div>{action}</div>
}

function Panel({ title, detail, action, className = '', children }) {
  return <article className={`ad-panel ${className}`}><header><div><h2>{title}</h2><p>{detail}</p></div>{action}</header><div className="ad-panel-body">{children}</div></article>
}

function KpiCard({ icon: Icon, label, value, comparison, detail, tone }) {
  const up = comparison >= 0
  return <article className={`ad-kpi-card is-${tone}`}><div className="ad-kpi-top"><span><Icon size={19} /></span><small>{label}</small></div><strong>{value}</strong><footer>{comparison !== undefined && <span className={up ? 'is-up' : 'is-down'}>{up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{percentage(comparison)}</span>}<small>{detail}</small></footer></article>
}

function OrderFlowChart({ counts }) {
  const total = Math.max(1, stageMeta.reduce((sum, [key]) => sum + (counts[key] || 0), 0))
  return <div className="ad-flow-chart" role="img" aria-label="Order flow by operational stage">
    <div className="ad-flow-track">{stageMeta.map(([key, label, Icon, color]) => <span key={key} title={`${label}: ${counts[key] || 0}`} style={{ width: `${((counts[key] || 0) / total) * 100}%`, background: color }} />)}</div>
    <div className="ad-flow-legend">{stageMeta.map(([key, label, Icon, color]) => <div key={key}><span style={{ color, background: `${color}18` }}><Icon size={16} /></span><b>{counts[key] || 0}</b><small>{label}</small></div>)}</div>
    {counts.overdue > 0 && <div className="ad-overdue-note"><AlertTriangle size={15} /><b>{counts.overdue} overdue</b><span>Scheduled time has passed</span></div>}
  </div>
}

function SalesLineChart({ points }) {
  const [activeIndex, setActiveIndex] = useState(points.length - 1)
  const width = 760, height = 250, inset = { left: 8, right: 8, top: 18, bottom: 30 }
  const max = Math.max(1, ...points.map((point) => point.total))
  const x = (index) => inset.left + (index / Math.max(1, points.length - 1)) * (width - inset.left - inset.right)
  const y = (value) => inset.top + (1 - value / max) * (height - inset.top - inset.bottom)
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${x(index)} ${y(point.total)}`).join(' ')
  const area = `${line} L ${x(points.length - 1)} ${height - inset.bottom} L ${x(0)} ${height - inset.bottom} Z`
  const active = points[activeIndex]
  const total = points.reduce((sum, point) => sum + point.total, 0)
  return <div className="ad-sales-chart">
    <div className="ad-chart-summary"><span><b>{money(total)}</b><small>14-day net sales</small></span>{active && <span><b>{money(active.total)}</b><small>{formatShortDate(active.day)}</small></span>}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Fourteen day net sales line chart" preserveAspectRatio="none">
      <defs><linearGradient id="adSalesArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#147d57" stopOpacity=".28" /><stop offset="1" stopColor="#147d57" stopOpacity="0" /></linearGradient></defs>
      {[0, .25, .5, .75, 1].map((step) => <line key={step} x1="0" x2={width} y1={inset.top + step * (height - inset.top - inset.bottom)} y2={inset.top + step * (height - inset.top - inset.bottom)} className="ad-chart-gridline" />)}
      <path d={area} fill="url(#adSalesArea)" />
      <path d={line} className="ad-sales-line" vectorEffect="non-scaling-stroke" />
      {points.map((point, index) => <g key={point.day} className={activeIndex === index ? 'is-active' : ''} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} tabIndex="0" aria-label={`${formatShortDate(point.day)}, ${money(point.total)}`}><circle cx={x(index)} cy={y(point.total)} r={activeIndex === index ? 6 : 3.5} /><rect x={Math.max(0, x(index) - 24)} y="0" width="48" height={height} fill="transparent" /></g>)}
    </svg>
    <div className="ad-chart-axis">{points.filter((_, index) => index % 3 === 0 || index === points.length - 1).map((point) => <span key={point.day}>{formatShortDate(point.day)}</span>)}</div>
  </div>
}

function BreakdownDonut({ data, labels, colors }) {
  const entries = Object.entries(data || {}).sort(([, a], [, b]) => b.count - a.count)
  const [activeKey, setActiveKey] = useState(entries[0]?.[0] || null)
  const total = entries.reduce((sum, [, value]) => sum + value.count, 0)
  const totalRevenue = entries.reduce((sum, [, value]) => sum + value.revenue, 0)
  const selected = entries.find(([key]) => key === activeKey) || entries[0]
  const circumference = 2 * Math.PI * 55
  let offset = 0
  if (!entries.length) return <EmptyState icon={CreditCard} text="No completed payments today." />
  return <div className="ad-donut-wrap">
    <div className="ad-donut-feature">
      <div className="ad-donut-visual">
        <svg viewBox="0 0 160 160" role="img" aria-label="Completed payment methods ranked by number of uses">
          <circle cx="80" cy="80" r="55" fill="none" stroke="var(--mgmt-subtle)" strokeWidth="20" />
          {entries.map(([key, value], index) => {
            const pct = total ? value.count / total : 0
            const dash = pct * circumference
            const segment = <circle key={key} cx="80" cy="80" r="55" fill="none" stroke={colors[index % colors.length]} strokeWidth={activeKey === key ? 25 : 20} strokeOpacity={activeKey && activeKey !== key ? .38 : 1} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" tabIndex="0" onMouseEnter={() => setActiveKey(key)} onFocus={() => setActiveKey(key)}><title>{`${labels[key] || key}: ${value.count} payment${value.count === 1 ? '' : 's'}, ${money(value.revenue)}`}</title></circle>
            offset += dash
            return segment
          })}
        </svg>
        <span><b>{selected?.[1].count || 0}</b><small>{selected ? labels[selected[0]] || selected[0] : 'Payments'}</small></span>
      </div>
      <div className="ad-donut-leading"><span>Most used today</span><b>{labels[entries[0][0]] || entries[0][0]}</b><small>{entries[0][1].count} of {total} completed payments</small></div>
    </div>
    <div className="ad-donut-legend">
      <div className="ad-donut-total"><span><b>{total}</b><small>Completed payments</small></span><strong>{money(totalRevenue)}</strong></div>
      {entries.map(([key, value], index) => {
        const paymentPercentage = total ? (value.count / total) * 100 : 0
        return <button type="button" key={key} className={activeKey === key ? 'is-active' : ''} onMouseEnter={() => setActiveKey(key)} onFocus={() => setActiveKey(key)} aria-label={`${labels[key] || key}, ${value.count} payments, ${paymentPercentage.toFixed(0)} percent`}>
          <i style={{ background: colors[index % colors.length] }} />
          <span><b>{labels[key] || key}</b><small>{value.count} payment{value.count === 1 ? '' : 's'} - {paymentPercentage.toFixed(0)}%</small><em><i style={{ width: `${paymentPercentage}%`, background: colors[index % colors.length] }} /></em></span>
          <strong>{money(value.revenue)}</strong>
        </button>
      })}
    </div>
  </div>
}

function CustomerMixChart({ newCustomers, returningCustomers }) {
  const total = newCustomers + returningCustomers
  const returningPct = total ? (returningCustomers / total) * 100 : 0
  return <div className="ad-customer-mix">
    <div className="ad-mix-ring" style={{ '--mix': `${returningPct * 3.6}deg` }} role="img" aria-label={`${total} customers today: ${returningCustomers} returning and ${newCustomers} new`}><span><b>{total}</b><small>Customers today</small></span></div>
    <div className="ad-mix-breakdown">
      <span><i className="is-returning" /><b>{returningCustomers}</b><small>Returning - {Math.round(returningPct)}%</small></span>
      <span><i className="is-new" /><b>{newCustomers}</b><small>New - {Math.round(100 - returningPct)}%</small></span>
      <p><TrendingUp size={13} /> {returningPct ? `${Math.round(returningPct)}% of today's customers are returning` : 'No returning customers yet today'}</p>
    </div>
  </div>
}

function RankedProducts({ products }) {
  const max = Math.max(1, ...products.map((item) => item.qty))
  return <div className="ad-ranked-list">{products.length ? products.map((item, index) => <div key={item.name}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{item.name}</b><small>{item.qty} sold - {money(item.revenue)}</small><i><em style={{ width: `${(item.qty / max) * 100}%` }} /></i></div></div>) : <EmptyState icon={Coffee} text="No completed product sales yet." />}</div>
}

function HorizontalBreakdown({ data, labels }) {
  const entries = Object.entries(data).filter(([, value]) => value > 0).sort(([, a], [, b]) => b - a)
  const max = Math.max(1, ...entries.map(([, value]) => value))
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  return <div className="ad-horizontal-bars" role="img" aria-label="Order count by fulfillment channel">{entries.length ? entries.map(([key, value]) => <div key={key}><span><b>{labels[key] || key}</b><small>{total ? `${((value / total) * 100).toFixed(0)}%` : '0%'}</small></span><i><em style={{ width: `${(value / max) * 100}%` }} /></i><strong>{value}</strong></div>) : <EmptyState icon={ReceiptText} text="No orders have been recorded today." />}</div>
}

function EmptyState({ icon: Icon, text }) {
  return <div className="ad-empty"><Icon size={20} /><span>{text}</span></div>
}

function DashboardSkeleton() {
  return <div className="ad-skeleton" aria-label="Loading dashboard"><i className="wide" /><div>{Array.from({ length: 6 }).map((_, index) => <i key={index} />)}</div><div>{Array.from({ length: 4 }).map((_, index) => <i key={index} />)}</div><i className="tall" /><i className="tall" /></div>
}
