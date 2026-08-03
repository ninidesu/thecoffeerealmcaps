import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, Ban, Banknote, Box, Boxes, Calendar, Check,
  Clock, CreditCard, PhilippinePeso, ShoppingBag, TrendingDown, TrendingUp, UserPlus, Users,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { supabase } from '../lib/supabase'
import { fetchDashboardData, computeDashboardMetrics } from '../services/adminDashboardService'

const FULFILLMENT_LABEL = { delivery: 'Delivery', pickup: 'Pickup', 'walk-in': 'Dine-in' }
const FULFILLMENT_COLOR = { delivery: '#1b2f22', pickup: '#4f7cff', 'walk-in': '#9b8cf2' }
const FULFILLMENT_HOVER_COLOR = { delivery: '#2f5c46', pickup: '#2f6ff2', 'walk-in': '#8167ef' }
const PAYMENT_LABEL = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank Transfer', cod: 'Cash on Delivery', other: 'Other' }
const PAYMENT_ICON = { cash: Banknote, gcash: CreditCard, bank_transfer: CreditCard, cod: Box, other: CreditCard }
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function useCountUp(value, duration = 700) {
  const [display, setDisplay] = useState(0)
  const frame = useRef(null)
  useEffect(() => {
    if (prefersReducedMotion()) { setDisplay(value); return }
    const start = performance.now()
    const from = display
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from + (value - from) * eased)
      if (progress < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    const settle = setTimeout(() => setDisplay(value), duration + 60)
    return () => { cancelAnimationFrame(frame.current); clearTimeout(settle) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration])
  return display
}
function AnimatedValue({ value, format }) {
  const animated = useCountUp(value)
  return <>{format ? format(animated) : Math.round(animated)}</>
}

export default function AdminDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [profile, setProfile] = useState(null)

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: sessionData }) => {
      const userId = sessionData.session?.user?.id
      if (!userId) return
      const { data: p } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
      setProfile(p)
    })
  }, [])

  const load = async () => {
    try {
      const raw = await fetchDashboardData()
      setData(raw)
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load dashboard data.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const channel = supabase
      .channel('admin-dashboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refunds' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_stock' }, () => load())
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const metrics = useMemo(() => data && computeDashboardMetrics(data), [data])
  const hour = now.getHours()
  const greeting = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'

  return (
    <AppShell role="admin" title="Dashboard" eyebrow={`Good ${greeting}, ${profile?.full_name || 'Admin'}! Here's what's happening at your café today. ☕`} actions={
      <div className="dash-header-actions">
        <div className="dash-pill"><Calendar size={14} /><span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(now)}</span></div>
        <div className="dash-pill"><Clock size={14} /><span>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)} PHT</span></div>
      </div>
    }>
      {error && <p className="form-error">{error}</p>}

      {loading || !metrics ? <DashboardSkeleton /> : (
        <div className="dash-fade-in">
          <section className="metrics dash-kpi-row">
            <KpiCard icon={PhilippinePeso} label="Total Sales" value={<AnimatedValue value={metrics.totalSales} format={money} />}
              detail={metrics.salesChangePct !== 0 ? <span className={metrics.salesChangePct >= 0 ? 'dash-trend-up' : 'dash-trend-down'}>{metrics.salesChangePct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {Math.abs(Math.round(metrics.salesChangePct))}% vs yesterday</span> : 'Same as yesterday'} />
            <KpiCard icon={ShoppingBag} label="Total Orders" value={<AnimatedValue value={metrics.totalOrders} />} detail="Non-cancelled orders" tone="cream" />
            <KpiCard icon={Users} label="Total Customers" value={<AnimatedValue value={metrics.totalCustomers} />} detail="Registered accounts" tone="blue" />
            <KpiCard icon={CreditCard} label="Average Order Value" value={<AnimatedValue value={metrics.avgOrderValue} format={money} />} detail="Per order" />
            <KpiCard icon={Check} label="Completion Rate" value={<><AnimatedValue value={metrics.completionRate} format={(v) => v.toFixed(1)} />%</>} detail="Of all orders" tone="cream" />
          </section>

          <section className="dashboard-grid dash-triple-grid">
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Sales Overview</span><small>Daily revenue trend</small></div><span className="dash-panel-tag">Last 14 Days</span></div>
              <SalesLineChart trend={metrics.salesTrend} />
            </article>

            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Orders by Type</span><small>All orders breakdown</small></div></div>
              <OrdersDoughnut counts={metrics.fulfillmentCounts} />
            </article>

            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Payment Methods</span><small>Revenue by payment type</small></div></div>
              <PaymentMethodsList totals={metrics.paymentTotals} />
            </article>
          </section>

          <section className="dash-alert-row dash-stat-row">
            <StatCard icon={Check} tone="green" label="Completed Orders" value={metrics.completedOrders} sub={`${metrics.totalOrders ? Math.round((metrics.completedOrders / metrics.totalOrders) * 100) : 0}% of total`} />
            <StatCard icon={Ban} tone="red" label="Cancelled Orders" value={metrics.cancelledOrders} sub={`${metrics.totalOrders ? Math.round((metrics.cancelledOrders / metrics.totalOrders) * 100) : 0}% of total`} />
            <StatCard icon={ArrowUpRight} tone="blue" label="Refunded Orders" value={metrics.refundedOrders} sub={metrics.refundedOrders ? money(metrics.refundedAmount) : '0% of total'} />
            <StatCard icon={UserPlus} tone="purple" label="New Customers" value={metrics.newCustomers} sub="Today" />
            <StatCard icon={Users} tone="teal" label="Returning Customers" value={metrics.returningCustomers} sub="Today" />
            <StatCard icon={AlertTriangle} tone="amber" label="Low Stock Items" value={metrics.lowStockItems.length} sub="View now →" href="/admin/inventory" />
          </section>

          <section className="dashboard-grid dash-triple-grid dash-bottom-grid">
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Best Selling Items</span></div><a className="text-link dark" href="/admin/products">View all <ArrowUpRight size={14} /></a></div>
              {metrics.bestSellers.length === 0 ? <EmptyMini text="No sales recorded yet." /> : metrics.bestSellers.map((item, i) => (
                <div className="rank-row dash-rank-row" key={item.name}>
                  <span>{i + 1}</span>
                  <div><strong>{item.name}</strong><small>Qty sold: {item.qty}</small></div>
                  <b>{money(item.revenue)}</b>
                </div>
              ))}
            </article>

            <article className="panel dash-panel dash-recent-orders">
              <div className="panel-head"><div><span>Recent Orders</span></div><a className="text-link dark" href="/admin/transactions">View all <ArrowUpRight size={14} /></a></div>
              {metrics.recentOrders.length === 0 ? <EmptyMini text="No orders yet." /> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Order / ID</th><th>Type</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {metrics.recentOrders.map((o) => (
                        <tr key={o.id} className="dash-table-row">
                          <td><b>#{o.order_number?.split('-').pop()}</b><br /><small>{o.order_number}</small></td>
                          <td>{FULFILLMENT_LABEL[o.order_type] || o.order_type}</td>
                          <td>{o.customer_name || 'Walk-in Customer'}</td>
                          <td>{money(o.final_total)}</td>
                          <td><span className={`status status-${o.status.toLowerCase().replace(/\s+/g, '-')}`}>{o.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>

            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Low Stock Items</span></div><a className="text-link dark" href="/admin/inventory">View all <ArrowUpRight size={14} /></a></div>
              {metrics.lowStockItems.length === 0 ? <EmptyMini text="All stock levels are healthy." /> : metrics.lowStockItems.slice(0, 6).map((item) => (
                <div className="stock-row" key={item.id}>
                  <div><b>{item.name}</b><span>{item.quantity} / {item.min} left</span></div>
                  <div className="progress"><i className={item.quantity <= item.min * 0.5 ? 'low' : ''} style={{ width: `${Math.min(100, (item.quantity / Math.max(item.min, 1)) * 100)}%` }} /></div>
                  <small>{item.min > 0 ? Math.round((item.quantity / item.min) * 100) : 0}%</small>
                </div>
              ))}
            </article>
          </section>
        </div>
      )}
    </AppShell>
  )
}

function KpiCard({ icon: Icon, label, value, detail, tone = 'sage' }) {
  return (
    <article className={`metric-card dash-kpi-card metric-${tone}`}>
      <div className="dash-kpi-top"><div className="metric-icon"><Icon size={18} /></div><span>{label}</span></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  )
}

function StatCard({ icon: Icon, tone, label, value, sub, href }) {
  const Wrapper = href ? 'a' : 'div'
  return (
    <Wrapper className={`dash-stat-card tone-${tone}`} href={href}>
      <div className="dash-stat-top"><div className="dash-stat-icon"><Icon size={17} /></div><b><AnimatedValue value={value} /></b></div>
      <span>{label}</span><small>{sub}</small>
    </Wrapper>
  )
}

function SalesLineChart({ trend }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const max = Math.max(1, ...trend.map((d) => d.total))
  const points = trend.map((d, i) => [((i / Math.max(1, trend.length - 1)) * 600), 170 - (d.total / max) * 150])
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
  const areaPath = `${linePath} L${points[points.length - 1][0]},180 L0,180 Z`
  const hasData = trend.some((d) => d.total > 0)
  if (!hasData) return <EmptyMini text="No completed sales in the last 14 days." />
  const hovered = hoverIndex !== null ? { day: trend[hoverIndex].day, total: trend[hoverIndex].total, x: points[hoverIndex][0], y: points[hoverIndex][1] } : null
  const strokeColor = hovered ? '#2f5c46' : '#1b2f22'
  const fillOpacity = hovered ? '.3' : '.22'
  return (
    <div className={`line-chart dash-line-chart${hovered ? ' is-hovering' : ''}`}>
      <div className="grid-lines" />
      <svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-label="Daily revenue trend">
        {hovered && <line x1={hovered.x} y1="10" x2={hovered.x} y2="180" className="dash-hover-guide" />}
        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={hovered ? '3.5' : '3'} className="dash-sparkline" />
        <path d={areaPath} fill="url(#dashFade)" />
        <defs><linearGradient id="dashFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={strokeColor} stopOpacity={fillOpacity} /><stop offset="1" stopColor={strokeColor} stopOpacity="0" /></linearGradient></defs>
        {points.map((p, i) => (
          <g key={trend[i].day} className={hoverIndex === i ? 'is-active' : ''}>
            <circle cx={p[0]} cy={p[1]} r={hoverIndex === i ? 6 : 4} fill={hoverIndex === i ? strokeColor : '#fff'} stroke={strokeColor} strokeWidth={hoverIndex === i ? 3 : 2} className="dash-chart-dot" />
            <circle
              cx={p[0]}
              cy={p[1]}
              r="14"
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex((h) => (h === i ? null : h))}
              tabIndex={0}
              style={{ cursor: 'pointer' }}
            />
          </g>
        ))}
      </svg>
      {hovered && (
        <div className="dash-chart-tooltip" style={{ left: `${(hovered.x / 600) * 100}%`, top: `${(hovered.y / 180) * 100}%` }}>
          <b>{new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(hovered.day))}</b>
          <span><i /> {money(hovered.total)}</span>
        </div>
      )}
      <div className="chart-labels">{trend.filter((_, i) => i % 2 === 0).map((d) => <span key={d.day}>{new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(d.day))}</span>)}</div>
    </div>
  )
}

function OrdersDoughnut({ counts }) {
  const [hoverKey, setHoverKey] = useState(null)
  const entries = Object.entries(counts)
  const total = entries.reduce((s, [, v]) => s + v, 0)
  const r = 60, c = 2 * Math.PI * r
  let offset = 0
  const segments = total > 0 ? entries.filter(([, value]) => value > 0).map(([key, value]) => {
    const dash = (value / total) * c
    const startAngle = (offset / c) * 360 - 90
    const midAngle = startAngle + ((dash / c) * 360) / 2
    const rad = (midAngle * Math.PI) / 180
    const seg = { key, value, dash, offset, x: 80 + r * Math.cos(rad), y: 80 + r * Math.sin(rad) }
    offset += dash
    return seg
  }) : []
  const hovered = segments.find((s) => s.key === hoverKey)
  return (
    <div className="dash-doughnut-wrap">
      <div className="dash-doughnut-svg-box">
        <svg viewBox="0 0 160 160" className="dash-doughnut">
          <circle cx="80" cy="80" r={r} fill="none" stroke="#eef1ee" strokeWidth="20" />
          {segments.map((s) => (
            <circle
              key={s.key}
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke={hoverKey === s.key ? FULFILLMENT_HOVER_COLOR[s.key] : FULFILLMENT_COLOR[s.key]}
              strokeOpacity={hoverKey && hoverKey !== s.key ? 0.35 : 1}
              strokeWidth={hoverKey === s.key ? 24 : 20}
              strokeDasharray={`${s.dash} ${c - s.dash}`}
              strokeDashoffset={-s.offset}
              transform="rotate(-90 80 80)"
              className={`dash-doughnut-seg${hoverKey === s.key ? ' is-active' : ''}${hoverKey && hoverKey !== s.key ? ' is-muted' : ''}`}
              onMouseEnter={() => setHoverKey(s.key)}
              onMouseLeave={() => setHoverKey((k) => (k === s.key ? null : k))}
              onFocus={() => setHoverKey(s.key)}
              onBlur={() => setHoverKey((k) => (k === s.key ? null : k))}
              tabIndex={0}
              style={{ cursor: 'pointer' }}
            />
          ))}
          <text x="80" y="76" textAnchor="middle" fontSize="26" fontWeight="800" fill="#1b2f22">{total}</text>
          <text x="80" y="96" textAnchor="middle" fontSize="11" fill="#68736b">Total</text>
        </svg>
        {hovered && (
          <div className="dash-chart-tooltip" style={{ left: `${(hovered.x / 160) * 100}%`, top: `${(hovered.y / 160) * 100}%` }}>
            <b>{FULFILLMENT_LABEL[hovered.key]}</b>
            <span><i style={{ background: FULFILLMENT_COLOR[hovered.key] }} /> {hovered.value}</span>
          </div>
        )}
      </div>
      <ul className="dash-doughnut-legend">
        {entries.map(([key, value]) => (
          <li
            key={key}
            className={`${hoverKey === key ? 'is-active' : ''}${hoverKey && hoverKey !== key ? ' is-muted' : ''}`}
            onMouseEnter={() => setHoverKey(key)}
            onMouseLeave={() => setHoverKey((k) => (k === key ? null : k))}
          >
            <i style={{ background: hoverKey === key ? FULFILLMENT_HOVER_COLOR[key] : FULFILLMENT_COLOR[key] }} />
            {FULFILLMENT_LABEL[key]}
            <span>{value} ({total ? Math.round((value / total) * 100) : 0}%)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PaymentMethodsList({ totals }) {
  const entries = Object.entries(totals).sort(([, a], [, b]) => b - a)
  const total = entries.reduce((s, [, v]) => s + v, 0)
  if (entries.length === 0) return <EmptyMini text="No paid transactions yet today." />
  return (
    <>
      <ul className="dash-payment-methods">
        {entries.map(([method, amount]) => {
          const Icon = PAYMENT_ICON[method] || CreditCard
          const pct = total ? (amount / total) * 100 : 0
          return (
            <li key={method}>
              <div className="dash-payment-icon"><Icon size={15} /></div>
              <div className="dash-payment-info"><b>{PAYMENT_LABEL[method] || method}</b><span>{money(amount)}</span></div>
              <div className="dash-payment-bar"><i style={{ width: `${pct}%` }} /></div>
              <span className="dash-payment-pct">{pct.toFixed(1)}%</span>
            </li>
          )
        })}
      </ul>
      <div className="dash-payment-total"><span>Total</span><b>{money(total)}</b></div>
    </>
  )
}

function EmptyMini({ text }) {
  return <div className="dash-empty-mini"><Boxes size={20} /><p>{text}</p></div>
}

function DashboardSkeleton() {
  return (
    <div className="dash-skeleton">
      <div className="metrics dash-kpi-row">{Array.from({ length: 5 }).map((_, i) => <div className="inv-skeleton-row dash-skel-card" key={i} />)}</div>
      <div className="dashboard-grid dash-triple-grid">
        <div className="inv-skeleton-row dash-skel-panel" />
        <div className="inv-skeleton-row dash-skel-panel" />
        <div className="inv-skeleton-row dash-skel-panel" />
      </div>
      <div className="dash-alert-row dash-stat-row">{Array.from({ length: 6 }).map((_, i) => <div className="inv-skeleton-row dash-skel-stat" key={i} />)}</div>
    </div>
  )
}
