import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Boxes, Calendar, Check, Clock, Coffee, Download, Eye,
  Package, PackageX, RefreshCw, Search, Settings2, TrendingDown, TrendingUp, Wifi, WifiOff, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { supabase } from '../lib/supabase'
import {
  fetchInventoryItems, fetchMovements, fetchAffectedMenuItems,
  stockStatus, isExpiringSoon, computeOverview,
} from '../services/adminInventoryService'

const STATUS_META = {
  healthy: { label: 'Healthy', tone: 'green' },
  low: { label: 'Low Stock', tone: 'amber' },
  out: { label: 'Out of Stock', tone: 'red' },
  over: { label: 'Over Stock', tone: 'blue' },
}
const MOVEMENT_LABEL = { restock: 'Restock', deduction: 'Deduction', adjustment: 'Adjustment', waste: 'Waste / Spoilage' }
function formatQty(value) { const n = Number(value); return Number.isInteger(n) ? String(n) : n.toFixed(2) }
function timeAgo(dateString) {
  if (!dateString) return '—'
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
const PAGE_SIZE = 20

export default function AdminInventoryPage() {
  const [items, setItems] = useState([])
  const [movements, setMovements] = useState([])
  const [affectedMenuItems, setAffectedMenuItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [lastRefreshed, setLastRefreshed] = useState(null)
  const [connection, setConnection] = useState('connecting')

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [unitFilter, setUnitFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [page, setPage] = useState(1)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [movementTypeFilter, setMovementTypeFilter] = useState('all')
  const [drawerItem, setDrawerItem] = useState(null)

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [itemRows, movementRows, affected] = await Promise.all([fetchInventoryItems(), fetchMovements({ limit: 80 }), fetchAffectedMenuItems()])
      setItems(itemRows); setMovements(movementRows); setAffectedMenuItems(affected)
      setLastRefreshed(new Date())
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load inventory monitoring data.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const channel = supabase
      .channel('admin-inventory-monitoring')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_stock' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finished_products' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supplies' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finished_product_movements' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supply_movements' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => load())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnection('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('reconnecting')
        else if (status === 'CLOSED') setConnection('offline')
      })
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const overview = useMemo(() => computeOverview(items, movements), [items, movements])
  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items])
  const types = useMemo(() => [...new Set(items.map((i) => i.type).filter(Boolean))].sort(), [items])
  const units = useMemo(() => [...new Set(items.map((i) => i.unit))].sort(), [items])
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q) && !item.sku.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      if (statusFilter !== 'all' && stockStatus(item) !== statusFilter) return false
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (unitFilter !== 'all' && item.unit !== unitFilter) return false
      return true
    })
  }, [items, search, categoryFilter, statusFilter, typeFilter, unitFilter])

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'stock') list.sort((a, b) => a.quantity - b.quantity)
    else if (sortBy === 'value') list.sort((a, b) => (b.costPerUnit ?? 0) * b.quantity - (a.costPerUnit ?? 0) * a.quantity)
    else if (sortBy === 'updated') list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    return list
  }, [filtered, sortBy])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const lowAndOutItems = useMemo(() => items.filter((i) => ['low', 'out'].includes(stockStatus(i))).sort((a, b) => a.quantity - b.quantity), [items])
  const expiringItems = useMemo(() => items.filter((i) => isExpiringSoon(i)), [items])
  const filteredMovements = useMemo(() => movementTypeFilter === 'all' ? movements : movements.filter((m) => m.movementType === movementTypeFilter), [movements, movementTypeFilter])

  const hasActiveFilters = search || categoryFilter !== 'all' || statusFilter !== 'all' || typeFilter !== 'all' || unitFilter !== 'all'
  const resetFilters = () => { setSearch(''); setCategoryFilter('all'); setStatusFilter('all'); setTypeFilter('all'); setUnitFilter('all'); setPage(1) }

  const runExport = () => {
    const headers = ['Name', 'SKU', 'Category', 'Type', 'Quantity', 'Unit', 'Low Threshold', 'Healthy Target', 'Status', 'Est. Value', 'Last Updated']
    const rows = sorted.map((i) => [i.name, i.sku, i.category, i.type || '', i.quantity, i.unit, i.minStockLevel, i.highStockLevel, STATUS_META[stockStatus(i)].label, i.costPerUnit !== null ? (i.costPerUnit * i.quantity).toFixed(2) : '', new Date(i.updatedAt).toISOString()])
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `inventory-monitoring-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell role="admin" title="Inventory Monitoring" eyebrow="Monitor stock health, consumption, and value across the café." actions={
      <div className="ops-header-actions">
        <div className="dash-pill"><Calendar size={14} /><span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span></div>
        <div className="dash-pill"><Clock size={14} /><b>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}</b></div>
        <div className={`inv-connection tone-${connection}`}>{connection === 'live' ? <Wifi size={13} /> : <WifiOff size={13} />} {connection === 'live' ? 'Live' : connection === 'reconnecting' ? 'Reconnecting' : 'Offline'}</div>
        <button type="button" className="ops-icon-button" aria-label="Refresh" title="Refresh" onClick={load} disabled={loading}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
        <button type="button" className="ops-main-action inv-record-btn" onClick={runExport} disabled={loading || sorted.length === 0}><Download size={16} /> Export Report</button>
      </div>
    }>
      {error && <p className="form-error">{error}</p>}
      {lastRefreshed && <p className="dash-panel-tag" style={{ marginBottom: 10 }}>Last refreshed {timeAgo(lastRefreshed.toISOString())}</p>}

      {loading ? <InventorySkeleton /> : (
        <div className="dash-fade-in">
          <section className="inv-summary-row inv-kpi-row">
            <div className="inv-summary-card tone-neutral"><Boxes size={18} /><span>Total Active Ingredients</span><b>{overview.totalActiveIngredients}</b></div>
            <div className="inv-summary-card tone-green"><Package size={18} /><span>Total Inventory Value</span><b>{overview.hasCostData ? money(overview.totalValue) : 'Not tracked'}</b></div>
            <div className="inv-summary-card tone-amber"><AlertTriangle size={18} /><span>Low Stock Items</span><b>{overview.lowStockCount}</b></div>
            <div className="inv-summary-card tone-red"><PackageX size={18} /><span>Out of Stock Items</span><b>{overview.outOfStockCount}</b></div>
            <div className="inv-summary-card tone-blue"><Clock size={18} /><span>Expiring Soon</span><b>{overview.expiringSoon}</b></div>
            <div className="inv-summary-card tone-neutral"><TrendingDown size={18} /><span>Recent Deductions</span><b>{overview.recentDeductions}</b></div>
            <div className="inv-summary-card tone-amber"><AlertTriangle size={18} /><span>Waste Recorded</span><b>{overview.wasteRecorded}</b></div>
          </section>

          <section className="dashboard-grid dash-triple-grid">
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Stock Status Distribution</span><small>All tracked items</small></div></div>
              <StatusDoughnut counts={{ healthy: overview.healthyCount, low: overview.lowStockCount, out: overview.outOfStockCount, over: overview.overStockCount }} />
            </article>
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Ingredient Consumption Trend</span><small>Last 14 days</small></div></div>
              <ConsumptionChart trend={overview.consumptionTrend} />
            </article>
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Most Consumed</span><small>Last 14 days</small></div></div>
              {overview.mostConsumed.length === 0 ? <EmptyMini text="No deductions recorded yet." /> : overview.mostConsumed.map((c, i) => (
                <div className="rank-row dash-rank-row" key={c.name}><span>{i + 1}</span><div><strong>{c.name}</strong><small>{formatQty(c.qty)} {c.unit} used</small></div></div>
              ))}
            </article>
          </section>

          <section className="panel dash-panel">
            <div className="panel-head"><div><span>Inventory Value by Category</span><small>{overview.hasCostData ? 'Estimated using tracked cost per unit' : 'No cost data tracked yet'}</small></div></div>
            {!overview.hasCostData ? <EmptyMini text="Add a cost per unit to ingredients in Inventory Management to see value breakdowns." /> : (
              <div className="legacy-bar-list">
                {overview.valueByCategory.map(([category, value]) => (
                  <div className="legacy-bar-row" key={category}>
                    <div><b>{category}</b><span>{money(value)}</span></div>
                    <div className="legacy-track"><i className="dash-track-fill" style={{ width: `${(value / overview.totalValue) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="dashboard-grid dash-bottom-grid">
            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Critical Alerts</span></div></div>
              <CriticalAlerts lowAndOut={lowAndOutItems} expiring={expiringItems} affected={affectedMenuItems} onView={setDrawerItem} />
            </article>

            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Low Stock &amp; Reorder</span><small>Restocking is handled by Operations Staff</small></div></div>
              {lowAndOutItems.length === 0 ? <EmptyMini text="No items need reordering." /> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Ingredient</th><th>Current</th><th>Threshold</th><th>Suggested Reorder</th><th>Supplier</th></tr></thead>
                    <tbody>
                      {lowAndOutItems.slice(0, 8).map((item) => (
                        <tr key={item.id} className="dash-table-row">
                          <td><b>{item.name}</b></td>
                          <td>{formatQty(item.quantity)} {item.unit}</td>
                          <td>{formatQty(item.minStockLevel)} {item.unit}</td>
                          <td>{formatQty(Math.max(item.minStockLevel * 2 - item.quantity, item.minStockLevel))} {item.unit}</td>
                          <td>{item.supplier || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>

            <article className="panel dash-panel">
              <div className="panel-head"><div><span>Recent Stock Movements</span></div></div>
              <div className="menu-manage-chip-row" style={{ marginBottom: 12 }}>
                {['all', 'restock', 'deduction', 'adjustment', 'waste'].map((key) => (
                  <button type="button" key={key} className={`menu-manage-chip ${movementTypeFilter === key ? 'active' : ''}`} onClick={() => setMovementTypeFilter(key)}>{key === 'all' ? 'All' : MOVEMENT_LABEL[key]}</button>
                ))}
              </div>
              {filteredMovements.length === 0 ? <EmptyMini text="No stock movements recorded yet." /> : (
                <ul className="inv-movement-list dash-movement-feed">
                  {filteredMovements.slice(0, 10).map((m) => (
                    <li key={`${m.itemType}-${m.id}`}>
                      <span className={`inv-movement-type ${m.movementType}`}>{MOVEMENT_LABEL[m.movementType] || m.movementType}</span>
                      <b>{itemsById.get(m.itemId)?.name || 'Unknown item'} — {m.movementType === 'restock' ? '+' : '−'}{formatQty(m.quantity)} {itemsById.get(m.itemId)?.unit || ''}</b>
                      <span className="inv-movement-meta">{m.reason || 'No reason given'} · {m.staffName} · {timeAgo(m.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>

          <section className="inv-toolbar">
            <label className="ops-search">
              <Search size={17} /><span className="sr-only">Search inventory</span>
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Search ingredient, SKU, or category…" />
            </label>
            <button type="button" className="ops-secondary-action compact" onClick={() => setFiltersOpen((v) => !v)}><Settings2 size={14} /> Filters</button>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort">
              <option value="name">Name: A to Z</option><option value="stock">Stock: lowest first</option><option value="value">Value: highest first</option><option value="updated">Recently updated</option>
            </select>
            {hasActiveFilters && <button type="button" className="ops-destructive-action compact" onClick={resetFilters}>Reset Filters</button>}
          </section>

          {filtersOpen && (
            <section className="inv-toolbar menu-extra-filters">
              <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }} aria-label="Category"><option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} aria-label="Stock status"><option value="all">All statuses</option>{Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
              <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }} aria-label="Type"><option value="all">All types</option>{types.map((t) => <option key={t} value={t} className="inv-capitalize">{t}</option>)}</select>
              <select value={unitFilter} onChange={(e) => { setUnitFilter(e.target.value); setPage(1) }} aria-label="Unit"><option value="all">All units</option>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select>
            </section>
          )}

          {pageItems.length === 0 ? (
            <div className="inv-empty"><Coffee size={28} /><h3>No inventory items found</h3><p>Try adjusting your filters.</p></div>
          ) : (
            <>
              <div className="inv-table-wrap">
                <table className="inv-table">
                  <thead><tr><th>Ingredient</th><th>Category</th><th>Quantity</th><th>Status</th><th>Est. Value</th><th>Used By</th><th>Last Updated</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {pageItems.map((item) => {
                      const status = stockStatus(item)
                      return (
                        <tr key={item.id}>
                          <td><b>{item.name}</b>{item.sku && <><br /><small>{item.sku}</small></>}</td>
                          <td>{item.category}</td>
                          <td>{formatQty(item.quantity)} {item.unit}</td>
                          <td><span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span></td>
                          <td>{item.costPerUnit !== null ? money(item.costPerUnit * item.quantity) : '—'}</td>
                          <td>{item.usedByCount || '—'}</td>
                          <td>{timeAgo(item.updatedAt)}</td>
                          <td><button type="button" className="ops-secondary-action compact" onClick={() => setDrawerItem(item)}><Eye size={14} /> View</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="inv-cards">
                {pageItems.map((item) => {
                  const status = stockStatus(item)
                  return (
                    <article className="inv-card" key={item.id}>
                      <div className="inv-card-top"><b>{item.name}</b><span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span></div>
                      <p className="inv-card-meta">{item.category}{item.type ? ` · ${item.type}` : ''}</p>
                      <p className="inv-card-qty">{formatQty(item.quantity)} {item.unit}</p>
                      <p className="inv-card-thresholds">Value: {item.costPerUnit !== null ? money(item.costPerUnit * item.quantity) : '—'} · Updated {timeAgo(item.updatedAt)}</p>
                      <div className="inv-card-actions"><button type="button" className="ops-secondary-action" onClick={() => setDrawerItem(item)}>View Details</button></div>
                    </article>
                  )
                })}
              </div>

              {totalPages > 1 && (
                <div className="inv-pagination">
                  <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <span>Page {page} of {totalPages} · {sorted.length} items</span>
                  <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {drawerItem && <ItemDetailDrawer item={itemsById.get(drawerItem.id) || drawerItem} movements={movements.filter((m) => m.itemId === drawerItem.id)} usedBy={affectedMenuItems} onClose={() => setDrawerItem(null)} />}
    </AppShell>
  )
}

function StatusDoughnut({ counts }) {
  const colors = { healthy: '#16a34a', low: '#d97706', out: '#dc2626', over: '#2563eb' }
  const entries = Object.entries(counts).filter(([, v]) => v > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0)
  const r = 60, c = 2 * Math.PI * r
  let offset = 0
  if (total === 0) return <EmptyMini text="No inventory items tracked yet." />
  return (
    <div className="dash-doughnut-wrap">
      <svg viewBox="0 0 160 160" className="dash-doughnut">
        <circle cx="80" cy="80" r={r} fill="none" stroke="#eef1ee" strokeWidth="20" />
        {entries.map(([key, value]) => {
          const dash = (value / total) * c
          const el = <circle key={key} cx="80" cy="80" r={r} fill="none" stroke={colors[key]} strokeWidth="20" strokeDasharray={`${dash} ${c - dash}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" className="dash-doughnut-seg" />
          offset += dash
          return el
        })}
        <text x="80" y="76" textAnchor="middle" fontSize="26" fontWeight="800" fill="#1b2f22">{total}</text>
        <text x="80" y="96" textAnchor="middle" fontSize="11" fill="#68736b">Items</text>
      </svg>
      <ul className="dash-doughnut-legend">
        {entries.map(([key, value]) => <li key={key}><i style={{ background: colors[key] }} />{STATUS_META[key].label}<span>{value} ({Math.round((value / total) * 100)}%)</span></li>)}
      </ul>
    </div>
  )
}

function ConsumptionChart({ trend }) {
  const max = Math.max(1, ...trend.map((d) => d.quantity))
  const hasData = trend.some((d) => d.quantity > 0)
  if (!hasData) return <EmptyMini text="No ingredient deductions in the last 14 days." />
  const points = trend.map((d, i) => [((i / Math.max(1, trend.length - 1)) * 600), 170 - (d.quantity / max) * 150])
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
  return (
    <div className="line-chart dash-line-chart">
      <div className="grid-lines" />
      <svg viewBox="0 0 600 180" preserveAspectRatio="none" aria-label="Ingredient consumption trend">
        <path d={linePath} fill="none" stroke="#b45309" strokeWidth="3" className="dash-sparkline" />
      </svg>
      <div className="chart-labels">{trend.filter((_, i) => i % 2 === 0).map((d) => <span key={d.day}>{new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(d.day))}</span>)}</div>
    </div>
  )
}

function CriticalAlerts({ lowAndOut, expiring, affected, onView }) {
  const alerts = [
    ...lowAndOut.map((i) => ({ id: `stock-${i.id}`, tone: stockStatus(i) === 'out' ? 'red' : 'amber', text: `${i.name} is ${stockStatus(i) === 'out' ? 'out of stock' : 'running low'} (${formatQty(i.quantity)} ${i.unit} left)`, onClick: () => onView(i) })),
    ...expiring.map((i) => ({ id: `exp-${i.id}`, tone: 'blue', text: `${i.name} expires ${new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(i.expirationDate))}`, onClick: () => onView(i) })),
    ...affected.map((m) => ({ id: `menu-${m.id}`, tone: 'neutral', text: `${m.name} is unavailable — ${m.reason === 'missing_ingredient' ? 'missing ingredient' : 'insufficient stock'}` })),
  ]
  if (alerts.length === 0) return <EmptyMini text="No critical inventory alerts right now." />
  return (
    <ul className="dash-doughnut-legend" style={{ maxHeight: 280, overflow: 'auto' }}>
      {alerts.map((a) => (
        <li key={a.id} style={{ cursor: a.onClick || a.href ? 'pointer' : 'default' }} onClick={a.onClick}>
          <i style={{ background: { red: '#dc2626', amber: '#d97706', blue: '#2563eb', neutral: '#64748b' }[a.tone] }} />
          {a.href ? <a href={a.href} style={{ color: 'inherit' }}>{a.text}</a> : a.text}
        </li>
      ))}
    </ul>
  )
}

function ItemDetailDrawer({ item, movements, usedBy, onClose }) {
  const status = stockStatus(item)
  const relatedMenuItems = usedBy.filter((m) => m.id === item.menuItemId)
  return (
    <div className="ops-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="inv-mon-drawer-title">
        <header><div><span className="settings-kicker">{item.category}</span><h2 id="inv-mon-drawer-title">{item.name}</h2></div><button type="button" onClick={onClose} aria-label="Close item details"><X size={20} /></button></header>
        <div className="ops-drawer-body">
          <section><h3>Current stock</h3><p><b>{formatQty(item.quantity)} {item.unit}</b> <span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span></p></section>
          <section><h3>Thresholds</h3><p>Low-stock alert: {formatQty(item.minStockLevel)} {item.unit}</p><p>Healthy-stock target: {formatQty(item.highStockLevel)} {item.unit}</p></section>
          <section><h3>Value</h3><p>{item.costPerUnit !== null ? `${money(item.costPerUnit)} per ${item.unit} · ${money(item.costPerUnit * item.quantity)} total` : 'Cost per unit not tracked yet'}</p></section>
          <section><h3>Item information</h3>
            {item.sku && <p>SKU: {item.sku}</p>}
            {item.type && <p className="inv-capitalize">Type: {item.type}</p>}
            {item.supplier && <p>Supplier: {item.supplier}</p>}
            {item.expirationDate && <p>Expires: {new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(item.expirationDate))}</p>}
            {item.notes && <p>Notes: {item.notes}</p>}
          </section>
          {relatedMenuItems.length > 0 && <section><h3>Affected menu items</h3>{relatedMenuItems.map((m) => <p key={m.id}>{m.name}</p>)}</section>}
          <section><h3>Recent movements</h3>
            {movements.length === 0 ? <p className="ops-proof-pending">No stock movements recorded yet.</p> : (
              <ul className="inv-movement-list">
                {movements.slice(0, 10).map((m) => (
                  <li key={m.id}><span className={`inv-movement-type ${m.movementType}`}>{MOVEMENT_LABEL[m.movementType] || m.movementType}</span><b>{m.movementType === 'restock' ? '+' : '−'}{formatQty(m.quantity)} {item.unit}</b><span className="inv-movement-meta">{m.reason || 'No reason given'} · {m.staffName} · {timeAgo(m.createdAt)}</span></li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <footer className="ops-drawer-footer"><p className="ops-proof-pending">Stock adjustments are made by Operations Staff in Inventory Management.</p></footer>
      </aside>
    </div>
  )
}

function EmptyMini({ text }) { return <div className="dash-empty-mini"><Boxes size={20} /><p>{text}</p></div> }

function InventorySkeleton() {
  return (
    <div className="dash-skeleton">
      <div className="inv-summary-row inv-kpi-row">{Array.from({ length: 7 }).map((_, i) => <div className="inv-skeleton-row dash-skel-card" key={i} />)}</div>
      <div className="dashboard-grid dash-triple-grid"><div className="inv-skeleton-row dash-skel-panel" /><div className="inv-skeleton-row dash-skel-panel" /><div className="inv-skeleton-row dash-skel-panel" /></div>
    </div>
  )
}
