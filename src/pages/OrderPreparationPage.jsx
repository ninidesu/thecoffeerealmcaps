import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Bell, Bike, Check, Clock, Coffee,
  MapPin, Package, Phone, RefreshCw, Search, ShoppingBag, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { usePricing } from '../context/usePricing'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { buildVatExemptOrderBreakdown, formatVatRate } from '../utils/pricing'
import {
  fetchOpsOrders, fetchAddonNameMap, confirmOrder, advanceOrderStatus,
  cancelOrder, reviewCancellation, resolveCancellation, completeCancellationRefund, getPaymentProofUrl,
} from '../services/opsOrderService'
import { getCurrentPortalSession } from '../lib/auth'
import { fetchStaffPreferences, getRememberedStaffFilters, rememberStaffFilters, shouldShowSystemNotification } from '../services/staffSettingsService'
import { useManagementSessionState } from '../hooks/useManagementSessionState'

const PENDING_STATUSES = ['Order Received', 'Awaiting Payment Verification', 'Pending Confirmation']

const COLUMNS = [
  { key: 'pending', title: 'Pending Confirmation', subtitle: 'Verify payment proofs', icon: Clock, tone: 'amber' },
  { key: 'preparing', title: 'Preparing', subtitle: 'Orders being prepared', icon: Coffee, tone: 'blue' },
  { key: 'ready', title: 'Ready for Pickup / Dine-in / Take-out', icon: Package, tone: 'green' },
  { key: 'delivery', title: 'Out for Delivery', subtitle: 'Orders currently being delivered', icon: Bike, tone: 'teal' },
]

const ORDER_TABS = ['active', 'completed', 'cancelled']

function normalizeOrderTab(value) {
  if (value === 'scheduled') return 'active'
  return ORDER_TABS.includes(value) ? value : 'active'
}

function stageOf(order) {
  if (order.status === 'Cancelled') return 'cancelled'
  if (PENDING_STATUSES.includes(order.status)) return 'pending'
  if (order.status === 'Preparing') return 'preparing'
  if (order.status === 'Ready for Pickup') return 'ready'
  if (order.status === 'Out for Delivery') return 'delivery'
  if (['Completed', 'Received'].includes(order.status)) return 'completed'
  return 'pending'
}

function paymentMethod(order) {
  return order.payments?.[0]?.method || 'gcash'
}
function paymentMethodLabel(method) {
  return method === 'cash' ? 'Cash' : method === 'cod' ? 'Cash on Delivery' : method === 'bank_transfer' ? 'Bank Transfer' : 'GCash'
}
function paymentStatusLabel(order) {
  const method = paymentMethod(order)
  if (method === 'cod') return order.payment_status === 'paid' ? 'Paid' : 'Pay upon delivery'
  return order.payment_confirmed ? 'Verified' : 'Pending verification'
}
function itemCount(order) {
  return (order.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)
}
function scheduleDate(order) {
  if (!order.schedule_date || !order.schedule_time) return null
  return new Date(`${order.schedule_date}T${order.schedule_time}`)
}
function isOverdue(order) {
  const stage = stageOf(order)
  if (stage === 'completed' || stage === 'cancelled') return false
  const when = scheduleDate(order)
  return when ? when.getTime() < Date.now() : false
}
function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(dateString))
}
function scheduleLabel(order) {
  const when = scheduleDate(order)
  if (!when && order.order_type === 'walk-in') return 'Walk-in · Now'
  if (!when) return 'Schedule pending'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(when)
}
function filterDateFor(order, view) {
  const date = view === 'cancelled'
    ? order.cancellation_requested_at || order.cancelled_at || order.created_at
    : order.schedule_date || order.created_at
  if (!date) return ''
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date(date).toLocaleDateString('en-CA')
}

function cancellationPaymentState(order) {
  const method = paymentMethod(order)
  const payment = order.payments?.[0]
  const paid = order.payment_confirmed || order.payment_status === 'paid' || payment?.status === 'paid'
  if (paid) return 'paid'
  if (method !== 'cod' && order.payment_proof_path) return 'proof_pending'
  return 'unpaid'
}

function cancellationRequested(order) {
  return order.cancellation_status === 'requested' || Boolean(order.fulfillment_hold)
}

function cancellationStartedByStaff(order) {
  return order.cancellation_requested_by_role === 'Operations Staff'
    || order.cancelled_by_role === 'Operations Staff'
}

function refundStatusLabel(value) {
  return value === 'pending_review' ? 'Payment review pending'
    : value === 'pending' ? 'Refund pending'
    : value === 'processing' ? 'Refund processing'
    : value === 'processed' ? 'Refund completed'
    : value === 'failed' ? 'Refund needs attention'
    : value === 'rejected' ? 'Refund rejected'
    : 'No refund required'
}

function actionableRefund(order) {
  return (order.refunds || []).find((refund) => ['pending', 'approved', 'processing', 'failed'].includes(refund.refund_status)) || null
}

function mainActionFor(order) {
  if (cancellationRequested(order)) return null
  const stage = stageOf(order)
  const method = paymentMethod(order)
  if (stage === 'pending') {
    if (method === 'cod') return { label: 'Confirm Order', next: null, kind: 'confirm' }
    return { label: 'Verify Payment', next: null, kind: 'confirm', disabled: !order.payment_proof_path, disabledReason: 'Waiting for the customer to upload payment proof.' }
  }
  if (stage === 'preparing') {
    return ['pickup', 'walk-in'].includes(order.order_type)
      ? { label: 'Mark as Ready', next: 'Ready for Pickup', kind: 'advance' }
      : { label: 'Mark Out for Delivery', next: 'Out for Delivery', kind: 'advance' }
  }
  if (stage === 'ready') return { label: order.order_type === 'walk-in' ? 'Complete Order' : 'Complete Pickup', next: 'Completed', kind: 'advance' }
  if (stage === 'delivery') return null
  return null
}

export default function OrderPreparationPage() {
  const [orders, setOrders] = useState([])
  const [addonNames, setAddonNames] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [busyId, setBusyId] = useState('')
  const [toasts, setToasts] = useState([])
  const [drawerOrder, setDrawerOrder] = useManagementSessionState('staff:orders:drawer', null)
  const [confirmAction, setConfirmAction] = useManagementSessionState('staff:orders:confirmation', null)
  const [cancelTarget, setCancelTarget] = useManagementSessionState('staff:orders:cancellation', null)
  const [reviewTarget, setReviewTarget] = useManagementSessionState('staff:orders:review', null)
  const [refundTarget, setRefundTarget] = useManagementSessionState('staff:orders:refund-completion', null)
  const [mobileStage, setMobileStage] = useManagementSessionState('staff:orders:mobile-stage', 'pending')
  const [activeTab, setActiveTab] = useState('active')

  const [search, setSearch] = useState('')
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState(() => new Date().toLocaleDateString('en-CA'))
  const [sortBy, setSortBy] = useState('priority')
  const [filtersReady, setFiltersReady] = useState(false)

  const columnRefs = useRef({})
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    let active = true
    getCurrentPortalSession().then(async ({ profile }) => {
      if (!profile?.id) return
      try {
        const preferences = await fetchStaffPreferences(profile.id)
        if (!active) return
        const remembered = getRememberedStaffFilters('orders')
        setActiveTab(normalizeOrderTab(remembered?.activeTab || preferences.order_queue))
        setSortBy(remembered?.sortBy || preferences.order_sort)
        setFulfillmentFilter(remembered?.fulfillmentFilter || preferences.fulfillment_filter)
        if (remembered) {
          setSearch(remembered.search || '')
          setPaymentFilter(remembered.paymentFilter || 'all')
          setDateFilter(remembered.dateFilter ?? new Date().toLocaleDateString('en-CA'))
        }
      } catch { /* Defaults remain available if preferences have not been migrated yet. */ }
      finally { if (active) setFiltersReady(true) }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!filtersReady) return
    rememberStaffFilters('orders', { activeTab, search, fulfillmentFilter, paymentFilter, dateFilter, sortBy })
  }, [activeTab, dateFilter, filtersReady, fulfillmentFilter, paymentFilter, search, sortBy])

  const load = async () => {
    setLoading(true)
    try {
      const [orderData, addonMap] = await Promise.all([fetchOpsOrders(), fetchAddonNameMap()])
      setOrders(orderData)
      setAddonNames(addonMap)
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load orders.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const pushToast = (type, message) => {
    if (!shouldShowSystemNotification(type)) return
    const id = crypto.randomUUID()
    setToasts((current) => [...current, { id, type, message }])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4500)
  }

  const patchOrder = (id, patch) => setOrders((current) => current.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  const runAction = async (order, kind, next) => {
    if (busyId) return
    setBusyId(order.id)
    try {
      if (kind === 'confirm') {
        await confirmOrder(order.id)
        patchOrder(order.id, { status: 'Preparing', payment_confirmed: paymentMethod(order) !== 'cod' ? true : order.payment_confirmed, payment_status: paymentMethod(order) !== 'cod' ? 'paid' : order.payment_status })
        pushToast('success', `${order.order_number} moved to Preparing.`)
      } else if (kind === 'advance') {
        await advanceOrderStatus(order.id, next)
        patchOrder(order.id, { status: next })
        pushToast('success', `${order.order_number} is now ${next}.`)
      }
      setDrawerOrder((current) => (current && current.id === order.id ? { ...current, status: next || 'Preparing' } : current))
    } catch (cause) {
      pushToast('error', describeError(cause, 'That action could not be completed.'))
    } finally {
      setBusyId('')
      setConfirmAction(null)
    }
  }

  const runCancel = async (order, reason) => {
    if (busyId) return
    setBusyId(order.id)
    try {
      const result = await cancelOrder(order.id, reason)
      const requested = result.action === 'review_requested'
      patchOrder(order.id, requested
        ? { cancellation_status: 'requested', fulfillment_hold: true, cancellation_reason: reason, cancellation_requested_by_role: 'Operations Staff', cancellation_requested_at: new Date().toISOString(), refund_status: 'pending_review' }
        : { status: 'Cancelled', cancellation_status: 'resolved', fulfillment_hold: false, cancellation_reason: reason, cancelled_by_role: 'Operations Staff', cancelled_at: new Date().toISOString(), cancellation_resolved: true, refund_status: 'not_applicable' })
      pushToast('success', requested
        ? `${order.order_number} is on hold for payment and refund review.${result.email?.ok ? ' Customer email sent.' : ' Email queued for retry.'}`
        : `${order.order_number} was cancelled.${result.email?.ok ? ' Customer email sent.' : ' Email queued for retry.'}`)
      setCancelTarget(null)
      setDrawerOrder(null)
      return true
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not cancel this order.'))
      return false
    } finally {
      setBusyId('')
    }
  }

  const runReview = async ({ order, approve, notes, paymentOutcome }) => {
    if (busyId) return
    setBusyId(order.id)
    try {
      const result = await reviewCancellation({ orderId: order.id, approve, notes, paymentOutcome })
      if (!approve) {
        patchOrder(order.id, { cancellation_status: 'rejected', fulfillment_hold: false, cancellation_review_notes: notes, refund_status: 'not_applicable' })
        pushToast('success', `${order.order_number} will continue.${result.email?.ok ? ' Customer email sent.' : ' Email queued for retry.'}`)
      } else {
        const refundPending = result.action === 'refund_pending'
        patchOrder(order.id, {
          status: 'Cancelled', cancellation_status: refundPending ? 'cancelled' : 'resolved', fulfillment_hold: false,
          cancellation_review_notes: notes, cancelled_by_role: order.cancellation_requested_by_role || 'Operations Staff',
          cancelled_at: new Date().toISOString(), cancellation_resolved: !refundPending,
          refund_status: refundPending ? 'pending' : 'not_applicable',
          payment_status: paymentOutcome === 'received' ? 'paid' : order.payment_status,
          payment_confirmed: paymentOutcome === 'received' ? true : order.payment_confirmed,
          refunds: refundPending && result.refund_id
            ? [...(order.refunds || []), { id: result.refund_id, refund_amount: Number(order.final_total || 0), refund_status: 'pending', refund_method: paymentMethod(order), reference_number: null }]
            : (order.refunds || []),
        })
        pushToast('success', refundPending
          ? `${order.order_number} was cancelled and its refund is pending.${result.email?.ok ? ' Customer email sent.' : ' Email queued for retry.'}`
          : `${order.order_number} was cancelled without a refund.${result.email?.ok ? ' Customer email sent.' : ' Email queued for retry.'}`)
      }
      setReviewTarget(null)
      setDrawerOrder(null)
      return true
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not review this cancellation.'))
      return false
    } finally {
      setBusyId('')
    }
  }

  const runResolve = async (order) => {
    if (busyId) return
    setBusyId(order.id)
    try {
      await resolveCancellation(order.id)
      patchOrder(order.id, { cancellation_resolved: true })
      pushToast('success', `${order.order_number} marked as resolved.`)
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not resolve this cancellation.'))
    } finally {
      setBusyId('')
    }
  }

  const runCompleteRefund = async ({ order, refund, referenceNumber }) => {
    if (busyId) return
    setBusyId(refund.id)
    try {
      const result = await completeCancellationRefund({ orderId: order.id, refundId: refund.id, referenceNumber })
      patchOrder(order.id, {
        refund_status: 'processed',
        cancellation_status: 'resolved',
        cancellation_resolved: true,
        refunds: (order.refunds || []).map((entry) => entry.id === refund.id
          ? { ...entry, refund_status: 'processed', reference_number: referenceNumber, processed_at: new Date().toISOString() }
          : entry),
      })
      setRefundTarget(null)
      pushToast('success', `${order.order_number} refund completed.${result.email?.ok ? ' Customer email sent.' : ' Email queued for retry.'}`)
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not complete this refund.'))
    } finally {
      setBusyId('')
    }
  }

  const filteredByTab = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matchesFilters = (order, view) => {
      if (q && !`${order.order_number} ${order.customer_name}`.toLowerCase().includes(q)) return false
      if (fulfillmentFilter !== 'all' && order.order_type !== fulfillmentFilter) return false
      if (paymentFilter !== 'all' && paymentMethod(order) !== paymentFilter) return false
      if (dateFilter && filterDateFor(order, view) !== dateFilter) return false
      return true
    }
    return {
      active: orders.filter((order) => matchesFilters(order, 'active') && !['completed', 'cancelled'].includes(stageOf(order)) && !cancellationRequested(order)),
      completed: orders.filter((order) => matchesFilters(order, 'completed') && stageOf(order) === 'completed'),
      cancelled: orders.filter((order) => matchesFilters(order, 'cancelled') && (stageOf(order) === 'cancelled' || cancellationRequested(order))),
    }
  }, [orders, search, fulfillmentFilter, paymentFilter, dateFilter])
  const filtered = useMemo(() => filteredByTab[activeTab] || [], [filteredByTab, activeTab])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const eventTime = (order) => {
      if (activeTab === 'cancelled') return new Date(order.cancellation_requested_at || order.cancelled_at || order.created_at).getTime()
      if (activeTab === 'completed') return new Date(order.completed_at || order.updated_at || order.created_at).getTime()
      return scheduleDate(order)?.getTime() || 0
    }
    if (sortBy === 'newest') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    else if (sortBy === 'oldest') list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    else if (sortBy === 'scheduled') list.sort((a, b) => activeTab === 'completed' ? eventTime(b) - eventTime(a) : eventTime(a) - eventTime(b))
    else if (sortBy === 'priority') list.sort((a, b) => ['cancelled', 'completed'].includes(activeTab)
      ? eventTime(b) - eventTime(a)
      : Number(isOverdue(b)) - Number(isOverdue(a)) || eventTime(a) - eventTime(b))
    return list
  }, [filtered, sortBy, activeTab])

  const activeColumns = useMemo(() => COLUMNS.map((col) => ({ ...col, orders: sorted.filter((o) => stageOf(o) === col.key) })), [sorted])
  const selectedMobileStage = COLUMNS.some((column) => column.key === mobileStage) ? mobileStage : 'pending'
  const cancelledByCustomer = useMemo(() => sorted.filter((o) => stageOf(o) === 'cancelled' && !o.cancellation_resolved && !cancellationStartedByStaff(o)), [sorted])
  const cancelledByStaff = useMemo(() => sorted.filter((o) => !o.cancellation_resolved && cancellationStartedByStaff(o) && (stageOf(o) === 'cancelled' || cancellationRequested(o))), [sorted])
  const resolvedCancellations = useMemo(() => sorted.filter((o) => stageOf(o) === 'cancelled' && o.cancellation_resolved), [sorted])
  const cancellationRequests = useMemo(() => sorted.filter((o) => cancellationRequested(o) && !cancellationStartedByStaff(o)), [sorted])

  const activeOrderCount = filteredByTab.active.length
  const completedOrderCount = filteredByTab.completed.length
  const cancelledOrderCount = filteredByTab.cancelled.length
  const today = now.toLocaleDateString('en-CA')
  const yesterdayDate = new Date(now)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = yesterdayDate.toLocaleDateString('en-CA')
  const attentionCount = orders.filter((o) => stageOf(o) === 'pending' || isOverdue(o)).length
  const scrollToColumn = (key) => {
    setActiveTab('active')
    columnRefs.current[key]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }

  return (
    <AppShell role="staff" title="Order Preparation" onRefresh={load} titleActions={
      <div className="ops-order-view-toggle" role="tablist" aria-label="Order view">
        <button type="button" role="tab" aria-selected={activeTab === 'active'} className={activeTab === 'active' ? 'active' : ''} onClick={() => setActiveTab('active')}>
          Active Orders <b>{activeOrderCount}</b>
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'completed'} className={activeTab === 'completed' ? 'active' : ''} onClick={() => setActiveTab('completed')}>
          Completed Orders <b>{completedOrderCount}</b>
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'cancelled'} className={activeTab === 'cancelled' ? 'active' : ''} onClick={() => setActiveTab('cancelled')}>
          Cancelled Orders <b>{cancelledOrderCount}</b>
        </button>
      </div>
    } actions={
      <div className="ops-header-actions">
        <div className="ops-clock">
          <span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span>
          <b>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}</b>
        </div>
        <button type="button" className={`ops-icon-button${attentionCount > 0 ? ' has-attention' : ''}`} aria-label={`${attentionCount} order${attentionCount === 1 ? '' : 's'} need attention`} title="Orders needing attention" onClick={() => scrollToColumn('pending')}>
          <Bell size={18} />
          {attentionCount > 0 && <span className="ops-badge">{attentionCount}</span>}
        </button>
        <button type="button" className="ops-icon-button" aria-label="Refresh orders" title="Refresh orders" onClick={load} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
        </button>
      </div>
    }>
      {error && <p className="form-error">{error}</p>}

      <div className="ops-toolbar">
        <label className="ops-search">
          <Search size={17} />
          <span className="sr-only">Search orders</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order number or customer name" />
        </label>
        <label className="ops-toolbar-field"><span>Fulfillment</span><select value={fulfillmentFilter} onChange={(e) => setFulfillmentFilter(e.target.value)}><option value="all">All</option><option value="walk-in">Walk-in</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select></label>
        <label className="ops-toolbar-field"><span>Payment method</span><select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}><option value="all">All methods</option><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank_transfer">Bank transfer</option><option value="cod">Cash on Delivery</option></select></label>
        <label className="ops-toolbar-field"><span>Date</span><select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}><option value="">All dates</option><option value={today}>Today</option><option value={yesterday}>Yesterday</option></select></label>
        <label className="ops-toolbar-field"><span>Sort by</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="scheduled">{activeTab === 'cancelled' ? 'Cancelled time' : 'Scheduled time'}</option><option value="priority">{activeTab === 'completed' ? 'Recently completed' : 'Priority (overdue first)'}</option></select></label>
      </div>
      {activeTab === 'active' && <>
      {loading ? (
        <p className="customer-state">Loading orders…</p>
      ) : (
        <>
          <div className="ops-kanban">
            {activeColumns.map((col) => (
              <div className={`ops-column tone-${col.tone}`} key={col.key} ref={(el) => { columnRefs.current[col.key] = el }}>
                <header><span className="ops-column-dot" /><div><h3>{col.title}</h3>{col.subtitle&&<p>{col.subtitle}</p>}</div><span className="ops-column-count" aria-label={`${col.orders.length} orders`}>{col.orders.length}</span></header>
                <div className="ops-column-body">
                  {col.orders.length === 0 ? <EmptyColumn /> : col.orders.map((order) => (
                    <OrderCard key={order.id} order={order} busy={busyId === order.id} onView={() => setDrawerOrder(order)}
                      onMain={(action) => setConfirmAction({ order, ...action })}
                      onCancel={() => setCancelTarget(order)} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="ops-mobile">
            <div className="ops-mobile-tabs">
              {activeColumns.map((col) => (
                <button type="button" key={col.key} className={selectedMobileStage === col.key ? 'active' : ''} onClick={() => setMobileStage(col.key)}>
                  {col.title} ({col.orders.length})
                </button>
              ))}
            </div>
            <div className="ops-mobile-list">
              {(activeColumns.find((c) => c.key === selectedMobileStage)?.orders || []).length === 0
                ? <EmptyColumn />
                : activeColumns.find((c) => c.key === selectedMobileStage).orders.map((order) => (
                  <OrderCard key={order.id} order={order} busy={busyId === order.id} onView={() => setDrawerOrder(order)}
                    onMain={(action) => setConfirmAction({ order, ...action })}
                    onCancel={() => setCancelTarget(order)} />
                ))}
            </div>
          </div>
        </>
      )}
      </>}

      {activeTab === 'completed' && (
        <section className="ops-completed-orders">
          <div className="ops-completed-heading">
            <div><h2>Completed Orders</h2><p>Finished orders are kept here for quick review and reference.</p></div>
            <span>{completedOrderCount} total</span>
          </div>
          {loading ? <p className="customer-state">Loading completed orders…</p> : sorted.length === 0 ? (
            <div className="ops-empty"><ShoppingBag size={20} /><span>No completed orders match these filters.</span></div>
          ) : (
            <div className="ops-completed-grid">
              {sorted.map((order) => (
                <OrderCard key={order.id} order={order} busy={busyId === order.id} onView={() => setDrawerOrder(order)}
                  onMain={(action) => setConfirmAction({ order, ...action })}
                  onCancel={() => setCancelTarget(order)} />
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'cancelled' &&
      <section className="ops-cancellations">
        <div className="ops-cancellations-heading">
          <div><h2>Cancellations and Refunds</h2><p>Review payment-sensitive requests, then keep completed cancellation records.</p></div>
          <span>{cancelledOrderCount} total</span>
        </div>
        <div className="ops-cancel-groups">
          <CancellationRequestGroup orders={cancellationRequests} onView={setDrawerOrder} onReview={setReviewTarget} busyId={busyId} />
          <CancelGroup title="Cancelled by Customer" tone="red" orders={cancelledByCustomer} onView={setDrawerOrder} onResolve={runResolve} onRefund={(order, refund) => setRefundTarget({ order, refund })} busyId={busyId} />
          <CancelGroup title="Cancelled by Operations Staff" tone="red" orders={cancelledByStaff} onView={setDrawerOrder} onReview={setReviewTarget} onResolve={runResolve} busyId={busyId} />
          <CancelGroup title="Resolved Cancelled Orders" tone="neutral" orders={resolvedCancellations} onView={setDrawerOrder} resolved />
        </div>
      </section>
      }

      {drawerOrder && (
        <OrderDrawer order={orders.find((o) => o.id === drawerOrder.id) || drawerOrder} addonNames={addonNames} onClose={() => setDrawerOrder(null)}
          onMain={(action) => setConfirmAction({ order: orders.find((o) => o.id === drawerOrder.id) || drawerOrder, ...action })}
          onCancel={() => setCancelTarget(orders.find((o) => o.id === drawerOrder.id) || drawerOrder)}
          busy={busyId === drawerOrder.id} />
      )}

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.label}
          message={`Are you sure you want to ${confirmAction.label.toLowerCase()} for ${confirmAction.order.order_number}?`}
          busy={busyId === confirmAction.order.id}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => runAction(confirmAction.order, confirmAction.kind, confirmAction.next)}
        />
      )}

      {cancelTarget && (
        <CancelModal order={cancelTarget} busy={busyId === cancelTarget.id} onClose={() => setCancelTarget(null)} onConfirm={(reason) => runCancel(cancelTarget, reason)} />
      )}

      {reviewTarget && (
        <CancellationReviewModal order={reviewTarget} busy={busyId === reviewTarget.id} onClose={() => setReviewTarget(null)} onSubmit={runReview} />
      )}

      {refundTarget && (
        <RefundCompletionModal target={refundTarget} busy={busyId === refundTarget.refund.id} onClose={() => setRefundTarget(null)} onSubmit={runCompleteRefund} />
      )}

      <div className="ops-toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div className={`ops-toast ops-toast-${t.type}`} key={t.id}>{t.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />} {t.message}</div>)}
      </div>
    </AppShell>
  )
}

function EmptyColumn() {
  return <div className="ops-empty"><ShoppingBag size={20} /><span>No orders in this column.</span></div>
}

function OrderCard({ order, busy, onView, onMain, onCancel }) {
  const stage = stageOf(order)
  const overdue = isOverdue(order)
  const main = mainActionFor(order)
  const method = paymentMethod(order)
  const canCancel = stage !== 'completed' && stage !== 'cancelled' && !cancellationRequested(order)
  return (
    <article className={`ops-card${overdue ? ' is-overdue' : ''}`}>
      <div className="ops-card-top">
        <span className={`ops-type-badge ${order.order_type}`}>{order.order_type === 'delivery' ? <Bike size={13} /> : <Package size={13} />} {order.order_type === 'walk-in' ? 'Walk-in' : order.order_type === 'pickup' ? 'Pickup' : 'Delivery'}</span>
        <span className="ops-time">{timeAgo(order.created_at)}</span>
        {overdue && <span className="ops-overdue-chip"><AlertTriangle size={12} /> Overdue</span>}
      </div>
      <h3>{order.order_number}</h3>
      <p className="ops-customer">{order.customer_name}</p>
      <p className="ops-meta">{itemCount(order)} item{itemCount(order) === 1 ? '' : 's'} · {scheduleLabel(order)}</p>
      <div className="ops-card-row"><span>Payment</span><b>{paymentMethodLabel(method)}</b></div>
      <div className="ops-card-row"><span>Status</span><b className={`ops-pay-status ${order.payment_confirmed || method === 'cod' ? '' : 'is-pending'}`}>{paymentStatusLabel(order)}</b></div>
      <div className="ops-card-row ops-card-total"><span>Total</span><b>{money(order.final_total)}</b></div>
      <div className="ops-card-actions">
        {main && (
          <button type="button" className="ops-main-action" disabled={busy || main.disabled} title={main.disabled ? main.disabledReason : undefined} onClick={() => onMain(main)}>
            {busy ? 'Please wait…' : main.label}
          </button>
        )}
        <div className="ops-card-actions-row">
          <button type="button" className="ops-secondary-action" onClick={onView}>View Details</button>
          {canCancel && <button type="button" className="ops-destructive-action" onClick={onCancel} disabled={busy}>Cancel Order</button>}
        </div>
      </div>
    </article>
  )
}

function CancelGroup({ title, tone, orders, onView, onReview, onResolve, onRefund, resolved, busyId }) {
  return (
    <section className={`ops-cancel-group tone-${tone}${resolved ? ' is-resolved' : ''}`}>
      <header><div><span>{title}</span><small>{resolved ? 'Closed records' : 'Needs review'}</small></div><b>{orders.length}</b></header>
      <div className="ops-cancel-list" role={orders.length > 4 ? 'region' : undefined} aria-label={orders.length > 4 ? `${title} orders` : undefined} tabIndex={orders.length > 4 ? 0 : undefined}>
        {orders.length === 0 ? <EmptyColumn /> : orders.map((order) => {
          const refund = actionableRefund(order)
          const needsReview = cancellationRequested(order)
          return <article className={`ops-cancel-card${resolved ? ' is-resolved' : ''}`} key={order.id}>
            <div><b>{order.order_number}</b><span>{order.customer_name}</span></div>
            <p>{order.cancellation_reason}</p>
            <div className="ops-cancel-card-meta">
              <span>{order.cancellation_requested_at || order.cancelled_at ? timeAgo(order.cancellation_requested_at || order.cancelled_at) : ''}</span>
              <span>{paymentStatusLabel(order)}</span>
            </div>
            <div className="ops-card-actions-row">
              <button type="button" className="ops-secondary-action" onClick={() => onView(order)}>View Details</button>
              {!resolved && needsReview && onReview && <button type="button" className="ops-main-action compact" disabled={busyId === order.id} onClick={() => onReview(order)}>{busyId === order.id ? 'Please wait…' : 'Review Cancellation'}</button>}
              {!resolved && !needsReview && order.refund_status === 'not_applicable' && <button type="button" className="ops-main-action compact" disabled={busyId === order.id} onClick={() => onResolve(order)}>{busyId === order.id ? 'Please wait…' : 'Resolve'}</button>}
              {!resolved && !needsReview && refund && onRefund && <button type="button" className="ops-main-action compact" disabled={busyId === refund.id} onClick={() => onRefund(order, refund)}>{busyId === refund.id ? 'Please wait...' : 'Done Refund'}</button>}
              {!resolved && !needsReview && order.refund_status !== 'not_applicable' && !(refund && onRefund) && <span className="ops-review-status">{refundStatusLabel(order.refund_status)}</span>}
            </div>
          </article>
        })}
      </div>
    </section>
  )
}

function RefundCompletionModal({ target, busy, onClose, onSubmit }) {
  const { order, refund } = target
  const [referenceNumber, setReferenceNumber] = useState(refund.reference_number || '')
  const submit = (event) => {
    event.preventDefault()
    const reference = referenceNumber.trim()
    if (!reference) return
    onSubmit({ order, refund, referenceNumber: reference })
  }
  return (
    <div className="payment-modal-backdrop ops-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="payment-modal ops-popup-modal" role="alertdialog" aria-modal="true" aria-labelledby="refund-completion-title">
        <span className="payment-modal-kicker">Refund completion</span>
        <h2 id="refund-completion-title">Confirm completed refund</h2>
        <p>Only mark the {money(refund.refund_amount)} refund for {order.order_number} as done after the customer payout has actually been transferred.</p>
        <form onSubmit={submit}>
          <label className="field"><span>Transfer or refund reference</span><input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} placeholder="e.g. GCash or bank reference number" autoFocus required /></label>
          <p className="ops-proof-pending">Saving the reference resolves the cancellation and emails the customer that the refund is complete.</p>
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Go back</button>
            <button className="primary-button" type="submit" disabled={busy || !referenceNumber.trim()}>{busy ? 'Saving...' : 'Done Refund'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function CancellationRequestGroup({ orders, onView, onReview, busyId }) {
  return (
    <section className="ops-cancel-group tone-gold ops-review-group">
      <header><div><span>Cancellation Requests</span><small>Payment check required</small></div><b>{orders.length}</b></header>
      <div className="ops-cancel-list" role={orders.length > 4 ? 'region' : undefined} aria-label={orders.length > 4 ? 'Cancellation requests' : undefined} tabIndex={orders.length > 4 ? 0 : undefined}>
        {orders.length === 0 ? <EmptyColumn /> : orders.map((order) => {
          const state = cancellationPaymentState(order)
          return (
            <article className="ops-cancel-card ops-review-card" key={order.id}>
              <div><b>{order.order_number}</b><span>{order.customer_name}</span></div>
              <p>{order.cancellation_reason || 'No reason provided.'}</p>
              <div className="ops-cancel-card-meta">
                <span>{order.cancellation_requested_at ? timeAgo(order.cancellation_requested_at) : 'New request'}</span>
                <span>{state === 'paid' ? 'Paid' : state === 'proof_pending' ? 'Proof needs review' : 'Unpaid'}</span>
              </div>
              <div className="ops-card-actions-row">
                <button type="button" className="ops-secondary-action" onClick={() => onView(order)}>View Details</button>
                <button type="button" className="ops-main-action compact" disabled={busyId === order.id} onClick={() => onReview(order)}>{busyId === order.id ? 'Please wait…' : 'Review Request'}</button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ConfirmModal({ title, message, busy, onCancel, onConfirm }) {
  return (
    <div className="payment-modal-backdrop ops-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <section className="payment-modal ops-popup-modal" role="alertdialog" aria-modal="true" aria-labelledby="ops-confirm-title">
        <span className="payment-modal-kicker">Confirm action</span>
        <h2 id="ops-confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="payment-modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={busy}>Go back</button>
          <button className="primary-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? 'Please wait…' : 'Confirm'}</button>
        </div>
      </section>
    </div>
  )
}

function CancelModal({ order, busy, onClose, onConfirm }) {
  const [reason, setReason, clearReason] = useManagementSessionState(`staff:orders:cancel-reason:${order.id}`, '')
  const close = () => { clearReason(); onClose() }
  const trimmed = reason.trim()
  const reviewRequired = cancellationPaymentState(order) !== 'unpaid'
  const submit = async () => { if (await onConfirm(trimmed)) clearReason() }
  return (
    <div className="payment-modal-backdrop ops-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close() }}>
      <section className="payment-modal ops-popup-modal" role="alertdialog" aria-modal="true" aria-labelledby="ops-cancel-title">
        <span className="payment-modal-kicker">{reviewRequired ? 'Start cancellation review' : 'Cancel order'}</span>
        <h2 id="ops-cancel-title">{reviewRequired ? `Review cancellation for ${order.order_number}?` : `Cancel ${order.order_number}?`}</h2>
        <p>{reviewRequired
          ? 'This order has a verified payment or submitted payment proof. Fulfillment will be placed on hold until payment and refund checks are complete.'
          : 'No verified payment is recorded, so this order will be cancelled immediately.'}</p>
        <label className="field">
          <span>Cancellation reason</span>
          <textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Item unavailable, customer request…" autoFocus />
        </label>
        <p className="ops-proof-pending">A reason is required. The customer will receive an email after this action is recorded.</p>
        <div className="payment-modal-actions">
          <button className="secondary-button" type="button" onClick={close} disabled={busy}>Keep order</button>
          <button className="danger-button" type="button" disabled={busy || !trimmed} onClick={submit}>{busy ? 'Please wait…' : reviewRequired ? 'Place on hold' : 'Cancel order'}</button>
        </div>
      </section>
    </div>
  )
}

function CancellationReviewModal({ order, busy, onClose, onSubmit }) {
  const paymentState = cancellationPaymentState(order)
  const draftScope = `staff:orders:${order.id}:cancellation-review`
  const [notes, setNotes, clearNotes] = useManagementSessionState(`${draftScope}:notes`, '')
  const [paymentOutcome, setPaymentOutcome, clearPaymentOutcome] = useManagementSessionState(`${draftScope}:payment-outcome`, paymentState === 'proof_pending' ? '' : null)
  const canApprove = notes.trim() && (paymentState !== 'proof_pending' || paymentOutcome)
  const becomesPaid = paymentState === 'paid' || paymentOutcome === 'received'
  const clearDraft = () => { clearNotes(); clearPaymentOutcome() }
  const close = () => { clearDraft(); onClose() }
  const submit = async (approve) => { if (await onSubmit({ order, approve, notes: notes.trim(), paymentOutcome })) clearDraft() }
  return (
    <div className="payment-modal-backdrop ops-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close() }}>
      <section className="payment-modal ops-popup-modal ops-review-modal" role="alertdialog" aria-modal="true" aria-labelledby="ops-review-title">
        <span className="payment-modal-kicker">Payment-safe cancellation</span>
        <h2 id="ops-review-title">Review {order.order_number}</h2>
        <div className="ops-review-summary">
          <p><span>Customer</span><b>{order.customer_name}</b></p>
          <p><span>Order total</span><b>{money(order.final_total)}</b></p>
          <p><span>Payment state</span><b>{paymentState === 'paid' ? 'Verified as paid' : 'Proof awaiting verification'}</b></p>
          <p><span>Request reason</span><b>{order.cancellation_reason || 'No reason provided'}</b></p>
        </div>
        {paymentState === 'proof_pending' && (
          <fieldset className="ops-payment-outcome">
            <legend>What did the payment check confirm?</legend>
            <label><input type="radio" name="payment-outcome" value="received" checked={paymentOutcome === 'received'} onChange={(event) => setPaymentOutcome(event.target.value)} /> Payment was received</label>
            <label><input type="radio" name="payment-outcome" value="not_received" checked={paymentOutcome === 'not_received'} onChange={(event) => setPaymentOutcome(event.target.value)} /> Payment was not received</label>
          </fieldset>
        )}
        <label className="field">
          <span>Review notes</span>
          <textarea rows="3" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Record how the payment was checked and why this decision is appropriate." autoFocus />
        </label>
        <p className="ops-proof-pending">{becomesPaid
          ? `Approval cancels the order and creates a ${money(order.final_total)} refund that stays pending until the transfer reference is recorded.`
          : 'Approval cancels the unpaid order immediately. Rejection removes the hold and returns it to preparation.'}</p>
        <div className="payment-modal-actions ops-review-actions">
          <button className="secondary-button" type="button" onClick={close} disabled={busy}>Go back</button>
          <button className="danger-button subtle" type="button" disabled={busy || !notes.trim()} onClick={() => submit(false)}>Reject request</button>
          <button className="primary-button" type="button" disabled={busy || !canApprove} onClick={() => submit(true)}>{busy ? 'Saving…' : 'Approve cancellation'}</button>
        </div>
      </section>
    </div>
  )
}

function OrderDrawer({ order, addonNames, onClose, onMain, onCancel, busy }) {
  const { pricing } = usePricing()
  const [proofUrl, setProofUrl] = useState('')
  const [proofError, setProofError] = useState('')
  const method = paymentMethod(order)
  const stage = stageOf(order)
  const main = mainActionFor(order)
  const canCancel = stage !== 'completed' && stage !== 'cancelled' && !cancellationRequested(order)
  const vatRate = order.vat_rate ?? pricing.vatRate
  const pricesIncludeVat = order.prices_include_vat !== false
  const breakdown = buildVatExemptOrderBreakdown({ subtotal: order.subtotal, discountSubtotal: order.discount_subtotal, discountType: order.discount_type, discountAmount: order.discount_amount, vatExemptAmount: order.vat_exempt_amount, vatRate, pricesIncludeVat })

  useEffect(() => {
    setProofUrl(''); setProofError('')
    if (!order.payment_proof_path || (method !== 'gcash' && method !== 'bank_transfer')) return
    let active = true
    getPaymentProofUrl(order.payment_proof_path).then((url) => { if (active) setProofUrl(url || '') }).catch((cause) => { if (active) setProofError(describeError(cause, 'Could not load payment proof.')) })
    return () => { active = false }
  }, [order.id, order.payment_proof_path, method])

  const timeline = [
    { label: 'Order placed', done: true, at: order.created_at },
    { label: 'Payment verified', done: method === 'cod' || order.payment_confirmed, at: order.payment_confirmed_at },
    { label: 'Preparing', done: !PENDING_STATUSES.includes(order.status) && order.status !== 'Cancelled' },
    { label: order.order_type === 'delivery' ? 'Out for delivery' : 'Ready for pickup / dine-in / take-out', done: ['Ready for Pickup', 'Out for Delivery', 'Completed', 'Received'].includes(order.status) },
    { label: order.order_type === 'delivery' ? 'Received by customer' : 'Completed', done: order.order_type === 'delivery' ? order.status === 'Received' : order.status === 'Completed' },
  ]

  return (
    <div className="ops-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="ops-drawer-title">
        <header>
          <div><span className="settings-kicker">{order.order_type === 'walk-in' ? 'Walk-in order' : order.order_type === 'pickup' ? 'Pickup order' : 'Delivery order'}</span><h2 id="ops-drawer-title">{order.order_number}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close order details"><X size={20} /></button>
        </header>

        <div className="ops-drawer-body">
          {cancellationRequested(order) && (
            <div className="ops-drawer-cancellation-review">
              <AlertTriangle size={16} />
              <div><b>Cancellation review in progress</b><p>Fulfillment is on hold while payment and refund requirements are checked.</p><small>{order.cancellation_reason || 'No reason provided.'}</small></div>
            </div>
          )}
          {order.status === 'Cancelled' && (
            <div className="ops-drawer-cancelled">
              <AlertTriangle size={16} />
              <div><b>Cancelled{order.cancelled_by_role ? ` by ${order.cancelled_by_role}` : ''}</b><p>{order.cancellation_reason || 'No reason provided.'}</p><small>{refundStatusLabel(order.refund_status)}</small></div>
            </div>
          )}

          <section>
            <h3>Customer</h3>
            <p>{order.customer_name}</p>
            {order.customer_phone && <p><Phone size={13} /> {order.customer_phone}</p>}
            {order.customer_email && <p>{order.customer_email}</p>}
          </section>

          <section>
            <h3>{order.order_type === 'delivery' ? 'Delivery details' : order.order_type === 'walk-in' ? 'Dine-in / Take-out details' : 'Pickup details'}</h3>
            {order.order_type === 'delivery' && order.delivery_address && <p><MapPin size={13} /> {order.delivery_address}</p>}
            <p>Scheduled: {scheduleLabel(order)}</p>
          </section>

          <section>
            <h3>Items</h3>
            <div className="ops-drawer-items">
              {(order.order_items || []).map((item) => {
                const custom = item.customizations || {}
                const addonList = (item.addons || []).map((id) => addonNames[id] || id)
                return (
                  <div className="ops-drawer-item" key={item.id}>
                    <div><b>{item.quantity}× {item.display_name || item.item_name}</b><span>{money(item.unit_price)} each</span></div>
                    {(custom.temperature || custom.variation_id || addonList.length > 0 || custom.special_instructions) && (
                      <p className="ops-item-detail">
                        {[custom.temperature, custom.variation_id, addonList.join(', ')].filter(Boolean).join(' · ')}
                        {custom.special_instructions ? ` — "${custom.special_instructions}"` : ''}
                      </p>
                    )}
                    <b className="ops-item-total">{money(item.line_total)}</b>
                  </div>
                )
              })}
            </div>
          </section>

          <section>
            <h3>Payment</h3>
            <p>{paymentMethodLabel(method)} · {paymentStatusLabel(order)}</p>
            {(method === 'gcash' || method === 'bank_transfer') && (
              proofError ? <p className="form-error">{proofError}</p> :
              proofUrl ? <a href={proofUrl} target="_blank" rel="noreferrer"><img className="ops-proof-image" src={proofUrl} alt="Payment proof" /></a> :
              <p className="ops-proof-pending">No payment proof uploaded yet.</p>
            )}
          </section>

          <section>
            <h3>Price breakdown</h3>
            <div className="ops-price-rows">
              {breakdown.isVatExemptDiscount ? <>
                {breakdown.regularBaseAmount > 0 && <p><span>VATable Sale</span><b>{money(breakdown.regularBaseAmount)}</b></p>}
                <p><span>VAT-Exempt Sale</span><b>{money(breakdown.vatExemptSale)}</b></p>
                <p><span>{formatVatRate(vatRate)} VAT</span><b>{money(breakdown.regularVatAmount)}</b></p>
                <p><span>Less 20% SC/PWD Disc.</span><b>-{money(breakdown.discountAmount)}</b></p>
              </> : <>
                <p><span>Subtotal</span><b>{money(breakdown.baseAmount)}</b></p>
                <p><span>{pricesIncludeVat ? `VAT included (${formatVatRate(vatRate)})` : 'VAT calculated at checkout'}</span><b>{money(breakdown.vatAmount)}</b></p>
              </>}
              {order.order_type === 'delivery' && <p><span>Delivery fee</span><b>{money(order.delivery_fee || 0)}</b></p>}
              <p className="ops-price-total"><span>Total</span><b>{money(order.final_total)}</b></p>
            </div>
          </section>

          <section>
            <h3>Order timeline</h3>
            <ul className="ops-timeline">
              {timeline.map((step) => <li key={step.label} className={step.done ? 'done' : ''}>{step.done ? <Check size={13} /> : <Clock size={13} />} {step.label}</li>)}
            </ul>
          </section>
        </div>

        <footer className="ops-drawer-footer">
          {main && <button type="button" className="ops-main-action" disabled={busy || main.disabled} onClick={() => onMain(main)}>{busy ? 'Please wait…' : main.label}</button>}
          {canCancel && <button type="button" className="ops-destructive-action" disabled={busy} onClick={onCancel}>Cancel Order</button>}
        </footer>
      </aside>
    </div>
  )
}
