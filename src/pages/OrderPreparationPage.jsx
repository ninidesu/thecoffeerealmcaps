import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Bell, Bike, Check, CheckCircle2, ChevronDown, Clock, Coffee,
  MapPin, Package, Phone, RefreshCw, Search, ShoppingBag, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import {
  fetchOpsOrders, fetchAddonNameMap, confirmOrder, advanceOrderStatus,
  cancelOrder, resolveCancellation, getPaymentProofUrl,
} from '../services/opsOrderService'

const PENDING_STATUSES = ['Order Received', 'Awaiting Payment Verification', 'Pending Confirmation']

const COLUMNS = [
  { key: 'pending', title: 'Pending Confirmation', subtitle: 'Verify payment proofs', icon: Clock, tone: 'amber' },
  { key: 'preparing', title: 'Preparing', subtitle: 'Orders being prepared', icon: Coffee, tone: 'blue' },
  { key: 'ready', title: 'Ready for Pickup', subtitle: 'Orders ready for customer pickup', icon: Package, tone: 'green' },
  { key: 'delivery', title: 'Out for Delivery', subtitle: 'Orders currently being delivered', icon: Bike, tone: 'teal' },
  { key: 'completed', title: 'Completed', subtitle: 'Finished orders', icon: CheckCircle2, tone: 'neutral' },
]

function stageOf(order) {
  if (order.status === 'Cancelled') return 'cancelled'
  if (PENDING_STATUSES.includes(order.status)) return 'pending'
  if (order.status === 'Preparing') return 'preparing'
  if (order.status === 'Ready for Pickup') return 'ready'
  if (order.status === 'Out for Delivery') return 'delivery'
  if (order.status === 'Completed') return 'completed'
  return 'pending'
}

function paymentMethod(order) {
  return order.payments?.[0]?.method || 'gcash'
}
function paymentMethodLabel(method) {
  return method === 'cod' ? 'Cash on Delivery' : method === 'bank_transfer' ? 'Bank Transfer' : 'GCash'
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
function isAsap(order) {
  const when = scheduleDate(order)
  if (!when) return false
  return when.getTime() - Date.now() <= 45 * 60 * 1000
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
  if (!when) return 'Schedule pending'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(when)
}

function mainActionFor(order) {
  const stage = stageOf(order)
  const method = paymentMethod(order)
  if (stage === 'pending') {
    if (method === 'cod') return { label: 'Confirm Order', next: null, kind: 'confirm' }
    return { label: 'Verify Payment', next: null, kind: 'confirm', disabled: !order.payment_proof_path, disabledReason: 'Waiting for the customer to upload payment proof.' }
  }
  if (stage === 'preparing') {
    return order.order_type === 'pickup'
      ? { label: 'Mark as Ready', next: 'Ready for Pickup', kind: 'advance' }
      : { label: 'Mark Out for Delivery', next: 'Out for Delivery', kind: 'advance' }
  }
  if (stage === 'ready') return { label: 'Complete Pickup', next: 'Completed', kind: 'advance' }
  if (stage === 'delivery') return { label: 'Mark Completed', next: 'Completed', kind: 'advance' }
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
  const [drawerOrder, setDrawerOrder] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [mobileStage, setMobileStage] = useState('pending')
  const [activeTab, setActiveTab] = useState('board')

  const [search, setSearch] = useState('')
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [timingFilter, setTimingFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [sortBy, setSortBy] = useState('oldest')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const columnRefs = useRef({})
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer) }, [])

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
      await cancelOrder(order.id, reason)
      patchOrder(order.id, { status: 'Cancelled', cancellation_reason: reason, cancelled_by_role: 'Operations Staff', cancellation_resolved: false })
      pushToast('success', `${order.order_number} was cancelled.`)
      setCancelTarget(null)
      setDrawerOrder(null)
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not cancel this order.'))
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter((order) => {
      if (q && !`${order.order_number} ${order.customer_name}`.toLowerCase().includes(q)) return false
      if (fulfillmentFilter !== 'all' && order.order_type !== fulfillmentFilter) return false
      if (paymentFilter !== 'all' && paymentMethod(order) !== paymentFilter) return false
      if (timingFilter === 'asap' && !isAsap(order)) return false
      if (timingFilter === 'scheduled' && isAsap(order)) return false
      if (dateFilter && order.schedule_date !== dateFilter) return false
      return true
    })
  }, [orders, search, fulfillmentFilter, paymentFilter, timingFilter, dateFilter])

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sortBy === 'newest') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    else if (sortBy === 'oldest') list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    else if (sortBy === 'scheduled') list.sort((a, b) => (scheduleDate(a)?.getTime() || 0) - (scheduleDate(b)?.getTime() || 0))
    else if (sortBy === 'priority') list.sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || (scheduleDate(a)?.getTime() || 0) - (scheduleDate(b)?.getTime() || 0))
    return list
  }, [filtered, sortBy])

  const columns = useMemo(() => COLUMNS.map((col) => ({ ...col, orders: sorted.filter((o) => stageOf(o) === col.key) })), [sorted])
  const cancelledByCustomer = useMemo(() => orders.filter((o) => stageOf(o) === 'cancelled' && !o.cancellation_resolved && o.cancelled_by_role !== 'Operations Staff'), [orders])
  const cancelledByStaff = useMemo(() => orders.filter((o) => stageOf(o) === 'cancelled' && !o.cancellation_resolved && o.cancelled_by_role === 'Operations Staff'), [orders])
  const resolvedCancellations = useMemo(() => orders.filter((o) => stageOf(o) === 'cancelled' && o.cancellation_resolved), [orders])

  const attentionCount = orders.filter((o) => stageOf(o) === 'pending' || isOverdue(o)).length
  const scrollToColumn = (key) => {
    setActiveTab('board')
    columnRefs.current[key]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  }

  return (
    <AppShell role="staff" title="Order Preparation" eyebrow="Verify payments, prepare orders, and manage fulfillment in real time." actions={
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

      <div className="ops-summary-row">
        {COLUMNS.map((col) => {
          const count = orders.filter((o) => stageOf(o) === col.key).length
          const Icon = col.icon
          return (
            <button type="button" key={col.key} className={`ops-summary-card tone-${col.tone}`} onClick={() => scrollToColumn(col.key)}>
              <Icon size={18} />
              <span>{col.title}</span>
              <b>{count}</b>
            </button>
          )
        })}
      </div>

      <div className="ops-toolbar">
        <label className="ops-search">
          <Search size={17} />
          <span className="sr-only">Search orders</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order number or customer name" />
        </label>
        <button type="button" className="ops-filter-toggle" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
          Filters <ChevronDown size={15} style={{ transform: filtersOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort orders">
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
          <option value="scheduled">Scheduled time</option>
          <option value="priority">Priority (overdue first)</option>
        </select>
      </div>
      {filtersOpen && (
        <div className="ops-filters">
          <label>Fulfillment
            <select value={fulfillmentFilter} onChange={(e) => setFulfillmentFilter(e.target.value)}>
              <option value="all">All</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option>
            </select>
          </label>
          <label>Payment method
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
              <option value="all">All</option><option value="gcash">GCash</option><option value="bank_transfer">Bank Transfer</option><option value="cod">Cash on Delivery</option>
            </select>
          </label>
          <label>Timing
            <select value={timingFilter} onChange={(e) => setTimingFilter(e.target.value)}>
              <option value="all">All</option><option value="asap">ASAP</option><option value="scheduled">Scheduled</option>
            </select>
          </label>
          <label>Date
            <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
          </label>
          {(fulfillmentFilter !== 'all' || paymentFilter !== 'all' || timingFilter !== 'all' || dateFilter) && (
            <button type="button" className="ops-clear-filters" onClick={() => { setFulfillmentFilter('all'); setPaymentFilter('all'); setTimingFilter('all'); setDateFilter('') }}>Clear filters</button>
          )}
        </div>
      )}

      {loading ? (
        <p className="customer-state">Loading orders…</p>
      ) : (
        <>
          <div className="ops-kanban">
            {columns.map((col) => (
              <div className={`ops-column tone-${col.tone}`} key={col.key} ref={(el) => { columnRefs.current[col.key] = el }}>
                <header><span className="ops-column-dot" /><div><h3>{col.title}</h3><p>{col.subtitle}</p></div></header>
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
              {COLUMNS.map((col) => (
                <button type="button" key={col.key} className={mobileStage === col.key ? 'active' : ''} onClick={() => setMobileStage(col.key)}>
                  {col.title} ({columns.find((c) => c.key === col.key)?.orders.length || 0})
                </button>
              ))}
            </div>
            <div className="ops-mobile-list">
              {(columns.find((c) => c.key === mobileStage)?.orders || []).length === 0
                ? <EmptyColumn />
                : columns.find((c) => c.key === mobileStage).orders.map((order) => (
                  <OrderCard key={order.id} order={order} busy={busyId === order.id} onView={() => setDrawerOrder(order)}
                    onMain={(action) => setConfirmAction({ order, ...action })}
                    onCancel={() => setCancelTarget(order)} />
                ))}
            </div>
          </div>
        </>
      )}

      <section className="ops-cancellations">
        <h2>Cancellation</h2>
        <div className="ops-cancel-groups">
          <CancelGroup title="Cancelled by Customer" tone="red" orders={cancelledByCustomer} onView={setDrawerOrder} onResolve={runResolve} busyId={busyId} />
          <CancelGroup title="Cancelled by Operations Staff" tone="red" orders={cancelledByStaff} onView={setDrawerOrder} onResolve={runResolve} busyId={busyId} />
          <CancelGroup title="Resolved Cancelled Orders" tone="neutral" orders={resolvedCancellations} onView={setDrawerOrder} resolved />
        </div>
        <div className="ops-legend">
          {COLUMNS.map((col) => <span key={col.key}><i className={`tone-${col.tone}`} />{col.title}</span>)}
          <span><i className="tone-red" />Cancellation states</span>
        </div>
      </section>

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
  const canCancel = stage !== 'completed' && stage !== 'cancelled'
  return (
    <article className={`ops-card${overdue ? ' is-overdue' : ''}`}>
      <div className="ops-card-top">
        <span className={`ops-type-badge ${order.order_type}`}>{order.order_type === 'pickup' ? <Package size={13} /> : <Bike size={13} />} {order.order_type === 'pickup' ? 'Pickup' : 'Delivery'}</span>
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

function CancelGroup({ title, tone, orders, onView, onResolve, resolved, busyId }) {
  return (
    <div className={`ops-cancel-group tone-${tone}`}>
      <header><span>{title}</span><b>{orders.length}</b></header>
      <div className="ops-cancel-list">
        {orders.length === 0 ? <EmptyColumn /> : orders.map((order) => (
          <article className="ops-cancel-card" key={order.id}>
            <div><b>{order.order_number}</b><span>{order.customer_name}</span></div>
            <p>{order.cancellation_reason}</p>
            <div className="ops-cancel-card-meta">
              <span>{order.cancelled_at ? timeAgo(order.cancelled_at) : ''}</span>
              <span>{paymentStatusLabel(order)}</span>
            </div>
            <div className="ops-card-actions-row">
              <button type="button" className="ops-secondary-action" onClick={() => onView(order)}>View Details</button>
              {!resolved && <button type="button" className="ops-main-action compact" disabled={busyId === order.id} onClick={() => onResolve(order)}>{busyId === order.id ? 'Please wait…' : 'Resolve'}</button>}
            </div>
          </article>
        ))}
      </div>
    </div>
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
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  return (
    <div className="payment-modal-backdrop ops-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <section className="payment-modal ops-popup-modal" role="alertdialog" aria-modal="true" aria-labelledby="ops-cancel-title">
        <span className="payment-modal-kicker">Cancel order</span>
        <h2 id="ops-cancel-title">Cancel {order.order_number}?</h2>
        <p>This cannot be undone. Please provide a reason for the customer's record.</p>
        <label className="field">
          <span>Cancellation reason</span>
          <textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Item unavailable, customer request…" autoFocus />
        </label>
        <p className="ops-proof-pending">A reason is required before you can cancel this order.</p>
        <div className="payment-modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Keep order</button>
          <button className="danger-button" type="button" disabled={busy || !trimmed} onClick={() => onConfirm(trimmed)}>{busy ? 'Cancelling…' : 'Cancel order'}</button>
        </div>
      </section>
    </div>
  )
}

function OrderDrawer({ order, addonNames, onClose, onMain, onCancel, busy }) {
  const [proofUrl, setProofUrl] = useState('')
  const [proofError, setProofError] = useState('')
  const method = paymentMethod(order)
  const stage = stageOf(order)
  const main = mainActionFor(order)
  const canCancel = stage !== 'completed' && stage !== 'cancelled'

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
    { label: order.order_type === 'pickup' ? 'Ready for pickup' : 'Out for delivery', done: ['Ready for Pickup', 'Out for Delivery', 'Completed'].includes(order.status) },
    { label: 'Completed', done: order.status === 'Completed' },
  ]

  return (
    <div className="ops-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="ops-drawer-title">
        <header>
          <div><span className="settings-kicker">{order.order_type === 'pickup' ? 'Pickup order' : 'Delivery order'}</span><h2 id="ops-drawer-title">{order.order_number}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close order details"><X size={20} /></button>
        </header>

        <div className="ops-drawer-body">
          {order.status === 'Cancelled' && (
            <div className="ops-drawer-cancelled">
              <AlertTriangle size={16} />
              <div><b>Cancelled{order.cancelled_by_role ? ` by ${order.cancelled_by_role}` : ''}</b><p>{order.cancellation_reason || 'No reason provided.'}</p></div>
            </div>
          )}

          <section>
            <h3>Customer</h3>
            <p>{order.customer_name}</p>
            {order.customer_phone && <p><Phone size={13} /> {order.customer_phone}</p>}
            {order.customer_email && <p>{order.customer_email}</p>}
          </section>

          <section>
            <h3>{order.order_type === 'pickup' ? 'Pickup details' : 'Delivery details'}</h3>
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
              <p><span>Subtotal</span><b>{money(order.subtotal)}</b></p>
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
