import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, CircleDollarSign, Clock3,
  Coffee, PackageCheck, PackageX, ReceiptText, RefreshCw,
  ShoppingBag, Store, TrendingDown, TrendingUp, Users, WalletCards,
} from 'lucide-react'
import { animate, motion, MotionConfig, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
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
import StaffSettingsPage from './StaffSettingsPage'
import { computeDashboardMetrics, fetchDashboardData } from '../services/adminDashboardService'
import { describeError } from '../utils/describeError'
import { money } from '../utils/money'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const adminPageTitles = {
  '/admin': 'Dashboard',
  '/admin/inventory': 'Inventory Monitoring',
  '/admin/transactions': 'Transaction History',
  '/admin/reports': 'Sales',
  '/admin/analytics': 'Analytics',
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

const paymentLabels = { gcash: 'GCash', bank_transfer: 'Bank transfer', cod: 'Cash / COD', cash: 'Cash', other: 'Other' }
const fulfillmentLabels = { delivery: 'Delivery', pickup: 'Pickup', 'walk-in': 'Walk-in' }
const defaultSalesRangeDays = 14
const cardPopDuration = 0.45
const numberCountDuration = 3
const kpiGraphDuration = 4
const salesGraphDuration = kpiGraphDuration
const statusChartDuration = 1.15
const fulfillmentMeta = [
  { key: 'delivery', label: 'Delivery' },
  { key: 'pickup', label: 'Pick Up' },
  { key: 'walk-in', label: 'Walk-In' },
]
const containerVariants = {
  hidden: { opacity: 1 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: 0,
      staggerChildren: 0.04,
    },
  },
}
const itemVariants = {
  hidden: { opacity: 1, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
}
const cardItemVariants = {
  hidden: { opacity: 1, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: cardPopDuration, ease: [0.16, 1, 0.3, 1] },
  },
}
const statusCardVariants = {
  hidden: { opacity: 1, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: cardPopDuration, ease: [0.16, 1, 0.3, 1] },
  },
}
const microContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.04,
      staggerChildren: 0.045,
    },
  },
}
const microItemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
}
const simpleDashboardPanelVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
      delayChildren: 0.1,
      staggerChildren: 0.055,
    },
  },
}
const transactionRowsVariants = {
  hidden: {},
  visible: { transition: { delayChildren: 0.12, staggerChildren: 0.055 } },
}
const transactionRowVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.28, ease: 'easeOut' } },
}
const sparkAreaVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: kpiGraphDuration * 0.8, delay: 0.15 } },
}
const sparkLineVariants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: { pathLength: 1, opacity: 1, transition: { duration: kpiGraphDuration, ease: [0.16, 1, 0.3, 1] } },
}
const sparkDotVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.35, delay: kpiGraphDuration - 0.35 } },
}
const statusSegmentVariants = {
  hidden: ({ offset, circumference }) => ({
    opacity: 0,
    strokeDasharray: `0 ${circumference}`,
    strokeDashoffset: -offset,
  }),
  visible: ({ offset, dash, circumference, index }) => ({
    opacity: 1,
    strokeDasharray: `${dash} ${Math.max(0, circumference - dash)}`,
    strokeDashoffset: -offset,
    transition: {
      opacity: { duration: 0.2, delay: index * 0.08 },
      strokeDasharray: { duration: statusChartDuration, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] },
    },
  }),
}
const MotionLink = motion(Link)

function formatCount(value) {
  return Math.round(value).toLocaleString('en-PH')
}

function formatPercentValue(value) {
  return `${Math.round(value)}%`
}
function percentage(value) {
  if (!Number.isFinite(value)) return '0%'
  return `${Math.abs(value).toFixed(1)}%`
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function timeAgo(value) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (elapsed < 60000) return 'Just now'
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)}m ago`
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)}h ago`
  return formatShortDate(value)
}

function formatTime(value) {
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}

function chartAxisCurrency(value) {
  if (value >= 1000) return `₱${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k`
  return `₱${Math.round(value).toLocaleString('en-PH')}`
}

function chartAxisStep(value) {
  if (value <= 4) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value / 4))
  const normalized = (value / 4) / magnitude
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return factor * magnitude
}

function chartEaseTimelinePosition(progress) {
  const easedProgress = Math.min(1, Math.max(0, progress))
  const parameter = 1 - Math.cbrt(1 - easedProgress)
  const inverse = 1 - parameter
  return 3 * inverse ** 2 * parameter * 0.16 + 3 * inverse * parameter ** 2 * 0.3 + parameter ** 3
}

function smoothSparklineGeometry(points, x, y) {
  if (points.length < 2) return { path: `M ${x(0)} ${y(points[0])}`, pointProgress: [0] }
  let path = `M ${x(0)} ${y(points[0])}`
  const cumulativeLengths = [0]
  let totalLength = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = Math.max(0, index - 1)
    const next = Math.min(points.length - 1, index + 2)
    const currentX = x(index)
    const nextX = x(index + 1)
    const controlOneX = currentX + (nextX - x(previous)) / 6
    const segmentTop = Math.min(y(points[index]), y(points[index + 1]))
    const segmentBottom = Math.max(y(points[index]), y(points[index + 1]))
    const rawControlOneY = y(points[index]) + (y(points[index + 1]) - y(points[previous])) / 6
    const controlOneY = Math.min(segmentBottom, Math.max(segmentTop, rawControlOneY))
    const controlTwoX = nextX - (x(next) - currentX) / 6
    const rawControlTwoY = y(points[index + 1]) - (y(points[next]) - y(points[index])) / 6
    const controlTwoY = Math.min(segmentBottom, Math.max(segmentTop, rawControlTwoY))
    path += ` C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${nextX} ${y(points[index + 1])}`
    let previousX = currentX
    let previousY = y(points[index])
    for (let sample = 1; sample <= 16; sample += 1) {
      const time = sample / 16
      const inverse = 1 - time
      const sampleX = inverse ** 3 * currentX + 3 * inverse ** 2 * time * controlOneX + 3 * inverse * time ** 2 * controlTwoX + time ** 3 * nextX
      const sampleY = inverse ** 3 * y(points[index]) + 3 * inverse ** 2 * time * controlOneY + 3 * inverse * time ** 2 * controlTwoY + time ** 3 * y(points[index + 1])
      totalLength += Math.hypot(sampleX - previousX, sampleY - previousY)
      previousX = sampleX
      previousY = sampleY
    }
    cumulativeLengths.push(totalLength)
  }
  return {
    path,
    pointProgress: cumulativeLengths.map((length) => totalLength ? length / totalLength : 0),
  }
}

function smoothSparklinePath(points, x, y) {
  return smoothSparklineGeometry(points, x, y).path
}

export default function AdminDashboard() {
  const { pathname } = useLocation()
  if (pathname === '/admin/team') return <Navigate to="/admin/users-access/users" replace />
  if (pathname === '/admin/logs') return <Navigate to="/admin/users-access/activity" replace />
  if (pathname === '/admin/users-access') return <Navigate to="/admin/users-access/users" replace />
  if (pathname === '/admin/users-access/approvals') return <Navigate to="/admin/users-access/users" replace />
  if (pathname.startsWith('/admin/users-access/')) return <UsersAccessPage />
  if (pathname === '/admin/content') return <ContentManagementPage />
  if (pathname === '/admin/settings') return <SystemSettingsPage />
  if (pathname === '/admin/preferences') return <StaffSettingsPage role="admin" />
  if (pathname === '/admin/inventory') return <AdminInventoryPage />
  if (pathname === '/admin/inventory-report') return <InventoryReportPage />
  if (pathname === '/admin/transactions') return <TransactionsPage />
  if (pathname === '/admin/reports' || pathname === '/admin/analytics' || pathname === '/admin/products' || pathname === '/admin/trends') return <SalesReportPage />
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
    ;['orders', 'payments', 'refunds', 'inventory_stock', 'menu_items'].forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
    })
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const attentionCount = metrics ? metrics.attentionOrders.length + metrics.pendingRefunds.length + metrics.outOfStockItems.length + metrics.criticalAuditEvents.length : 0

  return <AppShell
    role="admin"
    title="Dashboard"
    eyebrow="Real-time overview of your store performance and operations."
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
    { label: 'Low Stock Items', value: metrics.lowStockItems.length, detail: `${metrics.lowStockItems.length} items running low`, icon: PackageX, tone: 'rose', to: '/admin/inventory' },
    { label: 'Pending Issues', value: metrics.attentionOrders.length + metrics.pendingRefunds.length, detail: `${metrics.attentionOrders.length + metrics.pendingRefunds.length} items need review`, icon: Clock3, tone: 'amber', to: '/admin/cancellations' },
  ]

  const quickLinks = [
    { label: 'Transactions', detail: 'View all transactions', icon: ReceiptText, to: '/admin/transactions' },
    { label: 'Sales Report', detail: 'View sales performance', icon: CircleDollarSign, to: '/admin/reports' },
    { label: 'Inventory', detail: 'Check inventory levels', icon: PackageCheck, to: '/admin/inventory' },
  ]

  return <MotionConfig reducedMotion="user">
  <motion.div className="ad-dashboard ad-dashboard-v2 dash-fade-in" variants={containerVariants} initial="hidden" animate="visible">
    <motion.section className="ad-welcome-section" aria-labelledby="welcome-heading" variants={itemVariants}>
      <div className="ad-welcome-card">
        <span className="ad-welcome-icon" aria-hidden="true"><Store size={28} /></span>
        <div className="ad-welcome-copy">
          <span className="ad-welcome-kicker">Store operations</span>
          <h2 id="welcome-heading">Welcome back, Admin!</h2>
          <p>Keep today’s sales and operations moving from one place.</p>
        </div>
        <motion.nav className="ad-quick-nav" aria-label="Dashboard shortcuts" variants={microContainerVariants}>
          {quickLinks.map(({ label, detail, icon: Icon, to }) => <MotionLink to={to} key={label} variants={microItemVariants}>
            <span className="ad-quick-icon" aria-hidden="true"><Icon size={19} /></span>
            <span className="ad-quick-copy"><b>{label}</b><small>{detail}</small></span>
            <ArrowRight size={13} aria-hidden="true" />
          </MotionLink>)}
        </motion.nav>
      </div>
    </motion.section>

    <motion.section className="ad-kpi-section" aria-labelledby="today-heading" variants={itemVariants}>
      <h2 className="sr-only" id="today-heading">Today's overview</h2>
      <motion.div className="ad-kpi-grid ad-reference-kpis" variants={microContainerVariants}>
        <KpiCard icon={CircleDollarSign} label="Net sales" value={metrics.totalSales} valueFormat={money} comparison={metrics.salesChangePct} detail="vs yesterday" tone="green" trend={metrics.salesTrend} trendLabel="Net sales trend for the last 14 days" />
        <KpiCard icon={ShoppingBag} label="Orders" value={metrics.totalOrders} valueFormat={formatCount} detail={`${metrics.completedOrders} completed`} tone="cream" trend={metrics.ordersTrend} trendLabel="Orders trend for the last 14 days" />
        <KpiCard icon={WalletCards} label="Average order" value={metrics.avgOrderValue} valueFormat={money} detail="Paid completed orders" tone="blue" trend={metrics.averageOrderTrend} trendLabel="Average order trend for the last 14 days" />
      </motion.div>
    </motion.section>

    <motion.section className="ad-dashboard-analytics-row" aria-label="Sales and fulfillment overview" variants={itemVariants}>
      <Panel title="Sales overview" detail="Net sales over the selected period" action={<Link to="/admin/analytics">Explore analytics <ArrowRight size={15} /></Link>} className="ad-v2-sales-panel">
        <SalesLineChart points={metrics.salesTrend} comparison={metrics.salesChangePct} />
      </Panel>
      <Panel title="Fulfillment orders" detail="How customers receive their orders" action={<Link to="/admin/transactions">View all orders <ArrowRight size={15} /></Link>} className="ad-status-panel ad-fulfillment-panel" motionVariants={statusCardVariants}>
        <FulfillmentOrdersChart counts={metrics.fulfillmentCounts} />
      </Panel>
    </motion.section>

    <motion.section className="ad-dashboard-operations-row" aria-label="Today's performance and items needing attention" variants={itemVariants}>
      <PerformanceSnapshot metrics={metrics} />
      <OperationalQueue items={actionCards} />
    </motion.section>

    <RecentTransactions orders={metrics.recentOrders} />

    <motion.section className="ad-dashboard-secondary-grid" aria-label="Additional dashboard summaries" variants={itemVariants}>
      <LowStockAlerts items={metrics.lowStockItems} />
      <Panel title="Top selling items" detail="Last 14 days" action={<Link to="/admin/analytics">View all <ArrowRight size={14} /></Link>} className="ad-rail-panel ad-rail-sellers">
        <RankedProducts products={metrics.bestSellers} />
      </Panel>
      <RecentActivity events={metrics.auditEvents} />
    </motion.section>
  </motion.div>
  </MotionConfig>
}

function PerformanceSnapshot({ metrics }) {
  const up = metrics.salesChangePct >= 0
  const customersToday = metrics.newCustomers + metrics.returningCustomers
  return <Panel title="Today's Performance" detail="Live store health" className="ad-rail-panel ad-performance-panel" motionVariants={simpleDashboardPanelVariants}>
    <motion.div className="ad-performance-value" variants={microItemVariants}><span className="ad-performance-label is-green"><CircleDollarSign size={12} />Net sales</span><strong><AnimatedMetric value={metrics.totalSales} format={money} /></strong><small className={up ? 'is-up' : 'is-down'}>{up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{percentage(metrics.salesChangePct)} <em>vs yesterday</em></small></motion.div>
    <motion.div className="ad-performance-grid" variants={microContainerVariants}>
      <motion.span variants={microItemVariants}><span className="ad-performance-label is-amber"><ShoppingBag size={12} />Orders today</span><b><AnimatedMetric value={metrics.totalOrders} format={formatCount} /></b><small>{metrics.completedOrders} completed</small></motion.span>
      <motion.span variants={microItemVariants}><span className="ad-performance-label is-green"><CheckCircle2 size={12} />Completion</span><b><AnimatedMetric value={metrics.completionRate} format={formatPercentValue} /></b><small>{metrics.completedOrders} completed</small></motion.span>
      <motion.span variants={microItemVariants}><span className="ad-performance-label is-blue"><Users size={12} />Active customers</span><b><AnimatedMetric value={customersToday} format={formatCount} /></b><small>New + {metrics.returningCustomers}</small></motion.span>
      <motion.span variants={microItemVariants}><span className="ad-performance-label is-blue"><WalletCards size={12} />Average order</span><b><AnimatedMetric value={metrics.avgOrderValue} format={money} /></b><small>Paid completed orders</small></motion.span>
    </motion.div>
    <motion.div className={`ad-performance-store is-${metrics.storeStatus}`} variants={microItemVariants}><span><span className="ad-performance-label is-green"><Store size={12} />Store status</span><b>{metrics.storeStatus === 'closed' ? 'Paused' : 'Open'}</b><small>{metrics.storeStatus === 'closed' ? 'Ordering paused' : 'Accepting orders'}</small></span></motion.div>
  </Panel>
}

function OperationalQueue({ items }) {
  return <Panel title="Needs attention" detail="Priority operational queue" action={<Link to="/admin/transactions">View all <ArrowRight size={14} /></Link>} className="ad-rail-panel ad-queue-panel" motionVariants={simpleDashboardPanelVariants}>
    <motion.div className="ad-queue-list" variants={microContainerVariants}>{items.map(({ icon: Icon, ...item }) => <MotionLink className={`is-${item.tone}`} to={item.to} key={item.label} variants={microItemVariants}>
      <span><Icon size={16} /></span><div><b>{item.label}</b><small>{item.detail}</small></div><strong>{item.value}</strong>
    </MotionLink>)}</motion.div>
  </Panel>
}

function LowStockAlerts({ items }) {
  return <Panel title="Low-stock alerts" detail="Inventory below its alert level" action={<Link to="/admin/inventory">View all <ArrowRight size={14} /></Link>} className="ad-rail-panel ad-low-stock-panel">
    <motion.div className="ad-low-stock-list" variants={microContainerVariants}>{items.slice(0, 4).map((item) => {
      const out = item.quantity <= 0
      return <MotionLink to="/admin/inventory" key={item.id} variants={microItemVariants}><span className={out ? 'is-out' : ''}><PackageX size={16} /></span><div><b>{item.name}</b><small>{item.quantity} {item.unit} left</small></div><em className={out ? 'is-out' : ''}>{out ? 'Out' : 'Low'}</em></MotionLink>
    })}{!items.length && <EmptyState icon={PackageCheck} text="Inventory levels are healthy." />}</motion.div>
  </Panel>
}

function RecentActivity({ events }) {
  return <Panel title="Recent activity" detail="Latest administrative changes" action={<Link to="/admin/users-access/activity">View all <ArrowRight size={14} /></Link>} className="ad-rail-panel ad-activity-panel">
    <motion.div className="ad-activity-list" variants={microContainerVariants}>{events.slice(0, 4).map((event) => <motion.div key={event.id} variants={microItemVariants}><i className={`is-${event.severity || event.result}`} /><span><b>{event.summary || 'System activity recorded'}</b><small>{event.actor_name_snapshot || 'System'} - {timeAgo(event.occurred_at)}</small></span><em>{(event.module || 'System').replaceAll('_', ' ')}</em></motion.div>)}{!events.length && <EmptyState icon={Activity} text="No recent administrative activity." />}</motion.div>
  </Panel>
}

function RecentTransactions({ orders }) {
  return <Panel title="Recent Transactions" detail="Latest orders across supported sales channels" action={<Link to="/admin/transactions">View all transactions <ArrowRight size={15} /></Link>} className="ad-transactions-panel" motionVariants={simpleDashboardPanelVariants}>
    <div className="ad-transactions-scroll">
      <table className="ad-transactions-table">
        <thead><tr><th>Transaction</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Status</th><th>Time</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <motion.tbody variants={transactionRowsVariants}>{orders.map((order) => {
          const items = order.order_items || []
          const itemLabel = items.length ? items.slice(0, 2).map((item) => item.display_name || item.item_name).join(', ') : 'No item details'
          const statusSlug = order.is_voided ? 'voided' : order.status.toLowerCase().replaceAll(' ', '-')
          return <motion.tr key={order.id} variants={transactionRowVariants}>
            <td><b>{order.order_number}</b><small>{fulfillmentLabels[order.order_type] || order.order_type}</small></td>
            <td>{order.customer_name || 'Walk-in customer'}</td>
            <td><span title={items.map((item) => item.display_name || item.item_name).join(', ')}>{itemLabel}{items.length > 2 ? ` +${items.length - 2}` : ''}</span></td>
            <td>{paymentLabels[order.payments?.[0]?.method] || 'Not recorded'}</td>
            <td><b>{money(order.final_total)}</b></td>
            <td><span className={`ad-order-status is-${statusSlug}`}>{order.is_voided ? 'Voided' : order.status}</span></td>
            <td><time dateTime={order.created_at}>{formatTime(order.created_at)}</time></td>
            <td><Link to="/admin/transactions" aria-label={`View transaction ${order.order_number}`}>View <ArrowRight size={14} /></Link></td>
          </motion.tr>
        })}</motion.tbody>
      </table>
      {!orders.length && <EmptyState icon={ReceiptText} text="No recent transactions are available." />}
    </div>
  </Panel>
}

function Panel({ title, detail, action, className = '', motionVariants = cardItemVariants, children }) {
  const PanelElement = motionVariants ? motion.article : 'article'
  const motionProps = motionVariants ? { variants: motionVariants } : {}
  return <PanelElement className={`ad-panel ${className}`} {...motionProps}><header><div><h2>{title}</h2><p>{detail}</p></div>{action}</header><div className="ad-panel-body">{children}</div></PanelElement>
}

function KpiCard({ icon: Icon, label, value, valueFormat = formatCount, comparison, detail, tone, trend, trendLabel }) {
  const up = comparison >= 0
  return <motion.article className={`ad-kpi-card is-${tone}`} variants={cardItemVariants}><div className="ad-kpi-top"><span><Icon size={19} /></span><small>{label}</small></div><strong><AnimatedMetric value={value} format={valueFormat} duration={numberCountDuration} /></strong><footer>{comparison !== undefined && <span className={up ? 'is-up' : 'is-down'}>{up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{percentage(comparison)}</span>}<small>{detail}</small></footer>{trend?.length > 1 && <MiniTrend values={trend.map((point) => point.total)} tone={tone} label={trendLabel || `${label} trend`} />}</motion.article>
}

function AnimatedMetric({ value, format = formatCount, duration = 0.7 }) {
  const target = Number.isFinite(Number(value)) ? Number(value) : 0
  const reducedMotion = useReducedMotion()
  const motionValue = useMotionValue(0)
  const displayValue = useTransform(motionValue, (latest) => format(latest))

  useEffect(() => {
    const controls = animate(motionValue, target, {
      duration: reducedMotion ? 0 : duration,
      ease: [0.16, 1, 0.3, 1],
    })
    return () => controls.stop()
  }, [duration, motionValue, reducedMotion, target])

  return <motion.span>{displayValue}</motion.span>
}

function MiniTrend({ values = [], tone, label }) {
  const safeValues = values.filter((value) => Number.isFinite(value))
  const points = safeValues.length > 1 ? safeValues : [0, 0]
  const width = 180, height = 64, inset = { left: 3, right: 3, top: 8, bottom: 8 }
  const min = Math.min(...points)
  const max = Math.max(...points)
  const spread = max - min || Math.max(Math.abs(max) * .2, 1)
  const floor = min - (spread - (max - min)) / 2
  const x = (index) => inset.left + (index / Math.max(1, points.length - 1)) * (width - inset.left - inset.right)
  const y = (value) => inset.top + (1 - (value - floor) / spread) * (height - inset.top - inset.bottom)
  const line = smoothSparklinePath(points, x, y)
  const area = `${line} L ${x(points.length - 1)} ${height - inset.bottom} L ${x(0)} ${height - inset.bottom} Z`
  const gradientId = `ad-spark-${tone}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return <svg className={`ad-kpi-sparkline is-${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".25" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    <motion.path className="ad-kpi-spark-area" d={area} fill={`url(#${gradientId})`} variants={sparkAreaVariants} />
    <motion.path className="ad-kpi-spark-line" d={line} vectorEffect="non-scaling-stroke" variants={sparkLineVariants} />
    <motion.circle className="ad-kpi-spark-dot" cx={x(points.length - 1)} cy={y(points[points.length - 1])} r="3.5" variants={sparkDotVariants} />
  </svg>
}

function FulfillmentOrdersChart({ counts }) {
  const entries = fulfillmentMeta.map((item) => ({ ...item, value: counts[item.key] || 0 }))
  const [activeKey, setActiveKey] = useState(null)
  const activeEntry = entries.find((item) => item.key === activeKey)
  const total = entries.reduce((sum, item) => sum + item.value, 0)
  const circumference = 2 * Math.PI * 54
  let offset = 0
  return <motion.div className="ad-status-chart" variants={microContainerVariants}>
    <div className="ad-status-visual">
      <svg viewBox="0 0 140 140" role="img" aria-labelledby="ad-fulfillment-title">
        <title id="ad-fulfillment-title">{`${total} orders today by fulfillment method`}</title>
        <circle className="ad-status-track" cx="70" cy="70" r="54" fill="none" strokeWidth="18" />
        <g transform="rotate(-90 70 70)">{entries.map((item, index) => {
          const dash = total ? (item.value / total) * circumference : 0
          const segmentOffset = offset
          const segment = <motion.circle className={`ad-status-segment is-${item.key}${activeKey === item.key ? ' is-active' : ''}${activeKey && activeKey !== item.key ? ' is-muted' : ''}`} key={item.key} cx="70" cy="70" r="54" fill="none" strokeWidth="18" strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-segmentOffset} variants={statusSegmentVariants} custom={{ offset: segmentOffset, dash, circumference, index }} tabIndex={item.value ? 0 : -1} aria-label={`${item.label}: ${item.value} order${item.value === 1 ? '' : 's'}`} onMouseEnter={() => setActiveKey(item.key)} onMouseLeave={() => setActiveKey(null)} onFocus={() => setActiveKey(item.key)} onBlur={() => setActiveKey(null)}><title>{`${item.label}: ${item.value}`}</title></motion.circle>
          offset += dash
          return segment
        })}</g>
      </svg>
      <span><b>{activeEntry ? formatCount(activeEntry.value) : <AnimatedMetric value={total} />}</b><small>{activeEntry?.label || 'Total orders'}</small></span>
    </div>
    <motion.div className="ad-status-legend" variants={microContainerVariants}>{entries.map((item) => { const share = total ? `${((item.value / total) * 100).toFixed(0)}%` : '0%'; return <motion.div className={activeKey === item.key ? 'is-active' : ''} key={item.key} variants={microItemVariants} onMouseEnter={() => setActiveKey(item.key)} onMouseLeave={() => setActiveKey(null)}><i className={`is-${item.key}`} /><span><b>{item.label}</b></span><em>{share}</em><strong>{formatCount(item.value)}</strong></motion.div> })}</motion.div>
    <motion.div className="ad-status-summary" variants={microContainerVariants}>{entries.map((item) => <motion.span key={item.key} variants={microItemVariants}><b>{formatCount(item.value)}</b><small>{item.label}</small></motion.span>)}</motion.div>
  </motion.div>
}

function SalesLineChart({ points, comparison }) {
  const reducedMotion = useReducedMotion()
  const [range, setRange] = useState(defaultSalesRangeDays)
  const visiblePoints = points.slice(-range)
  const [activeIndex, setActiveIndex] = useState(null)
  useEffect(() => setActiveIndex(null), [range, visiblePoints.length])
  const width = 760, height = 176, inset = { left: 46, right: 30, top: 38, bottom: 22 }
  const max = Math.max(1, ...visiblePoints.map((point) => point.total))
  const axisMax = chartAxisStep(max) * 4
  const plotHeight = height - inset.top - inset.bottom
  const x = (index) => inset.left + (index / Math.max(1, visiblePoints.length - 1)) * (width - inset.left - inset.right)
  const y = (value) => inset.top + (1 - value / axisMax) * plotHeight
  const lineGeometry = smoothSparklineGeometry(visiblePoints.map((point) => point.total), x, y)
  const line = lineGeometry.path
  const area = `${line} L ${x(visiblePoints.length - 1)} ${height - inset.bottom} L ${x(0)} ${height - inset.bottom} Z`
  const active = visiblePoints[activeIndex ?? visiblePoints.length - 1]
  const total = visiblePoints.reduce((sum, point) => sum + point.total, 0)
  return <motion.div className="ad-sales-chart" variants={microContainerVariants}>
    <div className="ad-chart-summary"><span><b><AnimatedMetric value={total} format={money} duration={numberCountDuration} /></b><small>{range}-day net sales <em className={comparison >= 0 ? 'is-up' : 'is-down'}>{comparison >= 0 ? '+' : '-'}{percentage(comparison)} today</em></small></span>{active && <span><motion.b key={active.day} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}>{money(active.total)}</motion.b><small>{formatShortDate(active.day)}</small></span>}<label><span>Period</span><select value={range} onChange={(event) => setRange(Number(event.target.value))}><option value="7">Last 7 days</option><option value="14">Last 14 days</option></select></label></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${range}-day net sales line chart`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="adSalesArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--mgmt-primary)" stopOpacity=".28" /><stop offset="1" stopColor="var(--mgmt-primary)" stopOpacity="0" /></linearGradient>
        <clipPath id="adSalesRevealClip"><rect key={`clip-${range}-${visiblePoints.map((point) => point.total).join('-')}`} className="ad-sales-line-clip" x={inset.left - 6} y="0" width={width - inset.left - inset.right + 12} height={height} style={{ animationDuration: `${salesGraphDuration}s` }} /></clipPath>
      </defs>
      {[0, .25, .5, .75, 1].map((step) => <g key={step}><line x1={inset.left} x2={width - inset.right} y1={inset.top + step * plotHeight} y2={inset.top + step * plotHeight} className="ad-chart-gridline" /><text x="0" y={inset.top + step * plotHeight + 3} className="ad-chart-y-label">{chartAxisCurrency(axisMax * (1 - step))}</text></g>)}
      <path d={area} fill="url(#adSalesArea)" clipPath="url(#adSalesRevealClip)" />
      <path d={line} className="ad-sales-line" clipPath="url(#adSalesRevealClip)" vectorEffect="non-scaling-stroke" />
      {visiblePoints.map((point, index) => {
        const pointX = x(index)
        const pointY = y(point.total)
        const tooltipWidth = 104
        const tooltipHeight = 32
        const tooltipX = Math.min(width - inset.right - tooltipWidth, Math.max(inset.left, pointX - tooltipWidth / 2))
        const tooltipY = pointY - tooltipHeight - 10 >= 2 ? pointY - tooltipHeight - 10 : pointY + 10
        const isActive = activeIndex === index
        return <g key={`${range}-${point.day}-${point.total}`} className={isActive ? 'is-active' : ''} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} tabIndex="0" aria-label={`${formatShortDate(point.day)}, ${money(point.total)}`}>
          <rect className="ad-chart-point-hit-area" x={Math.max(0, pointX - 24)} y="0" width="48" height={height} fill="transparent" />
          <circle className="ad-sales-point" cx={pointX} cy={pointY} r={isActive ? 6 : 3.5} style={{ animationDelay: `${chartEaseTimelinePosition(index / Math.max(1, visiblePoints.length - 1)) * salesGraphDuration}s` }} />
          {isActive && <motion.g className="ad-chart-point-tooltip" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }} aria-hidden="true">
            <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="7" />
            <text x={tooltipX + tooltipWidth / 2} y={tooltipY + 13} className="ad-chart-tooltip-value">{money(point.total)}</text>
            <text x={tooltipX + tooltipWidth / 2} y={tooltipY + 25} className="ad-chart-tooltip-date">{formatShortDate(point.day)}</text>
          </motion.g>}
        </g>
      })}
    </svg>
    <div className="ad-chart-axis" aria-label={`${range}-day date axis`}>{visiblePoints.map((point) => <span key={point.day}>{formatShortDate(point.day)}</span>)}</div>
  </motion.div>
}

function RankedProducts({ products }) {
  const max = Math.max(1, ...products.map((item) => item.qty))
  return <motion.div className="ad-ranked-list" variants={microContainerVariants}>{products.length ? products.map((item, index) => <motion.div key={item.name} variants={microItemVariants}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{item.name}</b><small>{item.qty} sold - {money(item.revenue)}</small><i><em style={{ width: `${(item.qty / max) * 100}%` }} /></i></div></motion.div>) : <EmptyState icon={Coffee} text="No completed product sales yet." />}</motion.div>
}

function EmptyState({ icon: Icon, text }) {
  return <div className="ad-empty"><Icon size={20} /><span>{text}</span></div>
}

function DashboardSkeleton() {
  return <div className="ad-skeleton" aria-label="Loading dashboard"><i className="wide" /><div>{Array.from({ length: 4 }).map((_, index) => <i key={index} />)}</div><div>{Array.from({ length: 3 }).map((_, index) => <i key={index} />)}</div><i className="tall" /><i className="tall" /></div>
}
