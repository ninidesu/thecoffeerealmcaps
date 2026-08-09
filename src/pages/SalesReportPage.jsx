import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Boxes, Check, ChevronDown,
  Download, FileText, PhilippinePeso, Printer, ShoppingBag, SlidersHorizontal,
  TrendingDown, TrendingUp,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { getCurrentPortalSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  applyLocalFilters, buildTrend, computeSalesReport, exportSalesReportCsv,
  fetchSalesReportData, ORDER_TYPE_LABEL, PAYMENT_LABEL, printSalesReportPdf,
} from '../services/salesReportService'
import { hasManagementSessionState, useManagementSessionState } from '../hooks/useManagementSessionState'
import '../sales-report.css'

const PERIOD_OPTIONS = [
  ['today', 'Today'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['year', 'This Year'],
  ['custom', 'Custom'],
]

const PAYMENT_COLOR = { cash: '#1b2f22', gcash: '#4f7cff', bank_transfer: '#9b8cf2', cod: '#c8a86b', other: '#68736b' }

function AnimatedValue({ value, format }) {
  return <>{format ? format(value) : Math.round(value).toLocaleString('en-PH')}</>
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

function reviveAppliedFilters(value) {
  return {
    ...value,
    from: new Date(value.from),
    to: new Date(value.to),
    prevFrom: new Date(value.prevFrom),
    prevTo: new Date(value.prevTo),
  }
}

function periodLabel(applied) {
  const preset = PERIOD_OPTIONS.find(([key]) => key === applied.period)?.[1]
  const fmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  const rangeText = `${fmt.format(applied.from)} - ${fmt.format(applied.to)}`
  return applied.period === 'custom' ? rangeText : `${preset} (${rangeText})`
}

export default function SalesReportPage() {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [profile, setProfile] = useState(null)
  const [toasts, setToasts] = useState([])
  const [filterError, setFilterError] = useState('')

  // Draft filters (edited freely) vs applied filters (drive the data).
  const draftAtMount = useRef(hasManagementSessionState('admin:sales:draft-period'))
  const [draftPeriod, setDraftPeriod] = useManagementSessionState('admin:sales:draft-period', 'month')
  const [draftFrom, setDraftFrom] = useManagementSessionState('admin:sales:draft-from', '')
  const [draftTo, setDraftTo] = useManagementSessionState('admin:sales:draft-to', '')
  const [draftOrderType, setDraftOrderType] = useManagementSessionState('admin:sales:draft-order-type', 'all')
  const [draftPayment, setDraftPayment] = useManagementSessionState('admin:sales:draft-payment', 'all')
  const [moreFiltersOpen, setMoreFiltersOpen] = useManagementSessionState('admin:sales:more-filters', false)
  const [applied, setApplied] = useManagementSessionState('admin:sales:applied', () => ({ ...buildAppliedFilters('month'), orderType: 'all', paymentMethod: 'all' }), { deserialize: reviveAppliedFilters })

  const [granularity, setGranularity] = useManagementSessionState('admin:sales:granularity', 'day')

  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const appliedRef = useRef(applied)
  appliedRef.current = applied

  useEffect(() => {
    getCurrentPortalSession().then(({ profile: currentProfile }) => setProfile(currentProfile)).catch(() => {})
    if (!draftAtMount.current) {
      setDraftFrom(dateInputValue(applied.from))
      setDraftTo(dateInputValue(applied.to))
    }
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
    if (draftPeriod === 'custom' && (!draftFrom || !draftTo)) {
      setFilterError('Choose both a start date and an end date for a custom report.')
      return
    }
    if (draftPeriod === 'custom' && new Date(`${draftFrom}T00:00:00`) > new Date(`${draftTo}T23:59:59.999`)) {
      setFilterError('The start date must be on or before the end date.')
      return
    }
    const next = { ...buildAppliedFilters(draftPeriod, draftFrom, draftTo), orderType: draftOrderType, paymentMethod: draftPayment }
    setFilterError('')
    setApplied(next)
    setGranularity(defaultGranularity(next.from, next.to))
    setDraftFrom(dateInputValue(next.from))
    setDraftTo(dateInputValue(next.to))
  }

  const resetFilters = () => {
    setFilterError('')
    setDraftPeriod('month')
    setDraftOrderType('all')
    setDraftPayment('all')
    const next = { ...buildAppliedFilters('month'), orderType: 'all', paymentMethod: 'all' }
    setDraftFrom(dateInputValue(next.from))
    setDraftTo(dateInputValue(next.to))
    setApplied(next)
    setGranularity(defaultGranularity(next.from, next.to))
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
    return parts.join(' / ')
  }, [applied])

  const comparisonPct = (current, previous) => {
    if (previous > 0) return ((current - previous) / previous) * 100
    return current > 0 ? 100 : 0
  }

  const runExportCsv = () => {
    const exportSummary = computeSalesReport(filteredOrders, []).summary
    const csv = exportSalesReportCsv({ orders: filteredOrders, summary: exportSummary, filterLabel, generatedBy: profile?.full_name || profile?.email })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sales-report-${dateInputValue(applied.from)}-to-${dateInputValue(applied.to)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    pushToast('success', `Exported ${filteredOrders.length} order${filteredOrders.length === 1 ? '' : 's'} to CSV.`)
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
    <AppShell role="admin" title="Sales Reports" eyebrow="Review revenue, orders, and product performance for any period." onRefresh={() => load(appliedRef.current, { silent: true })} actions={
      <div className="ops-header-actions srp-header-actions">
        <div className="inv-overflow">
          <button type="button" className="ops-main-action inv-record-btn" aria-expanded={exportMenuOpen} aria-controls="sales-report-export-menu" onClick={() => setExportMenuOpen((open) => !open)} disabled={loading || !raw}>
            <Download size={16} /> Export <ChevronDown size={14} />
          </button>
          {exportMenuOpen && (
            <div className="inv-overflow-menu txn-export-menu" id="sales-report-export-menu" role="menu">
              <button type="button" role="menuitem" onClick={runExportPdf}><Printer size={14} /> PDF, full report</button>
              <button type="button" role="menuitem" onClick={runExportCsv}><FileText size={14} /> CSV, order data</button>
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
          {raw?.truncated && <p className="form-error srp-data-warning" role="alert">This period exceeds 5,000 orders. Figures reflect the first 5,000. Narrow the date range for exact totals.</p>}

          <section className="srp-overview-grid" aria-label="Sales overview">
            <SummaryCard featured icon={PhilippinePeso} label="Net Revenue" value={<AnimatedValue value={report.summary.netRevenue} format={money} />} pct={report.comparison.revenuePct} hint={comparisonHint} />
            <div className="srp-support-kpis">
              <SummaryCard icon={ShoppingBag} label="Paid Orders" value={<AnimatedValue value={report.summary.totalOrders} />} pct={report.comparison.ordersPct} hint={comparisonHint} tone="cream" />
              <SummaryCard icon={PhilippinePeso} label="Average Order Value" value={<AnimatedValue value={report.summary.averageOrderValue} format={money} />} pct={comparisonPct(report.summary.averageOrderValue, report.previousSummary.averageOrderValue)} hint={comparisonHint} tone="gold" />
              <SummaryCard icon={Boxes} label="Items Sold" value={<AnimatedValue value={report.summary.totalItems} />} pct={report.comparison.itemsPct} hint={comparisonHint} tone="blue" />
            </div>
          </section>

          <section className="srp-reconciliation" aria-label="Revenue reconciliation">
            <div><span>Gross Sales</span><b>{money(report.summary.grossSales)}</b></div>
            <div><span>Discounts</span><b>- {money(report.summary.discounts)}</b></div>
            <div><span>Refunds</span><b>- {money(report.summary.refunds)}</b></div>
            <div><span>Delivery Fees</span><b>{money(report.summary.deliveryFees)}</b><small>Excluded from revenue</small></div>
            <div><span>Cancelled</span><b>{report.summary.cancelledOrders.toLocaleString('en-PH')}</b></div>
          </section>

          <section className="panel dash-panel srp-filter-card" aria-labelledby="sales-filter-title">
            <header className="srp-filter-head">
              <div><h2 id="sales-filter-title">Report filters</h2><p>Choose a period first, then narrow the report when needed.</p></div>
              <button type="button" className="srp-more-filters" aria-expanded={moreFiltersOpen} aria-controls="sales-report-extra-filters" onClick={() => setMoreFiltersOpen((open) => !open)}>
                <SlidersHorizontal size={16} /> More filters
                {(draftOrderType !== 'all' || draftPayment !== 'all') && <span aria-label="Additional filters active">Active</span>}
              </button>
            </header>
            <div className="srp-filter-body">
              <div className="srp-period-group">
                <span>Report period</span>
                <div className="srp-period-presets" role="group" aria-label="Report period">
                  {PERIOD_OPTIONS.map(([key, label]) => (
                    <button type="button" key={key} className={draftPeriod === key ? 'active' : ''} aria-pressed={draftPeriod === key} onClick={() => selectPeriodPreset(key)}>{label}</button>
                  ))}
                </div>
              </div>
              {draftPeriod === 'custom' && (
                <div className="srp-custom-range">
                  <label className="field compact"><span>Date From</span>
                    <input type="date" value={draftFrom} max={draftTo || undefined} onChange={(event) => { setDraftFrom(event.target.value); setFilterError('') }} />
                  </label>
                  <label className="field compact"><span>Date To</span>
                    <input type="date" value={draftTo} min={draftFrom || undefined} onChange={(event) => { setDraftTo(event.target.value); setFilterError('') }} />
                  </label>
                </div>
              )}
              {moreFiltersOpen && (
                <div className="srp-extra-filters" id="sales-report-extra-filters">
                  <label className="field compact"><span>Order Type</span>
                    <select value={draftOrderType} onChange={(event) => setDraftOrderType(event.target.value)}>
                      <option value="all">All types</option>
                      {Object.entries(ORDER_TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                  </label>
                  <label className="field compact"><span>Payment Method</span>
                    <select value={draftPayment} onChange={(event) => setDraftPayment(event.target.value)}>
                      <option value="all">All methods</option>
                      {Object.entries(PAYMENT_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {filterError && <p className="srp-filter-error" role="alert">{filterError}</p>}
            </div>
            <footer className="srp-filter-footer">
              <span>Applied: {filterLabel}</span>
              <div className="srp-filter-actions">
                <button type="button" className="secondary-button" onClick={resetFilters}>Reset</button>
                <button type="button" className="primary-button" onClick={applyFilters} disabled={loading}>Apply filters</button>
              </div>
            </footer>
          </section>

          <section className="panel dash-panel srp-trend-panel">
            <div className="panel-head">
              <div><span>Sales Trend</span><small>Net revenue, current vs previous period</small></div>
              <div className="srp-granularity" role="tablist" aria-label="Trend granularity">
                {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([key, label]) => (
                  <button type="button" role="tab" key={key} className={granularity === key ? 'active' : ''} aria-selected={granularity === key} onClick={() => setGranularity(key)}>{label}</button>
                ))}
              </div>
            </div>
            <TrendChart trend={trend} />
          </section>

          <section className="dashboard-grid srp-breakdown-grid srp-breakdown-single">
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Payment Methods</span><small>Net revenue share</small></div></div>
              <PaymentDonut totals={report.paymentTotals} />
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

        </div>
      )}

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

function SummaryCard({ icon: Icon, label, value, pct, hint, tone = 'sage', invert = false, featured = false }) {
  const rounded = Math.round(pct)
  const isFlat = rounded === 0
  const isGood = invert ? rounded < 0 : rounded > 0
  return (
    <article className={`metric-card dash-kpi-card metric-${tone} srp-kpi-card${featured ? ' srp-kpi-featured' : ''}`}>
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
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby="sales-trend-title sales-trend-description">
        <title id="sales-trend-title">Net revenue trend</title>
        <desc id="sales-trend-description">Current period net revenue is shown with a solid line. The previous period is shown with a dashed line.</desc>
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
            <circle cx={x(index)} cy={y(point.revenue)} r="22" fill="transparent" tabIndex={0} role="img"
              aria-label={`${point.label}: ${money(point.revenue)}, ${point.orders} order${point.orders === 1 ? '' : 's'}${point.previousRevenue != null ? `, previous period ${money(point.previousRevenue)}` : ''}`}
              onMouseEnter={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex((current) => (current === index ? null : current))}
              onFocus={() => setHoverIndex(index)} onBlur={() => setHoverIndex((current) => (current === index ? null : current))} />
          </g>
        ))}
      </svg>
      {hovered && (
        <div className="dash-chart-tooltip srp-trend-tooltip" style={{ left: `${(x(hoverIndex) / W) * 100}%`, top: `${(y(hovered.revenue) / H) * 100}%` }}>
          <b>{hovered.label}</b>
          <span><i /> {money(hovered.revenue)} ({hovered.orders} order{hovered.orders === 1 ? '' : 's'})</span>
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
      <details className="srp-trend-data">
        <summary>View chart data</summary>
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>Period</th><th className="srp-num">Orders</th><th className="srp-num">Net Revenue</th><th className="srp-num">Previous Period</th></tr></thead>
            <tbody>{trend.map((point) => <tr key={point.key}><td>{point.label}</td><td className="srp-num">{point.orders}</td><td className="srp-num">{money(point.revenue)}</td><td className="srp-num">{point.previousRevenue == null ? '-' : money(point.previousRevenue)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
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
        <svg viewBox="0 0 160 160" className="dash-doughnut" role="img" aria-labelledby="payment-share-title payment-share-description">
          <title id="payment-share-title">Revenue by payment method</title>
          <desc id="payment-share-description">A proportion chart showing each payment method's share of net revenue. Exact values are listed beside the chart.</desc>
          <circle cx="80" cy="80" r={r} fill="none" className="srp-donut-track" strokeWidth="20" />
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
              role="img"
              aria-label={`${PAYMENT_LABEL[segment.key] || segment.key}: ${money(segment.value)}, ${Math.round((segment.value / total) * 100)} percent`}
              onMouseEnter={() => setHoverKey(segment.key)}
              onMouseLeave={() => setHoverKey((current) => (current === segment.key ? null : current))}
              onFocus={() => setHoverKey(segment.key)}
              onBlur={() => setHoverKey((current) => (current === segment.key ? null : current))} />
          ))}
          <text x="80" y="76" textAnchor="middle" className="srp-donut-total">{money(total).replace('.00', '')}</text>
          <text x="80" y="96" textAnchor="middle" className="srp-donut-caption">Net revenue</text>
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
          <li key={key} tabIndex={0} aria-label={`${PAYMENT_LABEL[key] || key}: ${money(value)}, ${total ? Math.round((value / total) * 100) : 0} percent`}
            className={`${hoverKey === key ? 'is-active' : ''}${hoverKey && hoverKey !== key ? ' is-muted' : ''}`}
            onFocus={() => setHoverKey(key)} onBlur={() => setHoverKey((current) => (current === key ? null : current))}
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

function EmptyMini({ text }) {
  return <div className="dash-empty-mini srp-empty-mini"><Boxes size={20} /><p>{text}</p></div>
}

function ReportSkeleton() {
  return (
    <div className="dash-skeleton srp-skeleton">
      <div className="srp-overview-grid">
        <div className="inv-skeleton-row dash-skel-card" />
        <div className="srp-support-kpis">{Array.from({ length: 3 }).map((_, index) => <div className="inv-skeleton-row dash-skel-card" key={index} />)}</div>
      </div>
      <div className="inv-skeleton-row srp-skel-reconciliation" />
      <div className="inv-skeleton-row srp-skel-filter" />
      <div className="inv-skeleton-row srp-skel-trend" />
      <div className="inv-skeleton-row dash-skel-panel" />
    </div>
  )
}
