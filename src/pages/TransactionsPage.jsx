import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import {
  AlertTriangle, Ban, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3, Download, ExternalLink, Eye,
  FileText, Filter, MoreVertical, PhilippinePeso, Printer, ReceiptText, RotateCcw,
  Search, Settings2, ShoppingBag, TrendingUp, Undo2, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { usePricing } from '../context/usePricing'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { buildVatExemptOrderBreakdown, formatVatRate } from '../utils/pricing'
import { getCurrentPortalSession, normalizeRole } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  exportTransactionsToPdf, exportTransactionsToXlsx, fetchTransactionAudit, fetchTransactionById, fetchTransactions,
  fetchTransactionsSummary, fetchTransactionStaffOptions, getPaymentProofUrl,
  processRefund, correctPaymentStatus, requestRefund, voidOrder,
} from '../services/transactionsService'
import {
  fetchStaffPreferences,
  getRememberedStaffFilters,
  rememberStaffFilters,
  shouldShowSystemNotification,
} from '../services/staffSettingsService'
import { useManagementSessionState } from '../hooks/useManagementSessionState'

const ORDER_STATUS_OPTIONS = ['Order Received', 'Awaiting Payment Verification', 'Pending Confirmation', 'Confirmed', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Received', 'Completed', 'Cancelled', 'Ordered']
const PAYMENT_METHOD_LABEL = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank Transfer', cod: 'Cash on Delivery', other: 'Other' }
const PAYMENT_STATUS_OPTIONS = [
  ['all', 'All payment states'],
  ['pending', 'Pending / unpaid'],
  ['paid', 'Paid / verified'],
  ['rejected', 'Rejected'],
]
const REFUND_STATUS_OPTIONS = [
  ['all', 'All refund states'],
  ['not_applicable', 'No refund'],
  ['pending_review', 'Payment review pending'],
  ['pending', 'Refund pending'],
  ['processing', 'Refund processing'],
  ['processed', 'Refunded'],
  ['failed', 'Refund needs attention'],
  ['rejected', 'Refund rejected'],
]
const QUICK_RANGE_LABEL = { all: 'All Time', today: 'Today', yesterday: 'Yesterday', week: 'This Week', month: 'This Month', custom: 'Custom Range' }
const TAB_OPTIONS = [
  ['all', 'All'],
  ['walk-in', 'Walk-ins'],
  ['pickup', 'Pick-ups'],
  ['delivery', 'Delivery'],
  ['cancelled', 'Cancelled'],
  ['voided', 'Voided'],
]

function startCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function manilaDayRange(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000)
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}

function weekRange() {
  const now = new Date()
  const day = now.getDay()
  const start = new Date(now)
  start.setDate(now.getDate() - day)
  start.setHours(0, 0, 0, 0)
  return { from: start.toISOString(), to: new Date().toISOString() }
}

function monthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: start.toISOString(), to: new Date().toISOString() }
}

function formatDateTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(value))
}

function formatDateInput(value) {
  return value ? value.slice(0, 10) : ''
}

function formatTime(value) {
  if (!value) return 'To be confirmed'
  const normalized = String(value).slice(0, 5)
  const [hour = '00', minute = '00'] = normalized.split(':')
  const asDate = new Date(`2026-08-02T${hour}:${minute}:00`)
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).format(asDate)
}

function getSourceLabel(transaction) {
  return transaction.isOnline ? 'Online' : 'Walk-in'
}

function processedRefundAmount(transaction) {
  return transaction.refunds.filter((refund) => refund.status === 'processed').reduce((sum, refund) => sum + refund.amount, 0)
}

function pendingRefund(transaction) {
  return transaction.refunds.find((refund) => refund.status === 'pending') || null
}

function refundStatusMeta(transaction) {
  const processed = processedRefundAmount(transaction)
  const hasPending = transaction.refunds.some((refund) => refund.status === 'pending')
  const hasRejected = transaction.refunds.some((refund) => refund.status === 'rejected')
  if (processed > 0 && processed < transaction.finalTotal) return { key: 'partial', label: 'Partially Refunded', tone: 'attention' }
  if (processed >= transaction.finalTotal && processed > 0) return { key: 'processed', label: 'Refunded', tone: 'completed' }
  if (transaction.refundStatus === 'pending_review') return { key: 'pending_review', label: 'Payment Review Pending', tone: 'attention' }
  if (transaction.refundStatus === 'processing') return { key: 'processing', label: 'Refund Processing', tone: 'attention' }
  if (transaction.refundStatus === 'failed') return { key: 'failed', label: 'Refund Needs Attention', tone: 'cancelled' }
  if (hasPending || transaction.refundStatus === 'pending') return { key: 'pending', label: 'Refund Pending', tone: 'attention' }
  if (hasRejected || transaction.refundStatus === 'rejected') return { key: 'rejected', label: 'Refund Rejected', tone: 'cancelled' }
  return { key: 'not_applicable', label: 'No refund', tone: 'neutral' }
}

function paymentStatusMeta(transaction) {
  const raw = String(transaction.paymentRecordStatus || transaction.paymentStatus || '').toLowerCase()
  const refundMeta = refundStatusMeta(transaction)
  if (transaction.isVoided) return { key: 'voided', label: 'Voided', tone: 'neutral' }
  if (refundMeta.key === 'processed') return { key: 'refunded', label: 'Refunded', tone: 'cancelled' }
  if (refundMeta.key === 'partial') return { key: 'partially_refunded', label: 'Partially Refunded', tone: 'attention' }
  if (refundMeta.key === 'pending') return { key: 'refund_pending', label: 'Refund Pending', tone: 'attention' }
  if (raw === 'rejected' || raw === 'failed') return { key: 'rejected', label: 'Rejected', tone: 'cancelled' }
  if (raw === 'verified') return { key: 'verified', label: 'Verified', tone: 'completed' }
  if (raw === 'paid' || raw === 'confirmed') return { key: 'paid', label: 'Paid', tone: 'completed' }
  if (raw === 'pending' && (transaction.paymentMethod === 'gcash' || transaction.paymentMethod === 'bank_transfer')) {
    return { key: 'pending', label: 'Pending Verification', tone: 'attention' }
  }
  if (raw === 'pending') return { key: 'unpaid', label: 'Unpaid', tone: 'attention' }
  return { key: raw || 'unpaid', label: startCase(raw || 'unpaid'), tone: 'neutral' }
}

function statusTone(status) {
  if (['Completed', 'Received'].includes(status)) return 'completed'
  if (status === 'Cancelled') return 'cancelled'
  if (status === 'Preparing') return 'preparing'
  if (status === 'Ready for Pickup') return 'pickup'
  if (status === 'Out for Delivery') return 'delivery'
  if (status === 'Confirmed' || status === 'Ordered') return 'confirmed'
  if (/pending|awaiting|received/i.test(status)) return 'attention'
  return 'neutral'
}

function isCompletedSale(transaction) {
  return ['Completed', 'Received'].includes(transaction.status) && paymentStatusMeta(transaction).key === 'paid' && !transaction.isVoided
}

function buildFilterLabel({ quickRange, dateFrom, dateTo }) {
  if (quickRange !== 'custom') return QUICK_RANGE_LABEL[quickRange] || QUICK_RANGE_LABEL.all
  if (!dateFrom && !dateTo) return QUICK_RANGE_LABEL.all
  if (dateFrom && dateTo) return `${formatDateInput(dateFrom)} to ${formatDateInput(dateTo)}`
  if (dateFrom) return `From ${formatDateInput(dateFrom)}`
  return `Until ${formatDateInput(dateTo)}`
}

function receiptMoney(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`
}

function buildReceiptHtml(transaction, pricing) {
  const vatRate = transaction.vatRate ?? pricing?.vatRate ?? 0.12
  const pricesIncludeVat = transaction.pricesIncludeVat ?? pricing?.pricesIncludeVat ?? true
  const breakdown = buildVatExemptOrderBreakdown({
    subtotal: transaction.subtotal,
    discountSubtotal: transaction.discountSubtotal,
    discountType: transaction.discountType,
    discountAmount: transaction.discountAmount,
    vatExemptAmount: transaction.vatExemptAmount,
    vatRate,
    pricesIncludeVat,
  })
  const itemsMarkup = transaction.items.map((item) => {
    const detailLines = []
    const customizations = item.customizations || {}
    ;['variantKey', 'temperature', 'iceLevel', 'sugarLevel'].forEach((key) => {
      if (customizations[key]) detailLines.push(`${startCase(key)}: ${customizations[key]}`)
    })
    ;(item.addons || []).forEach((addon) => {
      if (typeof addon === 'string') detailLines.push(`Add-on: ${addon}`)
      else if (addon?.name) detailLines.push(`Add-on: ${addon.name}`)
    })
    if (customizations.special_instructions) detailLines.push(`Note: ${customizations.special_instructions}`)

    return `<div class="receipt-item">
      <div>${item.quantity}</div>
      <div class="receipt-item-name">
        ${item.name}
        ${detailLines.map((line) => `<div class="receipt-option">${line}</div>`).join('')}
      </div>
      <div class="receipt-item-price">${receiptMoney(item.lineTotal)}</div>
    </div>`
  }).join('')

  const refundMeta = refundStatusMeta(transaction)
  const paymentMeta = paymentStatusMeta(transaction)
  const receiptRef = transaction.paymentReference || 'N/A'
  return `<!doctype html><html><head><title>${transaction.receiptNumber}</title>
    <style>
      body{margin:0;background:#f3f4f0;padding:20px;font-family:'Courier New',Courier,monospace}
      .receipt{width:320px;max-width:100%;margin:0 auto;background:#fff;color:#000;padding:10px 12px;border:1px solid #d9ddd7}
      .center{text-align:center}.line{border-top:1px dashed #000;margin:8px 0}.row,.total{display:flex;justify-content:space-between;gap:12px;font-size:11px}
      .label{flex:0 0 118px}.value{flex:1;text-align:right}.header{font-size:16px;font-weight:800;letter-spacing:1px;text-transform:uppercase}
      .sub{font-size:11px}.table-head,.receipt-item{display:grid;grid-template-columns:24px minmax(0,1fr) 72px;gap:6px;font-size:11px}
      .table-head{font-weight:800}.receipt-item-price{text-align:right}.receipt-option{font-size:10px}.grand{font-size:14px;font-weight:900}
    </style></head><body><div class="receipt">
      <div class="center"><img src="/images/coffeerealmlogo.png" alt="" style="width:42px;height:42px;object-fit:contain;margin:0 auto 4px"/><div class="header">COFFEE REALM</div><div class="sub">Transaction receipt</div></div>
      <div class="line"></div>
      <div class="row"><span class="label">Order #</span><span class="value">${transaction.orderNumber}</span></div>
      <div class="row"><span class="label">Receipt #</span><span class="value">${transaction.receiptNumber}</span></div>
      <div class="row"><span class="label">Reference #</span><span class="value">${receiptRef}</span></div>
      <div class="row"><span class="label">Date</span><span class="value">${formatDateTime(transaction.createdAt)}</span></div>
      <div class="row"><span class="label">Source</span><span class="value">${getSourceLabel(transaction)}</span></div>
      <div class="row"><span class="label">Fulfillment</span><span class="value">${transaction.fulfillment}</span></div>
      <div class="row"><span class="label">Payment</span><span class="value">${PAYMENT_METHOD_LABEL[transaction.paymentMethod] || '-'}</span></div>
      <div class="row"><span class="label">Payment status</span><span class="value">${paymentMeta.label}</span></div>
      <div class="row"><span class="label">Customer</span><span class="value">${transaction.customerName}</span></div>
      ${transaction.customerPhone ? `<div class="row"><span class="label">Contact</span><span class="value">${transaction.customerPhone}</span></div>` : ''}
      ${transaction.deliveryAddress ? `<div class="row"><span class="label">Address</span><span class="value">${transaction.deliveryAddress}</span></div>` : ''}
      ${transaction.cashierName ? `<div class="row"><span class="label">Staff</span><span class="value">${transaction.cashierName}</span></div>` : ''}
      ${refundMeta.key !== 'not_applicable' ? `<div class="row"><span class="label">Refund</span><span class="value">${refundMeta.label}</span></div>` : ''}
      <div class="line"></div>
      <div class="table-head"><div>QTY</div><div>ITEM</div><div style="text-align:right">PRICE</div></div>
      <div class="line"></div>
      ${itemsMarkup}
      <div class="line"></div>
       ${breakdown.isVatExemptDiscount
         ? `${breakdown.regularBaseAmount > 0 ? `<div class="total"><span>VATable Sale</span><span>${receiptMoney(breakdown.regularBaseAmount)}</span></div>` : ''}
            <div class="total"><span>VAT-Exempt Sale</span><span>${receiptMoney(breakdown.vatExemptSale)}</span></div>
            <div class="total"><span>${formatVatRate(vatRate)} VAT</span><span>${receiptMoney(breakdown.regularVatAmount)}</span></div>
            <div class="total"><span>Less 20% SC/PWD Disc.</span><span>- ${receiptMoney(breakdown.discountAmount)}</span></div>`
         : `<div class="total"><span>Subtotal</span><span>${receiptMoney(breakdown.baseAmount)}</span></div>
            ${transaction.discountAmount > 0 ? `<div class="total"><span>Discount</span><span>- ${receiptMoney(transaction.discountAmount)}</span></div>` : ''}
            <div class="total"><span>VAT (${formatVatRate(vatRate)})</span><span>${receiptMoney(breakdown.vatAmount)}</span></div>`}
       ${transaction.deliveryFee > 0 ? `<div class="total"><span>Delivery Fee</span><span>${receiptMoney(transaction.deliveryFee)}</span></div>` : ''}
       <div class="total grand"><span>Total</span><span>${receiptMoney(transaction.finalTotal)}</span></div>
      <div class="total"><span>Item Count</span><span>${transaction.itemCount}</span></div>
      <div class="line"></div>
      <div class="center sub">Please keep this receipt for reference.</div>
    </div></body></html>`
}

function openReceiptWindow(transaction, shouldPrint = false, pricing) {
  const win = window.open('', '_blank', 'width=460,height=900')
  if (!win) return false
  win.document.write(buildReceiptHtml(transaction, pricing))
  win.document.close()
  if (shouldPrint) {
    setTimeout(() => {
      win.focus()
      win.print()
    }, 180)
  }
  return true
}

function downloadReceiptHtml(transaction, pricing) {
  const blob = new Blob([buildReceiptHtml(transaction, pricing)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${transaction.receiptNumber || transaction.orderNumber || 'receipt'}.html`
  anchor.click()
  URL.revokeObjectURL(url)
}

function metricSummary(transactions) {
  const sales = transactions.filter(isCompletedSale)
  const refunds = transactions.reduce((sum, transaction) => sum + processedRefundAmount(transaction), 0)
  const grossSales = sales.reduce((sum, transaction) => sum + transaction.finalTotal, 0)
  const cancelledOrders = transactions.filter((transaction) => transaction.status === 'Cancelled').length
  return {
    totalTransactions: transactions.length,
    grossSales,
    netSales: grossSales - refunds,
    completedSales: sales.length,
    cancelledOrders,
    refundedAmount: refunds,
    averageOrderValue: sales.length ? grossSales / sales.length : 0,
  }
}

function reconciliationSummary(transactions) {
  const byMethod = {}
  transactions.filter(isCompletedSale).forEach((transaction) => {
    const label = PAYMENT_METHOD_LABEL[transaction.paymentMethod] || 'Other'
    byMethod[label] = (byMethod[label] || 0) + transaction.finalTotal
  })
  return {
    byMethod,
    refunds: transactions.reduce((sum, transaction) => sum + processedRefundAmount(transaction), 0),
    voids: transactions.filter((transaction) => transaction.isVoided).length,
  }
}

function deriveTab(orderSource, fulfillment, orderStatus, voidedOnly) {
  if (voidedOnly) return 'voided'
  if (orderStatus === 'Cancelled') return 'cancelled'
  if (orderSource === 'cashier_pos' && fulfillment === 'walk-in') return 'walk-in'
  if (fulfillment === 'pickup') return 'pickup'
  if (fulfillment === 'delivery') return 'delivery'
  return 'all'
}

export default function TransactionsPage() {
  const location = useLocation()
  const { pricing } = usePricing()
  const [transactions, setTransactions] = useState([])
  const [summaryRows, setSummaryRows] = useState([])
  const [staffOptions, setStaffOptions] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState([])
  const [busyId, setBusyId] = useState('')
  const [profile, setProfile] = useState(null)

  const [quickRange, setQuickRange] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [orderSource, setOrderSource] = useState('all')
  const [fulfillment, setFulfillment] = useState('all')
  const [paymentMethod, setPaymentMethod] = useState('all')
  const [paymentStatus, setPaymentStatus] = useState('all')
  const [orderStatus, setOrderStatus] = useState('all')
  const [voidedOnly, setVoidedOnly] = useState(false)
  const [refundStatus, setRefundStatus] = useState('all')
  const [customerType, setCustomerType] = useState('all')
  const [staffFilter, setStaffFilter] = useState('all')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [filtersReady, setFiltersReady] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState('')
  const [rowMenuId, setRowMenuId] = useState('')

  const sessionScope = location.pathname.startsWith('/admin') ? 'admin:transactions' : 'staff:transactions'
  const [detailTarget, setDetailTarget] = useManagementSessionState(`${sessionScope}:details`, null)
  const [refundTarget, setRefundTarget] = useManagementSessionState(`${sessionScope}:refund`, null)
  const [refundProcessTarget, setRefundProcessTarget] = useManagementSessionState(`${sessionScope}:refund-process`, null)
  const [voidTarget, setVoidTarget] = useManagementSessionState(`${sessionScope}:void`, null)
  const [correctionTarget, setCorrectionTarget] = useManagementSessionState(`${sessionScope}:payment-correction`, null)

  const deferredSearch = useDeferredValue(search)
  const queryRef = useRef(null)
  const filterDialogRef = useRef(null)

  useEffect(() => {
    if (!filtersOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setFiltersOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    filterDialogRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [filtersOpen])

  useEffect(() => {
    getCurrentPortalSession().then(async ({ profile: currentProfile }) => {
      setProfile(currentProfile)
      try {
        if (location.pathname.startsWith('/staff') && currentProfile?.id) {
          const preferences = await fetchStaffPreferences(currentProfile.id)
          setPageSize(preferences.rows_per_page)

          const remembered = getRememberedStaffFilters('transactions')
          if (remembered) {
            setQuickRange(remembered.quickRange ?? 'all')
            setDateFrom(remembered.dateFrom ?? '')
            setDateTo(remembered.dateTo ?? '')
            setSearch(remembered.search ?? '')
            setOrderSource(remembered.orderSource ?? 'all')
            setFulfillment(remembered.fulfillment ?? 'all')
            setPaymentMethod(remembered.paymentMethod ?? 'all')
            setPaymentStatus(remembered.paymentStatus ?? 'all')
            setOrderStatus(remembered.orderStatus ?? 'all')
            setVoidedOnly(Boolean(remembered.voidedOnly))
            setRefundStatus(remembered.refundStatus ?? 'all')
            setCustomerType(remembered.customerType ?? 'all')
            setStaffFilter(remembered.staffFilter ?? 'all')
            setMinAmount(remembered.minAmount ?? '')
            setMaxAmount(remembered.maxAmount ?? '')
            setSortBy(remembered.sortBy ?? 'newest')
          }
        }
        const options = await fetchTransactionStaffOptions()
        setStaffOptions(options)
      } catch {
        // Staff filtering remains available even when options cannot be loaded.
      } finally {
        setFiltersReady(true)
      }
    })
  }, [location.pathname])

  useEffect(() => {
    if (!filtersReady || !location.pathname.startsWith('/staff')) return
    rememberStaffFilters('transactions', {
      quickRange,
      dateFrom,
      dateTo,
      search,
      orderSource,
      fulfillment,
      paymentMethod,
      paymentStatus,
      orderStatus,
      voidedOnly,
      refundStatus,
      customerType,
      staffFilter,
      minAmount,
      maxAmount,
      sortBy,
    })
  }, [filtersReady, location.pathname, quickRange, dateFrom, dateTo, search, orderSource, fulfillment, paymentMethod, paymentStatus, orderStatus, voidedOnly, refundStatus, customerType, staffFilter, minAmount, maxAmount, sortBy])

  const queryState = useMemo(() => ({
    page,
    pageSize,
    sortBy,
    search: deferredSearch,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    orderSource,
    fulfillment,
    paymentMethod,
    paymentStatus,
    orderStatus, voidedOnly,
    refundStatus,
    customerType,
    staffId: staffFilter,
    minAmount,
    maxAmount,
  }), [page, pageSize, sortBy, deferredSearch, dateFrom, dateTo, orderSource, fulfillment, paymentMethod, paymentStatus, orderStatus, voidedOnly, refundStatus, customerType, staffFilter, minAmount, maxAmount])

  queryRef.current = queryState

  const pushToast = (type, message) => {
    if (!shouldShowSystemNotification(type)) return
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, type, message }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4500)
  }

  const load = async (filters = queryState) => {
    setLoading(true)
    try {
      const [pageResult, summaryResult] = await Promise.all([
        fetchTransactions(filters),
        fetchTransactionsSummary({ ...filters, page: undefined, pageSize: undefined }),
      ])
      setTransactions(pageResult.data)
      setTotalCount(pageResult.count)
      setSummaryRows(summaryResult)
      setError('')
      const maxPage = Math.max(1, Math.ceil((pageResult.count || 0) / Math.max(1, filters.pageSize || 20)))
      if (filters.page > maxPage) setPage(maxPage)
    } catch (cause) {
      setError(describeError(cause, 'Could not load transactions.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(queryState) }, [queryState])

  useEffect(() => {
    const refresh = () => load(queryRef.current)
    const channel = supabase
      .channel('transactions-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refunds' }, refresh)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const shellRole = location.pathname.startsWith('/admin') ? 'admin' : 'staff'
  const canManageFinancialActions = ['admin', 'staff', 'operational_staff'].includes(normalizeRole(profile?.role))
  const activeTab = deriveTab(orderSource, fulfillment, orderStatus, voidedOnly)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const firstResult = totalCount ? (page - 1) * pageSize + 1 : 0
  const lastResult = Math.min(page * pageSize, totalCount)
  const summary = useMemo(() => metricSummary(summaryRows), [summaryRows])
  const reconciliation = useMemo(() => reconciliationSummary(summaryRows), [summaryRows])
  const filterRangeLabel = useMemo(() => buildFilterLabel({ quickRange, dateFrom, dateTo }), [quickRange, dateFrom, dateTo])

  const activeFilterChips = useMemo(() => {
    const chips = []
    if (quickRange !== 'all') chips.push({ key: 'range', label: QUICK_RANGE_LABEL[quickRange], onRemove: () => applyQuickRange('all') })
    if (search.trim()) chips.push({ key: 'search', label: `Search: "${search.trim()}"`, onRemove: () => { setSearch(''); setPage(1) } })
    if (orderSource !== 'all') chips.push({ key: 'source', label: orderSource === 'customer_pos' ? 'Online' : 'Walk-in source', onRemove: () => { setOrderSource('all'); setPage(1) } })
    if (fulfillment !== 'all') chips.push({ key: 'fulfillment', label: `Fulfillment: ${startCase(fulfillment)}`, onRemove: () => { setFulfillment('all'); setPage(1) } })
    if (paymentMethod !== 'all') chips.push({ key: 'method', label: PAYMENT_METHOD_LABEL[paymentMethod] || paymentMethod, onRemove: () => { setPaymentMethod('all'); setPage(1) } })
    if (paymentStatus !== 'all') chips.push({ key: 'paymentStatus', label: PAYMENT_STATUS_OPTIONS.find(([value]) => value === paymentStatus)?.[1] || paymentStatus, onRemove: () => { setPaymentStatus('all'); setPage(1) } })
    if (orderStatus !== 'all') chips.push({ key: 'orderStatus', label: orderStatus, onRemove: () => { setOrderStatus('all'); setPage(1) } })
    if (voidedOnly) chips.push({ key: 'voided', label: 'Voided', onRemove: () => { setVoidedOnly(false); setPage(1) } })
    if (refundStatus !== 'all') chips.push({ key: 'refundStatus', label: REFUND_STATUS_OPTIONS.find(([value]) => value === refundStatus)?.[1] || refundStatus, onRemove: () => { setRefundStatus('all'); setPage(1) } })
    if (customerType !== 'all') chips.push({ key: 'customerType', label: customerType === 'registered' ? 'Registered' : 'Guest', onRemove: () => { setCustomerType('all'); setPage(1) } })
    if (staffFilter !== 'all') chips.push({ key: 'staff', label: `Staff: ${staffOptions.find((staff) => staff.id === staffFilter)?.name || 'Selected'}`, onRemove: () => { setStaffFilter('all'); setPage(1) } })
    if (minAmount !== '') chips.push({ key: 'minAmount', label: `Min ${money(Number(minAmount || 0))}`, onRemove: () => { setMinAmount(''); setPage(1) } })
    if (maxAmount !== '') chips.push({ key: 'maxAmount', label: `Max ${money(Number(maxAmount || 0))}`, onRemove: () => { setMaxAmount(''); setPage(1) } })
    return chips
  }, [quickRange, search, orderSource, fulfillment, paymentMethod, paymentStatus, orderStatus, voidedOnly, refundStatus, customerType, staffFilter, staffOptions, minAmount, maxAmount])

  const hasActiveFilters = activeFilterChips.length > 0

  const applyQuickRange = (key) => {
    setQuickRange(key)
    setPage(1)
    if (key === 'all') { setDateFrom(''); setDateTo(''); return }
    if (key === 'today') { const range = manilaDayRange(0); setDateFrom(range.from); setDateTo(range.to); return }
    if (key === 'yesterday') { const range = manilaDayRange(-1); setDateFrom(range.from); setDateTo(range.to); return }
    if (key === 'week') { const range = weekRange(); setDateFrom(range.from); setDateTo(range.to); return }
    if (key === 'month') { const range = monthRange(); setDateFrom(range.from); setDateTo(range.to); return }
  }

  const applyTab = (tab) => {
    setPage(1)
    if (tab === 'all') {
      setOrderStatus('all')
      setOrderSource('all')
      setFulfillment('all')
      setVoidedOnly(false)
      return
    }
    if (tab === 'voided') {
      setOrderStatus('all')
      setOrderSource('all')
      setFulfillment('all')
      setVoidedOnly(true)
      return
    }
    if (tab === 'cancelled') {
      setOrderStatus('Cancelled')
      setOrderSource('all')
      setFulfillment('all')
      setVoidedOnly(false)
      return
    }
    setOrderStatus('all')
    setVoidedOnly(false)
    if (tab === 'walk-in') {
      setOrderSource('cashier_pos')
      setFulfillment('walk-in')
      return
    }
    setOrderSource('all')
    setFulfillment(tab)
  }

  const resetFilters = () => {
    setQuickRange('all')
    setDateFrom('')
    setDateTo('')
    setSearch('')
    setOrderSource('all')
    setFulfillment('all')
    setPaymentMethod('all')
    setPaymentStatus('all')
    setOrderStatus('all')
    setVoidedOnly(false)
    setRefundStatus('all')
    setCustomerType('all')
    setStaffFilter('all')
    setMinAmount('')
    setMaxAmount('')
    setSortBy('newest')
    setPage(1)
    setFiltersOpen(false)
  }

  const viewReceipt = (transaction) => {
    if (!openReceiptWindow(transaction, false, pricing)) pushToast('error', 'The receipt window was blocked by the browser.')
    setRowMenuId('')
  }

  const printReceipt = (transaction) => {
    if (!openReceiptWindow(transaction, true, pricing)) pushToast('error', 'The print window was blocked by the browser.')
    setRowMenuId('')
  }

  const downloadReceipt = (transaction) => {
    downloadReceiptHtml(transaction, pricing)
    pushToast('success', `Downloaded receipt for ${transaction.receiptNumber}.`)
    setRowMenuId('')
  }

  const viewPaymentProof = async (transaction) => {
    try {
      const url = await getPaymentProofUrl(transaction.paymentProofPath)
      if (!url) throw new Error('No payment proof is available for this transaction.')
      window.open(url, '_blank', 'noopener,noreferrer')
      setRowMenuId('')
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not open the payment proof.'))
    }
  }

  const viewRelatedOrder = (transaction) => {
    setDetailTarget(transaction)
    setRowMenuId('')
  }

  const openDetails = (transaction) => {
    setDetailTarget(transaction)
    setRowMenuId('')
  }

  const runVoid = async (reason) => {
    setBusyId(voidTarget.id)
    try {
      await voidOrder(voidTarget.id, reason)
      pushToast('success', `${voidTarget.orderNumber} was voided.`)
      setVoidTarget(null)
      await load(queryRef.current)
      return true
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not void this transaction.'))
      return false
    } finally {
      setBusyId('')
    }
  }

  const runRefundRequest = async ({ amount, reason, method }) => {
    setBusyId(refundTarget.id)
    try {
      await requestRefund({ orderId: refundTarget.id, amount, reason, method })
      pushToast('success', `Refund requested for ${refundTarget.orderNumber}.`)
      setRefundTarget(null)
      await load(queryRef.current)
      return true
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not request this refund.'))
      return false
    } finally {
      setBusyId('')
    }
  }

  const runProcessRefund = async ({ refund, approve, referenceNumber }) => {
    setBusyId(refund.id)
    try {
      await processRefund({ refundId: refund.id, orderId: refund.orderId || detailTarget?.id, approve, referenceNumber })
      pushToast('success', approve ? 'Refund marked as processed.' : 'Refund rejected.')
      setRefundProcessTarget(null)
      await load(queryRef.current)
      if (detailTarget?.id) {
        const fresh = await fetchTransactionById(detailTarget.id)
        if (fresh) setDetailTarget(fresh)
      }
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not update this refund.'))
    } finally {
      setBusyId('')
    }
  }

  const runCorrection = async (newStatus, reason) => {
    setBusyId(correctionTarget.id)
    try {
      await correctPaymentStatus({ orderId: correctionTarget.id, newStatus, reason })
      pushToast('success', `Payment status corrected for ${correctionTarget.orderNumber}.`)
      setCorrectionTarget(null)
      await load(queryRef.current)
      return true
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not correct the payment status.'))
      return false
    } finally {
      setBusyId('')
    }
  }

  const runExportXlsx = async () => {
    try {
      setExporting('xlsx')
      await exportTransactionsToXlsx({ transactions: summaryRows, summary, reconciliation, filterLabel: filterRangeLabel, generatedBy: profile?.full_name || profile?.email })
      pushToast('success', `Exported ${summaryRows.length} transaction${summaryRows.length === 1 ? '' : 's'} to Excel.`)
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not export the transaction workbook.'))
    } finally {
      setExporting('')
      setExportMenuOpen(false)
    }
  }

  const runExportPdf = async () => {
    try {
      setExporting('pdf')
      await exportTransactionsToPdf({ transactions: summaryRows, summary, reconciliation, filterLabel: filterRangeLabel, generatedBy: profile?.full_name || profile?.email })
      pushToast('success', 'Exported the transaction report as PDF.')
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not export the transaction PDF.'))
    } finally {
      setExporting('')
      setExportMenuOpen(false)
    }
  }

  return (
    <AppShell role={shellRole} title="Transactions" onRefresh={() => load(queryRef.current)}>
      {error && !loading && <p className="form-error">{error}</p>}

      {loading && summaryRows.length === 0 ? (
        <div className="txn-report-overview txn-report-skeleton">
          {Array.from({ length: 4 }).map((_, index) => <div className="inv-skeleton-row txn-metric-skeleton" key={index} />)}
        </div>
      ) : (
        <section className="txn-report-overview dash-fade-in" aria-label="Financial snapshot">
          <article className="txn-report-total">
            <span>Net sales</span>
            <b>{money(summary.netSales)}</b>
            <p>Settled revenue after processed refunds.</p>
            <div className="txn-report-total-meta"><span>Gross sales <b>{money(summary.grossSales)}</b></span><span>Refunds <b>{money(summary.refundedAmount)}</b></span><span>Cancelled <b>{summary.cancelledOrders}</b></span><span>Voided <b>{reconciliation.voids}</b></span></div>
          </article>
          <article className="txn-report-stat txn-report-stat--transactions txn-report-stat--text-only"><span>Total transactions</span><b>{summary.totalTransactions}</b><small>All recorded orders</small></article>
          <article className="txn-report-stat txn-report-stat--completed txn-report-stat--text-only"><span>Completed sales</span><b>{summary.completedSales}</b><small>Paid and completed orders</small></article>
          <article className="txn-report-stat txn-report-stat--average txn-report-stat--text-only"><span>Average order value</span><b>{money(summary.averageOrderValue)}</b><small>Across completed sales</small></article>
        </section>
      )}

      <section className="txn-ledger-shell" aria-labelledby="txn-ledger-title">
        <div className="txn-ledger-heading"><div><span className="settings-kicker">Transaction ledger</span><h2 id="txn-ledger-title">Recorded sales and payment activity</h2></div><div className="inv-overflow txn-ledger-export"><button type="button" className="ops-main-action inv-record-btn" onClick={() => setExportMenuOpen((open) => !open)} disabled={loading || summaryRows.length === 0 || Boolean(exporting)}><Download size={16} /> {exporting ? 'Preparing…' : 'Export'} <ChevronDown size={14} /></button>{exportMenuOpen && <div className="inv-overflow-menu txn-export-menu" role="menu"><button type="button" role="menuitem" onClick={runExportPdf}><ReceiptText size={14} /> Export as PDF</button><button type="button" role="menuitem" onClick={runExportXlsx}><FileText size={14} /> Export as XLSX</button></div>}</div></div>
      <div className="txn-toolbar-shell">
        <div className="txn-filter-primary">
          <label className="menu-manage-search">
            <Search size={17} /><span className="sr-only">Search transactions</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search order #, receipt, customer, email, phone..." />
            {search && <button type="button" className="menu-manage-search-clear" aria-label="Clear search" onClick={() => { setSearch(''); setPage(1) }}><X size={14} /></button>}
          </label>
          <label className="txn-range-control"><span>Report period</span><select value={quickRange} onChange={(event) => { const nextRange = event.target.value; if (nextRange === 'custom') { setQuickRange('custom'); setFiltersOpen(true) } else applyQuickRange(nextRange) }}>
            <option value="all">All Time</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="week">This Week</option><option value="month">This Month</option><option value="custom">Custom Range</option>
          </select></label>
          <div className="txn-toolbar-actions">
            <button type="button" className="ops-secondary-action compact" onClick={() => setFiltersOpen((open) => !open)}><Filter size={14} /> All filters <ChevronDown size={14} className={filtersOpen ? 'rotated' : ''} /></button>
            <label className="txn-select-control"><span>Sort</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort transactions">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="highest">Highest amount</option>
              <option value="lowest">Lowest amount</option>
            </select></label>
            {hasActiveFilters && <button type="button" className="ops-destructive-action compact" onClick={resetFilters}>Clear</button>}
          </div>
        </div>

        <div className="txn-filter-secondary">
          <div className="txn-view-row">
            <span className="txn-view-label">View</span>
            <div className="txn-tab-row" role="tablist" aria-label="Transaction views">
            {TAB_OPTIONS.map(([value, label]) => (
              <button type="button" role="tab" aria-selected={activeTab === value} key={value} className={`txn-tab ${activeTab === value ? 'active' : ''}`} onClick={() => applyTab(value)}>
                {label}
              </button>
            ))}
            </div>
          </div>

        </div>
      </div>

      {filtersOpen && (
        <>
          <button type="button" className="txn-filter-backdrop" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />
          <div className="txn-filter-panel" ref={filterDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="txn-filter-title">
            <div className="txn-filter-panel-head">
              <div>
                <span className="settings-kicker">Transaction filters</span>
                <h3 id="txn-filter-title">Refine this sales history view</h3>
              </div>
              <button type="button" className="ops-icon-button" aria-label="Close filters" onClick={() => setFiltersOpen(false)}><X size={18} /></button>
            </div>

            <div className="txn-filter-grid">
              <label className="field compact"><span>Date from</span><input type="date" value={formatDateInput(dateFrom)} onChange={(event) => { setQuickRange('custom'); setDateFrom(event.target.value ? new Date(`${event.target.value}T00:00:00`).toISOString() : ''); setPage(1) }} /></label>
              <label className="field compact"><span>Date to</span><input type="date" value={formatDateInput(dateTo)} onChange={(event) => { setQuickRange('custom'); setDateTo(event.target.value ? new Date(`${event.target.value}T23:59:59`).toISOString() : ''); setPage(1) }} /></label>
              <label className="field compact"><span>Order source</span><select value={orderSource} onChange={(event) => { setOrderSource(event.target.value); setPage(1) }}>
                <option value="all">All order sources</option>
                <option value="customer_pos">Online</option>
                <option value="cashier_pos">Walk-in</option>
              </select></label>
              <label className="field compact"><span>Fulfillment</span><select value={fulfillment} onChange={(event) => { setFulfillment(event.target.value); setPage(1) }}>
                <option value="all">All order types</option>
                <option value="delivery">Delivery</option>
                <option value="pickup">Pickup</option>
                <option value="walk-in">Walk-in</option>
              </select></label>
              <label className="field compact"><span>Payment method</span><select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setPage(1) }}>
                <option value="all">All payment methods</option>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label className="field compact"><span>Payment status</span><select value={paymentStatus} onChange={(event) => { setPaymentStatus(event.target.value); setPage(1) }}>
                {PAYMENT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label className="field compact"><span>Order status</span><select value={orderStatus} onChange={(event) => { setOrderStatus(event.target.value); setPage(1) }}>
                <option value="all">All order statuses</option>
                {ORDER_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
              </select></label>
              <label className="field compact"><span>Refund status</span><select value={refundStatus} onChange={(event) => { setRefundStatus(event.target.value); setPage(1) }}>
                {REFUND_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label className="field compact"><span>Customer type</span><select value={customerType} onChange={(event) => { setCustomerType(event.target.value); setPage(1) }}>
                <option value="all">Registered + Guest</option>
                <option value="registered">Registered</option>
                <option value="guest">Guest</option>
              </select></label>
              <label className="field compact"><span>Staff or cashier</span><select value={staffFilter} onChange={(event) => { setStaffFilter(event.target.value); setPage(1) }}>
                <option value="all">All staff / cashiers</option>
                {staffOptions.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
              </select></label>
              <label className="field compact"><span>Minimum amount</span><input type="number" min="0" value={minAmount} onChange={(event) => { setMinAmount(event.target.value); setPage(1) }} /></label>
              <label className="field compact"><span>Maximum amount</span><input type="number" min="0" value={maxAmount} onChange={(event) => { setMaxAmount(event.target.value); setPage(1) }} /></label>
            </div>

            <div className="payment-modal-actions txn-filter-actions">
              <button className="secondary-button" type="button" onClick={resetFilters}>Reset All</button>
              <button className="primary-button" type="button" onClick={() => setFiltersOpen(false)}>Apply Filters</button>
            </div>
          </div>
        </>
      )}

      {hasActiveFilters && (
        <div className="txn-chip-row">
          {activeFilterChips.map((chip) => (
            <span className="txn-filter-chip" key={chip.key}>
              {chip.label}
              <button type="button" onClick={chip.onRemove} aria-label={`Remove ${chip.label} filter`}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="txn-loading-shell">
          <div className="inv-skeleton">{Array.from({ length: 7 }).map((_, index) => <div className="inv-skeleton-row" key={index} />)}</div>
        </div>
      ) : error ? (
        <div className="inv-empty"><AlertTriangle size={28} /><h3>Could not load transactions</h3><p>{error}</p><button type="button" className="ops-main-action" onClick={() => load(queryRef.current)}>Retry</button></div>
      ) : transactions.length === 0 ? (
        <div className="inv-empty"><ReceiptText size={28} /><h3>No transactions found</h3><p>Try adjusting your filters, date range, or amount limits.</p></div>
      ) : (
        <>
          <div className="txn-table-summary">
            <span>{totalCount} result{totalCount === 1 ? '' : 's'}</span>
            <b>Sorted by {sortBy === 'newest' ? 'Newest' : sortBy === 'oldest' ? 'Oldest' : sortBy === 'highest' ? 'Highest amount' : 'Lowest amount'}</b>
          </div>

          <div className="inv-table-wrap">
            <table className="inv-table txn-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer / Date</th>
                  <th>Payment</th>
                  <th>Fulfillment / Status</th>
                  <th>Total</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => {
                  const paymentMeta = paymentStatusMeta(transaction)
                  const refundMeta = refundStatusMeta(transaction)
                  return (
                    <tr key={transaction.id} className={`txn-row-in ${transaction.isVoided ? 'txn-row-voided' : ''} ${rowMenuId === transaction.id ? 'txn-row-menu-open' : ''}`}>
                      <td><b>{transaction.orderNumber}</b><br /><small>{transaction.receiptNumber}</small></td>
                      <td>{transaction.customerName}<br /><small>{formatDateTime(transaction.createdAt)}</small></td>
                      <td><span className={`status-chip status-chip--${paymentMeta.tone}`}>{paymentMeta.label}</span><br /><small>{PAYMENT_METHOD_LABEL[transaction.paymentMethod] || '-'}</small></td>
                      <td><span className={`status-chip status-chip--${statusTone(transaction.isVoided ? 'Voided' : transaction.status)}`}>{transaction.isVoided ? 'Voided' : transaction.status}</span><br /><small>{getSourceLabel(transaction)} · {startCase(transaction.fulfillment)} · {transaction.itemCount} item{transaction.itemCount === 1 ? '' : 's'}</small>{refundMeta.key !== 'not_applicable' && <><br /><span className={`status-chip status-chip--${refundMeta.tone}`}>{refundMeta.label}</span></>}</td>
                      <td><b>{money(transaction.finalTotal)}</b></td>
                      <td>
                        <RowActionsMenu
                          transaction={transaction}
                          open={rowMenuId === transaction.id}
                          canManageFinancialActions={canManageFinancialActions}
                          onToggle={() => setRowMenuId((current) => (current === transaction.id ? '' : transaction.id))}
                          onViewDetails={() => openDetails(transaction)}
                          onViewReceipt={() => viewReceipt(transaction)}
                          onPrintReceipt={() => printReceipt(transaction)}
                          onDownloadReceipt={() => downloadReceipt(transaction)}
                          onViewProof={() => viewPaymentProof(transaction)}
                          onViewRelatedOrder={() => viewRelatedOrder(transaction)}
                          onRequestRefund={() => { setRefundTarget(transaction); setRowMenuId('') }}
                          onProcessRefund={() => { setDetailTarget(transaction); setRowMenuId('') }}
                          onVoid={() => { setVoidTarget(transaction); setRowMenuId('') }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="inv-cards txn-cards">
            {transactions.map((transaction) => {
              const paymentMeta = paymentStatusMeta(transaction)
              const refundMeta = refundStatusMeta(transaction)
              return (
                <article className={`inv-card txn-card txn-row-in ${transaction.isVoided ? 'txn-row-voided' : ''}`} key={transaction.id}>
                  <div className="inv-card-top">
                    <div>
                      <b>{transaction.orderNumber}</b>
                      <small>{transaction.receiptNumber}</small>
                    </div>
                    <span className={`status-chip status-chip--${statusTone(transaction.isVoided ? 'Voided' : transaction.status)}`}>{transaction.isVoided ? 'Voided' : transaction.status}</span>
                  </div>
                  <p className="inv-card-meta">{formatDateTime(transaction.createdAt)} - {transaction.customerName}</p>
                  <p className="inv-card-meta">{getSourceLabel(transaction)} - {transaction.fulfillment} - {transaction.itemCount} item{transaction.itemCount === 1 ? '' : 's'}</p>
                  <div className="txn-card-badges">
                    <span className={`status-chip status-chip--${paymentMeta.tone}`}>{paymentMeta.label}</span>
                    <span className={`status-chip status-chip--${refundMeta.tone}`}>{refundMeta.label}</span>
                  </div>
                  <p className="inv-card-qty">{money(transaction.finalTotal)}</p>
                  <div className="inv-card-actions">
                    <button type="button" className="ops-secondary-action" onClick={() => openDetails(transaction)}><Eye size={14} /> View Details</button>
                  </div>
                </article>
              )
            })}
          </div>

          <footer className="txn-pagination" aria-label="Transaction pagination">
            <div className="txn-pagination-summary"><b>Showing {firstResult}-{lastResult}</b><span>of {totalCount} transactions</span></div>
            <label className="txn-page-size"><span>Rows</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} aria-label="Rows per page">
              <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
            </select></label>
            <div className="txn-page-nav">
              <button type="button" aria-label="First page" title="First page" disabled={page === 1} onClick={() => setPage(1)}><ChevronsLeft size={16} /></button>
              <button type="button" aria-label="Previous page" title="Previous page" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} /></button>
              <span>Page <b>{page}</b> of {totalPages}</span>
              <button type="button" aria-label="Next page" title="Next page" disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}><ChevronRight size={16} /></button>
              <button type="button" aria-label="Last page" title="Last page" disabled={page === totalPages} onClick={() => setPage(totalPages)}><ChevronsRight size={16} /></button>
            </div>
          </footer>
        </>
      )}
      </section>

      {detailTarget && (
        <TransactionDrawer
          transactionId={detailTarget.id}
          initialTransaction={detailTarget}
          canManageFinancialActions={canManageFinancialActions}
          busyId={busyId}
          onClose={() => setDetailTarget(null)}
          onViewReceipt={viewReceipt}
          onPrintReceipt={printReceipt}
          onDownloadReceipt={downloadReceipt}
          onViewProof={viewPaymentProof}
          onRequestRefund={(transaction) => setRefundTarget(transaction)}
          onProcessRefund={(refund, approve) => setRefundProcessTarget({ refund, approve })}
          onVoid={(transaction) => setVoidTarget(transaction)}
          onCorrectPayment={(transaction) => setCorrectionTarget(transaction)}
        />
      )}
      {refundTarget && (
        <RefundModal transaction={refundTarget} busy={busyId === refundTarget.id} onClose={() => setRefundTarget(null)} onSubmit={runRefundRequest} />
      )}
      {refundProcessTarget && (
        <RefundProcessModal target={refundProcessTarget} busy={busyId === refundProcessTarget.refund.id} onClose={() => setRefundProcessTarget(null)} onSubmit={runProcessRefund} />
      )}
      {voidTarget && (
        <ReasonConfirmModal
          title="Void Transaction"
          kicker="Void"
          busy={busyId === voidTarget.id}
          description={`Voiding ${voidTarget.orderNumber} invalidates the recorded transaction for audit purposes. It stays visible in history but is excluded from settled sales.`}
          confirmLabel="Void Transaction"
          onClose={() => setVoidTarget(null)}
          onConfirm={runVoid}
        />
      )}
      {correctionTarget && (
        <PaymentCorrectionModal transaction={correctionTarget} busy={busyId === correctionTarget.id} onClose={() => setCorrectionTarget(null)} onSubmit={runCorrection} />
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

function RowActionsMenu({
  transaction, open, onToggle, canManageFinancialActions, onViewDetails, onViewReceipt,
  onPrintReceipt, onDownloadReceipt, onViewProof, onViewRelatedOrder, onRequestRefund, onProcessRefund, onVoid,
}) {
  const canRefund = canManageFinancialActions && paymentStatusMeta(transaction).key === 'paid' && processedRefundAmount(transaction) < transaction.finalTotal && !transaction.isVoided
  const hasPendingRefund = Boolean(pendingRefund(transaction)) && canManageFinancialActions
  const triggerRef = useRef(null)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })

  useEffect(() => {
    if (!open) return undefined
    const placeMenu = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const menuWidth = 220
      const menuHeight = 340
      const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth))
      const top = window.innerHeight - rect.bottom >= menuHeight ? rect.bottom + 8 : Math.max(8, rect.top - menuHeight - 8)
      setMenuPosition({ top, left })
    }
    placeMenu()
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    return () => {
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
    }
  }, [open])

  return (
    <div className="inv-overflow">
      <button ref={triggerRef} type="button" className="ops-icon-button small txn-action-more" aria-label={`Actions for ${transaction.orderNumber}`} aria-expanded={open} onClick={onToggle}><MoreVertical size={15} /></button>
      {open && createPortal(
        <div className="txn-row-menu" role="menu" style={menuPosition}>
          <button type="button" role="menuitem" onClick={onViewDetails}><Eye size={14} /> View Details</button>
          <button type="button" role="menuitem" onClick={onViewReceipt}><ReceiptText size={14} /> View Receipt</button>
          <button type="button" role="menuitem" onClick={onPrintReceipt}><Printer size={14} /> Print Receipt</button>
          <button type="button" role="menuitem" onClick={onDownloadReceipt}><Download size={14} /> Download Receipt</button>
          {transaction.paymentProofPath && <button type="button" role="menuitem" onClick={onViewProof}><ExternalLink size={14} /> View Payment Proof</button>}
          {hasPendingRefund && <button type="button" role="menuitem" onClick={onProcessRefund}><Undo2 size={14} /> Process Refund</button>}
          {canRefund && <button type="button" role="menuitem" onClick={onRequestRefund}><RotateCcw size={14} /> Request Refund</button>}
          {canManageFinancialActions && !transaction.isVoided && <button type="button" role="menuitem" className="danger" onClick={onVoid}><Ban size={14} /> Void Transaction</button>}
        </div>, document.body
      )}
    </div>
  )
}

function TransactionDrawer({
  transactionId, initialTransaction, canManageFinancialActions, busyId, onClose, onViewReceipt,
  onPrintReceipt, onDownloadReceipt, onViewProof, onRequestRefund, onProcessRefund, onVoid, onCorrectPayment,
}) {
  const { pricing } = usePricing()
  const [transaction, setTransaction] = useState(initialTransaction)
  const [audit, setAudit] = useState([])
  const [proofUrl, setProofUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const drawerBodyRef = useRef(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      fetchTransactionById(transactionId),
      fetchTransactionAudit(transactionId),
    ]).then(async ([freshTransaction, auditRows]) => {
      if (!active) return
      setTransaction(freshTransaction || initialTransaction)
      setAudit(auditRows)
      if (freshTransaction?.paymentProofPath) {
        try {
          const signedUrl = await getPaymentProofUrl(freshTransaction.paymentProofPath)
          if (active) setProofUrl(signedUrl || '')
        } catch {
          if (active) setProofUrl('')
        }
      } else {
        setProofUrl('')
      }
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [transactionId, initialTransaction])

  if (!transaction) return null

  const refundMeta = refundStatusMeta(transaction)
  const paymentMeta = paymentStatusMeta(transaction)
  const vatRate = transaction.vatRate ?? pricing.vatRate
  const pricesIncludeVat = transaction.pricesIncludeVat !== false
  const breakdown = buildVatExemptOrderBreakdown({
    subtotal: transaction.subtotal,
    discountSubtotal: transaction.discountSubtotal,
    discountType: transaction.discountType,
    discountAmount: transaction.discountAmount,
    vatExemptAmount: transaction.vatExemptAmount,
    vatRate,
    pricesIncludeVat,
  })
  const canRefund = canManageFinancialActions && paymentMeta.key === 'paid' && processedRefundAmount(transaction) < transaction.finalTotal && !transaction.isVoided
  const timeline = buildTimeline(transaction, audit)
  const sectionIds = {
    overview: `transaction-overview-${transaction.id}`,
    order: `transaction-order-${transaction.id}`,
    payment: `transaction-payment-${transaction.id}`,
    history: `transaction-history-${transaction.id}`,
  }
  const scrollToSection = (section) => {
    drawerBodyRef.current?.querySelector(`#${sectionIds[section]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="ops-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="ops-drawer txn-drawer" role="dialog" aria-modal="true" aria-labelledby="txn-drawer-title">
        <header className="txn-drawer-header">
          <div>
            <span className="settings-kicker">{transaction.receiptNumber}</span>
            <h2 id="txn-drawer-title">{transaction.orderNumber}</h2>
          </div>
          <div className="txn-header-total" aria-label={`Transaction total ${money(transaction.finalTotal)}`}>
            <span>Total</span>
            <b>{money(transaction.finalTotal)}</b>
          </div>
          <button type="button" onClick={onClose} aria-label="Close transaction details"><X size={20} /></button>
        </header>

        <nav className="txn-drawer-nav" aria-label="Transaction details sections">
          {Object.entries({ overview: 'Overview', order: 'Order', payment: 'Payment', history: 'History' }).map(([key, label]) => (
            <button key={key} type="button" onClick={() => scrollToSection(key)}>{label}</button>
          ))}
        </nav>

        <div className="ops-drawer-body txn-drawer-body" ref={drawerBodyRef}>
          <section id={sectionIds.overview} className="txn-detail-overview txn-drawer-section">
            <div className="txn-section-heading">
              <div><span>At a glance</span><h3>Transaction overview</h3></div>
              <div className="txn-pill-row">
                <span className={`status-chip status-chip--${statusTone(transaction.isVoided ? 'Voided' : transaction.status)}`}>{transaction.isVoided ? 'Voided' : transaction.status}</span>
                <span className={`status-chip status-chip--${paymentMeta.tone}`}>{paymentMeta.label}</span>
                <span className={`status-chip status-chip--${refundMeta.tone}`}>{refundMeta.label}</span>
              </div>
            </div>
            {transaction.isVoided && <p className="menu-badge-warning"><AlertTriangle size={13} /> Voided because: {transaction.voidedReason}</p>}
            {transaction.status === 'Cancelled' && <p className="menu-badge-warning"><AlertTriangle size={13} /> Cancelled by {transaction.cancelledByRole || 'Staff'} - {transaction.cancellationReason}{transaction.cancellationNotes ? ` (${transaction.cancellationNotes})` : ''}</p>}
            <div className="txn-overview-cards">
              <article className="txn-info-card">
                <span>Customer</span>
                <b>{transaction.customerName}</b>
                <small>{transaction.isGuest ? 'Guest checkout' : 'Registered customer'}</small>
                {(transaction.customerPhone || transaction.customerEmail) && <p>{transaction.customerPhone || transaction.customerEmail}</p>}
              </article>
              <article className="txn-info-card">
                <span>Fulfillment</span>
                <b>{transaction.fulfillment || 'Not specified'}</b>
                <small>{getSourceLabel(transaction)} · {transaction.cashierName || 'No staff recorded'}</small>
                {(transaction.scheduleDate || transaction.scheduleTime) && <p>{transaction.scheduleDate ? formatDateInput(transaction.scheduleDate) : ''}{transaction.scheduleDate && transaction.scheduleTime ? ' · ' : ''}{transaction.scheduleTime ? formatTime(transaction.scheduleTime) : ''}</p>}
              </article>
            </div>
            <div className="txn-detail-grid">
              <div><span>Created</span><b>{formatDateTime(transaction.createdAt)}</b></div>
              <div><span>Staff / cashier</span><b>{transaction.cashierName || '-'}</b></div>
              {transaction.customerEmail && <div><span>Email</span><b>{transaction.customerEmail}</b></div>}
              {transaction.customerPhone && <div><span>Phone</span><b>{transaction.customerPhone}</b></div>}
              {transaction.deliveryAddress && <div className="wide"><span>Delivery address</span><b>{transaction.deliveryAddress}</b></div>}
            </div>
          </section>

          <section id={sectionIds.order} className="txn-drawer-section">
            <div className="txn-section-heading"><div><span>Order details</span><h3>Items and totals</h3></div><b className="txn-item-count">{transaction.items.length} item{transaction.items.length === 1 ? '' : 's'}</b></div>
            <ul className="txn-item-list">
              {transaction.items.map((item) => (
                <li key={item.id}>
                  <div><b>{item.quantity}x {item.name}</b><span>{money(item.lineTotal)}</span></div>
                  <small>Original unit price: {money(item.unitPrice)}</small>
                  {item.addons?.length > 0 && <small>Add-ons: {item.addons.map((addon) => typeof addon === 'string' ? addon : addon?.name || 'Add-on').join(', ')}</small>}
                  {item.customizations && Object.keys(item.customizations).length > 0 && <small>{Object.entries(item.customizations).map(([key, value]) => `${startCase(key)}: ${value}`).join(' - ')}</small>}
                </li>
              ))}
            </ul>
            <div className="txn-total-list" aria-label="Order total breakdown">
              {breakdown.isVatExemptDiscount ? <>
                {breakdown.regularBaseAmount > 0 && <div><span>VATable Sale</span><b>{money(breakdown.regularBaseAmount)}</b></div>}
                <div><span>VAT-Exempt Sale</span><b>{money(breakdown.vatExemptSale)}</b></div>
                <div><span>{formatVatRate(vatRate)} VAT</span><b>{money(breakdown.regularVatAmount)}</b></div>
                <div><span>Less 20% SC/PWD Disc.</span><b>- {money(breakdown.discountAmount)}</b></div>
              </> : <>
                <div><span>Subtotal</span><b>{money(breakdown.baseAmount)}</b></div>
                <div><span>{pricesIncludeVat ? `VAT included (${formatVatRate(vatRate)})` : 'VAT calculated at checkout'}</span><b>{money(breakdown.vatAmount)}</b></div>
                <div><span>Discounts</span><b>{transaction.discountAmount > 0 ? `- ${money(transaction.discountAmount)}` : '—'}</b></div>
              </>}
              <div><span>Delivery fee</span><b>{transaction.deliveryFee > 0 ? money(transaction.deliveryFee) : '—'}</b></div>
              <div className="total"><span>Total</span><b>{money(transaction.finalTotal)}</b></div>
            </div>
          </section>

          <section id={sectionIds.payment} className="txn-drawer-section">
            <div className="txn-section-heading"><div><span>Payment</span><h3>Payment record</h3></div><span className={`status-chip status-chip--${paymentMeta.tone}`}>{paymentMeta.label}</span></div>
            <div className="txn-payment-record">
              <div className="txn-payment-method"><span>Method</span><b>{PAYMENT_METHOD_LABEL[transaction.paymentMethod] || '-'}</b></div>
              <div className="txn-detail-grid">
                {transaction.paymentReference && <div><span>Payment reference</span><b>{transaction.paymentReference}</b></div>}
                {transaction.bankName && <div><span>Bank</span><b>{transaction.bankName}</b></div>}
                {transaction.amountReceived != null && <div><span>Amount tendered</span><b>{money(transaction.amountReceived)}</b></div>}
                {transaction.changeAmount != null && <div><span>Change</span><b>{money(transaction.changeAmount)}</b></div>}
                {!transaction.paymentReference && !transaction.bankName && transaction.amountReceived == null && <div className="wide"><span>Payment reference</span><b>No additional payment details recorded</b></div>}
              </div>
            </div>
            {proofUrl && (
              <div className="txn-proof-card">
                <img src={proofUrl} alt="Payment proof" className="ops-proof-image" />
                <button type="button" className="secondary-button" onClick={() => onViewProof(transaction)}><ExternalLink size={14} /> Open Payment Proof</button>
              </div>
            )}
          </section>

          {transaction.refunds.length > 0 && (
            <section className="txn-drawer-section txn-exception-section">
              <div className="txn-section-heading"><div><span>Exceptions</span><h3>Refund activity</h3></div><AlertTriangle size={18} /></div>
              {transaction.refunds.map((refund) => (
                <div key={refund.id} className="txn-refund-row">
                  <p><b>{money(refund.amount)}</b> - {refund.reason} <span className={`status-chip status-chip--${refund.status === 'processed' ? 'completed' : refund.status === 'rejected' ? 'cancelled' : 'attention'}`}>{startCase(refund.status)}</span></p>
                  <small>Requested {formatDateTime(refund.requestedAt)}{refund.processedAt ? ` - Resolved ${formatDateTime(refund.processedAt)}` : ''}{refund.referenceNumber ? ` - Ref ${refund.referenceNumber}` : ''}</small>
                  {refund.status === 'pending' && canManageFinancialActions && (
                    <div className="txn-refund-actions">
                      <button type="button" className="ops-secondary-action compact" disabled={busyId === refund.id} onClick={() => onProcessRefund(refund, true)}>Mark Processed</button>
                      <button type="button" className="ops-destructive-action compact" disabled={busyId === refund.id} onClick={() => onProcessRefund(refund, false)}>Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          <section id={sectionIds.history} className="txn-drawer-section">
            <div className="txn-section-heading"><div><span>History</span><h3>Order activity</h3></div></div>
            <ul className="txn-timeline">
              {timeline.map((event) => (
                <li key={`${event.label}-${event.time || 'pending'}`}>
                  <span>{event.icon}</span>
                  <div>
                    <b>{event.label}</b>
                    <small>{event.time ? formatDateTime(event.time) : 'Waiting for update'}</small>
                    {event.detail && <p>{event.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="txn-drawer-section txn-audit-section">
            <div className="txn-section-heading"><div><span>Staff record</span><h3>Audit history</h3></div></div>
            {loading ? <p className="ops-proof-pending">Loading transaction history...</p> : audit.length === 0 ? <p className="ops-proof-pending">No audited actions recorded yet.</p> : (
              <ul className="inv-movement-list">
                {audit.map((entry) => (
                  <li key={entry.id}>
                    <span className={`inv-movement-type ${entry.action}`}>{entry.action.replace(/_/g, ' ')}</span>
                    <b>{entry.reason || 'No reason recorded'}</b>
                    <span className="inv-movement-meta">{entry.staffName} - {formatDateTime(entry.created_at)}</span>
                    {(entry.previous_value || entry.new_value) && <details className="txn-audit-details"><summary>View recorded changes</summary><small className="txn-audit-json">Previous: {JSON.stringify(entry.previous_value || {})} | New: {JSON.stringify(entry.new_value || {})}</small></details>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="ops-drawer-footer txn-drawer-footer">
          <button type="button" className="ops-main-action" onClick={() => onViewReceipt(transaction)}><Eye size={16} /> View Receipt</button>
          <details className="txn-footer-more">
            <summary aria-label="More transaction actions"><MoreVertical size={18} /></summary>
            <div role="menu" className="txn-footer-menu">
              <button type="button" role="menuitem" onClick={() => onPrintReceipt(transaction)}><Printer size={15} /> Print receipt</button>
              <button type="button" role="menuitem" onClick={() => onDownloadReceipt(transaction)}><Download size={15} /> Download receipt</button>
              {canRefund && <button type="button" role="menuitem" onClick={() => onRequestRefund(transaction)}><RotateCcw size={15} /> Request refund</button>}
              {canManageFinancialActions && paymentMeta.key !== 'paid' && !transaction.isVoided && <button type="button" role="menuitem" onClick={() => onCorrectPayment(transaction)}><Settings2 size={15} /> Correct payment</button>}
            </div>
          </details>
          {canManageFinancialActions && !transaction.isVoided && <button type="button" className="ops-destructive-action" onClick={() => onVoid(transaction)}><Ban size={16} /> Void</button>}
        </footer>
      </aside>
    </div>
  )
}

function buildTimeline(transaction, audit) {
  const items = [
    { label: 'Order recorded', time: transaction.createdAt, icon: <ReceiptText size={14} /> },
  ]
  if (transaction.paymentConfirmed) items.push({ label: 'Payment confirmed', time: transaction.updatedAt, icon: <Check size={14} />, detail: paymentStatusMeta(transaction).label })
  if (transaction.status === 'Preparing') items.push({ label: 'Preparing', time: transaction.updatedAt, icon: <Clock3 size={14} /> })
  if (transaction.status === 'Ready for Pickup') items.push({ label: 'Ready for pickup', time: transaction.updatedAt, icon: <ShoppingBag size={14} /> })
  if (transaction.status === 'Out for Delivery') items.push({ label: 'Out for delivery', time: transaction.updatedAt, icon: <ShoppingBag size={14} /> })
  if (['Completed', 'Received'].includes(transaction.status)) items.push({ label: transaction.status, time: transaction.updatedAt, icon: <Check size={14} /> })
  if (transaction.cancelledAt) items.push({ label: 'Cancelled', time: transaction.cancelledAt, icon: <Ban size={14} />, detail: transaction.cancellationReason })
  if (transaction.voidedAt) items.push({ label: 'Voided', time: transaction.voidedAt, icon: <Ban size={14} />, detail: transaction.voidedReason })
  audit.filter((entry) => entry.action.startsWith('refund_')).forEach((entry) => {
    items.push({ label: startCase(entry.action), time: entry.created_at, icon: <Undo2 size={14} />, detail: entry.reason || '' })
  })
  return items.sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0))
}

function RefundProcessModal({ target, busy, onClose, onSubmit }) {
  const { refund, approve } = target
  const [referenceNumber, setReferenceNumber] = useState(refund.referenceNumber || '')
  const submit = (event) => {
    event.preventDefault()
    if (approve && !referenceNumber.trim()) return
    onSubmit({ refund, approve, referenceNumber: referenceNumber.trim() || null })
  }
  return (
    <div className="payment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="refund-process-title">
        <span className="payment-modal-kicker">Refund control</span>
        <h2 id="refund-process-title">{approve ? 'Confirm refund transfer' : 'Reject refund request'}</h2>
        <p>{approve
          ? `Only mark this ${money(refund.amount)} refund as processed after the customer payout has actually been completed.`
          : `Rejecting this ${money(refund.amount)} refund will leave the cancelled order unresolved for follow-up.`}</p>
        <form onSubmit={submit}>
          {approve && <label className="field"><span>Transfer or refund reference</span><input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} placeholder="e.g. GCash or bank reference number" autoFocus required /></label>}
          <p className="ops-proof-pending">{approve ? 'Saving this reference completes the refund and sends the customer a completion email.' : 'This action does not record a completed customer payout.'}</p>
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Go back</button>
            <button className={approve ? 'primary-button' : 'danger-button'} type="submit" disabled={busy || (approve && !referenceNumber.trim())}>{busy ? 'Saving...' : approve ? 'Mark refund processed' : 'Reject refund'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function RefundModal({ transaction, busy, onClose, onSubmit }) {
  const remaining = transaction.finalTotal - processedRefundAmount(transaction) - transaction.refunds.filter((refund) => refund.status === 'pending').reduce((sum, refund) => sum + refund.amount, 0)
  const draftScope = `transactions:${transaction.id}:refund-draft`
  const [amount, setAmount, clearAmount] = useManagementSessionState(`${draftScope}:amount`, remaining.toFixed(2))
  const [reason, setReason, clearReason] = useManagementSessionState(`${draftScope}:reason`, '')
  const [method, setMethod, clearMethod] = useManagementSessionState(`${draftScope}:method`, transaction.paymentMethod || 'manual')
  const [error, setError] = useState('')
  const clearDraft = () => { clearAmount(); clearReason(); clearMethod() }
  const close = () => { clearDraft(); onClose() }

  const submit = async (event) => {
    event.preventDefault()
    const numeric = Number(amount)
    if (Number.isNaN(numeric) || numeric <= 0) return setError('Enter a refund amount greater than zero.')
    if (numeric > remaining) return setError(`Refund amount cannot exceed the remaining refundable balance of ${money(remaining)}.`)
    if (!reason.trim()) return setError('A refund reason is required.')
    setError('')
    if (await onSubmit({ amount: numeric, reason, method })) clearDraft()
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close() }}>
      <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="refund-title">
        <button className="payment-modal-close" type="button" onClick={close} disabled={busy} aria-label="Close">x</button>
        <span className="payment-modal-kicker">Refund</span>
        <h2 id="refund-title">Request refund for {transaction.orderNumber}</h2>
        <p>Remaining refundable balance: <b>{money(remaining)}</b></p>
        <p className="ops-proof-pending">Digital refunds stay pending until a staff member confirms the transfer or payout actually happened.</p>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field"><span>Refund amount</span><input type="number" min="0" max={remaining} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <label className="field"><span>Refund method</span>
              <select value={method} onChange={(event) => setMethod(event.target.value)}>
                <option value="cash">Cash</option>
                <option value="gcash">GCash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="manual">Other / Manual</option>
              </select>
            </label>
          </div>
          <label className="field"><span>Reason</span><textarea rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this refund is needed." required /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={close} disabled={busy}>Cancel</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Submitting...' : 'Request Refund'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ReasonConfirmModal({ title, kicker, description, confirmLabel, busy, onClose, onConfirm }) {
  const draftScope = `transactions:${kicker.toLowerCase()}:reason-draft`
  const [reason, setReason, clearReason] = useManagementSessionState(draftScope, '')
  const [error, setError] = useState('')
  const close = () => { clearReason(); onClose() }

  const submit = async (event) => {
    event.preventDefault()
    if (!reason.trim()) return setError('A reason is required.')
    setError('')
    if (await onConfirm(reason)) clearReason()
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close() }}>
      <section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="reason-confirm-title">
        <span className="payment-modal-kicker">{kicker}</span>
        <h2 id="reason-confirm-title">{title}</h2>
        <p>{description}</p>
        <form onSubmit={submit}>
          <label className="field"><span>Reason</span><textarea rows="3" value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={close} disabled={busy}>Cancel</button>
            <button className="danger-button" type="submit" disabled={busy}>{busy ? 'Saving...' : confirmLabel}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function PaymentCorrectionModal({ transaction, busy, onClose, onSubmit }) {
  const draftScope = `transactions:${transaction.id}:correction-draft`
  const [newStatus, setNewStatus, clearStatus] = useManagementSessionState(`${draftScope}:status`, transaction.paymentStatus === 'paid' ? 'pending' : 'paid')
  const [reason, setReason, clearReason] = useManagementSessionState(`${draftScope}:reason`, '')
  const [error, setError] = useState('')
  const clearDraft = () => { clearStatus(); clearReason() }
  const close = () => { clearDraft(); onClose() }

  const submit = async (event) => {
    event.preventDefault()
    if (!reason.trim()) return setError('A reason is required for this correction.')
    setError('')
    if (await onSubmit(newStatus, reason)) clearDraft()
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close() }}>
      <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="correction-title">
        <button className="payment-modal-close" type="button" onClick={close} disabled={busy} aria-label="Close">x</button>
        <span className="payment-modal-kicker">Payment correction</span>
        <h2 id="correction-title">Correct payment status for {transaction.orderNumber}</h2>
        <form onSubmit={submit}>
          <label className="field"><span>New payment status</span>
            <select value={newStatus} onChange={(event) => setNewStatus(event.target.value)}>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
            </select>
          </label>
          <label className="field"><span>Reason for correction</span><textarea rows="3" value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={close} disabled={busy}>Cancel</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save Correction'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
