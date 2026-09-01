import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown, ArrowUp, Ban, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Download, FileSearch, FileText, Filter, MoreVertical, PhilippinePeso, ReceiptText, RefreshCw,
  RotateCcw, Search, ShieldAlert, SlidersHorizontal, Undo2, UserRound, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { usePricing } from '../context/usePricing'
import { describeError } from '../utils/describeError'
import { money } from '../utils/money'
import { buildVatExemptOrderBreakdown, formatVatRate } from '../utils/pricing'
import {
  buildCancellationTrend, computeCancellationSummary, exportCancellationReportToPdf,
  exportCancellationReportToXlsx, fetchCancellationReportRecords, filterByDateRange,
  ORDER_TYPE_LABEL, PAYMENT_LABEL,
  REFUND_STATUS_LABEL,
} from '../services/cancellationReportService'
import { useManagementSessionState } from '../hooks/useManagementSessionState'

const PAGE_SIZES = [10, 20, 50]
const REFUND_ACTION_STATES = new Set(['pending_review', 'pending', 'approved', 'processing'])
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

function percentageChange(current, previous) {
  if (previous > 0) return ((current - previous) / previous) * 100
  return current > 0 ? 100 : 0
}

function hasRefundActivity(record) {
  return record.refundStatus !== 'not_applicable' || record.refunds.length > 0
}

function computeRefundSummary(records, previousRecords) {
  const completed = records.filter((record) => record.refundStatus === 'processed')
  const previousCompleted = previousRecords.filter((record) => record.refundStatus === 'processed')
  const needsAction = records.filter((record) => REFUND_ACTION_STATES.has(record.refundStatus))
  const previousNeedsAction = previousRecords.filter((record) => REFUND_ACTION_STATES.has(record.refundStatus))
  const failed = records.filter((record) => record.refundStatus === 'failed')
  const previousFailed = previousRecords.filter((record) => record.refundStatus === 'failed')
  const completedAmount = completed.reduce((total, record) => total + record.refundAmount, 0)
  const previousCompletedAmount = previousCompleted.reduce((total, record) => total + record.refundAmount, 0)

  return {
    total: records.length,
    needsAction: needsAction.length,
    completed: completed.length,
    failed: failed.length,
    completedAmount,
    comparison: {
      total: percentageChange(records.length, previousRecords.length),
      needsAction: percentageChange(needsAction.length, previousNeedsAction.length),
      completed: percentageChange(completed.length, previousCompleted.length),
      failed: percentageChange(failed.length, previousFailed.length),
      completedAmount: percentageChange(completedAmount, previousCompletedAmount),
    },
  }
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
            <li key={`${label}-${value}`} className="cancel-bar-row" style={{ '--cancel-bar-delay': `${index * 70}ms` }}>
              <div><span title={label}>{label}</span><b>{value} <small>{total ? Math.round((value / total) * 100) : 0}%</small></b></div>
              <i role="img" aria-label={`${label}: ${value} ${type === 'refund' ? 'refunds' : 'cancellations'}`}><span style={{ '--cancel-bar-width': `${(value / entries[0][1]) * 100}%`, background: colors[index % colors.length] }} /></i>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

function TrendChart({ points, granularity, onGranularityChange, view }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const width = 760
  const height = 230
  const inset = { left: 34, right: 16, top: 20, bottom: 34 }
  const chartWidth = width - inset.left - inset.right
  const chartHeight = height - inset.top - inset.bottom
  const seriesKey = view === 'refunds' ? 'refunds' : 'cancellations'
  const seriesLabel = view === 'refunds' ? 'Completed refunds' : 'Cancellations'
  const maximum = Math.max(1, ...points.map((point) => point[seriesKey]))
  const xFor = (index) => inset.left + (points.length <= 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth)
  const yFor = (value) => inset.top + chartHeight - (value / maximum) * chartHeight
  const pathFor = (key) => points.map((point, index) => `${index ? 'L' : 'M'} ${xFor(index)} ${yFor(point[key])}`).join(' ')
  const labels = points.length > 8 ? points.filter((_, index) => index % Math.ceil(points.length / 7) === 0 || index === points.length - 1) : points
  const activePoint = hoverIndex == null ? null : points[hoverIndex]
  const chartKey = `${view}:${points.map((point) => `${point.key}:${point[seriesKey]}`).join('|')}`
  const areaPath = `${pathFor(seriesKey)} L ${xFor(points.length - 1)} ${inset.top + chartHeight} L ${xFor(0)} ${inset.top + chartHeight} Z`

  return (
    <article className="panel cancel-panel cancel-trend-panel">
      <div className="panel-head">
        <div><span>{seriesLabel} trend</span><small>Activity across the selected period</small></div>
        <div className="cancel-segmented" aria-label="Trend interval">
          {['day', 'week', 'month'].map((item) => <button type="button" className={granularity === item ? 'active' : ''} onClick={() => onGranularityChange(item)} key={item}>{startCase(item)}</button>)}
        </div>
      </div>
      {!points.some((point) => point[seriesKey]) ? <CompactEmpty type={view === 'refunds' ? 'refund' : 'cancellation'} text={`No ${seriesLabel.toLowerCase()} to chart in this period.`} /> : (
        <div className="cancel-trend-chart">
          <svg key={chartKey} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${seriesLabel} trend chart`}>
            {[0, .25, .5, .75, 1].map((position) => <line key={position} x1={inset.left} x2={width - inset.right} y1={inset.top + chartHeight * position} y2={inset.top + chartHeight * position} className="cancel-grid-line" />)}
            {activePoint && <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={inset.top} y2={inset.top + chartHeight} className="cancel-hover-guide" />}
            <defs><linearGradient id={`cancelTrendArea-${view}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className={`cancel-area-stop-${view === 'refunds' ? 'refunded' : 'cancelled'}`} /><stop offset="1" className="cancel-area-stop-end" /></linearGradient></defs>
            <path d={areaPath} className={`cancel-area cancel-area-${view === 'refunds' ? 'refunded' : 'cancelled'}`} fill={`url(#cancelTrendArea-${view})`} />
            <path pathLength="1" d={pathFor(seriesKey)} className={`cancel-line cancel-line-${view === 'refunds' ? 'refunded' : 'cancelled'} cancel-animated-path`} />
            {points.map((point, index) => <g key={`${point.key}-${point[seriesKey]}`} className="cancel-chart-point" style={{ '--cancel-point-delay': `${Math.min(index, 8) * 55 + 130}ms` }}>
              <circle cx={xFor(index)} cy={yFor(point[seriesKey])} r={hoverIndex === index ? 5.5 : 4} className={`cancel-dot cancel-dot-${view === 'refunds' ? 'refunded' : 'cancelled'}${hoverIndex === index ? ' is-active' : ''}`}><title>{point.label}: {point[seriesKey]} {seriesLabel.toLowerCase()}</title></circle>
              <circle cx={xFor(index)} cy={yFor(point[seriesKey])} r="22" fill="transparent" tabIndex={0} role="img" aria-label={`${point.label}: ${point[seriesKey]} ${seriesLabel.toLowerCase()}`} onMouseEnter={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex((current) => current === index ? null : current)} onFocus={() => setHoverIndex(index)} onBlur={() => setHoverIndex((current) => current === index ? null : current)} />
            </g>)}
            {labels.map((point) => {
              const index = points.indexOf(point)
              return <text key={`label-${point.key}`} x={xFor(index)} y={height - 8} textAnchor="middle" className="cancel-axis-label">{point.label}</text>
            })}
          </svg>
          {activePoint && <div className="dash-chart-tooltip cancel-chart-tooltip" style={{ left: `${(xFor(hoverIndex) / width) * 100}%`, top: `${(yFor(activePoint[seriesKey]) / height) * 100}%` }}><b>{activePoint.label}</b><span>{activePoint[seriesKey]} {seriesLabel.toLowerCase()}</span></div>}
          <div className="cancel-chart-legend"><span><i className={view === 'refunds' ? 'refunded' : 'cancelled'} />{seriesLabel}</span></div>
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

function RecordDrawer({ record, onClose, view }) {
  const { pricing } = usePricing()
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
  const breakdown = buildVatExemptOrderBreakdown({ subtotal: record.subtotal, discountSubtotal: record.discountSubtotal, discountType: record.discountType, discountAmount: record.discountAmount, vatExemptAmount: record.vatExemptAmount, vatRate: pricing.vatRate, pricesIncludeVat: pricing.pricesIncludeVat })

  return <div className="ops-drawer-backdrop cancel-drawer-backdrop" onMouseDown={onClose}>
    <aside className="ops-drawer txn-drawer cancel-drawer" role="dialog" aria-modal="true" aria-label={`${view === 'refunds' ? 'Refund' : 'Cancellation'} record ${record.orderNumber}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">{view === 'refunds' ? 'Refund record' : 'Cancellation record'}</span><h2>{record.orderNumber}</h2><small>{record.receiptNumber || 'No receipt reference'}</small></div><button type="button" onClick={onClose} aria-label="Close details"><X size={19} /></button></header>
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
        <section><h3>Amount breakdown</h3><div className="cancel-amount-list">{breakdown.isVatExemptDiscount?<>{breakdown.regularBaseAmount>0&&<p><span>VATable Sale</span><b>{money(breakdown.regularBaseAmount)}</b></p>}<p><span>VAT-Exempt Sale</span><b>{money(breakdown.vatExemptSale)}</b></p><p><span>{formatVatRate(pricing.vatRate)} VAT</span><b>{money(breakdown.regularVatAmount)}</b></p><p><span>Less 20% SC/PWD Disc.</span><b>- {money(breakdown.discountAmount)}</b></p></>:<><p><span>Subtotal</span><b>{money(breakdown.baseAmount)}</b></p><p><span>{pricing.pricesIncludeVat ? `VAT included (${formatVatRate(pricing.vatRate)})` : 'VAT calculated at checkout'}</span><b>{money(breakdown.vatAmount)}</b></p>{record.discountAmount>0&&<p><span>Discount</span><b>- {money(record.discountAmount)}</b></p>}</>}<p><span>Delivery fee</span><b>{money(record.deliveryFee)}</b></p><p className="total"><span>Original total</span><b>{money(record.originalAmount)}</b></p><p className="refund"><span>Refunded</span><b>{money(record.refundAmount)}</b></p></div></section>
        <section><h3>Order and payment timeline</h3><ol className="txn-timeline">{timeline.map((item, index) => <li key={`${item.title}-${index}`}><span>{index === timeline.length - 1 ? <CheckCircle2 size={16} /> : <CalendarDays size={16} />}</span><div><b>{item.title}</b><small>{formatDateTime(item.date)}</small><p>{item.text}</p></div></li>)}</ol></section>
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
  const [activeTab, setActiveTab] = useManagementSessionState('admin:cancellations:tab', 'cancellations')
  const [preset, setPreset] = useManagementSessionState('admin:cancellations:preset', '7')
  const [customFrom, setCustomFrom] = useManagementSessionState('admin:cancellations:from', formatInputDate(new Date(Date.now() - 6 * 86400000)))
  const [customTo, setCustomTo] = useManagementSessionState('admin:cancellations:to', formatInputDate(new Date()))
  const [granularity, setGranularity] = useManagementSessionState('admin:cancellations:granularity', 'day')
  const [search, setSearch] = useManagementSessionState('admin:cancellations:search', '')
  const [filtersOpen, setFiltersOpen] = useManagementSessionState('admin:cancellations:filters-open', false)
  const [reason, setReason] = useManagementSessionState('admin:cancellations:reason', 'all')
  const [orderType, setOrderType] = useManagementSessionState('admin:cancellations:order-type', 'all')
  const [paymentMethod, setPaymentMethod] = useManagementSessionState('admin:cancellations:payment', 'all')
  const [refundStatus, setRefundStatus] = useManagementSessionState('admin:cancellations:refund-status', 'all')
  const [cancelledBy, setCancelledBy] = useManagementSessionState('admin:cancellations:cancelled-by', 'all')
  const [minAmount, setMinAmount] = useManagementSessionState('admin:cancellations:min-amount', '')
  const [maxAmount, setMaxAmount] = useManagementSessionState('admin:cancellations:max-amount', '')
  const [sortBy, setSortBy] = useManagementSessionState('admin:cancellations:sort', 'newest')
  const [page, setPage] = useManagementSessionState('admin:cancellations:page', 1)
  const [pageSize, setPageSize] = useManagementSessionState('admin:cancellations:page-size', 10)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState('')
  const [exportError, setExportError] = useState('')
  const [rowMenuId, setRowMenuId] = useState('')
  const [detailRecord, setDetailRecord] = useManagementSessionState('admin:cancellations:drawer', null)
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
    const closeMenu = () => { setRowMenuId(''); setExportMenuOpen(false) }
    document.addEventListener('click', closeMenu)
    return () => document.removeEventListener('click', closeMenu)
  }, [])

  const currentPeriod = useMemo(() => filterByDateRange(records, range.from, range.to), [records, range])
  const previousPeriod = useMemo(() => filterByDateRange(records, range.previousFrom, range.previousTo), [records, range])
  const cancellationCurrent = useMemo(() => currentPeriod.filter((record) => record.isCancelled), [currentPeriod])
  const cancellationPrevious = useMemo(() => previousPeriod.filter((record) => record.isCancelled), [previousPeriod])
  const refundCurrent = useMemo(() => currentPeriod.filter(hasRefundActivity), [currentPeriod])
  const refundPrevious = useMemo(() => previousPeriod.filter(hasRefundActivity), [previousPeriod])
  const activeCurrent = activeTab === 'refunds' ? refundCurrent : cancellationCurrent
  const activePrevious = activeTab === 'refunds' ? refundPrevious : cancellationPrevious
  const filterRecord = useCallback((record) => {
    if (activeTab === 'cancellations' && reason !== 'all' && record.cancellationReason !== reason) return false
    if (orderType !== 'all' && record.orderType !== orderType) return false
    if (paymentMethod !== 'all' && record.paymentMethod !== paymentMethod) return false
    if (activeTab === 'refunds' && refundStatus !== 'all' && record.refundStatus !== refundStatus) return false
    if (activeTab === 'cancellations' && cancelledBy !== 'all' && record.cancelledByKey !== cancelledBy) return false
    const amount = activeTab === 'refunds' ? record.refundDisplayAmount : record.originalAmount
    if (minAmount !== '' && amount < Number(minAmount)) return false
    if (maxAmount !== '' && amount > Number(maxAmount)) return false
    return true
  }, [activeTab, reason, orderType, paymentMethod, refundStatus, cancelledBy, minAmount, maxAmount])
  const filteredCurrent = useMemo(() => activeCurrent.filter(filterRecord), [activeCurrent, filterRecord])
  const filteredPrevious = useMemo(() => activePrevious.filter(filterRecord), [activePrevious, filterRecord])
  const summary = useMemo(() => computeCancellationSummary(filteredCurrent, filteredPrevious), [filteredCurrent, filteredPrevious])
  const refundSummary = useMemo(() => computeRefundSummary(filteredCurrent, filteredPrevious), [filteredCurrent, filteredPrevious])
  const trend = useMemo(() => buildCancellationTrend(filteredCurrent, range.from, range.to, granularity), [filteredCurrent, range, granularity])

  const reasons = useMemo(() => [...new Set(cancellationCurrent.map((record) => record.cancellationReason))].sort(), [cancellationCurrent])
  const cancelledByOptions = useMemo(() => [...new Set(cancellationCurrent.map((record) => record.cancelledByKey))].sort(), [cancellationCurrent])
  const searchedRecords = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim()
    const matching = filteredCurrent.filter((record) => !query || [record.orderNumber, record.receiptNumber, record.customerName, record.cancellationReason, record.cancelledBy, record.refundMethod, record.refundReference, REFUND_STATUS_LABEL[record.refundStatus]].join(' ').toLowerCase().includes(query))
    return [...matching].sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.eventDate) - new Date(b.eventDate)
      const amountFor = (record) => activeTab === 'refunds' ? record.refundDisplayAmount : record.originalAmount
      if (sortBy === 'highest') return amountFor(b) - amountFor(a)
      if (sortBy === 'lowest') return amountFor(a) - amountFor(b)
      return new Date(b.eventDate) - new Date(a.eventDate)
    })
  }, [filteredCurrent, deferredSearch, sortBy, activeTab])
  const pageCount = Math.max(1, Math.ceil(searchedRecords.length / pageSize))
  const pageRecords = searchedRecords.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => { setPage(1) }, [activeTab, deferredSearch, reason, orderType, paymentMethod, refundStatus, cancelledBy, minAmount, maxAmount, sortBy, pageSize, preset, customFrom, customTo, setPage])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount, setPage])

  const tabFilters = activeTab === 'refunds' ? [orderType, paymentMethod, refundStatus] : [reason, orderType, paymentMethod, cancelledBy]
  const activeFilterCount = tabFilters.filter((value) => value !== 'all').length + (minAmount !== '' ? 1 : 0) + (maxAmount !== '' ? 1 : 0)
  const resetFilters = () => { setReason('all'); setOrderType('all'); setPaymentMethod('all'); setRefundStatus('all'); setCancelledBy('all'); setMinAmount(''); setMaxAmount('') }
  const switchTab = (tab) => {
    setActiveTab(tab)
    setFiltersOpen(false)
    setRowMenuId('')
    setExportMenuOpen(false)
    setExportError('')
    setDetailRecord(null)
  }
  const reportPayload = { records: searchedRecords, summary: activeTab === 'refunds' ? refundSummary : summary, rangeLabel: range.label, view: activeTab, generatedBy: 'Coffee Realm Admin' }
  const runExportPdf = async () => {
    try {
      setExportError('')
      setExporting('pdf')
      await exportCancellationReportToPdf(reportPayload)
    } catch (cause) {
      setExportError(describeError(cause, 'Could not export the PDF report.'))
    } finally {
      setExporting('')
      setExportMenuOpen(false)
    }
  }
  const runExportXlsx = async () => {
    try {
      setExportError('')
      setExporting('xlsx')
      await exportCancellationReportToXlsx(reportPayload)
    } catch (cause) {
      setExportError(describeError(cause, 'Could not export the Excel workbook.'))
    } finally {
      setExporting('')
      setExportMenuOpen(false)
    }
  }
  const onTabKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    switchTab(activeTab === 'cancellations' ? 'refunds' : 'cancellations')
  }

  const titleTabs = (
    <div className="cancel-title-tabs" role="tablist" aria-label="Cancellation and refund views" onKeyDown={onTabKeyDown}>
      <button id="cancellations-tab" type="button" role="tab" aria-label="Cancellations — reasons, voids, and stopped orders" title="Reasons, voids, and stopped orders" aria-selected={activeTab === 'cancellations'} aria-controls="cancellations-panel" tabIndex={activeTab === 'cancellations' ? 0 : -1} className={activeTab === 'cancellations' ? 'active' : ''} onClick={() => switchTab('cancellations')}>
        <Ban size={15} aria-hidden="true" /><span>Cancellations</span><strong>{cancellationCurrent.length}</strong>
      </button>
      <button id="refunds-tab" type="button" role="tab" aria-label="Refunds — payment returns and current status" title="Payment returns and current status" aria-selected={activeTab === 'refunds'} aria-controls="refunds-panel" tabIndex={activeTab === 'refunds' ? 0 : -1} className={activeTab === 'refunds' ? 'active' : ''} onClick={() => switchTab('refunds')}>
        <Undo2 size={15} aria-hidden="true" /><span>Refunds</span><strong>{refundCurrent.length}</strong>
      </button>
    </div>
  )

  return <AppShell role="admin" title="Cancellations & Refunds" titleActions={titleTabs} onRefresh={load}>
    <section className="cancel-range-toolbar report-filter-bar" aria-label="Report date range">
      <div className="cancel-range-display report-filter-label"><CalendarDays size={16} aria-hidden="true" /><span><b>Report range</b><small>{range.label}</small></span></div>
      <div className="cancel-presets report-filter-presets is-four" role="group" aria-label="Cancellation and refund report period">{PRESETS.map(([value, label]) => <button type="button" className={preset === value ? 'active' : ''} aria-pressed={preset === value} aria-expanded={value === 'custom' ? preset === value : undefined} aria-controls={value === 'custom' ? 'cancellation-report-custom-range' : undefined} onClick={() => setPreset(value)} key={value}>{label}</button>)}</div>
      <div className="report-filter-actions is-two">
        <div className="inv-overflow cancel-export-control report-filter-export-wrap">
          <button className="ops-main-action inv-record-btn cancel-export report-filter-export" type="button" disabled={loading || searchedRecords.length === 0 || Boolean(exporting)} aria-label={`Export ${activeTab === 'refunds' ? 'refunds' : 'cancellations'} report`} aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={(event) => { event.stopPropagation(); setExportMenuOpen((open) => !open) }}>
            <Download size={14} /> {exporting ? 'Preparing…' : 'Export'} <ChevronDown size={13} />
          </button>
          {exportMenuOpen && <div className="inv-overflow-menu txn-export-menu cancel-export-menu" role="menu">
            <button type="button" role="menuitem" onClick={runExportPdf}><ReceiptText size={14} /> Export as PDF</button>
            <button type="button" role="menuitem" onClick={runExportXlsx}><FileText size={14} /> Export as XLSX</button>
          </div>}
        </div>
        <button type="button" className="cancel-filter-toggle report-filter-toggle" aria-expanded={filtersOpen} aria-controls="cancellation-report-extra-filters" onClick={() => setFiltersOpen((open) => !open)}><Filter size={15} /> {filtersOpen ? 'Hide filters' : 'More filters'}{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button>
      </div>
    </section>
    {preset === 'custom' && <div className="report-filter-popout cancel-custom-popout" id="cancellation-report-custom-range" role="group" aria-label="Custom cancellation and refund report date range"><div className="report-filter-popout-copy"><CalendarDays size={15} aria-hidden="true" /><span><b>Custom date range</b><small>Choose the start and end dates for this report.</small></span></div><div className="cancel-custom-range report-filter-date-range"><label>From<input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><span>to</span><label>To<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div></div>}
    {filtersOpen && <div className="cancel-filter-panel report-filter-popout report-filter-panel" id="cancellation-report-extra-filters" aria-label={`${activeTab === 'refunds' ? 'Refund' : 'Cancellation'} filters`}>
      <div className="cancel-filter-grid report-filter-fields">
        {activeTab === 'cancellations' && <label>Cancellation reason<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="all">All reasons</option>{reasons.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>}
        <label>Order type<select value={orderType} onChange={(event) => setOrderType(event.target.value)}><option value="all">All order types</option>{Object.entries(ORDER_TYPE_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="all">All methods</option>{Object.entries(PAYMENT_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {activeTab === 'refunds' && <label>Refund status<select value={refundStatus} onChange={(event) => setRefundStatus(event.target.value)}><option value="all">All refund states</option>{Object.entries(REFUND_STATUS_LABEL).filter(([value]) => value !== 'not_applicable').map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
        {activeTab === 'cancellations' && <label>Cancelled by<select value={cancelledBy} onChange={(event) => setCancelledBy(event.target.value)}><option value="all">All roles</option>{cancelledByOptions.map((value) => <option value={value} key={value}>{startCase(value)}</option>)}</select></label>}
        <label>Minimum {activeTab === 'refunds' ? 'refund' : 'order'} amount<input type="number" inputMode="decimal" min="0" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="PHP 0" /></label>
        <label>Maximum amount<input type="number" min="0" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="No maximum" /></label>
      </div>
      <div className="cancel-filter-actions"><button type="button" className="button button-outline" onClick={resetFilters}><RotateCcw size={15} /> Reset All</button><button type="button" className="button button-dark" onClick={() => setFiltersOpen(false)}>Show {searchedRecords.length} records</button></div>
    </div>}

    {error && <div className="cancel-error" role="alert"><ShieldAlert size={19} /><div><b>Report unavailable</b><span>{error}</span></div><button type="button" onClick={load}><RefreshCw size={15} /> Retry</button></div>}
    {exportError && <div className="cancel-export-error" role="alert"><ShieldAlert size={16} /><span>{exportError}</span><button type="button" onClick={() => setExportError('')} aria-label="Dismiss export error"><X size={14} /></button></div>}
    {loading ? <RecordsSkeleton /> : <div className="cancel-report-enter" id={`${activeTab}-panel`} role="tabpanel" aria-labelledby={`${activeTab}-tab`}>
      {truncated && <p className="cancel-limit-note">Showing the newest 5,000 cancellation and refund events.</p>}
      {activeTab === 'cancellations' ? <section className="cancel-metric-grid">
        <MetricCard icon={Ban} label="Cancelled Orders" value={summary.cancelledOrders.toLocaleString('en-PH')} change={summary.comparison.cancelled} tone="rose" />
        <MetricCard icon={PhilippinePeso} label="Cancelled Value" value={money(summary.cancelledValue)} change={summary.comparison.value} tone="sage" detail="Order value before any refund" />
        <MetricCard icon={ReceiptText} label="Most Common Reason" value={summary.commonReason} change={summary.comparison.commonReason} tone="blue" detail={summary.commonReasonCount ? `${summary.commonReasonCount} record${summary.commonReasonCount === 1 ? '' : 's'}` : 'No reason recorded'} />
        <MetricCard icon={UserRound} label="Customer Initiated" value={filteredCurrent.filter((record) => record.cancelledByKey === 'customer').length.toLocaleString('en-PH')} change={0} tone="gold" detail="Requested directly by customers" />
      </section> : <section className="cancel-metric-grid">
        <MetricCard icon={ShieldAlert} label="Needs Action" value={refundSummary.needsAction.toLocaleString('en-PH')} change={refundSummary.comparison.needsAction} tone="gold" detail="Review, send, or confirm payment returns" />
        <MetricCard icon={CheckCircle2} label="Completed Refunds" value={refundSummary.completed.toLocaleString('en-PH')} change={refundSummary.comparison.completed} tone="sage" />
        <MetricCard icon={PhilippinePeso} label="Amount Refunded" value={money(refundSummary.completedAmount)} change={refundSummary.comparison.completedAmount} tone="blue" detail="Confirmed completed amount" />
        <MetricCard icon={ShieldAlert} label="Failed or Rejected" value={refundSummary.failed.toLocaleString('en-PH')} change={refundSummary.comparison.failed} tone="rose" detail="Requires review or customer follow-up" />
      </section>}

      <section className="cancel-insight-grid">
        <TrendChart points={trend} granularity={granularity} onGranularityChange={setGranularity} view={activeTab} />
        <div className="cancel-insight-stack">
          {activeTab === 'cancellations' ? <>
            <BreakdownChart title="Cancellation Reasons" subtitle="Why orders were stopped" data={summary.cancellationReasons} type="cancellation" />
            <BreakdownChart title="Cancelled By" subtitle="Responsible role or source" data={summary.cancelledBy} type="cancellation" />
          </> : <>
            <BreakdownChart title="Refund Status" subtitle="Current payment return workflow" data={summary.refundStatuses} type="refund" colors={['#315c45', '#c8a86b', '#9b8cf2', '#a33b35', '#a8b8aa']} />
            <BreakdownChart title="Refund Reasons" subtitle="Why payments were returned" data={summary.refundReasons} type="refund" colors={['#c8a86b', '#927d56', '#c9b989', '#725b46']} />
          </>}
        </div>
      </section>

      <section className="panel cancel-records-panel">
        <div className="cancel-records-head">
          <div><h2>{activeTab === 'refunds' ? 'Refund Records' : 'Cancellation Records'}</h2><span>{searchedRecords.length} record{searchedRecords.length === 1 ? '' : 's'} in view</span></div>
          <div className="cancel-record-tools">
            <label className="search cancel-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeTab === 'refunds' ? 'Search order, customer, reference...' : 'Search order, customer, reason...'} aria-label={`Search ${activeTab} records`} />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}</label>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label={`Sort ${activeTab} records`}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest amount</option><option value="lowest">Lowest amount</option></select>
          </div>
        </div>

        {activeFilterCount > 0 && <div className="cancel-active-filters"><SlidersHorizontal size={14} /><span>{activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'}</span><button type="button" onClick={resetFilters}>Clear all</button></div>}

        <div className="cancel-table-wrap">
          <table className={`cancel-table is-${activeTab}`}><thead>{activeTab === 'cancellations' ? <tr><th>Order</th><th>Customer</th><th>Order Type</th><th>Order Value</th><th>Reason</th><th>Cancelled By</th><th>Date & Time</th><th><span className="sr-only">Actions</span></th></tr> : <tr><th>Order / Customer</th><th>Payment</th><th>Refund Amount</th><th>Status</th><th>Method / Reference</th><th>Requested / Completed</th><th><span className="sr-only">Actions</span></th></tr>}</thead>
            <tbody>{pageRecords.map((record) => <tr key={record.id} onClick={() => setDetailRecord(record)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setDetailRecord(record) }}>
              {activeTab === 'cancellations' ? <>
                <td><b>{record.orderNumber}</b><small>{record.receiptNumber || 'No receipt'}</small></td>
                <td><b>{record.customerName}</b><small>{record.customerEmail || record.customerPhone || 'Guest / no contact'}</small></td>
                <td>{ORDER_TYPE_LABEL[record.orderType] || startCase(record.orderType)}<small>{record.orderSource === 'customer_pos' ? 'Online' : 'In store'}</small></td>
                <td className="cancel-amount"><b>{money(record.originalAmount)}</b>{record.refundAmount > 0 && <small>{money(record.refundAmount)} refunded</small>}</td>
                <td className="cancel-reason-cell"><span title={record.cancellationReason}>{record.cancellationReason}</span>{record.cancellationNotes && <small title={record.cancellationNotes}>{record.cancellationNotes}</small>}</td>
                <td><b>{record.cancelledBy}</b><small>{startCase(record.cancelledByKey)}</small></td>
                <td>{formatDateTime(record.cancelledAt || record.eventDate)}</td>
              </> : <>
                <td><b>{record.orderNumber}</b><small>{record.customerName}</small></td>
                <td>{PAYMENT_LABEL[record.paymentMethod] || startCase(record.paymentMethod)}<small>{startCase(record.paymentStatus)}</small></td>
                <td className="cancel-amount"><b>{record.refundDisplayAmount > 0 ? money(record.refundDisplayAmount) : 'To be confirmed'}</b><small>of {money(record.originalAmount)} order value</small></td>
                <td><StatusBadge type="refund" value={REFUND_STATUS_LABEL[record.refundStatus] || startCase(record.refundStatus)} /></td>
                <td><b>{record.refundMethod ? startCase(record.refundMethod) : 'Not recorded'}</b><small>{record.refundReference || 'No reference yet'}</small></td>
                <td><b>{record.refundRequestedAt ? formatDateTime(record.refundRequestedAt) : 'Not recorded'}</b><small>{record.refundProcessedAt ? `Completed ${formatDateTime(record.refundProcessedAt)}` : 'Awaiting completion'}</small></td>
              </>}
              <td className="cancel-action-cell" onClick={(event) => event.stopPropagation()}><button type="button" className="cancel-more" aria-label={`Actions for ${record.orderNumber}`} aria-expanded={rowMenuId === record.id} onClick={(event) => { event.stopPropagation(); setRowMenuId((value) => value === record.id ? '' : record.id) }}><MoreVertical size={17} /></button>{rowMenuId === record.id && <div className="cancel-row-menu" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => { setDetailRecord(record); setRowMenuId('') }}><FileSearch size={15} /> View Details</button><button type="button" onClick={() => navigate('/admin/transactions')}><ReceiptText size={15} /> Transaction History</button></div>}</td>
            </tr>)}</tbody>
          </table>
        </div>

        <div className="cancel-mobile-records">{pageRecords.map((record) => <button type="button" className="cancel-mobile-card" key={record.id} onClick={() => setDetailRecord(record)}><div><span>{record.orderNumber}</span><b>{money(activeTab === 'refunds' ? record.refundDisplayAmount : record.originalAmount)}</b></div><strong>{record.customerName}</strong><small>{activeTab === 'refunds' ? `${record.refundMethod ? startCase(record.refundMethod) : 'Method pending'} · ${record.refundReference || 'No reference yet'}` : record.cancellationReason}</small><div>{activeTab === 'refunds' ? <StatusBadge type="refund" value={REFUND_STATUS_LABEL[record.refundStatus] || startCase(record.refundStatus)} /> : <StatusBadge type="order" value={record.isVoided ? 'Voided' : record.status} />}</div><footer><span>{activeTab === 'refunds' ? PAYMENT_LABEL[record.paymentMethod] || startCase(record.paymentMethod) : record.cancelledBy}</span><time>{formatDateTime(activeTab === 'refunds' ? record.refundProcessedAt || record.refundRequestedAt || record.eventDate : record.cancelledAt || record.eventDate)}</time></footer></button>)}</div>

        {!pageRecords.length && <div className="cancel-empty-state"><span>{activeTab === 'refunds' ? <Undo2 size={27} /> : <FileSearch size={27} />}</span><h3>No {activeTab} records found</h3><p>{activeCurrent.length ? 'Try adjusting the search or filters.' : `There are no ${activeTab} in this date range.`}</p>{(activeFilterCount > 0 || search) && <button type="button" className="button button-soft" onClick={() => { resetFilters(); setSearch('') }}>Clear filters</button>}</div>}

        {searchedRecords.length > 0 && <footer className="cancel-pagination"><div><span>Rows per page</span><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select></div><span>Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, searchedRecords.length)} of {searchedRecords.length}</span><div className="cancel-page-buttons"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><b>Page {page} of {pageCount}</b><button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></footer>}
      </section>
    </div>}
    {detailRecord && <RecordDrawer record={detailRecord} view={activeTab} onClose={() => setDetailRecord(null)} />}
  </AppShell>
}
