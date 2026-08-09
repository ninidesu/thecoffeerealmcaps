import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Bell, Box, Package, PackageX, RefreshCw, Search,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import { fetchFinishedProducts, fetchIngredients } from '../services/opsInventoryService'
import { supabase } from '../lib/supabase'
import { useManagementSessionState } from '../hooks/useManagementSessionState'

const ENTITY_CONFIGS = {
  ingredient: { label: 'Ingredients', singular: 'Ingredient', fetch: fetchIngredients, hasType: true },
  finished_product: { label: 'Products', singular: 'Product', fetch: fetchFinishedProducts, hasType: false },
}
const PAGE_SIZE = 25

const STATUS_META = {
  out: { label: 'Out of Stock', tone: 'red' },
  low: { label: 'Low Stock', tone: 'amber' },
  healthy: { label: 'Healthy', tone: 'green' },
  over: { label: 'Over Stock', tone: 'blue' },
}

function stockStatus(item) {
  if (item.quantity <= 0) return 'out'
  if (item.quantity <= item.minStockLevel) return 'low'
  if (item.highStockLevel > 0 && item.quantity > item.highStockLevel) return 'over'
  return 'healthy'
}

function formatQty(value) {
  const number = Number(value)
  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}

function timeAgo(dateString) {
  if (!dateString) return '—'
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(dateString))
}

export default function AdminInventoryPage() {
  const [activeEntity, setActiveEntity] = useManagementSessionState('admin:inventory:entity', 'ingredient')
  const [search, setSearch] = useManagementSessionState('admin:inventory:search', '')
  const [categoryFilter, setCategoryFilter] = useManagementSessionState('admin:inventory:category', 'all')
  const [statusFilter, setStatusFilter] = useManagementSessionState('admin:inventory:status', 'all')
  const [typeFilter, setTypeFilter] = useManagementSessionState('admin:inventory:type', 'all')
  const [sortBy, setSortBy] = useManagementSessionState('admin:inventory:sort', 'name')
  const [page, setPage] = useManagementSessionState('admin:inventory:page', 1)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())

  const config = ENTITY_CONFIGS[activeEntity] || ENTITY_CONFIGS.ingredient

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const load = useCallback(async (entity) => {
    const requestedEntity = entity || 'ingredient'
    setLoading(true)
    try {
      setItems(await (ENTITY_CONFIGS[requestedEntity] || ENTITY_CONFIGS.ingredient).fetch())
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load inventory monitoring data.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPage(1)
    setCategoryFilter('all')
    setStatusFilter('all')
    setTypeFilter('all')
    load(activeEntity)
  }, [activeEntity, load, setCategoryFilter, setPage, setStatusFilter, setTypeFilter])

  useEffect(() => {
    const tables = activeEntity === 'ingredient'
      ? ['ingredients', 'inventory_stock']
      : ['finished_products']
    const channel = supabase.channel(`admin-inventory-${activeEntity}`)
    tables.forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => load(activeEntity))
    })
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeEntity, load])

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category).filter(Boolean))].sort(),
    [items],
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      if (query && !item.name.toLowerCase().includes(query)) return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      if (statusFilter !== 'all' && stockStatus(item) !== statusFilter) return false
      if (config.hasType && typeFilter !== 'all' && item.type !== typeFilter) return false
      return true
    })
  }, [items, search, categoryFilter, statusFilter, typeFilter, config.hasType])

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    if (sortBy === 'quantity') list.sort((a, b) => a.quantity - b.quantity)
    if (sortBy === 'updated') list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    return list
  }, [filtered, sortBy])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const outCount = items.filter((item) => stockStatus(item) === 'out').length
  const lowCount = items.filter((item) => stockStatus(item) === 'low').length
  const attentionCount = outCount + lowCount

  return (
    <AppShell
      role="admin"
      title="Inventory Monitoring"
      onRefresh={() => load(activeEntity)}
      titleActions={(
        <div className="ops-order-view-toggle" role="tablist" aria-label="Inventory type">
          <button type="button" role="tab" aria-selected={activeEntity === 'ingredient'} className={activeEntity === 'ingredient' ? 'active' : ''} onClick={() => setActiveEntity('ingredient')}>Ingredients</button>
          <button type="button" role="tab" aria-selected={activeEntity === 'finished_product'} className={activeEntity === 'finished_product' ? 'active' : ''} onClick={() => setActiveEntity('finished_product')}>Products</button>
        </div>
      )}
      actions={(
        <div className="ops-header-actions">
          <div className="ops-clock">
            <span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span>
            <b>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}</b>
          </div>
          <div className="ops-icon-button inv-readonly-attention" aria-label={`${attentionCount} items need attention`} title="Items needing attention">
            <Bell size={18} />
            {attentionCount > 0 && <span className="ops-badge">{attentionCount}</span>}
          </div>
          <button type="button" className="ops-icon-button" aria-label="Refresh inventory" title="Refresh" onClick={() => load(activeEntity)} disabled={loading}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
      )}
    >
      {error && <p className="form-error">{error}</p>}

      <div className="inv-summary-row inventory-summary-grid">
        <article className="inv-summary-card tone-red"><span className="inv-summary-icon"><PackageX size={18} /></span><span className="inv-summary-copy"><span>Out of Stock</span><small>Needs replenishment</small></span><b>{outCount}</b></article>
        <article className="inv-summary-card tone-amber"><span className="inv-summary-icon"><AlertTriangle size={18} /></span><span className="inv-summary-copy"><span>Low Stock</span><small>Below alert level</small></span><b>{lowCount}</b></article>
        <article className="inv-summary-card tone-neutral"><span className="inv-summary-icon"><Package size={18} /></span><span className="inv-summary-copy"><span>Total Records</span><small>Tracked inventory</small></span><b>{items.length}</b></article>
      </div>

      <div className="inv-toolbar inv-monitoring-toolbar">
        <label className="ops-search">
          <Search size={17} /><span className="sr-only">Search {config.label.toLowerCase()}</span>
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={`Search ${config.label.toLowerCase()}…`} />
        </label>
        <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1) }} aria-label="Filter by category">
          <option value="all">All categories</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }} aria-label="Filter by stock status">
          <option value="all">All statuses</option>
          {Object.entries(STATUS_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
        {config.hasType && (
          <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }} aria-label="Filter by type">
            <option value="all">All types</option><option value="wet">Wet</option><option value="dry">Dry</option><option value="other">Other</option>
          </select>
        )}
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort inventory">
          <option value="name">Name: A to Z</option><option value="quantity">Quantity: lowest first</option><option value="updated">Recently updated</option>
        </select>
      </div>

      {loading ? (
        <InventorySkeleton />
      ) : pageItems.length === 0 ? (
        <div className="inv-empty"><Box size={28} /><h3>No {config.label.toLowerCase()} found</h3><p>Try adjusting your search or filters.</p></div>
      ) : (
        <>
          <div className="inv-table-wrap inv-readonly-table">
            <table className="inv-table">
              <thead>
                <tr><th>{config.singular} Name</th><th>Category</th>{config.hasType && <th>Type</th>}<th>Quantity</th><th>Unit</th><th>Status</th><th>Low Stock Alert</th><th>Healthy Point</th><th>Last Updated</th></tr>
              </thead>
              <tbody>
                {pageItems.map((item) => {
                  const status = stockStatus(item)
                  return (
                    <tr key={item.id}>
                      <td><b>{item.name}</b></td><td>{item.category || '—'}</td>{config.hasType && <td className="inv-capitalize">{item.type || '—'}</td>}
                      <td>{formatQty(item.quantity)}</td><td>{item.unit}</td><td><span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span></td>
                      <td>{formatQty(item.minStockLevel)}</td><td>{formatQty(item.highStockLevel)}</td><td>{timeAgo(item.updatedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="inv-cards inv-readonly-cards">
            {pageItems.map((item) => {
              const status = stockStatus(item)
              return (
                <article className="inv-card" key={item.id}>
                  <div className="inv-card-top"><b>{item.name}</b><span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span></div>
                  <p className="inv-card-meta">{item.category || 'Uncategorized'}{config.hasType ? ` · ${item.type || 'Other'}` : ''}</p>
                  <p className="inv-card-qty">{formatQty(item.quantity)} {item.unit}</p>
                  <p className="inv-card-thresholds">Low: {formatQty(item.minStockLevel)} · Healthy: {formatQty(item.highStockLevel)} · Updated {timeAgo(item.updatedAt)}</p>
                </article>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="inv-pagination">
              <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <span>Page {currentPage} of {totalPages}</span>
              <button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          )}
        </>
      )}
    </AppShell>
  )
}

function InventorySkeleton() {
  return <div className="inv-skeleton" aria-label="Loading inventory">{Array.from({ length: 6 }).map((_, index) => <div className="inv-skeleton-row" key={index} />)}</div>
}
