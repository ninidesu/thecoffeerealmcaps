import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, CalendarDays,
  ChevronLeft, ChevronRight, ClipboardList, Download, Eye, FileText, FilterX,
  PackageCheck, PackageX, Printer, RefreshCw, Search, Settings2, Trash2, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { useManagementSessionState } from '../hooks/useManagementSessionState'
import { supabase } from '../lib/supabase'
import { stockStatus } from '../services/adminInventoryService'
import {
  downloadInventoryMovementCsv, fetchInventoryReport, printInventoryMovementReport,
} from '../services/inventoryReportService'
import { describeError } from '../utils/describeError'

const PAGE_SIZES = [15, 30, 60]
const PRESETS = [['7', '7 Days'], ['30', '30 Days'], ['90', '90 Days'], ['custom', 'Custom']]
const MOVEMENT_META = {
  restock: { label: 'Restock', tone: 'green', icon: ArrowDownToLine },
  deduction: { label: 'Deduction', tone: 'blue', icon: ArrowUpFromLine },
  adjustment: { label: 'Adjustment', tone: 'amber', icon: Settings2 },
  waste: { label: 'Waste', tone: 'red', icon: Trash2 },
}
const STATUS_META = {
  out: { label: 'Out of Stock', tone: 'red' }, low: { label: 'Low Stock', tone: 'amber' },
  healthy: { label: 'Healthy', tone: 'green' }, over: { label: 'Over Stock', tone: 'blue' },
}

function startOfDay(value) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date }
function endOfDay(value) { const date = new Date(value); date.setHours(23, 59, 59, 999); return date }
function inputDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function formatQty(value) { const number = Number(value); return Number.isInteger(number) ? String(number) : number.toFixed(2) }
function formatDateTime(value) { return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value)) }
function startCase(value) { return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()) }

function useReportRange(preset, customFrom, customTo) {
  return useMemo(() => {
    const today = new Date()
    const to = preset === 'custom' && customTo ? endOfDay(`${customTo}T00:00:00`) : endOfDay(today)
    const from = preset === 'custom' && customFrom ? startOfDay(`${customFrom}T00:00:00`) : startOfDay(today)
    if (preset !== 'custom') from.setDate(from.getDate() - Number(preset) + 1)
    const labelFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    return { from, to, label: `${labelFormat.format(from)} – ${labelFormat.format(to)}` }
  }, [preset, customFrom, customTo])
}

function movementSource(record) {
  if (record.orderId) return 'order'
  if (record.staffId) return 'manual'
  return 'system'
}

function ReportMetric({ icon: Icon, label, value, detail, tone }) {
  return <article className={`ir-metric tone-${tone}`}><span><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>
}

function MovementBadge({ type, reversed }) {
  const meta = MOVEMENT_META[type] || { label: startCase(type), tone: 'neutral', icon: Settings2 }
  const Icon = meta.icon
  return <span className={`ir-movement-badge tone-${meta.tone}`}><Icon size={13} />{meta.label}{reversed && <em>Reversed</em>}</span>
}

function MovementDrawer({ record, item, onClose, onTransactions }) {
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [onClose])
  const status = item ? stockStatus(item) : null
  return <div className="ops-drawer-backdrop ir-drawer-backdrop" onMouseDown={onClose}>
    <aside className="ops-drawer ir-drawer" role="dialog" aria-modal="true" aria-label={`Inventory movement for ${record.itemName}`} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span className="eyebrow">Movement details</span><h2>{record.itemName}</h2><small>{formatDateTime(record.createdAt)}</small></div><button type="button" onClick={onClose} aria-label="Close movement details"><X size={19} /></button></header>
      <div className="ops-drawer-body">
        <section><div className="ir-drawer-badges"><MovementBadge type={record.movementType} reversed={record.reversed} />{status && <span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span>}</div><dl className="ir-detail-grid"><div><dt>Quantity</dt><dd>{record.direction === 'in' ? '+' : record.direction === 'out' ? '−' : '±'}{formatQty(record.quantity)} {record.unit}</dd></div><div><dt>Inventory type</dt><dd>{record.itemType === 'ingredient' ? 'Ingredient' : 'Finished product'}</dd></div><div><dt>Category</dt><dd>{record.category}</dd></div><div><dt>Source</dt><dd>{startCase(movementSource(record))}</dd></div><div><dt>Performed by</dt><dd>{record.staffName}</dd></div><div><dt>Order</dt><dd>{record.orderNumber || 'Not order-linked'}</dd></div><div className="wide"><dt>Reason</dt><dd>{record.reason}</dd></div></dl></section>
        {item && <section><h3>Current stock snapshot</h3><div className="ir-stock-snapshot"><div><span>On hand</span><b>{formatQty(item.quantity)} {item.unit}</b></div><div><span>Low-stock level</span><b>{formatQty(item.minStockLevel)} {item.unit}</b></div><div><span>Healthy point</span><b>{formatQty(item.highStockLevel)} {item.unit}</b></div></div><p className="ir-drawer-note">This snapshot is current; it may differ from stock at the time of this movement.</p></section>}
        {record.orderId && <section><h3>Related action</h3><button type="button" className="ops-secondary-action" onClick={onTransactions}><ClipboardList size={15} /> Open transaction history</button></section>}
      </div>
    </aside>
  </div>
}

export default function InventoryReportPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [preset, setPreset] = useManagementSessionState('admin:inventory-report:preset', '30')
  const [customFrom, setCustomFrom] = useManagementSessionState('admin:inventory-report:from', inputDate(new Date(Date.now() - 29 * 86400000)))
  const [customTo, setCustomTo] = useManagementSessionState('admin:inventory-report:to', inputDate(new Date()))
  const [search, setSearch] = useManagementSessionState('admin:inventory-report:search', '')
  const [movementType, setMovementType] = useManagementSessionState('admin:inventory-report:movement', 'all')
  const [itemType, setItemType] = useManagementSessionState('admin:inventory-report:item-type', 'all')
  const [source, setSource] = useManagementSessionState('admin:inventory-report:source', 'all')
  const [staff, setStaff] = useManagementSessionState('admin:inventory-report:staff', 'all')
  const [sortBy, setSortBy] = useManagementSessionState('admin:inventory-report:sort', 'newest')
  const [page, setPage] = useManagementSessionState('admin:inventory-report:page', 1)
  const [pageSize, setPageSize] = useManagementSessionState('admin:inventory-report:page-size', 15)
  const [detailRecord, setDetailRecord] = useState(null)
  const deferredSearch = useDeferredValue(search)
  const range = useReportRange(preset, customFrom, customTo)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const report = await fetchInventoryReport()
      setItems(report.items); setMovements(report.movements); setTruncated(report.truncated); setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load the inventory movement report.'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const channel = supabase
      .channel('admin-inventory-report')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finished_product_movements' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_stock' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finished_products' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const periodRecords = useMemo(() => movements.filter((record) => { const time = new Date(record.createdAt); return time >= range.from && time <= range.to }), [movements, range])
  const staffOptions = useMemo(() => [...new Set(periodRecords.map((record) => record.staffName))].sort(), [periodRecords])
  const filteredRecords = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase()
    const result = periodRecords.filter((record) => {
      if (movementType !== 'all' && record.movementType !== movementType) return false
      if (itemType !== 'all' && record.itemType !== itemType) return false
      if (source !== 'all' && movementSource(record) !== source) return false
      if (staff !== 'all' && record.staffName !== staff) return false
      if (query && ![record.itemName, record.category, record.reason, record.orderNumber, record.staffName].join(' ').toLowerCase().includes(query)) return false
      return true
    })
    return [...result].sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt)
      if (sortBy === 'quantity-high') return b.quantity - a.quantity
      if (sortBy === 'quantity-low') return a.quantity - b.quantity
      return new Date(b.createdAt) - new Date(a.createdAt)
    })
  }, [periodRecords, deferredSearch, movementType, itemType, source, staff, sortBy])

  const summary = useMemo(() => ({
    total: filteredRecords.length,
    orderDeductions: filteredRecords.filter((record) => record.orderId && record.movementType === 'deduction').length,
    manualActions: filteredRecords.filter((record) => movementSource(record) === 'manual').length,
    waste: filteredRecords.filter((record) => record.movementType === 'waste').length,
  }), [filteredRecords])
  const movementCounts = useMemo(() => Object.fromEntries(Object.keys(MOVEMENT_META).map((key) => [key, filteredRecords.filter((record) => record.movementType === key).length])), [filteredRecords])
  const topItems = useMemo(() => {
    const map = new Map()
    filteredRecords.forEach((record) => { const entry = map.get(record.itemId) || { name: record.itemName, unit: record.unit, events: 0, quantity: 0 }; entry.events += 1; entry.quantity += record.quantity; map.set(record.itemId, entry) })
    return [...map.values()].sort((a, b) => b.events - a.events || b.quantity - a.quantity).slice(0, 5)
  }, [filteredRecords])
  const attentionItems = useMemo(() => items.filter((item) => ['out', 'low'].includes(stockStatus(item))).sort((a, b) => a.quantity - b.quantity), [items])
  const allExceptions = useMemo(() => filteredRecords.filter((record) => record.reversed || ['waste', 'adjustment'].includes(record.movementType)), [filteredRecords])
  const exceptions = allExceptions.slice(0, 5)
  const maxMovementCount = Math.max(1, ...Object.values(movementCounts))
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRecords = filteredRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const activeFilterCount = [movementType, itemType, source, staff].filter((value) => value !== 'all').length + (search ? 1 : 0)
  const resetFilters = () => { setSearch(''); setMovementType('all'); setItemType('all'); setSource('all'); setStaff('all'); setPage(1) }

  useEffect(() => { setPage(1) }, [deferredSearch, movementType, itemType, source, staff, sortBy, pageSize, preset, customFrom, customTo, setPage])
  useEffect(() => { if (page > pageCount) setPage(pageCount) }, [page, pageCount, setPage])

  return <AppShell role="admin" title="Inventory Report" eyebrow="Audit every stock movement and review the operational actions behind it." onRefresh={load} actions={<div className="ops-header-actions"><button type="button" className="ops-secondary-action" onClick={() => navigate('/admin/inventory')}><Boxes size={16} /> Inventory monitoring</button><button type="button" className="ops-secondary-action" disabled={!filteredRecords.length} onClick={() => printInventoryMovementReport({ records: filteredRecords, summary, rangeLabel: range.label })}><Printer size={16} /> Print</button><button type="button" className="ops-main-action" disabled={!filteredRecords.length} onClick={() => downloadInventoryMovementCsv(filteredRecords, range.label)}><Download size={16} /> Export CSV</button></div>}>
    <section className="ir-range-bar" aria-label="Inventory report date range"><div className="ir-range-label"><CalendarDays size={16} /><span>{range.label}</span></div><div className="ir-presets">{PRESETS.map(([value, label]) => <button key={value} type="button" className={preset === value ? 'active' : ''} onClick={() => setPreset(value)}>{label}</button>)}</div>{preset === 'custom' && <div className="ir-custom-range"><label>From<input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /></label><span>to</span><label>To<input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}<button type="button" className="ir-refresh" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button></section>
    {error && <div className="ir-error" role="alert"><AlertTriangle size={19} /><div><b>Inventory report unavailable</b><span>{error}</span></div><button type="button" onClick={load}>Try again</button></div>}
    {truncated && <p className="ir-limit-note">This report contains the newest 5,000 records from each inventory movement source.</p>}
    {loading ? <ReportSkeleton /> : <div className="ir-page-enter">
      <section className="ir-metrics"><ReportMetric icon={FileText} label="Movement Events" value={summary.total.toLocaleString('en-PH')} detail="Within the selected view" tone="neutral" /><ReportMetric icon={ArrowUpFromLine} label="Order Deductions" value={summary.orderDeductions.toLocaleString('en-PH')} detail="Automatic sale consumption" tone="blue" /><ReportMetric icon={Settings2} label="Manual Actions" value={summary.manualActions.toLocaleString('en-PH')} detail="Staff-created stock changes" tone="amber" /><ReportMetric icon={Trash2} label="Waste Events" value={summary.waste.toLocaleString('en-PH')} detail="Spoilage or discarded stock" tone="red" /><ReportMetric icon={attentionItems.length ? PackageX : PackageCheck} label="Stock Attention" value={attentionItems.length.toLocaleString('en-PH')} detail="Low or out-of-stock items" tone={attentionItems.length ? 'rose' : 'green'} /></section>
      <section className="ir-insight-grid"><article className="panel ir-panel"><header><div><span>Movement Breakdown</span><small>Event count by inventory action</small></div><b>{summary.total}</b></header><ul className="ir-breakdown">{Object.entries(MOVEMENT_META).map(([key, meta]) => <li key={key}><div><span className={`ir-dot tone-${meta.tone}`} />{meta.label}</div><b>{movementCounts[key]}</b><i><span className={`tone-${meta.tone}`} style={{ width: `${(movementCounts[key] / maxMovementCount) * 100}%` }} /></i></li>)}</ul></article><article className="panel ir-panel"><header><div><span>Most Active Items</span><small>Ranked by movement events</small></div></header>{topItems.length ? <ol className="ir-ranking">{topItems.map((item, index) => <li key={item.name}><span>{index + 1}</span><div><b>{item.name}</b><small>{formatQty(item.quantity)} {item.unit} across {item.events} event{item.events === 1 ? '' : 's'}</small></div></li>)}</ol> : <CompactEmpty text="No item activity in this period." />}</article><article className="panel ir-panel ir-attention"><header><div><span>Stock Actions</span><small>Current issues needing operational review</small></div><button type="button" onClick={() => navigate('/admin/inventory')}>Open monitoring</button></header>{attentionItems.length ? <ul>{attentionItems.slice(0, 5).map((item) => { const status = stockStatus(item); return <li key={item.id}><div><b>{item.name}</b><small>{item.category}</small></div><span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span><strong>{formatQty(item.quantity)} {item.unit}</strong></li> })}</ul> : <CompactEmpty icon={PackageCheck} text="Stock levels are currently healthy." />}</article></section>
      <section className="panel ir-ledger"><div className="ir-ledger-head"><div><span className="eyebrow">Audit ledger</span><h2>Inventory Movements</h2><p>{filteredRecords.length} matching event{filteredRecords.length === 1 ? '' : 's'}</p></div><div className="ir-ledger-actions"><label className="ir-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item, reason, order, staff…" aria-label="Search inventory movements" />{search && <button type="button" onClick={() => setSearch('')} aria-label="Clear movement search"><X size={14} /></button>}</label><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort inventory movements"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="quantity-high">Largest quantity</option><option value="quantity-low">Smallest quantity</option></select>{activeFilterCount > 0 && <button type="button" className="ir-clear" onClick={resetFilters}><FilterX size={15} /> Clear {activeFilterCount}</button>}</div></div>
        <div className="ir-filter-row"><label>Movement<select value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="all">All movements</option>{Object.entries(MOVEMENT_META).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></label><label>Inventory type<select value={itemType} onChange={(event) => setItemType(event.target.value)}><option value="all">All inventory</option><option value="ingredient">Ingredients</option><option value="finished_product">Finished products</option></select></label><label>Source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option><option value="order">Order-linked</option><option value="manual">Manual staff action</option><option value="system">System</option></select></label><label>Performed by<select value={staff} onChange={(event) => setStaff(event.target.value)}><option value="all">Everyone</option>{staffOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>
        {pageRecords.length ? <><div className="ir-table-wrap"><table className="ir-table"><thead><tr><th>Date &amp; Time</th><th>Inventory Item</th><th>Movement</th><th>Quantity</th><th>Source</th><th>Performed By</th><th>Reason</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{pageRecords.map((record) => <tr key={record.id} tabIndex={0} onClick={() => setDetailRecord(record)} onKeyDown={(event) => { if (event.key === 'Enter') setDetailRecord(record) }}><td>{formatDateTime(record.createdAt)}</td><td><b>{record.itemName}</b><small>{record.itemType === 'ingredient' ? 'Ingredient' : 'Finished product'} · {record.category}</small></td><td><MovementBadge type={record.movementType} reversed={record.reversed} /></td><td className={`ir-quantity is-${record.direction}`}><b>{record.direction === 'in' ? '+' : record.direction === 'out' ? '−' : '±'}{formatQty(record.quantity)}</b><small>{record.unit}</small></td><td><b>{startCase(movementSource(record))}</b><small>{record.orderNumber || 'No linked order'}</small></td><td>{record.staffName}</td><td className="ir-reason" title={record.reason}>{record.reason}</td><td><button type="button" className="ir-view" onClick={(event) => { event.stopPropagation(); setDetailRecord(record) }} aria-label={`View movement for ${record.itemName}`}><Eye size={16} /></button></td></tr>)}</tbody></table></div><div className="ir-mobile-list">{pageRecords.map((record) => <button type="button" className="ir-mobile-card" key={record.id} onClick={() => setDetailRecord(record)}><header><MovementBadge type={record.movementType} reversed={record.reversed} /><time>{formatDateTime(record.createdAt)}</time></header><strong>{record.itemName}</strong><p>{record.reason}</p><footer><span>{startCase(movementSource(record))} · {record.staffName}</span><b className={`is-${record.direction}`}>{record.direction === 'in' ? '+' : record.direction === 'out' ? '−' : '±'}{formatQty(record.quantity)} {record.unit}</b></footer></button>)}</div><footer className="ir-pagination"><label>Rows per page<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label><span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredRecords.length)} of {filteredRecords.length}</span><div><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><b>Page {currentPage} of {pageCount}</b><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div></footer></> : <div className="ir-empty"><ClipboardList size={28} /><h3>No inventory movements found</h3><p>{periodRecords.length ? 'Try adjusting the report filters.' : 'No movement events were recorded in this date range.'}</p>{activeFilterCount > 0 && <button type="button" onClick={resetFilters}>Clear filters</button>}</div>}
      </section>
      <section className="panel ir-exceptions"><header><div><span>Audit Exceptions</span><small>Adjustments, waste, and reversed entries in the current view</small></div><b>{allExceptions.length}</b></header>{exceptions.length ? <ul>{exceptions.map((record) => <li key={record.id}><MovementBadge type={record.movementType} reversed={record.reversed} /><div><b>{record.itemName}</b><small>{record.reason}</small></div><time>{formatDateTime(record.createdAt)}</time><button type="button" onClick={() => setDetailRecord(record)}>Review</button></li>)}</ul> : <CompactEmpty icon={PackageCheck} text="No audit exceptions in this view." />}</section>
    </div>}
    {detailRecord && <MovementDrawer record={detailRecord} item={itemsById.get(detailRecord.itemId)} onClose={() => setDetailRecord(null)} onTransactions={() => navigate('/admin/transactions')} />}
  </AppShell>
}

function CompactEmpty({ icon: Icon = ClipboardList, text }) { return <div className="ir-compact-empty"><Icon size={22} /><p>{text}</p></div> }
function ReportSkeleton() { return <div className="ir-skeleton"><div>{Array.from({ length: 5 }).map((_, index) => <i key={index} />)}</div><section><i /><i /><i /></section><i className="wide" /><i className="table" /></div> }
