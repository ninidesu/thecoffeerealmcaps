import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, Ban, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  Download, FileSearch, Filter, MoreVertical, PhilippinePeso, ReceiptText, RefreshCw,
  RotateCcw, Search, ShieldAlert, SlidersHorizontal, Undo2, UserRound, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import { money } from '../utils/money'
import {
  buildCancellationTrend, computeCancellationSummary, fetchCancellationReportRecords,
  filterByDateRange, ORDER_TYPE_LABEL, PAYMENT_LABEL, printCancellationReport,
  REFUND_STATUS_LABEL,
} from '../services/cancellationReportService'

const PAGE_SIZES = [10, 20, 50]
const PRESETS = [
  ['7', '7 Days'],
  ['30', '30 Days'],
  ['90', '90 Days'],
  ['custom', 'Custom'],
]

function startOfDay(value) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function endOfDay(value) {
  const date = new Date(value)
  date.setHours(23, 59, 59, 999)
  return date
}

function formatInputDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTime(value) {
  if (!value) return 'Not recorded'
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(value))
}

function formatRange(from, to) {
  const format = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${format.format(new Date(from))} - ${format.format(new Date(to))}`
}

function startCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function useReportRange(preset, customFrom, customTo) {
  return useMemo(() => {
    const today = new Date()
    const to = preset === 'custom' && customTo ? endOfDay(`${customTo}T00:00:00`) : endOfDay(today)
    const from = preset === 'custom' && customFrom ? startOfDay(`${customFrom}T00:00:00`) : startOfDay(today)
    if (preset !== 'custom') from.setDate(from.getDate() - Number(preset) + 1)
    const duration = Math.max(86400000, to.getTime() - from.getTime() + 1)
    const previousTo = new Date(from.getTime() - 1)
    const previousFrom = new Date(previousTo.getTime() - duration + 1)
    return { from, to, previousFrom, previousTo, label: formatRange(from, to) }
  }, [preset, customFrom, customTo])
}

function trendMeta(change) {
  if (!Number.isFinite(change) || Math.abs(change) < 0.05) return { label: 'No change', direction: 'flat' }
  return { label: `${Math.abs(change).toFixed(1)}%`, direction: change > 0 ? 'up' : 'down' }
}

function MetricCard({ icon: Icon, label, value, change, tone = 'sage', detail }) {
  const trend = trendMeta(change)
  const TrendIcon = trend.direction === 'up' ? ArrowUp : trend.direction === 'down' ? ArrowDown : null
  return (
    <article className={`cancel-metric cancel-tone-${tone}`}>
      <div className="cancel-metric-top"><span>{label}</span><i><Icon size={18} /></i></div>
      <strong title={typeof value === 'string' ? value : undefined}>{value}</strong>
      {detail && <small className="cancel-metric-detail">{detail}</small>}
      <footer className={`cancel-compare is-${trend.direction}`}>
        {TrendIcon && <TrendIcon size={13} />}
        <b>{trend.label}</b><span>vs previous period</span>
      </footer>
    </article>
  )
}

function CompactEmpty({ type = 'cancellation', text }) {
  const Icon = type === 'refund' ? Undo2 : FileSearch
  return <div className="cancel-empty-mini"><span><Icon size={20} /></span><p>{text}</p></div>
}

function BreakdownChart({ title, subtitle, data, type, colors = ['#315c45', '#6e8d77', '#a8b8aa', '#c8a86b', '#9a6b5f'] }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, value]) => sum + value, 0)
  return (
    <article className="panel cancel-panel cancel-breakdown-panel">
      <div className="panel-head"><div><span>{title}</span><small>{subtitle}</small></div>{total > 0 && <b className="cancel-panel-total">{total}</b>}</div>
      {!entries.length ? <CompactEmpty type={type} text={`No ${type === 'refund' ? 'refunds' : 'cancellations'} recorded for this period.`} /> : (
        <ul className="cancel-bars">
          {entries.slice(0, 5).map(([label, value], index) => (
            <li key={label}>
              <div><span title={label}>{label}</span><b>{value} <small>{total ? Math.round((value / total) * 100) : 0}%</small></b></div>
              <i><span style={{ width: `${(value / entries[0][1]) * 100}%`, background: colors[index % colors.length] }} /></i>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function TrendChart({ points, granularity, onGranularityChange }) {
  const width = 760
  const height = 230
  const inset = { left: 34, right: 16, top: 20, bottom: 34 }
  const chartWidth = width - inset.left - inset.right
  const chartHeight = height - inset.top - inset.bottom
  const maximum = Math.max(1, ...points.flatMap((point) => [point.cancellations, point.refunds]))
  const xFor = (index) => inset.left + (points.length <= 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth)
  const yFor = (value) => inset.top + chartHeight - (value / maximum) * chartHeight
  const pathFor = (key) => points.map((point, index) => `${index ? 'L' : 'M'} ${xFor(index)} ${yFor(point[key])}`).join(' ')
  const labels = points.length > 8 ? points.filter((_, index) => index % Math.ceil(points.length / 7) === 0 || index === points.length - 1) : points

  return (
    <article className="panel cancel-panel cancel-trend-panel">
      <div className="panel-head">
        <div><span>Cancellation vs Refund Trend</span><small>Changes across the selected period</small></div>
        <div className="cancel-segmented" aria-label="Trend interval">
          {['day', 'week', 'month'].map((item) => <button type="button" className={granularity === item ? 'active' : ''} onClick={() => onGranularityChange(item)} key={item}>{startCase(item)}</button>)}
        </div>
      </div>
      {!points.some((point) => point.cancellations || point.refunds) ? <CompactEmpty text="No report activity to chart in this period." /> : (
        <div className="cancel-trend-chart">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cancellation and refund trend chart">
            {[0, .25, .5, .75, 1].map((position) => <line key={position} x1={inset.left} x2={width - inset.right} y1={inset.top + chartHeight * position} y2={inset.top + chartHeight * position} className="cancel-grid-line" />)}
            <path d={pathFor('cancellations')} className="cancel-line cancel-line-cancelled" />
            <path d={pathFor('refunds')} className="cancel-line cancel-line-refunded" />
            {points.map((point, index) => <g key={point.key}>
              <circle cx={xFor(index)} cy={yFor(point.cancellations)} r="4" className="cancel-dot cancel-dot-cancelled"><title>{point.label}: {point.cancellations} cancellations</title></circle>
              <circle cx={xFor(index)} cy={yFor(point.refunds)} r="4" className="cancel-dot cancel-dot-refunded"><title>{point.label}: {point.refunds} refunds</title></circle>
            </g>)}
            {labels.map((point) => {
              const index = points.indexOf(point)
              return <text key={`label-${point.key}`} x={xFor(index)} y={height - 8} textAnchor="middle" className="cancel-axis-label">{point.label}</text>
            })}
          </svg>
          <div className="cancel-chart-legend"><span><i className="cancelled" />Cancellations</span><span><i className="refunded" />Refunds completed</span></div>
        </div>
      )}
    </article>
  )
}

function StatusBadge({ type, value }) {
  const normalized = String(value || '').toLowerCase().replace(/\s+/g, '-')
  return <span className={`cancel-status cancel-status-${type} is-${normalized}`}>{value}</span>
}

function formatOptionSummary(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.map((item) => typeof item === 'string' ? item : item?.name || item?.label).filter(Boolean).join(', ')
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${startCase(key)}: ${item}`).join(' · ')
  return String(value)
}

function RecordDrawer({ record, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const timeline = [
    { title: 'Order placed', date: record.createdAt, text: `${ORDER_TYPE_LABEL[record.orderType] || startCase(record.orderType)} order created.` },
    record.cancelledAt && { title: record.isVoided ? 'Transaction voided' : 'Order cancelled', date: record.cancelledAt, text: `${record.cancellationReason} · ${record.cancelledBy}` },
    ...record.refunds.flatMap((refund) => [
      refund.requestedAt && { title: 'Refund requested', date: refund.requestedAt, text: `${money(refund.amount)} · ${refund.reason || 'No reason supplied'}` },
      refund.processedAt && { title: 'Refund completed', date: refund.processedAt, text: refund.referenceNumber ? `Reference ${refund.referenceNumber}` : money(refund.amount) },
    ]),
  ].filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date))

  return <div className="ops-drawer-backdrop cancel-drawer-backdrop" onMouseDown={onClose}>
    <aside className="ops-drawer txn-drawer cancel-drawer" role="dialog" aria-modal="true" aria-label={`Cancellation record ${record.orderNumber}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">Cancellation record</span><h2>{record.orderNumber}</h2><small>{record.receiptNumber || 'No receipt reference'}</small></div><button type="button" onClick={onClose} aria-label="Close details"><X size={19} /></button></header>
      <div className="ops-drawer-body">
        <section>
          <div className="cancel-drawer-statuses"><StatusBadge type="order" value={record.isVoided ? 'Voided' : record.status} /><StatusBadge type="refund" value={REFUND_STATUS_LABEL[record.refundStatus] || startCase(record.refundStatus)} /></div>
          <div className="txn-detail-grid">
            <div><span>Customer</span><b>{record.customerName}</b></div>
            <div><span>Order type</span><b>{ORDER_TYPE_LABEL[record.orderType] || startCase(record.orderType)}</b></div>
            <div><span>Original amount</span><b>{money(record.originalAmount)}</b></div>
            <div><span>Refund amount</span><b>{money(record.refundAmount)}</b></div>
            <div><span>Payment</span><b>{PAYMENT_LABEL[record.paymentMethod] || startCase(record.paymentMethod)} · {startCase(record.paymentStatus)}</b></div>
            <div><span>Responsible user</span><b>{record.cancelledBy}</b></div>
            <div className="wide"><span>Reason</span><b>{record.cancellationReason}{record.cancellationNotes ? ` — ${record.cancellationNotes}` : ''}</b></div>
            <div className="wide"><span>Payment reference</span><b>{record.paymentReference || 'Not provided'}</b></div>
          </div>
        </section>
        <section><h3>Order items</h3>{record.items.length ? <ul className="txn-item-list">{record.items.map((item) => {
          const options = [formatOptionSummary(item.customizations), formatOptionSummary(item.addons)].filter(Boolean).join(' · ')
          return <li key={item.id}><div><span>{item.quantity}× {item.name}</span><b>{money(item.lineTotal)}</b></div>{options && <small>{options}</small>}<small>Original unit price: {money(item.unitPrice)}</small></li>
        })}</ul> : <CompactEmpty text="No stored item snapshots are available." />}</section>
        <section><h3>Amount breakdown</h3><div className="cancel-amount-list"><p><span>Subtotal</span><b>{money(record.subtotal)}</b></p><p><span>Discount</span><b>- {money(record.discountAmount)}</b></p><p><span>Delivery fee</span><b>{money(record.deliveryFee)}</b></p><p className="total"><span>Original total</span><b>{money(record.originalAmount)}</b></p><p className="refund"><span>Refunded</span><b>{money(record.refundAmount)}</b></p></div></section>
        <section><h3>Cancellation timeline</h3><ol className="txn-timeline">{timeline.map((item, index) => <li key={`${item.title}-${index}`}><span>{index === timeline.length - 1 ? <CheckCircle2 size={16} /> : <CalendarDays size={16} />}</span><div><b>{item.title}</b><small>{formatDateTime(item.date)}</small><p>{item.text}</p></div></li>)}</ol></section>
      </div>
    </aside>
  </div>
}

function RecordsSkeleton() {
  return <div className="cancel-skeleton"><div className="cancel-skeleton-metrics">{Array.from({ length: 4 }).map((_, index) => <i key={index} />)}</div><div className="cancel-skeleton-charts"><i /><i /></div><i className="cancel-skeleton-wide" /><i className="cancel-skeleton-table" /></div>
}

export default function CancellationReportPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [preset, setPreset] = useState('7')
  const [customFrom, setCustomFrom] = useState(formatInputDate(new Date(Date.now() - 6 * 86400000)))
  const [customTo, setCustomTo] = useState(formatInputDate(new Date()))
  const [granularity, setGranularity] = useState('day')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [reason, setReason] = useState('all')
  const [orderType, setOrderType] = useState('all')
  const [paymentMethod, setPaymentMethod] = useState('all')
  const [refundStatus, setRefundStatus] = useState('all')
  const [cancelledBy, setCancelledBy] = useState('all')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [rowMenuId, setRowMenuId] = useState('')
  const [detailRecord, setDetailRecord] = useState(null)
  const deferredSearch = useDeferredValue(search)
  const range = useReportRange(preset, customFrom, customTo)

  const load = async () => {
    setLoading(true)
    try {
      const result = await fetchCancellationReportRecords()
      setRecords(result.records)
      setTruncated(result.truncated)
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load cancellation records.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const closeMenu = () => setRowMenuId('')
    document.addEventListener('click', closeMenu)
    return () => document.removeEventListener('click', closeMenu)
  }, [])

  const currentPeriod = useMemo(() => filterByDateRange(records, range.from, range.to), [records, range])
  const previousPeriod = useMemo(() => filterByDateRange(records, range.previousFrom, range.previousTo), [records, range])
  const filterRecord = useCallback((record) => {
    if (reason !== 'all' && record.cancellationReason !== reason) return false
    if (orderType !== 'all' && record.orderType !== orderType) return false
    if (paymentMethod !== 'all' && record.paymentMethod !== paymentMethod) return false
    if (refundStatus !== 'all' && record.refundStatus !== refundStatus) return false
    if (cancelledBy !== 'all' && record.cancelledByKey !== cancelledBy) return false
    if (minAmount !== '' && record.originalAmount < Number(minAmount)) return false
    if (maxAmount !== '' && record.originalAmount > Number(maxAmount)) return false
    return true
  }, [reason, orderType, paymentMethod, refundStatus, cancelledBy, minAmount, maxAmount])
  const filteredCurrent = useMemo(() => currentPeriod.filter(filterRecord), [currentPeriod, filterRecord])
  const filteredPrevious = useMemo(() => previousPeriod.filter(filterRecord), [previousPeriod, filterRecord])
  const summary = useMemo(() => computeCancellationSummary(filteredCurrent, filteredPrevious), [filteredCurrent, filteredPrevious])
  const trend = useMemo(() => buildCancellationTrend(filteredCurrent, range.from, range.to, granularity), [filteredCurrent, range, granularity])

  const reasons = useMemo(() => [...new Set(currentPeriod.map((record) => record.cancellationReason))].sort(), [currentPeriod])
  const cancelledByOptions = useMemo(() => [...new Set(currentPeriod.map((record) => record.cancelledByKey))].sort(), [currentPeriod])
  const searchedRecords = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim()
    const matching = filteredCurrent.filter((record) => !query || [record.orderNumber, record.receiptNumber, record.customerName, record.cancellationReason, record.cancelledBy].join(' ').toLowerCase().includes(query))
    return [...matching].sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.eventDate) - new Date(b.eventDate)
      if (sortBy === 'highest') return b.originalAmount - a.originalAmount
      if (sortBy === 'lowest') return a.originalAmount - b.originalAmount
      return new Date(b.eventDate) - new Date(a.eventDate)
    })
  }, [filteredCurrent, deferredSearch, sortBy])
  const pageCount = Math.max(1, Math.ceil(searchedRecords.length / pageSize))
  const pageRecords = searchedRecords.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => { setPage(1) }, [deferredSearch, reason, orderType, paymentMethod, refundStatus, cancelledBy, minAmount, maxAmount, sortBy, pageSize, preset, customFrom, customTo])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount])

  const activeFilterCount = [reason, orderType, paymentMethod, refundStatus, cancelledBy].filter((value) => value !== 'all').length + (minAmount !== '' ? 1 : 0) + (maxAmount !== '' ? 1 : 0)
  const resetFilters = () => { setReason('all'); setOrderType('all'); setPaymentMethod('all'); setRefundStatus('all'); setCancelledBy('all'); setMinAmount(''); setMaxAmount('') }

  return <AppShell role="admin" title="Cancellation Report" eyebrow="Review cancellations, refunds, reasons, and their operational impact.">
    <section className="cancel-range-toolbar" aria-label="Report date range">
      <div className="cancel-range-display"><CalendarDays size={16} /><span>{range.label}</span></div>
      <div className="cancel-presets">{PRESETS.map(([value, label]) => <button type="button" className={preset === value ? 'active' : ''} onClick={() => setPreset(value)} key={value}>{label}</button>)}</div>
      {preset === 'custom' && <div className="cancel-custom-range"><label>From<input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><span>to</span><label>To<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}
      <button className="button button-soft cancel-export" type="button" disabled={loading} onClick={() => printCancellationReport({ records: searchedRecords, summary, rangeLabel: range.label })}><Download size={16} /> Export PDF</button>
    </section>

    {error && <div className="cancel-error" role="alert"><ShieldAlert size={19} /><div><b>Report unavailable</b><span>{error}</span></div><button type="button" onClick={load}><RefreshCw size={15} /> Retry</button></div>}
    {loading ? <RecordsSkeleton /> : <div className="cancel-report-enter">
      {truncated && <p className="cancel-limit-note">Showing the newest 5,000 cancellation and refund events.</p>}
      <section className="cancel-metric-grid">
        <MetricCard icon={Ban} label="Total Cancelled Orders" value={summary.cancelledOrders.toLocaleString('en-PH')} change={summary.comparison.cancelled} tone="rose" />
        <MetricCard icon={Undo2} label="Total Refunded Orders" value={summary.refundedOrders.toLocaleString('en-PH')} change={summary.comparison.refunded} tone="gold" />
        <MetricCard icon={PhilippinePeso} label="Cancelled Order Value" value={money(summary.cancelledValue)} change={summary.comparison.value} tone="sage" detail="Order value before any refund" />
        <MetricCard icon={ReceiptText} label="Most Common Reason" value={summary.commonReason} change={summary.comparison.commonReason} tone="blue" detail={summary.commonReasonCount ? `${summary.commonReasonCount} record${summary.commonReasonCount === 1 ? '' : 's'}` : 'No reason recorded'} />
      </section>

      <section className="cancel-reason-grid">
        <BreakdownChart title="Cancellation Reasons Breakdown" subtitle="Why orders were stopped" data={summary.cancellationReasons} type="cancellation" />
        <BreakdownChart title="Refund Reasons Breakdown" subtitle="Why payments were returned" data={summary.refundReasons} type="refund" colors={['#c8a86b', '#927d56', '#c9b989', '#725b46']} />
      </section>

      <section className="cancel-insight-grid">
        <TrendChart points={trend} granularity={granularity} onGranularityChange={setGranularity} />
        <div className="cancel-insight-stack">
          <BreakdownChart title="Cancelled By Breakdown" subtitle="Responsible role or source" data={summary.cancelledBy} type="cancellation" />
          <BreakdownChart title="Refund Status Summary" subtitle="Current refund workflow" data={summary.refundStatuses} type="refund" colors={['#315c45', '#c8a86b', '#9b8cf2', '#a33b35', '#a8b8aa']} />
        </div>
      </section>

      <section className="panel cancel-records-panel">
        <div className="cancel-records-head">
          <div><h2>Cancellation Records</h2><span>{searchedRecords.length} record{searchedRecords.length === 1 ? '' : 's'} in view</span></div>
          <div className="cancel-record-tools">
            <label className="search cancel-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, customer, reason..." aria-label="Search cancellation records" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</label>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort cancellation records"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest amount</option><option value="lowest">Lowest amount</option></select>
            <button className={`button button-soft cancel-filter-button${filtersOpen ? ' active' : ''}`} type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}><Filter size={16} /> Filters {activeFilterCount > 0 && <b>{activeFilterCount}</b>}</button>
          </div>
        </div>

        {filtersOpen && <div className="cancel-filter-panel">
          <div className="cancel-filter-panel-head"><div><span className="eyebrow">Refine records</span><h3>Useful report filters</h3></div><button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X size={17} /></button></div>
          <div className="cancel-filter-grid">
            <label>Cancellation reason<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="all">All reasons</option>{reasons.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
            <label>Order type<select value={orderType} onChange={(event) => setOrderType(event.target.value)}><option value="all">All order types</option>{Object.entries(ORDER_TYPE_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="all">All methods</option>{Object.entries(PAYMENT_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Refund status<select value={refundStatus} onChange={(event) => setRefundStatus(event.target.value)}><option value="all">All refund states</option>{Object.entries(REFUND_STATUS_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>Cancelled by<select value={cancelledBy} onChange={(event) => setCancelledBy(event.target.value)}><option value="all">All roles</option>{cancelledByOptions.map((value) => <option value={value} key={value}>{startCase(value)}</option>)}</select></label>
            <label>Minimum amount<input type="number" min="0" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="PHP 0" /></label>
            <label>Maximum amount<input type="number" min="0" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="No maximum" /></label>
          </div>
          <div className="cancel-filter-actions"><button type="button" className="button button-outline" onClick={resetFilters}><RotateCcw size={15} /> Reset All</button><button type="button" className="button button-dark" onClick={() => setFiltersOpen(false)}>Show {searchedRecords.length} records</button></div>
        </div>}

        {activeFilterCount > 0 && <div className="cancel-active-filters"><SlidersHorizontal size={14} /><span>{activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'}</span><button type="button" onClick={resetFilters}>Clear all</button></div>}

        <div className="cancel-table-wrap">
          <table className="cancel-table"><thead><tr><th>Order ID</th><th>Customer</th><th>Order Type</th><th>Payment</th><th>Amount</th><th>Status</th><th>Reason</th><th>Cancelled By</th><th>Date & Time</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{pageRecords.map((record) => <tr key={record.id} onClick={() => setDetailRecord(record)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setDetailRecord(record) }}>
              <td><b>{record.orderNumber}</b><small>{record.receiptNumber || 'No receipt'}</small></td>
              <td><b>{record.customerName}</b><small>{record.customerEmail || record.customerPhone || 'Guest / no contact'}</small></td>
              <td>{ORDER_TYPE_LABEL[record.orderType] || startCase(record.orderType)}<small>{record.orderSource === 'customer_pos' ? 'Online' : 'In store'}</small></td>
              <td>{PAYMENT_LABEL[record.paymentMethod] || startCase(record.paymentMethod)}<small>{startCase(record.paymentStatus)}</small></td>
              <td className="cancel-amount"><b>{money(record.originalAmount)}</b>{record.refundAmount > 0 && <small>-{money(record.refundAmount)} refunded</small>}</td>
              <td><div className="cancel-status-stack"><StatusBadge type="order" value={record.isVoided ? 'Voided' : record.status} /><StatusBadge type="refund" value={REFUND_STATUS_LABEL[record.refundStatus] || startCase(record.refundStatus)} /></div></td>
              <td className="cancel-reason-cell"><span title={record.cancellationReason}>{record.cancellationReason}</span>{record.cancellationNotes && <small title={record.cancellationNotes}>{record.cancellationNotes}</small>}</td>
              <td>{record.cancelledBy}</td><td>{formatDateTime(record.eventDate)}</td>
              <td className="cancel-action-cell" onClick={(event) => event.stopPropagation()}><button type="button" className="cancel-more" aria-label={`Actions for ${record.orderNumber}`} aria-expanded={rowMenuId === record.id} onClick={(event) => { event.stopPropagation(); setRowMenuId((value) => value === record.id ? '' : record.id) }}><MoreVertical size={17} /></button>{rowMenuId === record.id && <div className="cancel-row-menu" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => { setDetailRecord(record); setRowMenuId('') }}><FileSearch size={15} /> View Details</button><button type="button" onClick={() => navigate('/admin/transactions')}><ReceiptText size={15} /> Transaction History</button></div>}</td>
            </tr>)}</tbody>
          </table>
        </div>

        <div className="cancel-mobile-records">{pageRecords.map((record) => <button type="button" className="cancel-mobile-card" key={record.id} onClick={() => setDetailRecord(record)}><div><span>{record.orderNumber}</span><b>{money(record.originalAmount)}</b></div><strong>{record.customerName}</strong><small>{record.cancellationReason}</small><div><StatusBadge type="order" value={record.isVoided ? 'Voided' : record.status} /><StatusBadge type="refund" value={REFUND_STATUS_LABEL[record.refundStatus]} /></div><footer><span>{record.cancelledBy}</span><time>{formatDateTime(record.eventDate)}</time></footer></button>)}</div>

        {!pageRecords.length && <div className="cancel-empty-state"><span><FileSearch size={27} /></span><h3>No cancellation or refund records found</h3><p>{currentPeriod.length ? 'Try adjusting the search or filters.' : 'There are no report events in this date range.'}</p>{(activeFilterCount > 0 || search) && <button type="button" className="button button-soft" onClick={() => { resetFilters(); setSearch('') }}>Clear filters</button>}</div>}

        {searchedRecords.length > 0 && <footer className="cancel-pagination"><div><span>Rows per page</span><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select></div><span>Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, searchedRecords.length)} of {searchedRecords.length}</span><div className="cancel-page-buttons"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><b>Page {page} of {pageCount}</b><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></footer>}
      </section>
    </div>}
    {detailRecord && <RecordDrawer record={detailRecord} onClose={() => setDetailRecord(null)} />}
  </AppShell>
}
