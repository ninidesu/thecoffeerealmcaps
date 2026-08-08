import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowUp, Ban, Boxes, Check, ChevronDown, Clock3, Coffee, CupSoda,
  Download, Eye, FileText, PhilippinePeso, Printer, RefreshCw, Search, ShoppingBag,
  TrendingDown, TrendingUp, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { getCurrentPortalSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  applyLocalFilters, buildTrend, computeSalesReport, exportSalesReportCsv,
  fetchSalesReportData, ORDER_TYPE_LABEL, PAYMENT_LABEL, printSalesReportPdf, statusBucket,
} from '../services/salesReportService'

const PERIOD_OPTIONS = [
  ['today', 'Today'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['year', 'This Year'],
  ['custom', 'Custom'],
]

const STATUS_META = {
  completed: { label: 'Completed', color: '#2f5c46' },
  preparing: { label: 'Preparing', color: '#c8a86b' },
  ready: { label: 'Ready', color: '#4f7cff' },
  cancelled: { label: 'Cancelled', color: '#a33b35' },
  refunded: { label: 'Refunded', color: '#9b8cf2' },
  other: { label: 'In Progress', color: '#68736b' },
}

const PAYMENT_COLOR = { cash: '#1b2f22', gcash: '#4f7cff', bank_transfer: '#9b8cf2', cod: '#c8a86b', other: '#68736b' }
const ORDER_TYPE_ICON = { 'walk-in': Coffee, pickup: CupSoda, delivery: ShoppingBag, preorder: Clock3 }

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
  return <>{format ? format(animated) : Math.round(animated).toLocaleString('en-PH')}</>
}

function startOfDay(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); return d }
function endOfDay(date) { const d = new Date(date); d.setHours(23, 59, 59, 999); return d }

function rangeForPeriod(period) {
  const now = new Date()
  if (period === 'today') return { from: startOfDay(now), to: endOfDay(now) }
  if (period === 'week') {
    const start = startOfDay(now)
    start.setDate(start.getDate() - start.getDay())
    return { from: start, to: endOfDay(now) }
  }
  if (period === 'year') return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(now) }
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(now) }
}

function previousRange(from, to) {
  const length = to.getTime() - from.getTime() + 1
  return { prevFrom: new Date(from.getTime() - length), prevTo: new Date(from.getTime() - 1) }
}

function dateInputValue(date) {
  if (!date) return ''
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function defaultGranularity(from, to) {
  const days = (to.getTime() - from.getTime()) / 86400000
  if (days > 92) return 'month'
  if (days > 31) return 'week'
  return 'day'
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value))
}

function buildAppliedFilters(period, fromInput, toInput) {
  let from
  let to
  if (period === 'custom') {
    from = fromInput ? new Date(`${fromInput}T00:00:00`) : startOfDay(new Date())
    to = toInput ? new Date(`${toInput}T23:59:59.999`) : endOfDay(new Date())
    if (from > to) { const swapped = from; from = startOfDay(to); to = endOfDay(swapped) }
  } else {
    const range = rangeForPeriod(period)
    from = range.from
    to = range.to
  }
  const { prevFrom, prevTo } = previousRange(from, to)
  return { period, from, to, prevFrom, prevTo }
}

function periodLabel(applied) {
  const preset = PERIOD_OPTIONS.find(([key]) => key === applied.period)?.[1]
  const fmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  const rangeText = `${fmt.format(applied.from)} – ${fmt.format(applied.to)}`
  return applied.period === 'custom' ? rangeText : `${preset} (${rangeText})`
}

function statusChipTone(order) {
  const bucket = statusBucket(order)
  if (bucket === 'completed') return 'completed'
  if (bucket === 'cancelled') return 'cancelled'
  if (bucket === 'refunded') return 'attention'
  if (bucket === 'preparing') return 'preparing'
  if (bucket === 'ready') return 'pickup'
  return 'neutral'
}

function orderStatusLabel(order) {
  if (order.isVoided) return 'Voided'
  return order.status
}

export default function SalesReportPage() {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [lastUpdated, setLastUpdated] = useState(null)
  const [profile, setProfile] = useState(null)
  const [toasts, setToasts] = useState([])

  // Draft filters (edited freely) vs applied filters (drive the data).
  const [draftPeriod, setDraftPeriod] = useState('month')
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  const [draftOrderType, setDraftOrderType] = useState('all')
  const [draftPayment, setDraftPayment] = useState('all')
  const [applied, setApplied] = useState(() => ({ ...buildAppliedFilters('month'), orderType: 'all', paymentMethod: 'all' }))

  const [granularity, setGranularity] = useState('day')

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState(null)

  const appliedRef = useRef(applied)
  appliedRef.current = applied

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    getCurrentPortalSession().then(({ profile: currentProfile }) => setProfile(currentProfile)).catch(() => {})
    setDraftFrom(dateInputValue(applied.from))
    setDraftTo(dateInputValue(applied.to))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pushToast = (type, message) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, type, message }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200)
  }

  const load = async (filters = appliedRef.current, { silent = false } = {}) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    try {
      const data = await fetchSalesReportData({
        dateFrom: filters.from.toISOString(),
        dateTo: filters.to.toISOString(),
        prevFrom: filters.prevFrom.toISOString(),
        prevTo: filters.prevTo.toISOString(),
      })
      setRaw(data)
      setLastUpdated(new Date())
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load the sales report.'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load(applied) }, [applied])

  useEffect(() => {
    const refresh = () => load(appliedRef.current, { silent: true })
    const channel = supabase
      .channel('sales-report-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refunds' }, refresh)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const applyFilters = () => {
    const next = { ...buildAppliedFilters(draftPeriod, draftFrom, draftTo), orderType: draftOrderType, paymentMethod: draftPayment }
    setApplied(next)
    setGranularity(defaultGranularity(next.from, next.to))
    setPage(1)
    setDraftFrom(dateInputValue(next.from))
    setDraftTo(dateInputValue(next.to))
  }

  const resetFilters = () => {
    setDraftPeriod('month')
    setDraftOrderType('all')
    setDraftPayment('all')
    const next = { ...buildAppliedFilters('month'), orderType: 'all', paymentMethod: 'all' }
    setDraftFrom(dateInputValue(next.from))
    setDraftTo(dateInputValue(next.to))
    setApplied(next)
    setGranularity(defaultGranularity(next.from, next.to))
    setSearch('')
    setPage(1)
  }

  const selectPeriodPreset = (key) => {
    setDraftPeriod(key)
    if (key !== 'custom') {
      const range = rangeForPeriod(key)
      setDraftFrom(dateInputValue(range.from))
      setDraftTo(dateInputValue(range.to))
    }
  }

  const filteredOrders = useMemo(
    () => (raw ? applyLocalFilters(raw.orders, { orderType: applied.orderType, paymentMethod: applied.paymentMethod }) : []),
    [raw, applied.orderType, applied.paymentMethod],
  )
  const filteredPrevious = useMemo(
    () => (raw ? applyLocalFilters(raw.previousOrders, { orderType: applied.orderType, paymentMethod: applied.paymentMethod }) : []),
    [raw, applied.orderType, applied.paymentMethod],
  )

  const report = useMemo(() => computeSalesReport(filteredOrders, filteredPrevious), [filteredOrders, filteredPrevious])
  const trend = useMemo(
    () => buildTrend(filteredOrders, filteredPrevious, { dateFrom: applied.from, dateTo: applied.to, granularity }),
    [filteredOrders, filteredPrevious, applied.from, applied.to, granularity],
  )

  const filterLabel = useMemo(() => {
    const parts = [periodLabel(applied)]
    if (applied.orderType !== 'all') parts.push(ORDER_TYPE_LABEL[applied.orderType])
    if (applied.paymentMethod !== 'all') parts.push(PAYMENT_LABEL[applied.paymentMethod])
    return parts.join(' · ')
  }, [applied])

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = filteredOrders
    if (q) {
      rows = rows.filter((order) =>
        order.orderNumber?.toLowerCase().includes(q)
        || order.receiptNumber?.toLowerCase().includes(q)
        || order.customerName?.toLowerCase().includes(q)
        || order.items.some((item) => item.name.toLowerCase().includes(q)))
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sort.key === 'gross') return (a.subtotal - b.subtotal) * dir
      if (sort.key === 'net') return ((a.netRevenue - a.refundedAmount) - (b.netRevenue - b.refundedAmount)) * dir
      return (new Date(a.createdAt) - new Date(b.createdAt)) * dir
    })
  }, [filteredOrders, search, sort])

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = tableRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  const toggleSort = (key) => {
    setSort((current) => (current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
    setPage(1)
  }

  const runExportCsv = () => {
    const csv = exportSalesReportCsv({ orders: tableRows, summary: report.summary, filterLabel, generatedBy: profile?.full_name || profile?.email })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sales-report-${dateInputValue(applied.from)}-to-${dateInputValue(applied.to)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    pushToast('success', `Exported ${tableRows.length} order${tableRows.length === 1 ? '' : 's'} to CSV.`)
    setExportMenuOpen(false)
  }

  const runExportPdf = () => {
    const ok = printSalesReportPdf({ report, trend, filterLabel, generatedBy: profile?.full_name || profile?.email })
    if (ok) pushToast('success', 'Sales report PDF is ready to print or save.')
    else pushToast('error', 'The report window was blocked by the browser.')
    setExportMenuOpen(false)
  }

  const comparisonHint = applied.period === 'today' ? 'vs yesterday'
    : applied.period === 'week' ? 'vs last week'
      : applied.period === 'month' ? 'vs previous period'
        : applied.period === 'year' ? 'vs last year' : 'vs previous period'

  return (
    <AppShell role="admin" title="Sales Report" eyebrow="Revenue, orders, and product performance for the selected period." actions={
      <div className="ops-header-actions">
        <div className="ops-clock">
          <span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(now)}</span>
          <b>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)} PHT</b>
        </div>
        <button type="button" className="ops-icon-button" aria-label="Refresh report" title="Refresh" onClick={() => load(appliedRef.current, { silent: true })} disabled={loading || refreshing}>
          <RefreshCw size={18} className={loading || refreshing ? 'spin' : ''} />
        </button>
        <div className="inv-overflow">
          <button type="button" className="ops-main-action inv-record-btn" onClick={() => setExportMenuOpen((open) => !open)} disabled={loading || !raw}>
            <Download size={16} /> Export <ChevronDown size={14} />
          </button>
          {exportMenuOpen && (
            <div className="inv-overflow-menu txn-export-menu" role="menu">
              <button type="button" role="menuitem" onClick={runExportPdf}><Printer size={14} /> Export PDF</button>
              <button type="button" role="menuitem" onClick={runExportCsv}><FileText size={14} /> Export CSV</button>
            </div>
          )}
        </div>
      </div>
    }>
      {lastUpdated && (
        <div className="srp-updated-row">
          <span className={`srp-updated ${refreshing ? 'is-refreshing' : ''}`}>
            <i />
            {refreshing ? 'Refreshing…' : `Last updated ${new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(lastUpdated)}`}
          </span>
          <span className="srp-updated-range">{filterLabel}</span>
        </div>
      )}

      {loading && !raw ? <ReportSkeleton /> : error && !raw ? (
        <div className="inv-empty"><AlertTriangle size={28} /><h3>Could not load the sales report</h3><p>{error}</p><button type="button" className="ops-main-action" onClick={() => load()}>Retry</button></div>
      ) : (
        <div className="dash-fade-in">
          {error && <p className="form-error">{error}</p>}
          {raw?.truncated && <p className="form-error">This period exceeds 5,000 orders — figures reflect the first 5,000. Narrow the date range for exact totals.</p>}

          <section className="metrics dash-kpi-row srp-kpi-row">
            <SummaryCard icon={PhilippinePeso} label="Total Revenue" value={<AnimatedValue value={report.summary.netRevenue} format={money} />} pct={report.comparison.revenuePct} hint={comparisonHint} />
            <SummaryCard icon={ShoppingBag} label="Total Orders" value={<AnimatedValue value={report.summary.totalOrders} />} pct={report.comparison.ordersPct} hint={comparisonHint} tone="cream" />
            <SummaryCard icon={Boxes} label="Total Items Sold" value={<AnimatedValue value={report.summary.totalItems} />} pct={report.comparison.itemsPct} hint={comparisonHint} tone="blue" />
            <SummaryCard icon={Ban} label="Cancelled Orders" value={<AnimatedValue value={report.summary.cancelledOrders} />} pct={report.comparison.cancelledPct} hint={comparisonHint} invert />
          </section>

          <section className="panel dash-panel srp-filter-card">
            <div className="srp-filter-grid">
              <label className="field compact"><span>Period</span>
                <select value={draftPeriod} onChange={(event) => selectPeriodPreset(event.target.value)}>
                  {PERIOD_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className="field compact"><span>Date From</span>
                <input type="date" value={draftFrom} max={draftTo || undefined} onChange={(event) => { setDraftFrom(event.target.value); setDraftPeriod('custom') }} />
              </label>
              <label className="field compact"><span>Date To</span>
                <input type="date" value={draftTo} min={draftFrom || undefined} onChange={(event) => { setDraftTo(event.target.value); setDraftPeriod('custom') }} />
              </label>
              <label className="field compact"><span>Order Type</span>
                <select value={draftOrderType} onChange={(event) => setDraftOrderType(event.target.value)}>
                  <option value="all">All types</option>
                  {Object.entries(ORDER_TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label className="field compact"><span>Payment</span>
                <select value={draftPayment} onChange={(event) => setDraftPayment(event.target.value)}>
                  <option value="all">All methods</option>
                  {Object.entries(PAYMENT_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <div className="srp-filter-actions">
                <button type="button" className="primary-button" onClick={applyFilters} disabled={loading}>Apply</button>
                <button type="button" className="secondary-button" onClick={resetFilters}>Reset</button>
              </div>
            </div>
          </section>

          <section className="panel dash-panel srp-trend-panel">
            <div className="panel-head">
              <div><span>Sales Trend</span><small>Net revenue, current vs previous period</small></div>
              <div className="srp-granularity" role="tablist" aria-label="Trend granularity">
                {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([key, label]) => (
                  <button type="button" key={key} className={granularity === key ? 'active' : ''} onClick={() => setGranularity(key)}>{label}</button>
                ))}
              </div>
            </div>
            <TrendChart trend={trend} />
          </section>

          <section className="dashboard-grid dash-triple-grid srp-breakdown-grid">
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Orders by Status</span></div></div>
              <StatusBars ordersByStatus={report.ordersByStatus} />
            </article>
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Payment Methods</span><small>Net revenue share</small></div></div>
              <PaymentDonut totals={report.paymentTotals} />
            </article>
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Order Types</span><small>Non-cancelled orders</small></div></div>
              <OrderTypeBreakdown counts={report.orderTypeCounts} />
            </article>
          </section>

          <section className="panel dash-panel srp-products-panel">
            <div className="panel-head"><div><span>Top-Selling Products</span><small>Ranked by revenue</small></div></div>
            {report.topProducts.length === 0 ? (
              <EmptyMini text="No product sales in the selected range." />
            ) : (
              <div className="inv-table-wrap srp-products-wrap">
                <table className="inv-table srp-products-table">
                  <thead><tr><th>#</th><th>Product</th><th>Category</th><th className="srp-num">Qty Sold</th><th className="srp-num">Revenue</th><th className="srp-share-col">Contribution</th></tr></thead>
                  <tbody>
                    {report.topProducts.map((product, index) => (
                      <tr key={product.name} className="srp-product-row">
                        <td><span className="srp-rank">{index + 1}</span></td>
                        <td><b>{product.name}</b></td>
                        <td>{product.category}</td>
                        <td className="srp-num">{product.qty.toLocaleString('en-PH')}</td>
                        <td className="srp-num"><b>{money(product.revenue)}</b></td>
                        <td><div className="srp-share"><div className="srp-share-bar"><i style={{ width: `${Math.max(2, product.pct)}%` }} /></div><span>{product.pct.toFixed(1)}%</span></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel dash-panel srp-table-panel">
            <div className="panel-head srp-table-head">
              <div className="srp-table-summary"><span>Sales Transactions</span><small>{tableRows.length} order{tableRows.length === 1 ? '' : 's'} in view</small></div>
              <div className="srp-table-tools">
                <div className="srp-table-controls">
                  <label className="menu-manage-search srp-search">
                    <Search size={15} /><span className="sr-only">Search orders</span>
                    <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search order #, customer, product..." />
                    {search && <button type="button" className="menu-manage-search-clear" aria-label="Clear search" onClick={() => { setSearch(''); setPage(1) }}><X size={13} /></button>}
                  </label>
                  <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} aria-label="Rows per page">
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                    <option value={100}>100 / page</option>
                  </select>
                </div>
              </div>
            </div>

            {tableRows.length === 0 ? (
              <div className="inv-empty srp-table-empty">
                <FileText size={26} />
                <h3>No transactions found</h3>
                <p>{search ? 'Try clearing the search.' : 'No orders were recorded in this period.'}</p>
                {search && <button type="button" className="ops-secondary-action" onClick={() => { setSearch(''); setPage(1) }}>Clear search</button>}
              </div>
            ) : (
              <>
                <div className="inv-table-wrap">
                  <table className="inv-table srp-txn-table">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th><SortButton label="Date & Time" active={sort.key === 'date'} dir={sort.dir} onClick={() => toggleSort('date')} /></th>
                        <th>Customer / Type</th>
                        <th>Payment</th>
                        <th className="srp-num">Items</th>
                        <th className="srp-num"><SortButton label="Gross" active={sort.key === 'gross'} dir={sort.dir} onClick={() => toggleSort('gross')} /></th>
                        <th className="srp-num">Discount</th>
                        <th className="srp-num">Delivery Fee</th>
                        <th className="srp-num"><SortButton label="Net Revenue" active={sort.key === 'net'} dir={sort.dir} onClick={() => toggleSort('net')} /></th>
                        <th>Status</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((order) => (
                        <tr key={order.id} className={`txn-row-in ${order.isCancelled ? 'srp-row-muted' : ''}`}>
                          <td><b>{order.orderNumber}</b></td>
                          <td>{formatDateTime(order.createdAt)}</td>
                          <td>{order.customerName}<br /><small>{ORDER_TYPE_LABEL[order.typeKey] || order.typeKey}{order.isGuest ? ' · Guest' : ''}</small></td>
                          <td>{PAYMENT_LABEL[order.paymentMethod] || '-'}</td>
                          <td className="srp-num">{order.itemCount}</td>
                          <td className="srp-num">{money(order.subtotal)}</td>
                          <td className="srp-num">{order.discountAmount > 0 ? `- ${money(order.discountAmount)}` : '—'}</td>
                          <td className="srp-num">{order.deliveryFee > 0 ? money(order.deliveryFee) : '—'}</td>
                          <td className="srp-num"><b>{order.isCancelled ? money(0) : money(order.netRevenue - order.refundedAmount)}</b>{order.refundedAmount > 0 && <><br /><small className="srp-refund-note">- {money(order.refundedAmount)} refunded</small></>}</td>
                          <td><span className={`status-chip status-chip--${statusChipTone(order)}`}>{orderStatusLabel(order)}</span></td>
                          <td><button type="button" className="ops-icon-button small" aria-label={`View details for ${order.orderNumber}`} onClick={() => setDetailTarget(order)}><Eye size={15} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="inv-pagination srp-pagination">
                  <button type="button" disabled={safePage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                  <span>Page {safePage} of {totalPages} · {tableRows.length} orders</span>
                  <button type="button" disabled={safePage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {detailTarget && <OrderDetailModal order={detailTarget} onClose={() => setDetailTarget(null)} />}

      <div className="ops-toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`ops-toast ops-toast-${toast.type}`} key={toast.id}>
            {toast.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />} {toast.message}
          </div>
        ))}
      </div>
    </AppShell>
  )
}

function SortButton({ label, active, dir, onClick }) {
  return (
    <button type="button" className={`srp-sort ${active ? 'is-active' : ''}`} onClick={onClick}>
      {label}
      {active ? (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowDown size={12} className="srp-sort-idle" />}
    </button>
  )
}

function SummaryCard({ icon: Icon, label, value, pct, hint, tone = 'sage', invert = false }) {
  const rounded = Math.round(pct)
  const isFlat = rounded === 0
  const isGood = invert ? rounded < 0 : rounded > 0
  return (
    <article className={`metric-card dash-kpi-card metric-${tone} srp-kpi-card`}>
      <div className="dash-kpi-top"><div className="metric-icon"><Icon size={18} /></div><span>{label}</span></div>
      <strong>{value}</strong>
      <small>
        {isFlat ? <span className="srp-trend-flat">No change {hint}</span> : (
          <span className={isGood ? 'dash-trend-up' : 'dash-trend-down'}>
            {rounded > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {Math.abs(rounded)}% {rounded > 0 ? 'higher' : 'lower'} {hint}
          </span>
        )}
      </small>
    </article>
  )
}

function TrendChart({ trend }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const hasData = trend.some((point) => point.revenue > 0 || (point.previousRevenue || 0) > 0)
  if (!trend.length || !hasData) return <EmptyMini text="No sales recorded for this range yet. Completed orders will appear here." />

  const W = 760
  const H = 220
  const PAD = 10
  const max = Math.max(1, ...trend.map((point) => Math.max(point.revenue, point.previousRevenue || 0)))
  const x = (index) => trend.length === 1 ? W / 2 : PAD + (index / (trend.length - 1)) * (W - PAD * 2)
  const y = (value) => H - 26 - (value / max) * (H - 48)

  const currentPoints = trend.map((point, index) => [x(index), y(point.revenue)])
  const linePath = currentPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0]},${point[1]}`).join(' ')
  const areaPath = `${linePath} L${currentPoints[currentPoints.length - 1][0]},${H - 22} L${currentPoints[0][0]},${H - 22} Z`

  const previousPoints = trend.filter((point) => point.previousRevenue != null)
  const prevPath = trend.map((point, index) => point.previousRevenue == null ? null : `${x(index)},${y(point.previousRevenue)}`)
    .filter(Boolean)
    .map((coords, index) => `${index === 0 ? 'M' : 'L'}${coords}`)
    .join(' ')

  const hovered = hoverIndex != null ? trend[hoverIndex] : null
  const labelStep = Math.max(1, Math.ceil(trend.length / 8))

  return (
    <div className={`srp-trend-chart ${hovered ? 'is-hovering' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Sales trend chart">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PAD} x2={W - PAD} y1={y(max * f)} y2={y(max * f)} className="srp-grid-line" />)}
        {hovered && <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={12} y2={H - 22} className="dash-hover-guide" />}
        {previousPoints.length > 1 && <path d={prevPath} fill="none" className="srp-prev-line" />}
        <path d={areaPath} fill="url(#srpFade)" />
        <path d={linePath} fill="none" className="srp-current-line" />
        <defs>
          <linearGradient id="srpFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f5c46" stopOpacity=".24" />
            <stop offset="1" stopColor="#2f5c46" stopOpacity="0" />
          </linearGradient>
        </defs>
        {trend.map((point, index) => (
          <g key={point.key}>
            <circle cx={x(index)} cy={y(point.revenue)} r={hoverIndex === index ? 5.5 : 3.5} className={`srp-dot ${hoverIndex === index ? 'is-active' : ''}`} />
            <circle cx={x(index)} cy={y(point.revenue)} r="13" fill="transparent" tabIndex={0}
              onMouseEnter={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex((current) => (current === index ? null : current))}
              onFocus={() => setHoverIndex(index)} onBlur={() => setHoverIndex((current) => (current === index ? null : current))} />
          </g>
        ))}
      </svg>
      {hovered && (
        <div className="dash-chart-tooltip srp-trend-tooltip" style={{ left: `${(x(hoverIndex) / W) * 100}%`, top: `${(y(hovered.revenue) / H) * 100}%` }}>
          <b>{hovered.label}</b>
          <span><i /> {money(hovered.revenue)} · {hovered.orders} order{hovered.orders === 1 ? '' : 's'}</span>
          {hovered.previousRevenue != null && <span className="srp-tooltip-prev"><i /> Prev: {money(hovered.previousRevenue)}</span>}
        </div>
      )}
      <div className="chart-labels srp-trend-labels">
        {trend.map((point, index) => (index % labelStep === 0 ? <span key={point.key}>{point.label}</span> : null))}
      </div>
      <div className="srp-trend-legend">
        <span><i className="srp-legend-current" /> Current period</span>
        {previousPoints.length > 1 && <span><i className="srp-legend-prev" /> Previous period</span>}
      </div>
    </div>
  )
}

function StatusBars({ ordersByStatus }) {
  const entries = Object.entries(ordersByStatus).filter(([key, value]) => key !== 'other' || value > 0)
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  if (!total) return <EmptyMini text="No orders in the selected range." />
  const max = Math.max(1, ...entries.map(([, value]) => value))
  return (
    <ul className="srp-status-bars">
      {entries.map(([key, value]) => (
        <li key={key}>
          <div className="srp-status-row">
            <span className="srp-status-label"><i style={{ background: STATUS_META[key].color }} />{STATUS_META[key].label}</span>
            <span className="srp-status-track"><i style={{ width: `${(value / max) * 100}%`, background: STATUS_META[key].color }} /></span>
            <b>{value}</b>
            <small>{total ? Math.round((value / total) * 100) : 0}%</small>
          </div>
        </li>
      ))}
    </ul>
  )
}

function PaymentDonut({ totals }) {
  const [hoverKey, setHoverKey] = useState(null)
  const entries = Object.entries(totals).sort(([, a], [, b]) => b - a)
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  if (!total) return <EmptyMini text="No settled payments in the selected range." />
  const r = 60
  const c = 2 * Math.PI * r
  let offset = 0
  const segments = entries.filter(([, value]) => value > 0).map(([key, value]) => {
    const dash = (value / total) * c
    const startAngle = (offset / c) * 360 - 90
    const midAngle = startAngle + ((dash / c) * 360) / 2
    const rad = (midAngle * Math.PI) / 180
    const segment = { key, value, dash, offset, x: 80 + r * Math.cos(rad), y: 80 + r * Math.sin(rad) }
    offset += dash
    return segment
  })
  const hovered = segments.find((segment) => segment.key === hoverKey)
  return (
    <div className="dash-doughnut-wrap srp-donut-wrap">
      <div className="dash-doughnut-svg-box">
        <svg viewBox="0 0 160 160" className="dash-doughnut">
          <circle cx="80" cy="80" r={r} fill="none" stroke="#eef1ee" strokeWidth="20" />
          {segments.map((segment) => (
            <circle key={segment.key} cx="80" cy="80" r={r} fill="none"
              stroke={PAYMENT_COLOR[segment.key] || PAYMENT_COLOR.other}
              strokeOpacity={hoverKey && hoverKey !== segment.key ? 0.3 : 1}
              strokeWidth={hoverKey === segment.key ? 24 : 20}
              strokeDasharray={`${segment.dash} ${c - segment.dash}`}
              strokeDashoffset={-segment.offset}
              transform="rotate(-90 80 80)"
              className="dash-doughnut-seg"
              tabIndex={0}
              onMouseEnter={() => setHoverKey(segment.key)}
              onMouseLeave={() => setHoverKey((current) => (current === segment.key ? null : current))}
              onFocus={() => setHoverKey(segment.key)}
              onBlur={() => setHoverKey((current) => (current === segment.key ? null : current))} />
          ))}
          <text x="80" y="76" textAnchor="middle" fontSize="17" fontWeight="800" fill="#1b2f22">{money(total).replace('.00', '')}</text>
          <text x="80" y="96" textAnchor="middle" fontSize="11" fill="#68736b">Net revenue</text>
        </svg>
        {hovered && (
          <div className="dash-chart-tooltip" style={{ left: `${(hovered.x / 160) * 100}%`, top: `${(hovered.y / 160) * 100}%` }}>
            <b>{PAYMENT_LABEL[hovered.key] || hovered.key}</b>
            <span><i style={{ background: PAYMENT_COLOR[hovered.key] }} /> {money(hovered.value)}</span>
          </div>
        )}
      </div>
      <ul className="dash-doughnut-legend">
        {entries.map(([key, value]) => (
          <li key={key} className={`${hoverKey === key ? 'is-active' : ''}${hoverKey && hoverKey !== key ? ' is-muted' : ''}`}
            onMouseEnter={() => setHoverKey(key)} onMouseLeave={() => setHoverKey((current) => (current === key ? null : current))}>
            <i style={{ background: PAYMENT_COLOR[key] || PAYMENT_COLOR.other }} />
            {PAYMENT_LABEL[key] || key}
            <span>{money(value)} ({total ? Math.round((value / total) * 100) : 0}%)</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OrderTypeBreakdown({ counts }) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  if (!total) return <EmptyMini text="No orders in the selected range." />
  return (
    <div className="srp-type-grid">
      {Object.entries(counts).map(([key, value]) => {
        const Icon = ORDER_TYPE_ICON[key] || Coffee
        const pct = total ? Math.round((value / total) * 100) : 0
        return (
          <div key={key} className="srp-type-tile">
            <div className="srp-type-icon"><Icon size={16} /></div>
            <b>{value}</b>
            <span>{ORDER_TYPE_LABEL[key]}</span>
            <div className="srp-type-track"><i style={{ width: `${pct}%` }} /></div>
            <small>{pct}% of orders</small>
          </div>
        )
      })}
    </div>
  )
}

function OrderDetailModal({ order, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="module-modal-backdrop" onMouseDown={onClose}>
      <div className="module-modal srp-detail-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Order ${order.orderNumber} details`}>
        <header>
          <div>
            <span className="eyebrow">Order details</span>
            <h2>{order.orderNumber}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X /></button>
        </header>
        <div className="srp-detail-grid">
          <div><span>Date</span><b>{formatDateTime(order.createdAt)}</b></div>
          <div><span>Customer</span><b>{order.customerName}</b></div>
          <div><span>Order Type</span><b>{ORDER_TYPE_LABEL[order.typeKey] || order.typeKey}</b></div>
          <div><span>Payment</span><b>{PAYMENT_LABEL[order.paymentMethod] || '-'}</b></div>
          <div><span>Status</span><span className={`status-chip status-chip--${statusChipTone(order)}`}>{orderStatusLabel(order)}</span></div>
          <div><span>Receipt #</span><b>{order.receiptNumber || '—'}</b></div>
        </div>
        <div className="srp-detail-items">
          <h3>Items ({order.itemCount})</h3>
          {order.items.map((item, index) => (
            <div className="srp-detail-item" key={`${item.name}-${index}`}>
              <span className="srp-detail-qty">{item.quantity}×</span>
              <div><b>{item.name}</b><small>{item.category}</small></div>
              <b>{money(item.lineTotal)}</b>
            </div>
          ))}
        </div>
        <div className="srp-detail-totals">
          <div><span>Gross amount</span><b>{money(order.subtotal)}</b></div>
          {order.discountAmount > 0 && <div><span>Discount</span><b>- {money(order.discountAmount)}</b></div>}
          {order.deliveryFee > 0 && <div><span>Delivery fee</span><b>{money(order.deliveryFee)}</b></div>}
          {order.refundedAmount > 0 && <div className="srp-detail-refund"><span>Refunded</span><b>- {money(order.refundedAmount)}</b></div>}
          <div className="srp-detail-grand"><span>Net revenue</span><b>{money(order.isCancelled ? 0 : order.netRevenue - order.refundedAmount)}</b></div>
        </div>
      </div>
    </div>
  )
}

function EmptyMini({ text }) {
  return <div className="dash-empty-mini srp-empty-mini"><Boxes size={20} /><p>{text}</p></div>
}

function ReportSkeleton() {
  return (
    <div className="dash-skeleton srp-skeleton">
      <div className="metrics dash-kpi-row srp-kpi-row">{Array.from({ length: 4 }).map((_, index) => <div className="inv-skeleton-row dash-skel-card" key={index} />)}</div>
      <div className="inv-skeleton-row srp-skel-filter" />
      <div className="inv-skeleton-row srp-skel-trend" />
      <div className="dashboard-grid dash-triple-grid">
        <div className="inv-skeleton-row dash-skel-panel" />
        <div className="inv-skeleton-row dash-skel-panel" />
        <div className="inv-skeleton-row dash-skel-panel" />
      </div>
      <div className="inv-skeleton-row srp-skel-table" />
    </div>
  )
}
