import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Bell, Ban, Banknote, Check, ChevronDown, Download, ExternalLink, Eye,
  Package, PhilippinePeso, ReceiptText, RefreshCw, RotateCcw, Search, Settings2, TrendingDown, TrendingUp, Undo2, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { getCurrentPortalSession } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  fetchTransactions, fetchTransactionAudit, getPaymentProofUrl,
  voidOrder, requestRefund, processRefund, correctPaymentStatus, exportTransactionsToCsv,
} from '../services/transactionsService'

const ORDER_STATUSES = ['Order Received', 'Awaiting Payment Verification', 'Pending Confirmation', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Completed', 'Cancelled', 'Ordered']
const PAYMENT_METHOD_LABEL = { cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank Transfer', cod: 'Cash on Delivery' }
const PAYMENT_STATUS_LABEL = { paid: 'Paid', pending: 'Pending' }
const REFUND_STATUS_LABEL = { not_applicable: 'N/A', pending: 'Refund Pending', processed: 'Refunded', rejected: 'Refund Rejected' }
const STATUS_TONE = {
  'Completed': 'completed', 'Cancelled': 'cancelled', 'Preparing': 'preparing',
  'Ready for Pickup': 'pickup', 'Out for Delivery': 'delivery', 'Ordered': 'confirmed',
}
function statusTone(status) {
  if (STATUS_TONE[status]) return STATUS_TONE[status]
  if (/pending|awaiting|received/i.test(status)) return 'attention'
  return 'neutral'
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
  const start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0)
  return { from: start.toISOString(), to: new Date().toISOString() }
}
function monthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: start.toISOString(), to: new Date().toISOString() }
}
function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value))
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
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
  const [refundStatus, setRefundStatus] = useState('all')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const [detail, setDetail] = useState(null)
  const [refundTarget, setRefundTarget] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [correctionTarget, setCorrectionTarget] = useState(null)

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { getCurrentPortalSession().then(({ profile }) => setProfile(profile)) }, [])

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchTransactions({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, orderSource, fulfillment, paymentMethod, paymentStatus, orderStatus, refundStatus })
      setTransactions(data)
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load transactions.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [dateFrom, dateTo, orderSource, fulfillment, paymentMethod, paymentStatus, orderStatus, refundStatus])

  useEffect(() => {
    const channel = supabase
      .channel('transactions-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refunds' }, () => load())
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pushToast = (type, message) => {
    const id = crypto.randomUUID()
    setToasts((c) => [...c, { id, type, message }])
    setTimeout(() => setToasts((c) => c.filter((t) => t.id !== id)), 4500)
  }

  const applyQuickRange = (key) => {
    setQuickRange(key)
    setPage(1)
    if (key === 'all') { setDateFrom(''); setDateTo(''); return }
    if (key === 'today') { const r = manilaDayRange(0); setDateFrom(r.from); setDateTo(r.to); return }
    if (key === 'yesterday') { const r = manilaDayRange(-1); setDateFrom(r.from); setDateTo(r.to); return }
    if (key === 'week') { const r = weekRange(); setDateFrom(r.from); setDateTo(r.to); return }
    if (key === 'month') { const r = monthRange(); setDateFrom(r.from); setDateTo(r.to); return }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const min = minAmount !== '' ? Number(minAmount) : null
    const max = maxAmount !== '' ? Number(maxAmount) : null
    return transactions.filter((t) => {
      if (min !== null && t.finalTotal < min) return false
      if (max !== null && t.finalTotal > max) return false
      if (!q) return true
      return [
        t.orderNumber, t.receiptNumber, t.customerName, t.customerEmail, t.customerPhone,
        t.paymentReference, t.cashierName, ...t.items.map((i) => i.name),
      ].some((field) => String(field || '').toLowerCase().includes(q))
    })
  }, [transactions, search, minAmount, maxAmount])

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sortBy === 'newest') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    else if (sortBy === 'oldest') list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    else if (sortBy === 'highest') list.sort((a, b) => b.finalTotal - a.finalTotal)
    else if (sortBy === 'lowest') list.sort((a, b) => a.finalTotal - b.finalTotal)
    return list
  }, [filtered, sortBy])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize)

  const summary = useMemo(() => {
    const completedPaid = filtered.filter((t) => t.status === 'Completed' && t.paymentStatus === 'paid' && !t.isVoided)
    const grossSales = completedPaid.reduce((s, t) => s + t.finalTotal, 0)
    const discounts = completedPaid.reduce((s, t) => s + t.discountAmount, 0)
    const deliveryFees = completedPaid.reduce((s, t) => s + t.deliveryFee, 0)
    const cancelled = filtered.filter((t) => t.status === 'Cancelled').length
    const refundedAmount = filtered.reduce((s, t) => s + t.refunds.filter((r) => r.status === 'processed').reduce((rs, r) => rs + r.amount, 0), 0)
    return {
      total: filtered.length,
      completedCount: completedPaid.length,
      grossSales, discounts, deliveryFees, cancelled, refundedAmount,
      netSales: grossSales - refundedAmount,
    }
  }, [filtered])

  const hasActiveFilters = quickRange !== 'all' || search || orderSource !== 'all' || fulfillment !== 'all' || paymentMethod !== 'all' || paymentStatus !== 'all' || orderStatus !== 'all' || refundStatus !== 'all' || minAmount !== '' || maxAmount !== ''
  const resetFilters = () => {
    setQuickRange('all'); setDateFrom(''); setDateTo(''); setSearch(''); setOrderSource('all'); setFulfillment('all')
    setPaymentMethod('all'); setPaymentStatus('all'); setOrderStatus('all'); setRefundStatus('all'); setMinAmount(''); setMaxAmount(''); setPage(1)
  }

  const runVoid = async (reason) => {
    setBusyId(voidTarget.id)
    try {
      await voidOrder(voidTarget.id, reason)
      pushToast('success', `${voidTarget.orderNumber} was voided.`)
      setVoidTarget(null)
      await load()
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not void this transaction.'))
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
      await load()
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not request this refund.'))
    } finally {
      setBusyId('')
    }
  }

  const runProcessRefund = async (refund, approve) => {
    setBusyId(refund.id)
    try {
      await processRefund({ refundId: refund.id, approve, referenceNumber: refund.referenceNumber })
      pushToast('success', approve ? 'Refund marked as processed.' : 'Refund rejected.')
      await load()
      setDetail((d) => d && ({ ...d }))
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
      await load()
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not correct the payment status.'))
    } finally {
      setBusyId('')
    }
  }

  const runExport = () => {
    const csv = exportTransactionsToCsv(sorted, profile?.full_name || profile?.email)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    pushToast('success', `Exported ${sorted.length} transaction${sorted.length === 1 ? '' : 's'}.`)
  }

  return (
    <AppShell role="staff" title="Transactions" eyebrow="Review order and payment history across all channels." actions={
      <div className="ops-header-actions">
        <div className="ops-clock">
          <span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span>
          <b>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).format(now)}</b>
        </div>
        <button type="button" className="ops-icon-button" aria-label="Refresh transactions" title="Refresh" onClick={load} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
        </button>
        <button type="button" className="ops-main-action inv-record-btn" onClick={runExport} disabled={loading || sorted.length === 0}><Download size={16} /> Export CSV</button>
      </div>
    }>
      {error && <p className="form-error">{error}</p>}

      <div className="inv-summary-row txn-summary-row">
        <div className="inv-summary-card tone-neutral"><ReceiptText size={18} /><span>Total Transactions</span><b>{summary.total}</b></div>
        <div className="inv-summary-card tone-green"><Check size={18} /><span>Completed Sales</span><b>{summary.completedCount}</b></div>
        <div className="inv-summary-card tone-blue"><TrendingUp size={18} /><span>Gross Sales</span><b>{money(summary.grossSales)}</b></div>
        <div className="inv-summary-card tone-amber"><Banknote size={18} /><span>Discounts</span><b>{money(summary.discounts)}</b></div>
        <div className="inv-summary-card tone-blue"><Package size={18} /><span>Delivery Fees</span><b>{money(summary.deliveryFees)}</b></div>
        <div className="inv-summary-card tone-red"><Ban size={18} /><span>Cancelled Orders</span><b>{summary.cancelled}</b></div>
        <div className="inv-summary-card tone-red"><Undo2 size={18} /><span>Refunded Amount</span><b>{money(summary.refundedAmount)}</b></div>
        <div className="inv-summary-card tone-green"><PhilippinePeso size={18} /><span>Net Sales</span><b>{money(summary.netSales)}</b></div>
      </div>

      <div className="menu-manage-tools">
        <label className="menu-manage-search">
          <Search size={17} /><span className="sr-only">Search transactions</span>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search order #, receipt, customer, product, reference…" />
          {search && <button type="button" className="menu-manage-search-clear" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
        </label>
        <div className="menu-manage-chip-row">
          {[['all', 'All Time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'], ['month', 'This Month']].map(([key, label]) => (
            <button type="button" key={key} className={`menu-manage-chip ${quickRange === key ? 'active' : ''}`} onClick={() => applyQuickRange(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="inv-toolbar">
        <button type="button" className="ops-secondary-action compact" onClick={() => setFiltersOpen((v) => !v)}><Settings2 size={14} /> Filters <ChevronDown size={14} className={filtersOpen ? 'rotated' : ''} /></button>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort">
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          <option value="highest">Highest total</option><option value="lowest">Lowest total</option>
        </select>
        {hasActiveFilters && <button type="button" className="ops-destructive-action compact" onClick={resetFilters}>Reset Filters</button>}
      </div>

      {filtersOpen && (
        <div className="inv-toolbar menu-extra-filters">
          <label className="field compact"><span>From</span><input type="date" value={dateFrom ? dateFrom.slice(0, 10) : ''} onChange={(e) => { setQuickRange('custom'); setDateFrom(e.target.value ? new Date(e.target.value + 'T00:00:00').toISOString() : '') }} /></label>
          <label className="field compact"><span>To</span><input type="date" value={dateTo ? dateTo.slice(0, 10) : ''} onChange={(e) => { setQuickRange('custom'); setDateTo(e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : '') }} /></label>
          <select value={orderSource} onChange={(e) => setOrderSource(e.target.value)} aria-label="Order source">
            <option value="all">Online + Walk-in</option><option value="customer_pos">Online</option><option value="cashier_pos">Walk-in</option>
          </select>
          <select value={fulfillment} onChange={(e) => setFulfillment(e.target.value)} aria-label="Fulfillment">
            <option value="all">All fulfillment</option><option value="delivery">Delivery</option><option value="pickup">Pickup</option><option value="walk-in">Walk-in</option>
          </select>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} aria-label="Payment method">
            <option value="all">All payment methods</option>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} aria-label="Payment status">
            <option value="all">All payment statuses</option>
            {Object.entries(PAYMENT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)} aria-label="Order status">
            <option value="all">All order statuses</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={refundStatus} onChange={(e) => setRefundStatus(e.target.value)} aria-label="Refund status">
            <option value="all">All refund statuses</option>
            {Object.entries(REFUND_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="field compact"><span>Min amount</span><input type="number" min="0" value={minAmount} onChange={(e) => { setMinAmount(e.target.value); setPage(1) }} /></label>
          <label className="field compact"><span>Max amount</span><input type="number" min="0" value={maxAmount} onChange={(e) => { setMaxAmount(e.target.value); setPage(1) }} /></label>
        </div>
      )}

      {loading ? (
        <div className="inv-skeleton">{Array.from({ length: 6 }).map((_, i) => <div className="inv-skeleton-row" key={i} />)}</div>
      ) : pageItems.length === 0 ? (
        <div className="inv-empty"><ReceiptText size={28} /><h3>No transactions found</h3><p>Try adjusting your filters or date range.</p></div>
      ) : (
        <>
          <div className="inv-table-wrap">
            <table className="inv-table txn-table">
              <thead>
                <tr>
                  <th>Order</th><th>Date</th><th>Customer</th><th>Source</th><th>Fulfillment</th><th>Items</th>
                  <th>Payment</th><th>Order Status</th><th>Refund</th><th>Staff</th><th>Total</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((t) => (
                  <tr key={t.id} className={t.isVoided ? 'txn-row-voided' : ''}>
                    <td><b>{t.orderNumber}</b><br /><small>{t.receiptNumber}</small></td>
                    <td>{formatDateTime(t.createdAt)}</td>
                    <td>{t.customerName}</td>
                    <td>{t.isOnline ? 'Online' : 'Walk-in'}</td>
                    <td>{t.fulfillment}</td>
                    <td>{t.itemCount}</td>
                    <td>{PAYMENT_METHOD_LABEL[t.paymentMethod] || '—'}<br /><span className={`status-chip status-chip--${t.paymentStatus === 'paid' ? 'completed' : 'attention'}`}>{PAYMENT_STATUS_LABEL[t.paymentStatus] || t.paymentStatus}</span></td>
                    <td><span className={`status-chip status-chip--${statusTone(t.status)}`}>{t.isVoided ? 'Voided' : t.status}</span></td>
                    <td>{t.refundStatus !== 'not_applicable' ? <span className={`status-chip status-chip--${t.refundStatus === 'processed' ? 'completed' : t.refundStatus === 'rejected' ? 'cancelled' : 'attention'}`}>{REFUND_STATUS_LABEL[t.refundStatus]}</span> : '—'}</td>
                    <td>{t.cashierName || (t.isOnline ? '—' : 'Unknown')}</td>
                    <td><b>{money(t.finalTotal)}</b></td>
                    <td><button type="button" className="ops-secondary-action compact" onClick={() => setDetail(t)}><Eye size={14} /> View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="inv-cards txn-cards">
            {pageItems.map((t) => (
              <article className={`inv-card txn-card ${t.isVoided ? 'txn-row-voided' : ''}`} key={t.id}>
                <div className="inv-card-top"><b>{t.orderNumber}</b><span className={`status-chip status-chip--${statusTone(t.status)}`}>{t.isVoided ? 'Voided' : t.status}</span></div>
                <p className="inv-card-meta">{formatDateTime(t.createdAt)} · {t.customerName}</p>
                <p className="inv-card-meta">{t.isOnline ? 'Online' : 'Walk-in'} · {t.fulfillment} · {t.itemCount} item{t.itemCount === 1 ? '' : 's'}</p>
                <p className="inv-card-qty">{money(t.finalTotal)}</p>
                <p className="inv-card-thresholds">{PAYMENT_METHOD_LABEL[t.paymentMethod] || '—'} · {PAYMENT_STATUS_LABEL[t.paymentStatus] || t.paymentStatus}</p>
                <div className="inv-card-actions">
                  <button type="button" className="ops-secondary-action" onClick={() => setDetail(t)}><Eye size={14} /> View Details</button>
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="inv-pagination">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span>Page {page} of {totalPages} · {sorted.length} transactions</span>
              <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {detail && (
        <TransactionDrawer
          transaction={transactions.find((t) => t.id === detail.id) || detail}
          onClose={() => setDetail(null)}
          onRequestRefund={() => setRefundTarget(detail)}
          onProcessRefund={(refund, approve) => runProcessRefund(refund, approve)}
          onVoid={() => setVoidTarget(detail)}
          onCorrectPayment={() => setCorrectionTarget(detail)}
          busyId={busyId}
        />
      )}
      {refundTarget && (
        <RefundModal transaction={refundTarget} busy={busyId === refundTarget.id} onClose={() => setRefundTarget(null)} onSubmit={runRefundRequest} />
      )}
      {voidTarget && (
        <ReasonConfirmModal
          title="Void Transaction" kicker="Void" busy={busyId === voidTarget.id}
          description={`Voiding ${voidTarget.orderNumber} marks this recorded transaction as invalid. It stays in history for audit purposes but is excluded from sales totals.`}
          confirmLabel="Void Transaction" onClose={() => setVoidTarget(null)} onConfirm={runVoid}
        />
      )}
      {correctionTarget && (
        <PaymentCorrectionModal transaction={correctionTarget} busy={busyId === correctionTarget.id} onClose={() => setCorrectionTarget(null)} onSubmit={runCorrection} />
      )}

      <div className="ops-toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div className={`ops-toast ops-toast-${t.type}`} key={t.id}>{t.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />} {t.message}</div>)}
      </div>
    </AppShell>
  )
}

function TransactionDrawer({ transaction: t, onClose, onRequestRefund, onProcessRefund, onVoid, onCorrectPayment, busyId }) {
  const [audit, setAudit] = useState([])
  const [proofUrl, setProofUrl] = useState('')
  const [loadingExtra, setLoadingExtra] = useState(true)

  useEffect(() => {
    let active = true
    setLoadingExtra(true)
    Promise.all([
      fetchTransactionAudit(t.id),
      t.paymentProofPath ? getPaymentProofUrl(t.paymentProofPath) : Promise.resolve(''),
    ]).then(([a, url]) => { if (active) { setAudit(a); setProofUrl(url) } })
      .catch(() => {})
      .finally(() => { if (active) setLoadingExtra(false) })
    return () => { active = false }
  }, [t.id, t.paymentProofPath, t.updatedAt])

  const remainingRefundable = t.finalTotal - t.refunds.filter((r) => r.status !== 'rejected').reduce((s, r) => s + r.amount, 0)
  const canManage = t.status !== 'Cancelled' || t.refunds.length > 0

  return (
    <div className="ops-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="ops-drawer txn-drawer" role="dialog" aria-modal="true" aria-labelledby="txn-drawer-title">
        <header>
          <div><span className="settings-kicker">{t.receiptNumber}</span><h2 id="txn-drawer-title">{t.orderNumber}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close transaction details"><X size={20} /></button>
        </header>
        <div className="ops-drawer-body">
          <section>
            <h3>Overview</h3>
            <p><span className={`status-chip status-chip--${statusTone(t.status)}`}>{t.isVoided ? 'Voided' : t.status}</span> <span className={`status-chip status-chip--${t.paymentStatus === 'paid' ? 'completed' : 'attention'}`}>{PAYMENT_STATUS_LABEL[t.paymentStatus]}</span> {t.refundStatus !== 'not_applicable' && <span className={`status-chip status-chip--${t.refundStatus === 'processed' ? 'completed' : t.refundStatus === 'rejected' ? 'cancelled' : 'attention'}`}>{REFUND_STATUS_LABEL[t.refundStatus]}</span>}</p>
            <p>{formatDateTime(t.createdAt)} · {t.isOnline ? 'Online order' : 'Walk-in / Cashier'} · {t.fulfillment}</p>
            {t.isVoided && <p className="menu-badge-warning"><AlertTriangle size={13} /> Voided — {t.voidedReason}</p>}
            {t.status === 'Cancelled' && <p className="menu-badge-warning"><AlertTriangle size={13} /> Cancelled by {t.cancelledByRole} — {t.cancellationReason}{t.cancellationNotes ? ` (${t.cancellationNotes})` : ''}</p>}
          </section>
          <section>
            <h3>Customer</h3>
            <p>{t.customerName}</p>
            {t.customerEmail && <p>{t.customerEmail}</p>}
            {t.customerPhone && <p>{t.customerPhone}</p>}
            {t.deliveryAddress && <p>Deliver to: {t.deliveryAddress}</p>}
            {t.cashierName && <p>Cashier: {t.cashierName}</p>}
          </section>
          <section>
            <h3>Items</h3>
            <ul className="txn-item-list">
              {t.items.map((i) => (
                <li key={i.id}>
                  <div><b>{i.quantity}× {i.name}</b><span>{money(i.lineTotal)}</span></div>
                  {i.addons?.length > 0 && <small>Add-ons: {i.addons.map((a) => a.name || a).join(', ')}</small>}
                  {i.customizations && Object.keys(i.customizations).length > 0 && <small>{Object.entries(i.customizations).map(([k, v]) => `${k}: ${v}`).join(' · ')}</small>}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Payment</h3>
            <p>Subtotal: {money(t.subtotal)}</p>
            {t.discountAmount > 0 && <p>Discount ({t.discountType}): -{money(t.discountAmount)}</p>}
            {t.deliveryFee > 0 && <p>Delivery fee: {money(t.deliveryFee)}</p>}
            <p><b>Total: {money(t.finalTotal)}</b></p>
            <p>Method: {PAYMENT_METHOD_LABEL[t.paymentMethod] || '—'}</p>
            {t.paymentMethod === 'cash' && t.amountReceived !== null && <><p>Amount tendered: {money(t.amountReceived)}</p><p>Change: {money(t.changeAmount)}</p></>}
            {t.paymentReference && <p>Reference #: {t.paymentReference}</p>}
            {t.bankName && <p>Bank: {t.bankName}</p>}
            {proofUrl && <p><a href={proofUrl} target="_blank" rel="noreferrer" className="text-button">View payment proof <ExternalLink size={12} /></a></p>}
          </section>
          {t.refunds.length > 0 && (
            <section>
              <h3>Refunds</h3>
              {t.refunds.map((r) => (
                <div key={r.id} className="txn-refund-row">
                  <p><b>{money(r.amount)}</b> — {r.reason} <span className={`status-chip status-chip--${r.status === 'processed' ? 'completed' : r.status === 'rejected' ? 'cancelled' : 'attention'}`}>{r.status}</span></p>
                  <small>Requested {formatDateTime(r.requestedAt)}{r.processedAt ? ` · Processed ${formatDateTime(r.processedAt)}` : ''}{r.referenceNumber ? ` · Ref: ${r.referenceNumber}` : ''}</small>
                  {r.status === 'pending' && (
                    <div className="txn-refund-actions">
                      <button type="button" className="ops-secondary-action compact" disabled={busyId === t.id} onClick={() => onProcessRefund(r, true)}>Mark Processed</button>
                      <button type="button" className="ops-destructive-action compact" disabled={busyId === t.id} onClick={() => onProcessRefund(r, false)}>Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
          <section>
            <h3>Audit history</h3>
            {loadingExtra ? <p className="ops-proof-pending">Loading…</p> : audit.length === 0 ? <p className="ops-proof-pending">No audited actions on this transaction.</p> : (
              <ul className="inv-movement-list">
                {audit.map((a) => (
                  <li key={a.id}><span className={`inv-movement-type ${a.action}`}>{a.action.replace(/_/g, ' ')}</span><b>{a.reason || '—'}</b><span className="inv-movement-meta">{a.staffName} · {formatDateTime(a.created_at)}</span></li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <footer className="ops-drawer-footer txn-drawer-footer">
          <button type="button" className="ops-secondary-action" onClick={() => window.print()}><ReceiptText size={16} /> Print Receipt</button>
          {t.paymentStatus === 'paid' && remainingRefundable > 0 && !t.isVoided && (
            <button type="button" className="ops-secondary-action" onClick={onRequestRefund}><RotateCcw size={16} /> Request Refund</button>
          )}
          {t.paymentStatus !== 'paid' && (
            <button type="button" className="ops-secondary-action" onClick={onCorrectPayment}><Settings2 size={16} /> Correct Payment</button>
          )}
          {!t.isVoided && (
            <button type="button" className="ops-destructive-action" onClick={onVoid}><Ban size={16} /> Void</button>
          )}
        </footer>
      </aside>
    </div>
  )
}

function RefundModal({ transaction, busy, onClose, onSubmit }) {
  const remaining = transaction.finalTotal - transaction.refunds.filter((r) => r.status !== 'rejected').reduce((s, r) => s + r.amount, 0)
  const [amount, setAmount] = useState(remaining.toFixed(2))
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState(transaction.paymentMethod || 'manual')
  const [error, setError] = useState('')

  const submit = (event) => {
    event.preventDefault()
    const numeric = Number(amount)
    if (Number.isNaN(numeric) || numeric <= 0) return setError('Enter a refund amount greater than zero.')
    if (numeric > remaining) return setError(`Refund amount cannot exceed the remaining balance of ${money(remaining)}.`)
    if (!reason.trim()) return setError('A refund reason is required.')
    setError('')
    onSubmit({ amount: numeric, reason, method })
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="refund-title">
        <button className="payment-modal-close" type="button" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        <span className="payment-modal-kicker">Refund</span>
        <h2 id="refund-title">Request refund for {transaction.orderNumber}</h2>
        <p>Remaining refundable balance: <b>{money(remaining)}</b></p>
        <p className="ops-proof-pending">GCash and Bank Transfer refunds are not processed automatically — this records the refund as pending until staff confirm the money was actually sent back.</p>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field"><span>Refund amount</span><input type="number" min="0" max={remaining} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label className="field"><span>Refund method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank_transfer">Bank Transfer</option><option value="manual">Other / Manual</option>
              </select>
            </label>
          </div>
          <label className="field"><span>Reason</span><textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Item unavailable, order error…" required /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Request Refund'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ReasonConfirmModal({ title, kicker, description, confirmLabel, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const submit = (event) => {
    event.preventDefault()
    if (!reason.trim()) return setError('A reason is required.')
    setError('')
    onConfirm(reason)
  }
  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="reason-confirm-title">
        <span className="payment-modal-kicker">{kicker}</span>
        <h2 id="reason-confirm-title">{title}</h2>
        <p>{description}</p>
        <form onSubmit={submit}>
          <label className="field"><span>Reason</span><textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="danger-button" type="submit" disabled={busy}>{busy ? 'Saving…' : confirmLabel}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function PaymentCorrectionModal({ transaction, busy, onClose, onSubmit }) {
  const [newStatus, setNewStatus] = useState(transaction.paymentStatus === 'paid' ? 'pending' : 'paid')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const submit = (event) => {
    event.preventDefault()
    if (!reason.trim()) return setError('A reason is required for this correction.')
    setError('')
    onSubmit(newStatus, reason)
  }
  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="correction-title">
        <button className="payment-modal-close" type="button" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        <span className="payment-modal-kicker">Payment correction</span>
        <h2 id="correction-title">Correct payment status for {transaction.orderNumber}</h2>
        <form onSubmit={submit}>
          <label className="field"><span>New payment status</span>
            <select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              <option value="paid">Paid</option><option value="pending">Pending</option>
            </select>
          </label>
          <label className="field"><span>Reason for correction</span><textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} required /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Correction'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
