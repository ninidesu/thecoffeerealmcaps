import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BarChart3, Boxes, CalendarDays, Check, ChevronDown, Clock3,
  Download, FileText, PhilippinePeso, Printer, ShoppingBag, SlidersHorizontal,
  Minus, Store, Truck, TrendingDown, TrendingUp,
} from 'lucide-react'
import { useLocation } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { getCurrentPortalSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  applyLocalFilters, buildChannelTrend, buildTrend, buildTrendMetrics, computeProductMomentum, computeSalesReport, exportSalesReportCsv,
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
const ORDER_TYPE_ICON = { 'walk-in': Store, pickup: ShoppingBag, delivery: Truck, preorder: Clock3 }
const ANALYTICS_TABS = [
  { key: 'products', label: 'Product Performance', detail: 'Products, units, and revenue', icon: BarChart3 },
  { key: 'trends', label: 'Sales Trends', detail: 'Revenue and demand over time', icon: TrendingUp },
]
const TREND_METRICS = [
  { key: 'revenue', label: 'Revenue', detail: 'Net revenue', icon: PhilippinePeso, format: money, previousKey: 'previousRevenue' },
  { key: 'orders', label: 'Orders', detail: 'Completed paid orders', icon: ShoppingBag, format: (value) => Math.round(value).toLocaleString('en-PH'), previousKey: 'previousOrders' },
  { key: 'units', label: 'Units', detail: 'Items sold', icon: Boxes, format: (value) => Math.round(value).toLocaleString('en-PH'), previousKey: 'previousUnits' },
]
const SALES_GRAPH_DURATION = 4

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
  const fmt = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fmt.format(applied.from)} - ${fmt.format(applied.to)}`
}

function chartEaseTimelinePosition(progress) {
  const easedProgress = Math.min(1, Math.max(0, progress))
  const parameter = 1 - Math.cbrt(1 - easedProgress)
  const inverse = 1 - parameter
  return 3 * inverse ** 2 * parameter * 0.16 + 3 * inverse * parameter ** 2 * 0.3 + parameter ** 3
}

function smoothLinePath(points) {
  if (!points.length) return ''
  if (points.length < 2) return `M ${points[0][0]} ${points[0][1]}`

  let path = `M ${points[0][0]} ${points[0][1]}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)]
    const current = points[index]
    const nextPoint = points[index + 1]
    const next = points[Math.min(points.length - 1, index + 2)]
    const segmentTop = Math.min(current[1], nextPoint[1])
    const segmentBottom = Math.max(current[1], nextPoint[1])
    const controlOneX = current[0] + (nextPoint[0] - previous[0]) / 6
    const controlOneY = Math.min(segmentBottom, Math.max(segmentTop, current[1] + (nextPoint[1] - previous[1]) / 6))
    const controlTwoX = nextPoint[0] - (next[0] - current[0]) / 6
    const controlTwoY = Math.min(segmentBottom, Math.max(segmentTop, nextPoint[1] - (next[1] - current[1]) / 6))
    path += ` C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${nextPoint[0]} ${nextPoint[1]}`
  }
  return path
}

export default function SalesReportPage() {
  const { pathname } = useLocation()
  const legacyAnalyticsView = pathname === '/admin/products' ? 'products' : pathname === '/admin/trends' ? 'trends' : null
  const isAnalyticsPage = pathname === '/admin/analytics' || Boolean(legacyAnalyticsView)
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [toasts, setToasts] = useState([])
  const [filterError, setFilterError] = useState('')

  // Keep the visible controls separate from the last valid filter set so custom
  // date input can be edited safely while every valid change updates the report.
  const draftAtMount = useRef(hasManagementSessionState('admin:sales:draft-period'))
  const [draftPeriod, setDraftPeriod] = useManagementSessionState('admin:sales:draft-period', 'month')
  const [draftFrom, setDraftFrom] = useManagementSessionState('admin:sales:draft-from', '')
  const [draftTo, setDraftTo] = useManagementSessionState('admin:sales:draft-to', '')
  const [draftOrderType, setDraftOrderType] = useManagementSessionState('admin:sales:draft-order-type', 'all')
  const [draftPayment, setDraftPayment] = useManagementSessionState('admin:sales:draft-payment', 'all')
  const [moreFiltersOpen, setMoreFiltersOpen] = useManagementSessionState('admin:sales:filter-row-open', true)
  const [applied, setApplied] = useManagementSessionState('admin:sales:applied', () => ({ ...buildAppliedFilters('month'), orderType: 'all', paymentMethod: 'all' }), { deserialize: reviveAppliedFilters })

  const [granularity, setGranularity] = useManagementSessionState('admin:sales:granularity', 'day')
  const [productSort, setProductSort] = useManagementSessionState('admin:analytics:product-sort', 'revenue')
  const [analyticsTab, setAnalyticsTab] = useManagementSessionState('admin:analytics:tab', legacyAnalyticsView || 'products')
  const [trendMetric, setTrendMetric] = useManagementSessionState('admin:analytics:trend-metric', 'revenue')

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

  useEffect(() => {
    if (legacyAnalyticsView) setAnalyticsTab(legacyAnalyticsView)
  }, [legacyAnalyticsView, setAnalyticsTab])

  const pushToast = (type, message) => {
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, type, message }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200)
  }

  const load = async (filters = appliedRef.current) => {
    setLoading(true)
    try {
      const data = await fetchSalesReportData({
        dateFrom: filters.from.toISOString(),
        dateTo: filters.to.toISOString(),
        prevFrom: filters.prevFrom.toISOString(),
        prevTo: filters.prevTo.toISOString(),
      })
      setRaw(data)
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load the sales report.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(applied) }, [applied])

  useEffect(() => {
    const refresh = () => load(appliedRef.current)
    const channel = supabase
      .channel('sales-report-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refunds' }, refresh)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const commitFilters = ({ period = draftPeriod, from = draftFrom, to = draftTo, orderType = draftOrderType, paymentMethod = draftPayment } = {}) => {
    if (period === 'custom' && (!from || !to)) {
      setFilterError('Choose both a start date and an end date for a custom report.')
      return false
    }
    if (period === 'custom' && new Date(`${from}T00:00:00`) > new Date(`${to}T23:59:59.999`)) {
      setFilterError('The start date must be on or before the end date.')
      return false
    }
    const next = { ...buildAppliedFilters(period, from, to), orderType, paymentMethod }
    setFilterError('')
    setApplied(next)
    const current = appliedRef.current
    if (current.from.getTime() !== next.from.getTime() || current.to.getTime() !== next.to.getTime()) {
      setGranularity(defaultGranularity(next.from, next.to))
    }
    return true
  }

  const selectPeriodPreset = (key) => {
    setDraftPeriod(key)
    if (key !== 'custom') {
      const range = rangeForPeriod(key)
      const from = dateInputValue(range.from)
      const to = dateInputValue(range.to)
      setDraftFrom(from)
      setDraftTo(to)
      commitFilters({ period: key, from, to })
      return
    }
    commitFilters({ period: key })
  }

  const handleCustomDateChange = (field, value) => {
    const from = field === 'from' ? value : draftFrom
    const to = field === 'to' ? value : draftTo
    if (field === 'from') setDraftFrom(value)
    else setDraftTo(value)
    setFilterError('')
    commitFilters({ period: 'custom', from, to })
  }

  const handleOrderTypeChange = (value) => {
    setDraftOrderType(value)
    commitFilters({ orderType: value })
  }

  const handlePaymentChange = (value) => {
    setDraftPayment(value)
    commitFilters({ paymentMethod: value })
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
  const analyticsView = isAnalyticsPage ? (analyticsTab === 'trends' ? 'trends' : 'products') : 'reports'
  const pageMeta = isAnalyticsPage
    ? { title: 'Analytics' }
    : { title: 'Sales Reports' }
  const trend = useMemo(
    () => buildTrend(filteredOrders, filteredPrevious, { dateFrom: applied.from, dateTo: applied.to, granularity }),
    [filteredOrders, filteredPrevious, applied.from, applied.to, granularity],
  )
  const trendMetrics = useMemo(
    () => buildTrendMetrics(filteredOrders, filteredPrevious, { dateFrom: applied.from, dateTo: applied.to, granularity }),
    [filteredOrders, filteredPrevious, applied.from, applied.to, granularity],
  )
  const channelTrend = useMemo(
    () => buildChannelTrend(filteredOrders, { dateFrom: applied.from, dateTo: applied.to, granularity }),
    [filteredOrders, applied.from, applied.to, granularity],
  )
  const productMomentum = useMemo(
    () => computeProductMomentum(filteredOrders, filteredPrevious),
    [filteredOrders, filteredPrevious],
  )
  const productRows = useMemo(() => {
    const products = [...(report.topProducts || [])]
    return products.sort((a, b) => productSort === 'qty' ? b.qty - a.qty || b.revenue - a.revenue : b.revenue - a.revenue || b.qty - a.qty)
  }, [productSort, report.topProducts])

  const filterLabel = useMemo(() => {
    const parts = [periodLabel(applied)]
    if (applied.orderType !== 'all') parts.push(ORDER_TYPE_LABEL[applied.orderType])
    if (applied.paymentMethod !== 'all') parts.push(PAYMENT_LABEL[applied.paymentMethod])
    return parts.join(' / ')
  }, [applied])
  const reportRangeLabel = periodLabel(applied)

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
    <AppShell
      role="admin"
      title={pageMeta.title}
      eyebrow={pageMeta.eyebrow}
      titleActions={isAnalyticsPage ? <AnalyticsTabs activeKey={analyticsView} onChange={setAnalyticsTab} placement="header" /> : null}
      onRefresh={() => load(appliedRef.current)}
    >
      {loading && !raw ? <ReportSkeleton /> : error && !raw ? (
        <div className="inv-empty"><AlertTriangle size={28} /><h3>Could not load the sales report</h3><p>{error}</p><button type="button" className="ops-main-action" onClick={() => load()}>Retry</button></div>
      ) : (
        <div className="dash-fade-in">
          {error && <p className="form-error">{error}</p>}
          {raw?.truncated && <p className="form-error srp-data-warning" role="alert">This period exceeds 5,000 orders. Figures reflect the first 5,000. Narrow the date range for exact totals.</p>}

          <section className="ir-range-bar srp-range-bar" aria-label="Sales report filters">
            <div className="ir-range-label srp-range-label">
              <CalendarDays size={16} aria-hidden="true" />
              <span><b>Report range</b><small>{reportRangeLabel}</small></span>
            </div>
            <div className="ir-presets srp-presets" role="group" aria-label="Report period">
              {PERIOD_OPTIONS.map(([key, label]) => (
                <button type="button" key={key} className={draftPeriod === key ? 'active' : ''} aria-pressed={draftPeriod === key} aria-expanded={key === 'custom' ? draftPeriod === key : undefined} aria-controls={key === 'custom' ? 'sales-report-custom-range' : undefined} onClick={() => selectPeriodPreset(key)}>{label}</button>
              ))}
            </div>
            <div className="srp-range-actions">
              <div className="inv-overflow srp-export-wrap">
                <button type="button" className="ops-main-action inv-record-btn srp-export-btn" aria-expanded={exportMenuOpen} aria-controls="sales-report-export-menu" onClick={() => setExportMenuOpen((open) => !open)} disabled={loading || !raw}>
                  <Download size={16} /> Export <ChevronDown size={14} />
                </button>
                {exportMenuOpen && (
                  <div className="inv-overflow-menu txn-export-menu srp-export-menu" id="sales-report-export-menu" role="menu">
                    <button type="button" role="menuitem" onClick={runExportPdf}><Printer size={14} /> PDF, full report</button>
                    <button type="button" role="menuitem" onClick={runExportCsv}><FileText size={14} /> CSV, order data</button>
                  </div>
                )}
              </div>
              <button type="button" className="srp-more-filters" aria-expanded={moreFiltersOpen} aria-controls="sales-report-extra-filters" onClick={() => setMoreFiltersOpen((open) => !open)}>
                <SlidersHorizontal size={16} /> {moreFiltersOpen ? 'Hide filters' : 'More filters'}
                {(draftOrderType !== 'all' || draftPayment !== 'all') && <span aria-label="Additional filters active">Active</span>}
              </button>
            </div>
          </section>
          {draftPeriod === 'custom' && (
            <div className="srp-custom-popout" id="sales-report-custom-range" role="group" aria-label="Custom report date range">
              <div className="srp-custom-popout-copy">
                <CalendarDays size={15} aria-hidden="true" />
                <span><b>Custom date range</b><small>Choose the start and end dates for this report.</small></span>
              </div>
              <div className="ir-custom-range srp-custom-range">
                <label>From
                  <input type="date" value={draftFrom} max={draftTo || undefined} onChange={(event) => handleCustomDateChange('from', event.target.value)} />
                </label>
                <span>to</span>
                <label>To
                  <input type="date" value={draftTo} min={draftFrom || undefined} onChange={(event) => handleCustomDateChange('to', event.target.value)} />
                </label>
              </div>
            </div>
          )}
          {moreFiltersOpen && (
            <div className="ir-filter-row srp-filter-row" id="sales-report-extra-filters" aria-label="Additional sales report filters">
              <label>Order type
                <select value={draftOrderType} onChange={(event) => handleOrderTypeChange(event.target.value)}>
                  <option value="all">All types</option>
                  {Object.entries(ORDER_TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label>Payment method
                <select value={draftPayment} onChange={(event) => handlePaymentChange(event.target.value)}>
                  <option value="all">All methods</option>
                  {Object.entries(PAYMENT_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            </div>
          )}
          {filterError && <p className="srp-filter-error" role="alert">{filterError}</p>}

          {analyticsView === 'products' ? (
            <ProductPerformanceContent
              report={report}
              productRows={productRows}
              productSort={productSort}
              setProductSort={setProductSort}
              comparisonHint={comparisonHint}
            />
          ) : analyticsView === 'trends' ? (
            <SalesTrendsContent
              report={report}
              trend={trendMetrics}
              channelTrend={channelTrend}
              productMomentum={productMomentum}
              granularity={granularity}
              setGranularity={setGranularity}
              trendMetric={trendMetric}
              setTrendMetric={setTrendMetric}
              comparisonHint={comparisonHint}
              comparisonPct={comparisonPct}
            />
          ) : (
            <>
              <section className="srp-overview-grid" aria-label="Sales overview">
                <SummaryCard featured icon={PhilippinePeso} label="Net Revenue" value={<AnimatedValue value={report.summary.netRevenue} format={money} />} pct={report.comparison.revenuePct} hint={comparisonHint} className="srp-net-revenue-card">
                  <RevenueReconciliation summary={report.summary} />
                </SummaryCard>
                <div className="srp-support-kpis">
                  <SummaryCard icon={ShoppingBag} label="Completed Paid Orders" value={<AnimatedValue value={report.summary.totalOrders} />} pct={report.comparison.ordersPct} hint={comparisonHint} tone="cream" />
                  <SummaryCard icon={PhilippinePeso} label="Average Order Value" value={<AnimatedValue value={report.summary.averageOrderValue} format={money} />} pct={comparisonPct(report.summary.averageOrderValue, report.previousSummary.averageOrderValue)} hint={comparisonHint} tone="gold" />
                  <SummaryCard icon={Boxes} label="Items Sold" value={<AnimatedValue value={report.summary.totalItems} />} pct={report.comparison.itemsPct} hint={comparisonHint} tone="blue" />
                </div>
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

              <section className="dashboard-grid srp-breakdown-grid">
                <article className="panel dash-panel">
                  <div className="panel-head"><div><span>Payment Methods</span><small>Net revenue share</small></div></div>
                  <PaymentDonut totals={report.paymentTotals} />
                </article>
                <article className="panel dash-panel srp-channel-panel">
                  <div className="panel-head"><div><span>Order Channels</span><small>Completed paid orders</small></div><b className="srp-panel-total">{report.summary.totalOrders.toLocaleString('en-PH')}</b></div>
                  <OrderTypeMix counts={report.orderChannelCounts} total={report.summary.totalOrders} />
                </article>
              </section>

            </>
          )}

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

function AnalyticsTabs({ activeKey, onChange, placement = 'body' }) {
  return (
    <nav className={`srp-analytics-tabs${placement === 'header' ? ' srp-analytics-tabs-header' : ''}`} aria-label="Analytics views" role="tablist">
      {ANALYTICS_TABS.map(({ key, label, detail, icon: Icon }) => (
        <button
          type="button"
          key={key}
          role="tab"
          aria-selected={activeKey === key}
          className={activeKey === key ? 'active' : ''}
          onClick={() => onChange(key)}
        >
          <span className="srp-analytics-tab-icon" aria-hidden="true"><Icon size={17} /></span>
          <span className="srp-analytics-tab-copy"><b>{label}</b><small>{detail}</small></span>
          <TrendingUp className="srp-analytics-tab-arrow" size={14} aria-hidden="true" />
        </button>
      ))}
    </nav>
  )
}

function ProductPerformanceContent({ report, productRows, productSort, setProductSort, comparisonHint }) {
  const revenueLeader = report.topProducts?.[0]
  const productCount = report.productCount || productRows.length
  return (
    <>
      <section className="srp-overview-grid srp-product-overview" aria-label="Product performance overview">
        <SummaryCard
          featured
          icon={PhilippinePeso}
          label="Product Revenue"
          value={money(report.productRevenue)}
          detail="Line revenue from completed sales"
          className="srp-product-revenue-card"
        />
        <div className="srp-support-kpis">
          <SummaryCard icon={ShoppingBag} label="Units Sold" value={<AnimatedValue value={report.summary.totalItems} />} pct={report.comparison.itemsPct} hint={comparisonHint} tone="cream" />
          <SummaryCard icon={BarChart3} label="Distinct Products" value={<AnimatedValue value={productCount} />} detail="With completed sales" tone="blue" />
          <SummaryCard
            icon={TrendingUp}
            label="Leading Product"
            value={revenueLeader?.name || 'No sales yet'}
            detail={revenueLeader ? `${revenueLeader.pct.toFixed(1)}% of product revenue` : 'Completed sales will appear here'}
            tone="gold"
            className="srp-product-name-card"
          />
        </div>
      </section>

      <ProductPerformanceTable
        products={productRows}
        title="Product Performance"
        description="Top products ranked by revenue contribution"
        sortValue={productSort}
        onSortChange={setProductSort}
      />
      <ProductPerformanceTable
        products={report.leastOrderedProducts || []}
        title="Least Ordered Items"
        description="Items with the fewest units sold in the selected period"
        emptyText="No ordered items in the selected range."
      />
    </>
  )
}

function SalesTrendsContent({ report, trend, channelTrend, productMomentum, granularity, setGranularity, trendMetric, setTrendMetric, comparisonHint, comparisonPct }) {
  const metric = TREND_METRICS.find((item) => item.key === trendMetric) || TREND_METRICS[0]
  return (
    <>
      <TrendInsightGrid report={report} trend={trend} metric={metric} granularity={granularity} comparisonHint={comparisonHint} comparisonPct={comparisonPct} />

      <div className="srp-trend-summary-insights-grid">
        <section className="srp-trend-reconciliation-subsummary" aria-labelledby="sales-reconciliation-title">
          <div className="srp-trend-subsummary-head">
            <div><span id="sales-reconciliation-title">Sales reconciliation</span><small>Gross sales and adjustments behind net revenue</small></div>
          </div>
          <div className="srp-trend-reconciliation-cards">
            <SummaryCard label="Gross Sales" value={money(report.summary.grossSales)} detail="Before discounts and refunds" className="srp-reconcile-card srp-reconcile-gross" />
            <SummaryCard label="Discounts" value={`- ${money(report.summary.discounts)}`} detail="Applied discounts" className="srp-reconcile-card srp-reconcile-discount" />
            <SummaryCard label="Refunds" value={`- ${money(report.summary.refunds)}`} detail="Processed refunds" className="srp-reconcile-card srp-reconcile-refund" />
            <SummaryCard label="Delivery Fees" value={money(report.summary.deliveryFees)} detail="Excluded from revenue" className="srp-reconcile-card srp-reconcile-delivery" />
            <SummaryCard label="Cancelled" value={report.summary.cancelledOrders.toLocaleString('en-PH')} detail="Orders excluded from revenue" className="srp-reconcile-card srp-reconcile-cancelled" />
          </div>
        </section>
        <TrendInsightsPanel trend={trend} metric={metric} channelTrend={channelTrend} productMomentum={productMomentum} granularity={granularity} />
      </div>

      <div className="srp-trend-primary-grid">
        <section className="panel dash-panel srp-trend-panel srp-sales-trends-panel" aria-labelledby="sales-trends-title">
          <div className="panel-head srp-trends-panel-head">
            <div className="srp-trend-panel-title">
              <span className="srp-trend-heading-icon" aria-hidden="true"><TrendingUp size={16} /></span>
              <div><span id="sales-trends-title">Sales Trends</span><small>{metric.detail}, current vs previous period</small></div>
            </div>
            <div className="srp-trend-controls">
              <TrendMetricToggle value={metric.key} onChange={setTrendMetric} />
              <div className="srp-granularity" role="tablist" aria-label="Sales trend granularity">
                {[['day', 'Day'], ['week', 'Week'], ['month', 'Month']].map(([key, label]) => (
                  <button type="button" role="tab" key={key} className={granularity === key ? 'active' : ''} aria-selected={granularity === key} onClick={() => setGranularity(key)}>{label}</button>
                ))}
              </div>
            </div>
          </div>
          <TrendAnalyticsChart trend={trend} metric={metric} />
        </section>
        <ChannelTrendPanel channelTrend={channelTrend} />
      </div>

      <ProductMomentumPanel products={productMomentum} />
    </>
  )
}

function TrendMetricToggle({ value, onChange }) {
  return (
    <div className="srp-trend-metric-toggle" role="tablist" aria-label="Trend metric">
      {TREND_METRICS.map(({ key, label, icon: Icon }) => (
        <button type="button" role="tab" key={key} className={value === key ? 'active' : ''} aria-selected={value === key} onClick={() => onChange(key)}>
          <Icon size={14} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

function trendPercent(value) {
  const number = Number(value || 0)
  if (Math.abs(number) < 0.05) return '0%'
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`
}

function formatTrendValue(metric, value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return metric.format(Number(value))
}

function formatTrendDelta(metric, value) {
  const number = Number(value || 0)
  if (metric.key === 'revenue') return `${number >= 0 ? '+' : '-'}${money(Math.abs(number))}`
  return `${number >= 0 ? '+' : ''}${Math.round(number).toLocaleString('en-PH')}`
}

function TrendInsightGrid({ report, trend, metric, granularity, comparisonHint, comparisonPct }) {
  const currentTotal = metric.key === 'revenue' ? report.summary.netRevenue : metric.key === 'orders' ? report.summary.totalOrders : report.summary.totalItems
  const previousTotal = metric.key === 'revenue' ? report.previousSummary.netRevenue : metric.key === 'orders' ? report.previousSummary.totalOrders : report.previousSummary.totalItems
  const activePoints = trend.filter((point) => point[metric.key] > 0)
  const peak = activePoints.reduce((best, point) => (!best || point[metric.key] > best[metric.key] ? point : best), null)
  const slowest = activePoints.length > 1 ? activePoints.reduce((best, point) => (!best || point[metric.key] < best[metric.key] ? point : best), null) : null
  const average = activePoints.length ? currentTotal / activePoints.length : 0
  const periodUnit = granularity === 'day' ? 'day' : granularity === 'week' ? 'week' : 'month'

  return (
    <section className="srp-trend-insights" aria-label="Sales trend insights">
      <TrendStatCard label={`${metric.label} growth`} value={trendPercent(comparisonPct(currentTotal, previousTotal))} detail={comparisonHint} />
      <TrendStatCard label={`Peak ${periodUnit}`} value={peak ? formatTrendValue(metric, peak[metric.key]) : '—'} detail={peak?.label || 'No settled sales yet'} />
      <TrendStatCard label={`Slowest ${periodUnit}`} value={slowest ? formatTrendValue(metric, slowest[metric.key]) : '—'} detail={slowest ? slowest.label : 'Need at least two active periods'} />
      <TrendStatCard label={`Average / ${periodUnit}`} value={formatTrendValue(metric, average)} detail={activePoints.length ? `${activePoints.length} active ${periodUnit}${activePoints.length === 1 ? '' : 's'}` : 'No settled sales yet'} />
    </section>
  )
}

function TrendStatCard({ label, value, detail }) {
  return <SummaryCard label={label} value={value} detail={detail} className="srp-trend-summary-card" />
}

function TrendAnalyticsChart({ trend, metric }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const hasData = trend.some((point) => point[metric.key] > 0 || (point[metric.previousKey] || 0) > 0)
  if (!trend.length || !hasData) return <EmptyMini text="No sales recorded for this range yet. Completed orders will appear here." />

  const W = 760
  const H = 230
  const PAD = 10
  const value = (point) => Number(point[metric.key] || 0)
  const previousValue = (point) => Number(point[metric.previousKey] || 0)
  const max = Math.max(1, ...trend.map((point) => Math.max(value(point), previousValue(point))))
  const x = (index) => trend.length === 1 ? W / 2 : PAD + (index / (trend.length - 1)) * (W - PAD * 2)
  const y = (amount) => H - 28 - (amount / max) * (H - 52)
  const currentPoints = trend.map((point, index) => [x(index), y(value(point))])
  const linePath = currentPoints.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0]},${point[1]}`).join(' ')
  const areaPath = `${linePath} L${currentPoints[currentPoints.length - 1][0]},${H - 24} L${currentPoints[0][0]},${H - 24} Z`
  const previousPoints = trend.filter((point) => point[metric.previousKey] != null)
  const prevPath = trend.map((point, index) => point[metric.previousKey] == null ? null : `${x(index)},${y(previousValue(point))}`)
    .filter(Boolean)
    .map((coords, index) => `${index === 0 ? 'M' : 'L'}${coords}`)
    .join(' ')
  const hovered = hoverIndex != null ? trend[hoverIndex] : null
  const labelStep = Math.max(1, Math.ceil(trend.length / 8))

  return (
    <div className={`srp-trend-chart srp-trend-analytics-chart ${hovered ? 'is-hovering' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby="trend-analytics-title trend-analytics-description">
        <title id="trend-analytics-title">{metric.label} trend</title>
        <desc id="trend-analytics-description">Current period {metric.label.toLowerCase()} is shown with a solid line. The previous period is shown with a dashed line.</desc>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PAD} x2={W - PAD} y1={y(max * f)} y2={y(max * f)} className="srp-grid-line" />)}
        {hovered && <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={12} y2={H - 24} className="dash-hover-guide" />}
        {previousPoints.length > 1 && <path d={prevPath} fill="none" className="srp-prev-line" />}
        <path d={areaPath} fill="url(#srpTrendAnalyticsFade)" />
        <path d={linePath} fill="none" className="srp-current-line" />
        <defs>
          <linearGradient id="srpTrendAnalyticsFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f5c46" stopOpacity=".24" />
            <stop offset="1" stopColor="#2f5c46" stopOpacity="0" />
          </linearGradient>
        </defs>
        {trend.map((point, index) => (
          <g key={point.key}>
            <circle cx={x(index)} cy={y(value(point))} r={hoverIndex === index ? 5.5 : 3.5} className={`srp-dot ${hoverIndex === index ? 'is-active' : ''}`} />
            <circle cx={x(index)} cy={y(value(point))} r="22" fill="transparent" tabIndex={0} role="img"
              aria-label={`${point.label}: ${formatTrendValue(metric, value(point))}${point[metric.previousKey] != null ? `, previous period ${formatTrendValue(metric, previousValue(point))}` : ''}`}
              onMouseEnter={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex((current) => (current === index ? null : current))}
              onFocus={() => setHoverIndex(index)} onBlur={() => setHoverIndex((current) => (current === index ? null : current))} />
          </g>
        ))}
      </svg>
      {hovered && (
        <div className="dash-chart-tooltip srp-trend-tooltip" style={{ left: `${(x(hoverIndex) / W) * 100}%`, top: `${(y(value(hovered)) / H) * 100}%` }}>
          <b>{hovered.label}</b>
          <span><i /> {formatTrendValue(metric, value(hovered))}</span>
          {hovered[metric.previousKey] != null && <span className="srp-tooltip-prev"><i /> Prev: {formatTrendValue(metric, previousValue(hovered))}</span>}
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
            <thead><tr><th>Period</th><th className="srp-num">{metric.label}</th><th className="srp-num">Previous period</th></tr></thead>
            <tbody>{trend.map((point) => <tr key={point.key}><td>{point.label}</td><td className="srp-num">{formatTrendValue(metric, value(point))}</td><td className="srp-num">{point[metric.previousKey] == null ? '-' : formatTrendValue(metric, previousValue(point))}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

const TREND_CHANNELS = [
  { key: 'walk-in', label: ORDER_TYPE_LABEL['walk-in'], color: 'var(--mgmt-primary)' },
  { key: 'pickup', label: ORDER_TYPE_LABEL.pickup, color: '#c39b50' },
  { key: 'delivery', label: ORDER_TYPE_LABEL.delivery, color: '#5887a0' },
]

function ChannelTrendPanel({ channelTrend }) {
  const hasData = channelTrend.some((point) => point.total > 0)
  const max = Math.max(1, ...channelTrend.map((point) => point.total))
  const labelStep = Math.max(1, Math.ceil(channelTrend.length / 7))
  return (
    <section className="panel srp-trend-secondary-panel srp-channel-trend-panel" aria-labelledby="channel-trend-title">
      <div className="panel-head"><div className="srp-trend-panel-title"><span className="srp-trend-heading-icon is-channel" aria-hidden="true"><ShoppingBag size={16} /></span><div><span id="channel-trend-title">Sales by channel</span><small>Completed paid orders over time</small></div></div></div>
      {hasData ? (
        <>
          <div className="srp-channel-trend-chart" role="img" aria-label="Completed paid orders by sales channel over time">
            <div className="srp-channel-trend-plot">
              {channelTrend.map((point, index) => (
                <div className="srp-channel-trend-column" key={point.key} aria-label={`${point.label}: ${point.total} completed paid orders`}>
                  <div className="srp-channel-trend-bar" style={{ height: point.total ? `${Math.max(8, (point.total / max) * 100)}%` : '0%' }}>
                    {TREND_CHANNELS.map((channel) => <i key={channel.key} style={{ flex: point[channel.key], background: channel.color }} />)}
                  </div>
                  {index % labelStep === 0 && <span>{point.label}</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="srp-channel-trend-legend">
            {TREND_CHANNELS.map((channel) => <span key={channel.key}><i style={{ background: channel.color }} /> {channel.label}</span>)}
          </div>
        </>
      ) : <EmptyMini text="No channel activity in this period yet." />}
    </section>
  )
}

function TrendInsightsPanel({ trend, metric, channelTrend, productMomentum, granularity }) {
  const activePoints = trend.filter((point) => point[metric.key] > 0)
  const peak = activePoints.reduce((best, point) => (!best || point[metric.key] > best[metric.key] ? point : best), null)
  const channelTotals = TREND_CHANNELS.map((channel) => ({ ...channel, total: channelTrend.reduce((sum, point) => sum + point[channel.key], 0) }))
  const leadingChannel = channelTotals.reduce((best, channel) => (!best || channel.total > best.total ? channel : best), null)
  const growingProduct = productMomentum.find((product) => product.direction === 'up')
  const decliningProduct = productMomentum.find((product) => product.direction === 'down')
  const insights = []
  if (peak) insights.push({ icon: BarChart3, title: `${peak.label} led performance`, detail: `${formatTrendValue(metric, peak[metric.key])} in ${granularity} revenue activity.`, tone: 'green' })
  if (leadingChannel?.total) insights.push({ icon: ShoppingBag, title: `${leadingChannel.label} is the leading channel`, detail: `${leadingChannel.total.toLocaleString('en-PH')} completed paid orders in this range.`, tone: 'gold' })
  if (growingProduct) insights.push({ icon: TrendingUp, title: `${growingProduct.name} is gaining momentum`, detail: `${formatTrendDelta(TREND_METRICS[0], growingProduct.revenueDelta)} vs the previous period.`, tone: 'blue' })
  if (decliningProduct && insights.length < 4) insights.push({ icon: TrendingDown, title: `${decliningProduct.name} needs attention`, detail: `${formatTrendDelta(TREND_METRICS[0], decliningProduct.revenueDelta)} vs the previous period.`, tone: 'rose' })

  return (
    <section className="panel srp-trend-secondary-panel srp-trend-insights-panel" aria-labelledby="insights-title">
      <div className="panel-head"><div><span id="insights-title">Insights</span><small>Signals from the selected period</small></div></div>
      {insights.length ? <ul className="srp-trend-insight-list">{insights.map(({ icon: Icon, title, detail, tone }) => <li key={title} className={`tone-${tone}`}><span aria-hidden="true"><Icon size={15} /></span><div><b>{title}</b><small>{detail}</small></div></li>)}</ul> : <EmptyMini text="More completed sales will unlock trend insights." />}
    </section>
  )
}

function ProductMomentumPanel({ products }) {
  const maxAbsChange = Math.max(
    products.reduce((largest, product) => Math.max(largest, Math.abs(Number(product.changePct) || 0)), 0),
    1,
  )
  const directionMeta = {
    up: { label: 'Growing', Icon: TrendingUp },
    down: { label: 'Declining', Icon: TrendingDown },
    flat: { label: 'Stable', Icon: Minus },
  }

  return (
    <section className="panel srp-trend-secondary-panel srp-product-momentum-panel" aria-labelledby="product-momentum-title">
      <div className="panel-head srp-momentum-panel-head">
        <div className="srp-momentum-panel-title">
          <div><span id="product-momentum-title">Product momentum</span><small>Revenue movement vs the previous period</small></div>
        </div>
        {products.length ? <span className="srp-momentum-count" aria-label={`${products.length} products tracked`}>{products.length} tracked</span> : null}
      </div>
      {products.length ? (
        <>
          <div className="srp-momentum-legend" aria-label="Momentum legend">
            <span><i className="is-up" aria-hidden="true"><TrendingUp size={12} /></i>Growing</span>
            <span><i className="is-down" aria-hidden="true"><TrendingDown size={12} /></i>Declining</span>
            <span><i className="is-flat" aria-hidden="true"><Minus size={12} /></i>Stable</span>
          </div>
          <div className="srp-momentum-table" role="table" aria-label="Product momentum" aria-rowcount={products.length + 1}>
            <div className="srp-momentum-head" role="row">
              <span role="columnheader">Product</span>
              <span role="columnheader">Current revenue</span>
              <span role="columnheader">Change</span>
              <span role="columnheader">Units change</span>
            </div>
            {products.map((product, index) => {
              const { label, Icon } = directionMeta[product.direction] || directionMeta.flat
              const movementWidth = product.direction === 'flat'
                ? 0
                : Math.min(100, Math.max(12, (Math.abs(Number(product.changePct) || 0) / maxAbsChange) * 100))
              return (
                <div className={`srp-momentum-row${index === 0 ? ' is-leading' : ''}`} role="row" aria-rowindex={index + 2} key={product.name}>
                  <div className="srp-momentum-product" role="cell">
                    <span className="srp-momentum-rank" aria-label={`Rank ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
                    <div className="srp-momentum-product-copy"><b>{product.name}</b><small>{product.category}</small></div>
                  </div>
                  <strong role="cell"><span>{money(product.revenue)}</span><small className="srp-momentum-value-label">Current revenue</small></strong>
                  <span className={`srp-momentum-delta is-${product.direction}`} role="cell" aria-label={`Revenue change: ${formatTrendDelta(TREND_METRICS[0], product.revenueDelta)}, ${trendPercent(product.changePct)}, ${label}`}>
                    <span className="srp-momentum-delta-main">
                      <span className="srp-momentum-delta-icon" aria-hidden="true"><Icon size={13} /></span>
                      <span className="srp-momentum-delta-copy"><b>{formatTrendDelta(TREND_METRICS[0], product.revenueDelta)}</b><small>{trendPercent(product.changePct)} <span aria-hidden="true">·</span> {label}</small></span>
                    </span>
                    <span className="srp-momentum-delta-bar" aria-hidden="true"><i style={{ width: `${movementWidth}%` }} /></span>
                  </span>
                  <span className="srp-momentum-units" role="cell" aria-label={`Units change: ${formatTrendDelta(TREND_METRICS[2], product.unitsDelta)}`}><span>{formatTrendDelta(TREND_METRICS[2], product.unitsDelta)}</span><small>units</small></span>
                </div>
              )
            })}
          </div>
        </>
      ) : <EmptyMini text="No product movement in this period yet." />}
    </section>
  )
}

function ProductPerformanceTable({ products, title = 'Top-Selling Products', description = 'Top five products ranked by revenue', emptyText = 'No product sales in the selected range.', sortValue, onSortChange }) {
  const visibleProducts = products.slice(0, 5)
  const titleId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-title`
  return (
    <section className="panel dash-panel srp-products-panel srp-product-performance-panel" aria-labelledby={titleId}>
      <div className="panel-head">
        <div><span id={titleId}>{title}</span><small>{description}</small></div>
        {onSortChange && (
          <label className="srp-sort-control"><span>Sort by</span>
            <select value={sortValue} onChange={(event) => onSortChange(event.target.value)} aria-label="Sort product performance">
              <option value="revenue">Revenue</option>
              <option value="qty">Units sold</option>
            </select>
          </label>
        )}
      </div>
      {visibleProducts.length === 0 ? (
        <EmptyMini text={emptyText} />
      ) : (
        <>
          <div className="inv-table-wrap srp-products-wrap srp-products-desktop">
            <table className="inv-table srp-products-table">
              <thead><tr><th>#</th><th>Product</th><th>Category</th><th className="srp-num">Qty Sold</th><th className="srp-num">Revenue</th><th className="srp-share-col">Contribution</th></tr></thead>
              <tbody>
                {visibleProducts.map((product, index) => (
                  <tr key={`${product.name}-${index}`} className="srp-product-row">
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
          <div className="srp-product-cards" aria-label={`${title} cards`}>
            {visibleProducts.map((product, index) => (
              <article className="srp-product-card" key={`${product.name}-card-${index}`}>
                <header>
                  <span className="srp-rank">{index + 1}</span>
                  <div><b>{product.name}</b><small>{product.category}</small></div>
                  <strong>{money(product.revenue)}</strong>
                </header>
                <dl>
                  <div><dt>Units sold</dt><dd>{product.qty.toLocaleString('en-PH')}</dd></div>
                  <div><dt>Contribution</dt><dd>{product.pct.toFixed(1)}%</dd></div>
                </dl>
                <div className="srp-share srp-product-card-share"><span>Revenue share</span><div className="srp-share-bar"><i style={{ width: `${Math.max(2, product.pct)}%` }} /></div></div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function SummaryCard({ icon: Icon, label, value, pct = 0, hint = '', tone = 'sage', invert = false, featured = false, detail = '', className = '', children }) {
  const rounded = Math.round(pct)
  const isFlat = rounded === 0
  const isGood = invert ? rounded < 0 : rounded > 0
  return (
    <article className={`metric-card dash-kpi-card metric-${tone} srp-kpi-card${featured ? ' srp-kpi-featured' : ''}${className ? ` ${className}` : ''}`}>
      <div className="dash-kpi-top">{Icon ? <div className="metric-icon"><Icon size={18} /></div> : null}<span>{label}</span></div>
      <strong>{value}</strong>
      <small>
        {detail ? <span className="srp-kpi-detail">{detail}</span> : isFlat ? <span className="srp-trend-flat">No change {hint}</span> : (
          <span className={isGood ? 'dash-trend-up' : 'dash-trend-down'}>
            {rounded > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {Math.abs(rounded)}% {rounded > 0 ? 'higher' : 'lower'} {hint}
          </span>
        )}
      </small>
      {children}
    </article>
  )
}

function RevenueReconciliation({ summary }) {
  return (
    <div className="srp-net-revenue-breakdown" aria-label="Revenue reconciliation">
      <div><span>Gross Sales</span><b>{money(summary.grossSales)}</b></div>
      <div><span>Discounts</span><b>- {money(summary.discounts)}</b></div>
      <div><span>Refunds</span><b>- {money(summary.refunds)}</b></div>
      <div><span>Delivery Fees <small>Excluded from revenue</small></span><b>{money(summary.deliveryFees)}</b></div>
      <div><span>Cancelled</span><b>{summary.cancelledOrders.toLocaleString('en-PH')}</b></div>
    </div>
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
  const linePath = smoothLinePath(currentPoints)
  const areaPath = `${linePath} L${currentPoints[currentPoints.length - 1][0]},${H - 22} L${currentPoints[0][0]},${H - 22} Z`

  const previousPoints = trend.filter((point) => point.previousRevenue != null)
  const previousCoordinates = trend
    .map((point, index) => point.previousRevenue == null ? null : [x(index), y(point.previousRevenue)])
    .filter(Boolean)
  const prevPath = smoothLinePath(previousCoordinates)

  const hovered = hoverIndex != null ? trend[hoverIndex] : null
  const labelStep = Math.max(1, Math.ceil(trend.length / 8))
  const chartKey = trend.map((point) => `${point.key}:${point.revenue}:${point.previousRevenue ?? ''}`).join('|')

  return (
    <div className={`srp-trend-chart ${hovered ? 'is-hovering' : ''}`}>
      <svg key={chartKey} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-labelledby="sales-trend-title sales-trend-description">
        <defs>
          <linearGradient id="srpFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f5c46" stopOpacity=".24" />
            <stop offset="1" stopColor="#2f5c46" stopOpacity="0" />
          </linearGradient>
          <clipPath id="srpSalesRevealClip">
            <rect
              key={`srp-clip-${chartKey}`}
              className="srp-sales-line-clip"
              x={PAD - 6}
              y="0"
              width={W - PAD * 2 + 12}
              height={H}
              style={{ animationDuration: `${SALES_GRAPH_DURATION}s` }}
            />
          </clipPath>
        </defs>
        <title id="sales-trend-title">Net revenue trend</title>
        <desc id="sales-trend-description">Current period net revenue is shown with a solid line. The previous period is shown with a dashed line.</desc>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={PAD} x2={W - PAD} y1={y(max * f)} y2={y(max * f)} className="srp-grid-line" />)}
        {hovered && <line x1={x(hoverIndex)} x2={x(hoverIndex)} y1={12} y2={H - 22} className="dash-hover-guide" />}
        {previousPoints.length > 1 && <path d={prevPath} fill="none" clipPath="url(#srpSalesRevealClip)" className="srp-prev-line" />}
        <path d={areaPath} fill="url(#srpFade)" clipPath="url(#srpSalesRevealClip)" className="srp-current-area" />
        <path d={linePath} fill="none" clipPath="url(#srpSalesRevealClip)" className="srp-current-line" vectorEffect="non-scaling-stroke" />
        {trend.map((point, index) => (
          <g key={point.key} className="srp-chart-point" style={{ '--srp-point-delay': `${chartEaseTimelinePosition(index / Math.max(1, trend.length - 1)) * SALES_GRAPH_DURATION}s` }}>
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

function OrderTypeMix({ counts, total }) {
  if (!total) return <EmptyMini text="No completed paid orders in the selected range." />
  const entries = ['delivery', 'pickup', 'walk-in'].map((key) => ({
    key,
    label: ORDER_TYPE_LABEL[key],
    value: Number(counts[key] || 0),
  }))

  return (
    <ul className="srp-channel-list" aria-label="Completed paid orders by channel">
      {entries.map(({ key, label, value }, index) => {
        const Icon = ORDER_TYPE_ICON[key] || ShoppingBag
        const percentage = Math.round((value / total) * 100)
        return (
          <li className={`srp-channel-row srp-channel-row-animated${value === 0 ? ' is-empty' : ''}`} key={key} style={{ '--srp-channel-delay': `${index * 75}ms` }} aria-label={`${label}: ${value.toLocaleString('en-PH')} completed paid orders, ${percentage}% of total`}>
            <div className="srp-channel-meta">
              <span className="srp-channel-icon" aria-hidden="true"><Icon size={15} /></span>
              <div><b>{label}</b><small>{value.toLocaleString('en-PH')} orders</small></div>
            </div>
            <div className="srp-channel-progress" aria-hidden="true"><i style={{ '--srp-channel-width': `${value ? Math.max(6, percentage) : 0}%` }} /></div>
            <div className="srp-channel-stat"><b>{percentage}%</b><small>share</small></div>
          </li>
        )
      })}
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
  const chartKey = segments.map((segment) => `${segment.key}:${segment.value}`).join('|')
  return (
    <div className="dash-doughnut-wrap srp-donut-wrap">
      <div className="dash-doughnut-svg-box">
        <svg key={chartKey} viewBox="0 0 160 160" className="dash-doughnut" role="img" aria-labelledby="payment-share-title payment-share-description">
          <title id="payment-share-title">Revenue by payment method</title>
          <desc id="payment-share-description">A proportion chart showing each payment method's share of net revenue. Exact values are listed beside the chart.</desc>
          <circle cx="80" cy="80" r={r} fill="none" className="srp-donut-track" strokeWidth="20" />
          {segments.map((segment) => (
            <circle key={segment.key} cx="80" cy="80" r={r} fill="none"
              stroke={PAYMENT_COLOR[segment.key] || PAYMENT_COLOR.other}
              strokeOpacity={hoverKey && hoverKey !== segment.key ? 0.3 : 1}
              strokeWidth={hoverKey === segment.key ? 24 : 20}
              transform="rotate(-90 80 80)"
              className="dash-doughnut-seg srp-donut-seg-enter"
              style={{ '--srp-donut-dash': segment.dash, '--srp-donut-gap': c - segment.dash, '--srp-donut-offset': -segment.offset, '--srp-donut-delay': `${segments.indexOf(segment) * 80}ms` }}
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
      <div className="inv-skeleton-row srp-skel-filter" />
      <div className="srp-overview-grid">
        <div className="inv-skeleton-row dash-skel-card" />
        <div className="srp-support-kpis">{Array.from({ length: 3 }).map((_, index) => <div className="inv-skeleton-row dash-skel-card" key={index} />)}</div>
      </div>
      <div className="inv-skeleton-row srp-skel-reconciliation" />
      <div className="inv-skeleton-row srp-skel-trend" />
      <div className="inv-skeleton-row dash-skel-panel" />
    </div>
  )
}
